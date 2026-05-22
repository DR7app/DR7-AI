import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { motion } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { supabase } from '../../../supabaseClient'
import { useTheme } from '../../../contexts/ThemeContext'

type VehicleStatus = 'online' | 'offline' | 'moving' | 'idle' | 'alarm' | 'blocked'
type MobileView = 'veicoli' | 'mappa' | 'dettaglio'

interface SfVehicle {
  id: number
  plate: string
  model: string
  image?: string | null
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

interface DR7Vehicle {
  id: string
  display_name: string
  plate: string | null
  metadata: { image?: string } | null
  status: string | null
  safefleet_device_id?: string | null
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
  return (
    <div
      className={`relative rounded-xl backdrop-blur-xl bg-white/95 ring-1 ring-zinc-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)] dark:bg-gradient-to-b dark:from-zinc-900/70 dark:via-zinc-950/60 dark:to-zinc-950/80 dark:ring-cyan-400/5 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_32px_-16px_rgba(0,0,0,0.8),0_0_40px_-20px_rgba(34,211,238,0.25)] ${className}`}
    >
      {children}
    </div>
  )
}

const KPI_COLORS = {
  cyan:    { ring: 'ring-cyan-500/30 dark:ring-cyan-500/20',       text: 'text-cyan-700 dark:text-cyan-300',       val: 'text-cyan-700 dark:text-cyan-200',       glow: 'bg-cyan-500/10',    ic: 'bg-cyan-500/10 text-cyan-700 ring-cyan-500/30 dark:bg-cyan-500/15 dark:text-cyan-300' },
  emerald: { ring: 'ring-emerald-500/30 dark:ring-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-300', val: 'text-emerald-700 dark:text-emerald-200', glow: 'bg-emerald-500/10', ic: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300' },
  rose:    { ring: 'ring-rose-500/30 dark:ring-rose-500/20',       text: 'text-rose-700 dark:text-rose-300',       val: 'text-rose-700 dark:text-rose-200',       glow: 'bg-rose-500/10',    ic: 'bg-rose-500/10 text-rose-700 ring-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300' },
  amber:   { ring: 'ring-amber-500/30 dark:ring-amber-500/20',     text: 'text-amber-700 dark:text-amber-300',     val: 'text-amber-700 dark:text-amber-200',     glow: 'bg-amber-500/10',   ic: 'bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300' },
  sky:     { ring: 'ring-sky-500/30 dark:ring-sky-500/20',         text: 'text-sky-700 dark:text-sky-300',         val: 'text-sky-700 dark:text-sky-200',         glow: 'bg-sky-500/10',     ic: 'bg-sky-500/10 text-sky-700 ring-sky-500/30 dark:bg-sky-500/15 dark:text-sky-300' },
  violet:  { ring: 'ring-violet-500/30 dark:ring-violet-500/20',   text: 'text-violet-700 dark:text-violet-300',   val: 'text-violet-700 dark:text-violet-200',   glow: 'bg-violet-500/10',  ic: 'bg-violet-500/10 text-violet-700 ring-violet-500/30 dark:bg-violet-500/15 dark:text-violet-300' },
} as const

type KpiColor = keyof typeof KPI_COLORS

function KpiCard({ label, value, sub, icon, color = 'cyan', index = 0 }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; color?: KpiColor; index?: number
}) {
  const c = KPI_COLORS[color]
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -2 }}
      className={`group relative overflow-hidden rounded-xl ring-1 ${c.ring} bg-gradient-to-b from-white to-zinc-50/80 backdrop-blur-xl dark:from-zinc-900/80 dark:via-zinc-950/70 dark:to-black/60 px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_24px_-12px_rgba(34,211,238,0.4)] transition-shadow hover:shadow-[0_8px_24px_-12px_rgba(34,211,238,0.3)] dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_0_40px_-12px_rgba(34,211,238,0.5)]`}
    >
      {/* Ambient glow */}
      <div className={`absolute -top-8 -right-8 w-24 h-24 ${c.glow} rounded-full blur-3xl pointer-events-none opacity-70 group-hover:opacity-100 transition-opacity`}/>
      {/* Top edge highlight */}
      <div className="absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent opacity-0 dark:opacity-100 pointer-events-none"/>
      <div className="relative flex items-center gap-2.5">
        <div className={`grid h-8 w-8 place-items-center rounded-lg ring-1 ${c.ic} shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]`}>{icon}</div>
        <div className="min-w-0">
          <div className={`text-[8.5px] uppercase tracking-[0.18em] font-bold ${c.text} truncate`}>{label}</div>
          <div className={`text-lg sm:text-xl font-bold leading-none mt-0.5 ${c.val} tabular-nums tracking-tight`}>{value}</div>
          {sub && <div className="text-[9.5px] text-zinc-500 dark:text-zinc-500 truncate mt-1 font-mono">{sub}</div>}
        </div>
      </div>
    </motion.div>
  )
}

function VehicleListItem({ v, selected, onSelect }: { v: SfVehicle; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-2.5 py-2 flex items-center gap-2.5 border-l-2 transition-all ${
        selected
          ? 'bg-cyan-50 border-cyan-500 text-cyan-900 dark:bg-cyan-500/10 dark:border-cyan-400 dark:text-white dark:shadow-[inset_0_0_24px_-12px_rgba(34,211,238,0.45)]'
          : 'border-transparent text-zinc-700 hover:bg-zinc-100 hover:border-zinc-300 dark:text-zinc-300 dark:hover:bg-zinc-800/40 dark:hover:border-zinc-700'
      }`}
    >
      {v.image ? (
        <img
          src={v.image}
          alt={v.model}
          className={`h-9 w-12 shrink-0 rounded-md object-cover ring-1 ${selected ? 'ring-cyan-500/50 dark:ring-cyan-400/50' : 'ring-zinc-300 dark:ring-zinc-700'}`}
        />
      ) : (
        <div className={`grid h-9 w-12 shrink-0 place-items-center rounded-md ring-1 ${selected ? 'ring-cyan-500/50 bg-cyan-50 dark:ring-cyan-400/50 dark:bg-cyan-500/10' : 'ring-zinc-300 bg-zinc-50 dark:ring-zinc-700 dark:bg-zinc-900'}`}>
          <span className={`text-[10px] font-mono ${selected ? 'text-cyan-700 dark:text-cyan-200' : 'text-zinc-500 dark:text-zinc-400'}`}>{v.plate.slice(0, 3)}</span>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[12.5px] font-semibold">{v.model}</span>
          <span className={`text-[10px] font-mono ${selected ? 'text-cyan-700/80 dark:text-cyan-200/80' : 'text-zinc-500'}`}>{v.plate}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <StatusDot status={v.status} size={6}/>
          <span className={`text-[10px] ${selected ? 'text-cyan-800/80 dark:text-cyan-100/80' : 'text-zinc-500 dark:text-zinc-400'}`}>{STATUS_LABEL[v.status]}</span>
          <span className={`ml-auto text-[10px] tabular-nums ${selected ? 'text-cyan-800 dark:text-cyan-100' : 'text-zinc-500 dark:text-zinc-400'}`}>{v.speed_kmh} km/h</span>
        </div>
        <div className={`mt-1 h-[3px] w-full overflow-hidden rounded-full ${selected ? 'bg-cyan-200 dark:bg-cyan-900/40' : 'bg-zinc-200 dark:bg-zinc-800'}`}>
          <div
            className={selected ? 'h-full bg-cyan-500 dark:bg-cyan-400' : 'h-full bg-zinc-400 dark:bg-zinc-500'}
            style={{ width: `${Math.max(2, v.fuel_percent)}%` }}
          />
        </div>
      </div>
    </button>
  )
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 shrink-0 relative">
      <h3 className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-cyan-300/70 truncate">{children}</h3>
      {right}
      {/* Subtle bottom separator with gradient */}
      <div className="absolute inset-x-3 bottom-0 h-px bg-gradient-to-r from-transparent via-zinc-200 to-transparent dark:via-cyan-500/10 pointer-events-none"/>
    </div>
  )
}

function Stat({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</div>
      <div className="text-sm font-bold text-zinc-900 dark:text-white tabular-nums leading-tight mt-0.5">
        {value}
        {unit && <span className="text-[10px] font-normal text-zinc-500 ml-1">{unit}</span>}
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
  const { theme } = useTheme()
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
  const [mobileView, setMobileView] = useState<MobileView>('veicoli')

  const usageData = useMemo(generateHourlyUsage, [])

  const loadInitial = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ping, vRes, pRes, eRes, drRes] = await Promise.all([
        sfApi<{ mock: boolean }>({ action: 'ping' }),
        sfApi<{ vehicles: SfVehicle[] }>({ action: 'getVehicles' }),
        sfApi<{ positions: SfPosition[] }>({ action: 'getPositions' }),
        sfApi<{ events: SfEvent[] }>({ action: 'getEvents' }),
        supabase
          .from('vehicles')
          .select('id, display_name, plate, metadata, status, safefleet_device_id')
          .neq('status', 'retired')
          .returns<DR7Vehicle[]>(),
      ])
      setMockMode(ping.mock)

      const dr7Vehicles = drRes.data || []
      const sfVehicles = vRes.vehicles || []
      // Merge DR7 vehicles (image, plate, name) with SafeFleet telemetry (position, speed, status).
      // Match by plate (uppercase trim) — fallback: keep SafeFleet-only vehicles too.
      const byPlate = new Map<string, SfVehicle>()
      sfVehicles.forEach(s => byPlate.set(s.plate.toUpperCase().trim(), s))
      const merged: SfVehicle[] = []
      const seenPlates = new Set<string>()
      dr7Vehicles.forEach((dr, i) => {
        const key = (dr.plate || '').toUpperCase().trim()
        const sf = key ? byPlate.get(key) : undefined
        if (sf) seenPlates.add(key)
        merged.push({
          id: sf?.id ?? (1000 + i),
          plate: dr.plate || '—',
          model: dr.display_name,
          image: dr.metadata?.image || null,
          status: sf?.status ?? 'offline',
          speed_kmh: sf?.speed_kmh ?? 0,
          fuel_percent: sf?.fuel_percent ?? 0,
          battery_voltage: sf?.battery_voltage ?? 0,
          engine_temp_c: sf?.engine_temp_c ?? 0,
          oil_temp_c: sf?.oil_temp_c ?? 0,
          odometer_km: sf?.odometer_km ?? 0,
          last_position: sf?.last_position ?? { lat: 40.84, lng: 14.25, address: '—', ts: new Date().toISOString() },
          geofence: sf?.geofence,
          limits: sf?.limits,
        })
      })
      // append SafeFleet vehicles that have no matching DR7 record (so user sees them too)
      sfVehicles.forEach(s => {
        if (!seenPlates.has(s.plate.toUpperCase().trim())) merged.push(s)
      })

      setVehicles(merged)
      setPositions(pRes.positions || [])
      setEvents(eRes.events || [])
      if (!selectedId && merged.length) setSelectedId(merged[0].id)
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
    <div
      className="relative text-zinc-900 dark:text-white -mx-3 -my-3 sm:-mx-6 sm:-my-6 lg:-mx-8 lg:-my-8 px-2 py-2 sm:px-3 sm:py-3 flex flex-col gap-2 overflow-hidden"
      style={{
        height: 'calc(100vh - 110px)',
        background: theme === 'dark'
          ? 'radial-gradient(ellipse 1200px 600px at 20% 0%, rgba(8,47,73,0.45), transparent 60%), radial-gradient(ellipse 900px 500px at 100% 100%, rgba(76,29,149,0.18), transparent 55%), linear-gradient(135deg, #000000 0%, #050507 50%, #0a0a0d 100%)'
          : 'radial-gradient(ellipse 1000px 500px at 0% 0%, rgba(14,116,144,0.04), transparent 60%), radial-gradient(ellipse 900px 500px at 100% 100%, rgba(124,58,237,0.03), transparent 55%), #ffffff',
      }}
    >
      <style>{`
        @keyframes sf-pulse{0%{transform:scale(.6);opacity:.5}100%{transform:scale(2);opacity:0}}
        @keyframes sf-scan{0%,100%{opacity:.15}50%{opacity:.4}}
        @keyframes sf-ambient{0%,100%{opacity:.6}50%{opacity:.9}}
        .sf-scrollbar::-webkit-scrollbar{width:4px;height:4px}
        .sf-scrollbar::-webkit-scrollbar-thumb{background:rgba(34,211,238,0.25);border-radius:9999px}
        .sf-scrollbar::-webkit-scrollbar-thumb:hover{background:rgba(34,211,238,0.4)}
        .sf-scrollbar::-webkit-scrollbar-track{background:transparent}
        .sf-grid-bg{background-image:linear-gradient(rgba(34,211,238,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(34,211,238,0.05) 1px,transparent 1px);background-size:40px 40px}
        .sf-map-vignette{box-shadow:inset 0 0 80px rgba(0,0,0,0.5),inset 0 0 200px rgba(8,47,73,0.4)}
        .sf-map-vignette-light{box-shadow:inset 0 0 60px rgba(15,23,42,0.08)}
      `}</style>
      {/* Ambient atmosphere — dark mode only */}
      <div className="absolute inset-0 pointer-events-none opacity-0 dark:opacity-100">
        <div className="absolute top-0 left-1/4 w-[500px] h-[300px] bg-cyan-500/[0.04] blur-[120px] rounded-full" style={{ animation: 'sf-ambient 8s ease-in-out infinite' }}/>
        <div className="absolute bottom-0 right-1/3 w-[400px] h-[250px] bg-violet-500/[0.03] blur-[100px] rounded-full" style={{ animation: 'sf-ambient 10s ease-in-out infinite 2s' }}/>
      </div>

      {/* Header — compact */}
      <div className="flex items-center justify-between gap-3 px-1 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-500/10 ring-1 ring-cyan-500/30 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-7.5 8-13a8 8 0 1 0-16 0c0 5.5 8 13 8 13z"/>
              <circle cx="12" cy="9" r="3"/>
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-white truncate flex items-center gap-2">
              GPS Fleet Command
              <span className="hidden sm:inline text-[10px] font-mono text-cyan-700 dark:text-cyan-400/80 px-1.5 py-0.5 rounded ring-1 ring-cyan-500/30 bg-cyan-500/10">DR7 MOTION</span>
            </h1>
            <p className="text-[10px] text-zinc-500 truncate">Telemetria real-time · {vehicles.length} veicoli</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {mockMode && (
            <span className="rounded-md ring-1 ring-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-bold tracking-wider text-amber-700 dark:text-amber-300">DEMO</span>
          )}
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono text-emerald-700 dark:text-emerald-300 px-2 py-1 rounded-md ring-1 ring-emerald-500/30 bg-emerald-500/10">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping"/>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400"/>
            </span>
            LIVE
          </div>
          <button
            onClick={loadInitial}
            className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-cyan-700 dark:text-cyan-200 ring-1 ring-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            Aggiorna
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md ring-1 ring-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-700 dark:text-rose-200 shrink-0">Errore: {error}</div>
      )}

      {/* Mobile section switcher — only on small screens */}
      <div className="lg:hidden flex gap-1 rounded-lg ring-1 ring-zinc-200 bg-white dark:ring-cyan-500/15 dark:bg-zinc-950/60 p-1 shrink-0">
        {(['veicoli', 'mappa', 'dettaglio'] as MobileView[]).map(v => (
          <button
            key={v}
            onClick={() => setMobileView(v)}
            className={`flex-1 rounded-md px-3 py-1.5 text-[11px] font-semibold capitalize transition-colors ${
              mobileView === v ? 'bg-cyan-500/15 text-cyan-700 ring-1 ring-cyan-500/40 dark:bg-cyan-500/20 dark:text-cyan-200' : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >{v}</button>
        ))}
      </div>

      {/* KPI strip — 6 cards, compact */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 shrink-0">
        <KpiCard
          index={0} label="Online" color="emerald"
          value={String(kpis.online)} sub={`${kpis.onlinePct}% flotta`}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>}
        />
        <KpiCard
          index={1} label="Offline" color="violet"
          value={String(kpis.offline)} sub={`${kpis.offlinePct}% flotta`}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>}
        />
        <KpiCard
          index={2} label="Allarmi Attivi" color="rose"
          value={String(kpis.alarmCount)} sub={kpis.alarmCount ? 'da gestire' : 'nessuno'}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
        />
        <KpiCard
          index={3} label="Bloccati Attivi" color="amber"
          value={String(kpis.blocked)} sub={kpis.blocked ? `${kpis.blocked} immob.` : 'nessuno'}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
        />
        <KpiCard
          index={4} label="Velocità Media" color="sky"
          value={`${kpis.avgSpeed}`} sub="km/h · in movimento"
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
        />
        <KpiCard
          index={5} label="Carburante Medio" color="cyan"
          value={`${kpis.avgFuel}%`} sub="livello flotta"
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="22" x2="15" y2="22"/><line x1="4" y1="9" x2="14" y2="9"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/></svg>}
        />
      </div>

      {/* Main 3-column body — flex-1 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 flex-1 min-h-0">
        {/* Vehicle list */}
        <Card className={`lg:col-span-3 flex flex-col min-h-0 ${mobileView !== 'veicoli' ? 'hidden lg:flex' : ''}`}>
          <SectionTitle right={<span className="text-[10px] font-mono text-cyan-700 dark:text-cyan-400/80">{filteredVehicles.length}/{vehicles.length}</span>}>
            Veicoli
          </SectionTitle>
          <div className="px-2.5 py-2 border-b border-zinc-200 dark:border-cyan-500/10 shrink-0">
            <div className="relative">
              <svg className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Cerca veicolo..."
                className="w-full rounded-md ring-1 ring-zinc-300 bg-white pl-7 pr-2 py-1 text-[12px] text-zinc-900 placeholder-zinc-500 focus:ring-cyan-400/60 focus:outline-none dark:ring-cyan-500/15 dark:bg-zinc-900/60 dark:text-white"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto sf-scrollbar divide-y divide-zinc-200 dark:divide-zinc-800/40 min-h-0">
            {loading && <div className="p-3 text-xs text-zinc-500">Caricamento...</div>}
            {!loading && filteredVehicles.length === 0 && (
              <div className="p-3 text-xs text-zinc-500">Nessun veicolo trovato</div>
            )}
            {filteredVehicles.map(v => (
              <VehicleListItem key={v.id} v={v} selected={v.id === selectedId} onSelect={() => { setSelectedId(v.id); setMobileView('mappa') }} />
            ))}
          </div>
        </Card>

        {/* Map — main focus */}
        <Card className={`lg:col-span-6 flex flex-col min-h-0 overflow-hidden ${mobileView !== 'mappa' ? 'hidden lg:flex' : ''}`}>
          <SectionTitle
            right={
              <div className="hidden md:flex items-center gap-2 text-[9px] text-zinc-600 dark:text-zinc-400">
                {(['online', 'moving', 'idle', 'alarm', 'offline', 'blocked'] as VehicleStatus[]).map(s => (
                  <span key={s} className="inline-flex items-center gap-1 font-mono">
                    <StatusDot status={s} size={6}/> {STATUS_LABEL[s]}
                  </span>
                ))}
              </div>
            }
          >
            Posizione in tempo reale
          </SectionTitle>
          <div className="relative flex-1 min-h-0 sf-grid-bg overflow-hidden rounded-b-xl">
            <div className="absolute inset-0">
              <MapContainer
                center={[39.2130, 9.1370]}
                zoom={11}
                scrollWheelZoom
                style={{ height: '100%', width: '100%', background: theme === 'dark' ? '#000' : '#f4f4f5' }}
                attributionControl={false}
              >
                <TileLayer
                  url={theme === 'dark'
                    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'}
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
                    pathOptions={{ color: theme === 'dark' ? '#22d3ee' : '#0e7490', weight: 3, opacity: 0.85, dashArray: '4 6' }}
                  />
                )}
              </MapContainer>
            </div>
            {/* Cinematic vignette */}
            <div className={`absolute inset-0 pointer-events-none z-[400] ${theme === 'dark' ? 'sf-map-vignette' : 'sf-map-vignette-light'}`}/>
            {/* Subtle cyan scanline edges — dark mode only */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent opacity-0 dark:opacity-100 pointer-events-none z-[401]"/>
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent opacity-0 dark:opacity-100 pointer-events-none z-[401]"/>
            {/* Corner telemetry overlay */}
            <div className="absolute bottom-2.5 left-2.5 z-[402] flex items-center gap-2 px-2.5 py-1 rounded-md bg-white/90 backdrop-blur ring-1 ring-cyan-500/30 text-[10px] font-mono text-cyan-800 pointer-events-none dark:bg-black/70 dark:ring-cyan-500/30 dark:text-cyan-200 dark:shadow-[0_0_24px_rgba(34,211,238,0.2)]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-60 animate-ping"/>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-400"/>
              </span>
              <span className="tracking-wider">TRACKING</span>
              <span className="text-cyan-500/60 dark:text-cyan-400/60">·</span>
              <span>{vehicles.filter(v => v.status === 'moving').length} mov</span>
              <span className="text-cyan-500/60 dark:text-cyan-400/60">·</span>
              <span>{vehicles.filter(v => v.status === 'idle').length} idle</span>
            </div>
          </div>
        </Card>

        {/* Selected vehicle detail */}
        <Card className={`lg:col-span-3 flex flex-col min-h-0 ${mobileView !== 'dettaglio' ? 'hidden lg:flex' : ''}`}>
          <SectionTitle right={selected && <span className="text-[10px] font-mono text-cyan-700 dark:text-cyan-400/80">{selected.plate}</span>}>
            Veicolo Selezionato
          </SectionTitle>
          {selected ? (
            <div className="flex-1 overflow-y-auto sf-scrollbar p-2.5 space-y-2.5 min-h-0">
              <div className="flex items-center gap-2.5">
                {selected.image ? (
                  <img src={selected.image} alt={selected.model} className="h-11 w-16 rounded-md object-cover ring-1 ring-cyan-500/40 dark:ring-cyan-500/30"/>
                ) : (
                  <div className="grid h-11 w-16 place-items-center rounded-md ring-1 ring-cyan-500/40 bg-zinc-50 dark:ring-cyan-500/30 dark:bg-zinc-900">
                    <span className="text-[10px] font-mono text-cyan-700 dark:text-cyan-200">{selected.plate}</span>
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-bold truncate text-zinc-900 dark:text-white">{selected.model}</div>
                  <div className="text-[10px] text-cyan-700 dark:text-cyan-300/80 font-mono">{selected.plate}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 p-2 rounded-md ring-1 ring-zinc-200 bg-zinc-50 dark:ring-cyan-500/10 dark:bg-zinc-900/40">
                <Stat label="Stato" value={STATUS_LABEL[selected.status]}/>
                <Stat label="Velocità" value={selected.speed_kmh} unit="km/h"/>
                <Stat label="Carburante" value={`${selected.fuel_percent}%`}/>
                <Stat label="Aggiornato" value={fmtTimeAgo(selected.last_position.ts)}/>
              </div>

              <div className="p-2 rounded-md ring-1 ring-zinc-200 bg-zinc-50 dark:ring-cyan-500/10 dark:bg-zinc-900/40">
                <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">Posizione</div>
                <div className="text-[11px] text-zinc-700 dark:text-zinc-200 mt-0.5 leading-snug">{selected.last_position.address}</div>
              </div>

              {/* Comandi Remoti */}
              <div className="rounded-md ring-1 ring-zinc-200 bg-zinc-50 dark:ring-cyan-500/10 dark:bg-zinc-900/40 p-2">
                <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-700 dark:text-cyan-200/90 mb-1.5">Comandi Remoti</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <RemoteCmd label="Blocca Veicolo"   tone="rose"    icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>}/>
                  <RemoteCmd label="Sblocca Veicolo" tone="emerald" icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 11V7a4 4 0 118 0m-4 8v2M6 21h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"/>}/>
                  <RemoteCmd label="Spegni Motore"   tone="rose"    icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636"/>}/>
                  <RemoteCmd label="Riaccendi Motore" tone="emerald" icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>}/>
                  <RemoteCmd label="Attiva Allarme"   tone="amber"  icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>}/>
                  <RemoteCmd label="Disattiva Allarme" tone="sky"   icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17h6m-9-4h12M3 9h18M5 5h14M2 21l20-20"/>}/>
                </div>
              </div>

              {/* Geo-fence */}
              <div className="rounded-md ring-1 ring-zinc-200 bg-zinc-50 dark:ring-cyan-500/10 dark:bg-zinc-900/40 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-700 dark:text-cyan-200/90">Geo-fence</span>
                  <span className={`text-[10px] font-mono ${selected.geofence?.enabled ? 'text-emerald-600 dark:text-emerald-300' : 'text-zinc-500'}`}>
                    {selected.geofence?.enabled ? '● ATTIVA' : '○ DISATTIVA'}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">{selected.geofence?.area_name || '—'}</div>
              </div>

              {/* Limits */}
              <div className="rounded-md ring-1 ring-zinc-200 bg-zinc-50 dark:ring-cyan-500/10 dark:bg-zinc-900/40 divide-y divide-zinc-200 dark:divide-cyan-500/10">
                <div className="px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-700 dark:text-cyan-200/90">Limiti & Allarmi</div>
                <LimitRow label="Limite velocità" value={`${selected.limits?.speed_kmh ?? '—'} km/h`} kind="value"/>
                <LimitRow label="Allarme urto" active={!!selected.limits?.crash_alarm}/>
                <LimitRow label="Uscita area" active={!!selected.limits?.geofence_exit_alarm}/>
                <LimitRow label="Fuori orario" active={!!selected.limits?.after_hours_alarm}/>
              </div>
            </div>
          ) : (
            <div className="p-3 text-xs text-zinc-500">Seleziona un veicolo</div>
          )}
        </Card>
      </div>

      {/* Analytics strip — alarms / usage chart / events */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 shrink-0" style={{ height: 'clamp(140px, 18vh, 200px)' }}>
        <Card className="lg:col-span-4 flex flex-col min-h-0">
          <SectionTitle right={<span className="text-[10px] font-mono text-rose-600 dark:text-rose-300">{activeAlarms.length}</span>}>
            Allarmi Attivi
          </SectionTitle>
          <div className="flex-1 overflow-y-auto sf-scrollbar divide-y divide-zinc-200 dark:divide-cyan-500/5 min-h-0">
            {activeAlarms.length === 0 && <div className="p-3 text-[11px] text-zinc-500">Nessun allarme</div>}
            {activeAlarms.map(a => (
              <div key={a.id} className="flex items-center gap-2 px-2.5 py-1.5">
                <div className={`grid h-6 w-6 place-items-center rounded ${a.severity === 'critical' ? 'bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-zinc-900 dark:text-white truncate font-medium">{a.message}</div>
                  <div className="text-[9px] text-zinc-500 truncate">{a.vehicle_plate} · {fmtTimeAgo(a.ts)}</div>
                </div>
                <button
                  onClick={() => { setSelectedId(a.vehicle_id); setMobileView('dettaglio') }}
                  className="text-[10px] text-cyan-700 hover:text-cyan-900 dark:text-cyan-300 dark:hover:text-cyan-200 shrink-0"
                >→</button>
              </div>
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-4 flex flex-col min-h-0">
          <SectionTitle right={<span className="text-[10px] font-mono text-cyan-700 dark:text-cyan-400/80">24h</span>}>
            Analisi Utilizzo
          </SectionTitle>
          <div className="flex-1 p-1.5 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={usageData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                <XAxis dataKey="hour" stroke={theme === 'dark' ? '#52525b' : '#71717a'} fontSize={8} interval={3} tickLine={false} axisLine={false}/>
                <YAxis stroke={theme === 'dark' ? '#52525b' : '#71717a'} fontSize={8} tickLine={false} axisLine={false}/>
                <Tooltip
                  cursor={{ fill: theme === 'dark' ? 'rgba(34,211,238,0.06)' : 'rgba(14,116,144,0.06)' }}
                  contentStyle={{
                    background: theme === 'dark' ? '#09090b' : '#ffffff',
                    border: `1px solid ${theme === 'dark' ? 'rgba(34,211,238,0.3)' : 'rgba(14,116,144,0.25)'}`,
                    borderRadius: 6,
                    fontSize: 11,
                    color: theme === 'dark' ? '#fff' : '#0c4a6e',
                  }}
                  labelStyle={{ color: theme === 'dark' ? '#67e8f9' : '#0e7490' }}
                />
                <Bar dataKey="km" fill={theme === 'dark' ? '#22d3ee' : '#0e7490'} radius={[2, 2, 0, 0]}/>
                <Bar dataKey="engine" fill={theme === 'dark' ? '#7c3aed' : '#a78bfa'} radius={[2, 2, 0, 0]} opacity={0.6}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-4 flex flex-col min-h-0">
          <SectionTitle right={<span className="text-[10px] font-mono text-cyan-700 dark:text-cyan-400/80">{recentEvents.length}</span>}>
            Eventi Recenti
          </SectionTitle>
          <div className="flex-1 overflow-y-auto sf-scrollbar divide-y divide-zinc-200 dark:divide-cyan-500/5 min-h-0">
            {recentEvents.length === 0 && <div className="p-3 text-[11px] text-zinc-500">Nessun evento</div>}
            {recentEvents.map(e => (
              <div key={e.id} className="flex items-center gap-2 px-2.5 py-1.5">
                <StatusDot status={e.severity === 'critical' ? 'alarm' : e.severity === 'warning' ? 'idle' : 'online'} size={6}/>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-zinc-900 dark:text-white truncate">{e.message}</div>
                  <div className="text-[9px] text-zinc-500 truncate">{e.vehicle_plate} · {fmtTime(e.ts)}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Telemetry footer — 4 micro cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 shrink-0" style={{ height: 'clamp(86px, 11vh, 110px)' }}>
        <Card className="flex flex-col min-h-0">
          <SectionTitle>Stato Veicolo</SectionTitle>
          {selected ? (
            <div className="grid grid-cols-4 gap-1.5 px-2 py-1.5 flex-1">
              <MicroStat label="Carb." value={`${selected.fuel_percent}%`} accent="emerald"/>
              <MicroStat label="Batt." value={`${selected.battery_voltage}V`} accent="amber"/>
              <MicroStat label="Olio" value={`${selected.oil_temp_c}°C`} accent="rose"/>
              <MicroStat label="KM" value={(selected.odometer_km / 1000).toFixed(0) + 'k'} accent="cyan"/>
            </div>
          ) : <div className="p-2 text-[10px] text-zinc-500">—</div>}
        </Card>

        <Card className="flex flex-col min-h-0">
          <SectionTitle
            right={selected && (
              <button onClick={() => setShowRoute(s => !s)} className="text-[9px] font-mono text-cyan-700 hover:text-cyan-900 dark:text-cyan-300 dark:hover:text-cyan-200">
                {showRoute ? '◐ HIDE' : '◑ SHOW'}
              </button>
            )}
          >
            Percorso Odierno
          </SectionTitle>
          {selected ? (
            <div className="grid grid-cols-3 gap-1.5 px-2 py-1.5 flex-1">
              <MicroStat label="Dist." value={`${Math.round((history.reduce((s, h, i, a) => i ? s + dist(a[i - 1], h) : s, 0)) / 1000)} km`} accent="cyan"/>
              <MicroStat label="Durata" value={fmtDuration(history)} accent="sky"/>
              <MicroStat label="Soste" value={String(Math.max(0, Math.round(history.length / 12)))} accent="violet"/>
            </div>
          ) : <div className="p-2 text-[10px] text-zinc-500">—</div>}
        </Card>

        <Card className="flex flex-col min-h-0">
          <SectionTitle right={<span className="text-[9px] font-mono text-cyan-700 dark:text-cyan-400/80">30gg</span>}>
            Comport. di Guida
          </SectionTitle>
          <div className="flex items-center gap-2.5 px-2 py-1.5 flex-1">
            <div className="relative grid place-items-center shrink-0">
              <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(14,116,144,0.15)" strokeWidth="3" className="dark:[stroke:rgba(34,211,238,0.15)]"/>
                <circle cx="20" cy="20" r="16" fill="none" stroke="#0e7490" strokeWidth="3" strokeDasharray={`${(78/100) * (2*Math.PI*16)} ${2*Math.PI*16}`} strokeLinecap="round" className="dark:[stroke:#22d3ee]"/>
              </svg>
              <span className="absolute text-[12px] font-bold text-cyan-700 dark:text-cyan-200 tabular-nums">78</span>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-x-1.5 gap-y-0 text-[9px]">
              <DriverMetric label="Frenate" stars={4}/>
              <DriverMetric label="Accel." stars={3}/>
              <DriverMetric label="Curve" stars={4}/>
              <DriverMetric label="Speed" stars={2}/>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col min-h-0">
          <SectionTitle right={<span className="text-[9px] font-mono text-cyan-700 dark:text-cyan-400/80">30gg</span>}>
            Consumi
          </SectionTitle>
          <div className="grid grid-cols-2 gap-1.5 px-2 py-1.5 flex-1">
            <MicroStat label="Medio" value="9,2" unit="l/100" accent="emerald"/>
            <MicroStat label="Totale" value="210" unit="L" accent="amber"/>
          </div>
        </Card>
      </div>
    </div>
  )
}

function RemoteCmd({ label, tone, icon }: {
  label: string;
  tone: 'rose' | 'emerald' | 'amber' | 'sky' | 'cyan';
  icon: React.ReactNode
}) {
  const map: Record<string, string> = {
    rose:    'ring-rose-500/30 bg-rose-500/5 text-rose-700 hover:bg-rose-500/10 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15',
    emerald: 'ring-emerald-500/30 bg-emerald-500/5 text-emerald-700 hover:bg-emerald-500/10 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/15',
    amber:   'ring-amber-500/30 bg-amber-500/5 text-amber-700 hover:bg-amber-500/10 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/15',
    sky:     'ring-sky-500/30 bg-sky-500/5 text-sky-700 hover:bg-sky-500/10 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/15',
    cyan:    'ring-cyan-500/30 bg-cyan-500/5 text-cyan-700 hover:bg-cyan-500/10 dark:bg-cyan-500/10 dark:text-cyan-300 dark:hover:bg-cyan-500/15',
  }
  return (
    <button className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md ring-1 transition-colors text-left ${map[tone]}`}>
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">{icon}</svg>
      <span className="text-[10px] font-semibold truncate">{label}</span>
    </button>
  )
}

function LimitRow({ label, value, active, kind }: { label: string; value?: string; active?: boolean; kind?: 'value' | 'toggle' }) {
  return (
    <div className="flex items-center justify-between px-2 py-1.5 text-[11px]">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      {kind === 'value' ? (
        <span className="font-mono text-cyan-700 dark:text-cyan-200">{value}</span>
      ) : (
        <span className={`font-mono text-[10px] ${active ? 'text-emerald-600 dark:text-emerald-300' : 'text-zinc-500'}`}>{active ? '● ON' : '○ OFF'}</span>
      )}
    </div>
  )
}

function MicroStat({ label, value, unit, accent = 'cyan' }: { label: string; value: string; unit?: string; accent?: 'cyan' | 'emerald' | 'amber' | 'rose' | 'sky' | 'violet' }) {
  const colorMap: Record<string, string> = {
    cyan:    'text-cyan-700 dark:text-cyan-200',
    emerald: 'text-emerald-700 dark:text-emerald-200',
    amber:   'text-amber-700 dark:text-amber-200',
    rose:    'text-rose-700 dark:text-rose-200',
    sky:     'text-sky-700 dark:text-sky-200',
    violet:  'text-violet-700 dark:text-violet-200',
  }
  return (
    <div className="rounded-md ring-1 ring-zinc-200 bg-zinc-50 dark:ring-cyan-500/10 dark:bg-zinc-900/40 px-1.5 py-1 flex flex-col justify-center min-w-0">
      <div className="text-[8px] uppercase tracking-wider text-zinc-500 font-semibold truncate">{label}</div>
      <div className={`text-[12px] font-bold tabular-nums leading-tight ${colorMap[accent]}`}>
        {value}
        {unit && <span className="text-[9px] font-normal text-zinc-500 ml-0.5">{unit}</span>}
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
    <div className="flex items-center justify-between gap-1">
      <span className="text-zinc-500 truncate">{label}</span>
      <span className="flex gap-px">
        {[1, 2, 3, 4, 5].map(i => (
          <span key={i} className={i <= stars ? 'text-cyan-700 dark:text-cyan-300' : 'text-zinc-300 dark:text-zinc-700'}>•</span>
        ))}
      </span>
    </div>
  )
}
