/**
 * AlarmInventoryModal — Gestione Allarmi.
 *
 * Loads alarm configuration from public.system_alarms and lets admins:
 *   - Toggle each alarm on/off (is_enabled)
 *   - Edit the trigger threshold (10 min, 1000 km, 7 days, etc.)
 *   - Edit label, schedule description, reason
 *
 * Realtime subscription: VehicleAlarmContext also listens, so saved
 * changes propagate to the next 60-sec polling tick automatically.
 *
 * "Add new" is intentionally disabled — adding a row with a fresh id
 * has no effect because the trigger logic for each alarm is hardcoded
 * in TypeScript. Editable list = the 13 existing alarms only.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import toast from 'react-hot-toast'

type ThresholdUnit = 'minutes_before' | 'minutes_after' | 'km' | 'days'

interface AlarmRow {
    id: string
    label: string
    schedule: string
    reason: string
    category: 'booking' | 'fleet'
    threshold_value: number
    threshold_unit: ThresholdUnit
    is_enabled: boolean
    sort_order: number
}

interface Props {
    isOpen: boolean
    onClose: () => void
    audioEnabled: boolean
    onEnableAudio: () => void
}

const UNIT_LABEL: Record<ThresholdUnit, string> = {
    minutes_before: 'minuti prima',
    minutes_after: 'minuti dopo',
    km: 'km',
    days: 'giorni',
}

export default function AlarmInventoryModal({ isOpen, onClose, audioEnabled, onEnableAudio }: Props) {
    const [alarms, setAlarms] = useState<AlarmRow[]>([])
    const [loading, setLoading] = useState(false)
    const [savingId, setSavingId] = useState<string | null>(null)
    const [editing, setEditing] = useState<Record<string, Partial<AlarmRow>>>({})

    // Load on open
    useEffect(() => {
        if (!isOpen) return
        setLoading(true)
        ;(async () => {
            const { data, error } = await supabase
                .from('system_alarms')
                .select('*')
                .order('sort_order', { ascending: true })
            if (error) {
                toast.error('Errore caricamento allarmi: ' + error.message)
            } else {
                setAlarms((data || []) as AlarmRow[])
            }
            setLoading(false)
        })()
    }, [isOpen])

    if (!isOpen) return null

    const groups: Array<{ id: 'booking' | 'fleet'; title: string; subtitle: string }> = [
        { id: 'booking', title: 'Prenotazioni', subtitle: 'Eventi legati al ciclo di vita di un noleggio o lavaggio.' },
        { id: 'fleet', title: 'Manutenzione Flotta', subtitle: 'Soglie km e date di scadenza per ogni veicolo attivo.' },
    ]

    const setField = (id: string, key: keyof AlarmRow, value: AlarmRow[keyof AlarmRow]) => {
        setEditing(prev => ({ ...prev, [id]: { ...prev[id], [key]: value } }))
    }

    const valueOf = <K extends keyof AlarmRow>(row: AlarmRow, key: K): AlarmRow[K] => {
        const e = editing[row.id]?.[key]
        return (e !== undefined ? e : row[key]) as AlarmRow[K]
    }

    const isDirty = (row: AlarmRow): boolean => {
        const e = editing[row.id]
        if (!e) return false
        return Object.keys(e).some(k => e[k as keyof AlarmRow] !== row[k as keyof AlarmRow])
    }

    const saveRow = async (row: AlarmRow) => {
        const e = editing[row.id]
        if (!e) return
        setSavingId(row.id)
        const payload: Record<string, unknown> = {
            ...e,
            updated_at: new Date().toISOString(),
        }
        const { error } = await supabase
            .from('system_alarms')
            .update(payload)
            .eq('id', row.id)
        setSavingId(null)
        if (error) {
            toast.error('Salvataggio fallito: ' + error.message)
            return
        }
        toast.success('Salvato')
        setAlarms(prev => prev.map(a => (a.id === row.id ? { ...a, ...e } as AlarmRow : a)))
        setEditing(prev => {
            const next = { ...prev }
            delete next[row.id]
            return next
        })
    }

    const toggleEnabled = async (row: AlarmRow) => {
        const next = !row.is_enabled
        setSavingId(row.id)
        const { error } = await supabase
            .from('system_alarms')
            .update({ is_enabled: next, updated_at: new Date().toISOString() })
            .eq('id', row.id)
        setSavingId(null)
        if (error) {
            toast.error('Toggle fallito: ' + error.message)
            return
        }
        setAlarms(prev => prev.map(a => (a.id === row.id ? { ...a, is_enabled: next } : a)))
    }

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-3 py-6">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-3xl max-h-[88vh] overflow-y-auto bg-theme-bg-primary border border-theme-border rounded-2xl shadow-2xl">
                {/* Header */}
                <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 bg-theme-bg-primary border-b border-theme-border">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-dr7-gold/15 flex items-center justify-center">
                            <svg className="w-5 h-5 text-dr7-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-base sm:text-lg font-semibold text-theme-text-primary">Gestione Allarmi</h2>
                            <p className="text-xs text-theme-text-muted">{alarms.length} allarmi · controllo ogni 60 secondi</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary transition-colors"
                        aria-label="Chiudi"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Audio status */}
                <div className="px-5 py-3 border-b border-theme-border">
                    {audioEnabled ? (
                        <div className="flex items-center gap-2 text-xs text-green-400">
                            <span className="w-2 h-2 rounded-full bg-green-400" />
                            Audio attivato — gli allarmi suoneranno quando le condizioni qui sotto sono soddisfatte.
                        </div>
                    ) : (
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2 text-xs text-amber-400">
                                <span className="w-2 h-2 rounded-full bg-amber-400" />
                                Audio non attivato — gli allarmi appariranno solo come notifica visiva.
                            </div>
                            <button
                                onClick={onEnableAudio}
                                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-dr7-gold text-white hover:opacity-90 transition-opacity"
                            >
                                Attiva audio
                            </button>
                        </div>
                    )}
                </div>

                {/* Add disabled hint */}
                <div className="px-5 py-2 text-[11px] text-theme-text-muted border-b border-theme-border">
                    Modifica e attiva/disattiva gli allarmi esistenti. Aggiungere un nuovo tipo di allarme richiede
                    modifica del codice (la logica trigger è in <code className="bg-theme-bg-tertiary px-1 rounded">VehicleAlarmContext.tsx</code>).
                </div>

                {/* Groups */}
                <div className="px-5 py-4 space-y-6">
                    {loading ? (
                        <p className="text-sm text-theme-text-muted">Caricamento...</p>
                    ) : alarms.length === 0 ? (
                        <p className="text-sm text-amber-400">
                            Nessuna riga in <code>system_alarms</code>. Esegui la migration{' '}
                            <code className="bg-theme-bg-tertiary px-1 rounded">20260428_system_alarms.sql</code> in Supabase.
                        </p>
                    ) : (
                        groups.map(g => {
                            const items = alarms.filter(a => a.category === g.id)
                            if (items.length === 0) return null
                            return (
                                <section key={g.id}>
                                    <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-dr7-gold mb-1">{g.title}</h3>
                                    <p className="text-xs text-theme-text-muted mb-3">{g.subtitle}</p>
                                    <ul className="space-y-3">
                                        {items.map(row => {
                                            const dirty = isDirty(row)
                                            const saving = savingId === row.id
                                            const enabled = valueOf(row, 'is_enabled')
                                            return (
                                                <li key={row.id} className={`rounded-lg border p-3 ${enabled ? 'border-theme-border bg-theme-bg-tertiary/40' : 'border-theme-border/40 bg-theme-bg-tertiary/10 opacity-70'}`}>
                                                    <div className="flex items-start justify-between gap-3 mb-2">
                                                        <div className="flex-1 min-w-0">
                                                            <input
                                                                type="text"
                                                                value={String(valueOf(row, 'label'))}
                                                                onChange={e => setField(row.id, 'label', e.target.value)}
                                                                className="w-full bg-transparent text-sm font-semibold text-theme-text-primary border-b border-transparent focus:border-dr7-gold focus:outline-none px-0 py-0.5"
                                                            />
                                                            <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">{row.id}</span>
                                                        </div>
                                                        {/* Toggle */}
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleEnabled(row)}
                                                            disabled={saving}
                                                            aria-label={enabled ? 'Disattiva' : 'Attiva'}
                                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${enabled ? 'bg-dr7-gold' : 'bg-theme-bg-secondary border border-theme-border'} ${saving ? 'opacity-50 cursor-wait' : ''}`}
                                                        >
                                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                                        </button>
                                                    </div>

                                                    {/* Threshold */}
                                                    <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-y-1.5 gap-x-3 text-xs items-center">
                                                        <span className="text-theme-text-muted">Soglia</span>
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                step={row.threshold_unit === 'km' ? 100 : 1}
                                                                value={Number(valueOf(row, 'threshold_value'))}
                                                                onChange={e => setField(row.id, 'threshold_value', Number(e.target.value))}
                                                                className="w-24 px-2 py-1 rounded bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm"
                                                            />
                                                            <span className="text-theme-text-muted">{UNIT_LABEL[row.threshold_unit]}</span>
                                                        </div>

                                                        <span className="text-theme-text-muted">Quando suona</span>
                                                        <input
                                                            type="text"
                                                            value={String(valueOf(row, 'schedule'))}
                                                            onChange={e => setField(row.id, 'schedule', e.target.value)}
                                                            className="w-full px-2 py-1 rounded bg-theme-bg-primary border border-theme-border text-theme-text-primary"
                                                        />

                                                        <span className="text-theme-text-muted">Motivo</span>
                                                        <textarea
                                                            value={String(valueOf(row, 'reason'))}
                                                            onChange={e => setField(row.id, 'reason', e.target.value)}
                                                            rows={2}
                                                            className="w-full px-2 py-1 rounded bg-theme-bg-primary border border-theme-border text-theme-text-secondary"
                                                        />
                                                    </div>

                                                    {dirty && (
                                                        <div className="mt-2 flex items-center justify-end gap-2">
                                                            <button
                                                                onClick={() => setEditing(prev => { const n = { ...prev }; delete n[row.id]; return n })}
                                                                disabled={saving}
                                                                className="px-3 py-1.5 rounded-full text-xs font-medium bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text-primary"
                                                            >
                                                                Annulla
                                                            </button>
                                                            <button
                                                                onClick={() => saveRow(row)}
                                                                disabled={saving}
                                                                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-dr7-gold text-white hover:opacity-90 disabled:opacity-50"
                                                            >
                                                                {saving ? 'Salvataggio...' : 'Salva'}
                                                            </button>
                                                        </div>
                                                    )}
                                                </li>
                                            )
                                        })}
                                    </ul>
                                </section>
                            )
                        })
                    )}
                </div>

                <div className="px-5 py-3 border-t border-theme-border text-[11px] text-theme-text-muted">
                    Ogni modifica viene salvata in <code className="bg-theme-bg-tertiary px-1.5 py-0.5 rounded">system_alarms</code>.
                    Il polling di <code className="bg-theme-bg-tertiary px-1.5 py-0.5 rounded">VehicleAlarmContext</code> rileva la nuova
                    configurazione entro 60 secondi senza ricaricare.
                </div>
            </div>
        </div>
    )
}
