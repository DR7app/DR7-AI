/**
 * EMTN — GET /emtn-clients-with-damages
 *
 * Restituisce l'elenco aggregato di tutti i clienti DR7 che hanno
 * almeno un danno o una penale registrata in `bookings.booking_details`.
 *
 * Hard-learned:
 *   - La chiave dell'array penali nel JSON e\' `penalties` (inglese),
 *     NON `penali`. GestioneDanniTab usa `['penalties', 'danni']`.
 *   - bookings non ha ne\' customer_codice_fiscale ne\' customer_id;
 *     l'unico link al cliente e\' user_id (verso auth.users) e i
 *     campi denormalizzati customer_email / customer_name.
 *
 * Strategia di aggregazione:
 *   1. Tira tutte le bookings con booking_details non null.
 *   2. Filtra a quelle con danni[] o penalties[] non vuoti.
 *   3. Aggrega per "groupKey" = CF se risolto, altrimenti email,
 *      altrimenti name. Cosi\' nessun cliente con danni viene perso.
 *   4. Risolve il CF in parallelo via customers_extended.user_id e
 *      customers_extended.email + JSON booking_details. Quando il CF
 *      non si trova lo lasciamo null e l'UI disabilita il pulsante
 *      "Apri" per quella riga (l'operatore deve cercarlo a mano).
 */
import { Handler } from '@netlify/functions'
import { requireAuth } from './require-auth'
import { getServiceSupabase, jsonResponse } from './utils/emtn'

type DanniItem = {
    label?: string
    description?: string
    total?: number
    amount?: number
    amountPaid?: number
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
        penalties?: DanniItem[]
        codice_fiscale?: string
        codiceFiscale?: string
        customer?: { codice_fiscale?: string; codiceFiscale?: string }
    } | null
}

interface CustomerProfile {
    user_id: string | null
    email: string | null
    codice_fiscale: string | null
    nome: string | null
    cognome: string | null
}

interface Aggregated {
    codice_fiscale: string | null
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
    const ps = String(it.paymentStatus || '').toLowerCase()
    if (ps === 'paid') return true
    const total = itemTotal(it)
    const ap = num(it.amountPaid)
    return ap > 0 && ap >= total
}
function normCF(value: string | null | undefined): string | null {
    if (!value) return null
    const v = String(value).trim().toUpperCase()
    return v.length === 16 ? v : null
}
function normEmail(value: string | null | undefined): string | null {
    if (!value) return null
    const v = String(value).trim().toLowerCase()
    return v || null
}
function normName(value: string | null | undefined): string | null {
    if (!value) return null
    const v = String(value).trim().toLowerCase().replace(/\s+/g, ' ')
    return v || null
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
        const p = b.booking_details?.penalties || []
        return d.length > 0 || p.length > 0
    })

    // Batch resolution: per ogni booking interessante prepara una serie
    // di chiavi che possono aiutare a trovare il CF e i dati cliente.
    const userIds = Array.from(new Set(interesting.map(b => b.user_id).filter(Boolean) as string[]))
    const emails = Array.from(new Set(interesting.map(b => normEmail(b.customer_email)).filter(Boolean) as string[]))

    const profByUserId = new Map<string, CustomerProfile>()
    const profByEmail = new Map<string, CustomerProfile>()

    if (userIds.length > 0) {
        const { data: profs } = await sb
            .from('customers_extended')
            .select('user_id, email, codice_fiscale, nome, cognome')
            .in('user_id', userIds)
        for (const p of (profs || []) as CustomerProfile[]) {
            if (p.user_id) profByUserId.set(p.user_id, p)
            const e = normEmail(p.email)
            if (e && !profByEmail.has(e)) profByEmail.set(e, p)
        }
    }
    if (emails.length > 0) {
        const missing = emails.filter(e => !profByEmail.has(e))
        if (missing.length > 0) {
            const { data: profs } = await sb
                .from('customers_extended')
                .select('user_id, email, codice_fiscale, nome, cognome')
                .in('email', missing)
            for (const p of (profs || []) as CustomerProfile[]) {
                const e = normEmail(p.email)
                if (e) profByEmail.set(e, p)
                if (p.user_id && !profByUserId.has(p.user_id)) profByUserId.set(p.user_id, p)
            }
        }
    }

    const byGroup = new Map<string, Aggregated>()

    for (const b of interesting) {
        const danni = b.booking_details?.danni || []
        const penalties = b.booking_details?.penalties || []
        if (danni.length === 0 && penalties.length === 0) continue
        const ref = b.pickup_date || b.appointment_date || null

        const email = normEmail(b.customer_email)
        const profile =
            (b.user_id && profByUserId.get(b.user_id)) ||
            (email && profByEmail.get(email)) ||
            null
        const cf =
            normCF(profile?.codice_fiscale) ||
            normCF(b.booking_details?.codice_fiscale) ||
            normCF(b.booking_details?.codiceFiscale) ||
            normCF(b.booking_details?.customer?.codice_fiscale) ||
            normCF(b.booking_details?.customer?.codiceFiscale)
        const fullName = profile && (profile.nome || profile.cognome)
            ? [profile.nome, profile.cognome].filter(Boolean).join(' ')
            : (b.customer_name || null)

        // Group key: CF se risolto, altrimenti email, altrimenti name.
        const groupKey = cf || email || normName(fullName) || `__booking_${b.id}`

        const existing = byGroup.get(groupKey)
        const agg: Aggregated = existing || {
            codice_fiscale: cf,
            customer_name: fullName,
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
            byGroup.set(groupKey, agg)
        } else {
            if (!agg.codice_fiscale && cf) agg.codice_fiscale = cf
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
        for (const p of penalties) {
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

    const clients = Array.from(byGroup.values()).sort((a, b) => {
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
