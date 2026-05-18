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
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { useAdminRole } from '../../../hooks/useAdminRole'

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
        <div
            className="fixed inset-0 z-50 bg-black/80 sm:flex sm:items-center sm:justify-center sm:p-4"
            onClick={onClose}
        >
            <div
                className="bg-theme-bg-secondary border-theme-border h-full w-full overflow-y-auto sm:h-auto sm:max-h-[90vh] sm:max-w-6xl sm:rounded-2xl sm:border"
                onClick={e => e.stopPropagation()}
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
                {/* Header — sticky, app-style */}
                <div
                    className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-theme-border bg-theme-bg-secondary px-4 py-3 sm:px-6 sm:py-4"
                    style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
                >
                    <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                        <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-full overflow-hidden flex items-center justify-center text-white text-xl sm:text-3xl font-bold flex-shrink-0">
                            {operatore.avatar_url ? (
                                <img src={operatore.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <span className={`w-full h-full ${tone} flex items-center justify-center rounded-full`}>{initials}</span>
                            )}
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-lg sm:text-2xl font-bold text-theme-text-primary truncate">{operatore.nome} {operatore.cognome || ''}</h2>
                            <p className="text-xs sm:text-sm text-theme-text-muted truncate">{operatore.ruolo || 'Operatore'} · {operatore.email}</p>
                            <p className="text-[10px] sm:text-xs text-theme-text-muted mt-0.5">Target: {operatore.ore_target_giornaliere}h / giorno</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Chiudi"
                        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-theme-bg-tertiary text-theme-text-secondary hover:text-theme-text-primary text-xl"
                    >×</button>
                </div>

                {/* Period selector — horizontally scrollable on mobile so pills don't crush */}
                <div className="px-4 sm:px-6 pt-3 sm:pt-4">
                    <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {(['7gg', '30gg', 'mese', 'custom'] as Period[]).map(p => (
                            <button
                                key={p}
                                onClick={() => setPeriod(p)}
                                className={`whitespace-nowrap text-xs px-3 py-2 rounded-full font-medium transition-colors min-h-[36px] ${
                                    period === p
                                        ? 'bg-dr7-gold text-black'
                                        : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'
                                }`}
                            >
                                {p === '7gg' ? '7 giorni' : p === '30gg' ? '30 giorni' : p === 'mese' ? 'Mese corrente' : 'Personalizzato'}
                            </button>
                        ))}
                    </div>
                    {period === 'custom' && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="bg-theme-bg-tertiary border border-theme-border rounded px-2 py-2 text-xs text-theme-text-primary min-h-[36px]" />
                            <span className="text-theme-text-muted text-xs">→</span>
                            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="bg-theme-bg-tertiary border border-theme-border rounded px-2 py-2 text-xs text-theme-text-primary min-h-[36px]" />
                        </div>
                    )}
                    <div className="mt-2 text-[11px] text-theme-text-muted">
                        {fmtDate(range.start)} → {fmtDate(range.end)} · {range.days.length} giorni
                    </div>
                </div>

                {/* Contratto — sezione editabile con condizioni del contratto */}
                <div className="px-4 sm:px-6 pt-3 sm:pt-4">
                    <ContrattoSection operatoreId={operatore.id} />
                </div>

                {/* Calcola Paga — usa contratto + ore lavorate nel periodo */}
                <div className="px-4 sm:px-6 pt-3">
                    <CalcolaPagaSection
                        operatoreId={operatore.id}
                        oreTargetGiornaliere={operatore.ore_target_giornaliere || 8}
                        days={days}
                        rangeLabel={`${fmtDate(range.start)} → ${fmtDate(range.end)}`}
                    />
                </div>

                {/* KPI cards */}
                <div className="px-4 sm:px-6 py-3 sm:py-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
                    <KpiCard label="Ore Lavorate" value={fmtMin(stats.totMinLavorati)} tone="emerald" />
                    <KpiCard label="Target" value={fmtMin(stats.targetMin)} sub={`${stats.giorniAttivi} giorni attivi`} tone="sky" />
                    <KpiCard label="Completamento" value={`${stats.completion}%`} tone={stats.completion >= 100 ? 'emerald' : stats.completion >= 75 ? 'amber' : 'rose'} />
                    <KpiCard label="Pause Totali" value={fmtMin(stats.totMinPausa)} sub={`${stats.totPause} pause`} tone="amber" />
                    <KpiCard label="Pausa Media" value={stats.avgPausa > 0 ? `${stats.avgPausa} min` : '—'} tone="muted" />
                    <KpiCard label="Pausa Max" value={stats.maxPausa > 0 ? `${stats.maxPausa} min` : '—'} sub={stats.giornoMaxPause ? fmtDate(stats.giornoMaxPause.data) : ''} tone="muted" />
                </div>

                {/* Trend chart */}
                <div className="px-4 sm:px-6 pb-3 sm:pb-4">
                    <div className="bg-theme-bg-tertiary/30 border border-theme-border rounded-lg p-3 sm:p-4">
                        <div className="flex items-baseline justify-between mb-2 sm:mb-3">
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
                                            formatter={(v: unknown) => fmtMin(Number(v) || 0)}
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
                <div className="px-4 sm:px-6 pb-6">
                    <h3 className="text-sm font-semibold text-theme-text-primary mb-2 sm:mb-3">Dettaglio per giornata</h3>
                    {loading ? (
                        <p className="text-xs text-theme-text-muted py-8 text-center">Caricamento…</p>
                    ) : days.filter(d => d.entrata || d.uscita || d.pauseWindows.length > 0).length === 0 ? (
                        <p className="text-xs text-theme-text-muted italic py-8 text-center">Nessuna attività registrata nel periodo.</p>
                    ) : (
                        <div className="space-y-2">
                            {days.filter(d => d.entrata || d.uscita || d.pauseWindows.length > 0).reverse().map(d => (
                                <div key={d.data} className="bg-theme-bg-tertiary/30 border border-theme-border rounded-lg p-3">
                                    <div className="mb-2 flex items-baseline justify-between gap-3">
                                        <div className="text-sm font-semibold text-theme-text-primary">{fmtDate(d.data)}</div>
                                        <div className="text-right">
                                            <div className="text-sm font-semibold text-emerald-400 leading-tight">{fmtMin(d.minutiLavorati)}</div>
                                            {d.minutiLavorati > 0 && (
                                                <div className="text-[10px] text-theme-text-muted tabular-nums">{d.minutiLavorati} min</div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="mb-2 grid grid-cols-2 gap-2 text-[11px] sm:flex sm:flex-wrap sm:items-center sm:gap-4 sm:text-xs">
                                        <span className="text-theme-text-muted">Entrata: <span className="font-mono text-theme-text-primary">{fmtTime(d.entrata)}</span></span>
                                        <span className="text-theme-text-muted">Uscita: <span className="font-mono text-theme-text-primary">{fmtTime(d.uscita)}</span></span>
                                        <span className="text-amber-400">Pausa {fmtMin(d.minutiPausa)}</span>
                                    </div>
                                    {d.pauseWindows.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5">
                                            {d.pauseWindows.map((p, i) => (
                                                <span key={i} className="text-[10px] sm:text-[11px] bg-amber-500/10 text-amber-300 border border-amber-500/30 rounded px-2 py-0.5 font-mono">
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

// ─── Contratto: editabile inline, visibile SOLO a direzione / developer ─
// Compensi e flag dell'operatore visibili solo a chi ha `role:direzione`
// o `role:developer` in admins.permissions (failsafe valerio/ilenia/ophe).
// Gli altri admin che aprono il proprio profilo non vedono nulla qui.

interface Contratto {
    id?: string
    tipo_rapporto: string | null
    ore_target_giornaliere: number | null
    ore_target_settimanali: number | null
    ore_target_mensili: number | null
    giorni_lavorativi_settimana: number | null
    // Importo stipendio (settimanale o mensile, vedi stipendio_frequenza).
    // Nome colonna DB e' stipendio_mensile_eur per backwards compat.
    stipendio_mensile_eur: number | null
    stipendio_frequenza: 'settimanale' | 'mensile'
    paga_oraria_eur: number | null
    paga_straordinario_eur: number | null
    straordinario_abilitato: boolean
    // Soglia ore lavorate / giorno oltre cui scatta lo straordinario.
    // Se null e straordinario_abilitato, usa ore_target_giornaliere.
    ore_soglia_straordinario: number | null
    lavora_festivi: boolean
    notifiche_attive: boolean
    visibilita_fatturato: boolean
    data_inizio: string
    note: string | null
    pdf_path: string | null
    pdf_filename: string | null
    pdf_uploaded_at: string | null
}

function emptyContratto(): Contratto {
    return {
        tipo_rapporto: null,
        ore_target_giornaliere: 8,
        ore_target_settimanali: 40,
        ore_target_mensili: 160,
        giorni_lavorativi_settimana: 5,
        stipendio_mensile_eur: null,
        stipendio_frequenza: 'mensile',
        paga_oraria_eur: null,
        paga_straordinario_eur: null,
        straordinario_abilitato: false,
        ore_soglia_straordinario: null,
        lavora_festivi: false,
        notifiche_attive: true,
        visibilita_fatturato: false,
        data_inizio: new Date().toISOString().slice(0, 10),
        note: null,
        pdf_path: null,
        pdf_filename: null,
        pdf_uploaded_at: null,
    }
}

function ContrattoSection({ operatoreId }: { operatoreId: string }) {
    const { hasRole } = useAdminRole()
    const isDirezione = hasRole('direzione') || hasRole('developer')
    const [contratto, setContratto] = useState<Contratto | null>(null)
    const [draft, setDraft] = useState<Contratto | null>(null)
    const [editMode, setEditMode] = useState(false)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null)

    // Load contract
    useEffect(() => {
        if (!isDirezione) return
        let cancelled = false
        setLoading(true)
        setLoadError(null)
        ;(async () => {
            const { data, error } = await supabase
                .from('operatore_contratto')
                .select('*')
                .eq('operatore_id', operatoreId)
                .eq('attivo', true)
                .maybeSingle()
            if (cancelled) return
            setLoading(false)
            if (error) {
                console.error('[Contratto] load error', error)
                setLoadError(error.message || error.code || 'errore sconosciuto')
                return
            }
            if (data) {
                setContratto(data as unknown as Contratto)
            } else {
                setContratto(null)
            }
        })()
        return () => { cancelled = true }
    }, [operatoreId, isDirezione])

    if (!isDirezione) return null

    function startEdit() {
        setDraft(contratto ? { ...contratto } : emptyContratto())
        setEditMode(true)
    }

    function cancelEdit() {
        setDraft(null)
        setEditMode(false)
    }

    function updateDraft<K extends keyof Contratto>(k: K, v: Contratto[K]) {
        setDraft(prev => prev ? { ...prev, [k]: v } : prev)
    }

    function num(s: string): number | null {
        if (!s.trim()) return null
        const n = Number(s)
        return Number.isFinite(n) ? n : null
    }

    async function save() {
        if (!draft) return
        setSaving(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            const payload = {
                operatore_id: operatoreId,
                user_id: user?.id || null,
                attivo: true,
                data_inizio: draft.data_inizio,
                tipo_rapporto: draft.tipo_rapporto || null,
                ore_target_giornaliere: draft.ore_target_giornaliere,
                ore_target_settimanali: draft.ore_target_settimanali,
                ore_target_mensili: draft.ore_target_mensili,
                giorni_lavorativi_settimana: draft.giorni_lavorativi_settimana,
                stipendio_mensile_eur: draft.stipendio_mensile_eur,
                stipendio_frequenza: draft.stipendio_frequenza || 'mensile',
                paga_oraria_eur: draft.paga_oraria_eur,
                paga_straordinario_eur: draft.paga_straordinario_eur,
                straordinario_abilitato: draft.straordinario_abilitato,
                ore_soglia_straordinario: draft.ore_soglia_straordinario,
                lavora_festivi: draft.lavora_festivi,
                notifiche_attive: draft.notifiche_attive,
                visibilita_fatturato: draft.visibilita_fatturato,
                note: draft.note,
            }
            console.log('[Contratto] saving payload', payload)
            if (contratto?.id) {
                const { error } = await supabase.from('operatore_contratto').update(payload).eq('id', contratto.id)
                if (error) throw error
            } else {
                const { error } = await supabase.from('operatore_contratto').insert({ ...payload, created_by: user?.id || null })
                if (error) throw error
            }
            toast.success('Contratto salvato')
            const { data: refreshed } = await supabase
                .from('operatore_contratto')
                .select('*')
                .eq('operatore_id', operatoreId)
                .eq('attivo', true)
                .maybeSingle()
            console.log('[Contratto] refreshed from DB', refreshed)
            setContratto(refreshed as unknown as Contratto)
            setEditMode(false)
            setDraft(null)
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            toast.error(`Errore salvataggio: ${msg}`)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="bg-theme-bg-tertiary/30 border border-theme-border rounded-lg p-3 sm:p-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-theme-text-primary flex items-center gap-2">
                    Contratto
                    <span className="text-[10px] uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5">Solo direzione</span>
                </h3>
                {!editMode && !loading && (
                    <button
                        onClick={startEdit}
                        className="px-3 py-1 rounded-full text-xs font-semibold border border-dr7-gold/40 text-dr7-gold hover:bg-dr7-gold/10"
                    >
                        {contratto ? 'Modifica' : '+ Crea contratto'}
                    </button>
                )}
            </div>

            {loading && <p className="text-xs text-theme-text-muted">Caricamento…</p>}
            {loadError && <p className="text-xs text-red-400">Errore: {loadError}{loadError.includes('relation') ? ' — esegui la migrazione 20260511_operatore_contratto.sql' : ''}</p>}

            {!loading && !loadError && !editMode && !contratto && (
                <p className="text-xs text-theme-text-muted italic">Nessun contratto configurato. Clicca "Crea contratto" per impostare ore, compenso e flag.</p>
            )}

            {!loading && !loadError && !editMode && contratto && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    <Field label="Tipo rapporto" value={contratto.tipo_rapporto || '—'} />
                    <Field label="Ore/giorno" value={contratto.ore_target_giornaliere != null ? `${contratto.ore_target_giornaliere}h` : '—'} />
                    <Field label="Ore/settimana" value={contratto.ore_target_settimanali != null ? `${contratto.ore_target_settimanali}h` : '—'} />
                    <Field label="Ore/mese" value={contratto.ore_target_mensili != null ? `${contratto.ore_target_mensili}h` : '—'} />
                    <Field label="Giorni/sett." value={contratto.giorni_lavorativi_settimana != null ? String(contratto.giorni_lavorativi_settimana) : '—'} />
                    <Field
                        label={`Stipendio ${contratto.stipendio_frequenza || 'mensile'}`}
                        value={contratto.stipendio_mensile_eur != null
                            ? `€${contratto.stipendio_mensile_eur} / ${contratto.stipendio_frequenza === 'settimanale' ? 'sett.' : 'mese'}`
                            : '—'}
                    />
                    <Field label="Paga oraria" value={contratto.paga_oraria_eur != null ? `€${contratto.paga_oraria_eur}/h` : '—'} />
                    <Field label="Straordinario" value={contratto.paga_straordinario_eur != null ? `€${contratto.paga_straordinario_eur}/h` : '—'} />
                    <Field
                        label="Soglia straordinario"
                        value={contratto.straordinario_abilitato
                            ? (contratto.ore_soglia_straordinario != null
                                ? `dopo ${contratto.ore_soglia_straordinario}h`
                                : (contratto.ore_target_giornaliere != null
                                    ? `dopo ${contratto.ore_target_giornaliere}h (=target)`
                                    : '—'))
                            : 'disabilitato'}
                    />
                    <Field label="Data inizio" value={contratto.data_inizio} />
                    <Flag label="Straordinario abilitato" on={contratto.straordinario_abilitato} />
                    <Flag label="Lavora festivi" on={contratto.lavora_festivi} />
                    <Flag label="Notifiche attive" on={contratto.notifiche_attive} />
                    <Flag label="Vede fatturato" on={contratto.visibilita_fatturato} />
                    {contratto.note && (
                        <div className="col-span-full">
                            <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Note</div>
                            <div className="text-xs text-theme-text-primary whitespace-pre-wrap">{contratto.note}</div>
                        </div>
                    )}
                    <div className="col-span-full pt-2 border-t border-theme-border">
                        <ContrattoPdfArea contratto={contratto} onChange={(updated) => setContratto(updated)} />
                    </div>
                </div>
            )}

            {editMode && draft && (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <LabeledSelect label="Tipo rapporto" value={draft.tipo_rapporto || ''} onChange={v => updateDraft('tipo_rapporto', v || null)} options={[
                            { value: '', label: 'Seleziona…' },
                            { value: 'dipendente', label: 'Dipendente' },
                            { value: 'collaboratore', label: 'Collaboratore' },
                            { value: 'stagista', label: 'Stagista' },
                            { value: 'occasionale', label: 'Occasionale / Babysitter' },
                            { value: 'partita_iva', label: 'Partita IVA' },
                        ]} />
                        <LabeledInput label="Data inizio" type="date" value={draft.data_inizio} onChange={v => updateDraft('data_inizio', v)} />
                    </div>

                    <fieldset className="border border-theme-border rounded p-3">
                        <legend className="px-2 text-[10px] uppercase tracking-wider text-theme-text-muted">Ore obiettivo</legend>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <LabeledInput label="Giornaliere" type="number" step="0.5" value={draft.ore_target_giornaliere ?? ''} onChange={v => updateDraft('ore_target_giornaliere', num(v))} />
                            <LabeledInput label="Settimanali" type="number" step="0.5" value={draft.ore_target_settimanali ?? ''} onChange={v => updateDraft('ore_target_settimanali', num(v))} />
                            <LabeledInput label="Mensili" type="number" step="0.5" value={draft.ore_target_mensili ?? ''} onChange={v => updateDraft('ore_target_mensili', num(v))} />
                            <LabeledInput label="Giorni/sett." type="number" min={1} max={7} value={draft.giorni_lavorativi_settimana ?? ''} onChange={v => updateDraft('giorni_lavorativi_settimana', num(v))} />
                        </div>
                    </fieldset>

                    <fieldset className="border border-theme-border rounded p-3">
                        <legend className="px-2 text-[10px] uppercase tracking-wider text-theme-text-muted">Compenso</legend>
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                            <LabeledInput
                                label={`Stipendio (€${draft.stipendio_frequenza === 'settimanale' ? '/sett.' : '/mese'})`}
                                type="number"
                                step="0.01"
                                value={draft.stipendio_mensile_eur ?? ''}
                                onChange={v => updateDraft('stipendio_mensile_eur', num(v))}
                                placeholder={draft.stipendio_frequenza === 'settimanale' ? 'es. 375.00' : 'es. 1500.00'}
                            />
                            <LabeledSelect
                                label="Frequenza"
                                value={draft.stipendio_frequenza}
                                onChange={v => updateDraft('stipendio_frequenza', (v === 'settimanale' ? 'settimanale' : 'mensile'))}
                                options={[
                                    { value: 'mensile', label: 'Mensile' },
                                    { value: 'settimanale', label: 'Settimanale' },
                                ]}
                            />
                            <LabeledInput label="Paga oraria (€/h)" type="number" step="0.01" value={draft.paga_oraria_eur ?? ''} onChange={v => updateDraft('paga_oraria_eur', num(v))} placeholder="es. 9.50" />
                            <LabeledInput label="Straordinario (€/h)" type="number" step="0.01" value={draft.paga_straordinario_eur ?? ''} onChange={v => updateDraft('paga_straordinario_eur', num(v))} placeholder="es. 14.00" />
                        </div>
                        {draft.straordinario_abilitato && (
                            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <LabeledInput
                                    label="Soglia straordinario (h/giorno)"
                                    type="number"
                                    step="0.5"
                                    min={0}
                                    max={24}
                                    value={draft.ore_soglia_straordinario ?? ''}
                                    onChange={v => updateDraft('ore_soglia_straordinario', num(v))}
                                    placeholder={`default ${draft.ore_target_giornaliere ?? 8}h (=target)`}
                                />
                                <div className="text-[10px] text-theme-text-muted self-end pb-1">
                                    Ore di lavoro al giorno oltre cui scatta lo straordinario.
                                    Lascia vuoto per usare il target giornaliero.
                                </div>
                            </div>
                        )}
                    </fieldset>

                    <fieldset className="border border-theme-border rounded p-3">
                        <legend className="px-2 text-[10px] uppercase tracking-wider text-theme-text-muted">Permessi e flag</legend>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {([
                                { k: 'straordinario_abilitato', label: 'Può fare straordinari' },
                                { k: 'lavora_festivi', label: 'Lavora domenica/festivi' },
                                { k: 'notifiche_attive', label: 'Riceve notifiche direzione' },
                                { k: 'visibilita_fatturato', label: 'Vede il fatturato nei report' },
                            ] as const).map(f => (
                                <button
                                    key={f.k}
                                    type="button"
                                    onClick={() => updateDraft(f.k, !draft[f.k] as never)}
                                    className="flex items-center justify-between gap-3 p-2 rounded border border-theme-border bg-theme-bg-primary hover:border-dr7-gold/40 text-left"
                                >
                                    <span className="text-xs text-theme-text-primary">{f.label}</span>
                                    <span className={`relative inline-flex flex-shrink-0 items-center w-9 h-5 rounded-full transition-colors ${draft[f.k] ? 'bg-emerald-500' : 'bg-theme-bg-hover border border-theme-border'}`}>
                                        <span className={`inline-block w-4 h-4 rounded-full bg-white shadow transform transition-transform ${draft[f.k] ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                    </span>
                                </button>
                            ))}
                        </div>
                    </fieldset>

                    <div>
                        <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted mb-1">Note interne</label>
                        <textarea
                            value={draft.note || ''}
                            onChange={e => updateDraft('note', e.target.value || null)}
                            rows={2}
                            placeholder="Es. orari particolari, deroghe..."
                            className="w-full px-2 py-1.5 text-xs bg-theme-bg-primary border border-theme-border rounded text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:border-dr7-gold"
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-theme-border">
                        <button onClick={cancelEdit} disabled={saving} className="px-3 py-1.5 rounded text-xs text-theme-text-secondary hover:text-theme-text-primary">Annulla</button>
                        <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded text-xs font-semibold bg-dr7-gold text-black hover:bg-dr7-gold/90 disabled:opacity-50">
                            {saving ? 'Salvataggio…' : 'Salva'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">{label}</div>
            <div className="text-xs font-medium text-theme-text-primary tabular-nums">{value}</div>
        </div>
    )
}

function Flag({ label, on }: { label: string; on: boolean }) {
    return (
        <div className="flex items-center gap-2">
            <span className={`inline-block w-3 h-3 rounded-full ${on ? 'bg-emerald-500' : 'bg-theme-bg-hover border border-theme-border'}`} />
            <span className="text-xs text-theme-text-primary">{label}</span>
        </div>
    )
}

function LabeledInput({ label, ...props }: { label: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> & { onChange: (v: string) => void }) {
    const { onChange, ...rest } = props
    return (
        <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-theme-text-muted mb-1">{label}</span>
            <input
                {...rest}
                onChange={e => onChange(e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-theme-bg-primary border border-theme-border rounded text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:border-dr7-gold"
            />
        </label>
    )
}

function LabeledSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
    return (
        <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-theme-text-muted mb-1">{label}</span>
            <select
                value={value}
                onChange={e => onChange(e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-theme-bg-primary border border-theme-border rounded text-theme-text-primary focus:outline-none focus:border-dr7-gold"
            >
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
        </label>
    )
}

// PDF del contratto firmato: upload nel bucket privato "operatori-contratti"
// e signed-URL preview/download on-demand. Visibile solo a direzione (la
// sezione padre e' gia' gated).
function ContrattoPdfArea({ contratto, onChange }: { contratto: Contratto; onChange: (c: Contratto) => void }) {
    const [uploading, setUploading] = useState(false)
    const [signedUrl, setSignedUrl] = useState<string | null>(null)

    // Ogni volta che cambia pdf_path richiediamo una signed URL valida 1h.
    useEffect(() => {
        let cancelled = false
        if (!contratto.pdf_path) { setSignedUrl(null); return }
        ;(async () => {
            const { data, error } = await supabase.storage
                .from('operatori-contratti')
                .createSignedUrl(contratto.pdf_path!, 60 * 60)
            if (cancelled) return
            if (error) { console.error('[contratto-pdf] signed url error', error); setSignedUrl(null); return }
            setSignedUrl(data?.signedUrl || null)
        })()
        return () => { cancelled = true }
    }, [contratto.pdf_path])

    async function handleUpload(file: File) {
        if (!contratto.id) {
            toast.error('Salva prima il contratto, poi allega il PDF')
            return
        }
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            toast.error('Carica un file PDF')
            return
        }
        if (file.size > 10 * 1024 * 1024) {
            toast.error('File troppo grande (max 10 MB)')
            return
        }
        setUploading(true)
        try {
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
            const path = `${contratto.id}/${Date.now()}_${safeName}`
            const { error: upErr } = await supabase.storage
                .from('operatori-contratti')
                .upload(path, file, { contentType: 'application/pdf', upsert: false })
            if (upErr) throw upErr
            const { error: updErr } = await supabase
                .from('operatore_contratto')
                .update({
                    pdf_path: path,
                    pdf_filename: file.name,
                    pdf_uploaded_at: new Date().toISOString(),
                })
                .eq('id', contratto.id)
            if (updErr) throw updErr
            onChange({ ...contratto, pdf_path: path, pdf_filename: file.name, pdf_uploaded_at: new Date().toISOString() })
            toast.success('PDF allegato')
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            toast.error(`Upload fallito: ${msg}`)
        } finally {
            setUploading(false)
        }
    }

    async function handleRemove() {
        if (!contratto.id || !contratto.pdf_path) return
        if (!confirm('Rimuovere il PDF allegato?')) return
        try {
            await supabase.storage.from('operatori-contratti').remove([contratto.pdf_path])
            const { error } = await supabase
                .from('operatore_contratto')
                .update({ pdf_path: null, pdf_filename: null, pdf_uploaded_at: null })
                .eq('id', contratto.id)
            if (error) throw error
            onChange({ ...contratto, pdf_path: null, pdf_filename: null, pdf_uploaded_at: null })
            toast.success('PDF rimosso')
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            toast.error(`Errore: ${msg}`)
        }
    }

    return (
        <div>
            <div className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-2">Contratto firmato (PDF)</div>
            {contratto.pdf_path && contratto.pdf_filename ? (
                <div className="flex flex-wrap items-center gap-2 bg-theme-bg-primary border border-theme-border rounded p-2">
                    <svg className="w-5 h-5 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm3 4a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1zm0 4a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1z" clipRule="evenodd" /></svg>
                    <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-theme-text-primary truncate">{contratto.pdf_filename}</div>
                        {contratto.pdf_uploaded_at && (
                            <div className="text-[10px] text-theme-text-muted">Caricato {new Date(contratto.pdf_uploaded_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                        )}
                    </div>
                    {signedUrl && (
                        <a href={signedUrl} target="_blank" rel="noreferrer" className="px-3 py-1 rounded-full text-xs font-semibold border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10">Apri</a>
                    )}
                    <button onClick={handleRemove} className="px-3 py-1 rounded-full text-xs font-semibold border border-red-500/40 text-red-400 hover:bg-red-500/10">Rimuovi</button>
                </div>
            ) : (
                <label className="flex items-center gap-3 bg-theme-bg-primary border border-dashed border-theme-border rounded p-3 cursor-pointer hover:border-dr7-gold/50">
                    <svg className="w-5 h-5 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    <div className="flex-1 text-xs">
                        <div className="font-medium text-theme-text-primary">{uploading ? 'Caricamento…' : 'Carica PDF contratto'}</div>
                        <div className="text-[10px] text-theme-text-muted">Solo PDF · max 10 MB · visibile solo a direzione</div>
                    </div>
                    <input
                        type="file"
                        accept="application/pdf,.pdf"
                        disabled={uploading || !contratto.id}
                        onChange={e => {
                            const f = e.target.files?.[0]
                            if (f) handleUpload(f)
                            e.currentTarget.value = ''
                        }}
                        className="hidden"
                    />
                </label>
            )}
            {!contratto.id && (
                <p className="text-[10px] text-amber-400 mt-1">Salva prima il contratto per poter allegare il PDF.</p>
            )}
        </div>
    )
}

// ──────────────────────────────────────────────────────────────────
// CalcolaPagaSection — calcola la paga del periodo selezionato.
//
// Sorgenti:
//   - operatore_contratto.attivo=true (stipendio_mensile_eur,
//     paga_oraria_eur, paga_straordinario_eur, ore_target_giornaliere,
//     ore_soglia_straordinario)
//   - days[] (passato dal modal): minuti lavorati per giorno
//   - operatori_persone.ore_a_recuperare_min (saldo manuale,
//     editabile direttamente qui — positive = decurtazione,
//     negative = bonus)
//
// Regola: per ogni giorno con minuti > soglia, eccesso = straordinari.
// Resto = ore ordinarie.
//   paga_ordinaria = ore_ordinarie × paga_oraria
//   paga_straordinari = ore_straord × paga_straordinario (se abilitato)
//   correzione_ore_recuperare = -(ore_a_recuperare × paga_oraria)
//   stipendio_fisso = stipendio_mensile_eur (mostrato a parte come
//     riferimento, non sommato all'orario per evitare doppio conteggio)
// Solo direzione/developer vede questa sezione.
// ──────────────────────────────────────────────────────────────────
interface CalcolaPagaContract {
    stipendio_mensile_eur: number | null
    stipendio_frequenza: 'settimanale' | 'mensile' | null
    paga_oraria_eur: number | null
    paga_straordinario_eur: number | null
    straordinario_abilitato: boolean
    ore_soglia_straordinario: number | null
}

function CalcolaPagaSection({
    operatoreId,
    oreTargetGiornaliere,
    days,
    rangeLabel,
}: {
    operatoreId: string
    oreTargetGiornaliere: number
    days: DayBreakdown[]
    rangeLabel: string
}) {
    const { hasRole } = useAdminRole()
    const isDirezione = hasRole('direzione') || hasRole('developer')
    const [contract, setContract] = useState<CalcolaPagaContract | null>(null)
    const [oreRecMin, setOreRecMin] = useState<number>(0)
    const [oreRecInput, setOreRecInput] = useState<string>('0')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (!isDirezione) { setLoading(false); return }
        let cancelled = false
        ;(async () => {
            setLoading(true)
            const [{ data: cData }, { data: oData }] = await Promise.all([
                supabase.from('operatore_contratto')
                    .select('stipendio_mensile_eur, stipendio_frequenza, paga_oraria_eur, paga_straordinario_eur, straordinario_abilitato, ore_soglia_straordinario')
                    .eq('operatore_id', operatoreId)
                    .eq('attivo', true)
                    .maybeSingle(),
                supabase.from('operatori_persone')
                    .select('ore_a_recuperare_min')
                    .eq('id', operatoreId)
                    .maybeSingle(),
            ])
            if (cancelled) return
            setContract((cData as CalcolaPagaContract | null) || null)
            const m = Number((oData as { ore_a_recuperare_min?: number } | null)?.ore_a_recuperare_min || 0)
            setOreRecMin(m)
            setOreRecInput(minutesToHourInput(m))
            setLoading(false)
        })()
        return () => { cancelled = true }
    }, [operatoreId, isDirezione])

    const calc = useMemo(() => {
        const sogliaMin = Math.round((contract?.ore_soglia_straordinario ?? oreTargetGiornaliere) * 60)
        const oraria = Number(contract?.paga_oraria_eur || 0)
        const straord = Number(contract?.paga_straordinario_eur || 0)
        // 2026-05-18: straordinari calcolati AUTOMATICAMENTE se il contratto
        // ha sia paga_straordinario_eur > 0 sia ore_soglia_straordinario > 0.
        // Il flag legacy `straordinario_abilitato` resta come override
        // esplicito: se l'utente lo mette su false in maniera intenzionale,
        // i straordinari NON vengono calcolati. Default (null/undefined) =
        // abilitato se paga + soglia sono configurati.
        const straordEnabled =
            contract?.straordinario_abilitato !== false
            && straord > 0
            && sogliaMin > 0
        let minOrdinari = 0
        let minStraord = 0
        for (const d of days) {
            if (d.minutiLavorati <= 0) continue
            if (straordEnabled && d.minutiLavorati > sogliaMin) {
                // Oltre la soglia giornaliera, il surplus va a paga straordinario.
                // Es. contratto: soglia 8h, paga ord 10€/h, paga str 15€/h
                // Giorno con 10h lavorate → 8h × 10€ = 80€ + 2h × 15€ = 30€
                minOrdinari += sogliaMin
                minStraord += d.minutiLavorati - sogliaMin
            } else {
                minOrdinari += d.minutiLavorati
            }
        }
        const pagaOrd = (minOrdinari / 60) * oraria
        const pagaStraord = (minStraord / 60) * straord
        const correzione = -(oreRecMin / 60) * oraria // recuperare = decurta
        const totale = pagaOrd + pagaStraord + correzione
        return { sogliaMin, minOrdinari, minStraord, pagaOrd, pagaStraord, correzione, totale, straordEnabled, oraria, straord }
    }, [days, contract, oreRecMin, oreTargetGiornaliere])

    async function saveOreRecuperare() {
        const parsed = hoursInputToMinutes(oreRecInput)
        setSaving(true)
        const { error } = await supabase
            .from('operatori_persone')
            .update({ ore_a_recuperare_min: parsed })
            .eq('id', operatoreId)
        setSaving(false)
        if (error) {
            toast.error(`Errore salvataggio: ${error.message}`)
            return
        }
        setOreRecMin(parsed)
        toast.success('Ore a recuperare aggiornate')
    }

    if (!isDirezione) return null
    if (loading) return <p className="text-[11px] text-theme-text-muted py-2">Caricamento Calcola Paga…</p>

    const noContract = !contract || (!contract.paga_oraria_eur && !contract.stipendio_mensile_eur)
    const eur = (n: number) => `€${n.toFixed(2)}`

    return (
        <div className="rounded-xl border border-theme-border bg-theme-bg-tertiary/30 p-4">
            <div className="mb-3 flex items-baseline justify-between gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-theme-text-primary">Calcola Paga</h3>
                <span className="text-[10px] text-theme-text-muted">{rangeLabel}</span>
            </div>

            {noContract ? (
                <QuickPagaCalc days={days} rangeLabel={rangeLabel} />
            ) : (
                <>
                    {/* Regole applicate dal contratto: l'admin vede subito che
                        formula sta usando il calcolo. Mostriamo "Straordinario"
                        e "Soglia" SOLO se i straordinari sono effettivamente
                        attivi (paga_straord > 0 AND abilitato !== false). */}
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-theme-text-muted">
                        <span className="px-2 py-0.5 rounded bg-theme-bg-secondary border border-theme-border">
                            Ordinaria: <strong className="text-theme-text-primary">€{calc.oraria.toFixed(2)}/h</strong>
                        </span>
                        {calc.straordEnabled && (
                            <>
                                <span className="px-2 py-0.5 rounded bg-theme-bg-secondary border border-theme-border">
                                    Straordinario: <strong className="text-sky-400">€{calc.straord.toFixed(2)}/h</strong>
                                </span>
                                <span className="px-2 py-0.5 rounded bg-theme-bg-secondary border border-theme-border">
                                    Soglia: <strong className="text-theme-text-primary">{Math.round(calc.sogliaMin / 60 * 10) / 10}h/giorno</strong>
                                </span>
                            </>
                        )}
                        {!calc.straordEnabled && (
                            <span className="px-2 py-0.5 rounded bg-theme-bg-tertiary border border-theme-border text-theme-text-muted">
                                Straordinari non previsti
                            </span>
                        )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                            <div className="text-[10px] uppercase text-theme-text-muted">Ore Ordinarie</div>
                            <div className="text-sm font-semibold text-theme-text-primary">{fmtMin(calc.minOrdinari)}</div>
                            <div className="text-[10px] text-emerald-400 mt-0.5 tabular-nums">{eur(calc.pagaOrd)}</div>
                        </div>
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                            <div className="text-[10px] uppercase text-theme-text-muted">Straordinari</div>
                            <div className="text-sm font-semibold text-theme-text-primary">{fmtMin(calc.minStraord)}</div>
                            <div className="text-[10px] text-sky-400 mt-0.5 tabular-nums">{eur(calc.pagaStraord)}</div>
                        </div>
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                            <div className="text-[10px] uppercase text-theme-text-muted">Ore a Recuperare</div>
                            <div className="text-sm font-semibold text-theme-text-primary">{oreRecMin === 0 ? '—' : fmtMin(Math.abs(oreRecMin))}</div>
                            <div className={`text-[10px] mt-0.5 tabular-nums ${calc.correzione < 0 ? 'text-rose-400' : calc.correzione > 0 ? 'text-emerald-400' : 'text-theme-text-muted'}`}>{calc.correzione === 0 ? '—' : eur(calc.correzione)}</div>
                        </div>
                        <div className="bg-dr7-gold/10 border border-dr7-gold/40 rounded-lg px-3 py-2">
                            <div className="text-[10px] uppercase text-theme-text-muted">Totale</div>
                            <div className="text-lg font-bold text-dr7-gold tabular-nums">{eur(calc.totale)}</div>
                            {contract?.stipendio_mensile_eur && (
                                <div className="text-[9px] text-theme-text-muted mt-0.5">Stipendio fisso: {eur(Number(contract.stipendio_mensile_eur))} / {contract.stipendio_frequenza || 'mese'}</div>
                            )}
                        </div>
                    </div>

                    <div className="border-t border-theme-border pt-3 flex flex-wrap items-end gap-2">
                        <div className="flex-1 min-w-[160px]">
                            <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted mb-1">Aggiorna Ore a Recuperare</label>
                            <input
                                type="text"
                                value={oreRecInput}
                                onChange={(e) => setOreRecInput(e.target.value)}
                                placeholder="es. 2 o 1h30 o -0h45"
                                className="w-full bg-theme-bg-secondary border border-theme-border rounded-md px-3 py-2 text-sm text-theme-text-primary"
                            />
                            <p className="text-[10px] text-theme-text-muted mt-1">
                                Positivo = decurta la paga · Negativo = bonus all&apos;operatore. Es. <code>1h30</code> · <code>-0h45</code> · <code>2</code> (= 2h)
                            </p>
                        </div>
                        <button
                            type="button"
                            disabled={saving}
                            onClick={saveOreRecuperare}
                            className="px-4 py-2 rounded-full bg-dr7-gold text-black font-semibold text-sm hover:opacity-90 disabled:opacity-50"
                        >{saving ? 'Salvo…' : 'Salva'}</button>
                    </div>
                </>
            )}
        </div>
    )
}

function minutesToHourInput(min: number): string {
    if (min === 0) return '0'
    const sign = min < 0 ? '-' : ''
    const abs = Math.abs(min)
    const h = Math.floor(abs / 60)
    const m = abs % 60
    if (m === 0) return `${sign}${h}`
    return `${sign}${h}h${String(m).padStart(2, '0')}`
}
/**
 * QuickPagaCalc — calcolatrice rapida inline quando l'operatore NON ha
 * contratto attivo o paga oraria configurata. L'admin digita €/ora
 * (e opzionalmente €/h straordinario + soglia ore) e vede subito la
 * paga totale sul range selezionato. Niente persistenza: e' un
 * "what-if" veloce per stimare quanto pagare un operatore senza dover
 * configurare il contratto.
 */
function QuickPagaCalc({ days, rangeLabel }: { days: DayBreakdown[]; rangeLabel: string }) {
    const [oraria, setOraria] = useState<string>('10')
    const [straord, setStraord] = useState<string>('15')
    const [sogliaH, setSogliaH] = useState<string>('8')
    const oraNum = Number(oraria.replace(',', '.')) || 0
    const straordNum = Number(straord.replace(',', '.')) || 0
    const sogliaMin = Math.round((Number(sogliaH.replace(',', '.')) || 8) * 60)

    let minOrd = 0, minStr = 0
    for (const d of days) {
        if (d.minutiLavorati <= 0) continue
        if (d.minutiLavorati > sogliaMin && straordNum > 0) {
            minOrd += sogliaMin
            minStr += d.minutiLavorati - sogliaMin
        } else {
            minOrd += d.minutiLavorati
        }
    }
    const pagaOrd = (minOrd / 60) * oraNum
    const pagaStr = (minStr / 60) * straordNum
    const totale = pagaOrd + pagaStr
    const eur = (n: number) => `€${n.toFixed(2)}`

    return (
        <div>
            <p className="text-[12px] text-amber-400 mb-3">
                Nessun contratto attivo. Inserisci la paga oraria qui sotto per un calcolo veloce (non viene salvato sul contratto).
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
                <label className="block">
                    <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">Paga oraria (€/h)</span>
                    <input type="number" step="0.01" value={oraria} onChange={(e) => setOraria(e.target.value)}
                        className="w-full bg-theme-bg-secondary border border-theme-border rounded-md px-2 py-1.5 text-sm text-theme-text-primary mt-1" />
                </label>
                <label className="block">
                    <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">Straordinario (€/h)</span>
                    <input type="number" step="0.01" value={straord} onChange={(e) => setStraord(e.target.value)}
                        className="w-full bg-theme-bg-secondary border border-theme-border rounded-md px-2 py-1.5 text-sm text-theme-text-primary mt-1" />
                </label>
                <label className="block">
                    <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">Soglia straord. (h/giorno)</span>
                    <input type="number" step="0.5" value={sogliaH} onChange={(e) => setSogliaH(e.target.value)}
                        className="w-full bg-theme-bg-secondary border border-theme-border rounded-md px-2 py-1.5 text-sm text-theme-text-primary mt-1" />
                </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                    <div className="text-[10px] uppercase text-theme-text-muted">Ore Ordinarie</div>
                    <div className="text-sm font-semibold text-theme-text-primary">{fmtMin(minOrd)}</div>
                    <div className="text-[10px] text-emerald-400 mt-0.5 tabular-nums">{eur(pagaOrd)}</div>
                </div>
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                    <div className="text-[10px] uppercase text-theme-text-muted">Straordinari</div>
                    <div className="text-sm font-semibold text-theme-text-primary">{fmtMin(minStr)}</div>
                    <div className="text-[10px] text-sky-400 mt-0.5 tabular-nums">{eur(pagaStr)}</div>
                </div>
                <div className="bg-dr7-gold/10 border border-dr7-gold/40 rounded-lg px-3 py-2">
                    <div className="text-[10px] uppercase text-theme-text-muted">Totale {rangeLabel}</div>
                    <div className="text-lg font-bold text-dr7-gold tabular-nums">{eur(totale)}</div>
                </div>
            </div>
        </div>
    )
}

function hoursInputToMinutes(s: string): number {
    const t = (s || '').trim()
    if (!t) return 0
    const negative = t.startsWith('-')
    const body = negative ? t.slice(1) : t
    // Forme: "1h30" / "1:30" / "2" / "0h45"
    const m1 = body.match(/^(\d+)\s*[h:]\s*(\d{1,2})?$/i)
    if (m1) {
        const h = parseInt(m1[1], 10)
        const mm = m1[2] ? parseInt(m1[2], 10) : 0
        return (negative ? -1 : 1) * (h * 60 + Math.min(59, mm))
    }
    const m2 = body.match(/^(\d+(?:\.\d+)?)$/)
    if (m2) {
        const hh = parseFloat(m2[1])
        return Math.round((negative ? -1 : 1) * hh * 60)
    }
    return 0
}
