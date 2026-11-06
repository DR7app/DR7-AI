import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { funzioneFerma } from "./utils/systemControl";
import { nellaLinguaDelTelefono } from './utils/i18n'
import { classificaRispostaGreenApi, leggiCorpo, type EsitoGreenApi } from "./utils/esitoGreenApi";
import {
    LIMITE_MESSAGGI_ORA, FINESTRA_MINUTI, FASCIA_ORA_DA, FASCIA_ORA_A, PRESA_SCADE_MINUTI, inFasciaInvio,
} from "../../src/utils/campagneFrequenza";

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// HARD KILL SWITCH: set to false to suspend campaign sends if Green API
// trips WhatsApp anti-spam again. Re-enabled 2026-05-12 after the previous
// suspension (2026-04-30). Throttle remains conservative (CHUNK_SIZE=1,
// 7s delay between recipients ~= 1 msg / 7s) to stay under WhatsApp's
// anti-spam threshold.
const CAMPAIGN_SENDS_ENABLED = true;

// Process at most this many recipients per invocation. Dropped to 1 with
// a 7s delay between sends to stay safely under WhatsApp's spam threshold
// (~1 message per 7-10 seconds is the safe rate for Green API).
// 07/11/2026: in piu', il tetto orario (50/ora su tutte le campagne) e la
// fascia 9-21 Roma valgono QUI, per chiunque chiami: anche una scheda del
// browser rimasta aperta non puo' piu' sparare a tutti di fila. Vedi
// src/utils/campagneFrequenza.ts.
const CHUNK_SIZE = 1;
const PER_RECIPIENT_DELAY_MS = 7000;

function normalizePhone(raw: string | null | undefined): string {
    if (!raw) return "";
    let phone = raw.replace(/\D/g, "");
    if (phone.startsWith("00")) phone = phone.substring(2);
    if (phone.length === 10) phone = "39" + phone;
    return phone;
}

// 07/11/2026: l'errore porta l'esito classificato. "istanza_non_disponibile"
// = Green API ha rifiutato prima di consegnare (bot bloccato/non autorizzato):
// il messaggio NON e' partito e il destinatario torna in coda senza rischio
// di doppione. Ogni altro errore e' un esito incerto e non si rimanda da solo.
class ErroreGreenApi extends Error {
    esito: EsitoGreenApi;
    constructor(esito: EsitoGreenApi) {
        super(esito.tipo === "inviato" ? "ok" : esito.motivo);
        this.esito = esito;
    }
}

async function verificaRisposta(res: Response): Promise<void> {
    const esito = classificaRispostaGreenApi(res.status, leggiCorpo(await res.text().catch(() => "")));
    if (esito.tipo !== "inviato") throw new ErroreGreenApi(esito);
}

/** La migrazione 20261107 non e' ancora applicata (funzione assente). */
function funzioneMancante(err: { code?: string; message?: string } | null): boolean {
    if (!err) return false;
    return err.code === "PGRST202" || err.code === "42883" || /could not find the function/i.test(err.message || "");
}

async function greenApiSendMessage(phone: string, message: string): Promise<void> {
    const url = `https://api.greenapi.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: `${phone}@c.us`, message }),
    });
    await verificaRisposta(res);
}

async function greenApiSendFile(phone: string, urlFile: string, fileName: string, caption?: string): Promise<void> {
    const url = `https://api.greenapi.com/waInstance${GREEN_API_INSTANCE_ID}/sendFileByUrl/${GREEN_API_TOKEN}`;
    const body: Record<string, string> = { chatId: `${phone}@c.us`, urlFile, fileName };
    if (caption) body.caption = caption;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    await verificaRisposta(res);
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
    if (!CAMPAIGN_SENDS_ENABLED) {
        return {
            statusCode: 503,
            body: JSON.stringify({
                error: "Invio campagne sospeso temporaneamente. Riattiva manualmente in send-whatsapp-campaign-chunk.ts (CAMPAIGN_SENDS_ENABLED = true).",
            }),
        };
    }
    // Interruttore System Control: campagne spente = nessun messaggio inviato.
    const ferma = await funzioneFerma("campagne_marketing");
    if (ferma) {
        return { statusCode: 503, body: JSON.stringify({ error: ferma }) };
    }
    // Interruttore System Control: WhatsApp spento = nessun messaggio (i
    // destinatari restano da inviare e ripartono alla riaccensione).
    const fermaWa = await funzioneFerma("invio_whatsapp");
    if (fermaWa) {
        console.warn("[send-whatsapp-campaign-chunk] invio saltato: " + fermaWa);
        return { statusCode: 503, body: JSON.stringify({ error: fermaWa, skipped: true, reason: "invio_whatsapp_off", message: fermaWa }) };
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

    // 07/11/2026 (direzione): frequenza automatica. Il destinatario si
    // PRENOTA nel database (campagne_prenota_destinatario): fascia 9-21 Roma,
    // tetto di LIMITE_MESSAGGI_ORA l'ora su tutte le campagne, presa atomica
    // (nessun cliente due volte, nemmeno con due giri in parallelo).
    // Se la migrazione 20261107 non e' ancora applicata si torna alla lettura
    // di prima, con fascia e tetto calcolati qui.
    type Destinatario = { id: string; customer_id: string | null; customer_name: string | null; phone: string | null; email: string | null };
    let recs: Destinatario[] = [];
    let conPresa = true;
    const prenota = await sb.rpc("campagne_prenota_destinatario", {
        p_campaign_id: campaignId,
        p_limite_ora: LIMITE_MESSAGGI_ORA,
        p_ora_da: FASCIA_ORA_DA,
        p_ora_a: FASCIA_ORA_A,
        p_finestra_minuti: FINESTRA_MINUTI,
        p_presa_scade_minuti: PRESA_SCADE_MINUTI,
    });
    if (prenota.error) {
        if (!funzioneMancante(prenota.error)) {
            return { statusCode: 500, body: JSON.stringify({ error: `Errore coda invii: ${prenota.error.message}` }) };
        }
        conPresa = false;
        if (!inFasciaInvio()) {
            return { statusCode: 200, body: JSON.stringify({ done: false, throttled: "fuori_fascia", processed: 0 }) };
        }
        const sinceIso = new Date(Date.now() - FINESTRA_MINUTI * 60_000).toISOString();
        const { count: usati } = await sb.from("marketing_campaign_recipients")
            .select("id", { count: "exact", head: true })
            .eq("status", "sent")
            .gte("sent_at", sinceIso);
        if ((usati || 0) >= LIMITE_MESSAGGI_ORA) {
            return { statusCode: 200, body: JSON.stringify({ done: false, throttled: "limite", processed: 0, usati }) };
        }
        const { data, error: recsErr } = await sb.from("marketing_campaign_recipients")
            .select("id, customer_id, customer_name, phone, email")
            .eq("campaign_id", campaignId)
            .eq("status", "pending")
            .order("created_at", { ascending: true })
            .limit(CHUNK_SIZE);
        if (recsErr) {
            return { statusCode: 500, body: JSON.stringify({ error: `Errore lettura destinatari: ${recsErr.message}` }) };
        }
        recs = (data as Destinatario[] | null) || [];
    } else {
        const r = (prenota.data || {}) as { esito?: string; usati?: number; in_corso?: number; destinatario?: Destinatario };
        if (r.esito === "fuori_fascia" || r.esito === "limite") {
            return { statusCode: 200, body: JSON.stringify({ done: false, throttled: r.esito, processed: 0, usati: r.usati ?? null }) };
        }
        if (r.esito === "vuoto" && (r.in_corso || 0) > 0) {
            // Un altro giro sta ancora inviando a qualcuno: si chiude dopo.
            return { statusCode: 200, body: JSON.stringify({ done: false, throttled: "in_corso", processed: 0, remaining: 0 }) };
        }
        if (r.esito === "preso" && r.destinatario) recs = [r.destinatario];
        else if (r.esito !== "vuoto") {
            // Risposta inattesa: mai chiudere la campagna per sbaglio.
            return { statusCode: 500, body: JSON.stringify({ error: `Risposta coda invii inattesa: ${JSON.stringify(prenota.data)}` }) };
        }
    }

    if (recs.length === 0) {
        // 07/11/2026: la schermata crea la campagna e POI inserisce i
        // destinatari. Se il cron passa in mezzo non deve chiuderla vuota.
        const appenaCreata = camp.created_at && Date.now() - new Date(camp.created_at).getTime() < 10 * 60_000;
        if (appenaCreata) {
            const { count: totali } = await sb.from("marketing_campaign_recipients")
                .select("id", { count: "exact", head: true })
                .eq("campaign_id", campaignId);
            if ((totali || 0) === 0 && (camp.total_recipients || 0) > 0) {
                return { statusCode: 200, body: JSON.stringify({ done: false, throttled: "in_preparazione", processed: 0 }) };
            }
        }
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
    let istanzaNonDisponibile: string | null = null;
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
                .update({ status: "skipped", error_message: "no/invalid phone", ...(conPresa ? { claimed_at: null } : {}) })
                .eq("id", r.id);
            continue;
        }

        // Solo un rifiuto sul PRIMO invio garantisce che il cliente non abbia
        // ricevuto niente (dopo, le foto/video successivi = testo gia' arrivato).
        let primoPartito = false;
        try {
            // Nella lingua del prefisso del destinatario (+39 resta italiano).
            const personalized = await nellaLinguaDelTelefono(phone, message
                .replace(/{nome}/g, nome)
                .replace(/{cognome}/g, cognome));

            if (imageUrls.length === 0 && !videoUrl) {
                await greenApiSendMessage(phone, personalized);
            } else if (imageUrls.length > 0) {
                await greenApiSendFile(phone, imageUrls[0], fileNameFromUrl(imageUrls[0], "image.jpg"), personalized);
                primoPartito = true;
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
            primoPartito = true;

            chunkSent++;
            await sb.from("marketing_campaign_recipients")
                .update({ status: "sent", sent_at: new Date().toISOString() })
                .eq("id", r.id);
            await new Promise(res => setTimeout(res, PER_RECIPIENT_DELAY_MS));
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!primoPartito && err instanceof ErroreGreenApi && err.esito.tipo === "istanza_non_disponibile") {
                // Bot bloccato o non autorizzato: non e' partito niente. Il
                // destinatario torna in coda e il giro si ferma qui.
                istanzaNonDisponibile = msg;
                await sb.from("marketing_campaign_recipients")
                    .update({ status: "pending", error_message: msg, ...(conPresa ? { claimed_at: null } : {}) })
                    .eq("id", r.id);
                break;
            }
            chunkFailed++;
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
            ...(istanzaNonDisponibile ? { throttled: "istanza_non_disponibile", message: istanzaNonDisponibile } : {}),
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
