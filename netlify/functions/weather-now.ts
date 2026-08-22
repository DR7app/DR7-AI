import type { Handler } from '@netlify/functions'
import { getCorsOrigin } from './cors-headers'
import { fetchWeather, describeWeather, conditionFor, WIND_GUST_THRESHOLD_KMH, FORECAST_HOURS_AHEAD } from './weather-source'

// Meteo live per il gestionale (2026-08-22).
// Alimenta il badge e la conferma del bottone "Allerta Meteo" in Prenotazioni,
// usando ESATTAMENTE la stessa lettura Open-Meteo del cron automatico.
// Nessun segreto in gioco: e' solo un relay verso Open-Meteo.

const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers?.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }

  const reading = await fetchWeather()
  if (!reading) {
    return { statusCode: 200, headers, body: JSON.stringify({ available: false, error: 'Meteo non disponibile' }) }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      available: true,
      luogo: 'Cagliari',
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
