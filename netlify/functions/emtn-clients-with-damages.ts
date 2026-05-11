/**
 * EMTN — GET /emtn-clients-with-damages
 *
 * Restituisce l'elenco aggregato di tutti i clienti DR7 che hanno
 * almeno un danno o una penale registrata in `bookings.booking_details`
 * (danni / penali arrays). Serve come lista d'ingresso nella EMTN tab:
 * l'operatore vede subito i clienti a rischio senza dover cercare a
 * mano CF per CF.
 *
 * Fonte: solo record DR7 interni. Nessun dato della rete EMTN viene
 * mostrato qui: la lookup EMTN resta gated dalla regola "no CF, no
 * search" del flusso /emtn-search.
 *
 * Per cliente aggreghiamo: nome, CF, totali pagati/non pagati danni e
 * penali, conteggio eventi, data dell'ultimo evento. Ordinamento per
 * data decrescente cosi\' i casi recenti emergono in cima.
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
    customer_name: string | null
    customer_codice_fiscale: string | null
    customer_email: string | null
    customer_phone: string | null
    vehicle_name: string | null
    vehicle_plate: string | null
    booking_details: { danni?: DanniItem[]; penali?: DanniItem[] } | null
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

export const handler: Handler = async (event) => {
    const origin = event.headers.origin || event.headers.Origin
    if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {}, origin)
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
        return jsonResponse(405, { error: 'Method not allowed' }, origin)
    }

    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    const sb = getServiceSupabase()

    // Tira tutte le bookings con almeno un elemento in danni o penali.
    // Filtro lato Postgres: booking_details non null, e l'array danni/penali
    // ha lunghezza > 0 (verifichiamo lato JS perche\' il filtro JSONB per
    // array-non-vuoto via supabase-js e\' meno espressivo che lato server).
    const { data, error } = await sb
        .from('bookings')
        .select('id, pickup_date, appointment_date, customer_name, customer_codice_fiscale, customer_email, customer_phone, vehicle_name, vehicle_plate, booking_details')
        .not('booking_details', 'is', null)
        .order('pickup_date', { ascending: false })
        .limit(2000)

    if (error) {
        return jsonResponse(500, { error: error.message }, origin)
    }

    const rows = (data || []) as BookingRow[]
    const byCf = new Map<string, Aggregated>()

    for (const b of rows) {
        const danni = b.booking_details?.danni || []
        const penali = b.booking_details?.penali || []
        if (danni.length === 0 && penali.length === 0) continue
        // Hard rule EMTN: senza CF non possiamo aggregare in modo affidabile,
        // quindi le bookings senza customer_codice_fiscale vengono saltate.
        const cf = (b.customer_codice_fiscale || '').trim().toUpperCase()
        if (!cf) continue

        const ref = b.pickup_date || b.appointment_date || null
        const existing = byCf.get(cf)
        const agg: Aggregated = existing || {
            codice_fiscale: cf,
            customer_name: b.customer_name,
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
        // Mantieni i dati contatto piu\' recenti (a parita\' di CF il record piu\'
        // recente ha customer_name aggiornato).
        if (!existing) {
            byCf.set(cf, agg)
        } else {
            if (!agg.customer_name && b.customer_name) agg.customer_name = b.customer_name
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
        // Ordina per data evento piu\' recente, poi per totale non pagato.
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
