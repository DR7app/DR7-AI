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

function toRomeDate(d: Date = new Date()): string {
    return d.toLocaleDateString('en-CA', { timeZone: ROME_TZ })
}

function isoToHHMM(iso: string): string {
    return new Date(iso).toLocaleTimeString('it-IT', { timeZone: ROME_TZ, hour: '2-digit', minute: '2-digit' })
}

function hhmmToISO(hhmm: string, dateStr: string): string | null {
    if (!/^\d{2}:\d{2}$/.test(hhmm)) return null
    const [h, m] = hhmm.split(':').map(Number)
    const d = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`)
    const romeStr = d.toLocaleString('en-US', { timeZone: ROME_TZ, hour12: false })
    const utcStr = d.toLocaleString('en-US', { timeZone: 'UTC', hour12: false })
    const offsetMs = new Date(romeStr).getTime() - new Date(utcStr).getTime()
    return new Date(d.getTime() - offsetMs).toISOString()
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
    const [entrata, setEntrata] = useState('')
    const [uscita, setUscita] = useState('')
    const [pause, setPause] = useState<BreakSlot[]>([{}])
    const [note, setNote] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        ;(async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { setLoading(false); setUnregistered(true); return }
            const { data: opRow } = await supabase
                .from('operatori_persone')
                .select('id, nome, cognome')
                .eq('user_id', user.id)
                .maybeSingle()
            if (!opRow) { setLoading(false); setUnregistered(true); return }
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
    }, [dataRef])

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
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
                    <div className="bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-800 rounded p-4 text-sm text-amber-900 dark:text-amber-100">
                        Il tuo account non è registrato come operatore. Vai su <strong>Report → Rilevazione Orari</strong> e clicca <strong>+ Operatore</strong> spuntando "Sono io" per crearti il profilo.
                    </div>
                )}

                {!loading && me && (
                    <>
                        <p className="text-sm text-theme-text-secondary mb-4">{me.nome} {me.cognome || ''}</p>
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
