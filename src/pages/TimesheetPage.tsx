import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

interface Operatore {
    id: string
    nome: string
    cognome: string | null
    ruolo: string | null
    ore_target_giornaliere: number
}

interface Entry {
    id: string
    tipo: 'entrata' | 'pausa_inizio' | 'pausa_fine' | 'uscita'
    timestamp: string
    note: string | null
}

type Stato = 'fuori' | 'lavoro' | 'pausa' | 'finito'

const ROME_TZ = 'Europe/Rome'

function toRomeDateString(d: Date = new Date()): string {
    return d.toLocaleDateString('en-CA', { timeZone: ROME_TZ }) // YYYY-MM-DD
}

function fmtTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('it-IT', { timeZone: ROME_TZ, hour: '2-digit', minute: '2-digit' })
}

function fmtMinutes(min: number): string {
    const h = Math.floor(min / 60)
    const m = min % 60
    return `${h}h ${String(m).padStart(2, '0')}m`
}

/**
 * Operator-facing time clock. Login via Supabase Auth (each operator has their
 * own email + password). Big buttons for entrata / pausa / uscita; today's
 * timeline below. Weekly stats at top.
 */
export default function TimesheetPage() {
    const navigate = useNavigate()
    const [operatore, setOperatore] = useState<Operatore | null>(null)
    const [entries, setEntries] = useState<Entry[]>([])
    const [weekMinutes, setWeekMinutes] = useState(0)
    const [todayMinutes, setTodayMinutes] = useState(0)
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState<string | null>(null)
    const [now, setNow] = useState(new Date())

    // Tick clock every second for live "tempo lavorato" display
    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 1000)
        return () => clearInterval(t)
    }, [])

    const load = useCallback(async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            navigate('/login?redirect=/timesheet')
            return
        }
        const { data: opRow, error: opErr } = await supabase
            .from('operatori_persone')
            .select('id, nome, cognome, ruolo, ore_target_giornaliere, attivo')
            .eq('user_id', user.id)
            .maybeSingle()
        if (opErr || !opRow) {
            setLoading(false)
            return
        }
        if (!opRow.attivo) {
            setLoading(false)
            setOperatore(null)
            return
        }
        setOperatore(opRow as Operatore)

        const today = toRomeDateString()
        const { data: todayEntries } = await supabase
            .from('timesheet_entries')
            .select('id, tipo, timestamp, note')
            .eq('operatore_id', opRow.id)
            .eq('data', today)
            .order('timestamp', { ascending: true })
        setEntries((todayEntries || []) as Entry[])

        // Today minutes via RPC
        const { data: tMin } = await supabase.rpc('operatore_minuti_lavorati', {
            p_operatore_id: opRow.id,
            p_data: today,
        })
        setTodayMinutes(Number(tMin) || 0)

        // Week minutes — start of week (Monday) to today
        const weekStart = (() => {
            const d = new Date()
            const day = d.getDay() || 7
            d.setDate(d.getDate() - day + 1)
            return toRomeDateString(d)
        })()
        const { data: weekRows } = await supabase
            .from('timesheet_entries')
            .select('data')
            .eq('operatore_id', opRow.id)
            .gte('data', weekStart)
            .lte('data', today)
        const distinctDays = Array.from(new Set((weekRows || []).map((r: { data: string }) => r.data)))
        let total = 0
        for (const d of distinctDays) {
            const { data: m } = await supabase.rpc('operatore_minuti_lavorati', {
                p_operatore_id: opRow.id,
                p_data: d,
            })
            total += Number(m) || 0
        }
        setWeekMinutes(total)

        setLoading(false)
    }, [navigate])

    useEffect(() => { load() }, [load])

    const stato: Stato = (() => {
        if (entries.length === 0) return 'fuori'
        const last = entries[entries.length - 1]
        if (last.tipo === 'uscita') return 'finito'
        if (last.tipo === 'entrata' || last.tipo === 'pausa_fine') return 'lavoro'
        if (last.tipo === 'pausa_inizio') return 'pausa'
        return 'fuori'
    })()

    async function clockIn(tipo: Entry['tipo']) {
        if (!operatore) return
        setSubmitting(tipo)
        try {
            const { error } = await supabase
                .from('timesheet_entries')
                .insert({
                    operatore_id: operatore.id,
                    tipo,
                    timestamp: new Date().toISOString(),
                })
            if (error) throw error
            await load()
        } catch (err) {
            alert('Errore: ' + (err instanceof Error ? err.message : String(err)))
        } finally {
            setSubmitting(null)
        }
    }

    if (loading) {
        return <Centered><p className="text-gray-600">Caricamento…</p></Centered>
    }

    if (!operatore) {
        return (
            <Centered>
                <h1 className="text-2xl font-bold text-amber-700 mb-2">Accesso non autorizzato</h1>
                <p className="text-gray-600 mb-4">Il tuo account non è collegato a nessun operatore. Contatta l'amministrazione.</p>
                <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }}
                    className="px-4 py-2 rounded-lg bg-amber-600 text-white">Esci</button>
            </Centered>
        )
    }

    // Live ticking minutes for current open session
    const liveTodayMinutes = (() => {
        if (stato === 'lavoro' || stato === 'pausa') {
            // Add seconds since last load roughly via re-render on `now`
            return todayMinutes + Math.floor((now.getTime() % 60000) / 60000)
        }
        return todayMinutes
    })()
    void liveTodayMinutes // ensure now triggers re-render (used implicitly by stato)

    const targetMin = Math.round(operatore.ore_target_giornaliere * 60)
    const saldoMin = todayMinutes - targetMin

    return (
        <div className="min-h-screen bg-gradient-to-br from-amber-50 to-stone-100 py-8 px-4">
            <div className="max-w-2xl mx-auto">
                <div className="bg-white rounded-2xl shadow-lg border border-amber-200 p-6 mb-4">
                    <div className="flex items-center justify-between mb-2">
                        <div>
                            <p className="text-xs uppercase tracking-wide text-amber-700">DR7 Empire</p>
                            <h1 className="text-2xl font-bold text-stone-800">
                                Ciao {operatore.nome}{operatore.cognome ? ` ${operatore.cognome}` : ''}
                            </h1>
                            {operatore.ruolo && <p className="text-sm text-stone-600">{operatore.ruolo}</p>}
                        </div>
                        <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }}
                            className="text-xs text-stone-500 hover:text-stone-700 underline">Esci</button>
                    </div>
                    <div className="text-3xl font-light text-stone-700 tabular-nums">
                        {now.toLocaleTimeString('it-IT', { timeZone: ROME_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                    <p className="text-xs text-stone-500">{now.toLocaleDateString('it-IT', { timeZone: ROME_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                    <Stat label="Oggi" value={fmtMinutes(todayMinutes)} sub={`${operatore.ore_target_giornaliere}h target`} />
                    <Stat label="Saldo" value={(saldoMin >= 0 ? '+' : '') + fmtMinutes(Math.abs(saldoMin))} tone={saldoMin >= 0 ? 'ok' : 'warn'} />
                    <Stat label="Settimana" value={fmtMinutes(weekMinutes)} />
                </div>

                {/* Status badge */}
                <div className="mb-4 text-center">
                    <StatoLabel stato={stato} />
                </div>

                {/* Action buttons depend on stato */}
                <div className="space-y-3 mb-6">
                    {stato === 'fuori' && (
                        <ActionButton onClick={() => clockIn('entrata')} loading={submitting === 'entrata'} primary>
                            Entrata
                        </ActionButton>
                    )}
                    {stato === 'lavoro' && (
                        <>
                            <ActionButton onClick={() => clockIn('pausa_inizio')} loading={submitting === 'pausa_inizio'}>
                                Inizio Pausa
                            </ActionButton>
                            <ActionButton onClick={() => clockIn('uscita')} loading={submitting === 'uscita'} danger>
                                Uscita
                            </ActionButton>
                        </>
                    )}
                    {stato === 'pausa' && (
                        <ActionButton onClick={() => clockIn('pausa_fine')} loading={submitting === 'pausa_fine'} primary>
                            Fine Pausa
                        </ActionButton>
                    )}
                    {stato === 'finito' && (
                        <div className="text-center p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800">
                            Giornata chiusa. Buon riposo!
                        </div>
                    )}
                </div>

                {/* Today timeline */}
                <div className="bg-white rounded-2xl shadow border border-stone-200 p-5">
                    <h2 className="font-semibold text-stone-800 mb-3">Eventi di oggi</h2>
                    {entries.length === 0 ? (
                        <p className="text-sm text-stone-500">Nessun evento registrato oggi.</p>
                    ) : (
                        <ul className="space-y-2">
                            {entries.map(e => (
                                <li key={e.id} className="flex items-center gap-3 text-sm">
                                    <span className="font-mono w-12 text-stone-700">{fmtTime(e.timestamp)}</span>
                                    <span className="flex-1 text-stone-800">{labelTipo(e.tipo)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    )
}

function labelTipo(t: Entry['tipo']): string {
    switch (t) {
        case 'entrata': return 'Entrata'
        case 'pausa_inizio': return 'Inizio pausa'
        case 'pausa_fine': return 'Fine pausa'
        case 'uscita': return 'Uscita'
    }
}

function StatoLabel({ stato }: { stato: Stato }) {
    const map = {
        fuori: { label: 'Fuori', cls: 'bg-stone-200 text-stone-700' },
        lavoro: { label: 'Al lavoro', cls: 'bg-emerald-100 text-emerald-800 border border-emerald-300' },
        pausa: { label: 'In pausa', cls: 'bg-amber-100 text-amber-800 border border-amber-300' },
        finito: { label: 'Giornata chiusa', cls: 'bg-stone-200 text-stone-600' },
    }
    const m = map[stato]
    return <span className={`inline-block px-4 py-1.5 rounded-full text-sm font-medium ${m.cls}`}>{m.label}</span>
}

function ActionButton({ children, onClick, loading, primary, danger }: {
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
            : 'bg-white hover:bg-stone-50 text-stone-800 border-2 border-stone-300'
    return (
        <button
            onClick={onClick}
            disabled={loading}
            className={`w-full py-5 rounded-2xl text-lg font-semibold transition shadow disabled:opacity-50 ${cls}`}
        >
            {loading ? '…' : children}
        </button>
    )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' }) {
    const valCls = tone === 'ok' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-stone-800'
    return (
        <div className="bg-white rounded-xl shadow-sm border border-stone-200 p-3 text-center">
            <p className="text-xs text-stone-500 uppercase tracking-wide">{label}</p>
            <p className={`text-lg font-bold tabular-nums ${valCls}`}>{value}</p>
            {sub && <p className="text-xs text-stone-400">{sub}</p>}
        </div>
    )
}

function Centered({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen flex items-center justify-center px-4 bg-stone-50">
            <div className="bg-white rounded-2xl shadow border border-stone-200 p-8 max-w-md text-center">
                {children}
            </div>
        </div>
    )
}
