import { useEffect, useState, useMemo, useCallback } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { useAdminRole } from '../../../hooks/useAdminRole'
import Button from './Button'

interface Operatore {
    id: string
    user_id: string | null
    nome: string
    cognome: string | null
    email: string
    ruolo: string | null
    ore_target_giornaliere: number
    attivo: boolean
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

const ROME_TZ = 'Europe/Rome'
const MS_PER_DAY = 86400000

function toRomeDate(d: Date): string {
    return d.toLocaleDateString('en-CA', { timeZone: ROME_TZ })
}
function fmtTime(iso: string | null): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleTimeString('it-IT', { timeZone: ROME_TZ, hour: '2-digit', minute: '2-digit' })
}
function fmtMin(min: number): string {
    if (min === 0) return '—'
    const h = Math.floor(min / 60)
    const m = min % 60
    return `${h}h ${String(m).padStart(2, '0')}m`
}
function fmtMinShort(min: number): string {
    if (min === 0) return '—'
    return `${min} min`
}

type ViewMode = 'giornaliera' | 'settimanale' | 'mensile'

/**
 * Rilevazione Orari — admin tab.
 *
 * Logic:
 * - Admin logs in once (existing admin auth).
 * - The currently-logged-in user is identified as an operatore via
 *   operatori_persone.user_id = auth.uid().
 * - At the top: a self clock-in widget — only the current user can clock
 *   in / out / break. Buttons reflect their live state.
 * - Below: team table — all operators visible, but RLS allows writes only
 *   on own rows. Other rows are read-only.
 */
export default function RilevazioneOrariTab() {
    const { adminName, adminEmail } = useAdminRole()
    // Solo Valerio e Ilenia vedono tutti i report. Tutti gli altri admin
    // (incluso Ophe) vedono solo i propri orari.
    const adminTokens = ((adminName || '') + ' ' + (adminEmail || '')).toLowerCase()
    const isValerioOrIlenia = adminTokens.includes('valerio') || adminTokens.includes('ilenia')

    const [me, setMe] = useState<Operatore | null>(null)
    const [view, setView] = useState<ViewMode>('giornaliera')
    const [refDate, setRefDate] = useState(new Date())
    const [loading, setLoading] = useState(true)
    const [showAddOp, setShowAddOp] = useState(false)
    const [editMyDay, setEditMyDay] = useState(false)
    const [, setNow] = useState(new Date())

    const [dailyRows, setDailyRows] = useState<DayRow[]>([])
    const [periodRows, setPeriodRows] = useState<{ operatore: Operatore; daysData: Map<string, number> }[]>([])

    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 30000)
        return () => clearInterval(t)
    }, [])

    const periodRange = useMemo(() => {
        if (view === 'giornaliera') {
            const d = toRomeDate(refDate)
            return { start: d, end: d, days: [d] }
        }
        if (view === 'settimanale') {
            const d = new Date(refDate)
            const day = d.getDay() || 7
            d.setDate(d.getDate() - day + 1)
            const days: string[] = []
            for (let i = 0; i < 7; i++) {
                days.push(toRomeDate(new Date(d.getTime() + i * MS_PER_DAY)))
            }
            return { start: days[0], end: days[6], days }
        }
        const y = refDate.getFullYear()
        const m = refDate.getMonth()
        const first = new Date(y, m, 1)
        const last = new Date(y, m + 1, 0)
        const days: string[] = []
        for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
            days.push(toRomeDate(new Date(d)))
        }
        return { start: days[0], end: days[days.length - 1], days }
    }, [view, refDate])

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()

            let opList: Operatore[] = []

            if (isValerioOrIlenia) {
                // Direzione: vede TUTTI gli operatori
                const { data: ops } = await supabase
                    .from('operatori_persone')
                    .select('id, user_id, nome, cognome, email, ruolo, ore_target_giornaliere, attivo')
                    .eq('attivo', true)
                    .order('cognome', { ascending: true })
                opList = (ops || []) as Operatore[]
            } else if (user) {
                const { data: byId } = await supabase
                    .from('operatori_persone')
                    .select('id, user_id, nome, cognome, email, ruolo, ore_target_giornaliere, attivo')
                    .eq('attivo', true)
                    .eq('user_id', user.id)
                opList = (byId || []) as Operatore[]
                if (opList.length === 0 && user.email) {
                    const { data: byEmail } = await supabase
                        .from('operatori_persone')
                        .select('id, user_id, nome, cognome, email, ruolo, ore_target_giornaliere, attivo')
                        .eq('attivo', true)
                        .ilike('email', user.email)
                    opList = (byEmail || []) as Operatore[]
                    const linkable = opList.find(o => !o.user_id)
                    if (linkable) {
                        await supabase.from('operatori_persone').update({ user_id: user.id }).eq('id', linkable.id)
                    }
                }
                // auto-create se non esiste (prova admins.nome, fallback email-local)
                if (opList.length === 0 && user.email) {
                    let fullName = ''
                    try {
                        const { data: adminRow } = await supabase
                            .from('admins')
                            .select('nome')
                            .ilike('email', user.email)
                            .maybeSingle()
                        fullName = (adminRow?.nome || '').trim()
                    } catch { /* admins RLS-blocked: ignoro */ }

                    const local = user.email.split('@')[0]
                    const fallback = local.charAt(0).toUpperCase() + local.slice(1).toLowerCase()
                    const [nome, ...rest] = (fullName || fallback).split(/\s+/)
                    const cognome = rest.join(' ') || null

                    const { data: created } = await supabase
                        .from('operatori_persone')
                        .insert({
                            nome: nome || fallback,
                            cognome,
                            email: user.email.toLowerCase(),
                            user_id: user.id,
                            ore_target_giornaliere: 8,
                            attivo: true,
                        })
                        .select('id, user_id, nome, cognome, email, ruolo, ore_target_giornaliere, attivo')
                        .single()
                    if (created) opList = [created as Operatore]
                }
            }

            const myRow = user
                ? (opList.find(o => o.user_id === user.id)
                    || (user.email ? opList.find(o => (o.email || '').toLowerCase() === user.email!.toLowerCase()) : null)
                    || null)
                : null
            setMe(myRow)

            if (view === 'giornaliera') {
                const d = periodRange.start
                const { data: entries } = await supabase
                    .from('timesheet_entries')
                    .select('operatore_id, tipo, timestamp')
                    .eq('data', d)
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
                    let minuti = 0
                    let pausaMin = 0
                    if (data) {
                        const { data: m } = await supabase.rpc('operatore_minuti_lavorati', { p_operatore_id: op.id, p_data: d })
                        minuti = Number(m) || 0
                        for (let i = 0; i < Math.min(data.pi.length, data.pf.length); i++) {
                            pausaMin += Math.floor((new Date(data.pf[i]).getTime() - new Date(data.pi[i]).getTime()) / 60000)
                        }
                    }
                    let stato: DayRow['stato'] = 'fuori'
                    if (data?.lastTipo === 'entrata' || data?.lastTipo === 'pausa_fine') stato = 'lavoro'
                    else if (data?.lastTipo === 'pausa_inizio') stato = 'pausa'
                    else if (data?.lastTipo === 'uscita') stato = 'finito'
                    rows.push({
                        operatore: op,
                        entrata: data?.entrata || null,
                        uscita: data?.uscita || null,
                        pausa_inizi: data?.pi || [],
                        pausa_fini: data?.pf || [],
                        minuti_lavorati: minuti,
                        minuti_pausa: pausaMin,
                        stato,
                    })
                }
                setDailyRows(rows)
            } else {
                const rows: { operatore: Operatore; daysData: Map<string, number> }[] = []
                for (const op of opList) {
                    const map = new Map<string, number>()
                    for (const d of periodRange.days) {
                        const { data: m } = await supabase.rpc('operatore_minuti_lavorati', { p_operatore_id: op.id, p_data: d })
                        const min = Number(m) || 0
                        if (min > 0) map.set(d, min)
                    }
                    rows.push({ operatore: op, daysData: map })
                }
                setPeriodRows(rows)
            }
        } catch (err) {
            console.error('[rilevazione-orari] load error', err)
        } finally {
            setLoading(false)
        }
    }, [view, periodRange.start, periodRange.days])

    useEffect(() => { load() }, [load])

    const myRow = dailyRows.find(r => r.operatore.id === me?.id) || null
    const myStato: DayRow['stato'] = myRow?.stato || 'fuori'

    function downloadCsv() {
        if (view === 'giornaliera') {
            const headers = ['Operatore', 'Ruolo', 'Stato', 'Entrata', 'Uscita Pausa', 'Rientro Pausa', 'Uscita', 'Pause #', 'Ore Lavorate', 'Pausa Tot']
            const rows = dailyRows.map(r => [
                `${r.operatore.nome} ${r.operatore.cognome || ''}`.trim(),
                r.operatore.ruolo || '',
                r.stato,
                fmtTime(r.entrata),
                fmtTime(r.pausa_inizi[0] || null),
                fmtTime(r.pausa_fini[0] || null),
                fmtTime(r.uscita),
                String(r.pausa_inizi.length),
                fmtMin(r.minuti_lavorati),
                fmtMin(r.minuti_pausa),
            ])
            exportCsv(`orari_${periodRange.start}.csv`, headers, rows)
        } else {
            const headers = ['Operatore', 'Ruolo', 'Target/giorno', ...periodRange.days, 'Totale ore', 'Saldo']
            const rows = periodRows.map(r => {
                const total = Array.from(r.daysData.values()).reduce((s, n) => s + n, 0)
                const targetTotal = Math.round(r.operatore.ore_target_giornaliere * 60) * periodRange.days.length
                const saldo = total - targetTotal
                return [
                    `${r.operatore.nome} ${r.operatore.cognome || ''}`.trim(),
                    r.operatore.ruolo || '',
                    String(r.operatore.ore_target_giornaliere),
                    ...periodRange.days.map(d => fmtMin(r.daysData.get(d) || 0)),
                    fmtMin(total),
                    (saldo >= 0 ? '+' : '-') + fmtMin(Math.abs(saldo)),
                ]
            })
            exportCsv(`orari_${view}_${periodRange.start}_${periodRange.end}.csv`, headers, rows)
        }
    }

    function shiftRef(delta: number) {
        const d = new Date(refDate)
        if (view === 'giornaliera') d.setDate(d.getDate() + delta)
        else if (view === 'settimanale') d.setDate(d.getDate() + 7 * delta)
        else d.setMonth(d.getMonth() + delta)
        setRefDate(d)
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-semibold text-theme-text-primary">Rilevazione Orari</h2>
                    <p className="text-xs text-theme-text-muted">Vedi solo i tuoi orari. Nessun altro può vedere il tuo report.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setShowAddOp(true)}>+ Operatore</Button>
                    <Button variant="secondary" onClick={downloadCsv}>Scarica CSV</Button>
                </div>
            </div>

            {/* Self profile card — click avatar / button to open the time-entry modal */}
            {me ? (
                <div
                    onClick={() => setEditMyDay(true)}
                    className="bg-gradient-to-br from-amber-50 to-stone-100 dark:from-amber-950/30 dark:to-stone-900/30 rounded-xl border border-amber-300 dark:border-amber-800 p-5 cursor-pointer hover:shadow-md transition"
                    title="Clicca per inserire i tuoi orari"
                >
                    <div className="flex items-center gap-4">
                        <div className="flex-shrink-0 w-14 h-14 rounded-full bg-amber-600 text-white flex items-center justify-center text-xl font-bold">
                            {(me.nome[0] || '?').toUpperCase()}{(me.cognome?.[0] || '').toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-theme-text-secondary">I tuoi orari di oggi — clicca per inserire/modificare</p>
                            <p className="text-xl font-bold text-theme-text-primary">{me.nome} {me.cognome || ''}</p>
                            <div className="flex flex-wrap gap-3 mt-1 text-xs text-theme-text-muted">
                                <span>Entrata: <strong className="font-mono text-theme-text-primary">{fmtTime(myRow?.entrata || null)}</strong></span>
                                <span>Pause: <strong className="text-theme-text-primary">{myRow?.pausa_inizi.length || 0}</strong></span>
                                <span>Uscita: <strong className="font-mono text-theme-text-primary">{fmtTime(myRow?.uscita || null)}</strong></span>
                                <span>Ore: <strong className="text-theme-text-primary">{fmtMin(myRow?.minuti_lavorati || 0)}</strong></span>
                            </div>
                        </div>
                        <div className="text-right flex flex-col items-end gap-2">
                            <StatoLabel s={myStato} large />
                            <span className="text-xs text-amber-700 dark:text-amber-300 underline">Inserisci orari →</span>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-4 text-center">
                    <p className="text-sm text-theme-text-muted">Il tuo account non è collegato a nessun operatore. Crea il tuo profilo con "+ Operatore" usando la stessa email del login.</p>
                </div>
            )}

            {/* View toggle + period nav */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-theme-bg-secondary p-3 rounded border border-theme-border">
                <div className="flex gap-1 bg-theme-bg-tertiary rounded p-1">
                    {(['giornaliera', 'settimanale', 'mensile'] as ViewMode[]).map(v => (
                        <button key={v} onClick={() => setView(v)}
                            className={`text-sm px-3 py-1 rounded ${view === v ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:text-theme-text-primary'}`}>
                            {v[0].toUpperCase() + v.slice(1)}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => shiftRef(-1)} className="px-3 py-1 rounded bg-theme-bg-tertiary text-theme-text-primary">←</button>
                    <span className="text-sm text-theme-text-primary font-semibold min-w-[180px] text-center">
                        {view === 'giornaliera' && new Date(periodRange.start).toLocaleDateString('it-IT', { timeZone: ROME_TZ, weekday: 'long', day: 'numeric', month: 'long' })}
                        {view === 'settimanale' && `${periodRange.start} → ${periodRange.end}`}
                        {view === 'mensile' && new Date(periodRange.start).toLocaleDateString('it-IT', { timeZone: ROME_TZ, month: 'long', year: 'numeric' })}
                    </span>
                    <button onClick={() => shiftRef(+1)} className="px-3 py-1 rounded bg-theme-bg-tertiary text-theme-text-primary">→</button>
                    <button onClick={() => setRefDate(new Date())} className="text-xs px-3 py-1 rounded bg-theme-bg-tertiary text-theme-text-secondary">Oggi</button>
                </div>
            </div>

            {loading && <p className="text-theme-text-muted text-sm">Caricamento…</p>}

            {!loading && view === 'giornaliera' && (() => {
                const presentiCount = dailyRows.filter(r => r.stato !== 'fuori').length
                const assentiCount = dailyRows.filter(r => r.stato === 'fuori').length
                const totMinLavorati = dailyRows.reduce((s, r) => s + r.minuti_lavorati, 0)
                const totMinPausa = dailyRows.reduce((s, r) => s + r.minuti_pausa, 0)
                const totStraordinari = dailyRows.reduce((s, r) => {
                    const target = Math.round((r.operatore.ore_target_giornaliere || 8) * 60)
                    return s + Math.max(0, r.minuti_lavorati - target)
                }, 0)
                return <>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
                    <KpiCard label="Presenti" value={String(presentiCount)} tone="emerald" />
                    <KpiCard label="Assenti" value={String(assentiCount)} tone="muted" />
                    <KpiCard label="Ore Lavorate Oggi" value={fmtMin(totMinLavorati)} sub={fmtMinShort(totMinLavorati)} tone="primary" />
                    <KpiCard label="Pausa Totale" value={fmtMin(totMinPausa)} sub={fmtMinShort(totMinPausa)} tone="amber" />
                    <KpiCard label="Straordinari" value={fmtMin(totStraordinari)} sub={fmtMinShort(totStraordinari)} tone={totStraordinari > 0 ? 'sky' : 'muted'} />
                </div>
                <div className="bg-theme-bg-secondary rounded border border-theme-border overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-theme-bg-tertiary text-theme-text-secondary">
                            <tr>
                                <th className="text-left px-3 py-2">Operatore</th>
                                <th className="text-left px-3 py-2">Stato</th>
                                <th className="text-left px-3 py-2">Entrata</th>
                                <th className="text-left px-3 py-2">Pausa Out</th>
                                <th className="text-left px-3 py-2">Pausa In</th>
                                <th className="text-left px-3 py-2">Uscita</th>
                                <th className="text-center px-3 py-2">Pause</th>
                                <th className="text-right px-3 py-2">Ore Lav.</th>
                                <th className="text-right px-3 py-2">Pausa</th>
                                <th className="text-right px-3 py-2">Straord.</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-theme-border">
                            {dailyRows.length === 0 && (
                                <tr><td colSpan={10} className="text-center py-6 text-theme-text-muted">Nessun operatore attivo.</td></tr>
                            )}
                            {dailyRows.map(r => {
                                const isMine = r.operatore.id === me?.id
                                const target = Math.round((r.operatore.ore_target_giornaliere || 8) * 60)
                                const straord = Math.max(0, r.minuti_lavorati - target)
                                return (
                                    <tr key={r.operatore.id} className={isMine ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''}>
                                        <td className="px-3 py-2 text-theme-text-primary font-semibold">
                                            {r.operatore.nome} {r.operatore.cognome || ''}
                                            {isMine && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-dr7-gold text-black">tu</span>}
                                            <div className="text-xs text-theme-text-muted">{r.operatore.ruolo || '—'}</div>
                                        </td>
                                        <td className="px-3 py-2"><StatoLabel s={r.stato} /></td>
                                        <td className="px-3 py-2 font-mono text-xs">{fmtTime(r.entrata)}</td>
                                        <td className="px-3 py-2 font-mono text-xs">{fmtTime(r.pausa_inizi[0] || null)}</td>
                                        <td className="px-3 py-2 font-mono text-xs">{fmtTime(r.pausa_fini[0] || null)}</td>
                                        <td className="px-3 py-2 font-mono text-xs">{fmtTime(r.uscita)}</td>
                                        <td className="px-3 py-2 text-center text-xs">{r.pausa_inizi.length}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            <div className="font-semibold">{fmtMin(r.minuti_lavorati)}</div>
                                            <div className="text-[10px] text-theme-text-muted">{r.minuti_lavorati} min</div>
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            <div className="text-theme-text-muted text-xs">{fmtMin(r.minuti_pausa)}</div>
                                            <div className="text-[10px] text-theme-text-muted">{r.minuti_pausa} min</div>
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            <div className={straord > 0 ? 'text-sky-500 font-semibold' : 'text-theme-text-muted text-xs'}>{fmtMin(straord)}</div>
                                            {straord > 0 && <div className="text-[10px] text-theme-text-muted">{straord} min</div>}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
                </>
            })()}

            {!loading && view !== 'giornaliera' && (() => {
                const totMin = periodRows.reduce((s, r) => s + Array.from(r.daysData.values()).reduce((a, b) => a + b, 0), 0)
                const targetMin = periodRows.reduce((s, r) => s + Math.round((r.operatore.ore_target_giornaliere || 8) * 60) * periodRange.days.length, 0)
                const saldoMin = totMin - targetMin
                const giornateAttive = periodRows.reduce((s, r) => s + Array.from(r.daysData.values()).filter(v => v > 0).length, 0)
                // Trend: minuti totali per giorno (sommati su tutti gli operatori visibili)
                const trendData = periodRange.days.map(d => ({
                    day: d,
                    minutes: periodRows.reduce((s, r) => s + (r.daysData.get(d) || 0), 0),
                }))
                // Top operatori per ore lavorate (utile solo per direzione: Ophe vede una sola riga)
                const topData = [...periodRows]
                    .map(r => ({
                        nome: `${r.operatore.nome} ${r.operatore.cognome || ''}`.trim(),
                        minutes: Array.from(r.daysData.values()).reduce((a, b) => a + b, 0),
                    }))
                    .filter(x => x.minutes > 0)
                    .sort((a, b) => b.minutes - a.minutes)
                    .slice(0, 5)
                // Distribuzione per ruolo
                const ruoloMap = new Map<string, number>()
                for (const r of periodRows) {
                    const min = Array.from(r.daysData.values()).reduce((a, b) => a + b, 0)
                    if (min === 0) continue
                    const k = (r.operatore.ruolo || '—').trim() || '—'
                    ruoloMap.set(k, (ruoloMap.get(k) || 0) + min)
                }
                const ruoloData = Array.from(ruoloMap.entries()).map(([nome, minutes]) => ({ nome, minutes }))
                const showTeamCharts = periodRows.length > 1
                return <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    <KpiCard label="Ore Totali" value={fmtMin(totMin)} sub={fmtMinShort(totMin)} tone="primary" />
                    <KpiCard label="Target Periodo" value={fmtMin(targetMin)} sub={fmtMinShort(targetMin)} tone="muted" />
                    <KpiCard label="Saldo" value={(saldoMin >= 0 ? '+' : '-') + fmtMin(Math.abs(saldoMin))} sub={fmtMinShort(Math.abs(saldoMin))} tone={saldoMin >= 0 ? 'emerald' : 'amber'} />
                    <KpiCard label="Giornate Attive" value={String(giornateAttive)} tone="sky" />
                </div>

                <div className={`grid grid-cols-1 ${showTeamCharts ? 'lg:grid-cols-2' : ''} gap-3 mb-3`}>
                    <ChartCard title="Andamento ore" subtitle="Ore lavorate per giorno nel periodo">
                        <TrendLineChart data={trendData} />
                    </ChartCard>
                    {showTeamCharts && (
                        <ChartCard title="Top operatori" subtitle="Per ore lavorate nel periodo">
                            <TopBarsChart data={topData} />
                        </ChartCard>
                    )}
                </div>

                {showTeamCharts && ruoloData.length > 1 && (
                    <div className="mb-3">
                        <ChartCard title="Distribuzione per ruolo" subtitle="Ore lavorate raggruppate per ruolo">
                            <DonutChart data={ruoloData} />
                        </ChartCard>
                    </div>
                )}
                <div className="bg-theme-bg-secondary rounded border border-theme-border overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-theme-bg-tertiary text-theme-text-secondary">
                            <tr>
                                <th className="text-left px-3 py-2 sticky left-0 bg-theme-bg-tertiary">Operatore</th>
                                {periodRange.days.map(d => (
                                    <th key={d} className="text-center px-2 py-2 text-xs">
                                        {new Date(d).toLocaleDateString('it-IT', { timeZone: ROME_TZ, day: '2-digit', month: '2-digit' })}
                                    </th>
                                ))}
                                <th className="text-right px-3 py-2">Tot</th>
                                <th className="text-right px-3 py-2">Saldo</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-theme-border">
                            {periodRows.map(r => {
                                const total = Array.from(r.daysData.values()).reduce((s, n) => s + n, 0)
                                const targetTotal = Math.round(r.operatore.ore_target_giornaliere * 60) * periodRange.days.length
                                const saldo = total - targetTotal
                                const isMine = r.operatore.id === me?.id
                                return (
                                    <tr key={r.operatore.id} className={isMine ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''}>
                                        <td className="px-3 py-2 text-theme-text-primary font-semibold sticky left-0 bg-theme-bg-secondary">
                                            {r.operatore.nome} {r.operatore.cognome || ''}
                                            {isMine && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-dr7-gold text-black">tu</span>}
                                        </td>
                                        {periodRange.days.map(d => (
                                            <td key={d} className="px-2 py-2 text-center font-mono text-xs">
                                                {fmtMin(r.daysData.get(d) || 0)}
                                            </td>
                                        ))}
                                        <td className="px-3 py-2 text-right font-bold tabular-nums">{fmtMin(total)}</td>
                                        <td className={`px-3 py-2 text-right font-bold tabular-nums ${saldo >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {(saldo >= 0 ? '+' : '-')}{fmtMin(Math.abs(saldo))}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
                </>
            })()}

            {showAddOp && (
                <AddOperatoreModal onClose={() => setShowAddOp(false)} onSaved={() => { setShowAddOp(false); load(); toast.success('Operatore aggiunto') }} />
            )}

            {editMyDay && me && (
                <MyDayEditorModal
                    operatore={me}
                    data={toRomeDate(refDate)}
                    onClose={() => setEditMyDay(false)}
                    onSaved={() => { setEditMyDay(false); load(); toast.success('Orari aggiornati') }}
                />
            )}
        </div>
    )
}

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
    const W = 600
    const H = 160
    const PAD = 28
    const stepX = (W - PAD * 2) / Math.max(1, data.length - 1)
    const points = data.map((d, i) => {
        const x = PAD + i * stepX
        const y = H - PAD - ((d.minutes / max) * (H - PAD * 2))
        return { x, y, day: d.day, min: d.minutes }
    })
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
    const areaPath = `${path} L ${points[points.length - 1].x} ${H - PAD} L ${points[0].x} ${H - PAD} Z`
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44" role="img" aria-label="Andamento ore">
            <defs>
                <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#19C2D6" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#19C2D6" stopOpacity="0" />
                </linearGradient>
            </defs>
            {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
                const y = H - PAD - t * (H - PAD * 2)
                return <line key={i} x1={PAD} x2={W - PAD} y1={y} y2={y} stroke="currentColor" strokeOpacity="0.08" strokeDasharray="2 3" />
            })}
            <path d={areaPath} fill="url(#trendGrad)" />
            <path d={path} fill="none" stroke="#19C2D6" strokeWidth="2" />
            {points.map((p, i) => (
                <g key={i}>
                    <circle cx={p.x} cy={p.y} r={3} fill="#19C2D6" />
                    <title>{`${p.day}: ${fmtMin(p.min)} (${p.min} min)`}</title>
                </g>
            ))}
            {points.map((p, i) => i % Math.ceil(points.length / 8) === 0 ? (
                <text key={`l-${i}`} x={p.x} y={H - 8} fontSize="9" textAnchor="middle" fill="currentColor" fillOpacity="0.5">
                    {p.day.slice(5)}
                </text>
            ) : null)}
            <text x={PAD - 4} y={PAD} fontSize="9" textAnchor="end" fill="currentColor" fillOpacity="0.5">{fmtMin(max)}</text>
            <text x={PAD - 4} y={H - PAD + 3} fontSize="9" textAnchor="end" fill="currentColor" fillOpacity="0.5">0</text>
        </svg>
    )
}

function TopBarsChart({ data }: { data: { nome: string; minutes: number }[] }) {
    if (data.length === 0) return <div className="text-theme-text-muted text-sm py-6 text-center">Nessun dato.</div>
    const max = Math.max(...data.map(d => d.minutes), 1)
    return (
        <div className="space-y-2">
            {data.map(d => {
                const pct = (d.minutes / max) * 100
                return (
                    <div key={d.nome}>
                        <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-theme-text-secondary truncate pr-2">{d.nome}</span>
                            <span className="text-theme-text-muted whitespace-nowrap">{fmtMin(d.minutes)} <span className="opacity-60">· {d.minutes} min</span></span>
                        </div>
                        <div className="h-2 bg-theme-bg-tertiary rounded-full overflow-hidden">
                            <div className="h-full bg-dr7-gold transition-all" style={{ width: `${pct}%` }} />
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
    const R_OUTER = 70, R_INNER = 42, CX = 90, CY = 90
    let startAngle = -Math.PI / 2
    const arcs = data.map((d, i) => {
        const angle = (d.minutes / total) * Math.PI * 2
        const endAngle = startAngle + angle
        const x1 = CX + R_OUTER * Math.cos(startAngle), y1 = CY + R_OUTER * Math.sin(startAngle)
        const x2 = CX + R_OUTER * Math.cos(endAngle), y2 = CY + R_OUTER * Math.sin(endAngle)
        const x3 = CX + R_INNER * Math.cos(endAngle), y3 = CY + R_INNER * Math.sin(endAngle)
        const x4 = CX + R_INNER * Math.cos(startAngle), y4 = CY + R_INNER * Math.sin(startAngle)
        const large = angle > Math.PI ? 1 : 0
        const path = `M ${x1} ${y1} A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${R_INNER} ${R_INNER} 0 ${large} 0 ${x4} ${y4} Z`
        const arc = { path, color: PALETTE[i % PALETTE.length], nome: d.nome, minutes: d.minutes, pct: (d.minutes / total) * 100 }
        startAngle = endAngle
        return arc
    })
    return (
        <div className="flex items-center gap-4">
            <svg viewBox="0 0 180 180" className="w-40 h-40 flex-shrink-0">
                {arcs.map((a, i) => (
                    <path key={i} d={a.path} fill={a.color}>
                        <title>{`${a.nome}: ${fmtMin(a.minutes)} (${a.pct.toFixed(0)}%)`}</title>
                    </path>
                ))}
                <text x={CX} y={CY - 4} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.6">Totale</text>
                <text x={CX} y={CY + 12} textAnchor="middle" fontSize="13" fontWeight="bold" fill="currentColor">{fmtMin(total)}</text>
            </svg>
            <div className="flex-1 space-y-1.5 text-xs">
                {arcs.map((a, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: a.color }} />
                        <span className="text-theme-text-secondary flex-1 truncate">{a.nome}</span>
                        <span className="text-theme-text-muted whitespace-nowrap">{fmtMin(a.minutes)} <span className="opacity-60">({a.pct.toFixed(0)}%)</span></span>
                    </div>
                ))}
            </div>
        </div>
    )
}

type KpiTone = 'emerald' | 'amber' | 'sky' | 'primary' | 'muted'
function KpiCard({ label, value, sub, tone = 'primary' }: { label: string; value: string; sub?: string; tone?: KpiTone }) {
    const ring = {
        emerald: 'border-emerald-300 dark:border-emerald-800',
        amber: 'border-amber-300 dark:border-amber-800',
        sky: 'border-sky-300 dark:border-sky-800',
        primary: 'border-theme-border',
        muted: 'border-theme-border',
    }[tone]
    const valueColor = {
        emerald: 'text-emerald-500',
        amber: 'text-amber-500',
        sky: 'text-sky-500',
        primary: 'text-theme-text-primary',
        muted: 'text-theme-text-muted',
    }[tone]
    return (
        <div className={`bg-theme-bg-secondary rounded-lg border ${ring} p-3 text-center`}>
            <div className="text-[10px] text-theme-text-muted uppercase tracking-wider">{label}</div>
            <div className={`text-base font-bold mt-1 ${valueColor}`}>{value}</div>
            {sub && <div className="text-[10px] text-theme-text-muted mt-0.5">{sub}</div>}
        </div>
    )
}

function StatoLabel({ s, large }: { s: DayRow['stato']; large?: boolean }) {
    const map = {
        fuori: { label: 'Fuori', cls: 'bg-theme-bg-tertiary text-theme-text-muted' },
        lavoro: { label: 'Lavoro', cls: 'bg-emerald-900 text-emerald-200' },
        pausa: { label: 'Pausa', cls: 'bg-amber-900 text-amber-200' },
        finito: { label: 'Uscito', cls: 'bg-blue-900 text-blue-200' },
    }
    const m = map[s]
    return <span className={`px-2 py-0.5 rounded ${large ? 'text-sm font-semibold' : 'text-xs'} ${m.cls}`}>{m.label}</span>
}

function AddOperatoreModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
    const [nome, setNome] = useState('')
    const [cognome, setCognome] = useState('')
    const [email, setEmail] = useState('')
    const [ruolo, setRuolo] = useState('')
    const [oreTarget, setOreTarget] = useState('8')
    const [linkSelf, setLinkSelf] = useState(true)
    const [saving, setSaving] = useState(false)

    async function handleSave() {
        if (!nome.trim() || !email.trim()) { alert('Nome e email obbligatori'); return }
        setSaving(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            const { error } = await supabase.from('operatori_persone').insert({
                nome: nome.trim(),
                cognome: cognome.trim() || null,
                email: email.trim().toLowerCase(),
                ruolo: ruolo.trim() || null,
                ore_target_giornaliere: parseFloat(oreTarget) || 8,
                user_id: linkSelf ? user?.id || null : null,
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                <h3 className="text-xl font-semibold text-theme-text-primary mb-4">Nuovo Operatore</h3>
                <div className="space-y-3">
                    <Field label="Nome *" value={nome} onChange={setNome} />
                    <Field label="Cognome" value={cognome} onChange={setCognome} />
                    <Field label="Email *" value={email} onChange={setEmail} type="email" />
                    <Field label="Ruolo" value={ruolo} onChange={setRuolo} placeholder="Es: Receptionist, Operativo" />
                    <Field label="Ore target/giorno" value={oreTarget} onChange={setOreTarget} type="number" />
                    <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                        <input type="checkbox" checked={linkSelf} onChange={e => setLinkSelf(e.target.checked)} />
                        Sono io (collega all'account login attualmente connesso)
                    </label>
                </div>
                <p className="text-xs text-theme-text-muted mt-3">
                    Se questo operatore è qualcun altro, lascia il flag spento. L'admin dovrà poi collegare l'user_id Supabase Auth (UPDATE operatori_persone SET user_id = ... WHERE email = ...).
                </p>
                <div className="flex justify-end gap-2 mt-4">
                    <Button variant="secondary" onClick={onClose}>Annulla</Button>
                    <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvataggio…' : 'Crea'}</Button>
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

interface BreakSlot { id?: string; pausa_inizio?: string; pausa_fine?: string }

/**
 * Modal — l'utente connesso edita i propri orari del giorno.
 * Carica gli eventi esistenti, permette di modificare gli orari (HH:MM),
 * aggiungere/rimuovere pause, salvare.
 */
export function MyDayEditorModal({ operatore, data, onClose, onSaved }: {
    operatore: { id: string; nome: string; cognome: string | null }
    data: string  // YYYY-MM-DD
    onClose: () => void
    onSaved: () => void
}) {
    const [entrata, setEntrata] = useState('')
    const [uscita, setUscita] = useState('')
    const [pause, setPause] = useState<BreakSlot[]>([])
    const [note, setNote] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        ;(async () => {
            const { data: entries } = await supabase
                .from('timesheet_entries')
                .select('id, tipo, timestamp')
                .eq('operatore_id', operatore.id)
                .eq('data', data)
                .order('timestamp', { ascending: true })
            const list = (entries || []) as { id: string; tipo: string; timestamp: string }[]

            const isoToHHMM = (iso: string) => new Date(iso).toLocaleTimeString('it-IT', { timeZone: ROME_TZ, hour: '2-digit', minute: '2-digit' })

            const e = list.find(x => x.tipo === 'entrata')
            if (e) setEntrata(isoToHHMM(e.timestamp))
            const u = [...list].reverse().find(x => x.tipo === 'uscita')
            if (u) setUscita(isoToHHMM(u.timestamp))

            const pInizi = list.filter(x => x.tipo === 'pausa_inizio')
            const pFini = list.filter(x => x.tipo === 'pausa_fine')
            const slots: BreakSlot[] = []
            for (let i = 0; i < Math.max(pInizi.length, pFini.length); i++) {
                slots.push({
                    pausa_inizio: pInizi[i] ? isoToHHMM(pInizi[i].timestamp) : '',
                    pausa_fine: pFini[i] ? isoToHHMM(pFini[i].timestamp) : '',
                })
            }
            if (slots.length === 0) slots.push({ pausa_inizio: '', pausa_fine: '' })
            setPause(slots)

            // Day note
            const { data: noteRow } = await supabase
                .from('timesheet_day_notes')
                .select('nota')
                .eq('operatore_id', operatore.id)
                .eq('data', data)
                .maybeSingle()
            if (noteRow?.nota) setNote(noteRow.nota)

            setLoading(false)
        })()
    }, [operatore.id, data])

    function hhmmToISO(hhmm: string, dateStr: string): string | null {
        if (!/^\d{2}:\d{2}$/.test(hhmm)) return null
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
        const [h, m] = hhmm.split(':').map(Number)
        const [year, month, day] = dateStr.split('-').map(Number)
        const utcGuess = new Date(Date.UTC(year, month - 1, day, h, m, 0))
        const fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: ROME_TZ,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false,
        })
        const parts = Object.fromEntries(fmt.formatToParts(utcGuess).map(p => [p.type, p.value]))
        const romeHour = parts.hour === '24' ? 0 : parseInt(parts.hour, 10)
        const romeAsUTC = Date.UTC(
            parseInt(parts.year, 10),
            parseInt(parts.month, 10) - 1,
            parseInt(parts.day, 10),
            romeHour,
            parseInt(parts.minute, 10),
            parseInt(parts.second, 10),
        )
        const offsetMs = romeAsUTC - utcGuess.getTime()
        return new Date(utcGuess.getTime() - offsetMs).toISOString()
    }

    async function handleSave() {
        setSaving(true)
        try {
            // Cancello tutto e re-inserisco — semplice e atomico per l'utente.
            const { error: delErr } = await supabase
                .from('timesheet_entries')
                .delete()
                .eq('operatore_id', operatore.id)
                .eq('data', data)
            if (delErr) throw delErr

            const inserts: { operatore_id: string; tipo: string; timestamp: string }[] = []
            if (entrata) {
                const ts = hhmmToISO(entrata, data)
                if (ts) inserts.push({ operatore_id: operatore.id, tipo: 'entrata', timestamp: ts })
            }
            for (const p of pause) {
                if (p.pausa_inizio) {
                    const ts = hhmmToISO(p.pausa_inizio, data)
                    if (ts) inserts.push({ operatore_id: operatore.id, tipo: 'pausa_inizio', timestamp: ts })
                }
                if (p.pausa_fine) {
                    const ts = hhmmToISO(p.pausa_fine, data)
                    if (ts) inserts.push({ operatore_id: operatore.id, tipo: 'pausa_fine', timestamp: ts })
                }
            }
            if (uscita) {
                const ts = hhmmToISO(uscita, data)
                if (ts) inserts.push({ operatore_id: operatore.id, tipo: 'uscita', timestamp: ts })
            }
            if (inserts.length > 0) {
                const { error: insErr } = await supabase.from('timesheet_entries').insert(inserts)
                if (insErr) throw insErr
            }

            // Note del giorno (upsert)
            if (note.trim()) {
                const { error: noteErr } = await supabase
                    .from('timesheet_day_notes')
                    .upsert({ operatore_id: operatore.id, data, nota: note.trim() }, { onConflict: 'operatore_id,data' })
                if (noteErr) console.warn('[my-day] note save error', noteErr)
            } else {
                await supabase.from('timesheet_day_notes')
                    .delete()
                    .eq('operatore_id', operatore.id)
                    .eq('data', data)
            }

            onSaved()
        } catch (err) {
            alert('Errore: ' + (err instanceof Error ? err.message : String(err)))
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border max-w-lg w-full p-6 max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
                <h3 className="text-xl font-semibold text-theme-text-primary mb-1">I miei orari — {operatore.nome} {operatore.cognome || ''}</h3>
                <p className="text-xs text-theme-text-muted mb-4">{new Date(data).toLocaleDateString('it-IT', { timeZone: ROME_TZ, weekday: 'long', day: 'numeric', month: 'long' })}</p>

                {loading ? (
                    <p className="text-theme-text-muted">Caricamento…</p>
                ) : (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <label className="block">
                                <span className="text-xs text-theme-text-secondary">Entrata</span>
                                <input type="time" value={entrata} onChange={e => setEntrata(e.target.value)}
                                    className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary" />
                            </label>
                            <label className="block">
                                <span className="text-xs text-theme-text-secondary">Uscita</span>
                                <input type="time" value={uscita} onChange={e => setUscita(e.target.value)}
                                    className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary" />
                            </label>
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-semibold text-theme-text-primary">Pause</span>
                                <button onClick={() => setPause([...pause, { pausa_inizio: '', pausa_fine: '' }])}
                                    className="text-xs px-2 py-1 rounded bg-theme-bg-tertiary text-theme-text-secondary hover:text-theme-text-primary">
                                    + Aggiungi pausa
                                </button>
                            </div>
                            <div className="space-y-2">
                                {pause.map((p, i) => (
                                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                                        <label className="block">
                                            <span className="text-xs text-theme-text-muted">Inizio pausa {i + 1}</span>
                                            <input type="time" value={p.pausa_inizio || ''} onChange={e => {
                                                const next = [...pause]
                                                next[i] = { ...next[i], pausa_inizio: e.target.value }
                                                setPause(next)
                                            }} className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary" />
                                        </label>
                                        <label className="block">
                                            <span className="text-xs text-theme-text-muted">Fine pausa {i + 1}</span>
                                            <input type="time" value={p.pausa_fine || ''} onChange={e => {
                                                const next = [...pause]
                                                next[i] = { ...next[i], pausa_fine: e.target.value }
                                                setPause(next)
                                            }} className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary" />
                                        </label>
                                        <button onClick={() => setPause(pause.filter((_, j) => j !== i))}
                                            className="px-2 py-2 text-red-400 hover:text-red-300" title="Rimuovi">×</button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <label className="block">
                            <span className="text-xs text-theme-text-secondary">Note (opzionale)</span>
                            <textarea value={note} onChange={e => setNote(e.target.value)}
                                rows={2} placeholder="Es: Lavoro da casa / Ferie / Permesso medico"
                                className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm" />
                        </label>
                    </div>
                )}

                <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-theme-border">
                    <Button variant="secondary" onClick={onClose} disabled={saving}>Annulla</Button>
                    <Button onClick={handleSave} disabled={loading || saving}>
                        {saving ? 'Salvataggio…' : 'Salva orari'}
                    </Button>
                </div>
            </div>
        </div>
    )
}

function exportCsv(filename: string, headers: string[], rows: string[][]) {
    const csv = [headers, ...rows]
        .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}
