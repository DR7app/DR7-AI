import { useEffect, useState, useMemo, useCallback } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
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
    return `${h}:${String(m).padStart(2, '0')}`
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
    const [me, setMe] = useState<Operatore | null>(null)
    const [view, setView] = useState<ViewMode>('giornaliera')
    const [refDate, setRefDate] = useState(new Date())
    const [loading, setLoading] = useState(true)
    const [showAddOp, setShowAddOp] = useState(false)
    const [submitting, setSubmitting] = useState<string | null>(null)
    const [now, setNow] = useState(new Date())

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

            const { data: ops } = await supabase
                .from('operatori_persone')
                .select('id, user_id, nome, cognome, email, ruolo, ore_target_giornaliere, attivo')
                .eq('attivo', true)
                .order('cognome', { ascending: true })
            const opList = (ops || []) as Operatore[]

            // Current user as operatore
            const myRow = opList.find(o => o.user_id === user?.id) || null
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

    async function clockIn(tipo: 'entrata' | 'pausa_inizio' | 'pausa_fine' | 'uscita') {
        if (!me) return
        setSubmitting(tipo)
        try {
            const { error } = await supabase
                .from('timesheet_entries')
                .insert({ operatore_id: me.id, tipo, timestamp: new Date().toISOString() })
            if (error) throw error
            await load()
            toast.success(`${labelTipo(tipo)} registrata`)
        } catch (err) {
            toast.error('Errore: ' + (err instanceof Error ? err.message : String(err)))
        } finally {
            setSubmitting(null)
        }
    }

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
                    <p className="text-xs text-theme-text-muted">Ognuno registra solo i propri orari. La tabella sotto mostra il team in lettura.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setShowAddOp(true)}>+ Operatore</Button>
                    <Button variant="secondary" onClick={downloadCsv}>Scarica CSV</Button>
                </div>
            </div>

            {/* Self clock-in widget — only for the logged-in user */}
            {me ? (
                <div className="bg-gradient-to-br from-amber-50 to-stone-100 dark:from-amber-950/30 dark:to-stone-900/30 rounded-xl border border-amber-300 dark:border-amber-800 p-5">
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                        <div>
                            <p className="text-sm text-theme-text-secondary">I tuoi orari di oggi</p>
                            <p className="text-xl font-bold text-theme-text-primary">{me.nome} {me.cognome || ''}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-theme-text-muted">Stato</p>
                            <StatoLabel s={myStato} large />
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-3">
                        {myStato === 'fuori' && (
                            <ClockButton onClick={() => clockIn('entrata')} loading={submitting === 'entrata'} primary>Entrata</ClockButton>
                        )}
                        {myStato === 'lavoro' && (
                            <>
                                <ClockButton onClick={() => clockIn('pausa_inizio')} loading={submitting === 'pausa_inizio'}>Inizio Pausa</ClockButton>
                                <ClockButton onClick={() => clockIn('uscita')} loading={submitting === 'uscita'} danger>Uscita</ClockButton>
                            </>
                        )}
                        {myStato === 'pausa' && (
                            <ClockButton onClick={() => clockIn('pausa_fine')} loading={submitting === 'pausa_fine'} primary>Fine Pausa</ClockButton>
                        )}
                        {myStato === 'finito' && (
                            <p className="text-sm text-emerald-700 dark:text-emerald-300 font-semibold">Giornata chiusa. Buon riposo!</p>
                        )}
                    </div>

                    {myRow && (
                        <div className="text-xs text-theme-text-muted flex flex-wrap gap-4">
                            <span>Entrata: <strong className="font-mono">{fmtTime(myRow.entrata)}</strong></span>
                            <span>Pause: <strong>{myRow.pausa_inizi.length}</strong></span>
                            <span>Uscita: <strong className="font-mono">{fmtTime(myRow.uscita)}</strong></span>
                            <span>Ore oggi: <strong>{fmtMin(myRow.minuti_lavorati)}</strong></span>
                            <span className="ml-auto">Aggiornato {now.toLocaleTimeString('it-IT', { timeZone: ROME_TZ, hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                    )}
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

            {!loading && view === 'giornaliera' && (
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
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-theme-border">
                            {dailyRows.length === 0 && (
                                <tr><td colSpan={9} className="text-center py-6 text-theme-text-muted">Nessun operatore attivo.</td></tr>
                            )}
                            {dailyRows.map(r => {
                                const isMine = r.operatore.id === me?.id
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
                                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtMin(r.minuti_lavorati)}</td>
                                        <td className="px-3 py-2 text-right text-theme-text-muted text-xs tabular-nums">{fmtMin(r.minuti_pausa)}</td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {!loading && view !== 'giornaliera' && (
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
            )}

            {showAddOp && (
                <AddOperatoreModal onClose={() => setShowAddOp(false)} onSaved={() => { setShowAddOp(false); load(); toast.success('Operatore aggiunto') }} />
            )}
        </div>
    )
}

function labelTipo(t: 'entrata' | 'pausa_inizio' | 'pausa_fine' | 'uscita'): string {
    return t === 'entrata' ? 'Entrata' : t === 'pausa_inizio' ? 'Inizio pausa' : t === 'pausa_fine' ? 'Fine pausa' : 'Uscita'
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

function ClockButton({ children, onClick, loading, primary, danger }: {
    children: React.ReactNode
    onClick: () => void
    loading?: boolean
    primary?: boolean
    danger?: boolean
}) {
    const cls = primary
        ? 'bg-amber-600 hover:bg-amber-700 text-white'
        : danger
            ? 'bg-stone-700 hover:bg-stone-800 text-white'
            : 'bg-white hover:bg-stone-50 text-stone-800 border border-stone-300'
    return (
        <button onClick={onClick} disabled={loading}
            className={`flex-1 min-w-[140px] py-3 rounded-lg text-sm font-semibold transition shadow-sm disabled:opacity-50 ${cls}`}>
            {loading ? '…' : children}
        </button>
    )
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
