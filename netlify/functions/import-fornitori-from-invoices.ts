import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

function normalizeVat(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/\D/g, '')
}

interface SupplierInput {
  nome: string
  piva?: string | null
}

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const suppliers: SupplierInput[] = body.suppliers || []
    if (!Array.isArray(suppliers) || suppliers.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'suppliers array required' }) }
    }

    // Dedupe input by normalized P.IVA (or by lowercased name when no P.IVA)
    const seen = new Map<string, SupplierInput>()
    for (const s of suppliers) {
      const vat = normalizeVat(s.piva)
      const key = vat || `name:${(s.nome || '').toLowerCase().trim()}`
      if (!key) continue
      if (!seen.has(key)) seen.set(key, { nome: (s.nome || '').trim(), piva: vat || null })
    }
    const dedup = Array.from(seen.values()).filter(s => s.nome)

    // Fetch existing fornitori to skip duplicates
    const { data: existing, error: fetchErr } = await supabase
      .from('fornitori')
      .select('nome, piva')
    if (fetchErr) {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: fetchErr.message }) }
    }
    const existingVats = new Set<string>()
    const existingNames = new Set<string>()
    for (const e of existing || []) {
      const v = normalizeVat(e.piva)
      if (v) existingVats.add(v)
      if (e.nome) existingNames.add(e.nome.toLowerCase().trim())
    }

    const toInsert = dedup.filter(s => {
      if (s.piva && existingVats.has(s.piva)) return false
      if (!s.piva && existingNames.has(s.nome.toLowerCase().trim())) return false
      return true
    }).map(s => ({
      nome: s.nome,
      piva: s.piva || null,
      attivo: true,
      note: 'Importato da fatture Aruba',
    }))

    let added = 0
    if (toInsert.length > 0) {
      const { data, error } = await supabase
        .from('fornitori')
        .insert(toInsert)
        .select('id')
      if (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) }
      }
      added = data?.length || 0
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        added,
        skipped: dedup.length - added,
        total_input: suppliers.length,
        unique_input: dedup.length,
      })
    }
  } catch (err: any) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ success: false, error: err?.message || String(err) })
    }
  }
}
