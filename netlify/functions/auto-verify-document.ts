/**
 * auto-verify-document
 *
 * For a given user_documents row, run OCR via extract-document-data and
 * compare the extracted fields with the customer profile. Update the row's
 * status to 'verified', 'rejected' (with a reason), or leave it pending.
 *
 * Decision matrix (intentionally conservative — keep humans in the loop on
 * doubt):
 *   - VERIFY when: confidence=high AND every field present in BOTH the
 *     extract and the profile matches.
 *   - REJECT when: any present field clearly mismatches the profile, or the
 *     document is expired (carta identità / patente scadenza in the past).
 *   - PENDING otherwise (low confidence, missing data on one side, etc.) —
 *     attaches the extracted data as a note for the human reviewer.
 */

import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { getCorsOrigin } from './cors-headers'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface Extracted {
  nome?: string
  cognome?: string
  codice_fiscale?: string
  data_nascita?: string
  documento_numero?: string
  documento_scadenza?: string
  patente_numero?: string
  patente_scadenza?: string
  document_type?: string
  confidence?: 'high' | 'medium' | 'low'
  notes?: string
}

interface Profile {
  nome?: string | null
  cognome?: string | null
  codice_fiscale?: string | null
  data_nascita?: string | null
  numero_patente?: string | null
}

const norm = (s: string | null | undefined) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')

function compare(extracted: Extracted, profile: Profile, docType: string) {
  const mismatches: string[] = []
  const matches: string[] = []
  const today = new Date().toISOString().slice(0, 10)

  // Name match
  if (extracted.cognome && profile.cognome) {
    if (norm(extracted.cognome) === norm(profile.cognome)) matches.push('cognome')
    else mismatches.push(`cognome: ${extracted.cognome} ≠ ${profile.cognome}`)
  }
  if (extracted.nome && profile.nome) {
    if (norm(extracted.nome) === norm(profile.nome)) matches.push('nome')
    else mismatches.push(`nome: ${extracted.nome} ≠ ${profile.nome}`)
  }

  // CF
  if (extracted.codice_fiscale && profile.codice_fiscale) {
    if (extracted.codice_fiscale.toUpperCase() === profile.codice_fiscale.toUpperCase()) matches.push('codice_fiscale')
    else mismatches.push(`codice fiscale: ${extracted.codice_fiscale} ≠ ${profile.codice_fiscale}`)
  }

  // DOB
  if (extracted.data_nascita && profile.data_nascita) {
    if (extracted.data_nascita === profile.data_nascita.slice(0, 10)) matches.push('data_nascita')
    else mismatches.push(`data nascita: ${extracted.data_nascita} ≠ ${profile.data_nascita}`)
  }

  // Patente number (only front carries it)
  if (docType.startsWith('patente') && extracted.patente_numero && profile.numero_patente) {
    if (extracted.patente_numero.toUpperCase() === profile.numero_patente.toUpperCase()) matches.push('patente_numero')
    else mismatches.push(`patente: ${extracted.patente_numero} ≠ ${profile.numero_patente}`)
  }

  // Expiry checks
  const expiry = extracted.documento_scadenza || extracted.patente_scadenza
  const expired = expiry && expiry < today
  if (expired) mismatches.push(`documento scaduto il ${expiry}`)

  return { matches, mismatches, expired: !!expired }
}

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server not configured' }) }
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

  try {
    const { documentId } = JSON.parse(event.body || '{}')
    if (!documentId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'documentId required' }) }

    // 1. Fetch the doc row
    const { data: doc, error: docErr } = await supabase
      .from('user_documents')
      .select('id, user_id, document_type, bucket, file_path, status')
      .eq('id', documentId)
      .single()
    if (docErr || !doc) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Document not found' }) }
    }
    if (doc.status !== 'pending_verification') {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: true, reason: `status is ${doc.status}` }) }
    }

    // 2. Profile lookup — try by auth user_id first, then by .id (legacy
    //    admin-uploaded docs where user_id is actually the row PK)
    let { data: profile } = await supabase
      .from('customers_extended')
      .select('nome, cognome, codice_fiscale, data_nascita, numero_patente')
      .eq('user_id', doc.user_id)
      .maybeSingle()

    if (!profile) {
      const fb = await supabase
        .from('customers_extended')
        .select('nome, cognome, codice_fiscale, data_nascita, numero_patente')
        .eq('id', doc.user_id)
        .maybeSingle()
      profile = fb.data
    }

    if (!profile) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: true, reason: 'no customers_extended row' }) }
    }

    // 3. Signed URL for the image
    const { data: signed, error: signErr } = await supabase.storage
      .from(doc.bucket)
      .createSignedUrl(doc.file_path, 600)
    if (signErr || !signed?.signedUrl) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to sign URL', details: signErr?.message }) }
    }

    // 4. Call OCR (extract-document-data is on the same Netlify site)
    const origin = event.headers['x-forwarded-proto'] && event.headers.host
      ? `${event.headers['x-forwarded-proto']}://${event.headers.host}`
      : process.env.URL || ''
    const ocrRes = await fetch(`${origin}/.netlify/functions/extract-document-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: signed.signedUrl }),
    })
    const ocrJson = await ocrRes.json().catch(() => null)
    if (!ocrRes.ok || !ocrJson?.success) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'OCR failed', details: ocrJson }) }
    }
    const extracted: Extracted = ocrJson.data || {}

    // 5. Compare
    const cmp = compare(extracted, profile as Profile, doc.document_type)

    // 6. Decide
    let decision: 'verified' | 'rejected' | 'pending_verification' = 'pending_verification'
    let reason: string | null = null

    if (cmp.expired) {
      decision = 'rejected'
      reason = `Auto-rifiuto: ${cmp.mismatches.find(m => m.startsWith('documento scaduto')) || 'documento scaduto'}`
    } else if (cmp.mismatches.length > 0) {
      decision = 'rejected'
      reason = `Auto-rifiuto: dati non coincidono — ${cmp.mismatches.slice(0, 2).join('; ')}`
    } else if (extracted.confidence === 'high' && cmp.matches.length >= 2) {
      decision = 'verified'
    } else {
      reason = `Auto-revisione necessaria (confidence=${extracted.confidence || 'n/d'}, match=${cmp.matches.length})${extracted.notes ? ' — ' + extracted.notes : ''}`
    }

    // 7. Apply
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const update: any = {
      status: decision,
    }
    if (decision === 'verified') {
      update.verified_at = new Date().toISOString()
      update.verified_by = null // system
    }
    if (decision === 'rejected') {
      update.rejection_reason = reason
    }
    const { error: upErr } = await supabase.from('user_documents').update(update).eq('id', documentId)
    if (upErr) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'DB update failed', details: upErr.message }) }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        documentId,
        decision,
        reason,
        matches: cmp.matches,
        mismatches: cmp.mismatches,
        confidence: extracted.confidence,
      }),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[auto-verify-document]', msg)
    return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) }
  }
}
