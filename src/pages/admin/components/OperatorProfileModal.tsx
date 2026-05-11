/**
 * OperatorProfileModal — per-operator full dashboard.
 *
 * Direzione/ophe click "Profilo completo" on any operator (from the
 * expanded daily row) and get a modal with the operator's
 * complete time-tracking view: KPIs, trend chart, pause analytics,
 * and a day-by-day breakdown of every pause window.
 *
 * Loads timesheet_entries for the chosen date range, aggregates per
 * day on the client (entrata, uscita, pause windows, minuti
 * lavorati, minuti pausa), then renders the same visual language
 * already used in the team dashboard.
 */
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../supabaseClient'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'

interface Operatore {
    id: string
    nome: string
    cognome: string | null
    email: string
    ruolo: string | null
    ore_target_giornaliere: number
    avatar_url: string | null
}

interface TimesheetEntry {
    operatore_id: string
    tipo: 'entrata' | 'uscita' | 'pausa_inizio' | 'pausa_fine'
    timestamp: string
    data: string
}

interface DayBreakdown {
    data: string
    entrata: string | null
    uscita: string | null
    pauseWindows: { start: string; end: string | null; durMin: number }[]
    minutiLavorati: number
    minutiPausa: number
}

const ROME_TZ = 'Europe/Rome'

function fmtMin(min: number): string {
    if (min === 0) return '—'
    const h = Math.floor(min / 60)
    const m = min % 60
    return `${h}h ${String(m).padStart(2, '0')}m`
}
function fmtTime(iso: string | null): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleTimeString('it-IT', { timeZone: ROME_TZ, hour: '2-digit', minute: '2-digit' })
}
function fmtDate(s: string): string {
    const d = new Date(s + 'T12:00:00')
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}
function toRomeDate(d: Date): string {
    return d.toLocaleDateString('en-CA', { timeZone: ROME_TZ })
}

type Period = '7gg' | '30gg' | 'mese' | 'custom'

const AVATAR_TONES = ['bg-emerald-600', 'bg-blue-600', 'bg-amber-600', 'bg-rose-600', 'bg-violet-600', 'bg-cyan-600', 'bg-fuchsia-600', 'bg-orange-600']
function avatarTone(seed: string): string {
    let h = 0
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
    return AVATAR_TONES[h % AVATAR_TONES.length]
}

export default function OperatorProfileModal({
    operatore,
    onClose,
}: {
    operatore: Operatore
    onClose: () => void
}) {
    const [period, setPeriod] = useState<Period>('30gg')
    const [customFrom, setCustomFrom] = useState<string>(() => {
        const d = new Date(); d.setDate(d.getDate() - 29)
        return toRomeDate(d)
    })
    const [customTo, setCustomTo] = useState<string>(() => toRomeDate(new Date()))
    const [days, setDays] = useState<DayBreakdown[]>([])
    const [loading, setLoading] = useState(true)

    const range = useMemo(() => {
        const end = new Date()
        const start = new Date()
        if (period === '7gg') start.setDate(start.getDate() - 6)
        else if (period === '30gg') start.setDate(start.getDate() - 29)
        else if (period === 'mese') start.setDate(1)
        else if (period === 'custom') {
            const [fy, fm, fd] = customFrom.split('-').map(Number)
            const [ty, tm, td] = customTo.split('-').map(Number)
            if (fy && fm && fd) start.setFullYear(fy, fm - 1, fd)
            if (ty && tm && td) end.setFullYear(ty, tm - 1, td)
        }
        const daysArr: string[] = []
        const cur = new Date(start)
        while (toRomeDate(cur) <= toRomeDate(end)) {
            daysArr.push(toRomeDate(cur))
            cur.setDate(cur.getDate() + 1)
        }
        return { start: toRomeDate(start), end: toRomeDate(end), days: daysArr }
    }, [period, customFrom, customTo])

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            setLoading(true)
            const { data } = await supabase
                .from('timesheet_entries')
                .select('operatore_id, tipo, timestamp, data')
                .eq('operatore_id', operatore.id)
                .gte('data', range.start)
                .lte('data', range.end)
                .order('timestamp', { ascending: true })
            if (cancelled) return
            const entries = (data || []) as TimesheetEntry[]

            // Group by day; rebuild pause windows + work minutes.
            const byDay = new Map<string, TimesheetEntry[]>()
            for (const e of entries) {
                if (!byDay.has(e.data)) byDay.set(e.data, [])
                byDay.get(e.data)!.push(e)
            }
            const breakdowns: DayBreakdown[] = range.days.map(d => {
                const dayEntries = byDay.get(d) || []
                let entrata: string | null = null
                let uscita: string | null = null
                const pauseStarts: string[] = []
                const pauseEnds: string[] = []
                for (const e of dayEntries) {
                    if (e.tipo === 'entrata') entrata = e.timestamp
                    else if (e.tipo === 'uscita') uscita = e.timestamp
                    else if (e.tipo === 'pausa_inizio') pauseStarts.push(e.timestamp)
                    else if (e.tipo === 'pausa_fine') pauseEnds.push(e.timestamp)
                }
                const pauseWindows = pauseStarts.map((start, i) => {
                    const end = pauseEnds[i] || null
                    const durMin = end
                        ? Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60000))
                        : 0
                    return { start, end, durMin }
                })
                const minutiPausa = pauseWindows.reduce((s, p) => s + p.durMin, 0)
                let minutiLavorati = 0
                if (entrata && uscita) {
                    minutiLavorati = Math.max(0, Math.floor((new Date(uscita).getTime() - new Date(entrata).getTime()) / 60000) - minutiPausa)
                }
                return { data: d, entrata, uscita, pauseWindows, minutiLavorati, minutiPausa }
            })
            setDays(breakdowns)
            setLoading(false)
        })()
        return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [operatore.id, range.start, range.end])

    // Aggregate stats
    const stats = useMemo(() => {
        const totMinLavorati = days.reduce((s, d) => s + d.minutiLavorati, 0)
        const totMinPausa = days.reduce((s, d) => s + d.minutiPausa, 0)
        const totPause = days.reduce((s, d) => s + d.pauseWindows.length, 0)
        const giorniAttivi = days.filter(d => d.minutiLavorati > 0).length
        const targetMin = Math.round((operatore.ore_target_giornaliere || 8) * 60) * giorniAttivi
        const completion = targetMin > 0 ? Math.round((totMinLavorati / targetMin) * 100) : 0
        const avgPausa = totPause > 0 ? Math.round(totMinPausa / totPause) : 0
        const maxPausa = days.flatMap(d => d.pauseWindows).reduce((m, p) => Math.max(m, p.durMin), 0)
        const giornoMaxPause = days.reduce((max, d) => d.pauseWindows.length > (max?.pauseWindows.length || 0) ? d : max, days[0])
        return {
            totMinLavorati,
            totMinPausa,
            totPause,
            giorniAttivi,
            targetMin,
            completion,
            avgPausa,
            maxPausa,
            giornoMaxPause,
        }
    }, [days, operatore.ore_target_giornaliere])

    // Chart data
    const trendData = useMemo(() => days.map(d => ({
        day: d.data.slice(-2),
        label: new Date(d.data + 'T12:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }),
        minutes: d.minutiLavorati,
    })), [days])

    const initials = `${(operatore.nome || '').charAt(0)}${(operatore.cognome || '').charAt(0)}`.toUpperCase() || operatore.email.charAt(0).toUpperCase()
    const tone = avatarTone(operatore.email || operatore.nome)

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
            <div
                className="bg-theme-bg-secondary rounded-2xl border border-theme-border max-w-6xl w-full max-h-[90vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between gap-4 p-6 border-b border-theme-border sticky top-0 bg-theme-bg-secondary z-10">
                    <div className="flex items-start gap-4">
                        <div className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center text-white text-3xl font-bold flex-shrink-0" style={!operatore.avatar_url ? { } : undefined}>
                            {operatore.avatar_url ? (
                                <img src={operatore.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <span className={`w-full h-full ${tone} flex items-center justify-center rounded-full`}>{initials}</span>
                            )}
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-theme-text-primary">{operatore.nome} {operatore.cognome || ''}</h2>
                            <p className="text-sm text-theme-text-muted">{operatore.ruolo || 'Operatore'} · {operatore.email}</p>
                            <p className="text-xs text-theme-text-muted mt-1">Target: {operatore.ore_target_giornaliere}h / giorno</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary text-2xl leading-none" aria-label="Chiudi">×</button>
                </div>

                {/* Period selector */}
                <div className="px-6 pt-4 flex flex-wrap items-center gap-2">
                    {(['7gg', '30gg', 'mese', 'custom'] as Period[]).map(p => (
                        <button
                            key={p}
                            onClick={() => setPeriod(p)}
                            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                                period === p
                                    ? 'bg-dr7-gold text-black'
                                    : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'
                            }`}
                        >
                            {p === '7gg' ? '7 giorni' : p === '30gg' ? '30 giorni' : p === 'mese' ? 'Mese corrente' : 'Personalizzato'}
                        </button>
                    ))}
                    {period === 'custom' && (
                        <div className="flex items-center gap-2 ml-2">
                            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="bg-theme-bg-tertiary border border-theme-border rounded px-2 py-1 text-xs text-theme-text-primary" />
                            <span className="text-theme-text-muted text-xs">→</span>
                            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="bg-theme-bg-tertiary border border-theme-border rounded px-2 py-1 text-xs text-theme-text-primary" />
                        </div>
                    )}
                    <span className="ml-auto text-xs text-theme-text-muted">
                        {fmtDate(range.start)} → {fmtDate(range.end)} · {range.days.length} giorni
                    </span>
                </div>

                {/* KPI cards */}
                <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    <KpiCard label="Ore Lavorate" value={fmtMin(stats.totMinLavorati)} tone="emerald" />
                    <KpiCard label="Target" value={fmtMin(stats.targetMin)} sub={`${stats.giorniAttivi} giorni attivi`} tone="sky" />
                    <KpiCard label="Completamento" value={`${stats.completion}%`} tone={stats.completion >= 100 ? 'emerald' : stats.completion >= 75 ? 'amber' : 'rose'} />
                    <KpiCard label="Pause Totali" value={fmtMin(stats.totMinPausa)} sub={`${stats.totPause} pause`} tone="amber" />
                    <KpiCard label="Pausa Media" value={stats.avgPausa > 0 ? `${stats.avgPausa} min` : '—'} tone="muted" />
                    <KpiCard label="Pausa Max" value={stats.maxPausa > 0 ? `${stats.maxPausa} min` : '—'} sub={stats.giornoMaxPause ? fmtDate(stats.giornoMaxPause.data) : ''} tone="muted" />
                </div>

                {/* Trend chart */}
                <div className="px-6 pb-4">
                    <div className="bg-theme-bg-tertiary/30 border border-theme-border rounded-lg p-4">
                        <div className="flex items-baseline justify-between mb-3">
                            <h3 className="text-sm font-semibold text-theme-text-primary">Andamento Ore Lavorate</h3>
                            <span className="text-[10px] text-theme-text-muted">minuti per giorno</span>
                        </div>
                        {loading ? (
                            <p className="text-xs text-theme-text-muted py-8 text-center">Caricamento…</p>
                        ) : trendData.every(d => d.minutes === 0) ? (
                            <p className="text-xs text-theme-text-muted py-8 text-center italic">Nessuna giornata lavorata nel periodo.</p>
                        ) : (
                            <div className="h-56">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={trendData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="opTrend" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid stroke="#374151" strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="label" stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} />
                                        <YAxis stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v / 60)}h`} />
                                        <Tooltip
                                            contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                                            formatter={(v: number) => fmtMin(v)}
                                            labelFormatter={(label) => `Giorno ${label}`}
                                        />
                                        <Area type="monotone" dataKey="minutes" stroke="#10b981" fill="url(#opTrend)" strokeWidth={2} name="Ore lavorate" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </div>
                </div>

                {/* Per-day breakdown */}
                <div className="px-6 pb-6">
                    <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Dettaglio per giornata</h3>
                    {loading ? (
                        <p className="text-xs text-theme-text-muted py-8 text-center">Caricamento…</p>
                    ) : days.filter(d => d.entrata || d.uscita || d.pauseWindows.length > 0).length === 0 ? (
                        <p className="text-xs text-theme-text-muted italic py-8 text-center">Nessuna attività registrata nel periodo.</p>
                    ) : (
                        <div className="space-y-2">
                            {days.filter(d => d.entrata || d.uscita || d.pauseWindows.length > 0).reverse().map(d => (
                                <div key={d.data} className="bg-theme-bg-tertiary/30 border border-theme-border rounded-lg p-3">
                                    <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
                                        <div className="text-sm font-semibold text-theme-text-primary">{fmtDate(d.data)}</div>
                                        <div className="flex items-center gap-4 text-xs">
                                            <span className="text-theme-text-muted">Entrata: <span className="font-mono text-theme-text-primary">{fmtTime(d.entrata)}</span></span>
                                            <span className="text-theme-text-muted">Uscita: <span className="font-mono text-theme-text-primary">{fmtTime(d.uscita)}</span></span>
                                            <span className="text-emerald-400 font-semibold">{fmtMin(d.minutiLavorati)}</span>
                                            <span className="text-amber-400">Pausa {fmtMin(d.minutiPausa)}</span>
                                        </div>
                                    </div>
                                    {d.pauseWindows.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5">
                                            {d.pauseWindows.map((p, i) => (
                                                <span key={i} className="text-[11px] bg-amber-500/10 text-amber-300 border border-amber-500/30 rounded px-2 py-0.5 font-mono">
                                                    #{i + 1} {fmtTime(p.start)}→{p.end ? fmtTime(p.end) : 'in corso'} · {p.durMin}m
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

type KpiTone = 'emerald' | 'sky' | 'amber' | 'rose' | 'muted'
const KPI_TONES: Record<KpiTone, string> = {
    emerald: 'border-emerald-500/30 text-emerald-400',
    sky: 'border-sky-500/30 text-sky-400',
    amber: 'border-amber-500/30 text-amber-400',
    rose: 'border-rose-500/30 text-rose-400',
    muted: 'border-theme-border text-theme-text-muted',
}
function KpiCard({ label, value, sub, tone = 'emerald' }: { label: string; value: string; sub?: string; tone?: KpiTone }) {
    const cls = KPI_TONES[tone]
    return (
        <div className={`bg-theme-bg-tertiary/30 border rounded-lg p-3 ${cls}`}>
            <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">{label}</div>
            <div className={`text-xl font-bold mt-1 tabular-nums`}>{value}</div>
            {sub && <div className="text-[10px] text-theme-text-muted mt-0.5">{sub}</div>}
        </div>
    )
}
