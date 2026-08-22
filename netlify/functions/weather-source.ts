// Sorgente meteo condivisa (2026-08-22).
// Un solo lettore Open-Meteo (gratis, senza API key) usato SIA dal cron
// automatico (weather-alert-cron) SIA dal badge/bottone manuale in Prenotazioni
// (weather-now). Prima il cron aveva il suo fetch privato e il bottone manuale
// non guardava affatto il meteo: due comportamenti diversi per la stessa
// domanda "sta per piovere?".

// Cagliari.
export const LAT = 39.2238
export const LON = 9.1217
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
 * Legge Open-Meteo per Cagliari: condizioni attuali + previsione delle prossime
 * ore. Ritorna null se l'API non risponde (il chiamante decide se saltare).
 */
export async function fetchWeather(): Promise<WeatherReading | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`
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
    for (let i = 0; i < times.length && scanned < FORECAST_HOURS_AHEAD; i++) {
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

    return { now, forecast: worst, label: describeWeather(worst) }
  } catch (e) {
    console.error('[weather-source] fetch failed:', e)
    return null
  }
}

/** Condizione di allerta per canale, a partire da uno snapshot. */
export function conditionFor(channel: 'terra' | 'mare', w: WeatherSnapshot): boolean {
  if (channel === 'mare') return w.rain || w.windGustKmh >= WIND_GUST_THRESHOLD_KMH
  return w.rain
}
