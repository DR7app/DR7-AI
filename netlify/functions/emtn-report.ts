/**
 * EMTN — POST /emtn-report
 *
 * Restituisce il Mobility Risk Report completo per (operatore, cliente).
 * Hard rule: "no report visibility without OTP verified". Verifica
 * isReportUnlocked prima di emettere qualunque dettaglio.
 *
 * Body: { clientId, bookingId }
 */
import { Handler } from '@netlify/functions'
import { requireAuth } from './require-auth'
import {
    audit, clientIp, getServiceSupabase, isReportUnlocked,
    jsonResponse, requireActiveBooking,
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

    const clientId = String(body.clientId || '').trim()
    const bookingId = String(body.bookingId || '').trim() || null
    const ip = clientIp(event.headers as Record<string, string | undefined>)
    const ua = event.headers['user-agent'] || null

    if (!clientId) return jsonResponse(400, { error: 'clientId obbligatorio' }, origin)
    const gate = await requireActiveBooking(sb, bookingId)
    if (gate.error) {
        await audit(sb, { operatorId, operatorEmail, clientId, action: 'VIEW_REPORT', success: false, ip, userAgent: ua, metadata: { reason: gate.error } })
        return jsonResponse(403, { error: gate.error }, origin)
    }

    const unlocked = await isReportUnlocked(sb, operatorId, clientId)
    if (!unlocked) {
        await audit(sb, { operatorId, operatorEmail, clientId, bookingId, action: 'VIEW_REPORT', success: false, ip, userAgent: ua, metadata: { reason: 'no_otp' } })
        return jsonResponse(403, { error: 'Autorizzazione cliente non verificata' }, origin)
    }

    const { data: client } = await sb
        .from('emtn_clients')
        .select('id, codice_fiscale, nome, cognome, data_nascita, created_at')
        .eq('id', clientId)
        .maybeSingle()
    if (!client) {
        await audit(sb, { operatorId, operatorEmail, clientId, bookingId, action: 'VIEW_REPORT', success: false, ip, userAgent: ua, metadata: { reason: 'client_not_found' } })
        return jsonResponse(404, { error: 'Cliente non trovato' }, origin)
    }

    const { data: stats } = await sb
        .from('emtn_stats_cache')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle()

    // Eventi: solo APPROVED (visibili nel network) + UNDER_REVIEW propri
    // dell'operatore corrente. Niente visibilita' su REJECTED altrui.
    const { data: approved } = await sb
        .from('emtn_events')
        .select('id, type, status, headline, occurred_at, created_at')
        .eq('client_id', clientId)
        .eq('status', 'APPROVED')
        .order('created_at', { ascending: false })
        .limit(50)

    const { data: own } = await sb
        .from('emtn_events')
        .select('id, type, status, headline, occurred_at, created_at')
        .eq('client_id', clientId)
        .eq('created_by_operator_id', operatorId)
        .neq('status', 'APPROVED')
        .order('created_at', { ascending: false })
        .limit(20)

    await audit(sb, {
        operatorId, operatorEmail, clientId, bookingId, action: 'VIEW_REPORT',
        success: true, ip, userAgent: ua,
    })

    return jsonResponse(200, {
        client,
        stats: stats || null,
        approvedEvents: approved || [],
        myOpenEvents: own || [],
    }, origin)
}
