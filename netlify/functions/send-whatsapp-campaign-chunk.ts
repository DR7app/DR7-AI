import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Process at most this many recipients per invocation. The browser keeps
// calling this endpoint until 'done: true' comes back. With 5 recipients
// at ~1.5s each + media latency, we stay well under the 10s Netlify limit.
const CHUNK_SIZE = 5;

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
        return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
    }
    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
        return { statusCode: 500, body: JSON.stringify({ error: "Green API non configurato (GREEN_API_INSTANCE_ID/GREEN_API_TOKEN)" }) };
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: "Supabase service key non configurata" }) };
    }

    let body: { campaignId?: string };
    try {
        body = JSON.parse(event.body || "{}");
    } catch {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
    }

    const { campaignId } = body;
    if (!campaignId) {
        return { statusCode: 400, body: JSON.stringify({ error: "campaignId mancante" }) };
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    // Load campaign metadata once per chunk
    const { data: camp, error: campErr } = await sb.from("marketing_campaigns").select("*").eq("id", campaignId).single();
    if (campErr || !camp) {
        return { statusCode: 404, body: JSON.stringify({ error: "Campagna non trovata" }) };
    }

    const message: string = camp.message_text;
    const imageUrls: string[] = Array.isArray(camp.image_urls) && camp.image_urls.length > 0
        ? camp.image_urls
        : (camp.image_url ? [camp.image_url] : []);
    const videoUrl: string | undefined = camp.video_url || undefined;

    // Mark campaign as sending the first time we see pending work
    if (camp.status !== "sending") {
        await sb.from("marketing_campaigns")
            .update({ status: "sending", started_at: camp.started_at || new Date().toISOString(), completed_at: null })
            .eq("id", campaignId);
    }

    // Pull the next chunk of unsent recipients (pending OR previously failed)
    const { data: recs, error: recsErr } = await sb.from("marketing_campaign_recipients")
        .select("id, customer_id, customer_name, phone, email")
        .eq("campaign_id", campaignId)
        .in("status", ["pending", "failed"])
        .limit(CHUNK_SIZE);

    if (recsErr) {
        return { statusCode: 500, body: JSON.stringify({ error: `Errore lettura destinatari: ${recsErr.message}` }) };
    }

    if (!recs || recs.length === 0) {
        // No more work — finalize the campaign
        const { count: sentCount } = await sb.from("marketing_campaign_recipients")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", campaignId)
            .eq("status", "sent");
        const { count: failedCount } = await sb.from("marketing_campaign_recipients")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", campaignId)
            .in("status", ["failed", "skipped"]);

        await sb.from("marketing_campaigns")
            .update({
                status: (sentCount || 0) === 0 ? "failed" : "completed",
                sent_count: sentCount || 0,
                failed_count: failedCount || 0,
                completed_at: new Date().toISOString(),
            })
            .eq("id", campaignId);

        return {
            statusCode: 200,
            body: JSON.stringify({
                done: true,
                processed: 0,
                remaining: 0,
                sent_count: sentCount || 0,
                failed_count: failedCount || 0,
            }),
        };
    }

    let chunkSent = 0;
    let chunkFailed = 0;
    const chunkErrors: string[] = [];

    for (const r of recs) {
        const fullName = r.customer_name || "";
        const nome = fullName.split(" ")[0] || "Cliente";
        const cognome = fullName.split(" ").slice(1).join(" ");
        const phone = normalizePhone(r.phone);
        const displayName = fullName || r.email || phone || "Cliente";

        if (!phone || phone.length < 10) {
            chunkFailed++;
            chunkErrors.push(`${displayName}: numero mancante o invalido`);
            await sb.from("marketing_campaign_recipients")
                .update({ status: "skipped", error_message: "no/invalid phone" })
                .eq("id", r.id);
            continue;
        }

        const personalized = message
            .replace(/{nome}/g, nome)
            .replace(/{cognome}/g, cognome);

        try {
            if (imageUrls.length === 0 && !videoUrl) {
                await greenApiSendMessage(phone, personalized);
            } else if (imageUrls.length > 0) {
                await greenApiSendFile(phone, imageUrls[0], fileNameFromUrl(imageUrls[0], "image.jpg"), personalized);
                for (let i = 1; i < imageUrls.length; i++) {
                    await new Promise(res => setTimeout(res, 400));
                    await greenApiSendFile(phone, imageUrls[i], fileNameFromUrl(imageUrls[i], `image-${i + 1}.jpg`));
                }
                if (videoUrl) {
                    await new Promise(res => setTimeout(res, 400));
                    await greenApiSendFile(phone, videoUrl, fileNameFromUrl(videoUrl, "video.mp4"));
                }
            } else if (videoUrl) {
                await greenApiSendFile(phone, videoUrl, fileNameFromUrl(videoUrl, "video.mp4"), personalized);
            }

            chunkSent++;
            await sb.from("marketing_campaign_recipients")
                .update({ status: "sent", sent_at: new Date().toISOString() })
                .eq("id", r.id);
            await new Promise(res => setTimeout(res, 200));
        } catch (err: unknown) {
            chunkFailed++;
            const msg = err instanceof Error ? err.message : String(err);
            chunkErrors.push(`${displayName}: ${msg}`);
            await sb.from("marketing_campaign_recipients")
                .update({ status: "failed", error_message: msg })
                .eq("id", r.id);
        }
    }

    // Refresh campaign counters from the recipient table (single source of truth)
    const { count: totalSent } = await sb.from("marketing_campaign_recipients")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("status", "sent");
    const { count: totalFailed } = await sb.from("marketing_campaign_recipients")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .in("status", ["failed", "skipped"]);
    const { count: remaining } = await sb.from("marketing_campaign_recipients")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("status", "pending");

    await sb.from("marketing_campaigns")
        .update({ sent_count: totalSent || 0, failed_count: totalFailed || 0 })
        .eq("id", campaignId);

    return {
        statusCode: 200,
        body: JSON.stringify({
            done: false,
            processed: chunkSent + chunkFailed,
            sent: chunkSent,
            failed: chunkFailed,
            remaining: remaining || 0,
            sent_count: totalSent || 0,
            failed_count: totalFailed || 0,
            errors: chunkErrors.length > 0 ? chunkErrors : undefined,
        }),
    };
};
