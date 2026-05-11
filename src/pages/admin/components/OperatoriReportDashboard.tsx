import React, { useEffect, useState, useCallback, useMemo } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { useAdminRole } from '../../../hooks/useAdminRole'
import { MyDayEditorModal } from './RilevazioneOrariTab'

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

// Avatar tile — uploaded image if present, else initials on a
// deterministic color tile (same person → same color).
const AVATAR_TONES = ['bg-emerald-600', 'bg-blue-600', 'bg-amber-600', 'bg-rose-600', 'bg-violet-600', 'bg-cyan-600', 'bg-fuchsia-600', 'bg-orange-600']
function avatarTone(seed: string): string {
    let h = 0
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
    return AVATAR_TONES[h % AVATAR_TONES.length]
}
async function uploadOperatoreAvatar(operatorId: string, file: File): Promise<string | null> {
    if (!file.type.startsWith('image/')) {
        toast.error('Carica un\'immagine (jpg, png, webp).')
        return null
    }
    if (file.size > 2 * 1024 * 1024) {
        toast.error('File troppo grande (max 2 MB).')
        return null
    }
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${operatorId}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
        .from('operator-avatars')
        .upload(path, file, { upsert: true, contentType: file.type })
    if (upErr) {
        toast.error('Upload fallito: ' + upErr.message)
        return null
    }
    const { data: pub } = supabase.storage.from('operator-avatars').getPublicUrl(path)
    const url = pub.publicUrl
    const { error: dbErr } = await supabase.from('operatori_persone').update({ avatar_url: url }).eq('id', operatorId)
    if (dbErr) {
        toast.error('Salvataggio URL avatar fallito: ' + dbErr.message)
        return null
    }
    toast.success('Foto profilo aggiornata')
    return url
}

function OperatoreAvatar({ op, size = 32 }: { op: { nome?: string | null; cognome?: string | null; email?: string | null; avatar_url?: string | null }; size?: number }) {
    const initials = `${(op.nome || '').charAt(0)}${(op.cognome || '').charAt(0)}`.toUpperCase() || (op.email || '?').charAt(0).toUpperCase()
    const tone = avatarTone(op.email || op.nome || op.cognome || '?')
    const cls = `inline-flex items-center justify-center rounded-full text-white font-semibold flex-shrink-0 overflow-hidden`
    const style = { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px` }
    if (op.avatar_url) {
        return (
            <span className={`${cls} bg-theme-bg-tertiary border border-theme-border`} style={style}>
                <img src={op.avatar_url} alt="" className="w-full h-full object-cover" />
            </span>
        )
    }
    return <span className={`${cls} ${tone}`} style={style}>{initials}</span>
}

interface Operatore {
    id: string
    user_id: string | null
    nome: string
    cognome: string | null
    email: string
    ruolo: string | null
    ore_target_giornaliere: number
    avatar_url: string | null
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

type Range = 'oggi' | '7gg' | '30gg' | 'mese' | 'custom'

/**
 * Dashboard "Report Operatori & Collaboratori" — la vista ricca con
 * KPI + grafici + timesheet del giorno + widgets in basso.
 *
 * Privacy: Valerio/Ilenia (direzione) vedono il team intero; gli altri
 * admin vedono SOLO i propri dati e i grafici/Top sono nascosti.
 */
export default function OperatoriReportDashboard() {
    const { adminName, adminEmail } = useAdminRole()
    // Direzione (Valerio, Ilenia) + ophe (developer/manutentrice) hanno
    // accesso completo al report di TUTTI gli operatori, ai KPI di
    // fatturato, e ai dettagli per operatore.
    const isDirezione = ((adminName || '') + ' ' + (adminEmail || '')).toLowerCase().match(/valerio|ilenia|ophe@dr7\.app|ophelie/) != null

    const [range, setRange] = useState<Range>('mese')
    const [today] = useState(toRomeDate(new Date()))
    const [dataDay, setDataDay] = useState<string>(toRomeDate(new Date()))
    // Date custom — usate solo quando range === 'custom'. Default: ultimo
    // mese cosi' se l'utente clicca "Personalizzato" parte da uno stato
    // sensato senza dover compilare entrambe le date.
    const [customFrom, setCustomFrom] = useState<string>(() => {
        const d = new Date(); d.setDate(d.getDate() - 29)
        return toRomeDate(d)
    })
    const [customTo, setCustomTo] = useState<string>(() => toRomeDate(new Date()))

    const [operatori, setOperatori] = useState<Operatore[]>([])
    const [me, setMe] = useState<Operatore | null>(null)
    const [dailyRows, setDailyRows] = useState<DayRow[]>([])
    const [periodMinutesByDay, setPeriodMinutesByDay] = useState<{ day: string; minutes: number }[]>([])
    const [periodMinutesByOp, setPeriodMinutesByOp] = useState<{ id: string; nome: string; minutes: number }[]>([])
    const [bookingsCount, setBookingsCount] = useState({ rentals: 0, washes: 0, fatture: 0, totFatture: 0 })
    const [loading, setLoading] = useState(true)
    const [editingDay, setEditingDay] = useState<string | null>(null)
    // Expand-row: click on any operator name to see the FULL daily
    // breakdown — every pause window, timeline, KPI cards — same level
    // of detail as RilevazioneOrariTab.
    const [expandedOpId, setExpandedOpId] = useState<string | null>(null)

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
        } else if (range === 'custom') {
            // Le date custom arrivano in formato 'YYYY-MM-DD' (Europe/Rome).
            // Costruiamo Date in local time e poi normalizziamo agli estremi
            // della giornata in zona Roma (start 00:00, end 23:59) cosi' la
            // query include entrambi i giorni di confine.
            const [fy, fm, fd] = customFrom.split('-').map(Number)
            const [ty, tm, td] = customTo.split('-').map(Number)
            if (fy && fm && fd) start.setFullYear(fy, fm - 1, fd)
            if (ty && tm && td) end.setFullYear(ty, tm - 1, td)
            start.setHours(0, 0, 0, 0)
            end.setHours(23, 59, 59, 999)
        }
        const days: string[] = []
        const cur = new Date(start)
        while (toRomeDate(cur) <= toRomeDate(end)) {
            days.push(toRomeDate(cur))
            cur.setDate(cur.getDate() + 1)
        }
        return { start, end, days }
    }, [range, customFrom, customTo])

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            const myEmail = (user?.email || '').toLowerCase()

            // 1) operatori — direzione vede tutti, gli altri solo se stessi
            let opQuery = supabase
                .from('operatori_persone')
                .select('id, user_id, nome, cognome, email, ruolo, ore_target_giornaliere, avatar_url')
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
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex gap-1 bg-theme-bg-tertiary rounded p-1 text-xs">
                        {(['oggi', '7gg', '30gg', 'mese', 'custom'] as Range[]).map(r => (
                            <button key={r} onClick={() => setRange(r)}
                                className={`px-3 py-1 rounded ${range === r ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:text-theme-text-primary'}`}>
                                {r === 'oggi' ? 'Oggi' : r === '7gg' ? '7 giorni' : r === '30gg' ? '30 giorni' : r === 'mese' ? 'Mese corrente' : 'Personalizzato'}
                            </button>
                        ))}
                    </div>
                    {range === 'custom' && (
                        <div className="flex items-center gap-1.5 text-xs text-theme-text-secondary">
                            <label className="flex items-center gap-1">
                                <span className="text-theme-text-muted">Da</span>
                                <input
                                    type="date"
                                    value={customFrom}
                                    max={customTo}
                                    onChange={e => setCustomFrom(e.target.value)}
                                    className="px-2 py-1 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-xs"
                                />
                            </label>
                            <label className="flex items-center gap-1">
                                <span className="text-theme-text-muted">A</span>
                                <input
                                    type="date"
                                    value={customTo}
                                    min={customFrom}
                                    max={today}
                                    onChange={e => setCustomTo(e.target.value)}
                                    className="px-2 py-1 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-xs"
                                />
                            </label>
                        </div>
                    )}
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
                                <th className="text-right py-2 font-medium"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-theme-border/50">
                            {dailyRows.length === 0 && (
                                <tr><td colSpan={11} className="text-center py-6 text-theme-text-muted">Nessun operatore.</td></tr>
                            )}
                            {dailyRows.map(r => {
                                const isMine = r.operatore.id === me?.id
                                const target = Math.round((r.operatore.ore_target_giornaliere || 8) * 60)
                                const straord = Math.max(0, r.minuti_lavorati - target)
                                const deficit = Math.max(0, target - r.minuti_lavorati)
                                const isExpanded = expandedOpId === r.operatore.id
                                // Pair pausa starts with ends into pause windows.
                                const pauseWindows = r.pausa_inizi.map((start, i) => {
                                    const end = r.pausa_fini[i] || null
                                    let durMin = 0
                                    if (end) durMin = Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60000))
                                    else if (r.stato === 'pausa') durMin = Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 60000))
                                    return { start, end, durMin, idx: i + 1 }
                                })
                                return (
                                    <React.Fragment key={r.operatore.id}>
                                    <tr
                                        className={`${isMine ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''} ${isExpanded ? 'bg-theme-bg-tertiary/40' : ''} cursor-pointer hover:bg-theme-bg-tertiary/30`}
                                        onClick={() => setExpandedOpId(isExpanded ? null : r.operatore.id)}
                                    >
                                        <td className="py-2 font-medium text-theme-text-primary">
                                            <div className="flex items-center gap-2">
                                                <span className={`inline-block transition-transform ${isExpanded ? 'rotate-90' : ''} text-theme-text-muted text-xs`}>▶</span>
                                                <OperatoreAvatar op={r.operatore} size={32} />
                                                <span>
                                                    {r.operatore.nome} {r.operatore.cognome || ''}
                                                    {isMine && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-dr7-gold text-black">tu</span>}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="py-2 text-theme-text-secondary text-xs">{r.operatore.ruolo || '—'}</td>
                                        <td className="py-2 font-mono text-xs">{fmtTime(r.entrata)}</td>
                                        <td className="py-2 font-mono text-xs">{r.pausa_inizi.length > 0 ? r.pausa_inizi.map(fmtTime).join(' · ') : '—'}</td>
                                        <td className="py-2 font-mono text-xs">{r.pausa_fini.length > 0 ? r.pausa_fini.map(fmtTime).join(' · ') : '—'}</td>
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
                                        <td className="py-2 text-right">
                                            {isMine && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setEditingDay(dataDay) }}
                                                    className="text-[11px] px-2 py-1 rounded bg-dr7-gold text-black hover:opacity-90 font-medium"
                                                    title="Modifica i miei orari per questa giornata"
                                                >
                                                    Modifica
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                    {isExpanded && (
                                        <tr className="bg-theme-bg-tertiary/20 border-b-2 border-dr7-gold/30">
                                            <td colSpan={11} className="px-4 py-4">
                                                <OperatorDailyDetail
                                                    row={r}
                                                    pauseWindows={pauseWindows}
                                                    target={target}
                                                    straord={straord}
                                                    deficit={deficit}
                                                />
                                            </td>
                                        </tr>
                                    )}
                                    </React.Fragment>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {editingDay && me && (
                <MyDayEditorModal
                    operatore={{ id: me.id, nome: me.nome, cognome: me.cognome }}
                    data={editingDay}
                    onClose={() => setEditingDay(null)}
                    onSaved={() => {
                        setEditingDay(null)
                        // Re-trigger the data load (dashboard listens for this event)
                        window.dispatchEvent(new CustomEvent('timesheet:saved'))
                    }}
                />
            )}

            {/* MINI STATS ROW */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MiniStat label="Presenti" value={String(presenti)} tone="emerald" />
                <MiniStat label="Assenti" value={String(assenti)} tone="muted" />
                <MiniStat label="Ore Lavorate Oggi" value={fmtMin(oreLavorateOggiMin)} sub={`${oreLavorateOggiMin} min`} tone="primary" />
                <MiniStat label="Straordinari Oggi" value={fmtMin(oreStraordOggiMin)} sub={`${oreStraordOggiMin} min`} tone={oreStraordOggiMin > 0 ? 'sky' : 'muted'} />
            </div>

            {/* GESTISCI OPERATORI — solo direzione (Valerio/Ilenia) */}
            {isDirezione && (
                <ManageOperatoriPanel operatori={operatori} onChanged={load} />
            )}

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

// ─── MANAGE OPERATORI (CRUD per direzione) ───────────────────────────────

function ManageOperatoriPanel({ operatori, onChanged }: { operatori: Operatore[]; onChanged: () => void }) {
    const [showAdd, setShowAdd] = useState(false)
    const [busyId, setBusyId] = useState<string | null>(null)

    async function deactivateOperatore(op: Operatore) {
        if (!confirm(`Disattivare ${op.nome} ${op.cognome || ''}?\n\nLa riga viene marcata come non attiva: gli orari storici restano in archivio, ma non potra' piu' registrare nuovi orari.`)) return
        setBusyId(op.id)
        try {
            const { error } = await supabase
                .from('operatori_persone')
                .update({ attivo: false })
                .eq('id', op.id)
            if (error) throw error
            onChanged()
        } catch (err) {
            alert('Errore: ' + (err instanceof Error ? err.message : String(err)))
        } finally {
            setBusyId(null)
        }
    }

    return (
        <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-4">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <h3 className="text-base font-semibold text-theme-text-primary">Gestisci Operatori</h3>
                    <p className="text-[10px] text-theme-text-muted">Solo direzione: aggiungi o disattiva i collaboratori del team.</p>
                </div>
                <button onClick={() => setShowAdd(true)}
                    className="px-3 py-1.5 rounded bg-dr7-gold text-black text-xs font-semibold hover:opacity-90">
                    + Nuovo Operatore
                </button>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="text-theme-text-muted text-xs">
                        <tr className="border-b border-theme-border">
                            <th className="text-left py-2 font-medium">Nome</th>
                            <th className="text-left py-2 font-medium">Email</th>
                            <th className="text-left py-2 font-medium">Ruolo</th>
                            <th className="text-right py-2 font-medium">Target/giorno</th>
                            <th className="text-center py-2 font-medium">Account collegato</th>
                            <th className="text-right py-2 font-medium w-24">Azioni</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-theme-border/50">
                        {operatori.length === 0 && (
                            <tr><td colSpan={6} className="text-center py-6 text-theme-text-muted">Nessun operatore.</td></tr>
                        )}
                        {operatori.map(op => (
                            <tr key={op.id}>
                                <td className="py-2 text-theme-text-primary font-medium">{op.nome} {op.cognome || ''}</td>
                                <td className="py-2 text-theme-text-secondary text-xs font-mono">{op.email}</td>
                                <td className="py-2 text-theme-text-secondary text-xs">{op.ruolo || '—'}</td>
                                <td className="py-2 text-right tabular-nums">{op.ore_target_giornaliere}h</td>
                                <td className="py-2 text-center text-xs">
                                    {op.user_id ? (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Collegato</span>
                                    ) : (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Non collegato</span>
                                    )}
                                </td>
                                <td className="py-2 text-right">
                                    <button onClick={() => deactivateOperatore(op)} disabled={busyId === op.id}
                                        className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                                        title="Disattiva — non elimina lo storico">
                                        {busyId === op.id ? '…' : 'Disattiva'}
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {showAdd && (
                <AddOperatoreInlineModal
                    onClose={() => setShowAdd(false)}
                    onSaved={() => { setShowAdd(false); onChanged() }}
                />
            )}
        </div>
    )
}

function AddOperatoreInlineModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
    const [nome, setNome] = useState('')
    const [cognome, setCognome] = useState('')
    const [email, setEmail] = useState('')
    const [ruolo, setRuolo] = useState('')
    const [oreTarget, setOreTarget] = useState('8')
    const [saving, setSaving] = useState(false)

    async function save() {
        if (!nome.trim() || !email.trim()) {
            alert('Nome e email sono obbligatori')
            return
        }
        setSaving(true)
        try {
            const { error } = await supabase.from('operatori_persone').insert({
                nome: nome.trim(),
                cognome: cognome.trim() || null,
                email: email.trim().toLowerCase(),
                ruolo: ruolo.trim() || null,
                ore_target_giornaliere: parseFloat(oreTarget) || 8,
                attivo: true,
            })
            if (error) throw error
            onSaved()
        } catch (err) {
            alert('Errore: ' + (err instanceof Error ? err.message : String(err)))
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                <h3 className="text-xl font-semibold text-theme-text-primary mb-4">Nuovo Operatore</h3>
                <div className="space-y-3">
                    <Field label="Nome *" value={nome} onChange={setNome} placeholder="Es. Salvatore" />
                    <Field label="Cognome" value={cognome} onChange={setCognome} placeholder="Es. Saja" />
                    <Field label="Email *" value={email} onChange={setEmail} type="email" placeholder="nome@dr7.app" />
                    <Field label="Ruolo" value={ruolo} onChange={setRuolo} placeholder="Es. Receptionist, Operativo" />
                    <Field label="Ore target/giorno" value={oreTarget} onChange={setOreTarget} type="number" />
                </div>
                <p className="text-[10px] text-theme-text-muted mt-3">
                    L'operatore potra' collegare il suo account Supabase Auth automaticamente alla prima apertura di "I miei orari"
                    (match per email).
                </p>
                <div className="flex justify-end gap-2 mt-4">
                    <button onClick={onClose} disabled={saving}
                        className="px-4 py-2 text-sm rounded text-theme-text-secondary hover:bg-theme-bg-tertiary">Annulla</button>
                    <button onClick={save} disabled={saving}
                        className="px-4 py-2 text-sm rounded bg-dr7-gold text-black font-semibold hover:opacity-90 disabled:opacity-50">
                        {saving ? 'Salvataggio…' : 'Crea'}
                    </button>
                </div>
            </div>
        </div>
    )
}

function Field({ label, value, onChange, type = 'text', placeholder }: {
    label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
    return (
        <label className="block">
            <span className="text-xs text-theme-text-secondary">{label}</span>
            <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
                className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary" />
        </label>
    )
}

/**
 * OperatorDailyDetail — full breakdown for ONE operator on the selected
 * day, rendered inside the expanded row of the dashboard's daily table.
 *
 * Mirrors the DailyOperatorDetail inside RilevazioneOrariTab so the
 * "click an operator to see everything" experience is identical from
 * both entry points (Operatori tab vs Rilevazione Orari tab).
 *
 * Shown elements:
 *   - Profile: nome, ruolo, email, target ore/giorno.
 *   - Timeline 00:00 → 24:00 (Roma) with green work segment and amber
 *     pause overlays, hour ticks underneath, hover tooltips per segment.
 *   - Pause list: every pausa #N with start/end/duration; in-progress
 *     pauses (operator currently on break) get an "in corso" marker.
 *   - KPI cards: Entrata, Uscita, Lavorate, Pausa Tot, Straordinari,
 *     Deficit — all to the second.
 *   - Completion bar: % vs target with green/amber/rose tone.
 */
function OperatorDailyDetail({
    row,
    pauseWindows,
    target,
    straord,
    deficit,
}: {
    row: DayRow
    pauseWindows: { start: string; end: string | null; durMin: number; idx: number }[]
    target: number
    straord: number
    deficit: number
}) {
    const op = row.operatore
    const fmtFull = (iso: string | null) => {
        if (!iso) return '—'
        return new Date(iso).toLocaleTimeString('it-IT', {
            timeZone: ROME_TZ,
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        })
    }
    const minOfDay = (iso: string | null): number | null => {
        if (!iso) return null
        const d = new Date(iso)
        if (isNaN(d.getTime())) return null
        const rome = new Date(d.toLocaleString('en-US', { timeZone: ROME_TZ }))
        return rome.getHours() * 60 + rome.getMinutes()
    }
    const TOTAL_MIN = 24 * 60
    const entrataMin = minOfDay(row.entrata)
    const uscitaMin = minOfDay(row.uscita) ?? (row.stato === 'fuori' ? null : TOTAL_MIN)
    const pct = (m: number | null) => m === null ? 0 : (m / TOTAL_MIN) * 100
    const completionPct = target > 0 ? Math.min(100, Math.round((row.minuti_lavorati / target) * 100)) : 0

    return (
        <div className="space-y-4">
            {/* Profile header with avatar + change-photo button */}
            <div className="flex items-start gap-4">
                <div className="relative flex-shrink-0">
                    <OperatoreAvatar op={op} size={72} />
                    <label className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-dr7-gold text-black flex items-center justify-center cursor-pointer hover:opacity-90 shadow-md" title="Cambia foto">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} strokeLinecap="round" d="M3 9a2 2 0 012-2h2.5L9 5h6l1.5 2H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><circle cx="12" cy="13" r="3" strokeWidth={2}/></svg>
                        <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            className="hidden"
                            onChange={async (e) => {
                                const file = e.target.files?.[0]
                                if (!file) return
                                const url = await uploadOperatoreAvatar(op.id, file)
                                if (url) window.location.reload()
                                e.target.value = ''
                            }}
                        />
                    </label>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs flex-1">
                    <div>
                        <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Operatore</div>
                        <div className="text-sm font-semibold text-theme-text-primary">{op.nome} {op.cognome || ''}</div>
                    </div>
                    <div>
                        <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Ruolo</div>
                        <div className="text-sm text-theme-text-primary">{op.ruolo || '—'}</div>
                    </div>
                    <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Email</div>
                        <div className="text-sm text-theme-text-primary truncate" title={op.email}>{op.email || '—'}</div>
                    </div>
                    <div>
                        <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Target ore</div>
                        <div className="text-sm text-theme-text-primary">{op.ore_target_giornaliere}h / giorno</div>
                    </div>
                </div>
            </div>

            {/* Timeline 00–24 */}
            {entrataMin !== null && uscitaMin !== null && (
                <div>
                    <div className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-1">Timeline (00:00 → 24:00, ora di Roma)</div>
                    <div className="relative h-8 bg-theme-bg-tertiary rounded overflow-hidden border border-theme-border">
                        <div
                            className="absolute h-full bg-emerald-500/40 border-l border-r border-emerald-500"
                            style={{ left: `${pct(entrataMin)}%`, width: `${Math.max(0, pct(uscitaMin) - pct(entrataMin))}%` }}
                            title={`Lavoro: ${fmtTime(row.entrata)} → ${fmtTime(row.uscita)}`}
                        />
                        {pauseWindows.map((p) => {
                            const ps = minOfDay(p.start)
                            const pe = p.end ? minOfDay(p.end) : ps
                            if (ps === null || pe === null) return null
                            return (
                                <div
                                    key={p.idx}
                                    className="absolute h-full bg-amber-500/70 border-l border-r border-amber-600"
                                    style={{ left: `${pct(ps)}%`, width: `${Math.max(0.5, pct(pe) - pct(ps))}%` }}
                                    title={`Pausa #${p.idx}: ${fmtTime(p.start)} → ${p.end ? fmtTime(p.end) : 'in corso'} (${p.durMin} min)`}
                                />
                            )
                        })}
                        {Array.from({ length: 13 }).map((_, i) => (
                            <div key={i} className="absolute top-0 bottom-0 border-l border-theme-border/40" style={{ left: `${(i * 2 / 24) * 100}%` }}>
                                <span className="absolute top-full mt-0.5 -translate-x-1/2 text-[9px] text-theme-text-muted">{i * 2}h</span>
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-theme-text-muted mt-4">
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-emerald-500/70" />Lavoro</span>
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-amber-500/70" />Pausa</span>
                    </div>
                </div>
            )}

            {/* Pause list */}
            <div>
                <div className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-2">
                    Pause della giornata ({pauseWindows.length})
                </div>
                {pauseWindows.length === 0 ? (
                    <p className="text-xs text-theme-text-muted italic">Nessuna pausa registrata oggi.</p>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {pauseWindows.map((p) => (
                            <div key={p.idx} className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] uppercase tracking-wider text-amber-400">Pausa #{p.idx}</span>
                                    <span className="text-xs font-semibold text-theme-text-primary tabular-nums">{p.durMin} min</span>
                                </div>
                                <div className="font-mono text-xs text-theme-text-secondary">
                                    {fmtFull(p.start)} → {p.end ? fmtFull(p.end) : <span className="text-amber-400">in corso</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* KPI grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Entrata</div>
                    <div className="font-mono text-sm text-theme-text-primary">{fmtFull(row.entrata)}</div>
                </div>
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Uscita</div>
                    <div className="font-mono text-sm text-theme-text-primary">{fmtFull(row.uscita)}</div>
                </div>
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Lavorate</div>
                    <div className="font-semibold text-emerald-400">{fmtMin(row.minuti_lavorati)}</div>
                    <div className="text-[10px] text-theme-text-muted">{row.minuti_lavorati} min</div>
                </div>
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Pausa Tot</div>
                    <div className="font-semibold text-amber-400">{fmtMin(row.minuti_pausa)}</div>
                    <div className="text-[10px] text-theme-text-muted">{row.minuti_pausa} min</div>
                </div>
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Straordinari</div>
                    <div className={`font-semibold ${straord > 0 ? 'text-sky-400' : 'text-theme-text-muted'}`}>{fmtMin(straord)}</div>
                </div>
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Deficit</div>
                    <div className={`font-semibold ${deficit > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{deficit > 0 ? fmtMin(deficit) : '—'}</div>
                </div>
            </div>

            {/* Completion bar */}
            <div>
                <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-theme-text-muted mb-1">
                    <span>Completamento target</span>
                    <span className="tabular-nums text-theme-text-primary">{completionPct}% di {fmtMin(target)}</span>
                </div>
                <div className="h-2 bg-theme-bg-tertiary rounded-full overflow-hidden">
                    <div className={`h-full transition-all ${completionPct >= 100 ? 'bg-emerald-500' : completionPct >= 75 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${completionPct}%` }} />
                </div>
            </div>
        </div>
    )
}
