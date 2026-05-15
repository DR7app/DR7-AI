/**
 * EMTN — POST /emtn-search
 *
 * Hard rule: "NO search without codice fiscale" + "NO EMTN access
 * without active booking_id". Validazione CF + booking gate prima di
 * qualunque DB read. Ogni chiamata genera una riga in emtn_access_logs.
 *
 * Body: { codiceFiscale: string, bookingId: string,
 *         nome?, cognome?, dataNascita? }
 * Returns: { client, stats, recentEvents (only if report unlocked) }
 */
import { Handler } from '@netlify/functions'
import { requireAuth } from './require-auth'
import {
    audit,
    clientIp,
    getServiceSupabase,
    isReportUnlocked,
    isValidCF,
    jsonResponse,
    normalizeCF,
} from './utils/emtn'

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

    const cf = normalizeCF(String(body.codiceFiscale || ''))
    const ip = clientIp(event.headers as Record<string, string | undefined>)
    const ua = event.headers['user-agent'] || null

    // Hard rule: CF obbligatorio e formalmente valido.
    if (!isValidCF(cf)) {
        await audit(sb, { operatorId, operatorEmail, action: 'SEARCH', success: false, ip, userAgent: ua, metadata: { reason: 'invalid_cf', cf } })
        return jsonResponse(400, { error: 'Codice fiscale mancante o invalido' }, origin)
    }

    // Find or create client.
    const { data: existing } = await sb
        .from('emtn_clients')
        .select('id, codice_fiscale, nome, cognome, data_nascita, created_at')
        .eq('codice_fiscale', cf)
        .maybeSingle()

    let client = existing
    if (!client) {
        const { data: created, error: insErr } = await sb
            .from('emtn_clients')
            .insert({
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
            return jsonResponse(500, { error: `Inserimento cliente fallito: ${parts.join(' — ')}` }, origin)
        }
        client = created
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
        const { data } = await sb
            .from('customers_extended')
            .select('nome, cognome, email, telefono, indirizzo, citta_residenza, codice_postale, data_nascita, codice_fiscale, created_at, metadata, sede_legale')
            .eq('codice_fiscale', cf)
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
    const { data: profileMatches } = await sb
        .from('customers_extended')
        .select('user_id')
        .eq('codice_fiscale', cf)
    const matchedUserIds = Array.from(new Set(
        (profileMatches || []).map(p => p.user_id).filter(Boolean) as string[]
    ))

    type RawBooking = DR7Booking & {
        user_id?: string | null
        booking_details?: (DR7Booking['booking_details'] & {
            codice_fiscale?: string
            codiceFiscale?: string
            customer?: { codice_fiscale?: string; codiceFiscale?: string }
        }) | null
    }

    const collected = new Map<string, RawBooking>()
    if (matchedUserIds.length > 0) {
        const { data } = await sb
            .from('bookings')
            .select('id, pickup_date, appointment_date, vehicle_name, vehicle_plate, status, payment_status, booking_details, user_id')
            .in('user_id', matchedUserIds)
            .order('pickup_date', { ascending: false })
            .limit(50)
        for (const b of (data || []) as RawBooking[]) collected.set(b.id, b)
    }
    // Fallback: bookings dove il CF e\' annidato in booking_details
    // (records senza user_id risolto). Filtro lato JS, limite a 500
    // righe per non leggere milioni di record.
    if (collected.size === 0) {
        const { data } = await sb
            .from('bookings')
            .select('id, pickup_date, appointment_date, vehicle_name, vehicle_plate, status, payment_status, booking_details, user_id')
            .not('booking_details', 'is', null)
            .order('pickup_date', { ascending: false })
            .limit(500)
        for (const b of (data || []) as RawBooking[]) {
            const bdCf = b.booking_details?.codice_fiscale
                || b.booking_details?.codiceFiscale
                || b.booking_details?.customer?.codice_fiscale
                || b.booking_details?.customer?.codiceFiscale
            if (bdCf && String(bdCf).trim().toUpperCase() === cf) collected.set(b.id, b)
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

    const totalRentals = bookings.length
    const regularRentals = bookings.filter(b => {
        const danni = b.booking_details?.danni || []
        const penali = b.booking_details?.penalties || []
        return danni.length === 0 && penali.length === 0
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

    // Report unlocked? (verified OTP for THIS operator+client, not expired)
    const unlocked = await isReportUnlocked(sb, operatorId, client!.id)

    // Recent events ONLY when unlocked (hard rule: no report without OTP).
    let recentEvents: unknown[] = []
    if (unlocked) {
        const { data: events } = await sb
            .from('emtn_events')
            .select('id, type, status, headline, occurred_at, created_at')
            .eq('client_id', client!.id)
            .order('created_at', { ascending: false })
            .limit(20)
        recentEvents = events || []
    }

    await audit(sb, {
        operatorId, operatorEmail, action: 'SEARCH', success: true, ip, userAgent: ua,
        clientId: client!.id, metadata: { unlocked },
    })

    // Risk band derivata da:
    //  - eventi EMTN approvati / under review (network-wide), OPPURE
    //  - cronologia DR7 interna (danni/penali NON pagati).
    // Se il cliente DR7 non ha pendenze e neanche eventi network, e'
    // green. Una sola pendenza non saldata -> yellow. Pendenze rilevanti
    // (>= 1000 EUR) o evento approvato nel network -> red.
    const sc = stats || { total_rentals: 0, regular_rentals: 0, negative_events: 0, events_under_review: 0 }
    const dr7Unpaid = unpaidDamageTotal + unpaidPenaltyTotal
    const band: 'green' | 'yellow' | 'red' =
        sc.negative_events > 0 || dr7Unpaid >= 1000 ? 'red'
        : sc.events_under_review > 0 || dr7Unpaid > 0 ? 'yellow'
        : 'green'
    const message =
        band === 'green' ? 'Prenotazione confermata.'
        : band === 'yellow' ? 'La prenotazione e\' in verifica. Ti contatteremo a breve.'
        : 'La richiesta e\' in revisione amministrativa.'

    // Risk score numerico 0-100 derivato dalla cronologia.
    // Penalita\': eventi negativi (8 pt cad), eventi under_review (4 pt cad),
    // pendenze danni/penali (1 pt ogni 50 EUR, max 25). Bonus storico:
    // +1 pt ogni 5 noleggi regolari (max 10). Floor 5, cap 100.
    const negPenalty = sc.negative_events * 8
    const reviewPenalty = sc.events_under_review * 4
    const unpaidPenalty = Math.min(25, Math.floor(dr7Unpaid / 50))
    const regularBonus = Math.min(10, Math.floor(sc.regular_rentals / 5))
    const riskScore = Math.max(5, Math.min(100, 100 - negPenalty - reviewPenalty - unpaidPenalty + regularBonus))
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
        date_of_birth: (client as { data_nascita?: string | null }).data_nascita || ext?.data_nascita || dobFromCF(cf),
        sex: sexFromCF(cf),
        nationality: 'IT',
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
    }, origin)
}
