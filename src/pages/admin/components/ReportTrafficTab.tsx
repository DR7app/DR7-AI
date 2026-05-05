import { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

// ──────────────────────────────────────────────────────────────────────────────
// Real data only. Backed by /.netlify/functions/ga-report which queries
// Google Analytics 4 Data API. If env vars (GA4_PROPERTY_ID,
// GA4_SERVICE_ACCOUNT_JSON) are missing the function returns
// configured=false and we render the setup banner — never fake numbers.
// ──────────────────────────────────────────────────────────────────────────────

interface KpiBlock {
  visits: number
  pageviews: number
  users: number
  bookings: number
  calls: number
  revenue: number
  delta_visits: number
  delta_pageviews: number
  delta_users: number
}
interface SeriesPoint { day: string; organico: number; ads: number; maps: number }
interface ChannelSlice { name: string; value: number }
interface FunnelStage { stage: string; value: number }
interface TopPage { page: string; sessions: number; pageviews: number }
interface ReportPayload {
  configured: boolean
  missing: string[]
  range: '7d' | '28d' | '90d'
  kpis: KpiBlock | null
  traffic: SeriesPoint[]
  distribution: ChannelSlice[]
  funnel: FunnelStage[]
  topPages: TopPage[]
  fetchedAt: string
  warnings: string[]
}

const RANGES = [
  { key: '7d',  label: '7 giorni' },
  { key: '28d', label: '28 giorni' },
  { key: '90d', label: '90 giorni' },
] as const
type RangeKey = typeof RANGES[number]['key']

const CHANNEL_COLORS: Record<string, string> = {
  'Organic Search':       '#10b981',
  'Direct':               '#06b6d4',
  'Referral':             '#f59e0b',
  'Organic Social':       '#ec4899',
  'Paid Search':          '#a855f7',
  'Paid Social':          '#a855f7',
  'Display':              '#a855f7',
  'Email':                '#3b82f6',
  'Organic Video':        '#ef4444',
  'Unassigned':           '#64748b',
}
const colorFor = (name: string) => CHANNEL_COLORS[name] || '#94a3b8'

const fmtInt = (v: number) => v.toLocaleString('it-IT')
const fmtEur = (v: number) => `€${v.toLocaleString('it-IT', { maximumFractionDigits: 0 })}`
const deltaCls = (d: number) => d > 0 ? 'text-emerald-400' : d < 0 ? 'text-red-400' : 'text-theme-text-muted'
const deltaStr = (d: number) => d === 0 ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1)}%`

function Card({ title, right, children, className = '' }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-theme-bg-secondary/70 border border-theme-border rounded-xl p-4 flex flex-col ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-theme-text-primary uppercase tracking-wider">{title}</h3>
        {right}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  )
}

function KpiTile({ label, value, delta, valueClass = 'text-theme-text-primary', format = 'int' }: {
  label: string; value: number; delta?: number; valueClass?: string; format?: 'int' | 'eur'
}) {
  return (
    <div className="bg-theme-bg-secondary/70 border border-theme-border rounded-xl p-3 flex flex-col gap-1 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-theme-text-muted truncate">{label}</div>
      <div className={`text-xl font-bold ${valueClass} tabular-nums`}>{format === 'eur' ? fmtEur(value) : fmtInt(value)}</div>
      <div className={`text-[11px] font-medium ${delta != null ? deltaCls(delta) : 'text-theme-text-muted'}`}>
        {delta != null ? deltaStr(delta) : '—'}
      </div>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center text-[11px] text-theme-text-muted/70 italic h-full min-h-[80px]">
      {message}
    </div>
  )
}

export default function ReportTrafficTab() {
  const [range, setRange] = useState<RangeKey>('28d')
  const [data, setData] = useState<ReportPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let abort = false
    setLoading(true)
    setErr(null)
    fetch(`/.netlify/functions/ga-report?range=${range}`)
      .then(r => r.json())
      .then((p: ReportPayload) => { if (!abort) setData(p) })
      .catch(e => { if (!abort) setErr(String(e?.message || e)) })
      .finally(() => { if (!abort) setLoading(false) })
    return () => { abort = true }
  }, [range])

  const totalSessions = useMemo(
    () => (data?.distribution || []).reduce((s, c) => s + c.value, 0),
    [data]
  )

  const showBanner = data && !data.configured
  const showWarnings = data && data.warnings.length > 0

  return (
    <div className="space-y-4 p-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary flex items-center gap-2">
            <span className="inline-block w-2 h-6 rounded-full bg-gradient-to-b from-cyan-400 via-fuchsia-500 to-emerald-400" />
            Rendimento Sito
          </h1>
          <p className="text-xs text-theme-text-muted mt-1">
            Dati reali da Google Analytics 4 — dr7empire.com
            {data?.fetchedAt && (
              <span className="ml-2 opacity-60">· aggiornato {new Date(data.fetchedAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-theme-bg-secondary border border-theme-border rounded-full overflow-hidden">
            {RANGES.map(r => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${range === r.key ? 'bg-dr7-gold text-white' : 'text-theme-text-muted hover:bg-theme-bg-hover'}`}
              >{r.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Setup banner — shown only when env vars missing */}
      {showBanner && (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-4">
          <div className="text-sm font-semibold text-amber-300 mb-2">Configurazione Google Analytics richiesta</div>
          <div className="text-xs text-amber-200/80 leading-relaxed">
            Per popolare questo report, imposta in Netlify env del progetto admin le seguenti variabili:
          </div>
          <ul className="mt-2 space-y-1">
            {data!.missing.map(m => (
              <li key={m} className="text-xs font-mono text-amber-100 bg-amber-500/10 px-2 py-1 rounded">{m}</li>
            ))}
          </ul>
          <div className="mt-3 text-[11px] text-amber-200/70 leading-relaxed">
            <strong>GA4_PROPERTY_ID</strong>: numerico, lo trovi in Analytics → Admin → Property settings → Property details.<br/>
            <strong>GA4_SERVICE_ACCOUNT_JSON</strong>: incolla l'intero JSON di un service account che abbia accesso "Viewer" alla property GA4 (Admin → Property Access Management).
          </div>
        </div>
      )}

      {/* Warnings — shown when configured but data is unusual */}
      {showWarnings && !showBanner && (
        <div className="bg-cyan-500/10 border border-cyan-500/40 rounded-xl p-3 space-y-1">
          {data!.warnings.map((w, i) => (
            <div key={i} className="text-[11px] text-cyan-200">• {w}</div>
          ))}
        </div>
      )}

      {/* Fetch error */}
      {err && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-3 text-xs text-red-300">
          Errore caricamento dati: {err}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-xs text-theme-text-muted/70 italic">Caricamento dati Google Analytics…</div>
      )}

      {/* KPI strip — uses ONLY real numbers from GA */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiTile label="Visite" value={data?.kpis?.visits ?? 0} delta={data?.kpis?.delta_visits} valueClass="text-cyan-400" />
        <KpiTile label="Pagine viste" value={data?.kpis?.pageviews ?? 0} delta={data?.kpis?.delta_pageviews} valueClass="text-fuchsia-400" />
        <KpiTile label="Utenti" value={data?.kpis?.users ?? 0} delta={data?.kpis?.delta_users} valueClass="text-emerald-400" />
        <KpiTile label="Click telefono" value={data?.kpis?.calls ?? 0} valueClass="text-orange-400" />
        <KpiTile label="Prenotazioni" value={data?.kpis?.bookings ?? 0} valueClass="text-violet-400" />
        <KpiTile label="Fatturato GA" value={data?.kpis?.revenue ?? 0} valueClass="text-dr7-gold" format="eur" />
      </div>

      {/* Row 2: Traffic over time + Distribution + Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <Card title="Traffico nel tempo" className="lg:col-span-7">
          <div className="h-64">
            {data && data.traffic.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.traffic} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                  <XAxis dataKey="day" stroke="rgba(255,255,255,0.3)" fontSize={10} />
                  <YAxis stroke="rgba(255,255,255,0.3)" fontSize={10} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="organico" name="Organico" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="ads"      name="Paid"     stroke="#a855f7" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="maps"     name="Maps"     stroke="#f59e0b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message={loading ? 'Caricamento…' : 'Nessuna visita nel periodo selezionato'} />
            )}
          </div>
        </Card>

        <Card title="Distribuzione canali" className="lg:col-span-3">
          <div className="h-48 relative">
            {data && data.distribution.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.distribution} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={2}>
                    {data.distribution.map((d, i) => <Cell key={i} fill={colorFor(d.name)} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} formatter={(v) => fmtInt(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message={loading ? '' : 'Nessun canale rilevato'} />
            )}
            {data && data.distribution.length > 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="text-lg font-bold text-theme-text-primary tabular-nums">{fmtInt(totalSessions)}</div>
                <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Sessioni</div>
              </div>
            )}
          </div>
          <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
            {(data?.distribution || []).map(d => {
              const pctVal = totalSessions ? (d.value / totalSessions) * 100 : 0
              return (
                <div key={d.name} className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5 text-theme-text-secondary truncate">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colorFor(d.name) }} />
                    <span className="truncate">{d.name}</span>
                  </span>
                  <span className="tabular-nums text-theme-text-primary flex-shrink-0">{pctVal.toFixed(1)}%</span>
                </div>
              )
            })}
          </div>
        </Card>

        <Card title="Funnel conversione" className="lg:col-span-2">
          {data && data.funnel.length > 0 && data.funnel[0].value > 0 ? (
            <>
              <div className="space-y-2 mt-1">
                {data.funnel.map((f, i) => {
                  const pct = (f.value / data.funnel[0].value) * 100
                  return (
                    <div key={f.stage}>
                      <div className="flex items-baseline justify-between text-[11px] mb-0.5">
                        <span className="text-theme-text-muted truncate pr-1">{f.stage}</span>
                        <span className="tabular-nums text-theme-text-primary font-medium">{fmtInt(f.value)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-theme-bg-tertiary overflow-hidden">
                        <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.max(pct, 1)}%`, opacity: 0.4 + 0.6 * (1 - i / data.funnel.length) }} />
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-3 pt-3 border-t border-theme-border">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">Conversione</span>
                  <span className="text-base font-bold text-emerald-400 tabular-nums">
                    {data.funnel[0].value
                      ? ((data.funnel[data.funnel.length - 1].value / data.funnel[0].value) * 100).toFixed(2)
                      : '0.00'}%
                  </span>
                </div>
              </div>
            </>
          ) : (
            <EmptyState message={loading ? '' : 'Dati insufficienti'} />
          )}
        </Card>
      </div>

      {/* Top pages */}
      <Card title="Pagine più viste">
        {data && data.topPages.length > 0 ? (
          <table className="w-full text-xs">
            <thead className="text-theme-text-muted">
              <tr>
                <th className="text-left font-normal pb-1.5">Pagina</th>
                <th className="text-right font-normal pb-1.5">Sessioni</th>
                <th className="text-right font-normal pb-1.5">Pagine viste</th>
              </tr>
            </thead>
            <tbody>
              {data.topPages.map(p => (
                <tr key={p.page} className="border-t border-theme-border/40">
                  <td className="py-1.5 text-theme-text-primary truncate max-w-[420px]">{p.page}</td>
                  <td className="py-1.5 text-right tabular-nums text-emerald-400">{fmtInt(p.sessions)}</td>
                  <td className="py-1.5 text-right tabular-nums text-theme-text-secondary">{fmtInt(p.pageviews)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState message={loading ? '' : 'Nessuna pagina visitata nel periodo'} />
        )}
      </Card>

      {/* Footer */}
      <div className="text-[10px] text-theme-text-muted/50 text-center pt-2 border-t border-theme-border/40">
        Fonte: Google Analytics Data API · property {data?.configured ? '✓' : 'non configurata'} · DR7 Empire
      </div>
    </div>
  )
}
