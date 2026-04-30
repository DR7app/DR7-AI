import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
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

// Green API expects digits only with country code, e.g. 393921900763
function normalizePhone(raw: string | null | undefined): string {
    if (!raw) return "";
    let phone = raw.replace(/[\s\-+()]/g, "");
    if (phone.startsWith("00")) phone = phone.substring(2);
    if (phone.length === 10) phone = "39" + phone;
    return phone;
}

async function greenApiSendMessage(phone: string, message: string): Promise<void> {
    const url = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: `${phone}@c.us`, message }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.error) throw new Error(result.error || `Green API ${res.status}`);
}

async function greenApiSendFile(phone: string, urlFile: string, fileName: string, caption?: string): Promise<void> {
    const url = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendFileByUrl/${GREEN_API_TOKEN}`;
    const body: Record<string, string> = { chatId: `${phone}@c.us`, urlFile, fileName };
    if (caption) body.caption = caption;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.error) throw new Error(result.error || `Green API ${res.status}`);
}

function fileNameFromUrl(u: string, fallback: string): string {
    try {
        const seg = new URL(u).pathname.split("/").pop();
        return seg || fallback;
    } catch {
        return fallback;
    }
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ message: "Method Not Allowed" }) };
    }

    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
        return { statusCode: 500, body: JSON.stringify({ error: "Green API non configurato" }) };
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

        if (!phone || phone.length < 10) {
            failed++;
            errors.push(`${displayName}: numero mancante o invalido`);
            if (sb && c.id) {
                await sb.from("marketing_campaign_recipients")
                    .update({ status: "skipped", error_message: "no/invalid phone" })
                    .eq("id", c.id);
            }
            continue;
        }

        const personalized = message
            .replace(/{nome}/g, c.nome || displayName.split(" ")[0] || "Cliente")
            .replace(/{cognome}/g, c.cognome || "");

        try {
            if (imageUrls.length === 0 && !videoUrl) {
                await greenApiSendMessage(phone, personalized);
            } else if (imageUrls.length > 0) {
                // First image carries the message as caption
                await greenApiSendFile(phone, imageUrls[0], fileNameFromUrl(imageUrls[0], "image.jpg"), personalized);
                for (let i = 1; i < imageUrls.length; i++) {
                    await new Promise(r => setTimeout(r, 600));
                    await greenApiSendFile(phone, imageUrls[i], fileNameFromUrl(imageUrls[i], `image-${i + 1}.jpg`));
                }
                if (videoUrl) {
                    await new Promise(r => setTimeout(r, 600));
                    await greenApiSendFile(phone, videoUrl, fileNameFromUrl(videoUrl, "video.mp4"));
                }
            } else if (videoUrl) {
                await greenApiSendFile(phone, videoUrl, fileNameFromUrl(videoUrl, "video.mp4"), personalized);
            }

            sent++;
            if (sb && c.id) {
                await sb.from("marketing_campaign_recipients")
                    .update({ status: "sent", sent_at: new Date().toISOString() })
                    .eq("id", c.id);
            }
            await new Promise(r => setTimeout(r, 400));
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

        // Live progress: update campaign counters every 10 recipients so the
        // history view reflects in-flight progress instead of jumping at end.
        if (sb && campaignId && (sent + failed) % 10 === 0) {
            await sb.from("marketing_campaigns")
                .update({ sent_count: sent, failed_count: failed })
                .eq("id", campaignId);
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
