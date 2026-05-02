import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

// Sends "Richiesta prolungamento SUPERCAR" the day before drop-off, at 18:00 Rome,
// for rentals that:
//   - are on a vehicle with category = 'exotic' (= supercar)
//   - have a duration of at least 3 days (dropoff - pickup >= 72h)
//   - have status confirmed/active/in_corso
//   - have not been sent the reminder yet (extension_reminder_sent_at IS NULL)
//
// The message body, header, and footer are loaded from system_messages on every
// run, so any edit the operator makes in Messaggi di Sistema Pro takes effect on
// the next 18:00 send. Nothing about the message text is hardcoded here.
//
// Scheduled at 16:00 and 17:00 UTC to cover 18:00 Rome in both CEST (summer) and
// CET (winter); the function gates inside on Rome local hour == 18 and the
// per-booking dedupe column makes double-fires safe.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN

const TEMPLATE_LABEL = 'Richiesta prolungamento SUPERCAR'
const SUPERCAR_CATEGORY = 'exotic'
const MIN_DURATION_HOURS = 72

function romeHour(d: Date = new Date()): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Rome',
        hour: '2-digit',
        hour12: false,
    }).formatToParts(d)
    const h = parts.find(p => p.type === 'hour')?.value
    return h ? parseInt(h, 10) : -1
}

// Returns true if `d` falls on the calendar day AFTER today, in Rome time.
function isTomorrowRome(d: Date, now: Date = new Date()): boolean {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
    const today = fmt.format(now)
    const tomorrow = fmt.format(new Date(now.getTime() + 24 * 60 * 60 * 1000))
    const target = fmt.format(d)
    return target === tomorrow && target !== today
}

function normalizePhone(raw: string | null | undefined): string {
    if (!raw) return ''
    let phone = raw.replace(/[\s\-+()]/g, '')
    if (phone.startsWith('00')) phone = phone.substring(2)
    if (phone.length === 10) phone = '39' + phone
    return phone
}

async function greenApiSendMessage(phone: string, message: string): Promise<void> {
    const url = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: `${phone}@c.us`, message }),
    })
    const result = await res.json().catch(() => ({}))
    if (!res.ok || result.error) throw new Error(result.error || `Green API ${res.status}`)
}

export const handler: Handler = async () => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Supabase non configurato' }) }
    }
    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Green API non configurato' }) }
    }

    // Only execute the run at 18:00 Rome local time. The schedule fires at
    // both 16 UTC and 17 UTC so we'd be triggered twice a day — gate to one.
    const hour = romeHour()
    if (hour !== 18) {
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: `Rome hour ${hour} != 18` }) }
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

    // 1. Load template (body + wrapper flags) from system_messages by LABEL.
    //    Custom templates created in admin get auto-generated message_keys, so the
    //    label is the contract.
    const { data: tpl, error: tplErr } = await sb
        .from('system_messages')
        .select('message_body, include_header, is_enabled')
        .eq('label', TEMPLATE_LABEL)
        .maybeSingle()

    if (tplErr) {
        return { statusCode: 500, body: JSON.stringify({ error: `Template lookup failed: ${tplErr.message}` }) }
    }
    if (!tpl) {
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: `template "${TEMPLATE_LABEL}" not found` }) }
    }
    if (tpl.is_enabled === false) {
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'template disabled' }) }
    }

    // 2. Wrap with header/footer if include_header is on.
    let header = ''
    let footer = ''
    if (tpl.include_header === true) {
        const { data: wrappers } = await sb
            .from('system_messages')
            .select('message_key, message_body, is_enabled')
            .in('message_key', ['pro_wrapper_header', 'pro_wrapper_footer'])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const h = wrappers?.find((w: any) => w.message_key === 'pro_wrapper_header' && w.is_enabled !== false)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const f = wrappers?.find((w: any) => w.message_key === 'pro_wrapper_footer' && w.is_enabled !== false)
        header = h?.message_body || ''
        footer = f?.message_body || ''
    }

    // 3. Find candidate rentals: dropoff tomorrow, exotic vehicle, duration ≥ 3d,
    //    active status, reminder not yet sent.
    const now = new Date()
    const tomorrowStart = new Date(now.getTime() + 12 * 60 * 60 * 1000) // 12h ahead
    const tomorrowEnd = new Date(now.getTime() + 36 * 60 * 60 * 1000)   // 36h ahead

    const { data: rentals, error: bErr } = await sb
        .from('bookings')
        .select('id, customer_name, customer_phone, customer_email, vehicle_id, vehicle_plate, vehicle_name, pickup_date, dropoff_date, status, service_type, booking_details, vehicles(category)')
        .gte('dropoff_date', tomorrowStart.toISOString())
        .lte('dropoff_date', tomorrowEnd.toISOString())
        .in('status', ['confirmed', 'confermata', 'active', 'in_corso'])
        .is('extension_reminder_sent_at', null)
        .not('vehicle_plate', 'in', '("TEST000","TEST002")')

    if (bErr) {
        return { statusCode: 500, body: JSON.stringify({ error: `Bookings query failed: ${bErr.message}` }) }
    }

    let sent = 0
    let skipped = 0
    let failed = 0
    const errors: string[] = []

    for (const b of rentals || []) {
        // Skip non-rental services
        const st = (b.service_type || '').toLowerCase()
        if (st === 'car_wash' || st === 'mechanical' || st === 'mechanical_service') {
            skipped++
            continue
        }

        // Skip if not exotic. The join column shape depends on the FK config; tolerate both.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const vehiclesField: any = (b as any).vehicles
        const category = Array.isArray(vehiclesField)
            ? vehiclesField[0]?.category
            : vehiclesField?.category
        if (category !== SUPERCAR_CATEGORY) {
            skipped++
            continue
        }

        // Verify drop-off is actually tomorrow in Rome time (extra safety vs the UTC range above)
        if (!isTomorrowRome(new Date(b.dropoff_date), now)) {
            skipped++
            continue
        }

        // Duration ≥ 72h
        const pickup = new Date(b.pickup_date).getTime()
        const dropoff = new Date(b.dropoff_date).getTime()
        const durHours = (dropoff - pickup) / (1000 * 60 * 60)
        if (durHours < MIN_DURATION_HOURS) {
            skipped++
            continue
        }

        // Phone
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detailsPhone = (b.booking_details as any)?.customer?.phone
        const phone = normalizePhone(b.customer_phone || detailsPhone || '')
        if (!phone || phone.length < 10) {
            failed++
            errors.push(`${b.customer_name || b.id}: phone missing/invalid`)
            continue
        }

        // Build the final body. The template uses no placeholders today; if the
        // operator adds {nome}/{customer_name}/{vehicle_name}/{plate}/{dropoff_date}
        // later, they'll be substituted. No hardcoded fallback if a placeholder
        // doesn't resolve — leave it empty to make missing data obvious.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detailsCustomer = (b.booking_details as any)?.customer || {}
        const customerName = b.customer_name || detailsCustomer.fullName || ''
        const vars: Record<string, string> = {
            nome: customerName.split(' ')[0] || '',
            cognome: customerName.split(' ').slice(1).join(' ') || '',
            customer_name: customerName,
            vehicle_name: b.vehicle_name || '',
            plate: b.vehicle_plate || '',
            targa: b.vehicle_plate || '',
            pickup_date: b.pickup_date || '',
            dropoff_date: b.dropoff_date || '',
        }

        let body = tpl.message_body as string
        for (const [k, v] of Object.entries(vars)) {
            body = body.replace(new RegExp(`\\{${k}\\}`, 'g'), v)
        }

        const finalMessage = [header, body, footer].filter(Boolean).join('\n\n')

        try {
            await greenApiSendMessage(phone, finalMessage)
            await sb.from('bookings').update({ extension_reminder_sent_at: new Date().toISOString() }).eq('id', b.id)
            sent++
            // Polite spacing — well under WhatsApp's spam threshold for legitimate alerts
            await new Promise(r => setTimeout(r, 1500))
        } catch (err: unknown) {
            failed++
            const msg = err instanceof Error ? err.message : String(err)
            errors.push(`${b.customer_name || b.id}: ${msg}`)
        }
    }

    return {
        statusCode: 200,
        body: JSON.stringify({
            success: true,
            template: TEMPLATE_LABEL,
            sent,
            skipped,
            failed,
            errors: errors.length > 0 ? errors : undefined,
        }),
    }
}
