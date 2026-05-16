import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

/**
 * Imposta manualmente il location ID di Google Business Profile.
 * Salva in app_secrets.gbp_location_name cosi' che gbp-report.ts salti
 * la scoperta automatica (accounts.list + locations.list) — che e' quella
 * che fa scattare il rate limit "1 richiesta/minuto" sulla API GBP.
 *
 * Input: POST body { name: "locations/12345..." } o GET ?name=locations/12345
 * L'utente recupera il proprio location ID dall'URL di business.google.com:
 *   "https://business.google.com/n/12345678901234567890/edit/..." → name = "locations/12345678901234567890"
 */

const handler: Handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }

  let raw: string | undefined
  if (event.httpMethod === 'POST') {
    try {
      const parsed = JSON.parse(event.body || '{}')
      raw = parsed.name
    } catch {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Body JSON invalido' }) }
    }
  } else {
    raw = event.queryStringParameters?.name
  }

  if (!raw || typeof raw !== 'string') {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Parametro "name" mancante' }) }
  }

  // Normalizza: accetta sia "locations/123..." sia solo "123..."
  const trimmed = raw.trim()
  const onlyDigits = /^\d+$/.test(trimmed)
  const wellFormed = /^locations\/\d+$/.test(trimmed)
  if (!onlyDigits && !wellFormed) {
    return {
      statusCode: 400, headers,
      body: JSON.stringify({
        ok: false,
        error: 'Formato non valido. Aspettato "locations/123..." oppure solo "123..." (la parte numerica dall\'URL di business.google.com)'
      })
    }
  }
  const name = wellFormed ? trimmed : `locations/${trimmed}`

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: 'Supabase non configurato' }) }
  }

  const sb = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } })

  try {
    await sb.from('app_secrets').upsert({
      key: 'gbp_location_name',
      value: { name, title: 'manual', discovered_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })

    // Invalida le cache report cosi' il prossimo fetch usa il nuovo location
    for (const range of ['7d', '28d', '90d', '180d', '365d']) {
      try {
        await sb.from('app_secrets').delete().eq('key', `gbp_report_cache_${range}`)
      } catch { /* skip */ }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, name }) }
  } catch (e: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e?.message || String(e) }) }
  }
}

export { handler }
