import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const OPENAPI_TOKEN = process.env.OPENAPI_AUTOMOTIVE_TOKEN || ''
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null

interface PlateRow {
  plate: string
  brand: string | null
  model: string | null
  make_model: string | null
  description: string | null
  year: string | null
  fuel: string | null
  power_cv: string | null
  displacement: string | null
  doors: string | null
  source: string
}

function rowToResponse(row: PlateRow, fromCache: boolean) {
  return {
    targa: row.plate,
    brand: row.brand || '',
    model: row.model || '',
    makeModel: row.make_model || '',
    description: row.description || '',
    year: row.year || '',
    fuel: row.fuel || '',
    powerCV: row.power_cv || '',
    displacement: row.displacement || '',
    doors: row.doors || '',
    cached: fromCache,
  }
}

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const { targa } = JSON.parse(event.body || '{}')
    if (!targa || typeof targa !== 'string' || targa.length < 5) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Targa non valida' }) }
    }

    const cleanTarga = targa.toUpperCase().replace(/[\s\-]/g, '')

    // ── 1. Cache-first ────────────────────────────────────────────────────────
    if (supabase) {
      const { data: cached } = await supabase
        .from('vehicle_plate_cache')
        .select('*')
        .eq('plate', cleanTarga)
        .maybeSingle<PlateRow>()

      if (cached) {
        // Atomic counter + last_seen_at bump. Fire-and-forget; never blocks
        // the operator's UI even if the RPC fails (cache still served).
        supabase.rpc('increment_plate_lookup_count', { p_plate: cleanTarga })
          .then(({ error }) => { if (error) console.warn('[lookup-targa] increment RPC failed:', error.message) }, () => {/* swallow */})

        console.log('[lookup-targa] Cache HIT:', cleanTarga, '→', cached.brand, cached.model)
        return { statusCode: 200, headers, body: JSON.stringify(rowToResponse(cached, true)) }
      }
    } else {
      console.warn('[lookup-targa] Supabase not configured — cache disabled')
    }

    // ── 2. Cache miss → openapi.com ───────────────────────────────────────────
    // 2026-07-18: token PRIMA dalla tabella service_secrets (leggibile SOLO con
    // service_role, RLS blocca anon -> NON esposto al browser), poi da env.
    // Aggiornabile con UNA sola SQL, vale per admin e sito. Il secret VINCE
    // sull'env stale (causa 502 "Wrong Token").
    let openapiToken = OPENAPI_TOKEN
    try {
      const { data: secRow } = await supabase.from('service_secrets').select('value').eq('key', 'openapi_automotive_token').maybeSingle()
      const cfgTok = (secRow as { value?: string } | null)?.value
      if (cfgTok && typeof cfgTok === 'string' && cfgTok.trim()) openapiToken = cfgTok.trim()
    } catch (e: any) { console.warn('[lookup-targa] secret token lookup failed, uso env:', e?.message) }
    if (!openapiToken) {
      console.error('[lookup-targa] token OpenAPI non configurato (ne config ne env)')
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Servizio temporaneamente non disponibile.' }) }
    }

    console.log('[lookup-targa] Cache MISS:', cleanTarga, '→ calling openapi.com')

    const res = await fetch(`https://automotive.openapi.com/IT-car/${cleanTarga}`, {
      headers: { 'Authorization': `Bearer ${openapiToken}` },
    })

    console.log('[lookup-targa] OpenAPI status:', res.status)

    if (res.status === 404) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Targa non trovata' }) }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[lookup-targa] OpenAPI error', res.status, body)
      return { statusCode: 502, headers, body: JSON.stringify({ error: `Errore API (${res.status})` }) }
    }

    const json = await res.json() as { success?: boolean; data?: Record<string, unknown> }
    if (!json?.success || !json.data) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Targa non trovata' }) }
    }

    const car = json.data
    const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v))
    const brand = str(car.CarMake)
    const model = str(car.CarModel)
    const makeModel = [brand, model].filter(Boolean).join(' ')

    const newRow: PlateRow = {
      plate: cleanTarga,
      brand,
      model,
      make_model: makeModel || null,
      description: str(car.Description),
      year: str(car.RegistrationYear),
      fuel: str(car.FuelType),
      power_cv: str(car.PowerCV),
      displacement: str(car.EngineSize),
      doors: str(car.NumberOfDoors),
      source: 'openapi',
    }

    // ── 3. Save to cache — MUST AWAIT.
    // Fire-and-forget here is unsafe on Netlify Functions / AWS Lambda:
    // once we `return`, the runtime freezes the container and the pending
    // upsert is dropped. The symptom: same plate gets charged on openapi.com
    // every time it's looked up, even though it "should be cached".
    // Real bug we hit (Apr 2026): FD966GF charged on 2026-05-04 AND 2026-05-05
    // because the first day's cache write was abandoned.
    if (supabase) {
      const { error: cacheErr } = await supabase
        .from('vehicle_plate_cache')
        .upsert(newRow, { onConflict: 'plate' })
      if (cacheErr) console.error('[lookup-targa] Cache save failed:', cacheErr.message)
      else console.log('[lookup-targa] Cached:', cleanTarga)
    }

    console.log('[lookup-targa] Success:', brand, model)
    return { statusCode: 200, headers, body: JSON.stringify(rowToResponse(newRow, false)) }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[lookup-targa] error:', msg)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Errore: ' + msg }) }
  }
}
