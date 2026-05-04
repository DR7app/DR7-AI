import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'

const OPENAPI_TOKEN = process.env.OPENAPI_AUTOMOTIVE_TOKEN || ''

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

    if (!OPENAPI_TOKEN) {
      console.error('[lookup-targa] OPENAPI_AUTOMOTIVE_TOKEN not configured')
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Servizio temporaneamente non disponibile.' }) }
    }

    console.log('[lookup-targa] Looking up plate:', cleanTarga)

    const res = await fetch(`https://automotive.openapi.com/IT-car/${cleanTarga}`, {
      headers: { 'Authorization': `Bearer ${OPENAPI_TOKEN}` },
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
    const str = (v: unknown): string => (v == null ? '' : String(v))
    const brand = str(car.CarMake)
    const model = str(car.CarModel)

    console.log('[lookup-targa] Success:', brand, model)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        targa: cleanTarga,
        brand,
        model,
        makeModel: (brand + ' ' + model).trim(),
        description: str(car.Description),
        year: str(car.RegistrationYear),
        fuel: str(car.FuelType),
        powerCV: str(car.PowerCV),
        displacement: str(car.EngineSize),
        doors: str(car.NumberOfDoors),
      }),
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[lookup-targa] error:', msg)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Errore: ' + msg }) }
  }
}
