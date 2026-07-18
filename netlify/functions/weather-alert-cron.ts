import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { runWeatherAlert, ensureWeatherTemplates } from './send-weather-alert'

// Cron Allerta Meteo automatica (2026-07-18).
// Ogni ora controlla il meteo REALE di Cagliari (Open-Meteo, gratis, no API key)
// e, se attivo il toggle "Cron ON" del relativo template in Messaggi di Sistema
// Pro, invia l'Allerta Meteo ai noleggi attualmente fuori.
//   - TERRA (auto): invia se PIOGGIA (qualsiasi precipitazione).  Template pro_allerta_meteo.
//   - MARE (barche): invia se PIOGGIA O VENTO forte.             Template pro_allerta_meteo_mare.
// Anti-spam: "una volta per episodio" — invia allo START dell'episodio, non a
// ripetizione mentre continua. Rispetta la fascia 08:00–21:00 (niente invii notte).

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Cagliari.
const LAT = 39.2238
const LON = 9.1217
// Soglia vento (raffiche km/h) oltre cui scatta l'allerta MARE.
const WIND_GUST_THRESHOLD_KMH = 30
// Fascia oraria di invio (Europe/Rome). Fuori = niente invii (regola no 22–07).
const SEND_HOUR_START = 8
const SEND_HOUR_END = 21

interface ChannelState { active?: boolean; last_sent_at?: string }
interface WeatherAlertState { terra?: ChannelState; mare?: ChannelState; updated_at?: string }

async function fetchCagliariWeather(): Promise<{ rain: boolean; windGustKmh: number } | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=precipitation,rain,wind_speed_10m,wind_gusts_10m,weather_code&timezone=Europe%2FRome`
    const res = await fetch(url)
    if (!res.ok) { console.error('[weather-alert-cron] Open-Meteo HTTP', res.status); return null }
    const json = await res.json() as { current?: Record<string, number> }
    const c = json.current || {}
    const precipitation = Number(c.precipitation ?? 0)
    const rainMm = Number(c.rain ?? 0)
    const code = Number(c.weather_code ?? 0)
    const windGustKmh = Number(c.wind_gusts_10m ?? 0)
    // Pioggia = qualsiasi precipitazione/pioggia, o weather_code di pioggia/temporale.
    // WMO codes: 51-67 pioggia/drizzle, 80-82 rovesci, 95-99 temporali.
    const rainCode = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99)
    const rain = precipitation > 0 || rainMm > 0 || rainCode
    return { rain, windGustKmh }
  } catch (e) {
    console.error('[weather-alert-cron] weather fetch failed:', e)
    return null
  }
}

/** Toggle "Cron ON" del template (cron_approved) + template abilitato. */
async function isChannelEnabled(supabase: ReturnType<typeof createClient>, templateKey: string): Promise<boolean> {
  const { data } = await supabase
    .from('system_messages')
    .select('is_enabled, cron_approved')
    .eq('message_key', templateKey)
  return (data || []).some((r: { is_enabled?: boolean; cron_approved?: boolean }) => r.is_enabled !== false && r.cron_approved === true)
}

const handler: Handler = async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: 'Missing Supabase config' }
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Assicura che i due template esistano (così i toggle compaiono nel gestionale).
  await ensureWeatherTemplates(supabase)

  // Ora locale Cagliari.
  const romeHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date()))
  const isDaytime = romeHour >= SEND_HOUR_START && romeHour <= SEND_HOUR_END

  const weather = await fetchCagliariWeather()
  if (!weather) return { statusCode: 200, body: JSON.stringify({ skipped: 'weather_unavailable' }) }

  // Stato persistito in centralina_pro_config.config.weather_alert_state.
  const { data: cfgRow } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
  const config = ((cfgRow?.config as Record<string, unknown>) || {})
  const state: WeatherAlertState = (config.weather_alert_state as WeatherAlertState) || {}

  const results: Record<string, unknown> = { weather, romeHour, isDaytime }

  // Condizioni per canale.
  const conditions: Record<'terra' | 'mare', boolean> = {
    terra: weather.rain,
    mare: weather.rain || weather.windGustKmh >= WIND_GUST_THRESHOLD_KMH,
  }
  const templateKeys: Record<'terra' | 'mare', string> = {
    terra: 'pro_allerta_meteo',
    mare: 'pro_allerta_meteo_mare',
  }

  const nowIso = new Date().toISOString()

  for (const channel of ['terra', 'mare'] as const) {
    const condition = conditions[channel]
    const chState: ChannelState = state[channel] || {}

    if (!condition) {
      // Episodio finito: azzera active così la prossima pioggia è un NUOVO episodio.
      state[channel] = { ...chState, active: false }
      results[channel] = 'no_condition'
      continue
    }

    // Condizione presente.
    if (chState.active) {
      // Stesso episodio già segnalato: non re-inviare.
      results[channel] = 'same_episode'
      continue
    }

    // Nuovo episodio. Solo se toggle ON + fascia diurna.
    const enabled = await isChannelEnabled(supabase, templateKeys[channel])
    if (!enabled) { results[channel] = 'toggle_off'; continue }
    if (!isDaytime) { results[channel] = 'night_deferred'; continue } // resta active=false: invia al mattino se persiste

    try {
      const r = await runWeatherAlert(supabase, { channel })
      state[channel] = { active: true, last_sent_at: nowIso }
      results[channel] = { sent: r.sent, failed: r.failed, recipients: r.count }
    } catch (e) {
      results[channel] = { error: e instanceof Error ? e.message : String(e) }
    }
  }

  // Persisti lo stato aggiornato (merge nel config esistente).
  try {
    await supabase.from('centralina_pro_config')
      .update({ config: { ...config, weather_alert_state: { ...state, updated_at: nowIso } } })
      .eq('id', 'main')
  } catch (e) {
    console.error('[weather-alert-cron] state persist failed:', e)
  }

  console.log('[weather-alert-cron]', JSON.stringify(results))
  return { statusCode: 200, body: JSON.stringify(results) }
}

export { handler }
