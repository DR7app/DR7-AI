import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { getCorsOrigin } from './cors-headers'
import { requireAuth } from './require-auth'
import {
  fetchWeather, describeWeather, conditionFor, searchCities, getSavedLocation, saveLocation,
  locationLabel, DEFAULT_LOCATION, WIND_GUST_THRESHOLD_KMH, FORECAST_HOURS_AHEAD,
  type WeatherLocation,
} from './weather-source'

// Meteo live per il gestionale (2026-08-22).
// Alimenta badge, ricerca citta' e conferma del bottone "Allerta Meteo" in
// Prenotazioni, con la STESSA lettura Open-Meteo del cron automatico.
//
//   GET  ?                      -> meteo della citta' salvata (default Cagliari)
//   GET  ?lat=&lon=&name=       -> meteo di una citta' specifica (anteprima)
//   GET  ?q=olbia               -> ricerca citta' italiane (geocoding)
//   POST { location }           -> salva la citta' (richiede login admin)

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function db() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers?.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }

  // ── Salvataggio citta' (solo admin autenticato) ────────────────────────
  if (event.httpMethod === 'POST') {
    const auth = await requireAuth(event as unknown as { headers: Record<string, string> })
    if (auth.error) return auth.error
    const supabase = db()
    if (!supabase) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Config Supabase mancante' }) }
    try {
      const body = JSON.parse(event.body || '{}') as { location?: WeatherLocation }
      const loc = body.location
      if (!loc?.name || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Citta non valida' }) }
      }
      await saveLocation(supabase, loc)
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, location: loc }) }
    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: e instanceof Error ? e.message : 'Errore' }) }
    }
  }

  const params = event.queryStringParameters || {}

  // ── Ricerca citta' ──────────────────────────────────────────────────────
  if (params.q) {
    const results = await searchCities(params.q)
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ results: results.map(r => ({ ...r, label: locationLabel(r) })) }),
    }
  }

  // ── Meteo: citta' esplicita, altrimenti quella salvata ──────────────────
  let loc: WeatherLocation
  if (params.lat && params.lon) {
    loc = {
      name: params.name || 'Localita',
      lat: Number(params.lat), lon: Number(params.lon),
      admin1: params.admin1 || undefined,
    }
  } else {
    const supabase = db()
    loc = supabase ? await getSavedLocation(supabase) : DEFAULT_LOCATION
  }

  const reading = await fetchWeather(loc)
  if (!reading) {
    return { statusCode: 200, headers, body: JSON.stringify({ available: false, luogo: loc.name, error: 'Meteo non disponibile' }) }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      available: true,
      luogo: loc.name,
      location: { ...loc, label: locationLabel(loc) },
      now: reading.now,
      forecast: reading.forecast,
      label: reading.label,
      labelNow: describeWeather(reading.now),
      // Cosa farebbe il cron adesso, per canale.
      allerta: {
        terra: conditionFor('terra', reading.forecast),
        mare: conditionFor('mare', reading.forecast),
      },
      soglie: { ventoKmh: WIND_GUST_THRESHOLD_KMH, oreAvanti: FORECAST_HOURS_AHEAD },
    }),
  }
}

export { handler }
