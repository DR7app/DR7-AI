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
 * 28/09/2026: la lista mostrava 57 clienti su ~106. Tre buchi:
 *   - bookings letta con .limit(2000) ma PostgREST taglia a 1000: sparivano
 *     tutte le prenotazioni piu' vecchie (72 su 129 con danni/penali lette);
 *   - le penali presenti SOLO in fattura (come in Danni/Penali) non c'erano;
 *   - i clienti "In attesa di pagamento" senza danni/penali (prenotazione o
 *     estensione non saldata) non c'erano.
 *   Ora tutto e' paginato e le tre fonti finiscono nella stessa lista.
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
import { isTestPlate } from '../../src/utils/testPlates'

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
    discount?: number
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
    numero_fattura: string | null
    customer_name: string | null
    customer_email: string | null
    tipo_fattura: string | null
    related_invoice_id: string | null
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
    status: string | null
    payment_status: string | null
    price_total: number | null
    amount_paid: number | null
    created_at: string | null
    booking_details: {
        danni?: DanniItem[]
        penalties?: DanniItem[]
        extension_history?: { payment_status?: string; additional_amount?: number; amount_paid?: number; new_dropoff_date?: string }[]
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
    // 'insoluto' = prenotazione o estensione ancora da saldare
    // (stessa regola della tab "In attesa di pagamento").
    kind: 'danno' | 'penale' | 'insoluto'
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
    unpaid_other_total: number
    last_event_date: string | null
    last_vehicle: string | null
    bookings_with_events: number
    events: EventDetail[]
}

function num(v: unknown): number {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
}
// `total` e' il LISTINO; lo sconto (`discount`) si toglie sempre, come in
// Danni/Penali e in "In attesa di pagamento": conta il prezzo finale.
function itemTotal(it: DanniItem): number {
    const lordo = it.total != null && it.total !== ('' as unknown) ? num(it.total) : num(it.amount) * (num(it.quantity) || 1)
    return Math.max(0, Math.round((lordo - num(it.discount)) * 100) / 100)
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

    // PostgREST restituisce al massimo 1000 righe per richiesta: si legge a
    // pagine finche' una pagina torna corta.
    async function tutteLeRighe<T>(pagina: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
        const out: T[] = []
        for (let page = 0; page < 50; page++) {
            const { data, error } = await pagina(page * 1000, page * 1000 + 999)
            if (error) throw new Error(error.message)
            const got = (data || []) as T[]
            out.push(...got)
            if (got.length < 1000) break
        }
        return out
    }

    let rows: BookingRow[]
    let fattureTutte: FatturaRow[]
    let allWithCf: (CustomerProfile & { id?: string | null; telefono?: string | null })[]
    try {
        [rows, fattureTutte, allWithCf] = await Promise.all([
            tutteLeRighe<BookingRow>((from, to) => sb
                .from('bookings')
                .select('id, pickup_date, appointment_date, user_id, customer_name, customer_email, customer_phone, vehicle_name, vehicle_plate, status, payment_status, price_total, amount_paid, created_at, booking_details')
                .order('pickup_date', { ascending: false })
                .order('id', { ascending: true })
                .range(from, to)),
            tutteLeRighe<FatturaRow>((from, to) => sb
                .from('fatture')
                .select('id, booking_id, stato, data_emissione, created_at, items, numero_fattura, customer_name, customer_email, tipo_fattura, related_invoice_id')
                .order('id', { ascending: true })
                .range(from, to)),
            tutteLeRighe<CustomerProfile & { id?: string | null; telefono?: string | null }>((from, to) => sb
                .from('customers_extended')
                .select('user_id, id, email, codice_fiscale, nome, cognome, telefono')
                .not('codice_fiscale', 'is', null)
                .order('id', { ascending: true })
                .range(from, to)),
        ])
    } catch (err) {
        return jsonResponse(500, { error: (err as Error).message }, origin)
    }

    const PAGATO = new Set(['paid', 'completed', 'succeeded'])
    const TERMINALE = new Set(['cancelled', 'annullata', 'completed', 'completata'])
    const TEST_VISIBLE_FROM = '2026-05-05T00:00:00Z'

    // Stessa regola della tab "In attesa di pagamento" (UnpaidBookingsTab):
    // prenotazione non saldata (anche completata) ed estensioni con residuo.
    // Le prenotazioni annullate non devono nulla per il noleggio in se'.
    function insolutiDellaPrenotazione(b: BookingRow): { label: string; amount: number; amountPaid: number; eventDate: string | null }[] {
        const out: { label: string; amount: number; amountPaid: number; eventDate: string | null }[] = []
        if (String(b.customer_name || '') === 'Lavaggio Rientro') return out
        if (String(b.status || '') === 'deleted') return out
        if (isTestPlate(b.vehicle_plate) && !(b.created_at && b.created_at >= TEST_VISIBLE_FROM)) return out
        const status = String(b.status || '')
        const annullata = status === 'cancelled' || status === 'annullata'
        if (annullata) return out
        if (!PAGATO.has(String(b.payment_status || ''))) {
            const tot = num(b.price_total) / 100
            const pag = Math.min(num(b.amount_paid) / 100, tot)
            out.push({ label: 'Prenotazione da saldare', amount: tot, amountPaid: pag, eventDate: b.pickup_date || b.appointment_date || null })
        }
        if (!TERMINALE.has(status)) {
            for (const ext of b.booking_details?.extension_history || []) {
                const ps = String(ext?.payment_status || '')
                if (ps !== 'pending' && ps !== 'partial' && ps !== 'nexi_pay_by_link') continue
                const amt = num(ext.additional_amount)
                const paid = num(ext.amount_paid)
                if (amt - paid <= 0) continue
                out.push({ label: 'Estensione da saldare', amount: amt, amountPaid: paid, eventDate: ext.new_dropoff_date || b.pickup_date || null })
            }
        }
        return out
    }

    const interesting = rows.filter(b => {
        const d = b.booking_details?.danni || []
        const p = b.booking_details?.penalties || []
        return (Array.isArray(d) && d.length > 0) || (Array.isArray(p) && p.length > 0) || insolutiDellaPrenotazione(b).length > 0
    })

    // Batch resolution: per ogni booking interessante prepara una serie
    // Risoluzione CF aggressiva: il match per email su .in() e\' case-sensitive
    // su Postgres, quindi un cliente salvato come "Mario.Rossi@email.com" in
    // customers_extended non veniva mai matchato con la booking che ha
    // "mario.rossi@email.com". Stessa cosa con i nomi: a volte le bookings
    // hanno "Lorenzo Vladi" in customer_name ma customers_extended ha
    // nome="Lorenzo" cognome="Vladi" su una riga senza email/user_id.
    //
    // Per non perdere clienti, tiriamo TUTTE le righe customers_extended che
    // hanno un codice_fiscale popolato (singola query, ~poche centinaia di
    // KB), e indicizziamo per user_id, email-lowercase, nome-cognome-lowercase
    // e telefono normalizzato.
    const userIds = Array.from(new Set(interesting.map(b => b.user_id).filter(Boolean) as string[]))

    const profByUserId = new Map<string, CustomerProfile>()
    const profByEmail = new Map<string, CustomerProfile>()
    const profByName = new Map<string, CustomerProfile>()
    const profByPhone = new Map<string, CustomerProfile>()

    type ExtRow = CustomerProfile & { id?: string | null; telefono?: string | null }
    const normPhone = (v: string | null | undefined): string | null => {
        if (!v) return null
        const digits = String(v).replace(/\D+/g, '')
        return digits.length >= 7 ? digits.slice(-9) : null // ultimi 9 digit per gestire prefisso paese
    }

    // allWithCf: letta (paginata) insieme alle prenotazioni, piu' sopra.
    for (const p of allWithCf as ExtRow[]) {
        if (!p.codice_fiscale) continue
        if (p.user_id && !profByUserId.has(p.user_id)) profByUserId.set(p.user_id, p)
        // Le prenotazioni create dall'admin mettono in bookings.user_id l'id
        // della scheda cliente, non l'auth user.
        if (p.id && !profByUserId.has(p.id)) profByUserId.set(p.id, p)
        const e = normEmail(p.email)
        if (e && !profByEmail.has(e)) profByEmail.set(e, p)
        const fullName = normName([p.nome, p.cognome].filter(Boolean).join(' '))
        if (fullName && !profByName.has(fullName)) profByName.set(fullName, p)
        const ph = normPhone(p.telefono)
        if (ph && !profByPhone.has(ph)) profByPhone.set(ph, p)
    }
    // Per user_id mancanti dal primo fetch (clienti senza CF salvato) tira la
    // riga comunque, cosi\' almeno abbiamo nome/cognome per il display.
    if (userIds.length > 0) {
        const missingUids = userIds.filter(u => !profByUserId.has(u))
        if (missingUids.length > 0) {
            const { data: profs } = await sb
                .from('customers_extended')
                .select('user_id, id, email, codice_fiscale, nome, cognome, telefono')
                .in('user_id', missingUids)
            for (const p of (profs || []) as ExtRow[]) {
                if (p.user_id) profByUserId.set(p.user_id, p)
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
    const fatturaByBooking = new Map<string, { paidAt: string; numero: string }>()
    // 28/09/2026: le fatture sono gia' tutte in memoria (paginate): un .in()
    // con centinaia di id rischiava di sfondare la lunghezza dell'URL.
    const idsInteressanti = new Set(bookingIds)
    if (bookingIds.length > 0) {
        for (const f of fattureTutte) {
            if (!f.booking_id || !idsInteressanti.has(f.booking_id)) continue
            const isPaid = String(f.stato || '').toLowerCase() === 'paid'
            if (!isPaid) continue
            const paidAt = f.data_emissione || f.created_at || ''
            const numero = f.numero_fattura || ''
            // Fallback per-booking: la prima fattura saldata trovata per
            // questa booking. Serve quando l'item-label nella fattura non
            // coincide letteralmente con il label nel booking_details.
            if (!fatturaByBooking.has(f.booking_id)) {
                fatturaByBooking.set(f.booking_id, { paidAt, numero })
            }
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
        // Prima esatta per (booking, label). Poi fallback a "qualsiasi fattura
        // saldata per questa booking" — meno preciso ma evita pagato senza data.
        const key = `${bookingId}::${label.trim().toLowerCase()}`
        return fatturaByBookingItem.get(key) || fatturaByBooking.get(bookingId) || null
    }
    function daysBetween(a: string | null, b: string | null): number | null {
        if (!a || !b) return null
        const da = new Date(a).getTime()
        const db = new Date(b).getTime()
        if (!Number.isFinite(da) || !Number.isFinite(db)) return null
        return Math.max(0, Math.round((db - da) / 86_400_000))
    }

    const byGroup = new Map<string, Aggregated>()

    // Trova (o crea) il cliente a cui appartiene una riga: stessa risoluzione
    // per le tre fonti (danni/penali, fatture, insoluti).
    function aggregatoPer(src: {
        id: string
        user_id: string | null
        customer_name: string | null
        customer_email: string | null
        customer_phone: string | null
        booking_details: BookingRow['booking_details']
    }): Aggregated {
        const email = normEmail(src.customer_email)
        const nameKey = normName(src.customer_name)
        const phoneKey = normPhone(src.customer_phone)
        const profile =
            (src.user_id && profByUserId.get(src.user_id)) ||
            (email && profByEmail.get(email)) ||
            (nameKey && profByName.get(nameKey)) ||
            (phoneKey && profByPhone.get(phoneKey)) ||
            null
        const cf =
            normCF(profile?.codice_fiscale) ||
            normCF(src.booking_details?.codice_fiscale) ||
            normCF(src.booking_details?.codiceFiscale) ||
            normCF(src.booking_details?.customer?.codice_fiscale) ||
            normCF(src.booking_details?.customer?.codiceFiscale)
        const fullName = profile && (profile.nome || profile.cognome)
            ? [profile.nome, profile.cognome].filter(Boolean).join(' ')
            : (src.customer_name || null)

        // Group key: CF se risolto, altrimenti email, altrimenti name.
        const groupKey = cf || email || normName(fullName) || `__booking_${src.id}`

        const existing = byGroup.get(groupKey)
        const agg: Aggregated = existing || {
            codice_fiscale: cf,
            customer_name: fullName,
            customer_email: src.customer_email,
            customer_phone: src.customer_phone,
            damages_count: 0,
            penalties_count: 0,
            paid_damage_total: 0,
            unpaid_damage_total: 0,
            paid_penalty_total: 0,
            unpaid_penalty_total: 0,
            unpaid_other_total: 0,
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
            if (!agg.customer_email && src.customer_email) agg.customer_email = src.customer_email
            if (!agg.customer_phone && src.customer_phone) agg.customer_phone = src.customer_phone
        }
        return agg
    }

    function aggiungi(agg: Aggregated, ev: EventDetail) {
        if (ev.kind === 'danno') {
            agg.damages_count += 1
            if (ev.paymentStatus === 'paid') agg.paid_damage_total += ev.amount
            else {
                agg.paid_damage_total += ev.amountPaid
                agg.unpaid_damage_total += ev.remaining
            }
        } else if (ev.kind === 'penale') {
            agg.penalties_count += 1
            if (ev.paymentStatus === 'paid') agg.paid_penalty_total += ev.amount
            else {
                agg.paid_penalty_total += ev.amountPaid
                agg.unpaid_penalty_total += ev.remaining
            }
        } else {
            agg.unpaid_other_total += ev.remaining
        }
        if (ev.eventDate && (!agg.last_event_date || ev.eventDate > agg.last_event_date)) {
            agg.last_event_date = ev.eventDate
            agg.last_vehicle = ev.vehicle
        }
        agg.events.push(ev)
    }

    for (const b of interesting) {
        const danni = Array.isArray(b.booking_details?.danni) ? b.booking_details!.danni! : []
        const penalties = Array.isArray(b.booking_details?.penalties) ? b.booking_details!.penalties! : []
        const insoluti = insolutiDellaPrenotazione(b)
        if (danni.length === 0 && penalties.length === 0 && insoluti.length === 0) continue
        const ref = b.pickup_date || b.appointment_date || null

        const agg = aggregatoPer(b)
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

        for (const d of danni) aggiungi(agg, buildEvent('danno', d))
        for (const p of penalties) aggiungi(agg, buildEvent('penale', p))
        for (const x of insoluti) {
            const amount = Math.round(x.amount * 100) / 100
            const amountPaid = Math.round(x.amountPaid * 100) / 100
            aggiungi(agg, {
                kind: 'insoluto',
                bookingId: b.id,
                label: x.label,
                vehicle: veh,
                eventDate: x.eventDate,
                paidAt: null,
                daysToPay: null,
                amount,
                amountPaid,
                remaining: Math.max(0, Math.round((amount - amountPaid) * 100) / 100),
                paymentStatus: amountPaid > 0 ? 'partial' : 'pending',
                fatturaNumero: null,
                note: null,
            })
        }
    }

    // 28/09/2026: penali/danni presenti SOLO in fattura (stessa regola della
    // tab Danni/Penali): righe "Penale - X" / "Danno - X" / "Penale|Danno
    // prenotazione ...". Se la prenotazione ha gia' la sua lista in
    // booking_details la fattura e' solo il documento di quella lista (spesso
    // riemessa 2-3 volte): contarla sarebbe un doppio. Note di credito e
    // fatture annullate da una nota di credito non sono addebiti.
    const bookingById = new Map(rows.map(b => [b.id, b]))
    const conLista = new Set(rows
        .filter(b => (Array.isArray(b.booking_details?.danni) && b.booking_details!.danni!.length > 0)
            || (Array.isArray(b.booking_details?.penalties) && b.booking_details!.penalties!.length > 0))
        .map(b => b.id))
    const fattureAnnullate = new Set(fattureTutte
        .filter(f => f.tipo_fattura === 'nota_di_credito' && f.related_invoice_id)
        .map(f => String(f.related_invoice_id)))
    const tipoRiga = (description: string): 'danno' | 'penale' | null => {
        const d = description.toLowerCase().trim()
        if (d.includes('danno prenotazione') || d.startsWith('danno')) return 'danno'
        if (d.includes('penale prenotazione') || d.startsWith('penale')) return 'penale'
        return null
    }
    for (const f of fattureTutte) {
        if (!Array.isArray(f.items)) continue
        if (f.tipo_fattura === 'nota_di_credito' || fattureAnnullate.has(String(f.id))) continue
        if (f.booking_id && conLista.has(f.booking_id)) continue
        const righe = f.items
            .filter(it => typeof it?.description === 'string')
            .map(it => ({ it, tipo: tipoRiga(String(it.description)) }))
        const righePenali = righe.filter(r => r.tipo !== null)
        if (righePenali.length === 0) continue
        const lineTotal = (it: FatturaItem) => num(it.total) || num(it.unit_price) * (num(it.quantity) || 1)
        // Sconto della fattura ripartito sulle righe solo se la fattura
        // contiene SOLO penali/danni (come Danni/Penali).
        const altre = righe.filter(r => r.tipo === null && String(r.it.description).trim().toLowerCase() !== 'sconto')
        const sconto = righe
            .filter(r => String(r.it.description).trim().toLowerCase() === 'sconto')
            .reduce((s, r) => s + Math.abs(num(r.it.total ?? r.it.unit_price)), 0)
        const lordo = righePenali.reduce((s, r) => s + lineTotal(r.it), 0)
        const quota = altre.length === 0 && sconto > 0 && lordo > 0 ? Math.min(1, sconto / lordo) : 0
        const stato = String(f.stato || '').toLowerCase()
        const fatturaPagata = stato === 'paid' || stato === 'pagata'

        const bk = f.booking_id ? bookingById.get(f.booking_id) : undefined
        const nome = f.customer_name || bk?.customer_name || null
        const mail = f.customer_email || bk?.customer_email || null
        if (!nome && !mail) continue
        const agg = aggregatoPer({
            id: f.booking_id || `fattura_${f.id}`,
            user_id: bk?.user_id || null,
            customer_name: nome,
            customer_email: mail,
            customer_phone: bk?.customer_phone || null,
            booking_details: bk?.booking_details || null,
        })
        agg.bookings_with_events += 1
        const paidAt = fatturaPagata ? (f.data_emissione || f.created_at || null) : null
        const eventDate = bk?.pickup_date || bk?.appointment_date || f.data_emissione || null
        for (const { it, tipo } of righePenali) {
            const total = Math.round(lineTotal(it) * (1 - quota) * 100) / 100
            const ap = it.amountPaid != null
                ? Math.min(total, Math.round(num(it.amountPaid) * (1 - quota) * 100) / 100)
                : (fatturaPagata ? total : 0)
            const ps = String(it.paymentStatus || '').toLowerCase()
            const status: 'paid' | 'partial' | 'pending' =
                ps === 'paid' ? 'paid' : ps === 'partial' ? 'partial' : ps === 'pending' ? 'pending'
                : ap >= total - 0.005 ? 'paid' : ap > 0 ? 'partial' : 'pending'
            aggiungi(agg, {
                kind: tipo!,
                bookingId: f.booking_id || '',
                label: String(it.description),
                vehicle: bk ? (bk.vehicle_name || bk.vehicle_plate || null) : null,
                eventDate,
                paidAt: status === 'pending' ? null : paidAt,
                daysToPay: status === 'pending' ? null : daysBetween(eventDate, paidAt),
                amount: total,
                amountPaid: status === 'paid' ? total : ap,
                remaining: status === 'paid' ? 0 : Math.max(0, Math.round((total - ap) * 100) / 100),
                paymentStatus: status,
                fatturaNumero: f.numero_fattura || null,
                note: null,
            })
        }
    }

    // Backfill CF per gruppi senza CF: per ogni gruppo facciamo lookup
    // mirati su customers_extended con ilike case-insensitive su nome,
    // cognome, email. Niente score threshold: se troviamo un solo
    // candidato lo prendiamo, se ne troviamo di piu\' prendiamo quello
    // con il miglior overlap di token. Cattura nomi con spazi multipli,
    // ordine invertito, casing diverso, accenti, email con capital
    // letters, ecc.
    type BackfillRow = { codice_fiscale: string | null; nome: string | null; cognome: string | null; email: string | null; telefono: string | null }
    const needCf = Array.from(byGroup.values()).filter(a => !a.codice_fiscale)
    if (needCf.length > 0) {
        await Promise.all(needCf.map(async (agg) => {
            const name = String(agg.customer_name || '').trim()
            const email = String(agg.customer_email || '').trim()
            const tokens = name.split(/\s+/)
                .map(t => t.replace(/[,*().'"%\\/]/g, ' ').trim())
                .filter(t => t.length >= 2)
                .slice(0, 4)
            const orParts: string[] = []
            for (const t of tokens) {
                orParts.push(`nome.ilike.%${t}%`)
                orParts.push(`cognome.ilike.%${t}%`)
            }
            if (email) {
                orParts.push(`email.ilike.${email}`)
            }
            if (orParts.length === 0) return

            const { data, error: orErr } = await sb
                .from('customers_extended')
                .select('codice_fiscale, nome, cognome, email, telefono')
                .not('codice_fiscale', 'is', null)
                .or(orParts.join(','))
                .limit(20)
            if (orErr) {
                console.error('[emtn-clients] backfill or() failed', { customer: name, email, err: orErr.message })
                return
            }

            const rows = (data || []) as BackfillRow[]
            if (rows.length === 0) return

            // Score per overlap di token. Email exact (case-insensitive)
            // vale 10, ogni token in nome o cognome vale 1.
            const lower = (s: string | null | undefined) => String(s || '').toLowerCase()
            const emailLow = email.toLowerCase()
            let best: { row: BackfillRow; score: number } | null = null
            for (const row of rows) {
                const hay = `${lower(row.nome)} ${lower(row.cognome)}`
                let score = 0
                if (emailLow && lower(row.email) === emailLow) score += 10
                for (const t of tokens) if (hay.includes(t.toLowerCase())) score += 1
                if (!best || score > best.score) best = { row, score }
            }
            // Accetta se: c'e\' un solo candidato (score qualunque), oppure
            // se il migliore ha score >= 1 (almeno un segnale).
            const accept = best && (rows.length === 1 || best.score >= 1)
            if (accept && best && best.row.codice_fiscale) {
                agg.codice_fiscale = normCF(best.row.codice_fiscale)
                if (!agg.customer_email && best.row.email) agg.customer_email = best.row.email
                if (!agg.customer_phone && best.row.telefono) agg.customer_phone = best.row.telefono
            }
        }))
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
        const aUnpaid = a.unpaid_damage_total + a.unpaid_penalty_total + a.unpaid_other_total
        const bUnpaid = b.unpaid_damage_total + b.unpaid_penalty_total + b.unpaid_other_total
        return bUnpaid - aUnpaid
    })

    return jsonResponse(200, {
        count: clients.length,
        totalUnpaid: clients.reduce((s, c) => s + c.unpaid_damage_total + c.unpaid_penalty_total + c.unpaid_other_total, 0),
        clients,
    }, origin)
}
