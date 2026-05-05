import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import Button from './Button'

const ROME_TZ = 'Europe/Rome'

interface Operatore {
    id: string
    nome: string
    cognome: string | null
}

interface BreakSlot { pausa_inizio?: string; pausa_fine?: string }

function hhmmToMinutes(hhmm: string): number | null {
    if (!/^\d{2}:\d{2}$/.test(hhmm)) return null
    const [h, m] = hhmm.split(':').map(Number)
    return h * 60 + m
}

function fmtDuration(totalMin: number): string {
    if (totalMin <= 0) return '0h 00m'
    const h = Math.floor(totalMin / 60)
    const m = totalMin % 60
    return `${h}h ${String(m).padStart(2, '0')}m`
}

function toRomeDate(d: Date = new Date()): string {
    return d.toLocaleDateString('en-CA', { timeZone: ROME_TZ })
}

function isoToHHMM(iso: string): string {
    return new Date(iso).toLocaleTimeString('it-IT', { timeZone: ROME_TZ, hour: '2-digit', minute: '2-digit' })
}

function hhmmToISO(hhmm: string, dateStr: string): string | null {
    if (!/^\d{2}:\d{2}$/.test(hhmm)) return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
    const [h, m] = hhmm.split(':').map(Number)
    const [year, month, day] = dateStr.split('-').map(Number)
    // Costruisco un istante UTC assumendo che hhmm sia gia' UTC; poi calcolo
    // l'offset tra Europe/Rome e UTC per quell'istante e correggo.
    // Esempio: 08:00 Rome (CEST=UTC+2) -> ISO 06:00 UTC.
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

/**
 * Modal "I miei orari" — l'admin connesso edita i propri orari del giorno.
 * Auto-detect dell'operatore via user_id; se non e' registrato come operatore,
 * mostra un messaggio di guida.
 */
export default function MyDayEditorModal({ data, onClose, onSaved }: {
    data?: string  // YYYY-MM-DD; default oggi
    onClose: () => void
    onSaved?: () => void
}) {
    const dataRef = data || toRomeDate()
    const [me, setMe] = useState<Operatore | null>(null)
    const [unregistered, setUnregistered] = useState(false)
    const [authEmail, setAuthEmail] = useState<string>('')
    const [regNome, setRegNome] = useState('')
    const [regCognome, setRegCognome] = useState('')
    const [registering, setRegistering] = useState(false)
    const [reloadKey, setReloadKey] = useState(0)
    const [entrata, setEntrata] = useState('')
    const [uscita, setUscita] = useState('')
    const [pause, setPause] = useState<BreakSlot[]>([{}])
    const [note, setNote] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    // Calcolo live di pausa totale + lavoro netto/lordo (in minuti)
    const livePausaMin = pause.reduce((sum, p) => {
        const a = hhmmToMinutes(p.pausa_inizio || '')
        const b = hhmmToMinutes(p.pausa_fine || '')
        if (a == null || b == null || b <= a) return sum
        return sum + (b - a)
    }, 0)
    const liveEntrataMin = hhmmToMinutes(entrata)
    const liveUscitaMin = hhmmToMinutes(uscita)
    const liveLordoMin = liveEntrataMin != null && liveUscitaMin != null && liveUscitaMin > liveEntrataMin
        ? liveUscitaMin - liveEntrataMin
        : 0
    const liveNettoMin = Math.max(0, liveLordoMin - livePausaMin)

    useEffect(() => {
        ;(async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { setLoading(false); setUnregistered(true); return }
            setAuthEmail(user.email || '')

            // 1) cerca per user_id
            let { data: opRow } = await supabase
                .from('operatori_persone')
                .select('id, nome, cognome, user_id')
                .eq('user_id', user.id)
                .maybeSingle()

            // 2) fallback per email (riga creata senza link al login Supabase)
            if (!opRow && user.email) {
                const { data: byEmail } = await supabase
                    .from('operatori_persone')
                    .select('id, nome, cognome, user_id')
                    .ilike('email', user.email)
                    .maybeSingle()
                if (byEmail) {
                    opRow = byEmail
                    if (!byEmail.user_id) {
                        await supabase.from('operatori_persone')
                            .update({ user_id: user.id })
                            .eq('id', byEmail.id)
                    }
                }
            }

            // 3) niente match: auto-creo la riga operatore con email + nome
            //    di default (admins se accessibile, altrimenti email-local).
            if (!opRow && user.email) {
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

                const { data: created, error: insErr } = await supabase
                    .from('operatori_persone')
                    .insert({
                        nome: nome || fallback,
                        cognome,
                        email: user.email.toLowerCase(),
                        user_id: user.id,
                        ore_target_giornaliere: 8,
                        attivo: true,
                    })
                    .select('id, nome, cognome, user_id')
                    .single()
                if (insErr) {
                    toast.error('Errore creazione profilo: ' + insErr.message)
                    setLoading(false)
                    setUnregistered(true)
                    setRegNome(fallback)
                    return
                }
                opRow = created
            }

            if (!opRow) {
                setLoading(false)
                setUnregistered(true)
                return
            }
            setMe(opRow as Operatore)

            const { data: entries } = await supabase
                .from('timesheet_entries')
                .select('id, tipo, timestamp')
                .eq('operatore_id', opRow.id)
                .eq('data', dataRef)
                .order('timestamp', { ascending: true })
            const list = (entries || []) as { id: string; tipo: string; timestamp: string }[]

            const e = list.find(x => x.tipo === 'entrata')
            if (e) setEntrata(isoToHHMM(e.timestamp))
            const u = [...list].reverse().find(x => x.tipo === 'uscita')
            if (u) setUscita(isoToHHMM(u.timestamp))
            const pi = list.filter(x => x.tipo === 'pausa_inizio')
            const pf = list.filter(x => x.tipo === 'pausa_fine')
            const slots: BreakSlot[] = []
            for (let i = 0; i < Math.max(pi.length, pf.length); i++) {
                slots.push({
                    pausa_inizio: pi[i] ? isoToHHMM(pi[i].timestamp) : '',
                    pausa_fine: pf[i] ? isoToHHMM(pf[i].timestamp) : '',
                })
            }
            if (slots.length === 0) slots.push({ pausa_inizio: '', pausa_fine: '' })
            setPause(slots)

            const { data: noteRow } = await supabase
                .from('timesheet_day_notes')
                .select('nota')
                .eq('operatore_id', opRow.id)
                .eq('data', dataRef)
                .maybeSingle()
            if (noteRow?.nota) setNote(noteRow.nota)

            setLoading(false)
        })()
    }, [dataRef, reloadKey])

    async function handleRegister() {
        if (!regNome.trim()) { toast.error('Inserisci il tuo nome'); return }
        setRegistering(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error('Non sei autenticato')
            const { error } = await supabase.from('operatori_persone').insert({
                nome: regNome.trim(),
                cognome: regCognome.trim() || null,
                email: (user.email || '').toLowerCase(),
                user_id: user.id,
                ore_target_giornaliere: 8,
                attivo: true,
            })
            if (error) throw error
            toast.success('Profilo creato')
            setUnregistered(false)
            setReloadKey(k => k + 1)
            setLoading(true)
        } catch (err) {
            toast.error('Errore: ' + (err instanceof Error ? err.message : String(err)))
        } finally {
            setRegistering(false)
        }
    }

    async function handleSave() {
        if (!me) return
        setSaving(true)
        try {
            const { error: delErr } = await supabase
                .from('timesheet_entries')
                .delete()
                .eq('operatore_id', me.id)
                .eq('data', dataRef)
            if (delErr) throw delErr

            const inserts: { operatore_id: string; tipo: string; timestamp: string }[] = []
            if (entrata) {
                const ts = hhmmToISO(entrata, dataRef)
                if (ts) inserts.push({ operatore_id: me.id, tipo: 'entrata', timestamp: ts })
            }
            for (const p of pause) {
                if (p.pausa_inizio) {
                    const ts = hhmmToISO(p.pausa_inizio, dataRef)
                    if (ts) inserts.push({ operatore_id: me.id, tipo: 'pausa_inizio', timestamp: ts })
                }
                if (p.pausa_fine) {
                    const ts = hhmmToISO(p.pausa_fine, dataRef)
                    if (ts) inserts.push({ operatore_id: me.id, tipo: 'pausa_fine', timestamp: ts })
                }
            }
            if (uscita) {
                const ts = hhmmToISO(uscita, dataRef)
                if (ts) inserts.push({ operatore_id: me.id, tipo: 'uscita', timestamp: ts })
            }
            if (inserts.length > 0) {
                const { error: insErr } = await supabase.from('timesheet_entries').insert(inserts)
                if (insErr) throw insErr
            }

            if (note.trim()) {
                await supabase.from('timesheet_day_notes')
                    .upsert({ operatore_id: me.id, data: dataRef, nota: note.trim() }, { onConflict: 'operatore_id,data' })
            } else {
                await supabase.from('timesheet_day_notes')
                    .delete()
                    .eq('operatore_id', me.id)
                    .eq('data', dataRef)
            }

            toast.success('Orari salvati')
            onSaved?.()
            onClose()
        } catch (err) {
            toast.error('Errore: ' + (err instanceof Error ? err.message : String(err)))
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border max-w-lg w-full p-6 max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-1">
                    <h3 className="text-xl font-semibold text-theme-text-primary">I miei orari</h3>
                    <button onClick={onClose} className="text-theme-text-muted text-2xl leading-none hover:text-theme-text-primary">×</button>
                </div>
                <p className="text-xs text-theme-text-muted mb-4">
                    {new Date(dataRef).toLocaleDateString('it-IT', { timeZone: ROME_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>

                {loading && <p className="text-theme-text-muted">Caricamento…</p>}

                {!loading && unregistered && (
                    <div className="space-y-3">
                        <div className="bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-800 rounded p-3 text-xs text-amber-900 dark:text-amber-100">
                            Prima volta qui: crea il tuo profilo per poter registrare i tuoi orari.
                        </div>
                        <div className="space-y-2">
                            <label className="block">
                                <span className="text-xs text-theme-text-secondary">Nome *</span>
                                <input value={regNome} onChange={e => setRegNome(e.target.value)}
                                    className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary" />
                            </label>
                            <label className="block">
                                <span className="text-xs text-theme-text-secondary">Cognome</span>
                                <input value={regCognome} onChange={e => setRegCognome(e.target.value)}
                                    className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary" />
                            </label>
                            <p className="text-xs text-theme-text-muted">Email login: <span className="font-mono">{authEmail || '—'}</span></p>
                        </div>
                        <Button onClick={handleRegister} disabled={registering}>
                            {registering ? 'Creazione…' : 'Crea il mio profilo'}
                        </Button>
                    </div>
                )}

                {!loading && me && (
                    <>
                        <p className="text-sm text-theme-text-secondary mb-4">{me.nome} {me.cognome || ''}</p>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <label className="block">
                                    <span className="text-xs text-theme-text-secondary">Entrata</span>
                                    <input type="time" step={60} value={entrata} onChange={e => setEntrata(e.target.value)}
                                        className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary" />
                                </label>
                                <label className="block">
                                    <span className="text-xs text-theme-text-secondary">Uscita</span>
                                    <input type="time" step={60} value={uscita} onChange={e => setUscita(e.target.value)}
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
                                                <input type="time" step={60} value={p.pausa_inizio || ''} onChange={e => {
                                                    const next = [...pause]
                                                    next[i] = { ...next[i], pausa_inizio: e.target.value }
                                                    setPause(next)
                                                }} className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary" />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs text-theme-text-muted">Fine pausa {i + 1}</span>
                                                <input type="time" step={60} value={p.pausa_fine || ''} onChange={e => {
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

                            {/* Riepilogo live: aggiornato man mano che digiti gli orari */}
                            <div className="bg-theme-bg-tertiary rounded-lg border border-theme-border p-3 grid grid-cols-3 gap-2 text-center">
                                <div>
                                    <div className="text-[10px] text-theme-text-muted uppercase tracking-wider">Lavoro netto</div>
                                    <div className="text-sm font-semibold text-emerald-500 mt-0.5">{fmtDuration(liveNettoMin)}</div>
                                    <div className="text-[10px] text-theme-text-muted">{liveNettoMin} min</div>
                                </div>
                                <div>
                                    <div className="text-[10px] text-theme-text-muted uppercase tracking-wider">Pausa totale</div>
                                    <div className="text-sm font-semibold text-amber-500 mt-0.5">{fmtDuration(livePausaMin)}</div>
                                    <div className="text-[10px] text-theme-text-muted">{livePausaMin} min</div>
                                </div>
                                <div>
                                    <div className="text-[10px] text-theme-text-muted uppercase tracking-wider">Lavoro lordo</div>
                                    <div className="text-sm font-semibold text-theme-text-primary mt-0.5">{fmtDuration(liveLordoMin)}</div>
                                    <div className="text-[10px] text-theme-text-muted">{liveLordoMin} min</div>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-theme-border">
                    <Button variant="secondary" onClick={onClose} disabled={saving}>Chiudi</Button>
                    {me && (
                        <Button onClick={handleSave} disabled={loading || saving}>
                            {saving ? 'Salvataggio…' : 'Salva orari'}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    )
}
