// Shared helper: generate + send DR7 Privilege code (10% sconto, 15gg).
//   - Noleggio: chiamato da signature-complete.ts dopo firma contratto
//   - Lavaggio: chiamato da dr7-privilege-cron.ts dopo payment_status=paid
//
// Idempotent on bookings.dr7_privilege_sent_at — never sends twice.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN

// Avoid I/O/0/1 to keep codes readable when typed by hand
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export type PrivilegeKind = "noleggio" | "lavaggio"

interface BookingLike {
    id: string
    customer_name?: string | null
    customer_phone?: string | null
    customer_email?: string | null
    vehicle_name?: string | null
    vehicle_plate?: string | null
    pickup_date?: string | null
    dropoff_date?: string | null
    pickup_location?: string | null
    dropoff_location?: string | null
    payment_method?: string | null
    payment_status?: string | null
    price_total?: number | null
    booking_details?: Record<string, unknown> | null
    dr7_privilege_sent_at?: string | null
}

interface PrivilegeResult {
    sent: boolean
    skipped?: string
    code?: string
    error?: string
}

function generateCode(): string {
    let s = "DR7-PRIVILEGE-"
    for (let i = 0; i < 4; i++) {
        s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    }
    return s
}

function normalizePhone(raw: string | null | undefined): string {
    if (!raw) return ""
    let phone = raw.replace(/[\s\-+()]/g, "")
    if (phone.startsWith("00")) phone = phone.substring(2)
    if (phone.length === 10) phone = "39" + phone
    return phone
}

async function sendGreenApi(phone: string, message: string): Promise<void> {
    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
        throw new Error("Green API not configured")
    }
    const url = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: `${phone}@c.us`, message }),
    })
    const result = await res.json().catch(() => ({}))
    if (!res.ok || result.error) throw new Error(result.error || `Green API ${res.status}`)
}

/**
 * Generate + send a DR7 Privilege code for a single booking. Idempotent: if
 * dr7_privilege_sent_at is already set, returns skipped without doing anything.
 *
 * Caller must have already loaded the booking row from supabase.
 */
export async function sendDr7Privilege(
    sb: SupabaseClient,
    booking: BookingLike,
    kind: PrivilegeKind,
): Promise<PrivilegeResult> {
    const tag = `[dr7Privilege ${kind} booking=${(booking.id || '').slice(0, 8)}]`
    if (booking.dr7_privilege_sent_at) {
        console.log(`${tag} skip: already_sent`)
        return { sent: false, skipped: "already_sent" }
    }

    // Skip "Lavaggio Rientro" pseudo-bookings (DB trigger crea queste righe
    // fittizie per tracciare il rientro veicolo, non il cliente).
    if ((booking.customer_name || "").toLowerCase() === "lavaggio rientro") {
        console.log(`${tag} skip: lavaggio_rientro`)
        return { sent: false, skipped: "lavaggio_rientro" }
    }

    // Phone
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detailsPhone = (booking.booking_details as any)?.customer?.phone
    const phone = normalizePhone(booking.customer_phone || detailsPhone)
    if (!phone || phone.length < 10) {
        console.log(`${tag} error: invalid_phone raw=${booking.customer_phone || detailsPhone}`)
        return { sent: false, error: "invalid_phone" }
    }

    // Load template (operator-editable in Messaggi di Sistema Pro)
    const tplKey = kind === "noleggio" ? "pro_dr7_privilege_noleggio" : "pro_dr7_privilege_lavaggio"
    const { data: tpl } = await sb
        .from("system_messages")
        .select("message_body, is_enabled, include_header")
        .eq("message_key", tplKey)
        .maybeSingle()
    if (!tpl || tpl.is_enabled === false || !tpl.message_body) {
        return { sent: false, skipped: "template_missing_or_disabled" }
    }

    // Optional wrapper header/footer
    let header = ""
    let footer = ""
    if (tpl.include_header === true) {
        const { data: wrappers } = await sb
            .from("system_messages")
            .select("message_key, message_body, is_enabled")
            .in("message_key", ["pro_wrapper_header", "pro_wrapper_footer"])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const h = (wrappers || []).find((w: any) => w.message_key === "pro_wrapper_header" && w.is_enabled !== false)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const f = (wrappers || []).find((w: any) => w.message_key === "pro_wrapper_footer" && w.is_enabled !== false)
        header = h?.message_body || ""
        footer = f?.message_body || ""
    }

    // Generate unique code (retry up to 5 times on collision)
    let code = ""
    for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateCode()
        const { data: existing } = await sb
            .from("discount_codes")
            .select("id")
            .eq("code", candidate)
            .maybeSingle()
        if (!existing) {
            code = candidate
            break
        }
    }
    if (!code) return { sent: false, error: "code_collision" }

    // Insert into discount_codes
    const validFrom = new Date()
    const validUntil = new Date(validFrom.getTime() + 15 * 24 * 60 * 60 * 1000)
    // 10% sconto valido su qualsiasi servizio (noleggio + lavaggio + altro)
    const scope = ["tutti"]
    const { error: insErr } = await sb.from("discount_codes").insert({
        code,
        code_type: "codice_sconto",
        scope,
        value_type: "percentage",
        value_amount: 10,
        valid_from: validFrom.toISOString(),
        valid_until: validUntil.toISOString(),
        single_use: true,
        message: `DR7 Privilege — sconto 10% su prossimo ${kind}`,
        status: "active",
    })
    if (insErr) return { sent: false, error: `insert_code_failed: ${insErr.message}` }

    // Build message body with placeholder substitutions.
    // 2026-05-19: prima sostituivamo SOLO {nome} / {customer_name} / {codice_*}.
    // Se l'admin in Messaggi di Sistema Pro aggiungeva altri placeholder
    // standard (es. {booking_id}, {vehicle_name}, {pickup_date}, ecc.) al
    // template DR7 Privilege, restavano letterali nel WhatsApp inviato — il
    // cliente vedeva "Veicolo: {vehicle_name} Ritiro: {pickup_date}". Adesso
    // mirroring del set base di send-whatsapp-notification.ts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detailsCustomer = (booking.booking_details as any)?.customer || {}
    const fullName = booking.customer_name || detailsCustomer.fullName || "Cliente"
    const nome = fullName.split(" ")[0] || "Cliente"
    const placeholderKey = kind === "noleggio" ? "codice_supercar" : "codice_lavaggio"
    const bookingIdShort = (booking.id || "").substring(0, 8).toUpperCase()
    const fmtDate = (iso: string | null | undefined): { date: string; time: string } => {
        if (!iso) return { date: "", time: "" }
        const d = new Date(iso)
        if (isNaN(d.getTime())) return { date: "", time: "" }
        return {
            date: d.toLocaleDateString("it-IT", { timeZone: "Europe/Rome" }),
            time: d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Rome" }),
        }
    }
    const pickup = fmtDate(booking.pickup_date)
    const dropoff = fmtDate(booking.dropoff_date)
    const totalEur = typeof booking.price_total === "number"
        ? (booking.price_total / 100).toFixed(2)
        : ""
    const paymentStatusLabel = (() => {
        const ps = booking.payment_status
        if (ps === "paid" || ps === "succeeded" || ps === "completed") return "Pagato"
        if (ps === "pending" || ps === "unpaid") return "Da saldare"
        return ps || ""
    })()
    const vars: Record<string, string> = {
        nome,
        customer_name: fullName,
        cliente: fullName,
        booking_id: bookingIdShort,
        booking_ref: bookingIdShort,
        vehicle_name: booking.vehicle_name || "",
        plate: booking.vehicle_plate || "",
        targa: booking.vehicle_plate || "",
        pickup_date: pickup.date,
        pickup_time: pickup.time,
        dropoff_date: dropoff.date,
        dropoff_time: dropoff.time,
        pickup_location: booking.pickup_location || "",
        dropoff_location: booking.dropoff_location || booking.pickup_location || "",
        total: totalEur,
        totale: totalEur,
        importo: totalEur,
        payment_method: booking.payment_method || "",
        pagamento: paymentStatusLabel,
        payment_status: paymentStatusLabel,
        customer_email: booking.customer_email || "",
        customer_phone: booking.customer_phone || "",
        [placeholderKey]: code,
    }
    let body = tpl.message_body as string
    for (const [k, v] of Object.entries(vars)) {
        body = body.replace(new RegExp(`\\{\\s*${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}`, "g"), v || "")
    }

    const finalMessage = (header || footer)
        ? [header, body, footer].filter(Boolean).join("\n\n")
        : body

    try {
        await sendGreenApi(phone, finalMessage)
        await sb
            .from("bookings")
            .update({
                dr7_privilege_sent_at: new Date().toISOString(),
                dr7_privilege_code: code,
            })
            .eq("id", booking.id)
        return { sent: true, code }
    } catch (err: unknown) {
        // Send failed: deactivate the unused code so it's not floating around.
        // Leave dr7_privilege_sent_at NULL for retry on next trigger / cron.
        await sb.from("discount_codes").update({ status: "deactivated" }).eq("code", code)
        const msg = err instanceof Error ? err.message : String(err)
        return { sent: false, error: `send_failed: ${msg}` }
    }
}
