/**
 * EMTN — POST /emtn-search
 *
 * Ricerca per codice fiscale, oppure (22/09/2026, direzione) per cliente
 * ESTERO senza codice fiscale: nome + cognome + data di nascita. Ogni
 * chiamata genera una riga in emtn_access_logs.
 *
 * 22/09/2026 (direzione): niente piu' OTP al cliente. Il report e gli eventi
 * si vedono subito; resta il log di ogni consultazione.
 *
 * Body: { codiceFiscale } oppure { estero: true, nome, cognome, dataNascita,
 *         nazionalita, documentoTipo: 'carta_identita'|'passaporto', documentoNumero }
 * Returns: { client, stats, recentEvents, ... }
 */
import { Handler } from '@netlify/functions'
import { requireAuth } from './require-auth'
import {
    audit,
    clientIp,
    getServiceSupabase,
    isValidCF,
    jsonResponse,
    normalizeCF,
} from './utils/emtn'
import { cercaStoricoRete } from './utils/emtnRete'

export const handler: Handler = async (event) => {
    const origin = event.headers.origin || event.headers.Origin
    if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {}, origin)
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' }, origin)

    const { user, error: authErr } = await requireAuth(event)
    if (authErr) return authErr
    const operatorId = user!.id
    const operatorEmail = user!.email

    const sb = getServiceSupabase()
    const body = (() => { try { return JSON.parse(event.body || '{}') } catch { return null } })()
    if (!body) return jsonResponse(400, { error: 'JSON body invalido' }, origin)

    const ip = clientIp(event.headers as Record<string, string | undefined>)
    const ua = event.headers['user-agent'] || null

    // Cliente estero: nessun codice fiscale, si riconosce da nome + cognome +
    // data di nascita.
    const estero = body.estero === true
    const nomeE = String(body.nome || '').trim().replace(/\s+/g, ' ')
    const cognomeE = String(body.cognome || '').trim().replace(/\s+/g, ' ')
    const nascitaE = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dataNascita || '')) ? String(body.dataNascita) : ''
    const nazionalitaE = String(body.nazionalita || '').trim().replace(/\s+/g, ' ')
    const docTipoE = body.documentoTipo === 'passaporto' ? 'passaporto' : body.documentoTipo === 'carta_identita' ? 'carta_identita' : ''
    const docNumE = String(body.documentoNumero || '').replace(/\s+/g, '').toUpperCase()
    const cf = estero ? '' : normalizeCF(String(body.codiceFiscale || ''))

    if (estero) {
        if (!nomeE || !cognomeE || !nascitaE || !nazionalitaE || !docTipoE || !docNumE) {
            await audit(sb, { operatorId, operatorEmail, action: 'SEARCH', success: false, ip, userAgent: ua, metadata: { reason: 'estero_incompleto' } })
            return jsonResponse(400, { error: 'Cliente estero: servono nome, cognome, data di nascita, nazionalita\' e documento (tipo e numero)' }, origin)
        }
    } else if (!isValidCF(cf)) {
        await audit(sb, { operatorId, operatorEmail, action: 'SEARCH', success: false, ip, userAgent: ua, metadata: { reason: 'invalid_cf', cf } })
        return jsonResponse(400, { error: 'Codice fiscale mancante o invalido (cliente straniero? usa "Estero")' }, origin)
    }

    // Find or create client. Estero: prima per documento, poi per nome +
    // cognome + data di nascita (stessa persona, documento nuovo o mancante).
    const COLONNE_ESTERO = 'id, codice_fiscale, nome, cognome, data_nascita, created_at, nazionalita, documento_tipo, documento_numero'
    const segnalaMigrazione = (e: { code?: string; message?: string } | null) =>
        !!e && (e.code === '42703' || e.code === 'PGRST204' || /documento_|nazionalita/.test(e.message || ''))
    if (estero) {
        const perDoc = await sb
            .from('emtn_clients')
            .select(COLONNE_ESTERO)
            .eq('documento_tipo', docTipoE)
            .ilike('documento_numero', docNumE)
            .limit(1)
            .maybeSingle()
        if (segnalaMigrazione(perDoc.error)) {
            return jsonResponse(500, { error: 'Clienti esteri non ancora attivi: eseguire in Supabase la migrazione 20260922_emtn_clienti_esteri.sql' }, origin)
        }
        if (perDoc.data) {
            const d = perDoc.data as { nome?: string | null; cognome?: string | null; data_nascita?: string | null }
            const stessaPersona = String(d.nome || '').toLowerCase() === nomeE.toLowerCase()
                && String(d.cognome || '').toLowerCase() === cognomeE.toLowerCase()
                && String(d.data_nascita || '') === nascitaE
            if (!stessaPersona) {
                await audit(sb, { operatorId, operatorEmail, action: 'SEARCH', success: false, ip, userAgent: ua, metadata: { reason: 'documento_di_altra_persona' } })
                return jsonResponse(409, { error: `Questo documento e' gia' registrato su EMTN a nome di ${[d.nome, d.cognome].filter(Boolean).join(' ')} (nato il ${d.data_nascita || 'n/d'}). Controlla i dati.` }, origin)
            }
        }
    }
    const { data: existing } = estero
        ? await sb
            .from('emtn_clients')
            .select(COLONNE_ESTERO)
            .is('codice_fiscale', null)
            .ilike('nome', nomeE)
            .ilike('cognome', cognomeE)
            .eq('data_nascita', nascitaE)
            .limit(1)
            .maybeSingle()
        : await sb
            .from('emtn_clients')
            .select('id, codice_fiscale, nome, cognome, data_nascita, created_at')
            .eq('codice_fiscale', cf)
            .maybeSingle()

    let client = existing
    if (!client) {
        const { data: created, error: insErr } = await sb
            .from('emtn_clients')
            .insert(estero ? {
                codice_fiscale: null,
                nome: nomeE,
                cognome: cognomeE,
                data_nascita: nascitaE,
                nazionalita: nazionalitaE,
                documento_tipo: docTipoE,
                documento_numero: docNumE,
            } : {
                codice_fiscale: cf,
                nome: body.nome ? String(body.nome).trim() : null,
                cognome: body.cognome ? String(body.cognome).trim() : null,
                data_nascita: body.dataNascita || null,
            })
            .select('id, codice_fiscale, nome, cognome, data_nascita, created_at')
            .single()
        if (insErr) {
            await audit(sb, { operatorId, operatorEmail, action: 'SEARCH', success: false, ip, userAgent: ua, metadata: { reason: 'insert_failed', error: insErr.message, details: insErr.details, hint: insErr.hint, code: insErr.code } })
            // Espone il vero motivo (RLS, CHECK constraint, NOT NULL, ecc.)
            // cosi\' chi riceve l'errore puo\' agire invece di vedere un
            // generico "Inserimento cliente fallito".
            const parts = [insErr.message, insErr.details, insErr.hint ? `hint: ${insErr.hint}` : '', insErr.code ? `(${insErr.code})` : ''].filter(Boolean)
            // Clienti esteri: serve la migrazione che rende facoltativo il CF.
            if (estero && (insErr.code === '23502' || segnalaMigrazione(insErr))) {
                return jsonResponse(500, { error: 'Clienti esteri non ancora attivi: eseguire in Supabase la migrazione 20260922_emtn_clienti_esteri.sql' }, origin)
            }
            return jsonResponse(500, { error: `Inserimento cliente fallito: ${parts.join(' — ')}` }, origin)
        }
        client = created
    }

    // Estero gia' noto: nazionalita' e documento si aggiornano con quelli
    // dati adesso (documento rinnovato, prima ricerca senza documento).
    if (estero && client) {
        const c = client as { id: string; nazionalita?: string | null; documento_tipo?: string | null; documento_numero?: string | null }
        if (c.nazionalita !== nazionalitaE || c.documento_tipo !== docTipoE || c.documento_numero !== docNumE) {
            const { error: updErr } = await sb.from('emtn_clients')
                .update({ nazionalita: nazionalitaE, documento_tipo: docTipoE, documento_numero: docNumE })
                .eq('id', c.id)
            if (!updErr) client = { ...client, nazionalita: nazionalitaE, documento_tipo: docTipoE, documento_numero: docNumE } as typeof client
        }
    }

    // ── Enrich client da customers_extended ────────────────
    // emtn_clients tiene solo CF + nome + cognome + data_nascita. Per
    // popolare la dashboard servono email, telefono, indirizzo,
    // citta\', sesso ecc., che vivono su customers_extended. Lookup
    // case-insensitive sul CF, fallback su nome+cognome.
    type ExtRow = {
        nome: string | null; cognome: string | null
        email: string | null; telefono: string | null
        indirizzo: string | null; citta_residenza: string | null
        codice_postale: string | null; data_nascita: string | null
        codice_fiscale: string | null; created_at: string | null
        metadata: Record<string, unknown> | null
        sede_legale?: string | null
    }
    let ext: ExtRow | null = null
    {
        const q = sb
            .from('customers_extended')
            .select('nome, cognome, email, telefono, indirizzo, citta_residenza, codice_postale, data_nascita, codice_fiscale, created_at, metadata, sede_legale')
        const { data } = await (estero
            ? q.ilike('nome', nomeE).ilike('cognome', cognomeE).eq('data_nascita', nascitaE)
            : q.eq('codice_fiscale', cf))
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        ext = (data as ExtRow | null) || null
    }
    function buildAddress(e: ExtRow | null): string | null {
        if (!e) return null
        const street = e.indirizzo || e.sede_legale || null
        const city = e.citta_residenza || null
        const cap = e.codice_postale || null
        const parts: string[] = []
        if (street) parts.push(String(street))
        if (cap || city) parts.push([cap, city].filter(Boolean).join(' '))
        return parts.join(', ') || null
    }
    // Sesso derivato dal CF: il 10° carattere (index 9, ovvero il giorno
    // di nascita: 1-31 maschio, 41-71 femmina).
    function sexFromCF(c: string): 'M' | 'F' | null {
        const m = c.match(/^[A-Z]{6}[0-9]{2}[A-Z]([0-9]{2})/)
        if (!m) return null
        const day = parseInt(m[1], 10)
        return day > 31 ? 'F' : 'M'
    }
    function dobFromCF(c: string): string | null {
        // CF: AAAAAA YY M DD CCCC X — month letter A=jan…T=dec, day 1-31 (m) o 41-71 (f).
        // Anno a due cifre — assume <30 → 20xx, >=30 → 19xx.
        const m = c.match(/^[A-Z]{6}(\d{2})([ABCDEHLMPRST])(\d{2})/)
        if (!m) return null
        const yy = parseInt(m[1], 10)
        const monthMap: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, H: 6, L: 7, M: 8, P: 9, R: 10, S: 11, T: 12 }
        const mm = monthMap[m[2]]
        let day = parseInt(m[3], 10)
        if (day > 40) day -= 40
        const year = yy < 30 ? 2000 + yy : 1900 + yy
        if (!mm || day < 1 || day > 31) return null
        return `${year.toString().padStart(4, '0')}-${mm.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
    }

    // ── Pull DR7's own record of this customer ─────────────
    // Bookings con questo CF, espandi danni/penali da booking_details.
    // Questo permette di vedere subito il record DR7 senza dover
    // segnalare nulla su EMTN: e' la verita' interna che il network
    // poi normalizza in eventi.
    type DanniItem = { label?: string; total?: number; amount?: number; quantity?: number; paymentStatus?: string; date?: string; note?: string }
    type PenaliItem = DanniItem
    interface DR7Booking {
        id: string
        pickup_date?: string | null
        appointment_date?: string | null
        vehicle_name?: string | null
        vehicle_plate?: string | null
        status?: string | null
        payment_status?: string | null
        // NB: la chiave JSON usata da DR7 e\' `penalties` (inglese), non `penali`.
        booking_details?: { danni?: DanniItem[]; penalties?: PenaliItem[] } | null
    }

    // bookings non ha una colonna CF: l'unica colonna di linkage e\'
    // user_id, che lega all'auth user e a customers_extended.user_id.
    // Risolviamo prima gli user_id corrispondenti al CF e poi tiriamo
    // le loro bookings. Fallback finale su booking_details (CF salvato
    // nel JSON quando il cliente non era ancora autenticato).
    // 28/09/2026: le prenotazioni create dall'admin NON hanno l'auth user in
    // bookings.user_id ma l'id della scheda cliente (customers_extended.id),
    // oppure lo tengono solo in booking_details.customer_id. Cercando solo
    // per customers_extended.user_id (spesso NULL) un cliente come Nelson
    // Badini risultava senza prenotazioni. Ora si cerca per: id scheda,
    // user_id, customer_id nel JSON, email (case-insensitive) e CF nel JSON.
    const { data: profileMatches } = estero
        ? await sb
            .from('customers_extended')
            .select('id, user_id, email')
            .ilike('nome', nomeE)
            .ilike('cognome', cognomeE)
            .eq('data_nascita', nascitaE)
        : await sb
            .from('customers_extended')
            .select('id, user_id, email')
            .eq('codice_fiscale', cf)
    const profili = (profileMatches || []) as { id: string | null; user_id: string | null; email: string | null }[]
    const matchedUserIds = Array.from(new Set(
        profili.flatMap(p => [p.id, p.user_id]).filter(Boolean) as string[]
    ))
    const matchedEmails = Array.from(new Set(
        profili.map(p => String(p.email || '').trim().toLowerCase()).filter(e => e.includes('@'))
    ))

    type RawBooking = DR7Booking & {
        user_id?: string | null
        customer_email?: string | null
        booking_details?: (DR7Booking['booking_details'] & {
            codice_fiscale?: string
            codiceFiscale?: string
            customer?: { codice_fiscale?: string; codiceFiscale?: string }
        }) | null
    }

    const collected = new Map<string, RawBooking>()
    const COLONNE_BOOKING = 'id, pickup_date, appointment_date, vehicle_name, vehicle_plate, status, payment_status, booking_details, user_id, customer_email'
    const filtri: string[] = []
    if (matchedUserIds.length > 0) {
        const lista = matchedUserIds.join(',')
        filtri.push(`user_id.in.(${lista})`)
        filtri.push(`booking_details->>customer_id.in.(${lista})`)
        filtri.push(`booking_details->customer->>customerId.in.(${lista})`)
    }
    for (const e of matchedEmails) {
        // Virgole e parentesi romperebbero il filtro .or(): quelle email si saltano.
        if (!/[,()]/.test(e)) filtri.push(`customer_email.ilike.${e}`)
    }
    if (!estero && cf) {
        filtri.push(`booking_details->>codice_fiscale.eq.${cf}`)
        filtri.push(`booking_details->>codiceFiscale.eq.${cf}`)
        filtri.push(`booking_details->customer->>codice_fiscale.eq.${cf}`)
        filtri.push(`booking_details->customer->>codiceFiscale.eq.${cf}`)
    }
    if (filtri.length > 0) {
        for (let page = 0; page < 10; page++) {
            const { data, error: bErr } = await sb
                .from('bookings')
                .select(COLONNE_BOOKING)
                .or(filtri.join(','))
                .order('pickup_date', { ascending: false })
                .range(page * 1000, page * 1000 + 999)
            if (bErr) { console.error('[emtn-search] bookings or() failed', bErr.message); break }
            const got = (data || []) as RawBooking[]
            for (const b of got) collected.set(b.id, b)
            if (got.length < 1000) break
        }
    }

    const bookings = Array.from(collected.values()) as DR7Booking[]
    const dr7Damages: Array<{ bookingId: string; vehicle?: string | null; date?: string | null; label: string; amount: number; quantity: number; paid: boolean; note?: string }> = []
    const dr7Penalties: typeof dr7Damages = []
    let unpaidDamageTotal = 0
    let unpaidPenaltyTotal = 0
    let lastBookingDate: string | null = null
    let firstBookingDate: string | null = null

    for (const b of bookings) {
        const refDate = b.pickup_date || b.appointment_date || null
        if (refDate && (!lastBookingDate || refDate > lastBookingDate)) lastBookingDate = refDate
        if (refDate && (!firstBookingDate || refDate < firstBookingDate)) firstBookingDate = refDate
        const danni = b.booking_details?.danni || []
        for (const d of danni) {
            const total = Number(d.total ?? (Number(d.amount || 0) * Number(d.quantity || 1)))
            const paid = String(d.paymentStatus || '').toLowerCase() === 'paid'
            if (!paid) unpaidDamageTotal += total
            dr7Damages.push({
                bookingId: b.id,
                vehicle: b.vehicle_name || b.vehicle_plate,
                date: d.date || refDate,
                label: String(d.label || 'Danno'),
                amount: total,
                quantity: Number(d.quantity || 1),
                paid,
                note: d.note,
            })
        }
        const penali = b.booking_details?.penalties || []
        for (const p of penali) {
            const total = Number(p.total ?? (Number(p.amount || 0) * Number(p.quantity || 1)))
            const paid = String(p.paymentStatus || '').toLowerCase() === 'paid'
            if (!paid) unpaidPenaltyTotal += total
            dr7Penalties.push({
                bookingId: b.id,
                vehicle: b.vehicle_name || b.vehicle_plate,
                date: p.date || refDate,
                label: String(p.label || 'Penale'),
                amount: total,
                quantity: Number(p.quantity || 1),
                paid,
                note: p.note,
            })
        }
    }

    // 28/09/2026: danni/penali presenti in fattura ma non nella lista della
    // prenotazione (es. "Danno prenotazione 88CDFF9D - distrutta macchina",
    // 13.000 EUR sulla Clio di Nelson Badini): la scheda cliente DR7 li
    // mostra, EMTN no. Riga per riga: con gemella in booking_details la lista
    // resta la fonte; senza gemella si conta, una volta sola anche se la
    // fattura e' stata riemessa. Note di credito e fatture annullate escluse.
    const conDanniInFattura = new Set<string>()
    {
        const bookingIds = bookings.map(b => b.id)
        const vociLista = (b: DR7Booking | undefined): string[] => {
            if (!b) return []
            const voci = [...(b.booking_details?.danni || []), ...(b.booking_details?.penalties || [])] as (DanniItem & { description?: string })[]
            return voci.map(it => String(it?.label || it?.description || '')).filter(Boolean)
        }
        // Stessa regola di GestioneDanniTab.stessaVoce: "Penale - X" == "X".
        const nomeVoce = (t: string) => t.toLowerCase().trim().replace(/^(penale|danno)\s*-\s*/, '')
        const stessaVoce = (etichetta: string, description: string): boolean => {
            const a = nomeVoce(etichetta)
            const b = nomeVoce(description)
            if (!a || !b) return false
            if (a === b) return true
            const d = description.toLowerCase()
            return a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a) || d.includes(a))
        }
        const righeContate = new Set<string>()
        const byId = new Map(bookings.map(b => [b.id, b]))
        type FatturaRiga = { description?: string; total?: number; unit_price?: number; quantity?: number; amountPaid?: number; paymentStatus?: string }
        type FatturaDb = { id: string; booking_id: string | null; stato: string | null; data_emissione: string | null; items: FatturaRiga[] | null; tipo_fattura: string | null; related_invoice_id: string | null }
        const fatture: FatturaDb[] = []
        const COLONNE_FATTURA = 'id, booking_id, stato, data_emissione, items, tipo_fattura, related_invoice_id'
        for (let i = 0; i < bookingIds.length; i += 100) {
            const { data } = await sb.from('fatture').select(COLONNE_FATTURA).in('booking_id', bookingIds.slice(i, i + 100))
            fatture.push(...((data || []) as FatturaDb[]))
        }
        for (const e of matchedEmails) {
            const { data } = await sb.from('fatture').select(COLONNE_FATTURA).is('booking_id', null).ilike('customer_email', e)
            fatture.push(...((data || []) as FatturaDb[]))
        }
        const annullate = new Set(fatture.filter(f => f.tipo_fattura === 'nota_di_credito' && f.related_invoice_id).map(f => String(f.related_invoice_id)))
        const tipoRiga = (d: string): 'danno' | 'penale' | null => {
            const x = d.toLowerCase().trim()
            if (x.includes('danno prenotazione') || x.startsWith('danno')) return 'danno'
            if (x.includes('penale prenotazione') || x.startsWith('penale')) return 'penale'
            return null
        }
        const visti = new Set<string>()
        for (const f of fatture) {
            if (visti.has(f.id)) continue
            visti.add(f.id)
            if (!Array.isArray(f.items)) continue
            if (f.tipo_fattura === 'nota_di_credito' || annullate.has(String(f.id))) continue
            const gemelle = vociLista(f.booking_id ? byId.get(f.booking_id) : undefined)
            const righe = f.items.filter(it => typeof it?.description === 'string').map(it => ({ it, tipo: tipoRiga(String(it.description)) }))
            const righePenali = righe.filter(r => r.tipo !== null)
            if (righePenali.length === 0) continue
            const lineTotal = (it: FatturaRiga) => Number(it.total) || (Number(it.unit_price) || 0) * (Number(it.quantity) || 1)
            const daContare = righePenali.filter(r => {
                const desc = String(r.it.description)
                if (gemelle.some(g => stessaVoce(g, desc))) return false
                const chiave = `${f.booking_id || f.id}|${desc.toLowerCase().trim()}|${lineTotal(r.it).toFixed(2)}`
                if (righeContate.has(chiave)) return false
                righeContate.add(chiave)
                return true
            })
            if (daContare.length === 0) continue
            const altre = righe.filter(r => r.tipo === null && String(r.it.description).trim().toLowerCase() !== 'sconto')
            const sconto = righe.filter(r => String(r.it.description).trim().toLowerCase() === 'sconto')
                .reduce((t, r) => t + Math.abs(Number(r.it.total ?? r.it.unit_price) || 0), 0)
            const lordo = righePenali.reduce((t, r) => t + lineTotal(r.it), 0)
            const quota = altre.length === 0 && sconto > 0 && lordo > 0 ? Math.min(1, sconto / lordo) : 0
            const stato = String(f.stato || '').toLowerCase()
            const fatturaPagata = stato === 'paid' || stato === 'pagata'
            const bk = f.booking_id ? byId.get(f.booking_id) : undefined
            const refDate = bk?.pickup_date || bk?.appointment_date || f.data_emissione || null
            for (const { it, tipo } of daContare) {
                const total = Math.round(lineTotal(it) * (1 - quota) * 100) / 100
                const pagato = it.amountPaid != null ? Number(it.amountPaid) * (1 - quota) : (fatturaPagata ? total : 0)
                const ps = String(it.paymentStatus || '').toLowerCase()
                const paid = ps === 'paid' || (ps !== 'pending' && ps !== 'partial' && pagato >= total - 0.005)
                const voce = {
                    bookingId: f.booking_id || '',
                    vehicle: bk ? (bk.vehicle_name || bk.vehicle_plate) : null,
                    date: refDate,
                    label: String(it.description),
                    amount: total,
                    quantity: 1,
                    paid,
                    note: undefined as string | undefined,
                }
                if (f.booking_id) conDanniInFattura.add(f.booking_id)
                if (tipo === 'danno') {
                    if (!paid) unpaidDamageTotal += Math.max(0, total - pagato)
                    dr7Damages.push(voce)
                } else {
                    if (!paid) unpaidPenaltyTotal += Math.max(0, total - pagato)
                    dr7Penalties.push(voce)
                }
            }
        }
    }

    const totalRentals = bookings.length
    const regularRentals = bookings.filter(b => {
        const danni = b.booking_details?.danni || []
        const penali = b.booking_details?.penalties || []
        return danni.length === 0 && penali.length === 0 && !conDanniInFattura.has(b.id)
    }).length

    // Sync emtn_stats_cache: cosi' il prossimo lookup parte gia' caldo
    // anche da chi non passa per emtn-search (es. /emtn-report).
    await sb.from('emtn_stats_cache').upsert({
        client_id: client!.id,
        total_rentals: totalRentals,
        regular_rentals: regularRentals,
        negative_events: dr7Damages.filter(d => !d.paid).length + dr7Penalties.filter(p => !p.paid).length,
        events_under_review: 0, // popolato dal trigger sui veri emtn_events
        last_activity_date: lastBookingDate,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'client_id' })

    // Eventi EMTN gia' aperti dal trigger (UNDER_REVIEW etc.) sono
    // un campo a parte; qui popoliamo solo i contatori derivati da DR7.
    const { data: stats } = await sb
        .from('emtn_stats_cache')
        .select('*')
        .eq('client_id', client!.id)
        .maybeSingle()

    // 22/09/2026 (direzione): niente OTP, il report e' sempre sbloccato.
    const unlocked = true
    const { data: events } = await sb
        .from('emtn_events')
        .select('*')
        .eq('client_id', client!.id)
        .order('created_at', { ascending: false })
        .limit(20)
    // '*' perche' `categorie` (migrazione 20260928) puo' mancare su un
    // database non aggiornato; al browser vanno solo questi campi.
    const recentEvents: unknown[] = (events || []).map((e: Record<string, unknown>) => ({
        id: e.id, type: e.type, status: e.status, headline: e.headline,
        occurred_at: e.occurred_at, created_at: e.created_at,
        categorie: Array.isArray(e.categorie) && e.categorie.length > 0 ? e.categorie : [e.type],
    }))

    await audit(sb, {
        operatorId, operatorEmail, action: 'SEARCH', success: true, ip, userAgent: ua,
        clientId: client!.id, metadata: { unlocked, estero },
    })

    // Risk band derivata da:
    //  - eventi EMTN approvati / under review (network-wide), OPPURE
    //  - cronologia DR7 interna (danni/penali NON pagati).
    // Se il cliente DR7 non ha pendenze e neanche eventi network, e'
    // green. Una sola pendenza non saldata -> yellow. Pendenze rilevanti
    // (>= 1000 EUR) o evento approvato nel network -> red.
    const sc = stats || { total_rentals: 0, regular_rentals: 0, negative_events: 0, events_under_review: 0 }
    // 28/09/2026: storico della rete EMTN (copie vendute): solo per codice
    // fiscale, anonimo. Un residuo non saldato altrove pesa come uno interno.
    const storicoRete = estero ? [] : await cercaStoricoRete(sb, cf)
    const reteResiduo = storicoRete.reduce((t, e) => t + (e.statoPagamento === 'paid' ? 0 : e.residuo), 0)
    const dr7Unpaid = unpaidDamageTotal + unpaidPenaltyTotal + reteResiduo
    const band: 'green' | 'yellow' | 'red' =
        sc.negative_events > 0 || dr7Unpaid >= 1000 ? 'red'
        : sc.events_under_review > 0 || dr7Unpaid > 0 ? 'yellow'
        : 'green'
    const message =
        band === 'green' ? 'Prenotazione confermata.'
        : band === 'yellow' ? 'La prenotazione e\' in verifica. Ti contatteremo a breve.'
        : 'La richiesta e\' in revisione amministrativa.'

    // Risk score numerico 0-100 derivato dalla cronologia.
    // Penalita\': ogni danno/penale mai avuto, anche gia' pagato (6 pt cad,
    // max 30), eventi negativi non saldati (8 pt cad), eventi under_review
    // (4 pt cad), pendenze danni/penali (1 pt ogni 50 EUR, max 25). Bonus
    // storico: +1 pt ogni 5 noleggi regolari (max 10). Floor 5, cap 100.
    // 01/10/2026: un danno pagato contava zero e il cliente restava a
    // 100/100. Chi ha anche un solo evento non torna mai sopra 90.
    const eventiStorici = dr7Damages.length + dr7Penalties.length + storicoRete.length
    const storicoPenalty = Math.min(30, eventiStorici * 6)
    const negPenalty = sc.negative_events * 8
    const reviewPenalty = sc.events_under_review * 4
    const unpaidPenalty = Math.min(25, Math.floor(dr7Unpaid / 50))
    const regularBonus = Math.min(10, Math.floor(sc.regular_rentals / 5))
    const tetto = eventiStorici > 0 || sc.events_under_review > 0 ? 90 : 100
    const riskScore = Math.max(5, Math.min(tetto, 100 - storicoPenalty - negPenalty - reviewPenalty - unpaidPenalty + regularBonus))
    const riskLevel = band === 'green' ? 1 : band === 'yellow' ? 2 : 3

    // Cliente arricchito: union dei campi emtn_clients + customers_extended
    // + derivati da bookings. Il frontend (EMTNClient) li legge tutti.
    const enrichedClient = {
        ...(client as Record<string, unknown>),
        email: ext?.email || null,
        phone: ext?.telefono || null,
        address: buildAddress(ext),
        customer_since: firstBookingDate || (ext?.created_at ?? null),
        last_seen_at: lastBookingDate,
        source: ext ? 'customers_extended' : 'emtn',
        date_of_birth: (client as { data_nascita?: string | null }).data_nascita || ext?.data_nascita || (cf ? dobFromCF(cf) : null),
        sex: cf ? sexFromCF(cf) : null,
        nationality: estero ? nazionalitaE : 'IT',
        events: sc.negative_events + sc.events_under_review,
    }

    return jsonResponse(200, {
        client: enrichedClient,
        stats: sc,
        riskBand: band,
        riskScore,
        riskLevel,
        message,
        reportUnlocked: unlocked,
        recentEvents,
        dr7History: {
            // Visibile sempre all'admin DR7: e' la cronologia interna
            // della tua azienda, niente OTP serve qui.
            totalBookings: totalRentals,
            regularBookings: regularRentals,
            damages: dr7Damages,
            penalties: dr7Penalties,
            unpaidDamageTotal: Math.round(unpaidDamageTotal * 100) / 100,
            unpaidPenaltyTotal: Math.round(unpaidPenaltyTotal * 100) / 100,
            lastBookingDate,
            firstBookingDate,
        },
        // Eventi di altri operatori della rete: nessun nome, nessun operatore.
        rete: {
            eventi: storicoRete,
            residuo: Math.round(reteResiduo * 100) / 100,
        },
    }, origin)
}
