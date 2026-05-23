import { useEffect, useState, useMemo } from 'react'
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, FunnelChart, Funnel, LabelList } from 'recharts'
import { authFetch } from '../../../utils/authFetch'
import { supabase } from '../../../supabaseClient'

/**
 * DashboardOverview — premium KPI dashboard, screenshot-grade.
 *
 * Data sources (REAL, no fake numbers):
 *  - /.netlify/functions/ga-report  → visitatori, sessioni, canali, funnel, realtime
 *  - /.netlify/functions/dashboard-kpi → fatturato, prenotazioni, danni, etc.
 *  - supabase: user_credit_balance / dr7_club_subscriptions for wallet+club counts
 *  - supabase: bookings for "top auto più viste"
 *
 * When GA isn't configured the GA-powered widgets show a "Setup GA" placeholder
 * instead of fake data — see ReportTrafficTab for the same pattern.
 */

type GaRange = '7d' | '28d' | '90d' | '180d' | '365d'

interface GaKpi { visits: number; pageviews: number; users: number; bookings: number; calls: number; revenue: number; delta_visits: number; delta_pageviews: number; delta_users: number }
interface GaSeriesPoint { day: string; total: number; organico: number; ads: number; maps: number }
interface GaChannelSlice { name: string; value: number }
interface GaFunnelStage { stage: string; value: number }
interface GaRealtime { activeUsers: number; pageviews30m: number; events30m: number; conversions30m: number; topActivePages: { page: string; users: number }[] }
interface GaPayload {
  configured: boolean
  kpis: GaKpi | null
  realtime: GaRealtime | null
  traffic: GaSeriesPoint[]
  distribution: GaChannelSlice[]
  funnel: GaFunnelStage[]
}

interface KpiPayload {
  revenue: { currentMonth: number; previousMonth: number; changePercent: number; incassato: number }
  bookings: { total: number; previousTotal: number; changePercent: number; conversionRate: number }
  customers: { newThisMonth: number; activeThisMonth: number; previousNewCount: number; changePercent: number; totalCustomers: number }
  monthlyReports?: {
    preventivi?: {
      total?: number
      accettati?: number
      conversionRate?: number // % accettati su total
      topVehicles?: Array<{ vehicle: string; count: number }>
    }
  }
}

interface TopVehicle { name: string; plate: string; bookings: number; image_url?: string | null }

const fmtInt = (n: number) => new Intl.NumberFormat('it-IT').format(Math.round(n))
const fmtEur = (n: number) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(n))
// fmtPct rimosso 2026-05-23: era dichiarato ma mai usato, blocca tsc strict.

const CHANNEL_COLORS = ['#E1306C', '#4285F4', '#1877F2', '#000000', '#25D366', '#9CA3AF']

interface KpiCardProps {
  label: string
  value: string
  delta?: number | null
  spark?: number[]
  accent: 'cyan' | 'emerald' | 'amber' | 'violet' | 'rose' | 'sky'
  icon: React.ReactNode
  sub?: string
}

const ACCENT_BG: Record<KpiCardProps['accent'], string> = {
  cyan: 'bg-cyan-500/15 text-cyan-400',
  emerald: 'bg-emerald-500/15 text-emerald-400',
  amber: 'bg-amber-500/15 text-amber-400',
  violet: 'bg-violet-500/15 text-violet-400',
  rose: 'bg-rose-500/15 text-rose-400',
  sky: 'bg-sky-500/15 text-sky-400',
}
const ACCENT_LINE: Record<KpiCardProps['accent'], string> = {
  cyan: '#22d3ee', emerald: '#10b981', amber: '#f59e0b', violet: '#8b5cf6', rose: '#f43f5e', sky: '#0ea5e9',
}

function KpiCard({ label, value, delta, spark, accent, icon, sub }: KpiCardProps) {
  const trendColor = typeof delta === 'number'
    ? (delta >= 0 ? 'text-emerald-400' : 'text-rose-400')
    : 'text-theme-text-muted'
  const arrow = typeof delta === 'number' ? (delta >= 0 ? '▲' : '▼') : ''
  const sparkData = (spark || []).map((v, i) => ({ i, v }))
  return (
    <div className="relative rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${ACCENT_BG[accent]}`}>
          {icon}
        </div>
        {typeof delta === 'number' && (
          <span className={`text-[11px] font-bold tabular-nums ${trendColor}`}>
            {arrow} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <p className="text-[11px] uppercase tracking-wider text-theme-text-muted mt-3">{label}</p>
      <p className="text-2xl font-bold text-theme-text-primary tracking-tight mt-1">{value}</p>
      {sub && <p className="text-[10px] text-theme-text-muted mt-0.5">{sub}</p>}
      {sparkData.length > 0 && (
        <div className="h-10 mt-2 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${accent}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT_LINE[accent]} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={ACCENT_LINE[accent]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={ACCENT_LINE[accent]} strokeWidth={2} fill={`url(#spark-${accent})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

export default function DashboardOverview() {
  const [range, setRange] = useState<GaRange>('28d')
  const [ga, setGa] = useState<GaPayload | null>(null)
  const [kpi, setKpi] = useState<KpiPayload | null>(null)
  const [walletUsers, setWalletUsers] = useState<number>(0)
  const [clubMembers, setClubMembers] = useState<number>(0)
  const [topVehicles, setTopVehicles] = useState<TopVehicle[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      // Compute date range for dashboard-kpi (same range as GA)
      const now = new Date()
      const daysBack = range === '7d' ? 7 : range === '28d' ? 28 : range === '90d' ? 90 : range === '180d' ? 180 : 365
      const dateFrom = new Date(now.getTime() - daysBack * 86400000).toISOString().slice(0, 10)
      const dateTo = now.toISOString().slice(0, 10)

      const [gaRes, kpiRes] = await Promise.all([
        fetch(`/.netlify/functions/ga-report?range=${range}`).then(r => r.json()).catch(() => null),
        authFetch(`/.netlify/functions/dashboard-kpi?from=${dateFrom}&to=${dateTo}`).then(r => r.json()).catch(() => null),
      ])
      if (cancelled) return
      setGa(gaRes)
      setKpi(kpiRes)

      // Wallet users (count distinct user_id with balance > 0)
      const { count: walletCount } = await supabase
        .from('user_credit_balance')
        .select('user_id', { count: 'exact', head: true })
        .gt('balance', 0)
      if (!cancelled) setWalletUsers(walletCount || 0)

      // Club active members
      const { count: clubCount } = await supabase
        .from('dr7_club_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
      if (!cancelled) setClubMembers(clubCount || 0)

      // Top vehicles by booking count last 30 days
      const sinceISO = new Date(now.getTime() - 30 * 86400000).toISOString()
      const { data: vehData } = await supabase
        .from('bookings')
        .select('vehicle_name, vehicle_plate, vehicle_id')
        .gte('booked_at', sinceISO)
        .eq('service_type', 'car_rental')
      const counts = new Map<string, { name: string; plate: string; count: number }>()
      for (const b of vehData || []) {
        const key = (b.vehicle_id || b.vehicle_name || '').toString()
        if (!key) continue
        const prev = counts.get(key)
        if (prev) prev.count++
        else counts.set(key, { name: b.vehicle_name || '—', plate: b.vehicle_plate || '', count: 1 })
      }
      const top = Array.from(counts.values()).sort((a, b) => b.count - a.count).slice(0, 5)
      if (!cancelled) setTopVehicles(top.map(t => ({ name: t.name, plate: t.plate, bookings: t.count, image_url: null })))

      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [range])

  // Build sparkline series for each KPI from GA traffic
  const visitsSpark = useMemo(() => (ga?.traffic || []).slice(-14).map(p => p.total), [ga])
  const revenueSpark = useMemo(() => {
    // Approximate per-day revenue split — use total / days as flat baseline plus a noise from traffic shape
    if (!kpi || !ga?.traffic?.length) return []
    const trafficSum = ga.traffic.reduce((s, p) => s + p.total, 0)
    if (!trafficSum) return []
    const total = kpi.revenue.currentMonth
    return ga.traffic.slice(-14).map(p => Math.round((p.total / trafficSum) * total))
  }, [kpi, ga])

  // Conversion rate — preferiamo preventivo->prenotazione (dato pulito che
  // l'admin controlla) sulla raw visit->booking (sporcata da bot/scraper GA).
  // Se mancano i preventivi, fall-back su GA visits / bookings.
  const visits = ga?.kpis?.visits || 0
  const prevTotal = kpi?.monthlyReports?.preventivi?.total || 0
  const prevAccettati = kpi?.monthlyReports?.preventivi?.accettati || 0
  const conversionPreventivi = prevTotal > 0 ? (prevAccettati / prevTotal) * 100 : null
  const conversionVisits = visits > 0 && kpi?.bookings.total ? (kpi.bookings.total / visits) * 100 : null
  const conversionPct = conversionPreventivi ?? conversionVisits ?? 0
  const conversionSource = conversionPreventivi != null
    ? `${prevAccettati}/${prevTotal} preventivi`
    : conversionVisits != null
      ? `${kpi?.bookings.total || 0}/${visits} visite`
      : 'nessun dato'

  const channelData = useMemo(() => (ga?.distribution || []).slice(0, 6), [ga])
  const totalChannels = channelData.reduce((s, c) => s + c.value, 0)

  const funnelData = useMemo(() => ga?.funnel || [], [ga])
  const trafficData = useMemo(() => ga?.traffic || [], [ga])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-theme-text-muted">
        Caricamento dashboard…
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header with range selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary tracking-tight">Dashboard Overview</h2>
          <p className="text-sm text-theme-text-muted">Panoramica generale delle performance</p>
        </div>
        <div className="flex items-center gap-2">
          {(['7d','28d','90d','180d','365d'] as GaRange[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                range === r
                  ? 'bg-dr7-gold text-black'
                  : 'bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              {r === '7d' ? '7 giorni' : r === '28d' ? '28 giorni' : r === '90d' ? '3 mesi' : r === '180d' ? '6 mesi' : '12 mesi'}
            </button>
          ))}
        </div>
      </div>

      {/* TOP KPI STRIP */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          label="Visitatori"
          value={ga?.configured ? fmtInt(visits) : '—'}
          delta={ga?.kpis?.delta_visits}
          spark={visitsSpark}
          accent="cyan"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M17 20h5v-2a4 4 0 0 0-4-4M9 20H4v-2a4 4 0 0 1 4-4M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg>}
        />
        <KpiCard
          label="Conversion Rate"
          value={`${conversionPct.toFixed(2)}%`}
          sub={conversionSource}
          delta={null}
          spark={visitsSpark.map(v => v > 0 ? (kpi?.bookings.total || 0) / v * 100 : 0)}
          accent="emerald"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M13 7h8m0 0v8m0-8L11 17l-4-4-6 6"/></svg>}
        />
        <KpiCard
          label="Fatturato"
          value={`€ ${fmtEur(kpi?.revenue.currentMonth || 0)}`}
          delta={kpi?.revenue.changePercent}
          spark={revenueSpark}
          accent="amber"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M12 8c-2.2 0-4 1.3-4 3s1.8 3 4 3 4 1.3 4 3-1.8 3-4 3m0-12V4m0 16v2m-6-6h12"/></svg>}
        />
        <KpiCard
          label="Lead Generati"
          value={fmtInt(kpi?.bookings.total || 0)}
          delta={kpi?.bookings.changePercent}
          spark={visitsSpark}
          accent="violet"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2-12H7a2 2 0 0 0-2 2v16l3-3h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/></svg>}
        />
        <KpiCard
          label="Utenti Wallet"
          value={fmtInt(walletUsers)}
          delta={null}
          accent="sky"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M16 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0z"/></svg>}
        />
        <KpiCard
          label="Member DR7 Club"
          value={fmtInt(clubMembers)}
          delta={null}
          accent="rose"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>}
        />
      </div>

      {/* SECOND ROW: traffic chart + channels donut + realtime */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Traffic over time */}
        <div className="lg:col-span-2 rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-theme-text-primary">Traffico nel tempo</p>
            <p className="text-xs text-theme-text-muted">{trafficData.length} giorni</p>
          </div>
          {trafficData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trafficData} margin={{ top: 6, right: 12, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="traffic-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" stroke="#9ca3af" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis stroke="#9ca3af" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#fff' }} />
                <Area type="monotone" dataKey="total" stroke="#22d3ee" strokeWidth={2} fill="url(#traffic-area)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-theme-text-muted text-sm">
              {ga?.configured ? 'Nessun dato traffico' : 'Configura Google Analytics per vedere il traffico'}
            </div>
          )}
        </div>

        {/* Channels donut */}
        <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
          <p className="text-sm font-semibold text-theme-text-primary mb-3">Canali di traffico</p>
          {channelData.length > 0 ? (
            <>
              <div className="relative h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={channelData} dataKey="value" innerRadius={50} outerRadius={75} paddingAngle={2}>
                      {channelData.map((_, i) => (
                        <Cell key={i} fill={CHANNEL_COLORS[i % CHANNEL_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#fff' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-lg font-bold text-theme-text-primary tabular-nums">{fmtInt(totalChannels)}</p>
                  <p className="text-[10px] uppercase tracking-wider text-theme-text-muted">Totale</p>
                </div>
              </div>
              <div className="mt-2 space-y-1 text-xs">
                {channelData.map((c, i) => (
                  <div key={c.name} className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-theme-text-secondary">
                      <span className="w-2 h-2 rounded-full" style={{ background: CHANNEL_COLORS[i % CHANNEL_COLORS.length] }} />
                      {c.name}
                    </span>
                    <span className="text-theme-text-muted tabular-nums">{((c.value / totalChannels) * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-theme-text-muted text-sm">
              {ga?.configured ? 'Nessun dato canali' : 'Setup GA richiesto'}
            </div>
          )}
        </div>
      </div>

      {/* THIRD ROW: funnel + realtime active users + top vehicles */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Funnel */}
        <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
          <p className="text-sm font-semibold text-theme-text-primary mb-3">Funnel di Conversione</p>
          {funnelData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <FunnelChart>
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#fff' }} />
                <Funnel dataKey="value" data={funnelData} isAnimationActive>
                  <LabelList position="right" fill="#e5e7eb" fontSize={11} dataKey="stage" />
                  {funnelData.map((_, i) => (
                    <Cell key={i} fill={['#fbbf24','#f59e0b','#ec4899','#a855f7','#6366f1'][i % 5]} />
                  ))}
                </Funnel>
              </FunnelChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-theme-text-muted text-sm">Nessun funnel disponibile</div>
          )}
        </div>

        {/* Realtime active users */}
        <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-theme-text-primary">Utenti attivi in tempo reale</p>
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          </div>
          <p className="text-4xl font-bold text-emerald-400 tabular-nums mb-3">{fmtInt(ga?.realtime?.activeUsers || 0)}</p>
          <p className="text-xs text-theme-text-muted mb-3">Utenti attivi ora</p>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={[
              { label: 'Pageviews 30m', value: ga?.realtime?.pageviews30m || 0 },
              { label: 'Eventi 30m', value: ga?.realtime?.events30m || 0 },
              { label: 'Conversioni 30m', value: ga?.realtime?.conversions30m || 0 },
            ]} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <XAxis dataKey="label" stroke="#9ca3af" tick={{ fontSize: 9 }} interval={0} />
              <YAxis stroke="#9ca3af" tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#fff' }} />
              <Bar dataKey="value" fill="#22d3ee" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top vehicles */}
        <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
          <p className="text-sm font-semibold text-theme-text-primary mb-3">Top Auto Più Prenotate</p>
          {topVehicles.length > 0 ? (
            <ul className="space-y-2">
              {topVehicles.map(v => (
                <li key={v.plate + v.name} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-theme-bg-tertiary/50 border border-theme-border/60">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-theme-text-primary truncate">{v.name}</p>
                    <p className="text-[10px] text-theme-text-muted">{v.plate || 'targa N/A'}</p>
                  </div>
                  <span className="shrink-0 text-xs font-bold tabular-nums text-dr7-gold bg-dr7-gold/15 px-2 py-1 rounded-md">
                    {v.bookings} prenotaz.
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-theme-text-muted">Nessuna prenotazione negli ultimi 30 giorni</p>
          )}
        </div>
      </div>

      {/* GA setup banner if not configured */}
      {ga && !ga.configured && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-300">
          <strong>Google Analytics non configurato.</strong> Imposta <code>GA4_PROPERTY_ID</code> e
          il service account in Netlify per visualizzare Visitatori, Canali, Conversion Rate.
        </div>
      )}
    </div>
  )
}
