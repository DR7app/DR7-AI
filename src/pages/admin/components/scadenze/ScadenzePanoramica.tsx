import { CATEGORIES, DOT_COLORS, STATUS_COLORS, STATUS_LABELS, formatDate, formatAmount, getDaysRemaining, getKmRemaining } from './scadenzeConfig'
import type { Scadenza } from './scadenzeConfig'
import type { ScadenzeStats } from './useScadenze'

interface ScadenzePanoramicaProps {
  stats: ScadenzeStats
  topUrgent: Scadenza[]
  onNavigate: (category: string) => void
}

const PRIORITY_PALETTE = {
  critica: { color: '#EF4444', label: 'Critica', textClass: 'text-red-400' },
  alta:    { color: '#F59E0B', label: 'Alta',    textClass: 'text-amber-400' },
  media:   { color: '#3B82F6', label: 'Media',   textClass: 'text-blue-400' },
  bassa:   { color: '#10B981', label: 'Bassa',   textClass: 'text-emerald-400' },
}

const CATEGORY_COLORS: Record<string, string> = {
  blue: '#3B82F6',
  red: '#EF4444',
  amber: '#F59E0B',
  yellow: '#EAB308',
  emerald: '#10B981',
  cyan: '#06B6D4',
  purple: '#A855F7',
  pink: '#EC4899',
  rose: '#F43F5E',
  orange: '#F97316',
}

export default function ScadenzePanoramica({ stats, topUrgent, onNavigate }: ScadenzePanoramicaProps) {
  return (
    <div className="space-y-6">
      {/* ── KPI Cards Row ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard
          label="Totale scadenze"
          value={stats.totalActive}
          subtitle="tutte attive"
          colorClass="text-theme-text-primary"
          ringHex="#19C2D6"
        />
        <KpiCard
          label="Scadute"
          value={stats.overdue}
          subtitle={formatAmount(stats.overdueAmount)}
          colorClass="text-red-400"
          ringHex="#EF4444"
          urgent={stats.overdue > 0}
        />
        <KpiCard
          label="Urgenti (3 giorni)"
          value={stats.urgent3Days}
          subtitle={formatAmount(stats.urgent3Amount)}
          colorClass="text-amber-400"
          ringHex="#F59E0B"
          urgent={stats.urgent3Days > 0}
        />
        <KpiCard
          label="In scadenza (7 giorni)"
          value={stats.in7Days}
          subtitle={formatAmount(stats.in7Amount)}
          colorClass="text-blue-400"
          ringHex="#3B82F6"
        />
        <KpiCard
          label="Oltre 7 giorni"
          value={stats.over7Days}
          subtitle={formatAmount(stats.over7Amount)}
          colorClass="text-emerald-400"
          ringHex="#10B981"
        />
      </div>

      {/* Importo totale hero */}
      <div className="rounded-2xl border border-dr7-gold/30 bg-gradient-to-br from-dr7-gold/10 via-dr7-gold/5 to-transparent p-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-dr7-gold/80 font-semibold">Importo totale complessivo</div>
          <div className="text-3xl font-bold text-dr7-gold mt-1 tabular-nums">{formatAmount(stats.totalAmount)}</div>
          <div className="text-[11px] text-theme-text-muted mt-0.5">somma di tutte le scadenze attive</div>
        </div>
        <svg className="w-12 h-12 text-dr7-gold/40" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
      </div>

      {/* ── Main grid: top urgent left, riepilogo donut + alerts right ─────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Top Urgenti — 2/3 */}
        <div className="xl:col-span-2 rounded-2xl border border-theme-border bg-theme-bg-secondary overflow-hidden">
          <div className="px-4 py-3 border-b border-theme-border flex items-center justify-between">
            <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider">Scadenze urgenti</h3>
            <span className="text-[10px] text-theme-text-muted">top {topUrgent.length}</span>
          </div>
          {topUrgent.length === 0 ? (
            <div className="py-12 text-center text-theme-text-muted text-sm">Nessuna scadenza urgente</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-theme-border bg-theme-bg-tertiary/40">
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-theme-text-muted uppercase">Categoria</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-theme-text-muted uppercase">Voce</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-theme-text-muted uppercase">Scadenza</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-theme-text-muted uppercase">Importo</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-theme-text-muted uppercase">Stato</th>
                </tr>
              </thead>
              <tbody>
                {topUrgent.map(s => {
                  const cat = CATEGORIES[s.category]
                  const daysInfo = getDaysRemaining(s.due_date)
                  const kmInfo = getKmRemaining(s.due_km, s.current_km)
                  return (
                    <tr key={s.id} onClick={() => onNavigate(s.category)} className="border-b border-theme-border/50 hover:bg-theme-bg-hover cursor-pointer">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${DOT_COLORS[cat?.color || 'blue']}`}/>
                          <span className="text-[11px] text-theme-text-muted truncate">
                            {cat?.label.replace('Scadenze ', '') || s.category}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="text-xs text-theme-text-primary font-medium">{s.item_type}</div>
                        <div className="text-[10px] text-theme-text-muted truncate">{s.description || s.reference_name || '—'}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        {s.due_date ? (
                          <div>
                            <div className="text-xs text-theme-text-primary tabular-nums">{formatDate(s.due_date)}</div>
                            {daysInfo && (
                              <div className={`text-[10px] mt-0.5 font-bold ${daysInfo.urgent ? 'text-red-400' : daysInfo.warning ? 'text-amber-400' : 'text-theme-text-muted'}`}>
                                {daysInfo.days === 0 ? 'OGGI' : daysInfo.days < 0 ? `${Math.abs(daysInfo.days)} GG SCADUTO` : `tra ${daysInfo.days} gg`}
                              </div>
                            )}
                          </div>
                        ) : s.due_km ? (
                          <div>
                            <div className="text-xs text-theme-text-primary font-mono tabular-nums">{s.due_km.toLocaleString()} km</div>
                            {kmInfo && (
                              <div className={`text-[10px] mt-0.5 font-bold ${kmInfo.urgent ? 'text-red-400' : kmInfo.warning ? 'text-amber-400' : 'text-theme-text-muted'}`}>
                                {kmInfo.km <= 0 ? 'SCADUTO' : `${kmInfo.km.toLocaleString()} km`}
                              </div>
                            )}
                          </div>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-theme-text-primary font-bold tabular-nums">
                        {s.amount != null ? formatAmount(s.amount) : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[s.status] || 'bg-theme-bg-tertiary text-theme-text-secondary'}`}>
                          {STATUS_LABELS[s.status] || s.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Right column: Riepilogo donut + Alerts */}
        <div className="space-y-4">
          {/* Riepilogo donut per urgenza */}
          <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider mb-3">Riepilogo</h3>
            <UrgencyDonut stats={stats}/>
          </div>

          {/* Alert dinamici */}
          <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider mb-3">Alert &amp; notifiche</h3>
            <DynamicAlerts stats={stats}/>
          </div>
        </div>
      </div>

      {/* ── Bottom row: Per categoria + Per priorità ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
          <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider mb-3">Importo per categoria</h3>
          <CategoryAmountBars stats={stats} onNavigate={onNavigate}/>
        </div>

        <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
          <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider mb-3">Scadenze per priorità</h3>
          <PriorityDonut stats={stats}/>
        </div>
      </div>

      {/* ── Charts row: Per mese + Trend impatto ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider">Scadenze per mese</h3>
            <span className="text-[10px] text-theme-text-muted">prossimi 12 mesi</span>
          </div>
          <MonthlyBarsChart stats={stats}/>
        </div>

        <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider">Trend impatto (€)</h3>
            <span className="text-[10px] text-theme-text-muted">cumulativo</span>
          </div>
          <CumulativeTrendChart stats={stats}/>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({ label, value, subtitle, colorClass, ringHex, urgent }: {
  label: string
  value: number | string
  subtitle?: string
  colorClass: string
  ringHex: string
  urgent?: boolean
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-theme-bg-secondary p-4" style={{ borderColor: `${ringHex}33` }}>
      <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full blur-2xl pointer-events-none" style={{ background: `${ringHex}22` }}/>
      <div className="relative">
        <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: `${ringHex}cc` }}>{label}</div>
        <div className={`text-2xl lg:text-3xl font-bold mt-2 tabular-nums ${colorClass} ${urgent ? 'animate-pulse' : ''}`}>{value}</div>
        {subtitle && <div className="text-[11px] text-theme-text-muted mt-1 truncate">{subtitle}</div>}
      </div>
    </div>
  )
}

function UrgencyDonut({ stats }: { stats: ScadenzeStats }) {
  const slices = [
    { label: 'Scadute',         value: stats.overdueAmount, color: '#EF4444' },
    { label: 'Critiche (3 gg)', value: stats.urgent3Amount, color: '#F59E0B' },
    { label: 'Attenzione (7 gg)', value: stats.in7Amount,   color: '#3B82F6' },
    { label: 'Oltre 7 gg',      value: stats.over7Amount,   color: '#10B981' },
  ].filter(s => s.value > 0)
  const total = slices.reduce((s, x) => s + x.value, 0)
  if (total === 0) {
    return <div className="text-xs text-theme-text-muted py-3 text-center">Nessun importo da incassare</div>
  }
  const r = 15.91549
  let offset = 0
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-32 h-32 shrink-0">
        <svg className="w-32 h-32 -rotate-90" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-theme-bg-tertiary"/>
          {slices.map((s, i) => {
            const pct = Math.round((s.value / total) * 100)
            const dash = `${pct}, 100`
            const el = <circle key={i} cx="18" cy="18" r={r} fill="none" strokeWidth="4" stroke={s.color} strokeDasharray={dash} strokeDashoffset={-offset}/>
            offset += pct
            return el
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[9px] text-theme-text-muted">Totale</div>
          <div className="text-sm font-bold text-theme-text-primary tabular-nums">{formatAmount(total)}</div>
        </div>
      </div>
      <div className="flex-1 space-y-1.5 min-w-0">
        {slices.map(s => (
          <div key={s.label} className="flex items-center gap-2 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }}/>
            <span className="text-theme-text-secondary flex-1 truncate">{s.label}</span>
            <span className="text-theme-text-primary font-bold tabular-nums">{formatAmount(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PriorityDonut({ stats }: { stats: ScadenzeStats }) {
  const slices = (Object.keys(stats.countByPriority) as Array<keyof typeof stats.countByPriority>)
    .map(k => ({ key: k, ...PRIORITY_PALETTE[k], count: stats.countByPriority[k], amount: stats.amountByPriority[k] }))
    .filter(s => s.count > 0)
  const total = slices.reduce((s, x) => s + x.count, 0)
  if (total === 0) {
    return <div className="text-xs text-theme-text-muted py-3 text-center">Nessuna scadenza attiva</div>
  }
  const r = 15.91549
  let offset = 0
  return (
    <div className="flex items-center gap-4">
      <div className="relative w-32 h-32 shrink-0">
        <svg className="w-32 h-32 -rotate-90" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-theme-bg-tertiary"/>
          {slices.map((s, i) => {
            const pct = Math.round((s.count / total) * 100)
            const dash = `${pct}, 100`
            const el = <circle key={i} cx="18" cy="18" r={r} fill="none" strokeWidth="4" stroke={s.color} strokeDasharray={dash} strokeDashoffset={-offset}/>
            offset += pct
            return el
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[9px] text-theme-text-muted">Totale</div>
          <div className="text-sm font-bold text-theme-text-primary tabular-nums">{total}</div>
        </div>
      </div>
      <div className="flex-1 space-y-1.5 min-w-0">
        {slices.map(s => (
          <div key={s.key} className="flex items-center gap-2 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }}/>
            <span className={`flex-1 truncate font-medium ${s.textClass}`}>{s.label}</span>
            <span className="text-theme-text-primary font-bold tabular-nums">{s.count}</span>
            <span className="text-theme-text-muted tabular-nums w-20 text-right">{formatAmount(s.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CategoryAmountBars({ stats, onNavigate }: { stats: ScadenzeStats; onNavigate: (category: string) => void }) {
  const entries = Object.entries(stats.amountByCategory)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
  if (entries.length === 0) {
    return <div className="text-xs text-theme-text-muted py-3 text-center">Nessuna scadenza con importo</div>
  }
  const max = Math.max(...entries.map(([, v]) => v), 1)
  return (
    <div className="space-y-2">
      {entries.map(([catKey, amount]) => {
        const cat = CATEGORIES[catKey]
        const color = CATEGORY_COLORS[cat?.color || 'blue'] || '#3B82F6'
        const pct = (amount / max) * 100
        return (
          <button key={catKey} onClick={() => onNavigate(catKey)} className="w-full text-left group">
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-theme-text-secondary group-hover:text-theme-text-primary transition-colors">
                {cat?.label?.replace('Scadenze ', '') || catKey}
              </span>
              <span className="text-theme-text-primary font-bold tabular-nums">{formatAmount(amount)}</span>
            </div>
            <div className="h-2 rounded-full bg-theme-bg-tertiary overflow-hidden">
              <div className="h-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: color }}/>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function MonthlyBarsChart({ stats }: { stats: ScadenzeStats }) {
  const data = stats.byMonth
  const maxCount = Math.max(...data.map(m => m.count), 1)
  const totalCount = data.reduce((s, m) => s + m.count, 0)
  if (totalCount === 0) {
    return <div className="text-xs text-theme-text-muted py-12 text-center">Nessuna scadenza nei prossimi 12 mesi</div>
  }
  return (
    <div>
      <div className="flex items-end gap-1.5 h-32 px-1">
        {data.map(m => {
          const h = m.count > 0 ? Math.max(8, Math.round((m.count / maxCount) * 100)) : 0
          return (
            <div key={m.key} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${m.label}: ${m.count} scadenze · ${formatAmount(m.amount)}`}>
              <div className="w-full flex flex-col justify-end h-full">
                {m.count > 0 && (
                  <div
                    className="w-full rounded-t bg-gradient-to-t from-dr7-gold/40 via-dr7-gold/70 to-dr7-gold transition-all duration-300 hover:from-dr7-gold/60"
                    style={{ height: `${h}%` }}
                  />
                )}
              </div>
              <div className="text-[9px] text-theme-text-muted truncate w-full text-center">{m.label}</div>
              <div className="text-[10px] font-bold text-theme-text-primary tabular-nums">{m.count > 0 ? m.count : ''}</div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 pt-3 border-t border-theme-border flex items-center justify-between text-[11px]">
        <span className="text-theme-text-muted">Totale 12 mesi</span>
        <span className="text-theme-text-primary font-bold tabular-nums">{totalCount} scadenze</span>
      </div>
    </div>
  )
}

function CumulativeTrendChart({ stats }: { stats: ScadenzeStats }) {
  const data = stats.trendCumulative
  const max = Math.max(...data.map(d => d.cumulative), 1)
  const finalAmount = data[data.length - 1]?.cumulative || 0
  if (finalAmount === 0) {
    return <div className="text-xs text-theme-text-muted py-12 text-center">Nessun importo cumulato nei prossimi 12 mesi</div>
  }
  const W = 320
  const H = 100
  const stepX = data.length > 1 ? W / (data.length - 1) : 0
  const points = data.map((d, i) => ({
    x: i * stepX,
    y: H - (d.cumulative / max) * H,
    ...d,
  }))
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath = `${path} L${W},${H} L0,${H} Z`
  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full h-32" preserveAspectRatio="none">
          <defs>
            <linearGradient id="trend-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#19C2D6" stopOpacity="0.5"/>
              <stop offset="100%" stopColor="#19C2D6" stopOpacity="0"/>
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#trend-grad)"/>
          <path d={path} stroke="#19C2D6" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          {points.map(p => (
            <circle key={p.key} cx={p.x} cy={p.y} r="2.5" fill="#19C2D6">
              <title>{`${p.label}: ${formatAmount(p.cumulative)}`}</title>
            </circle>
          ))}
        </svg>
        <div className="flex justify-between mt-1 text-[9px] text-theme-text-muted px-0.5">
          {data.map((d, i) => (
            <span key={d.key} className={i % 2 === 0 ? '' : 'opacity-0'}>{d.label}</span>
          ))}
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-theme-border flex items-center justify-between text-[11px]">
        <span className="text-theme-text-muted">Impatto totale a 12 mesi</span>
        <span className="text-dr7-gold font-bold tabular-nums">{formatAmount(finalAmount)}</span>
      </div>
    </div>
  )
}

function DynamicAlerts({ stats }: { stats: ScadenzeStats }) {
  const alerts: Array<{ level: 'crit' | 'warn' | 'info'; text: string }> = []
  if (stats.overdue > 0) {
    alerts.push({ level: 'crit', text: `${stats.overdue} ${stats.overdue === 1 ? 'scadenza scaduta' : 'scadenze scadute'} per ${formatAmount(stats.overdueAmount)}` })
  }
  if (stats.urgent3Days > 0) {
    alerts.push({ level: 'warn', text: `${stats.urgent3Days} ${stats.urgent3Days === 1 ? 'scadenza critica' : 'scadenze critiche'} entro 3 giorni (${formatAmount(stats.urgent3Amount)})` })
  }
  if (stats.in7Days > 0) {
    alerts.push({ level: 'info', text: `${stats.in7Days} in scadenza nei prossimi 7 giorni` })
  }
  if (alerts.length === 0) {
    return <div className="text-xs text-theme-text-muted py-3 text-center">Nessuna scadenza imminente</div>
  }
  const styles = {
    crit: 'border-red-500/30 bg-red-500/5 text-red-400',
    warn: 'border-amber-500/30 bg-amber-500/5 text-amber-400',
    info: 'border-blue-500/30 bg-blue-500/5 text-blue-400',
  }
  return (
    <div className="space-y-1.5">
      {alerts.map((a, i) => (
        <div key={i} className={`rounded-lg border p-2 text-xs ${styles[a.level]}`}>
          {a.text}
        </div>
      ))}
    </div>
  )
}
