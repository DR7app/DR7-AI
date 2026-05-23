import { useEffect, useState, useMemo } from 'react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, Legend } from 'recharts'
import { supabase } from '../../../supabaseClient'

interface Slice { name: string; value: number; color: string }
interface DayPoint { day: string; ricariche: number; utilizzi: number }

const fmtEur = (n: number) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(n))

interface WalletAnalyticsProps {
  totalBalanceCents: number
  customersCount: number
  activeCount: number
  inactiveCount: number
}

export default function WalletAnalytics({ totalBalanceCents, activeCount, inactiveCount }: WalletAnalyticsProps) {
  const [series, setSeries] = useState<DayPoint[]>([])
  const [thisMonthIn, setThisMonthIn] = useState(0)
  const [thisMonthOut, setThisMonthOut] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      // Last 180 days of credit_transactions, bucketed by week.
      const sinceISO = new Date(Date.now() - 180 * 86400000).toISOString()
      const { data: txs } = await supabase
        .from('credit_transactions')
        .select('transaction_type, amount, created_at')
        .gte('created_at', sinceISO)
        .order('created_at', { ascending: true })

      if (cancelled) return

      // Bucket by week (YYYY-MM-DD of the Monday).
      const buckets = new Map<string, { ricariche: number; utilizzi: number }>()
      for (const t of txs || []) {
        const d = new Date(t.created_at)
        // align to Monday
        const day = d.getDay()
        const diff = (day === 0 ? -6 : 1) - day
        const monday = new Date(d)
        monday.setDate(d.getDate() + diff)
        const key = monday.toISOString().slice(0, 10)
        const prev = buckets.get(key) || { ricariche: 0, utilizzi: 0 }
        const amt = Number(t.amount) || 0
        if (t.transaction_type === 'credit' || t.transaction_type === 'topup' || t.transaction_type === 'recharge' || amt > 0) {
          prev.ricariche += Math.abs(amt)
        } else {
          prev.utilizzi += Math.abs(amt)
        }
        buckets.set(key, prev)
      }
      const sorted = Array.from(buckets.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, v]) => ({
          day: new Date(key).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }),
          ricariche: Math.round(v.ricariche * 100) / 100,
          utilizzi: Math.round(v.utilizzi * 100) / 100,
        }))
      if (!cancelled) setSeries(sorted)

      // This-month totals
      const monthStart = new Date()
      monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
      let inSum = 0, outSum = 0
      for (const t of txs || []) {
        if (new Date(t.created_at) < monthStart) continue
        const amt = Number(t.amount) || 0
        if (t.transaction_type === 'credit' || amt > 0) inSum += Math.abs(amt)
        else outSum += Math.abs(amt)
      }
      if (!cancelled) {
        setThisMonthIn(inSum)
        setThisMonthOut(outSum)
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Donut: utilizzato (sum of utilizzi last 180d), disponibile (balance now), inattivo 30+ days
  const utilizzatoTotal = useMemo(() => series.reduce((s, p) => s + p.utilizzi, 0), [series])
  const totalBalance = totalBalanceCents / 100
  const slices: Slice[] = [
    { name: 'Utilizzato (180gg)', value: Math.round(utilizzatoTotal), color: '#22d3ee' },
    { name: 'Disponibile', value: Math.round(totalBalance), color: '#10b981' },
    { name: 'Clienti inattivi', value: inactiveCount, color: '#f59e0b' },
  ].filter(s => s.value > 0)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-4">
      {/* Area chart: andamento ricariche & utilizzi (2 colonne su lg) */}
      <div className="lg:col-span-2 rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-theme-text-primary">Andamento Ricariche &amp; Utilizzi</p>
            <p className="text-[11px] text-theme-text-muted">Ultimi 180 giorni · raggruppato per settimana</p>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-theme-text-secondary">Ricariche</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              <span className="text-theme-text-secondary">Utilizzi</span>
            </span>
          </div>
        </div>

        {loading ? (
          <div className="h-[220px] flex items-center justify-center text-theme-text-muted text-sm">Caricamento…</div>
        ) : series.length === 0 ? (
          <div className="h-[220px] flex items-center justify-center text-theme-text-muted text-sm">
            Nessuna transazione negli ultimi 180 giorni
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={series} margin={{ top: 6, right: 12, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id="wallet-in" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="wallet-out" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" stroke="#9ca3af" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis stroke="#9ca3af" tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#fff' }}
                formatter={(v) => `€${fmtEur(Number(v) || 0)}`}
              />
              <Area type="monotone" dataKey="ricariche" stroke="#10b981" strokeWidth={2} fill="url(#wallet-in)" />
              <Area type="monotone" dataKey="utilizzi" stroke="#22d3ee" strokeWidth={2} fill="url(#wallet-out)" />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {/* This-month strip */}
        <div className="grid grid-cols-2 gap-2 mt-4">
          <div className="rounded-xl bg-theme-bg-tertiary/50 border border-theme-border/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-emerald-400">Ricariche mese</p>
            <p className="text-lg font-bold text-emerald-400 tabular-nums">€ {fmtEur(thisMonthIn)}</p>
          </div>
          <div className="rounded-xl bg-theme-bg-tertiary/50 border border-theme-border/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-cyan-400">Utilizzi mese</p>
            <p className="text-lg font-bold text-cyan-400 tabular-nums">€ {fmtEur(thisMonthOut)}</p>
          </div>
        </div>
      </div>

      {/* Donut: Riepilogo Wallet */}
      <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
        <p className="text-sm font-semibold text-theme-text-primary mb-1">Riepilogo Wallet</p>
        <p className="text-[11px] text-theme-text-muted mb-3">{activeCount} attivi · {inactiveCount} inattivi (saldo nullo o &gt;90gg)</p>
        {slices.length === 0 ? (
          <div className="h-[220px] flex items-center justify-center text-theme-text-muted text-sm">Nessun dato</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={slices} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                {slices.map((s, i) => <Cell key={i} fill={s.color} />)}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#fff' }}
                formatter={(v, name) => {
                  const num = Number(v) || 0
                  const isCount = name === 'Clienti inattivi'
                  return isCount ? `${num} clienti` : `€${fmtEur(num)}`
                }}
              />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
