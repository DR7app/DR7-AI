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
    // Forward-compat: questi campi non sono ancora scritti da
    // GestioneDanniTab ma se l'operatore registra il pagamento li
    // popoliamo li\' (TODO migration). Per ora derivati da fatture.
    paidAt?: string | null
    paidVia?: string | null
}

type FatturaItem = {
    description?: string
    label?: string
    unit_price?: number
    quantity?: number
    total?: number
    amount?: number
    amountPaid?: number
    paymentStatus?: string
    type?: string
}
type FatturaRow = {
    id: string
    booking_id: string | null
    stato: string | null
    data_emissione: string | null
    created_at: string | null
    items: FatturaItem[] | null
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

interface EventDetail {
    kind: 'danno' | 'penale'
    bookingId: string
    label: string
    vehicle: string | null
    eventDate: string | null   // quando e\' avvenuto il danno/la penale
    paidAt: string | null      // quando e\' stato saldato (da fattura.data_emissione o item.paidAt)
    daysToPay: number | null   // giorni tra eventDate e paidAt
    amount: number
    amountPaid: number
    remaining: number
    paymentStatus: 'paid' | 'partial' | 'pending'
    fatturaNumero: string | null
    note: string | null
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
    events: EventDetail[]
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
function classifyStatus(it: DanniItem): 'paid' | 'partial' | 'pending' {
    const ps = String(it.paymentStatus || '').toLowerCase()
    if (ps === 'paid') return 'paid'
    if (ps === 'partial') return 'partial'
    const total = itemTotal(it)
    const ap = num(it.amountPaid)
    if (ap > 0 && ap >= total) return 'paid'
    if (ap > 0 && ap < total) return 'partial'
    return 'pending'
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

    // Pull fatture relative alle bookings interessanti per derivare il
    // "paidAt": quando il danno e\' marcato pagato, generate-penalty-invoice
    // crea una fattura con stato='paid' e data_emissione=today. Quella e\'
    // la migliore proxy della data pagamento finche\' non aggiungiamo
    // booking_details.danni[].paidAt esplicito.
    const bookingIds = Array.from(new Set(interesting.map(b => b.id)))
    const fatturaByBookingItem = new Map<string, { paidAt: string; numero: string }>()
    if (bookingIds.length > 0) {
        const { data: fatture } = await sb
            .from('fatture')
            .select('id, booking_id, stato, data_emissione, created_at, items, numero_fattura')
            .in('booking_id', bookingIds)
        for (const f of (fatture || []) as (FatturaRow & { numero_fattura?: string })[]) {
            if (!f.booking_id) continue
            // Solo fatture saldate hanno una data pagamento utile.
            const isPaid = String(f.stato || '').toLowerCase() === 'paid'
            if (!isPaid) continue
            const paidAt = f.data_emissione || f.created_at || ''
            const numero = f.numero_fattura || ''
            const items = Array.isArray(f.items) ? f.items : []
            for (const it of items) {
                const labelKey = (it.description || it.label || '').trim().toLowerCase()
                if (!labelKey) continue
                const key = `${f.booking_id}::${labelKey}`
                if (!fatturaByBookingItem.has(key)) {
                    fatturaByBookingItem.set(key, { paidAt, numero })
                }
            }
        }
    }

    function lookupFattura(bookingId: string, label: string): { paidAt: string; numero: string } | null {
        const key = `${bookingId}::${label.trim().toLowerCase()}`
        return fatturaByBookingItem.get(key) || null
    }
    function daysBetween(a: string | null, b: string | null): number | null {
        if (!a || !b) return null
        const da = new Date(a).getTime()
        const db = new Date(b).getTime()
        if (!Number.isFinite(da) || !Number.isFinite(db)) return null
        return Math.max(0, Math.round((db - da) / 86_400_000))
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
            events: [],
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
        const veh = b.vehicle_name || b.vehicle_plate || null
        function buildEvent(kind: 'danno' | 'penale', it: DanniItem): EventDetail {
            const t = itemTotal(it)
            const ap = Math.min(num(it.amountPaid), t)
            const status = classifyStatus(it)
            const label = String(it.label || it.description || (kind === 'danno' ? 'Danno' : 'Penale'))
            const eventDate = it.date || ref || null
            // Data pagamento: forward-compat (item.paidAt scritto a mano in
            // futuro), poi lookup nella fattura saldata collegata.
            const fatt = lookupFattura(b.id, label)
            const paidAt = (status === 'paid' || status === 'partial')
                ? (it.paidAt || fatt?.paidAt || null)
                : null
            return {
                kind,
                bookingId: b.id,
                label,
                vehicle: veh,
                eventDate,
                paidAt,
                daysToPay: daysBetween(eventDate, paidAt),
                amount: t,
                amountPaid: ap,
                remaining: Math.max(0, t - ap),
                paymentStatus: status,
                fatturaNumero: fatt?.numero || null,
                note: it.note || null,
            }
        }

        for (const d of danni) {
            agg.damages_count += 1
            const ev = buildEvent('danno', d)
            if (ev.paymentStatus === 'paid') agg.paid_damage_total += ev.amount
            else {
                agg.paid_damage_total += ev.amountPaid
                agg.unpaid_damage_total += ev.remaining
            }
            if (ev.eventDate && (!agg.last_event_date || ev.eventDate > agg.last_event_date)) {
                agg.last_event_date = ev.eventDate
                agg.last_vehicle = veh
            }
            agg.events.push(ev)
        }
        for (const p of penalties) {
            agg.penalties_count += 1
            const ev = buildEvent('penale', p)
            if (ev.paymentStatus === 'paid') agg.paid_penalty_total += ev.amount
            else {
                agg.paid_penalty_total += ev.amountPaid
                agg.unpaid_penalty_total += ev.remaining
            }
            if (ev.eventDate && (!agg.last_event_date || ev.eventDate > agg.last_event_date)) {
                agg.last_event_date = ev.eventDate
                agg.last_vehicle = veh
            }
            agg.events.push(ev)
        }
    }

    // Sort eventi per data desc dentro ogni cliente, cosi\' la lista
    // espansa mostra prima i fatti piu\' recenti.
    for (const agg of byGroup.values()) {
        agg.events.sort((a, b) => {
            if (a.eventDate && b.eventDate) {
                if (a.eventDate < b.eventDate) return 1
                if (a.eventDate > b.eventDate) return -1
            } else if (a.eventDate) return -1
            else if (b.eventDate) return 1
            return 0
        })
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
