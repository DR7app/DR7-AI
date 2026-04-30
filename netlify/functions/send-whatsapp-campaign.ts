import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const CALLMEBOT_API_KEY = process.env.CALLMEBOT_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

interface CampaignRecipient {
    id?: string;
    customer_id?: string | null;
    customer_name?: string | null;
    nome?: string;
    cognome?: string;
    phone?: string | null;
    email?: string | null;
}

function normalizePhone(raw: string | null | undefined): string {
    if (!raw) return "";
    let phone = raw.replace(/\s+/g, "").replace(/-/g, "");
    if (!phone.startsWith("+")) {
        if (phone.length === 10 && phone.startsWith("3")) phone = "+39" + phone;
        else if (phone.length === 12 && phone.startsWith("39")) phone = "+" + phone;
    }
    return phone;
}

async function callMeBot(phone: string, message: string, mediaUrl?: string): Promise<void> {
    const params = new URLSearchParams({
        phone,
        text: message,
        apikey: CALLMEBOT_API_KEY || "",
    });
    if (mediaUrl) params.set("image", mediaUrl);
    const url = `https://api.callmebot.com/whatsapp.php?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CallMeBot returned ${res.status}`);
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ message: "Method Not Allowed" }) };
    }

    if (!CALLMEBOT_API_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: "CallMeBot API key not configured" }) };
    }

    let body: {
        campaignId?: string;
        customers?: CampaignRecipient[];
        message?: string;
        imageUrl?: string;
        imageUrls?: string[];
        videoUrl?: string;
    };

    try {
        body = JSON.parse(event.body || "{}");
    } catch {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
    }

    const { campaignId, customers, message, imageUrl, videoUrl } = body;
    const imageUrls: string[] = body.imageUrls && body.imageUrls.length > 0
        ? body.imageUrls
        : (imageUrl ? [imageUrl] : []);

    if (!customers || !Array.isArray(customers) || customers.length === 0) {
        return { statusCode: 400, body: JSON.stringify({ error: "Nessun cliente specificato" }) };
    }
    if (!message) {
        return { statusCode: 400, body: JSON.stringify({ error: "Messaggio mancante" }) };
    }

    const sb = SUPABASE_URL && SUPABASE_SERVICE_KEY
        ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
        : null;

    if (sb && campaignId) {
        await sb.from("marketing_campaigns")
            .update({ status: "sending", started_at: new Date().toISOString() })
            .eq("id", campaignId);
    }

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const c of customers) {
        const phone = normalizePhone(c.phone);
        const displayName = c.customer_name || `${c.nome || ""} ${c.cognome || ""}`.trim() || c.email || phone || "Cliente";

        if (!phone) {
            failed++;
            errors.push(`${displayName}: numero mancante`);
            if (sb && c.id) {
                await sb.from("marketing_campaign_recipients")
                    .update({ status: "skipped", error_message: "no phone" })
                    .eq("id", c.id);
            }
            continue;
        }

        const personalized = message
            .replace(/{nome}/g, c.nome || displayName.split(" ")[0] || "Cliente")
            .replace(/{cognome}/g, c.cognome || "");

        try {
            // First message: text + first image (or video if no images).
            const firstMedia = imageUrls[0] || videoUrl || undefined;
            await callMeBot(phone, personalized, firstMedia);

            // Remaining images (caption-less).
            for (let i = 1; i < imageUrls.length; i++) {
                await new Promise(r => setTimeout(r, 800));
                await callMeBot(phone, "", imageUrls[i]);
            }

            // Video, if there were images already (otherwise it was the first media).
            if (videoUrl && imageUrls.length > 0) {
                await new Promise(r => setTimeout(r, 800));
                await callMeBot(phone, "", videoUrl);
            }

            sent++;
            if (sb && c.id) {
                await sb.from("marketing_campaign_recipients")
                    .update({ status: "sent", sent_at: new Date().toISOString() })
                    .eq("id", c.id);
            }
            await new Promise(r => setTimeout(r, 1000));
        } catch (err: unknown) {
            failed++;
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${displayName}: ${msg}`);
            if (sb && c.id) {
                await sb.from("marketing_campaign_recipients")
                    .update({ status: "failed", error_message: msg })
                    .eq("id", c.id);
            }
        }
    }

    if (sb && campaignId) {
        await sb.from("marketing_campaigns")
            .update({
                status: failed === customers.length ? "failed" : "completed",
                sent_count: sent,
                failed_count: failed,
                completed_at: new Date().toISOString(),
            })
            .eq("id", campaignId);
    }

    return {
        statusCode: 200,
        body: JSON.stringify({
            success: true,
            sent,
            failed,
            total: customers.length,
            errors: errors.length > 0 ? errors : undefined,
        }),
    };
};
