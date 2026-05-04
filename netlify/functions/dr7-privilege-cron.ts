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

// HARD KILL SWITCH — set to true to re-enable the cron.
// Disabilitato dopo invio massivo non voluto. NON RIATTIVARE senza
// prima verificare che backfill di vecchi pagamenti non parta di colpo.
const DR7_PRIVILEGE_ENABLED = false;

export const handler: Handler = async () => {
    if (!DR7_PRIVILEGE_ENABLED) {
        return { statusCode: 200, body: JSON.stringify({ disabled: true, reason: "DR7_PRIVILEGE_ENABLED=false" }) };
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: "Supabase non configurato" }) };
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    // Pick eligible CAR WASH bookings: paid, no privilege yet.
    // 30-day window keeps the scan small + avoids spamming old rows.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: bookings, error: bErr } = await sb
        .from("bookings")
        .select(
            "id, customer_name, customer_phone, customer_email, vehicle_plate, service_type, payment_status, status, booking_details, dr7_privilege_sent_at, created_at"
        )
        .eq("service_type", "car_wash")
        .in("payment_status", PAID_STATUSES)
        .is("dr7_privilege_sent_at", null)
        .gte("created_at", since)
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
