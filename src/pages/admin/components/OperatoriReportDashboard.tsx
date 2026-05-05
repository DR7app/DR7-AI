import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import { useAdminRole } from '../../../hooks/useAdminRole'

const ROME_TZ = 'Europe/Rome'

function toRomeDate(d: Date = new Date()): string {
    return d.toLocaleDateString('en-CA', { timeZone: ROME_TZ })
}
function fmtMin(min: number): string {
    if (min === 0) return '0h 00m'
    const h = Math.floor(min / 60)
    const m = min % 60
    return `${h}h ${String(m).padStart(2, '0')}m`
}
function eur(n: number): string {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0)
}
function fmtTime(iso: string | null): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleTimeString('it-IT', { timeZone: ROME_TZ, hour: '2-digit', minute: '2-digit' })
}

interface Operatore {
    id: string
    user_id: string | null
    nome: string
    cognome: string | null
    email: string
    ruolo: string | null
    ore_target_giornaliere: number
}

interface DayRow {
    operatore: Operatore
    entrata: string | null
    uscita: string | null
    pausa_inizi: string[]
    pausa_fini: string[]
    minuti_lavorati: number
    minuti_pausa: number
    stato: 'fuori' | 'lavoro' | 'pausa' | 'finito'
}

type Range = 'oggi' | '7gg' | '30gg' | 'mese'

/**
 * Dashboard "Report Operatori & Collaboratori" — la vista ricca con
 * KPI + grafici + timesheet del giorno + widgets in basso.
 *
 * Privacy: Valerio/Ilenia (direzione) vedono il team intero; gli altri
 * admin vedono SOLO i propri dati e i grafici/Top sono nascosti.
 */
export default function OperatoriReportDashboard() {
    const { adminName, adminEmail } = useAdminRole()
    const isDirezione = ((adminName || '') + ' ' + (adminEmail || '')).toLowerCase().match(/valerio|ilenia/) != null

    const [range, setRange] = useState<Range>('mese')
    const [today] = useState(toRomeDate(new Date()))
    const [dataDay, setDataDay] = useState<string>(toRomeDate(new Date()))

    const [operatori, setOperatori] = useState<Operatore[]>([])
    const [me, setMe] = useState<Operatore | null>(null)
    const [dailyRows, setDailyRows] = useState<DayRow[]>([])
    const [periodMinutesByDay, setPeriodMinutesByDay] = useState<{ day: string; minutes: number }[]>([])
    const [periodMinutesByOp, setPeriodMinutesByOp] = useState<{ id: string; nome: string; minutes: number }[]>([])
    const [bookingsCount, setBookingsCount] = useState({ rentals: 0, washes: 0, fatture: 0, totFatture: 0 })
    const [loading, setLoading] = useState(true)

    const periodRange = useMemo(() => {
        const end = new Date()
        const start = new Date()
        if (range === 'oggi') {
            // start = today 00:00, end = today 23:59
        } else if (range === '7gg') {
            start.setDate(start.getDate() - 6)
        } else if (range === '30gg') {
            start.setDate(start.getDate() - 29)
        } else if (range === 'mese') {
            start.setDate(1)
        }
        const days: string[] = []
        const cur = new Date(start)
        while (toRomeDate(cur) <= toRomeDate(end)) {
            days.push(toRomeDate(cur))
            cur.setDate(cur.getDate() + 1)
        }
        return { start, end, days }
    }, [range])

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            const myEmail = (user?.email || '').toLowerCase()

            // 1) operatori — direzione vede tutti, gli altri solo se stessi
            let opQuery = supabase
                .from('operatori_persone')
                .select('id, user_id, nome, cognome, email, ruolo, ore_target_giornaliere')
                .eq('attivo', true)
            if (!isDirezione && user?.id) {
                opQuery = opQuery.or(`user_id.eq.${user.id},email.ilike.${myEmail}`)
            }
            const { data: ops } = await opQuery
            const opList = (ops || []) as Operatore[]
            setOperatori(opList)
            const myRow = opList.find(o => o.user_id === user?.id)
                || opList.find(o => (o.email || '').toLowerCase() === myEmail)
                || null
            setMe(myRow)

            // 2) timesheet del giorno selezionato (per la tabella principale)
            const operatoreIds = opList.map(o => o.id)
            if (operatoreIds.length > 0) {
                const { data: entries } = await supabase
                    .from('timesheet_entries')
                    .select('operatore_id, tipo, timestamp')
                    .eq('data', dataDay)
                    .in('operatore_id', operatoreIds)
                    .order('timestamp', { ascending: true })
                const byOp = new Map<string, { entrata: string | null; uscita: string | null; pi: string[]; pf: string[]; lastTipo: string | null }>()
                for (const e of (entries || []) as { operatore_id: string; tipo: string; timestamp: string }[]) {
                    const cur = byOp.get(e.operatore_id) || { entrata: null, uscita: null, pi: [], pf: [], lastTipo: null }
                    if (e.tipo === 'entrata') cur.entrata = e.timestamp
                    else if (e.tipo === 'uscita') cur.uscita = e.timestamp
                    else if (e.tipo === 'pausa_inizio') cur.pi.push(e.timestamp)
                    else if (e.tipo === 'pausa_fine') cur.pf.push(e.timestamp)
                    cur.lastTipo = e.tipo
                    byOp.set(e.operatore_id, cur)
                }
                const rows: DayRow[] = []
                for (const op of opList) {
                    const data = byOp.get(op.id)
                    let minuti = 0, pausaMin = 0
                    if (data) {
                        const { data: m } = await supabase.rpc('operatore_minuti_lavorati', { p_operatore_id: op.id, p_data: dataDay })
                        minuti = Number(m) || 0
                        for (let i = 0; i < Math.min(data.pi.length, data.pf.length); i++) {
                            pausaMin += Math.floor((new Date(data.pf[i]).getTime() - new Date(data.pi[i]).getTime()) / 60000)
                        }
                    }
                    let stato: DayRow['stato'] = 'fuori'
                    if (data?.lastTipo === 'entrata' || data?.lastTipo === 'pausa_fine') stato = 'lavoro'
                    else if (data?.lastTipo === 'pausa_inizio') stato = 'pausa'
                    else if (data?.lastTipo === 'uscita') stato = 'finito'
                    rows.push({ operatore: op, entrata: data?.entrata || null, uscita: data?.uscita || null, pausa_inizi: data?.pi || [], pausa_fini: data?.pf || [], minuti_lavorati: minuti, minuti_pausa: pausaMin, stato })
                }
                setDailyRows(rows)
            } else {
                setDailyRows([])
            }

            // 3) trend minuti per giorno (periodo selezionato)
            const trend: { day: string; minutes: number }[] = []
            const byOpTotal = new Map<string, number>()
            for (const d of periodRange.days) {
                let total = 0
                for (const op of opList) {
                    const { data: m } = await supabase.rpc('operatore_minuti_lavorati', { p_operatore_id: op.id, p_data: d })
                    const min = Number(m) || 0
                    total += min
                    byOpTotal.set(op.id, (byOpTotal.get(op.id) || 0) + min)
                }
                trend.push({ day: d, minutes: total })
            }
            setPeriodMinutesByDay(trend)
            setPeriodMinutesByOp(opList
                .map(o => ({ id: o.id, nome: `${o.nome} ${o.cognome || ''}`.trim(), minutes: byOpTotal.get(o.id) || 0 }))
                .sort((a, b) => b.minutes - a.minutes))

            // 4) bookings & fatture nel periodo (solo direzione, altrimenti i numeri sarebbero meaningless)
            if (isDirezione) {
                const fromIso = periodRange.start.toISOString()
                const toIso = periodRange.end.toISOString()
                const [{ count: rentalCount }, { count: washCount }, { count: fattCount, data: fattData }] = await Promise.all([
                    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('service_type', 'car_rental').gte('created_at', fromIso).lte('created_at', toIso),
                    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('service_type', 'car_wash').gte('created_at', fromIso).lte('created_at', toIso),
                    supabase.from('fatture').select('importo_totale', { count: 'exact' }).gte('created_at', fromIso).lte('created_at', toIso).limit(2000),
                ])
                const totFatture = (fattData || []).reduce((s, r: { importo_totale?: number | null }) => s + Number(r.importo_totale || 0), 0)
                setBookingsCount({
                    rentals: rentalCount || 0,
                    washes: washCount || 0,
                    fatture: fattCount || 0,
                    totFatture,
                })
            }
        } catch (err) {
            console.error('[operatori-dashboard] load error', err)
        } finally {
            setLoading(false)
        }
    }, [dataDay, isDirezione, periodRange.days, periodRange.start, periodRange.end])

    useEffect(() => { load() }, [load])

    // Auto-refresh quando l'utente salva orari dal modal (sidebar clock).
    useEffect(() => {
        const onSaved = () => load()
        window.addEventListener('timesheet:saved', onSaved)
        return () => window.removeEventListener('timesheet:saved', onSaved)
    }, [load])

    const operatoriTotali = operatori.length
    const attiviOggi = dailyRows.filter(r => r.stato !== 'fuori').length
    const oreLavorateOggiMin = dailyRows.reduce((s, r) => s + r.minuti_lavorati, 0)
    const oreStraordOggiMin = dailyRows.reduce((s, r) => {
        const target = Math.round((r.operatore.ore_target_giornaliere || 8) * 60)
        return s + Math.max(0, r.minuti_lavorati - target)
    }, 0)
    const orePeriodoMin = periodMinutesByDay.reduce((s, d) => s + d.minutes, 0)
    const presenti = dailyRows.filter(r => r.stato !== 'fuori').length
    const assenti = dailyRows.filter(r => r.stato === 'fuori').length

    // Top 5 operatori per ore (direzione only)
    const top5 = periodMinutesByOp.filter(x => x.minutes > 0).slice(0, 5)

    // Distribuzione per ruolo (direzione only)
    const ruoloMap = new Map<string, number>()
    for (const op of operatori) {
        const min = periodMinutesByOp.find(x => x.id === op.id)?.minutes || 0
        if (min === 0) continue
        const k = (op.ruolo || '—').trim() || '—'
        ruoloMap.set(k, (ruoloMap.get(k) || 0) + min)
    }
    const ruoloData = Array.from(ruoloMap.entries()).map(([nome, minutes]) => ({ nome, minutes }))

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-semibold text-theme-text-primary">Report Operatori & Collaboratori</h2>
                    <p className="text-xs text-theme-text-muted">
                        {isDirezione
                            ? 'Analisi completa di team, performance, presenze e produttività.'
                            : 'Vista personale: vedi solo i tuoi dati. Solo Valerio e Ilenia vedono i report di tutti.'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex gap-1 bg-theme-bg-tertiary rounded p-1 text-xs">
                        {(['oggi', '7gg', '30gg', 'mese'] as Range[]).map(r => (
                            <button key={r} onClick={() => setRange(r)}
                                className={`px-3 py-1 rounded ${range === r ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:text-theme-text-primary'}`}>
                                {r === 'oggi' ? 'Oggi' : r === '7gg' ? '7 giorni' : r === '30gg' ? '30 giorni' : 'Mese corrente'}
                            </button>
                        ))}
                    </div>
                    <button onClick={() => exportCsv(operatori, periodMinutesByOp, periodRange.days, periodMinutesByDay)}
                        className="text-xs px-3 py-1.5 rounded border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover">
                        Scarica CSV
                    </button>
                </div>
            </div>

            {/* TOP KPI ROW (8 tiles) */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                <KpiTile icon="users" label="Operatori Totali" value={String(operatoriTotali)} tone="emerald" />
                <KpiTile icon="check" label="Attivi Oggi" value={String(attiviOggi)} tone="emerald" />
                <KpiTile icon="invoice" label="Fatture Generate"
                    value={isDirezione ? eur(bookingsCount.totFatture) : '—'}
                    sub={isDirezione ? `${bookingsCount.fatture} fatt.` : 'solo direzione'}
                    tone="sky" />
                <KpiTile icon="folder" label="Pratiche Gestite"
                    value={isDirezione ? String(bookingsCount.rentals + bookingsCount.washes) : '—'}
                    sub={isDirezione ? 'noleggi + lavaggi' : 'solo direzione'}
                    tone="amber" />
                <KpiTile icon="car" label="Noleggi Periodo"
                    value={isDirezione ? String(bookingsCount.rentals) : '—'}
                    tone="primary" />
                <KpiTile icon="wash" label="Lavaggi Periodo"
                    value={isDirezione ? String(bookingsCount.washes) : '—'}
                    tone="primary" />
                <KpiTile icon="clock" label="Ore Lavorate" value={fmtMin(orePeriodoMin)} sub={`${orePeriodoMin} min`} tone="primary" />
                <KpiTile icon="trend" label="Produttività Media"
                    value={orePeriodoMin > 0
                        ? `${Math.min(100, Math.round((orePeriodoMin / Math.max(1, operatoriTotali * 8 * 60 * periodRange.days.length)) * 100))}%`
                        : '0%'}
                    sub="vs target" tone="emerald" />
            </div>

            {/* CHARTS ROW */}
            {!loading && (
                <div className={`grid gap-3 ${isDirezione ? 'lg:grid-cols-4 md:grid-cols-2' : 'lg:grid-cols-2'}`}>
                    <ChartCard title="Andamento Performance Team" subtitle="Ore lavorate per giorno">
                        <TrendLineChart data={periodMinutesByDay} />
                    </ChartCard>
                    {isDirezione && top5.length > 0 && (
                        <ChartCard title="Top 5 per Ore Lavorate" subtitle="Periodo selezionato">
                            <TopBarsChart data={top5} />
                        </ChartCard>
                    )}
                    {isDirezione && ruoloData.length > 1 && (
                        <ChartCard title="Distribuzione per Ruolo" subtitle="Ore per ruolo">
                            <DonutChart data={ruoloData} />
                        </ChartCard>
                    )}
                </div>
            )}

            {/* RILEVAZIONE ORARI GIORNALIERA */}
            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-4">
                <div className="flex items-baseline justify-between mb-3">
                    <div>
                        <h3 className="text-base font-semibold text-theme-text-primary">Rilevazione Orari Giornaliera</h3>
                        <p className="text-[10px] text-theme-text-muted">{new Date(dataDay).toLocaleDateString('it-IT', { timeZone: ROME_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                    </div>
                    <input type="date" value={dataDay} onChange={e => setDataDay(e.target.value)}
                        max={today}
                        className="bg-theme-bg-tertiary border border-theme-border rounded px-2 py-1 text-xs text-theme-text-primary" />
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="text-theme-text-muted text-xs">
                            <tr className="border-b border-theme-border">
                                <th className="text-left py-2 font-medium">Operatore</th>
                                <th className="text-left py-2 font-medium">Ruolo</th>
                                <th className="text-left py-2 font-medium">Entrata</th>
                                <th className="text-left py-2 font-medium">Uscita Pausa</th>
                                <th className="text-left py-2 font-medium">Rientro Pausa</th>
                                <th className="text-left py-2 font-medium">Uscita</th>
                                <th className="text-center py-2 font-medium">Pause</th>
                                <th className="text-right py-2 font-medium">Ore Lav.</th>
                                <th className="text-right py-2 font-medium">Straord.</th>
                                <th className="text-center py-2 font-medium">Stato</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-theme-border/50">
                            {dailyRows.length === 0 && (
                                <tr><td colSpan={10} className="text-center py-6 text-theme-text-muted">Nessun operatore.</td></tr>
                            )}
                            {dailyRows.map(r => {
                                const isMine = r.operatore.id === me?.id
                                const target = Math.round((r.operatore.ore_target_giornaliere || 8) * 60)
                                const straord = Math.max(0, r.minuti_lavorati - target)
                                return (
                                    <tr key={r.operatore.id} className={isMine ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''}>
                                        <td className="py-2 font-medium text-theme-text-primary">
                                            {r.operatore.nome} {r.operatore.cognome || ''}
                                            {isMine && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-dr7-gold text-black">tu</span>}
                                        </td>
                                        <td className="py-2 text-theme-text-secondary text-xs">{r.operatore.ruolo || '—'}</td>
                                        <td className="py-2 font-mono text-xs">{fmtTime(r.entrata)}</td>
                                        <td className="py-2 font-mono text-xs">{fmtTime(r.pausa_inizi[0] || null)}</td>
                                        <td className="py-2 font-mono text-xs">{fmtTime(r.pausa_fini[0] || null)}</td>
                                        <td className="py-2 font-mono text-xs">{fmtTime(r.uscita)}</td>
                                        <td className="py-2 text-center text-xs">{r.pausa_inizi.length}</td>
                                        <td className="py-2 text-right tabular-nums">
                                            <div className="font-semibold">{fmtMin(r.minuti_lavorati)}</div>
                                            <div className="text-[9px] text-theme-text-muted">{r.minuti_lavorati} min</div>
                                        </td>
                                        <td className="py-2 text-right tabular-nums">
                                            <span className={straord > 0 ? 'text-sky-500 font-semibold' : 'text-theme-text-muted text-xs'}>{fmtMin(straord)}</span>
                                        </td>
                                        <td className="py-2 text-center"><StatoLabel s={r.stato} /></td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* MINI STATS ROW */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MiniStat label="Presenti" value={String(presenti)} tone="emerald" />
                <MiniStat label="Assenti" value={String(assenti)} tone="muted" />
                <MiniStat label="Ore Lavorate Oggi" value={fmtMin(oreLavorateOggiMin)} sub={`${oreLavorateOggiMin} min`} tone="primary" />
                <MiniStat label="Straordinari Oggi" value={fmtMin(oreStraordOggiMin)} sub={`${oreStraordOggiMin} min`} tone={oreStraordOggiMin > 0 ? 'sky' : 'muted'} />
            </div>

            {/* BOTTOM WIDGETS — solo direzione */}
            {isDirezione && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <BarsByDayWeek data={periodMinutesByDay} />
                    <ObjectiveCard
                        oreSettimana={Math.round(orePeriodoMin / 60)}
                        targetSettimana={Math.max(1, operatoriTotali) * 8 * 5}
                    />
                    <CostiPersonale orePeriodoMin={orePeriodoMin} operatoriCount={operatoriTotali} />
                </div>
            )}

            {loading && <p className="text-theme-text-muted text-sm">Caricamento…</p>}
        </div>
    )
}

// ─── KPI TILE ─────────────────────────────────────────────────────────────

type Tone = 'emerald' | 'amber' | 'sky' | 'primary' | 'muted'
function KpiTile({ icon, label, value, sub, tone = 'primary' }: {
    icon?: 'users' | 'check' | 'invoice' | 'folder' | 'car' | 'wash' | 'clock' | 'trend'
    label: string; value: string; sub?: string; tone?: Tone
}) {
    const colors = {
        emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', txt: 'text-emerald-600 dark:text-emerald-400' },
        amber: { bg: 'bg-amber-50 dark:bg-amber-950/30', txt: 'text-amber-600 dark:text-amber-400' },
        sky: { bg: 'bg-sky-50 dark:bg-sky-950/30', txt: 'text-sky-600 dark:text-sky-400' },
        primary: { bg: 'bg-theme-bg-tertiary/30', txt: 'text-theme-text-primary' },
        muted: { bg: 'bg-theme-bg-tertiary/30', txt: 'text-theme-text-muted' },
    }[tone]
    return (
        <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-3">
            <div className="flex items-center gap-2">
                {icon && <div className={`w-7 h-7 rounded-md ${colors.bg} ${colors.txt} flex items-center justify-center text-[14px] font-semibold`}>
                    <KpiIcon name={icon} />
                </div>}
                <div className="flex-1 min-w-0">
                    <div className="text-[9px] text-theme-text-muted uppercase tracking-wider truncate">{label}</div>
                </div>
            </div>
            <div className={`text-xl font-bold mt-2 ${colors.txt}`}>{value}</div>
            {sub && <div className="text-[10px] text-theme-text-muted">{sub}</div>}
        </div>
    )
}

function KpiIcon({ name }: { name: 'users' | 'check' | 'invoice' | 'folder' | 'car' | 'wash' | 'clock' | 'trend' }) {
    const ICONS: Record<string, React.ReactElement> = {
        users: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
        check: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
        invoice: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
        folder: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
        car: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>,
        wash: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg>,
        clock: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
        trend: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
    }
    return ICONS[name] || null
}

// ─── MINI STAT ────────────────────────────────────────────────────────────

function MiniStat({ label, value, sub, tone = 'primary' }: { label: string; value: string; sub?: string; tone?: Tone }) {
    const txtColor = {
        emerald: 'text-emerald-500', amber: 'text-amber-500', sky: 'text-sky-500', primary: 'text-theme-text-primary', muted: 'text-theme-text-muted',
    }[tone]
    return (
        <div className="bg-theme-bg-secondary rounded-lg border border-theme-border px-3 py-2 flex items-center justify-between">
            <span className="text-xs text-theme-text-muted">{label}</span>
            <div className="text-right">
                <div className={`text-lg font-bold ${txtColor}`}>{value}</div>
                {sub && <div className="text-[10px] text-theme-text-muted">{sub}</div>}
            </div>
        </div>
    )
}

// ─── STATO LABEL ──────────────────────────────────────────────────────────

function StatoLabel({ s }: { s: DayRow['stato'] }) {
    const map = {
        fuori: { label: 'Fuori', cls: 'bg-theme-bg-tertiary text-theme-text-muted' },
        lavoro: { label: 'Attivo', cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' },
        pausa: { label: 'Pausa', cls: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
        finito: { label: 'Uscito', cls: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300' },
    }
    const m = map[s]
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${m.cls}`}>{m.label}</span>
}

// ─── CHART CARD ──────────────────────────────────────────────────────────

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
    return (
        <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-4">
            <div className="flex items-baseline justify-between mb-3">
                <h4 className="text-sm font-semibold text-theme-text-primary">{title}</h4>
                {subtitle && <span className="text-[10px] text-theme-text-muted">{subtitle}</span>}
            </div>
            {children}
        </div>
    )
}

function TrendLineChart({ data }: { data: { day: string; minutes: number }[] }) {
    if (data.length === 0) return <div className="text-theme-text-muted text-sm py-6 text-center">Nessun dato.</div>
    const max = Math.max(...data.map(d => d.minutes), 60)
    const W = 600, H = 160, PAD = 28
    const stepX = (W - PAD * 2) / Math.max(1, data.length - 1)
    const points = data.map((d, i) => ({ x: PAD + i * stepX, y: H - PAD - ((d.minutes / max) * (H - PAD * 2)), day: d.day, min: d.minutes }))
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
    const areaPath = `${path} L ${points[points.length - 1].x} ${H - PAD} L ${points[0].x} ${H - PAD} Z`
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44">
            <defs>
                <linearGradient id="trendGradOp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#19C2D6" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#19C2D6" stopOpacity="0" />
                </linearGradient>
            </defs>
            {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
                const y = H - PAD - t * (H - PAD * 2)
                return <line key={i} x1={PAD} x2={W - PAD} y1={y} y2={y} stroke="currentColor" strokeOpacity="0.08" strokeDasharray="2 3" />
            })}
            <path d={areaPath} fill="url(#trendGradOp)" />
            <path d={path} fill="none" stroke="#19C2D6" strokeWidth="2" />
            {points.map((p, i) => <g key={i}><circle cx={p.x} cy={p.y} r={3} fill="#19C2D6" /><title>{`${p.day}: ${fmtMin(p.min)}`}</title></g>)}
            {points.map((p, i) => i % Math.ceil(points.length / 8) === 0 ? (
                <text key={`l-${i}`} x={p.x} y={H - 8} fontSize="9" textAnchor="middle" fill="currentColor" fillOpacity="0.5">{p.day.slice(5)}</text>
            ) : null)}
        </svg>
    )
}

function TopBarsChart({ data }: { data: { id: string; nome: string; minutes: number }[] }) {
    if (data.length === 0) return <div className="text-theme-text-muted text-sm py-6 text-center">Nessun dato.</div>
    const max = Math.max(...data.map(d => d.minutes), 1)
    return (
        <div className="space-y-2">
            {data.map(d => {
                const pct = (d.minutes / max) * 100
                return (
                    <div key={d.id}>
                        <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-theme-text-secondary truncate pr-2">{d.nome}</span>
                            <span className="text-theme-text-muted whitespace-nowrap text-[10px]">{fmtMin(d.minutes)}</span>
                        </div>
                        <div className="h-2 bg-theme-bg-tertiary rounded-full overflow-hidden">
                            <div className="h-full bg-dr7-gold" style={{ width: `${pct}%` }} />
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

function DonutChart({ data }: { data: { nome: string; minutes: number }[] }) {
    const total = data.reduce((s, d) => s + d.minutes, 0)
    if (total === 0) return <div className="text-theme-text-muted text-sm py-6 text-center">Nessun dato.</div>
    const PALETTE = ['#19C2D6', '#F59E0B', '#10B981', '#8B5CF6', '#EF4444', '#3B82F6', '#EC4899', '#06B6D4']
    const R_OUT = 65, R_IN = 38, CX = 80, CY = 80
    let startAngle = -Math.PI / 2
    const arcs = data.map((d, i) => {
        const angle = (d.minutes / total) * Math.PI * 2
        const endAngle = startAngle + angle
        const x1 = CX + R_OUT * Math.cos(startAngle), y1 = CY + R_OUT * Math.sin(startAngle)
        const x2 = CX + R_OUT * Math.cos(endAngle), y2 = CY + R_OUT * Math.sin(endAngle)
        const x3 = CX + R_IN * Math.cos(endAngle), y3 = CY + R_IN * Math.sin(endAngle)
        const x4 = CX + R_IN * Math.cos(startAngle), y4 = CY + R_IN * Math.sin(startAngle)
        const large = angle > Math.PI ? 1 : 0
        const path = `M ${x1} ${y1} A ${R_OUT} ${R_OUT} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${R_IN} ${R_IN} 0 ${large} 0 ${x4} ${y4} Z`
        const arc = { path, color: PALETTE[i % PALETTE.length], nome: d.nome, minutes: d.minutes, pct: (d.minutes / total) * 100 }
        startAngle = endAngle
        return arc
    })
    return (
        <div className="flex items-center gap-3">
            <svg viewBox="0 0 160 160" className="w-32 h-32 flex-shrink-0">
                {arcs.map((a, i) => <path key={i} d={a.path} fill={a.color}><title>{`${a.nome}: ${fmtMin(a.minutes)} (${a.pct.toFixed(0)}%)`}</title></path>)}
                <text x={CX} y={CY - 2} textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity="0.6">Totale</text>
                <text x={CX} y={CY + 12} textAnchor="middle" fontSize="11" fontWeight="bold" fill="currentColor">{fmtMin(total)}</text>
            </svg>
            <div className="flex-1 space-y-1 text-[11px]">
                {arcs.map((a, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: a.color }} />
                        <span className="text-theme-text-secondary flex-1 truncate">{a.nome}</span>
                        <span className="text-theme-text-muted whitespace-nowrap">{a.pct.toFixed(0)}%</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

// ─── BOTTOM WIDGETS ──────────────────────────────────────────────────────

function BarsByDayWeek({ data }: { data: { day: string; minutes: number }[] }) {
    return (
        <ChartCard title="Presenze & Ore Lavorate" subtitle="Per giorno">
            {data.length === 0 ? (
                <div className="text-theme-text-muted text-sm py-6 text-center">Nessun dato.</div>
            ) : (
                <div className="flex items-end gap-1 h-32">
                    {data.map(d => {
                        const max = Math.max(...data.map(x => x.minutes), 60)
                        const h = (d.minutes / max) * 100
                        return (
                            <div key={d.day} className="flex-1 flex flex-col items-center justify-end min-w-0" title={`${d.day}: ${fmtMin(d.minutes)}`}>
                                <div className="w-full bg-emerald-500/70 hover:bg-emerald-500 rounded-t transition-colors" style={{ height: `${h}%`, minHeight: '2px' }} />
                                <div className="text-[8px] text-theme-text-muted mt-1 truncate">{d.day.slice(5)}</div>
                            </div>
                        )
                    })}
                </div>
            )}
        </ChartCard>
    )
}

function ObjectiveCard({ oreSettimana, targetSettimana }: { oreSettimana: number; targetSettimana: number }) {
    const pct = targetSettimana > 0 ? Math.min(100, Math.round((oreSettimana / targetSettimana) * 100)) : 0
    return (
        <ChartCard title="Obiettivi vs Risultati" subtitle="Periodo selezionato">
            <div className="flex flex-col items-center justify-center h-32">
                <div className="relative w-24 h-24">
                    <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                        <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="3" />
                        <circle cx="18" cy="18" r="16" fill="none" stroke="#10B981" strokeWidth="3"
                            strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset="25" strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xl font-bold text-theme-text-primary">{pct}%</span>
                    </div>
                </div>
                <div className="mt-2 text-xs text-theme-text-muted text-center">
                    {oreSettimana}h / {targetSettimana}h target
                </div>
            </div>
        </ChartCard>
    )
}

function exportCsv(
    operatori: Operatore[],
    byOp: { id: string; nome: string; minutes: number }[],
    days: string[],
    byDay: { day: string; minutes: number }[],
) {
    const headers = ['Operatore', 'Ruolo', 'Email', 'Ore Totali', 'Minuti Totali', 'Giornate Attive']
    const rows: string[][] = operatori.map(op => {
        const min = byOp.find(x => x.id === op.id)?.minutes || 0
        const giornate = days.filter(d => {
            // proxy: la riga ha minuti se compare in byDay con somma > 0; per accuratezza usare RPC per giorno
            return byDay.find(x => x.day === d && x.minutes > 0)
        }).length
        return [
            `${op.nome} ${op.cognome || ''}`.trim(),
            op.ruolo || '',
            op.email,
            `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`,
            String(min),
            String(giornate),
        ]
    })
    const csv = [headers, ...rows]
        .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `operatori_${days[0] || 'export'}_${days[days.length - 1] || ''}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function CostiPersonale({ orePeriodoMin, operatoriCount }: { orePeriodoMin: number; operatoriCount: number }) {
    // Stima a 15€/h media — la direzione potra' personalizzare in futuro
    const COSTO_ORARIO = 15
    const ore = orePeriodoMin / 60
    const costo = ore * COSTO_ORARIO
    const costoMedioOp = operatoriCount > 0 ? costo / operatoriCount : 0
    return (
        <ChartCard title="Costi del Personale" subtitle="Stima @ 15€/h">
            <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-theme-text-muted">Costo Totale</span><span className="font-bold text-theme-text-primary">{eur(costo)}</span></div>
                <div className="flex justify-between"><span className="text-theme-text-muted">Ore Totali</span><span className="font-mono text-theme-text-primary">{ore.toFixed(1)}h</span></div>
                <div className="flex justify-between"><span className="text-theme-text-muted">Costo Medio/Op.</span><span className="text-theme-text-primary">{eur(costoMedioOp)}</span></div>
                <div className="flex justify-between"><span className="text-theme-text-muted">Operatori</span><span className="text-theme-text-primary">{operatoriCount}</span></div>
                <p className="text-[10px] text-theme-text-muted pt-2 border-t border-theme-border">Stima basata su tariffa media. Costi reali in busta paga differiscono.</p>
            </div>
        </ChartCard>
    )
}
