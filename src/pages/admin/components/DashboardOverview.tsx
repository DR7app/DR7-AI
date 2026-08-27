import { useEffect, useState, useMemo } from 'react'
import { ReportCard, ReportTable, ReportRow, ReportTotalRow, ReportEmpty } from './ReportUI'
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

// GA only accepts fixed preset windows, while the dashboard date pickers allow
// an arbitrary from→to span. Map the selected span to the closest preset so the
// traffic charts still render; the KPI numbers use the exact dates.
const GA_PRESET_DAYS: Array<{ k: GaRange; d: number }> = [
  { k: '7d', d: 7 }, { k: '28d', d: 28 }, { k: '90d', d: 90 }, { k: '180d', d: 180 }, { k: '365d', d: 365 },
]
function spanToGaPreset(from: string, to: string): GaRange {
  const ms = new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()
  const days = Number.isFinite(ms) ? Math.max(1, Math.round(ms / 86400000) + 1) : 28
  let best = GA_PRESET_DAYS[1] // default 28d
  for (const p of GA_PRESET_DAYS) {
    if (Math.abs(p.d - days) < Math.abs(best.d - days)) best = p
  }
  return best.k
}

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
// 2026-08-27: importi al centesimo, come sul Report. Arrotondare all'euro
// faceva sembrare diversi due numeri identici.
const fmtEur = (n: number) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
// fmtPct rimosso 2026-05-23: era dichiarato ma mai usato, blocca tsc strict.

interface KpiCardProps {
  label: string
  value: string
  delta?: number | null
  sub?: string
  tone?: 'gold' | 'green' | 'red'
}

/**
 * 2026-08-27 (richiesta direzione): stessa scheda del Report Terra —
 * etichetta piccola, numero grande, nota. Niente icona colorata ne'
 * sparkline: i grafici sono usciti da tutti i Report.
 */
function KpiCard({ label, value, delta, sub, tone }: KpiCardProps) {
  const trendColor = typeof delta === 'number'
    ? (delta >= 0 ? 'text-green-500' : 'text-red-500')
    : 'text-theme-text-muted'
  const arrow = typeof delta === 'number' ? (delta >= 0 ? '\u25B2' : '\u25BC') : ''
  const valueCls = tone === 'gold' ? 'text-dr7-gold' : tone === 'green' ? 'text-green-500' : tone === 'red' ? 'text-red-500' : 'text-theme-text-primary'
  const borderCls = tone === 'gold' ? 'border-dr7-gold/30' : 'border-theme-border'
  return (
    <div className={`bg-theme-bg-secondary/50 rounded-xl border ${borderCls} p-4`}>
      <p className="text-xs text-theme-text-muted">{label}</p>
      <p className={`text-2xl font-bold ${valueCls}`}>{value}</p>
      {(sub || typeof delta === 'number') && (
        <p className="text-[10px] mt-0.5">
          {typeof delta === 'number' && (
            <span className={`font-semibold ${trendColor}`}>{arrow} {Math.abs(delta).toFixed(1)}%</span>
          )}
          {typeof delta === 'number' && sub && ' \u00B7 '}
          {sub && <span className="text-theme-text-muted">{sub}</span>}
        </p>
      )}
    </div>
  )
}

export default function DashboardOverview({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  // Range is driven by the parent's date pickers — a single date control for
  // the whole dashboard. GA traffic uses the closest preset to the span.
  const gaRange = spanToGaPreset(dateFrom, dateTo)
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
      const now = new Date()
      try {
        const [gaRes, kpiRes] = await Promise.all([
          fetch(`/.netlify/functions/ga-report?range=${gaRange}`).then(r => r.json()).catch(() => null),
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
      } catch (err) {
        console.error('[DashboardOverview] load failed:', err)
      } finally {
        // Always clear the spinner — otherwise a failed query leaves the
        // overview stuck on "Caricamento dashboard…" forever.
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [dateFrom, dateTo, gaRange])

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
    <div className="space-y-6">
      {/* Header — date range is controlled by the dashboard date pickers (single control) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary">Dashboard Overview</h2>
          <p className="text-xs text-theme-text-muted mt-1">Panoramica generale delle performance</p>
        </div>
      </div>

      {/* TOP KPI STRIP */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard
          label="Visitatori"
          value={ga?.configured ? fmtInt(visits) : '—'}
          delta={ga?.kpis?.delta_visits}
        />
        <KpiCard
          label="Conversion Rate"
          value={`${conversionPct.toFixed(2)}%`}
          sub={conversionSource}
          delta={null}
        />
        <KpiCard
          label="Fatturato"
          value={`€ ${fmtEur(kpi?.revenue.currentMonth || 0)}`}
          delta={kpi?.revenue.changePercent}
          tone="gold"
        />
        <KpiCard
          label="Lead Generati"
          value={fmtInt(kpi?.bookings.total || 0)}
          delta={kpi?.bookings.changePercent}
        />
        <KpiCard label="Utenti Wallet" value={fmtInt(walletUsers)} delta={null} />
        <KpiCard label="Member DR7 Club" value={fmtInt(clubMembers)} delta={null} />
      </div>

      {/* SECOND ROW: traffico + canali */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ReportCard title="Traffico nel tempo" right={`${trafficData.length} giorni`} className="lg:col-span-2">
          {trafficData.length > 0 ? (
            <div className="max-h-80 overflow-y-auto">
              <ReportTable
                head={
                  <>
                    <th className="text-left px-4 py-3">Giorno</th>
                    <th className="text-right px-4 py-3">Visite</th>
                  </>
                }
                foot={
                  <ReportTotalRow>
                    <td className="px-4 py-2">Totale</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtInt(trafficData.reduce((s, d) => s + (Number(d.total) || 0), 0))}</td>
                  </ReportTotalRow>
                }
              >
                {trafficData.map(d => (
                  <ReportRow key={String(d.day)}>
                    <td className="px-4 py-2 text-theme-text-primary tabular-nums">{d.day}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{fmtInt(Number(d.total) || 0)}</td>
                  </ReportRow>
                ))}
              </ReportTable>
            </div>
          ) : (
            <ReportEmpty message={ga?.configured ? 'Nessun dato traffico' : 'Configura Google Analytics per vedere il traffico'} />
          )}
        </ReportCard>

        <ReportCard title="Canali di traffico" right={`${fmtInt(totalChannels)} sessioni`}>
          {channelData.length > 0 ? (
            <ReportTable
              head={
                <>
                  <th className="text-left px-4 py-3">Canale</th>
                  <th className="text-right px-4 py-3">Sessioni</th>
                  <th className="text-right px-4 py-3">%</th>
                </>
              }
              foot={
                <ReportTotalRow>
                  <td className="px-4 py-2">Totale</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtInt(totalChannels)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">100%</td>
                </ReportTotalRow>
              }
            >
              {channelData.map(c => (
                <ReportRow key={c.name}>
                  <td className="px-4 py-2 text-theme-text-primary">{c.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{fmtInt(c.value)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-theme-text-muted">
                    {totalChannels > 0 ? `${((c.value / totalChannels) * 100).toFixed(1)}%` : '-'}
                  </td>
                </ReportRow>
              ))}
            </ReportTable>
          ) : (
            <ReportEmpty message={ga?.configured ? 'Nessun dato canali' : 'Setup GA richiesto'} />
          )}
        </ReportCard>
      </div>

      {/* THIRD ROW: funnel + tempo reale + top auto */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ReportCard title="Funnel di Conversione">
          {funnelData.length > 0 ? (
            <ReportTable
              head={
                <>
                  <th className="text-left px-4 py-3">Fase</th>
                  <th className="text-right px-4 py-3">Utenti</th>
                  <th className="text-right px-4 py-3">%</th>
                </>
              }
              foot={
                <ReportTotalRow>
                  <td className="px-4 py-2">Conversione</td>
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2 text-right tabular-nums text-green-500">
                    {funnelData[0]?.value ? `${((funnelData[funnelData.length - 1].value / funnelData[0].value) * 100).toFixed(2)}%` : '—'}
                  </td>
                </ReportTotalRow>
              }
            >
              {funnelData.map(f => (
                <ReportRow key={f.stage}>
                  <td className="px-4 py-2 text-theme-text-primary">{f.stage}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{fmtInt(f.value)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-theme-text-muted">
                    {funnelData[0]?.value ? `${((f.value / funnelData[0].value) * 100).toFixed(1)}%` : '-'}
                  </td>
                </ReportRow>
              ))}
            </ReportTable>
          ) : (
            <ReportEmpty message="Nessun funnel disponibile" />
          )}
        </ReportCard>

        <ReportCard title="Utenti attivi in tempo reale" right="ultimi 30 minuti">
          <ReportTable
            head={
              <>
                <th className="text-left px-4 py-3">Voce</th>
                <th className="text-right px-4 py-3">Valore</th>
              </>
            }
          >
            <ReportRow>
              <td className="px-4 py-2 text-theme-text-primary">Utenti attivi ora</td>
              <td className="px-4 py-2 text-right tabular-nums font-bold text-theme-text-primary">{fmtInt(ga?.realtime?.activeUsers || 0)}</td>
            </ReportRow>
            <ReportRow>
              <td className="px-4 py-2 text-theme-text-primary">Pagine viste (30m)</td>
              <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{fmtInt(ga?.realtime?.pageviews30m || 0)}</td>
            </ReportRow>
            <ReportRow>
              <td className="px-4 py-2 text-theme-text-primary">Eventi (30m)</td>
              <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{fmtInt(ga?.realtime?.events30m || 0)}</td>
            </ReportRow>
            <ReportRow>
              <td className="px-4 py-2 text-theme-text-primary">Conversioni (30m)</td>
              <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{fmtInt(ga?.realtime?.conversions30m || 0)}</td>
            </ReportRow>
          </ReportTable>
        </ReportCard>

        <ReportCard title="Top Auto Più Prenotate">
          {topVehicles.length > 0 ? (
            <ReportTable
              head={
                <>
                  <th className="text-left px-4 py-3">Veicolo</th>
                  <th className="text-left px-4 py-3">Targa</th>
                  <th className="text-right px-4 py-3">Prenotazioni</th>
                </>
              }
            >
              {topVehicles.map(v => (
                <ReportRow key={v.plate + v.name}>
                  <td className="px-4 py-2 text-theme-text-primary">{v.name}</td>
                  <td className="px-4 py-2 text-theme-text-muted">{v.plate || 'targa N/A'}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-dr7-gold">{v.bookings}</td>
                </ReportRow>
              ))}
            </ReportTable>
          ) : (
            <ReportEmpty message="Nessuna prenotazione negli ultimi 30 giorni" />
          )}
        </ReportCard>
      </div>

      {/* GA setup banner if not configured */}
      {ga && !ga.configured && (
        <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-400">
          <strong>Google Analytics non configurato.</strong> Imposta <code>GA4_PROPERTY_ID</code> e
          il service account in Netlify per visualizzare Visitatori, Canali, Conversion Rate.
        </div>
      )}
    </div>
  )
}
