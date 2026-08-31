import type { Handler } from '@netlify/functions'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { runWeatherAlert, ensureWeatherTemplates } from './send-weather-alert'
import { fetchWeather, describeWeather, getSavedLocation, locationLabel, type WeatherReading } from './weather-source'
import {
  METEO_BUSINESSES, METEO_BUSINESS_ROW, METEO_BUSINESS_LABELS, LIVELLO_LABELS,
  loadMeteoConfig, valutaMeteo, dentroFascia, rankLivello,
  type MeteoBusiness, type MeteoEsito,
} from './weather-config'

// Cron Allerta Meteo automatica (2026-07-18).
//
// Ogni ora legge il meteo REALE (Open-Meteo, gratis, senza API key) e guarda le
// PROSSIME ORE, non solo l'istante presente, per ognuno dei cinque business.
//
// 31/08/2026 — le regole non stanno piu' qui dentro. Prima erano scritte nel
// codice (TERRA = qualunque pioggia, MARE = pioggia o raffiche >= 30 km/h) e
// gli altri tre business non ricevevano niente. Adesso ogni business ha la sua
// configurazione in Centralina Pro > Allerta Meteo: criterio (pioggia, vento o
// entrambi), soglie dei tre livelli (Bassa / Media / Elevata), livello da cui
// in su si invia, citta', ore di previsione, fascia oraria e template Pro.
// Vedi `weather-config.ts`.
//
// Anti-spam: "una volta per episodio" — si invia allo START dell'episodio, non
// a ripetizione mentre continua. Se il livello PEGGIORA (bassa -> elevata) e il
// business ha "riavvisa se peggiora", parte un secondo avviso: e' un'altra
// notizia, non la stessa.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

interface ChannelState {
  active?: boolean
  /** Livello dell'ultimo avviso spedito in questo episodio. */
  livello?: MeteoEsito
  last_sent_at?: string
}
type WeatherAlertState = Partial<Record<MeteoBusiness, ChannelState>> & { updated_at?: string }

/**
 * Business SENZA scelta esplicita in Centralina: valgono i toggle "Cron ON" dei
 * vecchi template, cosi' chi non apre la nuova sezione non vede cambiare nulla.
 * Gli altri tre business nascono spenti (METEO_DEFAULTS.attiva = false).
 */
const LEGACY_TOGGLE: Record<string, string> = {
  terra: 'pro_allerta_meteo',
  mare: 'pro_allerta_meteo_mare',
}

/** Toggle "Cron ON" del template (cron_approved) + template abilitato. */
async function isCronApproved(supabase: SupabaseClient, templateKey: string): Promise<boolean> {
  const { data } = await supabase
    .from('system_messages')
    .select('is_enabled, cron_approved')
    .eq('message_key', templateKey)
  return (data || []).some((r: { is_enabled?: boolean; cron_approved?: boolean }) => r.is_enabled !== false && r.cron_approved === true)
}

/** Il template esiste ed e' acceso? Un template spento non si spedisce. */
async function isTemplateEnabled(supabase: SupabaseClient, templateKey: string): Promise<boolean> {
  const { data } = await supabase
    .from('system_messages')
    .select('is_enabled')
    .eq('message_key', templateKey)
  if (!data || data.length === 0) return true // non ancora seedato: ci pensa l'invio
  return data.some((r: { is_enabled?: boolean }) => r.is_enabled !== false)
}

const handler: Handler = async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: 'Missing Supabase config' }
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Assicura che i template esistano (così i toggle compaiono nel gestionale).
  await ensureWeatherTemplates(supabase)

  // Ora locale italiana: la fascia di invio e' per business.
  const romeHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date()))

  // Stato persistito in centralina_pro_config.config.weather_alert_state.
  const { data: cfgRow } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
  const config = ((cfgRow?.config as Record<string, unknown>) || {})
  const state: WeatherAlertState = (config.weather_alert_state as WeatherAlertState) || {}

  const results: Record<string, unknown> = { romeHour }
  const nowIso = new Date().toISOString()

  // Una lettura Open-Meteo per (citta' + ore di previsione): con tutti i
  // business sulla stessa citta' si fa una sola chiamata, non cinque.
  const letture = new Map<string, WeatherReading | null>()
  async function leggi(loc: Awaited<ReturnType<typeof getSavedLocation>>, ore: number) {
    const k = `${loc.lat},${loc.lon},${ore}`
    if (!letture.has(k)) letture.set(k, await fetchWeather(loc, ore))
    return letture.get(k) || null
  }

  for (const business of METEO_BUSINESSES) {
    const cfg = await loadMeteoConfig(supabase, business)
    const etichetta = METEO_BUSINESS_LABELS[business]

    // Acceso? La scelta esplicita della Centralina vince; se non c'e', valgono
    // i vecchi toggle "Cron ON" (solo Terra e Mare li avevano).
    const attiva = typeof cfg.attiva === 'boolean'
      ? cfg.attiva
      : (LEGACY_TOGGLE[business] ? await isCronApproved(supabase, LEGACY_TOGGLE[business]) : false)
    if (!attiva) { results[business] = 'spento'; continue }

    if (!(await isTemplateEnabled(supabase, cfg.template_key))) {
      results[business] = { skipped: 'template_spento', template: cfg.template_key }
      continue
    }

    const location = await getSavedLocation(supabase, METEO_BUSINESS_ROW[business])
    const reading = await leggi(location, cfg.ore_avanti)
    if (!reading) { results[business] = 'meteo_non_disponibile'; continue }

    const valutazione = valutaMeteo(cfg, reading.forecast)
    const chState: ChannelState = state[business] || {}
    const base = {
      business: etichetta,
      luogo: locationLabel(location),
      criterio: cfg.criterio,
      previsione: describeWeather(reading.forecast),
      livello: LIVELLO_LABELS[valutazione.livello],
      motivo: valutazione.motivo,
    }

    if (!valutazione.supera) {
      // Episodio finito: azzera active così il prossimo maltempo è un NUOVO episodio.
      state[business] = { ...chState, active: false, livello: 'nessuna' }
      results[business] = { ...base, esito: 'sotto_soglia', minimo: cfg.livello_minimo }
      continue
    }

    // Condizione presente.
    const giaAvvisato = chState.active === true
    const peggiorato = giaAvvisato && cfg.riavvisa_se_peggiora
      && rankLivello(valutazione.livello) > rankLivello(chState.livello || 'nessuna')
    if (giaAvvisato && !peggiorato) {
      results[business] = { ...base, esito: 'stesso_episodio' }
      continue
    }

    // Fuori fascia: si resta con active=false, così l'avviso parte appena la
    // fascia riapre se il maltempo persiste (niente messaggi di notte).
    if (!dentroFascia(cfg, romeHour)) {
      results[business] = { ...base, esito: 'fuori_fascia', fascia: `${cfg.ora_inizio}-${cfg.ora_fine}` }
      continue
    }

    try {
      const r = await runWeatherAlert(supabase, {
        business,
        templateKey: cfg.template_key,
        oreAvanti: cfg.ore_avanti,
      })
      state[business] = { active: true, livello: valutazione.livello, last_sent_at: nowIso }
      results[business] = {
        ...base,
        esito: peggiorato ? 'peggiorato' : 'inviato',
        sent: r.sent, failed: r.failed, destinatari: r.count, template: r.templateKey,
      }
    } catch (e) {
      results[business] = { ...base, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // Persisti lo stato aggiornato (merge nel config esistente).
  // 2026-08-08: rileggi la config FRESCA subito prima di scrivere. `config` era
  // stato letto a inizio cron; tra la lettura e qui passano secondi di invio
  // messaggi e un salvataggio concorrente (es. numeri direzione cauzioni) verrebbe
  // sovrascritto. Si fonde SOLO la chiave weather_alert_state.
  try {
    const { data: freshRow } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
    const freshConfig = ((freshRow?.config as Record<string, unknown>) || config)
    await supabase.from('centralina_pro_config')
      .update({ config: { ...freshConfig, weather_alert_state: { ...state, updated_at: nowIso } } })
      .eq('id', 'main')
  } catch (e) {
    console.error('[weather-alert-cron] state persist failed:', e)
  }

  console.log('[weather-alert-cron]', JSON.stringify(results))
  return { statusCode: 200, body: JSON.stringify(results) }
}

export { handler }
