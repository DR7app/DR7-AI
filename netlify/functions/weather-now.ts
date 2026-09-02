import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { getCorsOrigin } from './cors-headers'
import { requireAuth } from './require-auth'
import {
  fetchWeather, describeWeather, conditionFor, searchCities, getSavedLocation, saveLocation,
  locationLabel, DEFAULT_LOCATION, WIND_GUST_THRESHOLD_KMH, FORECAST_HOURS_AHEAD,
  type WeatherLocation,
} from './weather-source'
import {
  loadMeteoConfig, normalizeMeteoConfig, valutaMeteo, dentroFascia, toMeteoBusiness,
  METEO_BUSINESS_ROW, METEO_BUSINESS_LABELS, LIVELLO_LABELS,
} from './weather-config'

// Meteo live per il gestionale (2026-08-22).
// Alimenta badge, ricerca citta' e conferma del bottone "Allerta Meteo" in
// Prenotazioni, con la STESSA lettura Open-Meteo del cron automatico.
//
//   GET  ?business=mare         -> meteo + configurazione allerta di quel business
//   GET  ?                      -> come sopra con business=terra
//   GET  ?lat=&lon=&name=       -> meteo di una citta' specifica (anteprima)
//   GET  ?q=olbia               -> ricerca citta' italiane (geocoding)
//   POST { location, business } -> salva la citta' del business (login admin)
//
// 31/08/2026: la risposta porta anche la valutazione secondo la configurazione
// del business (Centralina Pro > Allerta Meteo): livello raggiunto, se supera
// la soglia di invio e perche'. Il gestionale non ricalcola nulla per conto suo
// — la regola che mostra e' la stessa che usa il cron.

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
      const body = JSON.parse(event.body || '{}') as { location?: WeatherLocation; business?: string }
      const loc = body.location
      if (!loc?.name || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Citta non valida' }) }
      }
      // Ogni business ha la sua citta': si scrive nella riga del business.
      const business = toMeteoBusiness(body.business ?? 'terra')
      await saveLocation(supabase, loc, METEO_BUSINESS_ROW[business])
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, location: loc, business }) }
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

  // ── Meteo del business: citta' esplicita, altrimenti quella salvata ─────
  const business = toMeteoBusiness(params.business ?? 'terra')
  const supabase = db()
  const config = supabase
    ? await loadMeteoConfig(supabase, business)
    : normalizeMeteoConfig(undefined, business)

  let loc: WeatherLocation
  if (params.lat && params.lon) {
    loc = {
      name: params.name || 'Localita',
      lat: Number(params.lat), lon: Number(params.lon),
      admin1: params.admin1 || undefined,
    }
  } else {
    loc = supabase ? await getSavedLocation(supabase, METEO_BUSINESS_ROW[business]) : DEFAULT_LOCATION
  }

  // Le ore di previsione sono quelle configurate dal business: il badge deve
  // guardare la stessa finestra del cron, altrimenti mostra un meteo che non
  // corrisponde a quello che fa partire (o no) l'avviso.
  const reading = await fetchWeather(loc, config.ore_avanti)
  if (!reading) {
    return { statusCode: 200, headers, body: JSON.stringify({ available: false, business, luogo: loc.name, error: 'Meteo non disponibile' }) }
  }

  const valutazione = valutaMeteo(config, reading.forecast)
  const oraRoma = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date()))

  // 02/09/2026 — il meteo passa dalla cache della CDN.
  //
  // Ogni apertura di Prenotazioni (e di Uscite Straordinarie) aspettava una
  // chiamata a Open-Meteo: da uno a tre secondi, per un dato che cambia ogni
  // ora. Ora la prima richiesta lo va a prendere e le successive lo trovano
  // gia' pronto sul bordo, per dieci minuti. Nella mezz'ora successiva la
  // copia scaduta viene servita subito mentre il ricalcolo gira dietro, quindi
  // nessuno aspetta mai Open-Meteo.
  const intestazioniCache = {
    ...headers,
    'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=600, stale-while-revalidate=1800',
  }

  return {
    statusCode: 200,
    headers: intestazioniCache,
    body: JSON.stringify({
      available: true,
      business,
      businessLabel: METEO_BUSINESS_LABELS[business],
      luogo: loc.name,
      location: { ...loc, label: locationLabel(loc) },
      now: reading.now,
      forecast: reading.forecast,
      label: reading.label,
      labelNow: describeWeather(reading.now),
      // Cosa farebbe il cron adesso per QUESTO business, con la sua config.
      valutazione: {
        livello: valutazione.livello,
        livelloLabel: LIVELLO_LABELS[valutazione.livello],
        pioggia: valutazione.pioggia,
        vento: valutazione.vento,
        supera: valutazione.supera,
        motivo: valutazione.motivo,
        dentroFascia: dentroFascia(config, oraRoma),
      },
      config,
      // Regola storica, per le pagine ancora aperte col codice vecchio.
      allerta: {
        terra: conditionFor('terra', reading.forecast),
        mare: conditionFor('mare', reading.forecast),
      },
      soglie: { ventoKmh: WIND_GUST_THRESHOLD_KMH, oreAvanti: config.ore_avanti || FORECAST_HOURS_AHEAD },
    }),
  }
}

export { handler }
