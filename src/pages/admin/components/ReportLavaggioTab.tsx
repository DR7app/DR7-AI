import { useState, useEffect, useCallback, useMemo } from 'react'
import toast from 'react-hot-toast'
import { motion } from 'framer-motion'
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip,
  PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts'
import { supabase } from '../../../supabaseClient'
import { useAdminRole } from '../../../hooks/useAdminRole'
import { useTheme } from '../../../contexts/ThemeContext'

interface WashTypeBreakdown {
  type: string
  count: number
  revenue: number
}

interface InternalWashBreakdown {
  vehicle: string
  count: number
}

interface WashReportData {
  month: string
  daysInMonth: number
  billableWashesCount: number
  washRevenue: number
  avgWashesPerDay: number
  byType: WashTypeBreakdown[]
  internalWashesCount?: number
  internalByVehicle?: InternalWashBreakdown[]
}

interface MonthlyTrendPoint {
  month: string
  revenue: number
  count: number
  label: string
}

const MONTH_LABELS_IT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']

function formatCurrency(amount: number, frac = 2): string {
  return `€${amount.toLocaleString('it-IT', { minimumFractionDigits: frac, maximumFractionDigits: frac })}`
}

function formatCurrencyShort(amount: number): string {
  if (Math.abs(amount) >= 1000) return `€${(amount / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })}k`
  return `€${amount.toLocaleString('it-IT', { maximumFractionDigits: 0 })}`
}

function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  return `${MONTH_LABELS_IT[(m - 1) % 12]} ${String(y).slice(2)}`
}

const PIE_COLORS = ['#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#fb7185', '#facc15']

export default function ReportLavaggioTab() {
  const { theme } = useTheme()
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [washData, setWashData] = useState<WashReportData | null>(null)
  const [trend, setTrend] = useState<MonthlyTrendPoint[]>([])
  const [trendLoading, setTrendLoading] = useState(false)

  const { hasRole } = useAdminRole()
  const canEditStipendio = hasRole('stipendio-editor')
  const [spesaMerce, setSpesaMerce] = useState<number>(0)
  const [costsLoading, setCostsLoading] = useState(false)
  const [stipendio, setStipendio] = useState<number>(0)
  const [stipendioInput, setStipendioInput] = useState<string>('')
  const [stipendioEditing, setStipendioEditing] = useState(false)
  const [stipendioSaving, setStipendioSaving] = useState(false)

  const loadCosts = useCallback(async () => {
    setCostsLoading(true)
    try {
      const [year, month] = selectedMonth.split('-').map(Number)
      const monthStart = `${selectedMonth}-01`
      const lastDay = new Date(year, month, 0).getDate()
      const monthEnd = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`

      const { data: fornitori } = await supabase
        .from('fornitori')
        .select('id')
        .eq('categoria_merce', 'lavaggio_prodotti')
      const ids = (fornitori || []).map(f => f.id)
      let spesa = 0
      if (ids.length > 0) {
        const { data: fatture } = await supabase
          .from('fornitore_documents')
          .select('importo_totale')
          .in('fornitore_id', ids)
          .eq('tipo', 'fattura')
          .gte('data_documento', monthStart)
          .lte('data_documento', monthEnd)
        spesa = (fatture || []).reduce((s, d: { importo_totale: number | string | null }) => s + (Number(d.importo_totale) || 0), 0)
      }
      setSpesaMerce(spesa)

      const { data: cfgRow } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      const cfg = (cfgRow?.config || {}) as Record<string, unknown>
      const lav = (cfg.lavaggio || {}) as Record<string, unknown>
      const stip = (lav.stipendi_mensili || {}) as Record<string, number>
      const value = Number(stip[selectedMonth] ?? 0) || 0
      setStipendio(value)
      setStipendioInput(value.toFixed(2))
    } catch (err) {
      console.error('[ReportLavaggio] loadCosts error:', err)
    } finally {
      setCostsLoading(false)
    }
  }, [selectedMonth])

  useEffect(() => { loadCosts() }, [loadCosts])

  useEffect(() => {
    fetchReport()
    fetchTrend()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth])

  async function saveStipendio() {
    const parsed = parseFloat(stipendioInput.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error('Importo non valido')
      return
    }
    setStipendioSaving(true)
    try {
      const { data: cfgRow } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      const cfg = (cfgRow?.config || {}) as Record<string, unknown>
      const lav = { ...((cfg.lavaggio as Record<string, unknown>) || {}) }
      const stipendi = { ...((lav.stipendi_mensili as Record<string, number>) || {}) }
      stipendi[selectedMonth] = parsed
      lav.stipendi_mensili = stipendi
      const nextCfg = { ...cfg, lavaggio: lav }
      const { error } = await supabase
        .from('centralina_pro_config')
        .upsert({ id: 'main', config: nextCfg }, { onConflict: 'id' })
      if (error) throw error
      setStipendio(parsed)
      setStipendioEditing(false)
      toast.success('Stipendio salvato')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Errore salvataggio: ' + msg)
    } finally {
      setStipendioSaving(false)
    }
  }

  async function fetchReport() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/.netlify/functions/monthly-report?type=washes&month=${selectedMonth}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore nel caricamento')
      setWashData(data)
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      setError(_errMsg || 'Errore sconosciuto')
    } finally {
      setLoading(false)
    }
  }

  async function fetchTrend() {
    setTrendLoading(true)
    try {
      const [year, month] = selectedMonth.split('-').map(Number)
      const months: string[] = []
      for (let i = 5; i >= 0; i--) {
        const d = new Date(year, month - 1 - i, 1)
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
      }
      const results = await Promise.all(
        months.map(m =>
          fetch(`/.netlify/functions/monthly-report?type=washes&month=${m}`)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        )
      )
      const points: MonthlyTrendPoint[] = months.map((m, i) => {
        const d = results[i] as WashReportData | null
        return {
          month: m,
          revenue: d?.washRevenue || 0,
          count: d?.billableWashesCount || 0,
          label: monthLabel(m),
        }
      })
      setTrend(points)
    } catch (e) {
      console.warn('[ReportLavaggio] fetchTrend failed:', e)
    } finally {
      setTrendLoading(false)
    }
  }

  const lavaggiFatt = washData?.billableWashesCount || 0
  const lavaggiInterni = washData?.internalWashesCount || 0
  const lavaggiTot = lavaggiFatt + lavaggiInterni
  const ricavo = washData?.washRevenue || 0
  const margineReale = ricavo - spesaMerce - stipendio
  const marginPct = ricavo > 0 ? Math.round((margineReale / ricavo) * 100) : 0
  const avgRevenuePerWash = lavaggiFatt > 0 ? ricavo / lavaggiFatt : 0

  const pieData = useMemo(() => {
    if (!washData?.byType?.length) return []
    return washData.byType.map(t => ({ name: t.type, value: t.revenue, count: t.count }))
  }, [washData])

  const barData = useMemo(() => {
    if (!washData?.byType?.length) return []
    return washData.byType.map(t => ({
      type: t.type.length > 14 ? t.type.slice(0, 12) + '…' : t.type,
      fullType: t.type,
      count: t.count,
      revenue: t.revenue,
    }))
  }, [washData])

  // Theme tokens
  const isDark = theme === 'dark'
  const rootBg = isDark
    ? 'radial-gradient(ellipse 1200px 600px at 20% 0%, rgba(8,47,73,0.45), transparent 60%), radial-gradient(ellipse 900px 500px at 100% 100%, rgba(76,29,149,0.18), transparent 55%), linear-gradient(135deg, #000000 0%, #050507 50%, #0a0a0d 100%)'
    : 'radial-gradient(ellipse 1000px 500px at 0% 0%, rgba(14,116,144,0.04), transparent 60%), radial-gradient(ellipse 900px 500px at 100% 100%, rgba(124,58,237,0.03), transparent 55%), #ffffff'
  const axis = isDark ? '#52525b' : '#a1a1aa'
  const grid = isDark ? 'rgba(34,211,238,0.08)' : 'rgba(15,23,42,0.06)'

  return (
    <div
      className="relative text-zinc-900 dark:text-white -mx-3 -my-3 sm:-mx-6 sm:-my-6 lg:-mx-8 lg:-my-8 px-2 py-2 sm:px-3 sm:py-3 flex flex-col gap-2 overflow-hidden"
      style={{ height: 'calc(100vh - 110px)', background: rootBg }}
    >
      <style>{`
        @keyframes lv-ambient{0%,100%{opacity:.6}50%{opacity:.9}}
        @keyframes lv-pulse{0%,100%{transform:scale(1);opacity:.5}50%{transform:scale(1.15);opacity:1}}
        .lv-scrollbar::-webkit-scrollbar{width:4px;height:4px}
        .lv-scrollbar::-webkit-scrollbar-thumb{background:rgba(34,211,238,0.25);border-radius:9999px}
        .lv-scrollbar::-webkit-scrollbar-thumb:hover{background:rgba(34,211,238,0.45)}
        .lv-scrollbar::-webkit-scrollbar-track{background:transparent}
      `}</style>
      {/* Ambient atmosphere */}
      <div className="absolute inset-0 pointer-events-none opacity-0 dark:opacity-100">
        <div className="absolute top-0 left-1/4 w-[500px] h-[300px] bg-cyan-500/[0.05] blur-[120px] rounded-full" style={{ animation: 'lv-ambient 8s ease-in-out infinite' }}/>
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[250px] bg-violet-500/[0.04] blur-[100px] rounded-full" style={{ animation: 'lv-ambient 10s ease-in-out infinite 2s' }}/>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-1 shrink-0 relative">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-500/10 ring-1 ring-cyan-500/30 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v6m0 0l-3-3m3 3l3-3M5 12a7 7 0 1014 0c0-3-2-5-7-10-5 5-7 7-7 10z"/>
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-tight truncate flex items-center gap-2">
              Lavaggio · Report Operativo
              <span className="hidden sm:inline text-[10px] font-mono text-cyan-700 dark:text-cyan-400/80 px-1.5 py-0.5 rounded ring-1 ring-cyan-500/30 bg-cyan-500/10">DR7 MOTION</span>
            </h1>
            <p className="text-[10px] text-zinc-500 truncate">
              Intelligence operativa · {washData?.daysInMonth || '—'} giorni · {monthLabel(selectedMonth)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold bg-white text-zinc-900 ring-1 ring-zinc-300 dark:bg-zinc-900/60 dark:text-cyan-100 dark:ring-cyan-500/30 focus:outline-none focus:ring-cyan-500/60"
          />
          <button
            onClick={() => { fetchReport(); fetchTrend(); loadCosts() }}
            disabled={loading}
            className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-cyan-700 dark:text-cyan-200 ring-1 ring-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            {loading ? '…' : 'Aggiorna'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md ring-1 ring-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-700 dark:text-rose-200 shrink-0">Errore: {error}</div>
      )}

      {/* KPI strip — 6 cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 shrink-0">
        <Kpi index={0} label="Lavaggi Tot" color="cyan"
          value={String(lavaggiTot)} sub={`${lavaggiFatt} fatt · ${lavaggiInterni} interni`}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 7h18M3 12h18M3 17h18"/></svg>}
        />
        <Kpi index={1} label="Lavaggi Fatt" color="sky"
          value={String(lavaggiFatt)} sub={`media ${washData?.avgWashesPerDay ?? 0}/giorno`}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>}
        />
        <Kpi index={2} label="Ricavo" color="emerald"
          value={formatCurrencyShort(ricavo)} sub={`media ${formatCurrencyShort(avgRevenuePerWash)} / lavaggio`}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>}
        />
        <Kpi index={3} label="Spesa Merce" color="rose"
          value={formatCurrencyShort(spesaMerce)} sub={costsLoading ? 'caricamento…' : 'prodotti / consumabili'}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>}
        />
        <Kpi index={4} label="Stipendio Lav." color="amber"
          value={formatCurrencyShort(stipendio)} sub="payroll mensile"
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 7H4a2 2 0 00-2 2v8a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><circle cx="12" cy="13" r="2"/></svg>}
        />
        <Kpi index={5} label="Margine Reale" color={margineReale >= 0 ? 'emerald' : 'rose'}
          value={formatCurrencyShort(margineReale)} sub={`${marginPct}% del ricavo`}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>}
        />
      </div>

      {/* Main body — 12-col grid, flex-1 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 flex-1 min-h-0">
        {/* Donut — Ripartizione Ricavo */}
        <Card className="lg:col-span-4 flex flex-col min-h-0">
          <SectionTitle right={<span className="text-[10px] font-mono text-cyan-700 dark:text-cyan-400/80">{pieData.length} tipi</span>}>
            Ripartizione Ricavo per Tipo
          </SectionTitle>
          {pieData.length === 0 ? (
            <div className="flex-1 grid place-items-center text-xs text-zinc-500">
              {loading ? 'Caricamento…' : 'Nessun dato'}
            </div>
          ) : (
            <div className="flex-1 grid grid-cols-2 gap-2 p-2 min-h-0">
              <div className="relative min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      cx="50%" cy="50%"
                      innerRadius="58%"
                      outerRadius="92%"
                      paddingAngle={2}
                      strokeWidth={0}
                      isAnimationActive
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]}/>
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: isDark ? '#09090b' : '#ffffff',
                        border: `1px solid ${isDark ? 'rgba(34,211,238,0.3)' : 'rgba(14,116,144,0.25)'}`,
                        borderRadius: 6,
                        fontSize: 11,
                        color: isDark ? '#fff' : '#0c4a6e',
                      }}
                      formatter={((v: unknown) => formatCurrency(Number(v))) as never}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 grid place-items-center pointer-events-none">
                  <div className="text-center">
                    <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Ricavo</div>
                    <div className="text-sm font-bold text-cyan-700 dark:text-cyan-200 tabular-nums">{formatCurrencyShort(ricavo)}</div>
                  </div>
                </div>
              </div>
              <div className="overflow-y-auto lv-scrollbar min-h-0 space-y-1.5">
                {pieData.map((p, i) => {
                  const pct = ricavo > 0 ? Math.round((p.value / ricavo) * 100) : 0
                  return (
                    <div key={p.name} className="flex items-center gap-1.5 text-[10px]">
                      <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}/>
                      <span className="flex-1 truncate text-zinc-600 dark:text-zinc-300">{p.name}</span>
                      <span className="font-mono text-zinc-500">{p.count}</span>
                      <span className="font-bold tabular-nums text-cyan-700 dark:text-cyan-200 w-9 text-right">{pct}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </Card>

        {/* Trend area chart — Ricavo ultimi 6 mesi */}
        <Card className="lg:col-span-5 flex flex-col min-h-0">
          <SectionTitle right={
            <div className="flex items-center gap-2 text-[10px]">
              <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400"><span className="w-2 h-2 rounded-sm bg-cyan-400"/>Ricavo</span>
              <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400"><span className="w-2 h-2 rounded-sm bg-violet-400"/>Volume</span>
              {trendLoading && <span className="text-cyan-700 dark:text-cyan-400/80 font-mono">…</span>}
            </div>
          }>
            Trend Operativo · 6 Mesi
          </SectionTitle>
          {trend.length === 0 ? (
            <div className="flex-1 grid place-items-center text-xs text-zinc-500">Caricamento…</div>
          ) : (
            <div className="flex-1 p-2 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="lvRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.45}/>
                      <stop offset="100%" stopColor="#22d3ee" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="lvCount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.35}/>
                      <stop offset="100%" stopColor="#a78bfa" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" stroke={axis} fontSize={10} tickLine={false} axisLine={false}/>
                  <YAxis stroke={axis} fontSize={10} tickLine={false} axisLine={false} width={40}
                    tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : `${v}`}/>
                  <Tooltip
                    cursor={{ stroke: grid }}
                    contentStyle={{
                      background: isDark ? '#09090b' : '#ffffff',
                      border: `1px solid ${isDark ? 'rgba(34,211,238,0.3)' : 'rgba(14,116,144,0.25)'}`,
                      borderRadius: 6,
                      fontSize: 11,
                      color: isDark ? '#fff' : '#0c4a6e',
                    }}
                    formatter={((value: unknown, name: unknown) =>
                      name === 'revenue' ? [formatCurrency(Number(value)), 'Ricavo'] : [String(value), 'Lavaggi']
                    ) as never}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#22d3ee" strokeWidth={2} fill="url(#lvRevenue)"/>
                  <Area type="monotone" dataKey="count" stroke="#a78bfa" strokeWidth={1.5} fill="url(#lvCount)" yAxisId={undefined}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          {/* Trend footer with current vs prev */}
          {trend.length >= 2 && (() => {
            const curr = trend[trend.length - 1]?.revenue || 0
            const prev = trend[trend.length - 2]?.revenue || 0
            const delta = prev > 0 ? ((curr - prev) / prev) * 100 : 0
            const positive = delta >= 0
            return (
              <div className="px-3 py-1.5 border-t border-zinc-200 dark:border-cyan-500/10 flex items-center justify-between text-[10px] shrink-0">
                <span className="text-zinc-500">vs mese prec.</span>
                <span className={`font-mono font-bold tabular-nums ${positive ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
                  {positive ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% · {formatCurrencyShort(curr - prev)}
                </span>
              </div>
            )
          })()}
        </Card>

        {/* Costi & Margine */}
        <Card className="lg:col-span-3 flex flex-col min-h-0">
          <SectionTitle>Costi & Margine</SectionTitle>
          <div className="flex-1 overflow-y-auto lv-scrollbar p-2.5 space-y-2 min-h-0">
            {/* Margine box */}
            <div className={`rounded-md p-2.5 ring-1 ${margineReale >= 0
              ? 'ring-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent'
              : 'ring-rose-500/30 bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent'}`}>
              <div className="text-[9px] uppercase tracking-wider font-bold text-zinc-600 dark:text-zinc-300">Margine Reale</div>
              <div className={`text-xl font-bold tabular-nums mt-0.5 ${margineReale >= 0 ? 'text-emerald-700 dark:text-emerald-200' : 'text-rose-700 dark:text-rose-200'}`}>
                {formatCurrency(margineReale)}
              </div>
              <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">{marginPct}% del ricavo · {monthLabel(selectedMonth)}</div>
            </div>

            {/* Waterfall */}
            <div className="space-y-1.5">
              <CostRow label="Ricavo" value={ricavo} tone="positive" sign="+"/>
              <CostRow label="Spesa Merce" value={-spesaMerce} tone="negative" sign="−"/>
              <CostRow label="Stipendio" value={-stipendio} tone="negative" sign="−"/>
              <div className="border-t border-dashed border-zinc-300 dark:border-cyan-500/15"/>
              <CostRow label="Margine" value={margineReale} tone={margineReale >= 0 ? 'positive' : 'negative'} sign={margineReale >= 0 ? '=' : '='} bold/>
            </div>

            {/* Stipendio editor */}
            <div className="rounded-md ring-1 ring-zinc-200 dark:ring-cyan-500/10 bg-zinc-50 dark:bg-zinc-900/40 p-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-700 dark:text-cyan-200/90">Stipendio Lavaggista</span>
                {canEditStipendio && !stipendioEditing && (
                  <button onClick={() => setStipendioEditing(true)} className="text-[9px] font-mono text-cyan-700 dark:text-cyan-300 hover:underline">EDIT</button>
                )}
              </div>
              {stipendioEditing && canEditStipendio ? (
                <div className="flex items-center gap-1 mt-1.5">
                  <input
                    type="number" step="0.01" min="0"
                    value={stipendioInput}
                    onChange={e => setStipendioInput(e.target.value)}
                    className="flex-1 px-2 py-1 rounded text-[12px] font-bold tabular-nums bg-white text-zinc-900 ring-1 ring-zinc-300 dark:bg-zinc-900 dark:text-cyan-100 dark:ring-cyan-500/30 focus:outline-none focus:ring-cyan-500/60"
                    autoFocus
                  />
                  <button onClick={saveStipendio} disabled={stipendioSaving}
                    className="px-2 py-1 rounded text-[10px] font-bold text-white bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50">
                    {stipendioSaving ? '…' : 'OK'}
                  </button>
                  <button onClick={() => { setStipendioEditing(false); setStipendioInput(stipendio.toFixed(2)) }}
                    className="px-2 py-1 rounded text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800">✕</button>
                </div>
              ) : (
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  {canEditStipendio ? 'Modificabile · ' : 'Solo Valerio / Ilenia · '}
                  <span className="font-mono">{monthLabel(selectedMonth)}</span>
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Bottom strip — Bar chart per tipo + Lavaggi interni */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 shrink-0" style={{ height: 'clamp(170px, 22vh, 240px)' }}>
        {/* Bar chart + executive table */}
        <Card className="lg:col-span-8 flex flex-col min-h-0">
          <SectionTitle right={<span className="text-[10px] font-mono text-cyan-700 dark:text-cyan-400/80">{barData.length} servizi</span>}>
            Dettaglio per Tipo di Servizio
          </SectionTitle>
          {barData.length === 0 ? (
            <div className="flex-1 grid place-items-center text-xs text-zinc-500">Nessun dato disponibile</div>
          ) : (
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2 p-2 min-h-0">
              {/* Bar chart */}
              <div className="min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                    <XAxis dataKey="type" stroke={axis} fontSize={9} tickLine={false} axisLine={false} interval={0} angle={-12} textAnchor="end" height={36}/>
                    <YAxis stroke={axis} fontSize={9} tickLine={false} axisLine={false} width={36}/>
                    <Tooltip
                      cursor={{ fill: isDark ? 'rgba(34,211,238,0.06)' : 'rgba(14,116,144,0.06)' }}
                      contentStyle={{
                        background: isDark ? '#09090b' : '#ffffff',
                        border: `1px solid ${isDark ? 'rgba(34,211,238,0.3)' : 'rgba(14,116,144,0.25)'}`,
                        borderRadius: 6,
                        fontSize: 11,
                      }}
                      formatter={((value: unknown, name: unknown) => {
                        if (name === 'revenue') return [formatCurrency(Number(value)), 'Ricavo']
                        return [String(value), 'Lavaggi']
                      }) as never}
                      labelFormatter={((_: unknown, payload: ReadonlyArray<{ payload?: { fullType?: string } }>) => {
                        const p = payload?.[0]?.payload
                        return p?.fullType || ''
                      }) as never}
                    />
                    <Bar dataKey="count" fill={isDark ? '#a78bfa' : '#8b5cf6'} radius={[3, 3, 0, 0]}/>
                    <Bar dataKey="revenue" fill={isDark ? '#22d3ee' : '#0e7490'} radius={[3, 3, 0, 0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Executive table */}
              <div className="overflow-y-auto lv-scrollbar min-h-0">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">
                      <th className="text-left py-1.5 px-2">Servizio</th>
                      <th className="text-right py-1.5 px-2">Qta</th>
                      <th className="text-right py-1.5 px-2">Ricavo</th>
                      <th className="text-right py-1.5 px-2">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-cyan-500/5">
                    {washData?.byType.map((item, i) => {
                      const pct = ricavo > 0 ? Math.round((item.revenue / ricavo) * 100) : 0
                      return (
                        <tr key={item.type} className="hover:bg-zinc-100/60 dark:hover:bg-cyan-500/5 transition-colors">
                          <td className="py-1.5 px-2 truncate max-w-[120px]">
                            <span className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}/>
                              <span className="truncate">{item.type}</span>
                            </span>
                          </td>
                          <td className="text-right tabular-nums font-mono py-1.5 px-2">{item.count}</td>
                          <td className="text-right tabular-nums font-bold text-cyan-700 dark:text-cyan-200 py-1.5 px-2">{formatCurrencyShort(item.revenue)}</td>
                          <td className="text-right tabular-nums text-zinc-500 py-1.5 px-2 font-mono">{pct}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-zinc-300 dark:border-cyan-500/20 text-[11px] font-bold">
                      <td className="py-1.5 px-2">Totale</td>
                      <td className="text-right tabular-nums py-1.5 px-2">{lavaggiFatt}</td>
                      <td className="text-right tabular-nums text-cyan-700 dark:text-cyan-200 py-1.5 px-2">{formatCurrencyShort(ricavo)}</td>
                      <td className="text-right tabular-nums text-zinc-500 py-1.5 px-2 font-mono">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </Card>

        {/* Lavaggi interni */}
        <Card className="lg:col-span-4 flex flex-col min-h-0">
          <SectionTitle right={
            <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded ring-1 ring-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300">{lavaggiInterni}</span>
          }>
            Lavaggi Rientro · Interni
          </SectionTitle>
          {lavaggiInterni === 0 ? (
            <div className="flex-1 grid place-items-center text-xs text-zinc-500">Nessun lavaggio interno</div>
          ) : (
            <div className="flex-1 overflow-y-auto lv-scrollbar min-h-0 p-2 space-y-1">
              {(washData?.internalByVehicle || []).map((item, i) => {
                const max = Math.max(...(washData?.internalByVehicle || []).map(x => x.count), 1)
                const pct = (item.count / max) * 100
                return (
                  <motion.div
                    key={item.vehicle}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.02 }}
                    className="relative px-2 py-1.5 rounded-md ring-1 ring-zinc-200 dark:ring-cyan-500/10 bg-white dark:bg-zinc-900/40 overflow-hidden"
                  >
                    <div className="absolute inset-y-0 left-0 bg-orange-500/10 rounded-md" style={{ width: `${pct}%` }}/>
                    <div className="relative flex items-center justify-between text-[11px]">
                      <span className="truncate text-zinc-700 dark:text-zinc-200 font-medium">{item.vehicle}</span>
                      <span className="font-bold tabular-nums text-orange-700 dark:text-orange-300 font-mono">{item.count}</span>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

// ── Small components ─────────────────────────────────────────────────

const KPI_COLORS = {
  cyan:    { ring: 'ring-cyan-500/30 dark:ring-cyan-500/20',       text: 'text-cyan-700 dark:text-cyan-300',       val: 'text-cyan-700 dark:text-cyan-200',       glow: 'bg-cyan-500/10',    ic: 'bg-cyan-500/10 text-cyan-700 ring-cyan-500/30 dark:bg-cyan-500/15 dark:text-cyan-300' },
  emerald: { ring: 'ring-emerald-500/30 dark:ring-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-300', val: 'text-emerald-700 dark:text-emerald-200', glow: 'bg-emerald-500/10', ic: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300' },
  rose:    { ring: 'ring-rose-500/30 dark:ring-rose-500/20',       text: 'text-rose-700 dark:text-rose-300',       val: 'text-rose-700 dark:text-rose-200',       glow: 'bg-rose-500/10',    ic: 'bg-rose-500/10 text-rose-700 ring-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300' },
  amber:   { ring: 'ring-amber-500/30 dark:ring-amber-500/20',     text: 'text-amber-700 dark:text-amber-300',     val: 'text-amber-700 dark:text-amber-200',     glow: 'bg-amber-500/10',   ic: 'bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300' },
  sky:     { ring: 'ring-sky-500/30 dark:ring-sky-500/20',         text: 'text-sky-700 dark:text-sky-300',         val: 'text-sky-700 dark:text-sky-200',         glow: 'bg-sky-500/10',     ic: 'bg-sky-500/10 text-sky-700 ring-sky-500/30 dark:bg-sky-500/15 dark:text-sky-300' },
  violet:  { ring: 'ring-violet-500/30 dark:ring-violet-500/20',   text: 'text-violet-700 dark:text-violet-300',   val: 'text-violet-700 dark:text-violet-200',   glow: 'bg-violet-500/10',  ic: 'bg-violet-500/10 text-violet-700 ring-violet-500/30 dark:bg-violet-500/15 dark:text-violet-300' },
} as const

type KpiColor = keyof typeof KPI_COLORS

function Kpi({ label, value, sub, icon, color = 'cyan', index = 0 }: {
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
      <div className={`absolute -top-8 -right-8 w-24 h-24 ${c.glow} rounded-full blur-3xl pointer-events-none opacity-70 group-hover:opacity-100 transition-opacity`}/>
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

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative rounded-xl backdrop-blur-xl bg-white/95 ring-1 ring-zinc-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)] dark:bg-gradient-to-b dark:from-zinc-900/70 dark:via-zinc-950/60 dark:to-zinc-950/80 dark:ring-cyan-400/5 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_32px_-16px_rgba(0,0,0,0.8),0_0_40px_-20px_rgba(34,211,238,0.25)] ${className}`}>
      {children}
    </div>
  )
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 shrink-0 relative">
      <h3 className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-cyan-300/70 truncate">{children}</h3>
      {right}
      <div className="absolute inset-x-3 bottom-0 h-px bg-gradient-to-r from-transparent via-zinc-200 to-transparent dark:via-cyan-500/10 pointer-events-none"/>
    </div>
  )
}

function CostRow({ label, value, tone, sign, bold }: {
  label: string; value: number; tone: 'positive' | 'negative'; sign: string; bold?: boolean
}) {
  const color = tone === 'positive'
    ? 'text-emerald-700 dark:text-emerald-300'
    : 'text-rose-700 dark:text-rose-300'
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className={`text-zinc-600 dark:text-zinc-400 ${bold ? 'font-bold text-zinc-900 dark:text-white' : ''}`}>{label}</span>
      <span className={`font-mono tabular-nums ${color} ${bold ? 'font-bold text-[12px]' : 'font-semibold'}`}>
        {sign} {formatCurrency(Math.abs(value))}
      </span>
    </div>
  )
}
