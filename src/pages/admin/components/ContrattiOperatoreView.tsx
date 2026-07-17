import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import Input from './Input'
import Select from './Select'

// Sezione "Contratti" dentro Operatori. Direzione + ophe selezionano un
// operatore, vedono il contratto attivo (se esiste), e lo modificano
// completo: ore target (giorno/sett/mese), compenso (mensile/orario/
// straordinario), giorni lavorativi, flag (straordinario, festivi,
// notifiche, visibilita' fatturato).

interface Operatore {
    id: string
    user_id: string | null
    nome: string
    cognome: string | null
    email: string
    ruolo: string | null
}

// 2026-07-17: pause obbligatorie fisse impostate dalla direzione, per operatore.
interface PausaFascia { da: string; a: string } // es. { da: '13:00', a: '14:00' }
interface PauseConfig {
    durata_min: number   // minuti di pausa totale al giorno (scalati dalle ore lavorate)
    pagata: boolean      // true = pausa pagata (NON scalata); false = non pagata (scalata)
    fasce: PausaFascia[] // fasce orarie fisse opzionali (in quelle ore non si contano ore)
}

interface Contratto {
    id?: string
    operatore_id: string
    user_id: string | null
    attivo: boolean
    data_inizio: string
    data_fine: string | null
    tipo_rapporto: string | null
    ore_target_giornaliere: number | null
    ore_target_settimanali: number | null
    ore_target_mensili: number | null
    giorni_lavorativi_settimana: number | null
    stipendio_mensile_eur: number | null
    paga_oraria_eur: number | null
    paga_straordinario_eur: number | null
    straordinario_abilitato: boolean
    lavora_festivi: boolean
    notifiche_attive: boolean
    visibilita_fatturato: boolean
    note: string | null
    pause_config: PauseConfig | null
}

const TIPO_RAPPORTO_OPTIONS = [
    { value: '', label: 'Seleziona...' },
    { value: 'dipendente', label: 'Dipendente' },
    { value: 'collaboratore', label: 'Collaboratore' },
    { value: 'stagista', label: 'Stagista' },
    { value: 'occasionale', label: 'Occasionale / Babysitter' },
    { value: 'partita_iva', label: 'Partita IVA' },
]

function emptyContratto(operatore_id: string, user_id: string | null): Contratto {
    return {
        operatore_id,
        user_id,
        attivo: true,
        data_inizio: new Date().toISOString().slice(0, 10),
        data_fine: null,
        tipo_rapporto: null,
        ore_target_giornaliere: 8,
        ore_target_settimanali: 40,
        ore_target_mensili: 160,
        giorni_lavorativi_settimana: 5,
        stipendio_mensile_eur: null,
        paga_oraria_eur: null,
        paga_straordinario_eur: null,
        straordinario_abilitato: false,
        lavora_festivi: false,
        notifiche_attive: true,
        visibilita_fatturato: false,
        note: null,
        pause_config: { durata_min: 0, pagata: false, fasce: [] },
    }
}

export default function ContrattiOperatoreView() {
    const [operatori, setOperatori] = useState<Operatore[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [contratto, setContratto] = useState<Contratto | null>(null)
    const [storico, setStorico] = useState<Contratto[]>([])
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)

    // Carica operatori attivi
    useEffect(() => {
        (async () => {
            const { data } = await supabase
                .from('operatori_persone')
                .select('id, user_id, nome, cognome, email, ruolo')
                .eq('attivo', true)
                .order('nome', { ascending: true })
            setOperatori((data || []) as Operatore[])
        })()
    }, [])

    // Carica contratti dell'operatore selezionato
    useEffect(() => {
        if (!selectedId) {
            setContratto(null)
            setStorico([])
            return
        }
        const op = operatori.find(o => o.id === selectedId)
        if (!op) return
        setLoading(true)
        ;(async () => {
            const { data, error } = await supabase
                .from('operatore_contratto')
                .select('*')
                .eq('operatore_id', selectedId)
                .order('data_inizio', { ascending: false })
            setLoading(false)
            if (error) {
                console.error('[Contratti] load error', error)
                // Surfaciamo il messaggio reale di Supabase cosi' direzione
                // capisce subito se e' "relation does not exist" (migrazione
                // non eseguita) o "permission denied" (RLS).
                toast.error(`Errore caricamento contratti: ${error.message || error.code || 'sconosciuto'}`)
                return
            }
            const rows = (data || []) as Contratto[]
            const active = rows.find(r => r.attivo)
            setContratto(active || emptyContratto(selectedId, op.user_id))
            setStorico(rows.filter(r => !r.attivo))
        })()
    }, [selectedId, operatori])

    const selected = useMemo(() => operatori.find(o => o.id === selectedId) || null, [operatori, selectedId])

    function update<K extends keyof Contratto>(k: K, v: Contratto[K]) {
        setContratto(prev => prev ? { ...prev, [k]: v } : prev)
    }

    function setPause(patch: Partial<PauseConfig>) {
        setContratto(prev => {
            if (!prev) return prev
            const cur = prev.pause_config || { durata_min: 0, pagata: false, fasce: [] }
            return { ...prev, pause_config: { ...cur, ...patch } }
        })
    }

    function nullableNumber(s: string): number | null {
        if (!s.trim()) return null
        const n = Number(s)
        return Number.isFinite(n) ? n : null
    }

    async function save() {
        if (!contratto || !selected) return
        setSaving(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            const payload: Record<string, unknown> = {
                operatore_id: contratto.operatore_id,
                user_id: contratto.user_id || selected.user_id,
                attivo: true,
                data_inizio: contratto.data_inizio,
                data_fine: contratto.data_fine,
                tipo_rapporto: contratto.tipo_rapporto || null,
                ore_target_giornaliere: contratto.ore_target_giornaliere,
                ore_target_settimanali: contratto.ore_target_settimanali,
                ore_target_mensili: contratto.ore_target_mensili,
                giorni_lavorativi_settimana: contratto.giorni_lavorativi_settimana,
                stipendio_mensile_eur: contratto.stipendio_mensile_eur,
                paga_oraria_eur: contratto.paga_oraria_eur,
                paga_straordinario_eur: contratto.paga_straordinario_eur,
                straordinario_abilitato: contratto.straordinario_abilitato,
                lavora_festivi: contratto.lavora_festivi,
                notifiche_attive: contratto.notifiche_attive,
                visibilita_fatturato: contratto.visibilita_fatturato,
                note: contratto.note,
                pause_config: contratto.pause_config || { durata_min: 0, pagata: false, fasce: [] },
            }

            if (contratto.id) {
                const { error } = await supabase
                    .from('operatore_contratto')
                    .update(payload)
                    .eq('id', contratto.id)
                if (error) throw error
            } else {
                payload.created_by = user?.id || null
                const { error } = await supabase
                    .from('operatore_contratto')
                    .insert(payload)
                if (error) throw error
            }

            // Sync the daily-hours target back onto operatori_persone so the
            // Gestisci Operatori table (which reads from that row) stays in
            // sync with the active contract. Without this, the table showed
            // the stale 8h default even after a contract set 7h.
            if (contratto.ore_target_giornaliere != null) {
                const { error: syncErr } = await supabase
                    .from('operatori_persone')
                    .update({ ore_target_giornaliere: contratto.ore_target_giornaliere })
                    .eq('id', contratto.operatore_id)
                if (syncErr) console.error('[ContrattiOperatore] sync operatori_persone failed:', syncErr.message)
            }

            toast.success('Contratto salvato')
            // Reload to pick up the new id / generated fields
            setSelectedId(prev => prev)
            const { data } = await supabase
                .from('operatore_contratto')
                .select('*')
                .eq('operatore_id', selected.id)
                .order('data_inizio', { ascending: false })
            const rows = (data || []) as Contratto[]
            const active = rows.find(r => r.attivo)
            if (active) setContratto(active)
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            toast.error(`Errore: ${msg}`)
        } finally {
            setSaving(false)
        }
    }

    async function chiudiContratto() {
        if (!contratto?.id) return
        if (!confirm('Chiudere il contratto attivo? L\'operatore non avra\' piu\' un contratto in vigore finche\' non ne crei uno nuovo.')) return
        try {
            const { error } = await supabase
                .from('operatore_contratto')
                .update({ attivo: false, data_fine: new Date().toISOString().slice(0, 10) })
                .eq('id', contratto.id)
            if (error) throw error
            toast.success('Contratto chiuso')
            setSelectedId(prev => prev)
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            toast.error(`Errore: ${msg}`)
        }
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
            {/* Lista operatori */}
            <aside className="bg-theme-bg-secondary border border-theme-border rounded-xl p-3 max-h-[80vh] overflow-y-auto">
                <h3 className="text-xs uppercase tracking-wider font-semibold text-theme-text-muted mb-2 px-1">Operatori ({operatori.length})</h3>
                <div className="space-y-1">
                    {operatori.map(op => {
                        const active = op.id === selectedId
                        return (
                            <button
                                key={op.id}
                                onClick={() => setSelectedId(op.id)}
                                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${active ? 'bg-dr7-gold/15 text-dr7-gold border border-dr7-gold/40' : 'text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary'}`}
                            >
                                <div className="font-semibold">{op.nome}{op.cognome ? ` ${op.cognome}` : ''}</div>
                                <div className="text-[11px] text-theme-text-muted">{op.email}</div>
                                {op.ruolo && <div className="text-[10px] uppercase tracking-wider mt-0.5 text-theme-text-muted">{op.ruolo}</div>}
                            </button>
                        )
                    })}
                </div>
            </aside>

            {/* Pannello contratto */}
            <section className="bg-theme-bg-secondary border border-theme-border rounded-xl p-5 space-y-5">
                {!selected && (
                    <p className="text-sm text-theme-text-muted text-center py-12">Seleziona un operatore a sinistra per gestire il contratto.</p>
                )}

                {selected && loading && (
                    <p className="text-sm text-theme-text-muted text-center py-12">Caricamento contratto…</p>
                )}

                {selected && !loading && contratto && (
                    <>
                        <div className="flex items-start justify-between gap-3 pb-3 border-b border-theme-border">
                            <div>
                                <h2 className="text-lg font-bold text-theme-text-primary">Contratto attivo — {selected.nome}{selected.cognome ? ` ${selected.cognome}` : ''}</h2>
                                <p className="text-xs text-theme-text-muted mt-0.5">{selected.email}</p>
                            </div>
                            {contratto.id && (
                                <button
                                    type="button"
                                    onClick={chiudiContratto}
                                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-500/40 text-red-400 hover:bg-red-500/10"
                                >
                                    Chiudi contratto
                                </button>
                            )}
                        </div>

                        {/* Tipo rapporto + date */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <Select
                                label="Tipo rapporto"
                                value={contratto.tipo_rapporto || ''}
                                onChange={e => update('tipo_rapporto', e.target.value || null)}
                                options={TIPO_RAPPORTO_OPTIONS}
                            />
                            <Input
                                label="Data inizio"
                                type="date"
                                value={contratto.data_inizio}
                                onChange={e => update('data_inizio', e.target.value)}
                            />
                            <Input
                                label="Data fine (opzionale)"
                                type="date"
                                value={contratto.data_fine || ''}
                                onChange={e => update('data_fine', e.target.value || null)}
                            />
                        </div>

                        {/* Ore obiettivo */}
                        <fieldset className="border border-theme-border rounded-lg p-4 space-y-3">
                            <legend className="px-2 text-xs uppercase tracking-wider font-semibold text-theme-text-muted">Ore Obiettivo</legend>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <Input
                                    label="Giornaliere"
                                    type="number"
                                    step="0.5"
                                    value={contratto.ore_target_giornaliere ?? ''}
                                    onChange={e => update('ore_target_giornaliere', nullableNumber(e.target.value))}
                                    placeholder="8"
                                />
                                <Input
                                    label="Settimanali"
                                    type="number"
                                    step="0.5"
                                    value={contratto.ore_target_settimanali ?? ''}
                                    onChange={e => update('ore_target_settimanali', nullableNumber(e.target.value))}
                                    placeholder="40"
                                />
                                <Input
                                    label="Mensili"
                                    type="number"
                                    step="0.5"
                                    value={contratto.ore_target_mensili ?? ''}
                                    onChange={e => update('ore_target_mensili', nullableNumber(e.target.value))}
                                    placeholder="160"
                                />
                                <Input
                                    label="Giorni / settimana"
                                    type="number"
                                    min={1}
                                    max={7}
                                    value={contratto.giorni_lavorativi_settimana ?? ''}
                                    onChange={e => update('giorni_lavorativi_settimana', nullableNumber(e.target.value))}
                                    placeholder="5"
                                />
                            </div>
                        </fieldset>

                        {/* Pause Obbligatorie (impostate dalla direzione) */}
                        <fieldset className="border border-theme-border rounded-lg p-4 space-y-3">
                            <legend className="px-2 text-xs uppercase tracking-wider font-semibold text-theme-text-muted">Pause obbligatorie</legend>
                            <p className="text-xs text-theme-text-muted">Valgono per questo operatore anche se non le registra da solo. Puoi impostare una durata giornaliera e/o fasce orarie fisse.</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <Input
                                    label="Pausa giornaliera (minuti)"
                                    type="number"
                                    min={0}
                                    value={contratto.pause_config?.durata_min ?? 0}
                                    onChange={e => setPause({ durata_min: Number(e.target.value) || 0 })}
                                    placeholder="30"
                                />
                                <label className="flex items-center gap-2 md:mt-6 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={contratto.pause_config?.pagata ?? false}
                                        onChange={e => setPause({ pagata: e.target.checked })}
                                        className="w-4 h-4 accent-emerald-500"
                                    />
                                    <span className="text-sm text-theme-text-secondary">Pausa pagata (non scalata dalle ore)</span>
                                </label>
                            </div>
                            <div className="space-y-2">
                                <div className="text-xs uppercase tracking-wider font-semibold text-theme-text-muted">Fasce orarie fisse (opzionale)</div>
                                {(contratto.pause_config?.fasce ?? []).map((f, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <input
                                            type="time"
                                            value={f.da}
                                            onChange={e => { const fasce = [...(contratto.pause_config?.fasce ?? [])]; fasce[i] = { ...fasce[i], da: e.target.value }; setPause({ fasce }) }}
                                            className="px-2 py-1 bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary text-sm"
                                        />
                                        <span className="text-theme-text-muted">–</span>
                                        <input
                                            type="time"
                                            value={f.a}
                                            onChange={e => { const fasce = [...(contratto.pause_config?.fasce ?? [])]; fasce[i] = { ...fasce[i], a: e.target.value }; setPause({ fasce }) }}
                                            className="px-2 py-1 bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary text-sm"
                                        />
                                        <button type="button" onClick={() => setPause({ fasce: (contratto.pause_config?.fasce ?? []).filter((_, j) => j !== i) })} className="text-red-500 hover:text-red-600 px-2 text-lg leading-none">×</button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => setPause({ fasce: [...(contratto.pause_config?.fasce ?? []), { da: '13:00', a: '14:00' }] })}
                                    className="text-xs text-cyan-500 hover:text-cyan-400 font-medium"
                                >+ Aggiungi fascia</button>
                            </div>
                        </fieldset>

                        {/* Compenso */}
                        <fieldset className="border border-theme-border rounded-lg p-4 space-y-3">
                            <legend className="px-2 text-xs uppercase tracking-wider font-semibold text-theme-text-muted">Compenso</legend>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <Input
                                    label="Stipendio mensile (€)"
                                    type="number"
                                    step="0.01"
                                    value={contratto.stipendio_mensile_eur ?? ''}
                                    onChange={e => update('stipendio_mensile_eur', nullableNumber(e.target.value))}
                                    placeholder="es. 1500.00"
                                />
                                <Input
                                    label="Paga oraria (€/h)"
                                    type="number"
                                    step="0.01"
                                    value={contratto.paga_oraria_eur ?? ''}
                                    onChange={e => update('paga_oraria_eur', nullableNumber(e.target.value))}
                                    placeholder="es. 9.50"
                                />
                                <Input
                                    label="Straordinario (€/h)"
                                    type="number"
                                    step="0.01"
                                    value={contratto.paga_straordinario_eur ?? ''}
                                    onChange={e => update('paga_straordinario_eur', nullableNumber(e.target.value))}
                                    placeholder="es. 14.00"
                                />
                            </div>
                        </fieldset>

                        {/* Flag toggle */}
                        <fieldset className="border border-theme-border rounded-lg p-4">
                            <legend className="px-2 text-xs uppercase tracking-wider font-semibold text-theme-text-muted">Permessi e Flag</legend>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {([
                                    { k: 'straordinario_abilitato', label: 'Puo\' fare straordinari', sub: 'Ore oltre il target giornaliero vengono pagate come straordinario.' },
                                    { k: 'lavora_festivi', label: 'Lavora domenica e festivi', sub: 'Lo schedulatore permette assegnazioni nei giorni rossi.' },
                                    { k: 'notifiche_attive', label: 'Riceve notifiche dalla direzione', sub: 'WhatsApp / email di sistema arrivano all\'operatore.' },
                                    { k: 'visibilita_fatturato', label: 'Vede il fatturato nei report', sub: 'Mostra importi €, KPI fatturato, paga totale del team.' },
                                ] as const).map(f => {
                                    const on = !!contratto[f.k]
                                    return (
                                        <button
                                            key={f.k}
                                            type="button"
                                            onClick={() => update(f.k, !on as never)}
                                            className="flex items-start justify-between gap-3 p-3 rounded-lg border border-theme-border bg-theme-bg-primary hover:border-dr7-gold/40 text-left"
                                        >
                                            <div className="flex-1">
                                                <div className="text-sm font-semibold text-theme-text-primary">{f.label}</div>
                                                <div className="text-[11px] text-theme-text-muted mt-0.5">{f.sub}</div>
                                            </div>
                                            <span className={`relative inline-flex flex-shrink-0 items-center w-10 h-5 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-theme-bg-hover border border-theme-border'}`}>
                                                <span className={`inline-block w-4 h-4 rounded-full bg-white shadow transform transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                        </fieldset>

                        {/* Note */}
                        <div>
                            <label className="block text-xs uppercase tracking-wider font-semibold text-theme-text-muted mb-1">Note interne</label>
                            <textarea
                                value={contratto.note || ''}
                                onChange={e => update('note', e.target.value || null)}
                                placeholder="Es. orari particolari, deroghe, accordi verbali..."
                                rows={3}
                                className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:border-dr7-gold"
                            />
                        </div>

                        <div className="flex justify-end pt-2 border-t border-theme-border">
                            <Button onClick={save} disabled={saving}>
                                {saving ? 'Salvataggio...' : (contratto.id ? 'Aggiorna contratto' : 'Crea contratto')}
                            </Button>
                        </div>

                        {/* Storico */}
                        {storico.length > 0 && (
                            <div className="pt-4 border-t border-theme-border">
                                <h3 className="text-xs uppercase tracking-wider font-semibold text-theme-text-muted mb-2">Storico contratti ({storico.length})</h3>
                                <ul className="space-y-1">
                                    {storico.map(s => (
                                        <li key={s.id} className="text-xs text-theme-text-secondary px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border flex items-center justify-between">
                                            <span>
                                                <span className="font-mono">{s.data_inizio} → {s.data_fine || '—'}</span>
                                                {s.tipo_rapporto && <span className="ml-2 uppercase tracking-wider text-[10px] text-theme-text-muted">({s.tipo_rapporto})</span>}
                                            </span>
                                            <span className="text-theme-text-muted">
                                                {s.stipendio_mensile_eur ? `€${s.stipendio_mensile_eur}/mese` : s.paga_oraria_eur ? `€${s.paga_oraria_eur}/h` : '—'}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </>
                )}
            </section>
        </div>
    )
}
