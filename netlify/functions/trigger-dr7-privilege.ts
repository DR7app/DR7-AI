import { Handler } from "@netlify/functions"
import { createClient } from "@supabase/supabase-js"
import { sendDr7Privilege, PrivilegeKind } from "./utils/dr7Privilege"

/**
 * Event-driven trigger per il codice DR7 Privilege.
 * Viene invocato dal frontend admin appena un car_wash viene marcato
 * come pagato (qualunque metodo: Credit Wallet, Contanti, POS, Bonifico,
 * ecc.) o dopo la firma del contratto noleggio.
 *
 * Idempotente: sendDr7Privilege controlla dr7_privilege_sent_at, quindi
 * un doppio invio non e' possibile.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ""
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""

export const handler: Handler = async (event) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Content-Type": "application/json",
    }

    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" }
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) }
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Supabase non configurato" }) }
    }

    let body: { bookingId?: string; kind?: PrivilegeKind } = {}
    try { body = JSON.parse(event.body || "{}") } catch { /* ignore */ }
    const bookingId = body.bookingId
    const kind: PrivilegeKind = body.kind === "noleggio" ? "noleggio" : "lavaggio"

    if (!bookingId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "bookingId obbligatorio" }) }
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: booking, error: bErr } = await sb
        .from("bookings")
        .select("id, customer_name, customer_phone, customer_email, vehicle_plate, service_type, payment_status, status, booking_details, dr7_privilege_sent_at, created_at")
        .eq("id", bookingId)
        .maybeSingle()

    if (bErr || !booking) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "Booking non trovato" }) }
    }

    // Sanity: solo booking pagati ricevono il codice
    const PAID_STATUSES = ["paid", "completed", "succeeded"]
    if (!PAID_STATUSES.includes(booking.payment_status || "")) {
        return { statusCode: 200, headers, body: JSON.stringify({ sent: false, skipped: "not_paid" }) }
    }

    // Per lavaggio richiediamo service_type = car_wash
    if (kind === "lavaggio" && booking.service_type !== "car_wash") {
        return { statusCode: 200, headers, body: JSON.stringify({ sent: false, skipped: "not_carwash" }) }
    }

    // Per noleggio richiediamo che il contratto sia stato firmato. Cosi' questa
    // funzione e' usabile come fallback/lookup: la chiami quando vuoi (signature-
    // complete, ContrattoTab, ReservationsTab refresh, ecc.) e fa partire il
    // codice solo se il cliente ha effettivamente firmato. Idempotente via
    // dr7_privilege_sent_at — non c'e' rischio di doppio invio.
    if (kind === "noleggio") {
        const { data: contract } = await sb
            .from("contracts")
            .select("id, signed_pdf_url")
            .eq("booking_id", bookingId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        if (!contract?.signed_pdf_url) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ sent: false, skipped: "contract_not_signed" }),
            }
        }
    }

    const result = await sendDr7Privilege(sb, booking, kind)
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result),
    }
}
