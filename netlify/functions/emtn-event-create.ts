/**
 * EMTN — POST /emtn-event-create
 *
 * Crea un evento UNDER_REVIEW. La segnalazione SENZA documenti viene
 * accettata in DB ma considerata incompleta finche' arriva
 * almeno un upload via emtn-event-document.
 *
 * Body: { clientId, bookingId, type, headline, description, occurredAt? }
 */
import { Handler } from '@netlify/functions'
import { requireAuth } from './require-auth'
import {
    audit, clientIp, getServiceSupabase, jsonResponse, requireActiveBooking,
} from './utils/emtn'

const ALLOWED_TYPES = ['UNPAID_DAMAGE', 'INSOLVENCY', 'NON_RETURN', 'THEFT_REPORTED', 'LEGAL_EVENT']

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
    const type = String(body.type || '').toUpperCase()
    const headline = String(body.headline || '').trim()
    const description = String(body.description || '').trim()
    const occurredAt = body.occurredAt ? String(body.occurredAt) : null

    const ip = clientIp(event.headers as Record<string, string | undefined>)
    const ua = event.headers['user-agent'] || null

    if (!clientId) return jsonResponse(400, { error: 'clientId obbligatorio' }, origin)
    if (!ALLOWED_TYPES.includes(type)) return jsonResponse(400, { error: 'Tipo evento non valido' }, origin)
    if (!headline || headline.length < 5) return jsonResponse(400, { error: 'Titolo troppo breve (min 5 caratteri)' }, origin)
    if (!description || description.length < 20) return jsonResponse(400, { error: 'Descrizione troppo breve (min 20 caratteri)' }, origin)

    const gate = await requireActiveBooking(sb, bookingId)
    if (gate.error) {
        await audit(sb, { operatorId, operatorEmail, clientId, action: 'REPORT_EVENT', success: false, ip, userAgent: ua, metadata: { reason: gate.error } })
        return jsonResponse(403, { error: gate.error }, origin)
    }

    const { data: created, error: insErr } = await sb
        .from('emtn_events')
        .insert({
            client_id: clientId,
            type,
            status: 'UNDER_REVIEW',
            headline,
            description,
            occurred_at: occurredAt,
            created_by_operator_id: operatorId,
            created_by_email: operatorEmail || null,
            booking_id: bookingId,
        })
        .select('id, status, created_at')
        .single()

    if (insErr || !created) {
        await audit(sb, { operatorId, operatorEmail, clientId, bookingId, action: 'REPORT_EVENT', success: false, ip, userAgent: ua, metadata: { reason: 'insert_failed', error: insErr?.message } })
        return jsonResponse(500, { error: 'Creazione evento fallita' }, origin)
    }

    await audit(sb, {
        operatorId, operatorEmail, clientId, bookingId, action: 'REPORT_EVENT',
        success: true, ip, userAgent: ua,
        metadata: { event_id: created.id, type },
    })

    return jsonResponse(201, {
        id: created.id,
        status: created.status,
        createdAt: created.created_at,
        documentsRequired: true,
    }, origin)
}
