import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'

type VehicleStatus = 'online' | 'offline' | 'moving' | 'idle' | 'alarm' | 'blocked'

interface SfVehicle {
  id: number
  plate: string
  model: string
  status: VehicleStatus
  speed_kmh: number
  fuel_percent: number
  battery_voltage: number
  engine_temp_c: number
  oil_temp_c: number
  odometer_km: number
  last_position: { lat: number; lng: number; address: string; ts: string }
  geofence?: { enabled: boolean; area_name: string }
  limits?: { speed_kmh: number; crash_alarm: boolean; geofence_exit_alarm: boolean; after_hours_alarm: boolean }
}

interface SfPosition {
  vehicle_id: number
  lat: number
  lng: number
  speed_kmh: number
  heading: number
  ts: string
  status: VehicleStatus
}

interface SfHistoryPoint { lat: number; lng: number; speed_kmh: number; ts: string }

interface SfEvent {
  id: string
  vehicle_id: number
  vehicle_plate: string
  vehicle_model: string
  type: 'speed' | 'geofence_exit' | 'crash' | 'engine_start' | 'engine_stop' | 'long_stop' | 'after_hours'
  severity: 'info' | 'warning' | 'critical'
  message: string
  ts: string
}

const STATUS_COLOR: Record<VehicleStatus, string> = {
  online: '#10b981',
  moving: '#0ea5e9',
  idle: '#a1a1aa',
  offline: '#52525b',
  alarm: '#f43f5e',
  blocked: '#dc2626',
}

const STATUS_LABEL: Record<VehicleStatus, string> = {
  online: 'Online',
  moving: 'In movimento',
  idle: 'Fermo',
  offline: 'Offline',
  alarm: 'Allarme',
  blocked: 'Bloccato',
}

async function sfApi<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch('/.netlify/functions/safefleet-api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`safefleet-api ${res.status}`)
  return res.json() as Promise<T>
}

function fmtTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'adesso'
  if (m < 60) return `${m} min fa`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h fa`
  return `${Math.floor(h / 24)}g fa`
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
}

function markerIcon(status: VehicleStatus, plate: string): L.DivIcon {
  const color = STATUS_COLOR[status]
  const pulse = status === 'alarm' || status === 'moving'
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;">
        ${pulse ? `<span style="position:absolute;inset:0;border-radius:9999px;background:${color};opacity:.25;animation:sf-pulse 1.6s ease-out infinite;"></span>` : ''}
        <div style="width:22px;height:22px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px #000;display:flex;align-items:center;justify-content:center;">
          <span style="font-size:9px;color:#fff;font-weight:700;font-family:ui-monospace,Menlo,monospace">${plate.slice(-3)}</span>
        </div>
      </div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  })
}

function FitToMarkers({ vehicles }: { vehicles: SfVehicle[] }) {
  const map = useMap()
  const didFit = useRef(false)
  useEffect(() => {
    if (didFit.current || vehicles.length === 0) return
    const bounds = L.latLngBounds(vehicles.map(v => [v.last_position.lat, v.last_position.lng]))
    map.fitBounds(bounds.pad(0.2), { animate: false })
    didFit.current = true
  }, [vehicles, map])
  return null
}

function FlyTo({ position }: { position: { lat: number; lng: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (position) map.flyTo([position.lat, position.lng], Math.max(map.getZoom(), 14), { duration: 0.6 })
  }, [position, map])
  return null
}

function StatusDot({ status, size = 8 }: { status: VehicleStatus; size?: number }) {
  return <span className="inline-block rounded-full" style={{ width: size, height: size, background: STATUS_COLOR[status] }} />
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-zinc-800 bg-zinc-900/70 ${className}`}>{children}</div>
}

function KpiCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-800 bg-black text-white">{icon}</div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
          <div className="text-2xl font-semibold text-white leading-tight">{value}</div>
          {sub && <div className="text-[11px] text-zinc-400 mt-0.5">{sub}</div>}
        </div>
      </div>
    </Card>
  )
}

function VehicleListItem({ v, selected, onSelect }: { v: SfVehicle; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2.5 flex items-center gap-3 border-l-2 transition-colors ${
        selected ? 'bg-white text-black border-white' : 'border-transparent text-zinc-200 hover:bg-zinc-800/60'
      }`}
    >
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-zinc-700 bg-black">
        <span className={`text-[10px] font-mono ${selected ? 'text-zinc-300' : 'text-zinc-400'}`}>{v.plate.slice(0, 3)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{v.model}</span>
          <span className={`text-xs font-mono ${selected ? 'text-zinc-700' : 'text-zinc-500'}`}>{v.plate}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <StatusDot status={v.status} />
          <span className={`text-[11px] ${selected ? 'text-zinc-700' : 'text-zinc-400'}`}>{STATUS_LABEL[v.status]}</span>
          <span className={`ml-auto text-[11px] tabular-nums ${selected ? 'text-zinc-700' : 'text-zinc-400'}`}>{v.speed_kmh} km/h</span>
        </div>
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className={selected ? 'h-full bg-black' : 'h-full bg-white'}
            style={{ width: `${Math.max(2, v.fuel_percent)}%` }}
          />
        </div>
      </div>
    </button>
  )
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-800">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">{children}</h3>
      {right}
    </div>
  )
}

function Stat({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-lg font-semibold text-white tabular-nums">
        {value}
        {unit && <span className="text-xs font-normal text-zinc-400 ml-1">{unit}</span>}
      </div>
    </div>
  )
}

function generateHourlyUsage() {
  const data: { hour: string; km: number; engine: number }[] = []
  for (let h = 0; h < 24; h++) {
    const km = Math.round(Math.abs(Math.sin((h - 6) / 3)) * 80 + Math.random() * 30)
    const engine = Math.min(60, Math.round(km / 1.4 + Math.random() * 10))
    data.push({ hour: String(h).padStart(2, '0'), km, engine })
  }
  return data
}

export default function GpsKeylessTab() {
  const [vehicles, setVehicles] = useState<SfVehicle[]>([])
  const [, setPositions] = useState<SfPosition[]>([])
  const [events, setEvents] = useState<SfEvent[]>([])
  const [history, setHistory] = useState<SfHistoryPoint[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [mockMode, setMockMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRoute, setShowRoute] = useState(false)

  const usageData = useMemo(generateHourlyUsage, [])

  const loadInitial = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ping, vRes, pRes, eRes] = await Promise.all([
        sfApi<{ mock: boolean }>({ action: 'ping' }),
        sfApi<{ vehicles: SfVehicle[] }>({ action: 'getVehicles' }),
        sfApi<{ positions: SfPosition[] }>({ action: 'getPositions' }),
        sfApi<{ events: SfEvent[] }>({ action: 'getEvents' }),
      ])
      setMockMode(ping.mock)
      setVehicles(vRes.vehicles || [])
      setPositions(pRes.positions || [])
      setEvents(eRes.events || [])
      if (!selectedId && vRes.vehicles?.length) setSelectedId(vRes.vehicles[0].id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => { loadInitial() }, [loadInitial])

  // poll positions every 30s
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const pRes = await sfApi<{ positions: SfPosition[] }>({ action: 'getPositions' })
        const positions = pRes.positions || []
        setPositions(positions)
        // merge into vehicles so the map markers + speeds reflect the latest poll
        setVehicles(prev => prev.map(v => {
          const p = positions.find(pp => pp.vehicle_id === v.id)
          if (!p) return v
          return { ...v, speed_kmh: p.speed_kmh, status: p.status, last_position: { ...v.last_position, lat: p.lat, lng: p.lng, ts: p.ts } }
        }))
      } catch { /* swallow */ }
    }, 30_000)
    return () => clearInterval(t)
  }, [])

  // load history for selected vehicle
  useEffect(() => {
    if (!selectedId) { setHistory([]); return }
    sfApi<{ history: SfHistoryPoint[] }>({ action: 'getHistory', vehicleId: selectedId })
      .then(r => setHistory(r.history || []))
      .catch(() => setHistory([]))
  }, [selectedId])

  const selected = useMemo(() => vehicles.find(v => v.id === selectedId) || null, [vehicles, selectedId])

  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return vehicles
    return vehicles.filter(v => v.plate.toLowerCase().includes(q) || v.model.toLowerCase().includes(q))
  }, [vehicles, search])

  const kpis = useMemo(() => {
    const online = vehicles.filter(v => v.status === 'online' || v.status === 'moving' || v.status === 'idle').length
    const offline = vehicles.filter(v => v.status === 'offline').length
    const alarmCount = vehicles.filter(v => v.status === 'alarm').length
    const blocked = vehicles.filter(v => v.status === 'blocked').length
    const moving = vehicles.filter(v => v.status === 'moving')
    const avgSpeed = moving.length ? Math.round(moving.reduce((s, v) => s + v.speed_kmh, 0) / moving.length) : 0
    const avgFuel = vehicles.length ? Math.round(vehicles.reduce((s, v) => s + v.fuel_percent, 0) / vehicles.length) : 0
    const total = vehicles.length || 1
    return {
      online, offline, alarmCount, blocked, avgSpeed, avgFuel,
      onlinePct: Math.round((online / total) * 100),
      offlinePct: Math.round((offline / total) * 100),
    }
  }, [vehicles])

  const activeAlarms = useMemo(() => events.filter(e => e.severity !== 'info').slice(0, 5), [events])
  const recentEvents = useMemo(() => events.slice(0, 6), [events])

  return (
    <div className="bg-black text-white min-h-screen -mx-4 -my-6 px-4 py-6 sm:-mx-6 sm:px-6">
      <style>{`@keyframes sf-pulse{0%{transform:scale(.6);opacity:.5}100%{transform:scale(2);opacity:0}}`}</style>

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">GPS Flotta</h1>
          <p className="text-sm text-zinc-400">Controlla e gestisci i veicoli in tempo reale</p>
        </div>
        <div className="flex items-center gap-3">
          {mockMode && (
            <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-[11px] font-medium text-zinc-300">
              MODALITA DEMO — credenziali SafeFleet non configurate
            </span>
          )}
          <button
            onClick={loadInitial}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-white hover:text-black transition-colors"
          >
            Aggiorna
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-2 text-sm text-rose-200">
          Errore: {error}
        </div>
      )}

      {/* Top KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <KpiCard
          label="Veicoli online"
          value={String(kpis.online)}
          sub={`${kpis.onlinePct}% della flotta`}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>}
        />
        <KpiCard
          label="Veicoli offline"
          value={String(kpis.offline)}
          sub={`${kpis.offlinePct}% della flotta`}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>}
        />
        <KpiCard
          label="Allarmi attivi"
          value={String(kpis.alarmCount)}
          sub={kpis.alarmCount ? 'da gestire' : 'nessun allarme'}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>}
        />
        <KpiCard
          label="Bloccati"
          value={String(kpis.blocked)}
          sub={kpis.blocked ? `${kpis.blocked} veicolo immob.` : 'nessuno'}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>}
        />
        <KpiCard
          label="Velocita media"
          value={`${kpis.avgSpeed} km/h`}
          sub="veicoli in movimento"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>}
        />
        <KpiCard
          label="Carburante medio"
          value={`${kpis.avgFuel}%`}
          sub="livello flotta"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="22" x2="15" y2="22" /><line x1="4" y1="9" x2="14" y2="9" /><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18" /><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5" /></svg>}
        />
      </div>

      {/* Main 3-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-3">
        {/* Vehicle list */}
        <Card className="lg:col-span-3 flex flex-col">
          <SectionTitle right={<span className="text-xs text-zinc-500">{filteredVehicles.length}</span>}>
            Veicoli ({vehicles.length})
          </SectionTitle>
          <div className="p-3 border-b border-zinc-800">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Cerca veicolo..."
                className="w-full rounded-md border border-zinc-700 bg-black pl-8 pr-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-white focus:outline-none"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto max-h-[560px] divide-y divide-zinc-800/60">
            {loading && <div className="p-4 text-sm text-zinc-500">Caricamento...</div>}
            {!loading && filteredVehicles.length === 0 && (
              <div className="p-4 text-sm text-zinc-500">Nessun veicolo trovato</div>
            )}
            {filteredVehicles.map(v => (
              <VehicleListItem key={v.id} v={v} selected={v.id === selectedId} onSelect={() => setSelectedId(v.id)} />
            ))}
          </div>
        </Card>

        {/* Map */}
        <Card className="lg:col-span-6 flex flex-col overflow-hidden">
          <SectionTitle
            right={
              <div className="flex items-center gap-3 text-[11px] text-zinc-400">
                {(['online', 'moving', 'idle', 'alarm', 'offline', 'blocked'] as VehicleStatus[]).map(s => (
                  <span key={s} className="inline-flex items-center gap-1">
                    <StatusDot status={s} /> {STATUS_LABEL[s]}
                  </span>
                ))}
              </div>
            }
          >
            Posizione veicoli in tempo reale
          </SectionTitle>
          <div className="relative" style={{ height: 560 }}>
            <MapContainer
              center={[40.84, 14.25]}
              zoom={11}
              scrollWheelZoom
              style={{ height: '100%', width: '100%', background: '#000' }}
              attributionControl={false}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                subdomains={['a', 'b', 'c', 'd']}
              />
              <FitToMarkers vehicles={vehicles} />
              {selected && <FlyTo position={selected.last_position} />}
              {vehicles.map(v => (
                <Marker
                  key={v.id}
                  position={[v.last_position.lat, v.last_position.lng]}
                  icon={markerIcon(v.status, v.plate)}
                  eventHandlers={{ click: () => setSelectedId(v.id) }}
                >
                  <Popup>
                    <div style={{ fontFamily: 'ui-sans-serif, system-ui', fontSize: 12 }}>
                      <div style={{ fontWeight: 600 }}>{v.model}</div>
                      <div style={{ color: '#52525b' }}>{v.plate}</div>
                      <div style={{ marginTop: 4 }}>{v.last_position.address}</div>
                    </div>
                  </Popup>
                </Marker>
              ))}
              {showRoute && selected && history.length > 1 && (
                <Polyline
                  positions={history.map(h => [h.lat, h.lng])}
                  pathOptions={{ color: '#ffffff', weight: 3, opacity: 0.85, dashArray: '4 6' }}
                />
              )}
            </MapContainer>
          </div>
        </Card>

        {/* Selected vehicle detail */}
        <Card className="lg:col-span-3 flex flex-col">
          <SectionTitle>Veicolo selezionato</SectionTitle>
          {selected ? (
            <div className="p-4 space-y-4 overflow-y-auto max-h-[560px]">
              <div className="flex items-center gap-3">
                <div className="grid h-14 w-14 place-items-center rounded-lg border border-zinc-700 bg-black">
                  <span className="text-[10px] font-mono text-zinc-400">{selected.plate}</span>
                </div>
                <div className="min-w-0">
                  <div className="text-base font-semibold truncate">{selected.model}</div>
                  <div className="text-xs text-zinc-400">{selected.plate}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Stat label="Stato" value={STATUS_LABEL[selected.status]} />
                <Stat label="Velocita" value={selected.speed_kmh} unit="km/h" />
                <Stat label="Carburante" value={`${selected.fuel_percent}%`} />
                <Stat label="Ultimo agg." value={fmtTimeAgo(selected.last_position.ts)} />
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Posizione</div>
                <div className="text-sm text-zinc-200 mt-1">{selected.last_position.address}</div>
              </div>

              {/* GEO-FENCE — READ ONLY (SafeFleet expose flags, not active control) */}
              <div className="rounded-lg border border-zinc-800 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Geo-fence</span>
                  <span className={`text-[11px] ${selected.geofence?.enabled ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    {selected.geofence?.enabled ? 'Attiva' : 'Disattiva'}
                  </span>
                </div>
                <div className="text-xs text-zinc-400">
                  {selected.geofence?.area_name || '—'}
                </div>
              </div>

              {/* Limits / Alarms — READ ONLY */}
              <div className="rounded-lg border border-zinc-800 divide-y divide-zinc-800">
                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-300">Limiti & Allarmi</div>
                <div className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-zinc-400">Limite velocita</span>
                  <span className="font-mono text-white">{selected.limits?.speed_kmh ?? '—'} km/h</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-zinc-400">Allarme urto</span>
                  <span className={selected.limits?.crash_alarm ? 'text-emerald-400' : 'text-zinc-500'}>{selected.limits?.crash_alarm ? 'Attivo' : 'Disattivo'}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-zinc-400">Uscita area</span>
                  <span className={selected.limits?.geofence_exit_alarm ? 'text-emerald-400' : 'text-zinc-500'}>{selected.limits?.geofence_exit_alarm ? 'Attivo' : 'Disattivo'}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-zinc-400">Utilizzo fuori orario</span>
                  <span className={selected.limits?.after_hours_alarm ? 'text-emerald-400' : 'text-zinc-500'}>{selected.limits?.after_hours_alarm ? 'Attivo' : 'Disattivo'}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 text-sm text-zinc-500">Seleziona un veicolo</div>
          )}
        </Card>
      </div>

      {/* Middle row: alarms / 24h usage chart / recent events */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
        <Card>
          <SectionTitle right={<span className="text-[11px] text-zinc-500">{activeAlarms.length}</span>}>
            Allarmi attivi
          </SectionTitle>
          <div className="divide-y divide-zinc-800/60 max-h-72 overflow-y-auto">
            {activeAlarms.length === 0 && <div className="p-4 text-sm text-zinc-500">Nessun allarme attivo</div>}
            {activeAlarms.map(a => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                <div className={`grid h-8 w-8 place-items-center rounded-md ${a.severity === 'critical' ? 'bg-rose-950 text-rose-400' : 'bg-zinc-800 text-zinc-300'}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /></svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate">{a.message}</div>
                  <div className="text-[11px] text-zinc-500">{a.vehicle_model} — {a.vehicle_plate} — {fmtTimeAgo(a.ts)}</div>
                </div>
                <button
                  onClick={() => setSelectedId(a.vehicle_id)}
                  className="text-[11px] text-zinc-400 hover:text-white"
                >
                  visualizza
                </button>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle right={<span className="text-[11px] text-zinc-500">24h</span>}>
            Analisi utilizzo
          </SectionTitle>
          <div className="p-3" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={usageData} margin={{ top: 10, right: 8, bottom: 0, left: -20 }}>
                <XAxis dataKey="hour" stroke="#71717a" fontSize={10} interval={2} />
                <YAxis stroke="#71717a" fontSize={10} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{ background: '#0a0a0a', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#a1a1aa' }}
                />
                <Bar dataKey="km" fill="#ffffff" radius={[2, 2, 0, 0]} />
                <Bar dataKey="engine" fill="#52525b" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <SectionTitle>Storico recenti</SectionTitle>
          <div className="divide-y divide-zinc-800/60 max-h-72 overflow-y-auto">
            {recentEvents.length === 0 && <div className="p-4 text-sm text-zinc-500">Nessun evento recente</div>}
            {recentEvents.map(e => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                <StatusDot status={e.severity === 'critical' ? 'alarm' : e.severity === 'warning' ? 'idle' : 'online'} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate">{e.message}</div>
                  <div className="text-[11px] text-zinc-500">{e.vehicle_model} — {fmtTime(e.ts)}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <SectionTitle>Stato veicolo selezionato</SectionTitle>
          {selected ? (
            <div className="grid grid-cols-2 gap-3 p-4">
              <Stat label="Carburante" value={`${selected.fuel_percent}%`} />
              <Stat label="Batteria" value={selected.battery_voltage} unit="V" />
              <Stat label="Olio" value={selected.oil_temp_c} unit="°C" />
              <Stat label="Chilometri" value={selected.odometer_km.toLocaleString('it-IT')} unit="km" />
            </div>
          ) : <div className="p-4 text-sm text-zinc-500">—</div>}
        </Card>

        <Card>
          <SectionTitle
            right={
              selected && (
                <button onClick={() => setShowRoute(s => !s)} className="text-[11px] text-zinc-400 hover:text-white">
                  {showRoute ? 'Nascondi percorso' : 'Visualizza percorso'}
                </button>
              )
            }
          >
            Percorso odierno
          </SectionTitle>
          {selected ? (
            <div className="grid grid-cols-3 gap-3 p-4">
              <Stat label="Distanza" value={Math.round((history.reduce((s, h, i, a) => i ? s + dist(a[i - 1], h) : s, 0)) / 1000)} unit="km" />
              <Stat label="Durata" value={fmtDuration(history)} />
              <Stat label="Soste" value={Math.max(0, Math.round(history.length / 12))} />
            </div>
          ) : <div className="p-4 text-sm text-zinc-500">—</div>}
        </Card>

        <Card>
          <SectionTitle right={<span className="text-[11px] text-zinc-500">30gg</span>}>
            Comportamento di guida
          </SectionTitle>
          <div className="p-4 flex items-center gap-4">
            <div className="text-4xl font-bold text-white tabular-nums">78</div>
            <div className="text-[11px] text-zinc-400 space-y-1 flex-1">
              <DriverMetric label="Frenate brusche" stars={4} />
              <DriverMetric label="Accelerazioni" stars={3} />
              <DriverMetric label="Curve" stars={4} />
              <DriverMetric label="Velocita eccessiva" stars={2} />
            </div>
          </div>
        </Card>

        <Card>
          <SectionTitle right={<span className="text-[11px] text-zinc-500">30gg</span>}>
            Consumi
          </SectionTitle>
          <div className="grid grid-cols-2 gap-3 p-4">
            <Stat label="Consumo medio" value="9,2" unit="l/100km" />
            <Stat label="Totale carburante" value="210" unit="L" />
          </div>
        </Card>
      </div>
    </div>
  )
}

function dist(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function fmtDuration(h: SfHistoryPoint[]): string {
  if (h.length < 2) return '0m'
  const sec = (new Date(h[h.length - 1].ts).getTime() - new Date(h[0].ts).getTime()) / 1000
  const mins = Math.round(sec / 60)
  const hh = Math.floor(mins / 60)
  const mm = mins % 60
  return hh ? `${hh}h ${mm}m` : `${mm}m`
}

function DriverMetric({ label, stars }: { label: string; stars: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-zinc-400 truncate">{label}</span>
      <span className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map(i => (
          <span key={i} className={i <= stars ? 'text-white' : 'text-zinc-700'}>•</span>
        ))}
      </span>
    </div>
  )
}
