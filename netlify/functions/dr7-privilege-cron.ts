import { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { sendDr7Privilege } from "./utils/dr7Privilege";

// Polls car_wash bookings paid but not yet rewarded with a DR7 Privilege code.
// Noleggio is handled separately in signature-complete.ts (after firma).
// Lavaggio doesn't have a single "completion" event we can hook into reliably
// (multiple payment paths: Nexi callback, manual segna-pagato, wallet RPC),
// so a cron is the safest catch-all.
//
// Schedule via netlify.toml: every 5 minutes.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const PAID_STATUSES = ["paid", "completed", "succeeded"];

// HARD KILL SWITCH — disabilitato di default per evitare invii massivi.
// Per riattivare il batch run servono ENTRAMBI:
//   1. flippare DR7_PRIVILEGE_ENABLED = true qui sotto
//   2. settare DR7_PRIVILEGE_BATCH_ALLOWED=true come env Netlify
// La doppia condizione e' deliberata: il flusso normale e' event-driven
// (CarWashBookingsTab / UnpaidBookingsTab / nexi-payment-callback chiamano
// sendDr7Privilege direttamente). Questo cron e' SOLO un catch-all manuale.
const DR7_PRIVILEGE_ENABLED = false;

const ACTIVATION_DATE = "2026-05-04T00:00:00Z";

export const handler: Handler = async () => {
    if (!DR7_PRIVILEGE_ENABLED) {
        return { statusCode: 200, body: JSON.stringify({ disabled: true, reason: "DR7_PRIVILEGE_ENABLED=false" }) };
    }
    // Second gate: env var must be explicitly set. Belt + suspenders against
    // accidental re-runs (the batch on 2026-05-04 sent 39 messages by mistake).
    if (process.env.DR7_PRIVILEGE_BATCH_ALLOWED !== "true") {
        return { statusCode: 200, body: JSON.stringify({ disabled: true, reason: "DR7_PRIVILEGE_BATCH_ALLOWED env not set" }) };
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: "Supabase non configurato" }) };
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    // Pick eligible CAR WASH bookings:
    //  - paid
    //  - created_at >= ACTIVATION_DATE per non backfillare i pagamenti
    //    storici quando si riattiva il cron
    //  - dr7_privilege_sent_at NULL (idempotenza — invio una volta sola)
    // Trigger: appena il lavaggio risulta pagato (anche prima dell'appuntamento),
    // come richiesto dal flusso "DR7 Privilege — Post-Pagamento Lavaggio".
    const { data: bookings, error: bErr } = await sb
        .from("bookings")
        .select(
            "id, customer_name, customer_phone, customer_email, vehicle_plate, service_type, payment_status, status, booking_details, dr7_privilege_sent_at, created_at"
        )
        .eq("service_type", "car_wash")
        .in("payment_status", PAID_STATUSES)
        .is("dr7_privilege_sent_at", null)
        .gte("created_at", ACTIVATION_DATE)
        .neq("customer_name", "Lavaggio Rientro")
        .limit(50);

    if (bErr) {
        return { statusCode: 500, body: JSON.stringify({ error: `Bookings query failed: ${bErr.message}` }) };
    }
    if (!bookings || bookings.length === 0) {
        return { statusCode: 200, body: JSON.stringify({ processed: 0, message: "no eligible bookings" }) };
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const b of bookings) {
        const result = await sendDr7Privilege(sb, b, "lavaggio");
        if (result.sent) {
            sent++;
            // Polite delay between WhatsApp sends
            await new Promise(r => setTimeout(r, 1500));
        } else if (result.skipped) {
            skipped++;
        } else if (result.error) {
            failed++;
            errors.push(`${b.id.slice(0, 8)}: ${result.error}`);
        }
    }

    return {
        statusCode: 200,
        body: JSON.stringify({
            processed: bookings.length,
            sent,
            skipped,
            failed,
            errors: errors.length > 0 ? errors : undefined,
        }),
    };
};
