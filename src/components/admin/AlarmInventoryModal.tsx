/**
 * Gestione Allarmi — catalogo completo.
 *
 * 2026-08-21 (richiesta direzione): da 13 allarmi a 19 gruppi. Ogni riga si
 * accende e si spegne, e per ognuna si scelgono anticipo, priorita', reparto
 * responsabile, ripetizione finche' non e' risolto e canali di notifica
 * (gestionale, push, WhatsApp o email interna).
 *
 * Cosa si vede qui e cosa no:
 *   - qui c'e' la configurazione GENERALE dell'allarme;
 *   - l'ON/OFF sulla SINGOLA pratica sta sulla pratica (tabella
 *     alarm_overrides), non in questo elenco: spegnere un allarme per una
 *     prenotazione non deve spegnerlo per tutte;
 *   - "Risolto", "Posticipa" e la cronologia di chi ha risolto stanno nel
 *     pannello degli allarmi aperti (tabella alarm_events).
 *
 * Una riga senza `detector` NON puo' suonare: la rilevazione e' codice. Invece
 * di nasconderlo, la riga lo dichiara ("in attesa") — un interruttore che
 * sembra acceso ma non guarda niente e' peggio di un interruttore mancante.
 */
import { useEffect, useMemo, useState } from 'react'
import { ALARM_SOUNDS, ascoltaAnteprima, type AlarmSoundKey } from '../../utils/alarmSounds'
import {
    ALARM_GROUPS,
    PRIORITY_LABEL,
    PRIORITY_STYLE,
    REPARTI,
    UNIT_LABEL,
    type AlarmPriority,
    type AlarmThresholdUnit,
} from '../../data/alarmCatalog'
import { supabase } from '../../supabaseClient'
import toast from 'react-hot-toast'

interface Destinatario { nome?: string; telefono?: string; email?: string }

interface AlarmRow {
    id: string
    label: string
    schedule: string
    reason: string
    category: 'booking' | 'fleet'
    group_key: string | null
    priority: AlarmPriority
    reparto: string | null
    detector: string | null
    stato_rilevamento: 'attivo' | 'in_attesa'
    threshold_value: number
    threshold_unit: AlarmThresholdUnit
    is_enabled: boolean
    ripeti_finche_non_risolto: boolean
    ripeti_ogni_minuti: number
    notifica_gestionale: boolean
    notifica_push: boolean
    notifica_whatsapp_interna: boolean
    notifica_email_interna: boolean
    destinatari: Destinatario[] | null
    sort_order: number
    message_key: string | null
    sound_key?: string | null
}

interface Props {
    isOpen?: boolean
    onClose?: () => void
    audioEnabled: boolean
    onEnableAudio: () => void
    /** Reso come SEZIONE (Centralina Pro > Allarmi) invece che come modale. */
    embedded?: boolean
}

type FiltroStato = 'tutti' | 'accesi' | 'spenti' | 'attivi' | 'in_attesa'

export default function AlarmInventoryModal({ isOpen, onClose, audioEnabled, onEnableAudio, embedded = false }: Props) {
    const [alarms, setAlarms] = useState<AlarmRow[]>([])
    const [loading, setLoading] = useState(false)
    const [savingId, setSavingId] = useState<string | null>(null)
    const [editing, setEditing] = useState<Record<string, Partial<AlarmRow>>>({})
    const [aperti, setAperti] = useState<Set<string>>(new Set())
    const [gruppiAperti, setGruppiAperti] = useState<Set<string>>(new Set())
    const [ricerca, setRicerca] = useState('')
    const [filtro, setFiltro] = useState<FiltroStato>('tutti')
    // Elenco dei messaggi disponibili: stessa tabella di Messaggi di Sistema
    // Pro, nessun elenco parallelo da tenere allineato a mano.
    const [templates, setTemplates] = useState<{ key: string; label: string }[]>([])

    useEffect(() => {
        if (!isOpen && !embedded) return
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
        ;(async () => {
            const { data } = await supabase
                .from('system_messages')
                .select('message_key, label, is_enabled, message_body')
                .order('label', { ascending: true })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rows = ((data || []) as any[])
                .filter(t => t.is_enabled !== false && String(t.message_body || '').trim())
                .filter(t => !String(t.message_key || '').startsWith('pro_wrapper_'))
            setTemplates(rows.map(t => ({ key: String(t.message_key), label: String(t.label || t.message_key) })))
        })()
    }, [isOpen, embedded])

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
        const { error } = await supabase
            .from('system_alarms')
            .update({ ...e, updated_at: new Date().toISOString() })
            .eq('id', row.id)
        setSavingId(null)
        if (error) {
            toast.error('Salvataggio fallito: ' + error.message)
            return
        }
        toast.success('Salvato')
        setAlarms(prev => prev.map(a => (a.id === row.id ? { ...a, ...e } as AlarmRow : a)))
        setEditing(prev => { const n = { ...prev }; delete n[row.id]; return n })
    }

    const toggleEnabled = async (row: AlarmRow) => {
        const next = !row.is_enabled
        setSavingId(row.id)
        const { error } = await supabase
            .from('system_alarms')
            .update({ is_enabled: next, updated_at: new Date().toISOString() })
            .eq('id', row.id)
        setSavingId(null)
        if (error) { toast.error('Toggle fallito: ' + error.message); return }
        setAlarms(prev => prev.map(a => (a.id === row.id ? { ...a, is_enabled: next } : a)))
    }

    /** Accendi/spegni tutto un gruppo in un colpo solo. */
    const toggleGruppo = async (groupKey: string, next: boolean) => {
        const ids = alarms
            .filter(a => (a.group_key ?? a.category) === groupKey)
            .map(a => a.id)
        if (ids.length === 0) return
        setSavingId(groupKey)
        const { error } = await supabase
            .from('system_alarms')
            .update({ is_enabled: next, updated_at: new Date().toISOString() })
            .in('id', ids)
        setSavingId(null)
        if (error) { toast.error('Aggiornamento gruppo fallito: ' + error.message); return }
        setAlarms(prev => prev.map(a => (ids.includes(a.id) ? { ...a, is_enabled: next } : a)))
        toast.success(next ? `${ids.length} allarmi accesi` : `${ids.length} allarmi spenti`)
    }

    const filtrati = useMemo(() => {
        const q = ricerca.trim().toLowerCase()
        return alarms.filter(a => {
            if (q && !(`${a.label} ${a.id} ${a.reparto || ''}`.toLowerCase().includes(q))) return false
            if (filtro === 'accesi' && !a.is_enabled) return false
            if (filtro === 'spenti' && a.is_enabled) return false
            if (filtro === 'attivi' && a.stato_rilevamento !== 'attivo') return false
            if (filtro === 'in_attesa' && a.stato_rilevamento !== 'in_attesa') return false
            return true
        })
    }, [alarms, ricerca, filtro])

    // La migration 20260821 aggiunge group_key & co. Se il deploy del codice
    // arriva PRIMA che la migration sia stata eseguita, `group_key` non esiste
    // e raggruppare per catalogo darebbe una schermata VUOTA — cioe' l'intero
    // pannello allarmi fuori uso. In quel caso si torna ai due gruppi storici
    // e si mostra cosa manca, invece di lasciare il vuoto.
    const migrazioneMancante = alarms.length > 0 && alarms.every(a => a.group_key == null)

    const gruppiVisibili = useMemo(() => (
        migrazioneMancante
            ? [
                { key: 'booking', num: 1, title: 'Prenotazioni', hint: 'Eventi legati al ciclo di vita di un noleggio o lavaggio.' },
                { key: 'fleet', num: 2, title: 'Manutenzione flotta', hint: 'Soglie km e date di scadenza per ogni veicolo attivo.' },
            ]
            : ALARM_GROUPS
    ), [migrazioneMancante])

    const conteggi = useMemo(() => ({
        totale: alarms.length,
        accesi: alarms.filter(a => a.is_enabled).length,
        attivi: alarms.filter(a => a.stato_rilevamento === 'attivo').length,
    }), [alarms])

    // Con la ricerca aperta si mostrano i gruppi che hanno risultati, gia'
    // espansi: cercare e poi dover aprire a mano sarebbe una seconda fatica.
    const cercando = ricerca.trim().length > 0 || filtro !== 'tutti'

    const toggleGruppoAperto = (key: string) => {
        setGruppiAperti(prev => {
            const n = new Set(prev)
            if (n.has(key)) n.delete(key); else n.add(key)
            return n
        })
    }

    const toggleRigaAperta = (id: string) => {
        setAperti(prev => {
            const n = new Set(prev)
            if (n.has(id)) n.delete(id); else n.add(id)
            return n
        })
    }

    const Switch = ({ on, onClick, disabled, small }: { on: boolean; onClick: () => void; disabled?: boolean; small?: boolean }) => (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={on ? 'Disattiva' : 'Attiva'}
            className={`relative inline-flex items-center rounded-full transition-colors shrink-0 ${small ? 'h-5 w-9' : 'h-6 w-11'} ${on ? 'bg-dr7-gold' : 'bg-theme-bg-secondary border border-theme-border'} ${disabled ? 'opacity-50 cursor-wait' : ''}`}
        >
            <span className={`inline-block transform rounded-full bg-white transition-transform ${small ? 'h-3.5 w-3.5' : 'h-4 w-4'} ${on ? (small ? 'translate-x-5' : 'translate-x-6') : 'translate-x-1'}`} />
        </button>
    )

    const corpo = (
        <>
            {/* Intestazione */}
            <div className="sticky top-0 z-10 px-5 py-4 bg-theme-bg-primary border-b border-theme-border">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-dr7-gold/15 flex items-center justify-center">
                            <svg className="w-5 h-5 text-dr7-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-base sm:text-lg font-semibold text-theme-text-primary">Gestione Allarmi</h2>
                            <p className="text-xs text-theme-text-muted">
                                {conteggi.totale} allarmi · {conteggi.accesi} accesi · {conteggi.attivi} con rilevazione attiva · controllo ogni 60 secondi
                            </p>
                        </div>
                    </div>
                    {!embedded && (
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary transition-colors"
                            aria-label="Chiudi"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    )}
                </div>

                {/* Ricerca + filtri */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                        type="text"
                        value={ricerca}
                        onChange={e => setRicerca(e.target.value)}
                        placeholder="Cerca un allarme, un reparto..."
                        className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary placeholder:text-theme-text-muted"
                    />
                    {([
                        ['tutti', 'Tutti'],
                        ['accesi', 'Accesi'],
                        ['spenti', 'Spenti'],
                        ['attivi', 'Rilevazione attiva'],
                        ['in_attesa', 'In attesa'],
                    ] as [FiltroStato, string][]).map(([k, lbl]) => (
                        <button
                            key={k}
                            type="button"
                            onClick={() => setFiltro(k)}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${filtro === k ? 'bg-dr7-gold text-white' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:text-theme-text-primary'}`}
                        >
                            {lbl}
                        </button>
                    ))}
                </div>
            </div>

            {/* Stato audio */}
            <div className="px-5 py-3 border-b border-theme-border">
                {audioEnabled ? (
                    <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                        Audio attivato — gli allarmi suoneranno quando le condizioni sono soddisfatte.
                    </div>
                ) : (
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                            <span className="w-2 h-2 rounded-full bg-amber-500" />
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

            {migrazioneMancante && (
                <div className="px-5 py-3 border-b border-theme-border bg-amber-500/10">
                    <p className="text-[12px] text-amber-700 dark:text-amber-300">
                        <strong>Catalogo non ancora installato.</strong> Qui sotto ci sono solo i {alarms.length} allarmi
                        storici, con i comandi di prima. Per avere i 19 gruppi, la priorita&apos;, il reparto, la
                        ripetizione e i canali di notifica, esegui la migration{' '}
                        <code className="bg-theme-bg-tertiary px-1 rounded">20260821_alarm_engine.sql</code> in Supabase:
                        finche&apos; non gira, gli allarmi funzionano come sempre.
                    </p>
                </div>
            )}

            <div className="px-5 py-2 text-[11px] text-theme-text-muted border-b border-theme-border space-y-1">
                <p>
                    Gli allarmi sono UNICI per tutta l&apos;azienda: non cambiano da un business all&apos;altro.
                    Quello che modifichi qui vale ovunque.
                </p>
                <p>
                    <strong className="text-theme-text-secondary">Rilevazione attiva</strong> = il gestionale sa gia&apos; riconoscere
                    la condizione e l&apos;allarme suona. <strong className="text-theme-text-secondary">In attesa</strong> = la voce e&apos;
                    configurabile ma la rilevazione non e&apos; ancora scritta: resta muta finche&apos; non lo diventa.
                </p>
                <p>
                    Spegnere un allarme su UNA singola pratica si fa dalla pratica, non da qui: qui si decide
                    per tutte. &quot;Risolto&quot;, &quot;Posticipa&quot; e la cronologia stanno nel pannello degli allarmi aperti.
                </p>
            </div>

            {/* Gruppi */}
            <div className="px-5 py-4 space-y-3">
                {loading ? (
                    <p className="text-sm text-theme-text-muted">Caricamento...</p>
                ) : alarms.length === 0 ? (
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                        Nessuna riga in <code>system_alarms</code>. Esegui la migration{' '}
                        <code className="bg-theme-bg-tertiary px-1 rounded">20260821_alarm_engine.sql</code> in Supabase.
                    </p>
                ) : (
                    gruppiVisibili.map(g => {
                        const items = filtrati.filter(a => (migrazioneMancante ? a.category : a.group_key) === g.key)
                        if (items.length === 0) return null
                        const aperto = cercando || gruppiAperti.has(g.key)
                        const accesiNelGruppo = items.filter(a => a.is_enabled).length
                        return (
                            <section key={g.key} className="rounded-xl border border-theme-border bg-theme-bg-tertiary/30 overflow-hidden">
                                <div className="flex items-center gap-3 px-4 py-3">
                                    <button
                                        type="button"
                                        onClick={() => toggleGruppoAperto(g.key)}
                                        className="flex-1 flex items-center gap-3 text-left min-w-0"
                                    >
                                        <span className={`text-theme-text-muted transition-transform ${aperto ? 'rotate-90' : ''}`}>›</span>
                                        <span className="min-w-0">
                                            <span className="block text-[13px] font-bold text-theme-text-primary truncate">
                                                {g.num}. {g.title}
                                            </span>
                                            <span className="block text-[11px] text-theme-text-muted truncate">{g.hint}</span>
                                        </span>
                                    </button>
                                    <span className="text-[11px] text-theme-text-muted shrink-0 tabular-nums">
                                        {accesiNelGruppo}/{items.length} accesi
                                    </span>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => toggleGruppo(g.key, true)}
                                            disabled={savingId === g.key}
                                            className="px-2 py-1 rounded text-[11px] font-semibold bg-theme-bg-secondary text-theme-text-secondary hover:text-theme-text-primary"
                                        >
                                            Accendi tutti
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => toggleGruppo(g.key, false)}
                                            disabled={savingId === g.key}
                                            className="px-2 py-1 rounded text-[11px] font-semibold bg-theme-bg-secondary text-theme-text-secondary hover:text-theme-text-primary"
                                        >
                                            Spegni tutti
                                        </button>
                                    </div>
                                </div>

                                {aperto && (
                                    <ul className="border-t border-theme-border divide-y divide-theme-border/60">
                                        {items.map(row => {
                                            const dirty = isDirty(row)
                                            const saving = savingId === row.id
                                            const enabled = valueOf(row, 'is_enabled')
                                            const prio = valueOf(row, 'priority') || 'attenzione'
                                            const stile = PRIORITY_STYLE[prio]
                                            const espanso = aperti.has(row.id)
                                            const muto = !migrazioneMancante && row.stato_rilevamento !== 'attivo'
                                            return (
                                                <li key={row.id} className={`px-4 py-3 ${enabled ? '' : 'opacity-60'}`}>
                                                    <div className="flex items-start gap-3">
                                                        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${stile.dot}`} title={PRIORITY_LABEL[prio]} />
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleRigaAperta(row.id)}
                                                            className="flex-1 min-w-0 text-left"
                                                        >
                                                            <span className="block text-[13px] font-semibold text-theme-text-primary">{valueOf(row, 'label')}</span>
                                                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[10px] text-theme-text-muted">
                                                                <span className={stile.text}>{PRIORITY_LABEL[prio]}</span>
                                                                <span>·</span>
                                                                <span>
                                                                    {valueOf(row, 'threshold_value')} {UNIT_LABEL[valueOf(row, 'threshold_unit')]}
                                                                </span>
                                                                {valueOf(row, 'reparto') && (<><span>·</span><span>{valueOf(row, 'reparto')}</span></>)}
                                                                {muto && (
                                                                    <>
                                                                        <span>·</span>
                                                                        <span className="px-1.5 py-0.5 rounded-full border border-theme-border text-theme-text-muted">
                                                                            in attesa di rilevazione
                                                                        </span>
                                                                    </>
                                                                )}
                                                            </span>
                                                        </button>
                                                        <Switch on={!!enabled} onClick={() => toggleEnabled(row)} disabled={saving} />
                                                    </div>

                                                    {espanso && (
                                                        <div className="mt-3 pl-5 grid grid-cols-1 sm:grid-cols-[130px_1fr] gap-y-2 gap-x-3 text-xs items-center">
                                                            {!migrazioneMancante && <>
                                                            {/* Priorita' */}
                                                            <span className="text-theme-text-muted">Priorita&apos;</span>
                                                            <div className="flex flex-wrap items-center gap-1">
                                                                {(['informativo', 'attenzione', 'urgente', 'bloccante'] as AlarmPriority[]).map(p => (
                                                                    <button
                                                                        key={p}
                                                                        type="button"
                                                                        onClick={() => setField(row.id, 'priority', p)}
                                                                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${prio === p ? `${PRIORITY_STYLE[p].chip} ${PRIORITY_STYLE[p].text}` : 'border-theme-border text-theme-text-muted hover:text-theme-text-primary'}`}
                                                                    >
                                                                        {PRIORITY_LABEL[p]}
                                                                    </button>
                                                                ))}
                                                            </div>

                                                            {/* Anticipo */}
                                                            <span className="text-theme-text-muted">Anticipo</span>
                                                            <div className="flex items-center gap-2">
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    step={valueOf(row, 'threshold_unit') === 'km' ? 100 : 1}
                                                                    value={Number(valueOf(row, 'threshold_value'))}
                                                                    onChange={e => setField(row.id, 'threshold_value', Number(e.target.value))}
                                                                    className="w-24 px-2 py-1 rounded bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm"
                                                                />
                                                                <select
                                                                    value={String(valueOf(row, 'threshold_unit'))}
                                                                    onChange={e => setField(row.id, 'threshold_unit', e.target.value as AlarmThresholdUnit)}
                                                                    className="px-2 py-1 rounded bg-theme-bg-primary border border-theme-border text-theme-text-primary"
                                                                >
                                                                    {(Object.keys(UNIT_LABEL) as AlarmThresholdUnit[]).map(u => (
                                                                        <option key={u} value={u}>{UNIT_LABEL[u]}</option>
                                                                    ))}
                                                                </select>
                                                            </div>

                                                            {/* Ripetizione */}
                                                            <span className="text-theme-text-muted">Ripeti se non risolto</span>
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <Switch
                                                                    small
                                                                    on={!!valueOf(row, 'ripeti_finche_non_risolto')}
                                                                    onClick={() => setField(row.id, 'ripeti_finche_non_risolto', !valueOf(row, 'ripeti_finche_non_risolto'))}
                                                                />
                                                                {valueOf(row, 'ripeti_finche_non_risolto') && (
                                                                    <span className="flex items-center gap-2">
                                                                        <span className="text-theme-text-muted">ogni</span>
                                                                        <input
                                                                            type="number"
                                                                            min={1}
                                                                            value={Number(valueOf(row, 'ripeti_ogni_minuti') ?? 30)}
                                                                            onChange={e => setField(row.id, 'ripeti_ogni_minuti', Number(e.target.value))}
                                                                            className="w-20 px-2 py-1 rounded bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm"
                                                                        />
                                                                        <span className="text-theme-text-muted">minuti</span>
                                                                    </span>
                                                                )}
                                                            </div>

                                                            {/* Responsabile */}
                                                            <span className="text-theme-text-muted">Responsabile</span>
                                                            <div className="flex items-center gap-2">
                                                                <select
                                                                    value={REPARTI.includes(String(valueOf(row, 'reparto')) as typeof REPARTI[number]) ? String(valueOf(row, 'reparto')) : '__altro__'}
                                                                    onChange={e => setField(row.id, 'reparto', e.target.value === '__altro__' ? '' : e.target.value)}
                                                                    className="px-2 py-1 rounded bg-theme-bg-primary border border-theme-border text-theme-text-primary"
                                                                >
                                                                    {REPARTI.map(r => <option key={r} value={r}>{r}</option>)}
                                                                    <option value="__altro__">Altro...</option>
                                                                </select>
                                                                {!REPARTI.includes(String(valueOf(row, 'reparto')) as typeof REPARTI[number]) && (
                                                                    <input
                                                                        type="text"
                                                                        value={String(valueOf(row, 'reparto') || '')}
                                                                        onChange={e => setField(row.id, 'reparto', e.target.value)}
                                                                        placeholder="Nome del responsabile"
                                                                        className="flex-1 px-2 py-1 rounded bg-theme-bg-primary border border-theme-border text-theme-text-primary"
                                                                    />
                                                                )}
                                                            </div>

                                                            {/* Canali */}
                                                            <span className="text-theme-text-muted">Notifiche</span>
                                                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                                                                {([
                                                                    ['notifica_gestionale', 'Gestionale'],
                                                                    ['notifica_push', 'Push'],
                                                                    ['notifica_whatsapp_interna', 'WhatsApp interna'],
                                                                    ['notifica_email_interna', 'Email interna'],
                                                                ] as [keyof AlarmRow, string][]).map(([k, lbl]) => (
                                                                    <label key={String(k)} className="flex items-center gap-1.5 cursor-pointer">
                                                                        <Switch
                                                                            small
                                                                            on={!!valueOf(row, k)}
                                                                            onClick={() => setField(row.id, k, !valueOf(row, k))}
                                                                        />
                                                                        <span className="text-theme-text-secondary">{lbl}</span>
                                                                    </label>
                                                                ))}
                                                            </div>

                                                            {/* Destinatari interni: servono solo se un canale interno e' acceso */}
                                                            {(valueOf(row, 'notifica_whatsapp_interna') || valueOf(row, 'notifica_email_interna')) && (
                                                                <>
                                                                    <span className="text-theme-text-muted">Destinatari</span>
                                                                    <div>
                                                                        <input
                                                                            type="text"
                                                                            value={(valueOf(row, 'destinatari') || [])
                                                                                .map(d => d.telefono || d.email || d.nome || '')
                                                                                .filter(Boolean).join(', ')}
                                                                            onChange={e => setField(row.id, 'destinatari', e.target.value
                                                                                .split(',')
                                                                                .map(s => s.trim())
                                                                                .filter(Boolean)
                                                                                .map(v => (v.includes('@') ? { email: v } : { telefono: v })))}
                                                                            placeholder="+39333..., ufficio@dr7.app"
                                                                            className="w-full px-2 py-1 rounded bg-theme-bg-primary border border-theme-border text-theme-text-primary"
                                                                        />
                                                                        <p className="mt-1 text-[10px] text-theme-text-muted">
                                                                            Numeri e indirizzi separati da virgola. Il numero va su WhatsApp, l&apos;indirizzo via email.
                                                                        </p>
                                                                    </div>
                                                                </>
                                                            )}

                                                            </>}

                                                            {/* Quando suona / Motivo */}
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

                                                            {/* Suono */}
                                                            <span className="text-theme-text-muted">Suono</span>
                                                            <div>
                                                                <div className="flex items-center gap-2">
                                                                    <select
                                                                        value={String(valueOf(row, 'sound_key') || 'classic')}
                                                                        onChange={e => setField(row.id, 'sound_key', e.target.value)}
                                                                        className="flex-1 px-2 py-1 rounded bg-theme-bg-primary border border-theme-border text-theme-text-primary"
                                                                    >
                                                                        {ALARM_SOUNDS.map(sn => (
                                                                            <option key={sn.key} value={sn.key}>{sn.label}</option>
                                                                        ))}
                                                                    </select>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => ascoltaAnteprima(String(valueOf(row, 'sound_key') || 'classic') as AlarmSoundKey)}
                                                                        title="Ascolta questo suono"
                                                                        className="shrink-0 px-2 py-1 rounded border border-theme-border text-theme-text-secondary hover:text-dr7-gold"
                                                                    >&#9654;</button>
                                                                </div>
                                                            </div>

                                                            {/* Messaggio al cliente — solo dove un cliente esiste. */}
                                                            {row.category === 'booking' && (
                                                                <>
                                                                    <span className="text-theme-text-muted">Messaggio al cliente</span>
                                                                    <div>
                                                                        <select
                                                                            value={String(valueOf(row, 'message_key') || '')}
                                                                            onChange={e => setField(row.id, 'message_key', e.target.value || null)}
                                                                            className="w-full px-2 py-1 rounded bg-theme-bg-primary border border-theme-border text-theme-text-primary"
                                                                        >
                                                                            <option value="">— nessuno, non mostrare il pulsante —</option>
                                                                            {templates.map(t => (
                                                                                <option key={t.key} value={t.key}>{t.label}</option>
                                                                            ))}
                                                                        </select>
                                                                        <p className="mt-1 text-[10px] text-theme-text-muted">
                                                                            Quando l&apos;allarme suona, l&apos;operatore vede &quot;Avvisa il cliente&quot; e parte
                                                                            questo messaggio. Il testo si scrive in Messaggi di Sistema Pro.
                                                                        </p>
                                                                    </div>
                                                                </>
                                                            )}

                                                            <span className="text-theme-text-muted">Identificativo</span>
                                                            <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">
                                                                {row.id}
                                                                {migrazioneMancante ? '' : (row.detector ? ` · rilevazione ${row.detector}` : ' · nessuna rilevazione collegata')}
                                                            </span>
                                                        </div>
                                                    )}

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
                                )}
                            </section>
                        )
                    })
                )}
            </div>

            <div className="px-5 py-3 border-t border-theme-border text-[11px] text-theme-text-muted">
                Ogni modifica viene salvata in <code className="bg-theme-bg-tertiary px-1.5 py-0.5 rounded">system_alarms</code>.
                Il motore rileva la nuova configurazione entro 60 secondi senza ricaricare la pagina.
            </div>
        </>
    )

    if (!isOpen && !embedded) return null

    if (embedded) {
        return (
            <div className="bg-theme-bg-primary border border-theme-border rounded-2xl overflow-hidden">
                {corpo}
            </div>
        )
    }

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-3 py-6">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-3xl max-h-[88vh] overflow-y-auto bg-theme-bg-primary border border-theme-border rounded-2xl shadow-2xl">
                {corpo}
            </div>
        </div>
    )
}
