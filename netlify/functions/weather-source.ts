// Sorgente meteo condivisa (2026-08-22).
// Un solo lettore Open-Meteo (gratis, senza API key) usato SIA dal cron
// automatico (weather-alert-cron) SIA dal badge/bottone manuale in Prenotazioni
// (weather-now). Prima il cron aveva il suo fetch privato e il bottone manuale
// non guardava affatto il meteo: due comportamenti diversi per la stessa
// domanda "sta per piovere?".

// 2026-08-22: la localita' non e' piu' fissa. Si sceglie dal gestionale
// (Olbia, Cagliari, ...) ed e' persistita in
// centralina_pro_config.config.weather_location. Cagliari resta il default
// storico se non e' mai stata scelta una citta'.
export interface WeatherLocation {
  name: string
  lat: number
  lon: number
  /** Provincia/regione, per distinguere omonimi. */
  admin1?: string
  country?: string
}

export const DEFAULT_LOCATION: WeatherLocation = {
  name: 'Cagliari', lat: 39.2238, lon: 9.1217, admin1: 'Sardegna', country: 'IT',
}

// Retrocompatibilita' con i vecchi import.
export const LAT = DEFAULT_LOCATION.lat
export const LON = DEFAULT_LOCATION.lon
// Soglia raffiche (km/h) oltre cui scatta l'allerta MARE.
export const WIND_GUST_THRESHOLD_KMH = 30
// Quante ore avanti guardare per anticipare l'allerta.
export const FORECAST_HOURS_AHEAD = 3
// Pioggia prevista: sotto questa soglia (mm/h) e' rumore, non maltempo.
export const FORECAST_RAIN_MM = 0.2

export interface WeatherSnapshot {
  rain: boolean
  windGustKmh: number
  weatherCode: number
  /** mm di pioggia (oraria per la previsione, istantanea per current). */
  precipitationMm: number
  /** Probabilita' di precipitazione 0-100. Solo previsione. */
  precipitationProbability?: number
  /** Ora locale Europe/Rome a cui si riferisce la previsione. */
  atLocal?: string
}

export interface WeatherReading {
  /** Condizioni in questo momento. */
  now: WeatherSnapshot
  /** Peggiore ora tra le prossime FORECAST_HOURS_AHEAD. */
  forecast: WeatherSnapshot
  /** Etichetta breve in italiano, pronta per la UI. */
  label: string
  /** Localita' a cui si riferisce la lettura. */
  location: WeatherLocation
}

/** WMO weather codes che indicano pioggia/rovesci/temporali. */
export function isRainCode(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99)
}

export function describeWeather(w: WeatherSnapshot): string {
  const parts: string[] = []
  if (w.rain) parts.push('Pioggia')
  if (w.windGustKmh >= WIND_GUST_THRESHOLD_KMH) parts.push(`raffiche ${Math.round(w.windGustKmh)} km/h`)
  if (parts.length === 0) return `Sereno, vento ${Math.round(w.windGustKmh)} km/h`
  return parts.join(', ')
}

/**
 * Legge Open-Meteo per la localita' indicata: condizioni attuali + previsione
 * delle prossime `oreAvanti` ore (quante, lo decide la Centralina per business).
 * Ritorna null se l'API non risponde (il chiamante decide se saltare).
 */
export async function fetchWeather(
  loc: WeatherLocation = DEFAULT_LOCATION,
  oreAvanti: number = FORECAST_HOURS_AHEAD,
): Promise<WeatherReading | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}`
      + `&current=precipitation,rain,wind_speed_10m,wind_gusts_10m,weather_code`
      + `&hourly=precipitation,precipitation_probability,wind_gusts_10m,weather_code`
      + `&forecast_days=2&timezone=Europe%2FRome`
    const res = await fetch(url)
    if (!res.ok) { console.error('[weather-source] Open-Meteo HTTP', res.status); return null }
    const json = await res.json() as {
      current?: Record<string, number>
      hourly?: { time?: string[]; precipitation?: number[]; precipitation_probability?: number[]; wind_gusts_10m?: number[]; weather_code?: number[] }
    }

    const c = json.current || {}
    const nowCode = Number(c.weather_code ?? 0)
    const nowPrecip = Math.max(Number(c.precipitation ?? 0), Number(c.rain ?? 0))
    const now: WeatherSnapshot = {
      rain: nowPrecip > 0 || isRainCode(nowCode),
      windGustKmh: Number(c.wind_gusts_10m ?? 0),
      weatherCode: nowCode,
      precipitationMm: nowPrecip,
    }

    // Previsione: prende la PEGGIORE tra le prossime ore, cosi' l'allerta parte
    // prima che il maltempo arrivi invece che a cliente gia' bagnato.
    const h = json.hourly || {}
    const times = h.time || []
    // Con timezone=Europe/Rome i timestamp sono locali senza offset ("2026-08-22T14:00").
    const nowLocal = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date()).replace(' ', 'T')

    let worst: WeatherSnapshot = { ...now, atLocal: undefined }
    let scanned = 0
    const ore = Math.min(24, Math.max(1, Math.round(oreAvanti) || FORECAST_HOURS_AHEAD))
    for (let i = 0; i < times.length && scanned < ore; i++) {
      if (times[i] < nowLocal) continue
      scanned++
      const precip = Number(h.precipitation?.[i] ?? 0)
      const prob = Number(h.precipitation_probability?.[i] ?? 0)
      const gust = Number(h.wind_gusts_10m?.[i] ?? 0)
      const code = Number(h.weather_code?.[i] ?? 0)
      const rain = precip >= FORECAST_RAIN_MM || isRainCode(code)
      const candidate: WeatherSnapshot = {
        rain, windGustKmh: gust, weatherCode: code,
        precipitationMm: precip, precipitationProbability: prob, atLocal: times[i],
      }
      // "Peggiore" = pioggia batte sereno; a parita', raffiche piu' forti.
      const better = (candidate.rain && !worst.rain)
        || (candidate.rain === worst.rain && candidate.windGustKmh > worst.windGustKmh)
      if (better || worst.atLocal === undefined) worst = candidate
    }

    return { now, forecast: worst, label: describeWeather(worst), location: loc }
  } catch (e) {
    console.error('[weather-source] fetch failed:', e)
    return null
  }
}

/**
 * Regola STORICA di allerta per canale (Terra: pioggia; Mare: pioggia o vento).
 *
 * 31/08/2026: non decide piu' gli invii — a farlo e' la configurazione per
 * business (`weather-config.ts`, sezione Allerta Meteo della Centralina). Resta
 * come valore di riferimento nella risposta di weather-now, per chi ha ancora
 * in pagina la vecchia lettura.
 */
export function conditionFor(channel: 'terra' | 'mare', w: WeatherSnapshot): boolean {
  if (channel === 'mare') return w.rain || w.windGustKmh >= WIND_GUST_THRESHOLD_KMH
  return w.rain
}


/**
 * Ricerca citta' tramite il geocoder gratuito di Open-Meteo (nessuna API key).
 * Limitata all'Italia: il gestionale ragiona su Olbia, Cagliari, Alghero...
 */
export async function searchCities(query: string): Promise<WeatherLocation[]> {
  const q = (query || '').trim()
  if (q.length < 2) return []
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}`
      + `&count=8&language=it&format=json&countryCode=IT`
    const res = await fetch(url)
    if (!res.ok) return []
    const json = await res.json() as { results?: Array<Record<string, unknown>> }
    return (json.results || []).map(r => ({
      name: String(r.name || ''),
      lat: Number(r.latitude),
      lon: Number(r.longitude),
      admin1: r.admin1 ? String(r.admin1) : undefined,
      country: r.country_code ? String(r.country_code) : 'IT',
    })).filter(r => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lon))
  } catch (e) {
    console.error('[weather-source] geocoding failed:', e)
    return []
  }
}

/** Etichetta leggibile: "Olbia (Sardegna)". */
export function locationLabel(loc: WeatherLocation): string {
  return loc.admin1 ? `${loc.name} (${loc.admin1})` : loc.name
}

interface ConfigStore {
  from: (t: string) => {
    select: (c: string) => {
      eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { config?: unknown } | null }> }
      in: (k: string, v: string[]) => Promise<{ data: Array<{ id: string; config: Record<string, unknown> | null }> | null }>
    }
    upsert: (v: Record<string, unknown>, o: Record<string, unknown>) => Promise<{ error: unknown }>
  }
}

function locValida(loc: unknown): loc is WeatherLocation {
  const l = loc as WeatherLocation | undefined
  return !!(l && l.name && Number.isFinite(l.lat) && Number.isFinite(l.lon))
}

/**
 * Localita' salvata nel gestionale per la riga indicata.
 *
 * 31/08/2026: ogni business ha la sua citta' (il Mare guarda Olbia mentre
 * Terra guarda Cagliari). Chi non ne ha scelta una eredita quella di Terra
 * ('main'), e in assenza anche di quella resta Cagliari: la citta' e' l'unica
 * voce meteo che si eredita, perche' un business senza citta' non e' una
 * scelta, e' una configurazione mai aperta.
 */
export async function getSavedLocation(supabase: unknown, rowId: string = 'main'): Promise<WeatherLocation> {
  try {
    const db = supabase as ConfigStore
    const ids = rowId === 'main' ? ['main'] : [rowId, 'main']
    const { data } = await db.from('centralina_pro_config').select('id, config').in('id', ids)
    const righe = data || []
    const leggi = (id: string) => ((righe.find(r => r.id === id)?.config || {}) as Record<string, unknown>).weather_location
    const propria = leggi(rowId)
    if (locValida(propria)) return propria
    const principale = leggi('main')
    if (locValida(principale)) return principale
  } catch (e) {
    console.error('[weather-source] getSavedLocation failed:', e)
  }
  return DEFAULT_LOCATION
}

/**
 * Salva la localita' nella riga del business. Rilegge la config FRESCA prima
 * di scrivere e fonde SOLO la chiave weather_location: la stessa precauzione
 * presa nel cron dopo il problema del 2026-08-08 (salvataggi concorrenti che
 * si sovrascrivevano). Upsert e non update: la riga di un business mai
 * configurato non esiste ancora.
 */
export async function saveLocation(supabase: unknown, loc: WeatherLocation, rowId: string = 'main'): Promise<void> {
  const db = supabase as ConfigStore
  const { data } = await db.from('centralina_pro_config').select('config').eq('id', rowId).maybeSingle()
  const fresh = (data?.config as Record<string, unknown>) || {}
  const { error } = await db.from('centralina_pro_config')
    .upsert({ id: rowId, config: { ...fresh, weather_location: loc } }, { onConflict: 'id' })
  if (error) throw new Error(String((error as { message?: string }).message || error))
}
