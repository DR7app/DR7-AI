/**
 * EMTN — POST /emtn-event-create
 *
 * Crea un evento UNDER_REVIEW. La segnalazione SENZA documenti viene
 * accettata in DB ma considerata incompleta finche' arriva
 * almeno un upload via emtn-event-document.
 *
 * Body: { clientId, bookingId, types[] (o type), headline, description, occurredAt? }
 *
 * 28/09/2026: piu' categorie per segnalazione. `type` = la prima (principale),
 * `categorie` = tutte.
 */
import { Handler } from '@netlify/functions'
import { requireAuth } from './require-auth'
import {
    audit, clientIp, getServiceSupabase, jsonResponse,
} from './utils/emtn'

const ALLOWED_TYPES = ['UNPAID_DAMAGE', 'UNPAID_PENALTY', 'INSOLVENCY', 'NON_RETURN', 'THEFT_REPORTED', 'LEGAL_EVENT']

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
    const richieste: unknown[] = Array.isArray(body.types) ? body.types : [body.type]
    const categorie = [...new Set(richieste.map(t => String(t || '').toUpperCase()).filter(Boolean))]
    const type = categorie[0] || ''
    const headline = String(body.headline || '').trim()
    const description = String(body.description || '').trim()
    const occurredAt = body.occurredAt ? String(body.occurredAt) : null

    const ip = clientIp(event.headers as Record<string, string | undefined>)
    const ua = event.headers['user-agent'] || null

    if (!clientId) return jsonResponse(400, { error: 'clientId obbligatorio' }, origin)
    if (categorie.length === 0) return jsonResponse(400, { error: 'Scegli almeno una categoria' }, origin)
    if (categorie.some(t => !ALLOWED_TYPES.includes(t))) return jsonResponse(400, { error: 'Tipo evento non valido' }, origin)
    if (!headline || headline.length < 5) return jsonResponse(400, { error: 'Titolo troppo breve (min 5 caratteri)' }, origin)
    if (!description || description.length < 20) return jsonResponse(400, { error: 'Descrizione troppo breve (min 20 caratteri)' }, origin)

    const riga = {
        client_id: clientId,
        type,
        status: 'UNDER_REVIEW',
        headline,
        description,
        occurred_at: occurredAt,
        created_by_operator_id: operatorId,
        created_by_email: operatorEmail || null,
    }
    let { data: created, error: insErr } = await sb
        .from('emtn_events')
        .insert({ ...riga, categorie })
        .select('id, status, created_at')
        .single()
    // Database senza la migrazione 20260928 (colonna `categorie` assente):
    // si salva la sola categoria principale invece di fallire.
    if (insErr && (insErr.code === '42703' || insErr.code === 'PGRST204')) {
        ({ data: created, error: insErr } = await sb
            .from('emtn_events')
            .insert(riga)
            .select('id, status, created_at')
            .single())
    }

    if (insErr || !created) {
        await audit(sb, { operatorId, operatorEmail, clientId, action: 'REPORT_EVENT', success: false, ip, userAgent: ua, metadata: { reason: 'insert_failed', error: insErr?.message } })
        return jsonResponse(500, { error: 'Creazione evento fallita' }, origin)
    }

    await audit(sb, {
        operatorId, operatorEmail, clientId, action: 'REPORT_EVENT',
        success: true, ip, userAgent: ua,
        metadata: { event_id: created.id, type, categorie },
    })

    return jsonResponse(201, {
        id: created.id,
        status: created.status,
        createdAt: created.created_at,
        documentsRequired: true,
    }, origin)
}
