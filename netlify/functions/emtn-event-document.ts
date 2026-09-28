/**
 * EMTN — POST /emtn-event-document
 *
 * Riceve UN file alla volta come multipart/form-data e lo carica nello
 * storage privato `emtn-documents`. Crea una riga in
 * emtn_event_documents con il path interno (NON l'URL pubblico —
 * quel bucket e' privato).
 *
 * Vincoli applicati: estensione allowlist (pdf/jpg/jpeg/png/webp/heic/
 * doc/docx), max 10MB, evento esistente, eventuale match operatore.
 *
 * Query / body:  ?eventId=<uuid>
 * Body:          multipart con field "document" (file singolo)
 */
import { Handler } from '@netlify/functions'
import { requireAuth } from './require-auth'
import {
    audit, clientIp, getServiceSupabase, jsonResponse,
} from './utils/emtn'
import { percorsoStorage } from '../../src/utils/percorsoStorage'
import { extractFirstFile } from './utils/multipartFile'

const ALLOWED_EXTS = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'doc', 'docx']
const MAX_BYTES = 10 * 1024 * 1024

export const handler: Handler = async (event) => {
    const origin = event.headers.origin || event.headers.Origin
    if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {}, origin)
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' }, origin)

    const { user, error: authErr } = await requireAuth(event)
    if (authErr) return authErr
    const operatorId = user!.id
    const operatorEmail = user!.email

    const sb = getServiceSupabase()
    const eventId = String(event.queryStringParameters?.eventId || '').trim()
    if (!eventId) return jsonResponse(400, { error: 'eventId obbligatorio (querystring)' }, origin)

    const ip = clientIp(event.headers as Record<string, string | undefined>)
    const ua = event.headers['user-agent'] || null

    // Verifica evento + operatore proprietario.
    const { data: ev } = await sb
        .from('emtn_events')
        .select('id, client_id, created_by_operator_id, status')
        .eq('id', eventId)
        .maybeSingle()
    if (!ev) {
        await audit(sb, { operatorId, operatorEmail, action: 'UPLOAD_DOCUMENT', success: false, ip, userAgent: ua, metadata: { reason: 'event_not_found', eventId } })
        return jsonResponse(404, { error: 'Evento non trovato' }, origin)
    }
    if (ev.created_by_operator_id !== operatorId) {
        await audit(sb, { operatorId, operatorEmail, clientId: ev.client_id, action: 'UPLOAD_DOCUMENT', success: false, ip, userAgent: ua, metadata: { reason: 'operator_mismatch', eventId } })
        return jsonResponse(403, { error: 'Non autorizzato' }, origin)
    }
    if (ev.status !== 'UNDER_REVIEW') {
        await audit(sb, { operatorId, operatorEmail, clientId: ev.client_id, action: 'UPLOAD_DOCUMENT', success: false, ip, userAgent: ua, metadata: { reason: 'event_closed', eventId } })
        return jsonResponse(409, { error: 'Evento gia\' chiuso, upload non consentito' }, origin)
    }

    // Body multipart.
    // Il boundary si legge dall'header ORIGINALE: minuscolizzarlo rompeva ogni
    // upload dal browser (Chrome manda "----WebKitFormBoundary...", con le
    // maiuscole) e il parser non trovava piu' nessuna parte nel body.
    const contentTypeRaw = event.headers['content-type'] || event.headers['Content-Type'] || ''
    const contentType = contentTypeRaw.toLowerCase()
    if (!contentType.startsWith('multipart/form-data')) {
        return jsonResponse(400, { error: 'Content-Type deve essere multipart/form-data' }, origin)
    }
    const boundaryMatch = contentTypeRaw.match(/boundary=([^;]+)/i)
    if (!boundaryMatch) return jsonResponse(400, { error: 'Boundary multipart mancante' }, origin)
    const boundary = boundaryMatch[1].trim().replace(/^"|"$/g, '')

    const rawBody = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64')
        : Buffer.from(event.body || '', 'binary')

    const file = extractFirstFile(rawBody, boundary)
    if (!file) return jsonResponse(400, { error: 'Nessun file trovato nel body' }, origin)

    const ext = (file.fileName.split('.').pop() || '').toLowerCase()
    if (!ALLOWED_EXTS.includes(ext)) {
        await audit(sb, { operatorId, operatorEmail, clientId: ev.client_id, action: 'UPLOAD_DOCUMENT', success: false, ip, userAgent: ua, metadata: { reason: 'ext_blocked', ext } })
        return jsonResponse(415, { error: `Estensione non consentita: ${ext}` }, origin)
    }
    if (file.data.length > MAX_BYTES) {
        await audit(sb, { operatorId, operatorEmail, clientId: ev.client_id, action: 'UPLOAD_DOCUMENT', success: false, ip, userAgent: ua, metadata: { reason: 'too_large', size: file.data.length } })
        return jsonResponse(413, { error: 'File troppo grande (max 10 MB)' }, origin)
    }

    // Path: emtn-documents/<eventId>/<timestamp>-<rand>.<ext>
    const safeName = file.fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60)
    // 26/09/2026 — percorso passato da percorsoStorage: un nome con accenti o spazi
    // faceva rifiutare il file allo storage (incidente firma "Huracán").
    const storagePath = percorsoStorage(`${eventId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`)

    const { error: upErr } = await sb.storage
        .from('emtn-documents')
        .upload(storagePath, file.data, {
            contentType: file.mime,
            upsert: false,
        })
    if (upErr) {
        await audit(sb, { operatorId, operatorEmail, clientId: ev.client_id, action: 'UPLOAD_DOCUMENT', success: false, ip, userAgent: ua, metadata: { reason: 'storage_failed', error: upErr.message } })
        return jsonResponse(500, { error: `Upload storage fallito: ${upErr.message}` }, origin)
    }

    const { data: doc, error: docErr } = await sb
        .from('emtn_event_documents')
        .insert({
            event_id: eventId,
            file_url: storagePath,        // path interno, NON URL pubblico
            file_name: safeName,
            file_type: file.mime,
            file_size: file.data.length,
            uploaded_by: operatorId,
        })
        .select('id, uploaded_at')
        .single()
    if (docErr) {
        await audit(sb, { operatorId, operatorEmail, clientId: ev.client_id, action: 'UPLOAD_DOCUMENT', success: false, ip, userAgent: ua, metadata: { reason: 'doc_insert_failed' } })
        return jsonResponse(500, { error: 'Registrazione documento fallita' }, origin)
    }

    await audit(sb, {
        operatorId, operatorEmail, clientId: ev.client_id, action: 'UPLOAD_DOCUMENT',
        success: true, ip, userAgent: ua,
        metadata: { event_id: eventId, doc_id: doc.id, size: file.data.length, mime: file.mime },
    })

    return jsonResponse(201, {
        id: doc.id,
        uploadedAt: doc.uploaded_at,
        fileName: safeName,
    }, origin)
}
