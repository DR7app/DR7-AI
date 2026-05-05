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
    requireActiveBooking,
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
    const bookingId = String(body.bookingId || '').trim() || null
    const ip = clientIp(event.headers as Record<string, string | undefined>)
    const ua = event.headers['user-agent'] || null

    // Hard rule 1: CF obbligatorio e formalmente valido.
    if (!isValidCF(cf)) {
        await audit(sb, { operatorId, operatorEmail, action: 'SEARCH', success: false, ip, userAgent: ua, metadata: { reason: 'invalid_cf', cf } })
        return jsonResponse(400, { error: 'Codice fiscale mancante o invalido' }, origin)
    }

    // Hard rule 2: booking_id obbligatorio + valido.
    const gate = await requireActiveBooking(sb, bookingId)
    if (gate.error) {
        await audit(sb, { operatorId, operatorEmail, action: 'SEARCH', success: false, ip, userAgent: ua, metadata: { reason: 'no_booking', cf, bookingId } })
        return jsonResponse(403, { error: gate.error }, origin)
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
            await audit(sb, { operatorId, operatorEmail, action: 'SEARCH', success: false, ip, userAgent: ua, metadata: { reason: 'insert_failed', error: insErr.message } })
            return jsonResponse(500, { error: 'Inserimento cliente fallito' }, origin)
        }
        client = created
    }

    // Stats from cache (created lazily by trigger when first event lands).
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
        clientId: client!.id, bookingId, metadata: { unlocked },
    })

    // Risk band derivata application-side dalle stats.
    const sc = stats || { total_rentals: 0, regular_rentals: 0, negative_events: 0, events_under_review: 0 }
    const band: 'green' | 'yellow' | 'red' =
        sc.negative_events > 0 ? 'red'
        : sc.events_under_review > 0 ? 'yellow'
        : 'green'
    const message =
        band === 'green' ? 'Prenotazione confermata.'
        : band === 'yellow' ? 'La prenotazione e\' in verifica. Ti contatteremo a breve.'
        : 'La richiesta e\' in revisione amministrativa.'

    return jsonResponse(200, {
        client,
        stats: sc,
        riskBand: band,
        message,
        reportUnlocked: unlocked,
        recentEvents,
        booking: gate.booking,
    }, origin)
}
