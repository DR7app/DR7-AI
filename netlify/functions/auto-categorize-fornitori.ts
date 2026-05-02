import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Heuristics: longest/most-specific patterns first; first match wins.
// Matches against lowercased nome.
const RULES: { keywords: string[]; categoria: string }[] = [
  // Pneumatici
  { keywords: ['gomme', 'pneumatic', 'tyres', 'tires', 'sotgia gomme'], categoria: 'pneumatici' },
  // Carburante
  { keywords: ['carburant', 'benzina', 'gasolio', ' eni ', 'q8 ', 'esso', 'agip', 'tamoil', 'ip s.p.a', 'shell ', 'erg ', 'enifuel'], categoria: 'carburante' },
  // Ricambi
  { keywords: ['autoricambi', 'ricambi', 'auto parts', 'dap autoricambi', 'lobrano'], categoria: 'ricambi' },
  // Manutenzione / officina
  { keywords: ['officina', 'meccanic', 'autofficina', 'carrozzeria', 'demuro', 'demontis', 'corriga'], categoria: 'manutenzione' },
  // Lavaggio prodotti
  { keywords: ['lavaggio', 'detergent', 'kim car', 'plastisak', 'cartaria val.dy'], categoria: 'lavaggio_prodotti' },
  // Pulizia
  { keywords: ['pulizia', 'cleaning'], categoria: 'pulizia' },
  // Utenze
  { keywords: ['enel ', 'e.on', 'eon ', 'abbanoa', 'tim s.p.a', 'tim spa', 'vodafone', 'wind ', 'fastweb', 'iliad', 'sorgenia', 'a2a', 'edison'], categoria: 'utenze' },
  // Ufficio / cloud
  { keywords: ['google', 'amazon eu', 'amazon web', 'microsoft', 'aruba pec', 'aruba spa', 'cloud', 'openapi', 'subito.it', 'goffi', 'agenzia entrate', 'pratiche auto'], categoria: 'ufficio' },
  // Consulenze
  { keywords: ['consulen', 'commercialist', 'studio legal', 'avvocat', 'notar'], categoria: 'consulenze' },
  // Noleggio attrezzature
  { keywords: ['leasys', 'arval', 'noleggio attrezzat', 'b.k. luxury rent', 'bk luxury', 'begaj kujtim'], categoria: 'noleggio_attrezzature' },
]

function categorize(nome: string): string | null {
  const lower = (nome || '').toLowerCase()
  if (!lower) return null
  for (const rule of RULES) {
    if (rule.keywords.some(k => lower.includes(k))) return rule.categoria
  }
  return null
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
    const overwrite: boolean = !!body.overwrite

    // Fetch fornitori (only uncategorized unless overwrite=true)
    let q = supabase.from('fornitori').select('id, nome, categoria_merce').eq('attivo', true)
    if (!overwrite) q = q.is('categoria_merce', null)
    const { data: fornitori, error } = await q
    if (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) }
    }

    const updates: { id: string; categoria_merce: string }[] = []
    const skipped: { nome: string; reason: string }[] = []
    for (const f of fornitori || []) {
      const cat = categorize(f.nome)
      if (cat) {
        updates.push({ id: f.id, categoria_merce: cat })
      } else {
        skipped.push({ nome: f.nome, reason: 'no rule match' })
      }
    }

    let updated = 0
    // Batch updates (one per row — Supabase doesn't support upsert-on-id with select fields)
    for (const u of updates) {
      const { error: upErr } = await supabase
        .from('fornitori')
        .update({ categoria_merce: u.categoria_merce })
        .eq('id', u.id)
      if (!upErr) updated++
    }

    // Tally per category
    const byCategoria: Record<string, number> = {}
    for (const u of updates) byCategoria[u.categoria_merce] = (byCategoria[u.categoria_merce] || 0) + 1

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        scanned: (fornitori || []).length,
        updated,
        unmatched: skipped.length,
        byCategoria,
        skipped_examples: skipped.slice(0, 10),
      })
    }
  } catch (err: any) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ success: false, error: err?.message || String(err) })
    }
  }
}
