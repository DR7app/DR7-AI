/**
 * EMTN — POST /emtn-analisi-documento?analisiId=<uuid>
 *
 * Un documento alla volta (multipart, campo "document") per una pratica in
 * preparazione. Il file va nello storage privato `emtn-documents` e la pratica
 * ne tiene nome, tipo, dimensione e impronta SHA-256 (audit trail: versione
 * univoca del documento, workflow EMTN).
 *
 * Solo formati che l'analisi AI sa leggere: PDF e immagini JPG/PNG/WEBP.
 */
import { Handler } from '@netlify/functions'
import crypto from 'crypto'
import { requireAuth } from './require-auth'
import { audit, clientIp, getServiceSupabase, jsonResponse } from './utils/emtn'
import { extractFirstFile } from './utils/multipartFile'
import { MIME_LEGGIBILI } from './utils/emtnAnalisiAI'
import { percorsoStorage } from '../../src/utils/percorsoStorage'

const MAX_BYTES = 10 * 1024 * 1024
const MAX_DOCUMENTI = 15

export const handler: Handler = async (event) => {
    const origin = event.headers.origin || event.headers.Origin
    if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {}, origin)
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' }, origin)

    const { user, error: authErr } = await requireAuth(event)
    if (authErr) return authErr
    const operatorId = user!.id
    const operatorEmail = user!.email
    const sb = getServiceSupabase()
    const ip = clientIp(event.headers as Record<string, string | undefined>)
    const ua = event.headers['user-agent'] || null

    const analisiId = String(event.queryStringParameters?.analisiId || '').trim()
    if (!analisiId) return jsonResponse(400, { error: 'analisiId obbligatorio' }, origin)
    const { data: analisi } = await sb.from('emtn_analisi').select('id, client_id, stato, documenti, created_by').eq('id', analisiId).maybeSingle()
    if (!analisi) return jsonResponse(404, { error: 'Pratica non trovata' }, origin)
    if (analisi.created_by !== operatorId) return jsonResponse(403, { error: 'Non autorizzato' }, origin)
    if (analisi.stato === 'in_corso' || analisi.stato === 'inviata') return jsonResponse(409, { error: 'Pratica gia\' in analisi o inviata: documenti non modificabili' }, origin)
    const documenti = Array.isArray(analisi.documenti) ? analisi.documenti : []
    if (documenti.length >= MAX_DOCUMENTI) return jsonResponse(400, { error: `Massimo ${MAX_DOCUMENTI} documenti per pratica` }, origin)

    const contentTypeRaw = event.headers['content-type'] || event.headers['Content-Type'] || ''
    if (!contentTypeRaw.toLowerCase().startsWith('multipart/form-data')) return jsonResponse(400, { error: 'Content-Type deve essere multipart/form-data' }, origin)
    const boundaryMatch = contentTypeRaw.match(/boundary=([^;]+)/i)
    if (!boundaryMatch) return jsonResponse(400, { error: 'Boundary multipart mancante' }, origin)
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'binary')
    const file = extractFirstFile(rawBody, boundaryMatch[1].trim().replace(/^"|"$/g, ''))
    if (!file) return jsonResponse(400, { error: 'Nessun file trovato nel body' }, origin)

    const ext = (file.fileName.split('.').pop() || '').toLowerCase()
    if (!MIME_LEGGIBILI[ext]) return jsonResponse(415, { error: `Formato non leggibile dall'analisi: .${ext}. Carica PDF, JPG, PNG o WEBP.` }, origin)
    if (file.data.length > MAX_BYTES) return jsonResponse(413, { error: 'File troppo grande (max 10 MB)' }, origin)

    const hash = crypto.createHash('sha256').update(file.data).digest('hex')
    if (documenti.some((d: { sha256?: string }) => d.sha256 === hash)) return jsonResponse(409, { error: 'Documento gia\' caricato in questa pratica' }, origin)

    const nome = file.fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
    const path = percorsoStorage(`analisi/${analisiId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${nome}`)
    const { error: upErr } = await sb.storage.from('emtn-documents').upload(path, file.data, { contentType: file.mime, upsert: false })
    if (upErr) return jsonResponse(500, { error: `Upload storage fallito: ${upErr.message}` }, origin)

    const doc = { path, nome, mime: file.mime, estensione: ext, size: file.data.length, sha256: hash, caricato_at: new Date().toISOString(), caricato_da: operatorEmail || operatorId }
    const { error: updErr } = await sb.from('emtn_analisi').update({ documenti: [...documenti, doc], stato: 'caricamento' }).eq('id', analisiId)
    if (updErr) return jsonResponse(500, { error: 'Registrazione documento fallita' }, origin)

    await audit(sb, { operatorId, operatorEmail, clientId: analisi.client_id, action: 'UPLOAD_DOCUMENT', success: true, ip, userAgent: ua, metadata: { analisi_id: analisiId, nome, sha256: hash, size: file.data.length } })
    return jsonResponse(201, { documento: { nome, size: doc.size, sha256: hash } }, origin)
}
