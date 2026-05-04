import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'

const ZYLA_API_KEY = process.env.ZYLA_API_KEY || ''
const OPENAPI_TOKEN = process.env.OPENAPI_AUTOMOTIVE_TOKEN || ''

interface VehicleResult {
  targa: string
  brand: string
  model: string
  makeModel: string
  description: string
  year: string
  fuel: string
  powerCV: string
  displacement: string
  doors: string
  source: 'zyla' | 'openapi'
}

function mapVehicleFields(car: Record<string, unknown>, targa: string, source: VehicleResult['source']): VehicleResult {
  const str = (v: unknown): string => (v == null ? '' : String(v))
  const brand = str(car.CarMake)
  const model = str(car.CarModel)
  return {
    targa,
    brand,
    model,
    makeModel: (brand + ' ' + model).trim(),
    description: str(car.Description),
    year: str(car.RegistrationYear),
    fuel: str(car.FuelType),
    powerCV: str(car.PowerCV),
    displacement: str(car.EngineSize),
    doors: str(car.NumberOfDoors),
    source,
  }
}

// Zyla returns either pure JSON, or a wrapper { vehicleJson: "<stringified JSON>" }.
// Normalize both shapes to a flat object.
function unwrapZylaPayload(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== 'object') return null
  const obj = json as Record<string, unknown>
  if (typeof obj.vehicleJson === 'string') {
    try { return JSON.parse(obj.vehicleJson) } catch { /* fall through */ }
  }
  if (obj.vehicleData && typeof obj.vehicleData === 'object') {
    return obj.vehicleData as Record<string, unknown>
  }
  // Treat as already-flat
  return obj
}

async function lookupZyla(plate: string): Promise<VehicleResult | null> {
  if (!ZYLA_API_KEY) return null
  const url = `https://zylalabs.com/api/352/italy+license+plate+lookup+api/283/license+plate+lookup?RegistrationNumber=${encodeURIComponent(plate)}`
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${ZYLA_API_KEY}`,
      'Accept': 'application/json',
    },
  })
  console.log('[lookup-targa] Zyla status:', res.status)
  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('[lookup-targa] Zyla error', res.status, body)
    return null
  }
  const json = await res.json().catch(() => null)
  const car = unwrapZylaPayload(json)
  if (!car || (!car.CarMake && !car.CarModel)) return null
  return mapVehicleFields(car, plate, 'zyla')
}

async function lookupOpenApi(plate: string): Promise<VehicleResult | null> {
  if (!OPENAPI_TOKEN) return null
  const res = await fetch(`https://automotive.openapi.com/IT-car/${plate}`, {
    headers: { 'Authorization': `Bearer ${OPENAPI_TOKEN}` },
  })
  console.log('[lookup-targa] OpenAPI status:', res.status)
  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('[lookup-targa] OpenAPI error', res.status, body)
    return null
  }
  const json = await res.json().catch(() => null) as { success?: boolean; data?: Record<string, unknown> } | null
  if (!json?.success || !json.data) return null
  return mapVehicleFields(json.data, plate, 'openapi')
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

    if (!ZYLA_API_KEY && !OPENAPI_TOKEN) {
      console.error('[lookup-targa] No provider configured (ZYLA_API_KEY and OPENAPI_AUTOMOTIVE_TOKEN both missing)')
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Servizio temporaneamente non disponibile.' }) }
    }

    console.log('[lookup-targa] Looking up plate:', cleanTarga, 'providers: zyla=', !!ZYLA_API_KEY, 'openapi=', !!OPENAPI_TOKEN)

    // Primary: Zyla (cheaper). Fallback: openapi.com (kept while transitioning).
    let result = await lookupZyla(cleanTarga)
    if (!result) result = await lookupOpenApi(cleanTarga)

    if (!result) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Targa non trovata' }) }
    }

    console.log('[lookup-targa] Success via', result.source, '-', result.brand, result.model)
    return { statusCode: 200, headers, body: JSON.stringify(result) }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[lookup-targa] error:', msg)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Errore: ' + msg }) }
  }
}
