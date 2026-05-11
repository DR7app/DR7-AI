/**
 * EMTN — GET /emtn-clients-with-damages
 *
 * Restituisce l'elenco aggregato di tutti i clienti DR7 che hanno
 * almeno un danno o una penale registrata in `bookings.booking_details`
 * (arrays danni / penali). Serve come lista d'ingresso nella EMTN tab:
 * l'operatore vede subito i clienti a rischio senza dover cercare a
 * mano CF per CF.
 *
 * Schema relazione: bookings non contiene il CF direttamente, lo
 * cerchiamo in customers_extended via bookings.user_id (fallback su
 * customers_extended.id quando user_id e\' nullo) come fa
 * auto-verify-document.ts. Bookings senza nessun match e senza CF nel
 * booking_details vengono saltate: senza CF non possiamo aprire la
 * lookup EMTN.
 *
 * Per cliente aggreghiamo: nome, CF, totali pagati/non pagati danni e
 * penali, conteggio eventi, data ultimo evento, veicolo. Ordinamento
 * per data desc, tiebreak su totale non pagato desc.
 */
import { Handler } from '@netlify/functions'
import { requireAuth } from './require-auth'
import { getServiceSupabase, jsonResponse } from './utils/emtn'

type DanniItem = {
    label?: string
    total?: number
    amount?: number
    quantity?: number
    paymentStatus?: string
    date?: string
    note?: string
}

interface BookingRow {
    id: string
    pickup_date: string | null
    appointment_date: string | null
    user_id: string | null
    customer_name: string | null
    customer_email: string | null
    customer_phone: string | null
    vehicle_name: string | null
    vehicle_plate: string | null
    booking_details: {
        danni?: DanniItem[]
        penali?: DanniItem[]
        codice_fiscale?: string
        codiceFiscale?: string
        customer?: { codice_fiscale?: string; codiceFiscale?: string }
    } | null
}

interface CustomerProfile {
    id: string
    user_id: string | null
    codice_fiscale: string | null
    nome: string | null
    cognome: string | null
}

interface Aggregated {
    codice_fiscale: string
    customer_name: string | null
    customer_email: string | null
    customer_phone: string | null
    damages_count: number
    penalties_count: number
    paid_damage_total: number
    unpaid_damage_total: number
    paid_penalty_total: number
    unpaid_penalty_total: number
    last_event_date: string | null
    last_vehicle: string | null
    bookings_with_events: number
}

function num(v: unknown): number {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
}
function itemTotal(it: DanniItem): number {
    if (typeof it.total === 'number') return num(it.total)
    return num(it.amount) * (num(it.quantity) || 1)
}
function isPaid(it: DanniItem): boolean {
    return String(it.paymentStatus || '').toLowerCase() === 'paid'
}
function normCF(value: string | null | undefined): string | null {
    if (!value) return null
    const v = String(value).trim().toUpperCase()
    return v.length === 16 ? v : null
}

export const handler: Handler = async (event) => {
    const origin = event.headers.origin || event.headers.Origin
    if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {}, origin)
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
        return jsonResponse(405, { error: 'Method not allowed' }, origin)
    }

    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    const sb = getServiceSupabase()

    // Step 1 — pull bookings con booking_details non null (lato JS poi
    // filtriamo per danni/penali non vuoti). L'unica colonna che lega
    // bookings al cliente e\' user_id; il CF vive su customers_extended.
    const { data, error } = await sb
        .from('bookings')
        .select('id, pickup_date, appointment_date, user_id, customer_name, customer_email, customer_phone, vehicle_name, vehicle_plate, booking_details')
        .not('booking_details', 'is', null)
        .order('pickup_date', { ascending: false })
        .limit(2000)

    if (error) return jsonResponse(500, { error: error.message }, origin)

    const rows = (data || []) as BookingRow[]
    const interesting = rows.filter(b => {
        const d = b.booking_details?.danni || []
        const p = b.booking_details?.penali || []
        return d.length > 0 || p.length > 0
    })

    // Step 2 — batch fetch dei profili customers_extended via user_id
    // per risolvere il CF.
    const userIds = Array.from(new Set(interesting.map(b => b.user_id).filter(Boolean) as string[]))
    const cfByUserId = new Map<string, CustomerProfile>()

    if (userIds.length > 0) {
        const { data: profsByUid } = await sb
            .from('customers_extended')
            .select('id, user_id, codice_fiscale, nome, cognome')
            .in('user_id', userIds)
        for (const p of (profsByUid || []) as CustomerProfile[]) {
            if (p.user_id) cfByUserId.set(p.user_id, p)
        }
    }

    const byCf = new Map<string, Aggregated>()

    for (const b of interesting) {
        // Risoluzione CF, in ordine di affidabilita\':
        //  1. customers_extended.codice_fiscale via user_id
        //  2. booking_details.codice_fiscale / codiceFiscale (inserito a mano
        //     da admin prima che il cliente avesse un account)
        //  3. booking_details.customer.codice_fiscale
        const profile = (b.user_id && cfByUserId.get(b.user_id)) || null
        const cf =
            normCF(profile?.codice_fiscale) ||
            normCF(b.booking_details?.codice_fiscale) ||
            normCF(b.booking_details?.codiceFiscale) ||
            normCF(b.booking_details?.customer?.codice_fiscale) ||
            normCF(b.booking_details?.customer?.codiceFiscale)
        if (!cf) continue

        const danni = b.booking_details?.danni || []
        const penali = b.booking_details?.penali || []
        const ref = b.pickup_date || b.appointment_date || null

        const existing = byCf.get(cf)
        const fullName = profile && (profile.nome || profile.cognome)
            ? [profile.nome, profile.cognome].filter(Boolean).join(' ')
            : b.customer_name
        const agg: Aggregated = existing || {
            codice_fiscale: cf,
            customer_name: fullName || null,
            customer_email: b.customer_email,
            customer_phone: b.customer_phone,
            damages_count: 0,
            penalties_count: 0,
            paid_damage_total: 0,
            unpaid_damage_total: 0,
            paid_penalty_total: 0,
            unpaid_penalty_total: 0,
            last_event_date: null,
            last_vehicle: null,
            bookings_with_events: 0,
        }
        if (!existing) {
            byCf.set(cf, agg)
        } else {
            if (!agg.customer_name && fullName) agg.customer_name = fullName
            if (!agg.customer_email && b.customer_email) agg.customer_email = b.customer_email
            if (!agg.customer_phone && b.customer_phone) agg.customer_phone = b.customer_phone
        }

        agg.bookings_with_events += 1
        for (const d of danni) {
            agg.damages_count += 1
            const t = itemTotal(d)
            if (isPaid(d)) agg.paid_damage_total += t
            else agg.unpaid_damage_total += t
            const dDate = d.date || ref
            if (dDate && (!agg.last_event_date || dDate > agg.last_event_date)) {
                agg.last_event_date = dDate
                agg.last_vehicle = b.vehicle_name || b.vehicle_plate
            }
        }
        for (const p of penali) {
            agg.penalties_count += 1
            const t = itemTotal(p)
            if (isPaid(p)) agg.paid_penalty_total += t
            else agg.unpaid_penalty_total += t
            const pDate = p.date || ref
            if (pDate && (!agg.last_event_date || pDate > agg.last_event_date)) {
                agg.last_event_date = pDate
                agg.last_vehicle = b.vehicle_name || b.vehicle_plate
            }
        }
    }

    const clients = Array.from(byCf.values()).sort((a, b) => {
        if (a.last_event_date && b.last_event_date) {
            if (a.last_event_date < b.last_event_date) return 1
            if (a.last_event_date > b.last_event_date) return -1
        } else if (a.last_event_date) return -1
        else if (b.last_event_date) return 1
        const aUnpaid = a.unpaid_damage_total + a.unpaid_penalty_total
        const bUnpaid = b.unpaid_damage_total + b.unpaid_penalty_total
        return bUnpaid - aUnpaid
    })

    return jsonResponse(200, {
        count: clients.length,
        totalUnpaid: clients.reduce((s, c) => s + c.unpaid_damage_total + c.unpaid_penalty_total, 0),
        clients,
    }, origin)
}
