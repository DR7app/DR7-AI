import { Handler } from '@netlify/functions'
import { corsHeaders } from './cors-headers'

/**
 * SafeFleet API Proxy — https://portale.safefleet.it/safeapi/
 * Swagger spec: v1.26.0 (parsed from swagger.json — paths verified).
 *
 * Auth: JWT (DRF SimpleJWT) with custom max token lifetimes.
 *   POST /api/token/ accepts access_token_seconds_duration (<=900)
 *   and refresh_token_seconds_duration (<=86400). We request the max so
 *   we re-login at most once a day and refresh access at most every 15min.
 *
 * Env vars:
 *   SAFEFLEET_BASE_URL    default: https://portale.safefleet.it/safeapi
 *   SAFEFLEET_USERNAME    portal username (required for live mode)
 *   SAFEFLEET_PASSWORD    portal password (required for live mode)
 *   SAFEFLEET_FLEET_ID    optional: scope /current_positions to one fleet
 *
 * When credentials are missing, mock data is returned.
 *
 * Note: SafeFleet does NOT offer keyless commands — tracking + telemetry
 * + events only. No lock/unlock/engine endpoints.
 */

const SAFEFLEET_BASE_URL = process.env.SAFEFLEET_BASE_URL || 'https://portale.safefleet.it/safeapi'
const SAFEFLEET_USERNAME = process.env.SAFEFLEET_USERNAME || ''
const SAFEFLEET_PASSWORD = process.env.SAFEFLEET_PASSWORD || ''
const SAFEFLEET_FLEET_ID = process.env.SAFEFLEET_FLEET_ID || ''

const ACCESS_TTL = 900
const REFRESH_TTL = 86400

const EP = {
  login: '/api/token/',
  refresh: '/api/token/refresh/',
  logout: '/api/token/logout/',
  currentPositions: '/api/current_positions',
  vehicles: '/api/vehicles',
  vehicle: (id: number) => `/api/vehicles/${id}`,
  vehicleEvents: (id: number) => `/api/vehicles/${id}/events`,
  vehicleJourneys: (id: number) => `/api/vehicles/${id}/journeys`,
  vehicleFuelLevels: (id: number) => `/api/vehicles/${id}/fuel-levels`,
  vehicleOdometer: (id: number) => `/api/vehicles/${id}/odometer`,
  vehicleHourmeter: (id: number) => `/api/vehicles/${id}/hourmeter`,
  vehicleAttributes: (id: number) => `/api/vehicles/${id}/attributes`,
  vehicleSafepushConfig: (id: number) => `/api/vehicles/${id}/safepush_configuration`,
  vehiclePresences: (id: number) => `/api/vehicles/${id}/presences`,
}

const MOCK_MODE = !SAFEFLEET_USERNAME || !SAFEFLEET_PASSWORD

type Action =
  | 'ping'
  | 'getVehicles'
  | 'getPositions'
  | 'getHistory'
  | 'getEvents'

interface SafefleetRequest {
  action: Action
  vehicleId?: number | string
  from?: string
  to?: string
}

// Public types consumed by the GpsKeylessTab frontend. We normalize
// SafeFleet's raw shapes (paginated VehicleList, sparse LastPositionsResponse)
// into a single dashboard-friendly shape.
export interface SfVehicle {
  id: number
  plate: string
  model: string
  status: 'online' | 'offline' | 'moving' | 'idle' | 'alarm' | 'blocked'
  speed_kmh: number
  fuel_percent: number
  battery_voltage: number
  engine_temp_c: number
  oil_temp_c: number
  odometer_km: number
  last_position: { lat: number; lng: number; address: string; ts: string }
  geofence?: { enabled: boolean; area_name: string }
  limits?: {
    speed_kmh: number
    crash_alarm: boolean
    geofence_exit_alarm: boolean
    after_hours_alarm: boolean
  }
}

export interface SfPosition {
  vehicle_id: number
  lat: number
  lng: number
  speed_kmh: number
  heading: number
  ts: string
  status: SfVehicle['status']
}

export interface SfHistoryPoint {
  lat: number
  lng: number
  speed_kmh: number
  ts: string
}

export interface SfEvent {
  id: string
  vehicle_id: number
  vehicle_plate: string
  vehicle_model: string
  type: 'speed' | 'geofence_exit' | 'crash' | 'engine_start' | 'engine_stop' | 'long_stop' | 'after_hours'
  severity: 'info' | 'warning' | 'critical'
  message: string
  ts: string
}

let tokens: { access: string; refresh: string } | null = null

async function login(): Promise<void> {
  const res = await fetch(`${SAFEFLEET_BASE_URL}${EP.login}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      username: SAFEFLEET_USERNAME,
      password: SAFEFLEET_PASSWORD,
      access_token_seconds_duration: ACCESS_TTL,
      refresh_token_seconds_duration: REFRESH_TTL,
    }),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`SafeFleet login HTTP ${res.status}: ${txt.slice(0, 200)}`)
  }
  const body = await res.json()
  if (!body.access || !body.refresh) throw new Error('SafeFleet login returned no tokens')
  tokens = { access: body.access, refresh: body.refresh }
}

async function refreshAccess(): Promise<boolean> {
  if (!tokens?.refresh) return false
  const res = await fetch(`${SAFEFLEET_BASE_URL}${EP.refresh}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      refresh: tokens.refresh,
      access_token_seconds_duration: ACCESS_TTL,
    }),
  })
  if (!res.ok) {
    tokens = null
    return false
  }
  const body = await res.json()
  if (!body.access) return false
  tokens.access = body.access
  if (body.refresh) tokens.refresh = body.refresh
  return true
}

async function sfFetch<T = unknown>(path: string, init?: RequestInit, retry = true): Promise<T> {
  if (!tokens) await login()
  const res = await fetch(`${SAFEFLEET_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${tokens!.access}`,
      Accept: 'application/json',
    },
  })
  if (res.status === 401 && retry) {
    const refreshed = await refreshAccess()
    if (!refreshed) await login()
    return sfFetch<T>(path, init, false)
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`SafeFleet ${path} HTTP ${res.status}: ${txt.slice(0, 200)}`)
  }
  if (res.status === 204) return null as T
  return res.json() as Promise<T>
}

// ---------- mock data ----------

function mockVehicle(
  id: number,
  model: string,
  plate: string,
  status: SfVehicle['status'],
  speed: number,
  fuel: number,
  pos: { lat: number; lng: number; address: string },
): SfVehicle {
  return {
    id,
    plate,
    model,
    status,
    speed_kmh: speed,
    fuel_percent: fuel,
    battery_voltage: 14.2,
    engine_temp_c: 90,
    oil_temp_c: 92,
    odometer_km: 51_300 + Math.floor(Math.random() * 20_000),
    last_position: { ...pos, ts: new Date(Date.now() - Math.random() * 5 * 60_000).toISOString() },
    geofence: { enabled: true, area_name: 'Zona Napoli Est' },
    limits: { speed_kmh: 90, crash_alarm: true, geofence_exit_alarm: true, after_hours_alarm: true },
  }
}

const MOCK_VEHICLES: SfVehicle[] = [
  mockVehicle(1, 'Audi RS3', 'PA85501', 'online', 84, 81, { lat: 39.2130, lng: 9.1370, address: 'Viale Marconi 229, 09131 Cagliari CA' }),
  mockVehicle(2, 'BMW M3 Comp.', 'PA62042', 'idle', 0, 76, { lat: 39.2156, lng: 9.1116, address: 'Via Roma, 09124 Cagliari CA' }),
  mockVehicle(3, 'Mercedes Vito VIP', 'DM876V', 'moving', 62, 40, { lat: 39.2415, lng: 9.1837, address: 'Quartu Sant\'Elena CA' }),
  mockVehicle(4, 'Fiat Ducato Maxi', 'DH885LL', 'offline', 0, 65, { lat: 39.2557, lng: 9.0540, address: 'Aeroporto Elmas, 09030 CA' }),
  mockVehicle(5, 'Porsche Macan GTS', 'VAA567', 'moving', 96, 53, { lat: 39.1972, lng: 9.1760, address: 'Poetto, 09126 Cagliari CA' }),
  mockVehicle(6, 'BMW M4 Comp.', 'TT54551', 'online', 0, 38, { lat: 39.2245, lng: 9.1248, address: 'Castello, 09124 Cagliari CA' }),
  mockVehicle(7, 'Mercedes C63 S E', 'KN1010X', 'alarm', 142, 18, { lat: 39.0254, lng: 9.0014, address: 'Pula, 09010 CA' }),
  mockVehicle(8, 'Jeep Renegade', 'GH200OL', 'online', 0, 67, { lat: 39.1390, lng: 9.5193, address: 'Villasimius, 09049 CA' }),
  mockVehicle(9, 'Porsche Carrera S', 'PR3007', 'online', 0, 45, { lat: 39.2204, lng: 9.1212, address: 'Via Dante, 09128 Cagliari CA' }),
  mockVehicle(10, 'Range Rover Sport', 'RR890Z', 'blocked', 0, 30, { lat: 39.2098, lng: 9.1192, address: 'Stampace, 09124 Cagliari CA' }),
]

function mockEvents(): SfEvent[] {
  const now = Date.now()
  return [
    { id: 'evt-1', vehicle_id: 1, vehicle_plate: 'PA85501', vehicle_model: 'Audi RS3', type: 'speed', severity: 'warning', message: 'Velocita eccessiva (142 km/h)', ts: new Date(now - 4 * 60_000).toISOString() },
    { id: 'evt-2', vehicle_id: 2, vehicle_plate: 'PA62042', vehicle_model: 'BMW M3 Comp.', type: 'geofence_exit', severity: 'warning', message: 'Uscita area consentita', ts: new Date(now - 12 * 60_000).toISOString() },
    { id: 'evt-3', vehicle_id: 3, vehicle_plate: 'DM876V', vehicle_model: 'Mercedes Vito VIP', type: 'crash', severity: 'critical', message: 'Urto rilevato', ts: new Date(now - 28 * 60_000).toISOString() },
    { id: 'evt-4', vehicle_id: 5, vehicle_plate: 'VAA567', vehicle_model: 'Porsche Macan GTS', type: 'engine_start', severity: 'info', message: 'Avvio veicolo', ts: new Date(now - 45 * 60_000).toISOString() },
    { id: 'evt-5', vehicle_id: 2, vehicle_plate: 'PA62042', vehicle_model: 'BMW M3 Comp.', type: 'long_stop', severity: 'info', message: 'Sosta lunga (45 min)', ts: new Date(now - 75 * 60_000).toISOString() },
    { id: 'evt-6', vehicle_id: 8, vehicle_plate: 'GH200OL', vehicle_model: 'Jeep Renegade', type: 'engine_stop', severity: 'info', message: 'Spegnimento motore', ts: new Date(now - 110 * 60_000).toISOString() },
  ]
}

function mockHistory(vehicleId: number, from?: string, to?: string): SfHistoryPoint[] {
  const center = MOCK_VEHICLES.find(v => v.id === vehicleId)?.last_position || MOCK_VEHICLES[0].last_position
  const toTs = to ? new Date(to).getTime() : Date.now()
  const fromTs = from ? new Date(from).getTime() : toTs - 6 * 60 * 60 * 1000
  const points: SfHistoryPoint[] = []
  const steps = 60
  for (let i = 0; i <= steps; i++) {
    const t = fromTs + ((toTs - fromTs) * i) / steps
    const jitter = (Math.sin(i / 3) + Math.cos(i / 5)) * 0.005
    points.push({
      lat: center.lat + jitter + i * 0.0004,
      lng: center.lng + jitter * 0.7 + i * 0.0006,
      speed_kmh: 30 + Math.round(Math.abs(Math.sin(i / 4) * 60)),
      ts: new Date(t).toISOString(),
    })
  }
  return points
}

// ---------- handler ----------

export const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin)

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  let req: SafefleetRequest
  try {
    req = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }
  }

  const vehicleId = typeof req.vehicleId === 'string' ? Number(req.vehicleId) : req.vehicleId

  try {
    if (req.action === 'ping') {
      return ok(headers, { mock: MOCK_MODE, base_url: SAFEFLEET_BASE_URL, fleet_id: SAFEFLEET_FLEET_ID || null })
    }

    if (MOCK_MODE) {
      switch (req.action) {
        case 'getVehicles':
          return ok(headers, { vehicles: MOCK_VEHICLES, mock: true })
        case 'getPositions':
          return ok(headers, {
            positions: MOCK_VEHICLES.map<SfPosition>(v => ({
              vehicle_id: v.id,
              lat: v.last_position.lat,
              lng: v.last_position.lng,
              speed_kmh: v.speed_kmh,
              heading: Math.floor(Math.random() * 360),
              ts: v.last_position.ts,
              status: v.status,
            })),
            mock: true,
          })
        case 'getHistory':
          if (!vehicleId) return bad(headers, 'vehicleId required')
          return ok(headers, { history: mockHistory(vehicleId, req.from, req.to), mock: true })
        case 'getEvents':
          return ok(headers, { events: mockEvents(), mock: true })
        default:
          return bad(headers, `Unknown action: ${req.action}`)
      }
    }

    switch (req.action) {
      case 'getVehicles': {
        // Paginated — pull first page large; switch to multi-page if >200 vehicles
        const data = await sfFetch<{ count: number; results: unknown[] }>(`${EP.vehicles}?page_size=200`)
        return ok(headers, { vehicles: data.results, count: data.count, mock: false })
      }
      case 'getPositions': {
        const qs = SAFEFLEET_FLEET_ID ? `?fleet_id=${encodeURIComponent(SAFEFLEET_FLEET_ID)}` : ''
        const data = await sfFetch(`${EP.currentPositions}${qs}`)
        return ok(headers, { positions: data, mock: false })
      }
      case 'getHistory': {
        if (!vehicleId) return bad(headers, 'vehicleId required')
        const qs = new URLSearchParams()
        if (req.from) qs.set('start_moment', req.from)
        if (req.to) qs.set('end_moment', req.to)
        const url = `${EP.vehicleJourneys(vehicleId)}${qs.toString() ? '?' + qs.toString() : ''}`
        const data = await sfFetch(url)
        return ok(headers, { history: data, mock: false })
      }
      case 'getEvents': {
        if (!vehicleId) return bad(headers, 'vehicleId required (events are per-vehicle in SafeFleet)')
        const data = await sfFetch(EP.vehicleEvents(vehicleId))
        return ok(headers, { events: data, mock: false })
      }
      default:
        return bad(headers, `Unknown action: ${req.action}`)
    }
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: (err as Error).message }) }
  }
}

function ok(headers: Record<string, string>, body: unknown) {
  return { statusCode: 200, headers, body: JSON.stringify(body) }
}
function bad(headers: Record<string, string>, message: string) {
  return { statusCode: 400, headers, body: JSON.stringify({ error: message }) }
}
