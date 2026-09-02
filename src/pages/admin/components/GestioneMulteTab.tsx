import { useState, useEffect, useRef } from 'react'
import { ScheletroTabella } from '../../../components/Scheletro'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import { logger } from '../../../utils/logger'
import { loadMulteConfig, MULTE_CONFIG_DEFAULTS, type MulteConfigValues } from './MulteConfigSection'
import { bookingBelongsTo, toBusiness, BUSINESS_LABELS, BUSINESSES, type Business } from '../../../utils/businessScope'
import { businessRowForServiceType } from '../../../utils/businessConfigClient'
import NumeroTelefono from '../../../components/NumeroTelefono'

/**
 * 2026-08-24 (direzione): "Multe" e' nel menu di ogni business. Lo storico
 * degli invii PEC va filtrato per business, altrimenti dal Mare si leggono
 * le multe delle auto del Noleggio Terra. Il business si ricava dalla
 * prenotazione collegata (`multe_pec_log.booking_id`); le righe senza
 * prenotazione restano su Terra, dove sono sempre state.
 */
export default function GestioneMulteTab({ business }: { business?: Business | string } = {}) {
    // Senza `business` la tab e' quella unica di Amministrazione: i business
    // sono sotto-schede qui dentro, non cinque voci nel menu.
    const [bizScelto, setBizScelto] = useState<Business>(toBusiness(business || 'rental'))
    const biz = business ? toBusiness(business) : bizScelto
    const mostraSelettore = !business
    const [activeSubTab, setActiveSubTab] = useState<'history' | 'upload'>('history')
    // Multa Upload + PEC State
    const [multaFile, setMultaFile] = useState<File | null>(null)
    const [multaPdfBase64, setMultaPdfBase64] = useState('')
    const [multaProcessing, setMultaProcessing] = useState(false)
    const [multaStep, setMultaStep] = useState<'upload' | 'review' | 'sent'>('upload')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [multaData, setMultaData] = useState<any>(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [driverData, setDriverData] = useState<any>(null)
    const [letterText, setLetterText] = useState('')
    const [pecSending, setPecSending] = useState(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [pecResult, setPecResult] = useState<any>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // ── Destinatario PEC dinamico (organo accertatore) ───────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [pecRecipient, setPecRecipient] = useState<any>(null)  // proposta backend
    const [chosenPec, setChosenPec] = useState('')               // destinatario effettivo
    const [chosenEnteId, setChosenEnteId] = useState<string | null>(null)
    const [selMode, setSelMode] = useState<'automatica' | 'rubrica' | 'manuale' | 'verbale'>('manuale')
    const [confirmRecipient, setConfirmRecipient] = useState(false)
    const [showChangeRecipient, setShowChangeRecipient] = useState(false)
    const [rubricaQuery, setRubricaQuery] = useState('')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rubricaResults, setRubricaResults] = useState<any[]>([])
    const [ccInput, setCcInput] = useState('')
    // ── Dati azienda per QUESTA multa (24/08/2026) ───────────────────────────
    // I dati fissi stanno in Centralina Pro > Gestione Multe. Qui si possono
    // sovrascrivere per il singolo verbale: capita di dover indicare un
    // indirizzo diverso (multa estera, sede operativa, domicilio eletto).
    const [azienda, setAzienda] = useState<MulteConfigValues>(MULTE_CONFIG_DEFAULTS)
    const [aziendaBase, setAziendaBase] = useState<MulteConfigValues>(MULTE_CONFIG_DEFAULTS)
    const [mostraAzienda, setMostraAzienda] = useState(false)

    // Dati azienda e PEC della multa = quelli del business della tab: dal Mare
    // la lettera parte con la ragione sociale e la casella del Mare, non con
    // quelle del Noleggio Terra (che restano l'eredita' se il Mare non ne ha).
    useEffect(() => {
        void (async () => {
            const cfg = await loadMulteConfig(businessRowForServiceType(biz))
            setAzienda(cfg); setAziendaBase(cfg)
        })()
    }, [biz])

    function looksLikePec(email: string): boolean {
        const e = (email || '').toLowerCase().trim()
        if (!/\S+@\S+\.\S+/.test(e)) return false
        const domain = e.split('@')[1] || ''
        return /pec|legalmail|postecert|sicurezzapostale|cert\./.test(domain)
    }

    async function searchRubrica(q: string) {
        setRubricaQuery(q)
        if (q.trim().length < 2) { setRubricaResults([]); return }
        const { data } = await supabase
            .from('enti_notificatori')
            .select('id, denominazione, comune, provincia, pec, tipo_ente')
            .eq('attivo', true)
            .or(`denominazione.ilike.%${q}%,comune.ilike.%${q}%`)
            .limit(15)
        setRubricaResults(data || [])
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function pickRubricaEnte(ente: any) {
        setChosenPec(ente.pec)
        setChosenEnteId(ente.id)
        setSelMode('rubrica')
        setConfirmRecipient(false)
        setShowChangeRecipient(false)
        setRubricaQuery(''); setRubricaResults([])
    }

    const [syncingIpa, setSyncingIpa] = useState(false)
    async function handleSyncIpa() {
        setSyncingIpa(true)
        try {
            const res = await fetch('/.netlify/functions/sync-ipa', { method: 'POST' })
            const data = await res.json()
            if (!res.ok || data.ok === false) { toast.error('Sync IPA fallito: ' + (data.error || res.status)); return }
            toast.success(`Rubrica aggiornata: ${data.upserted}/${data.total} enti con PEC`)
        } catch (e) {
            toast.error('Errore sync IPA: ' + (e as Error).message)
        } finally { setSyncingIpa(false) }
    }

    async function handleAddToRubrica() {
        const pec = chosenPec.trim().toLowerCase()
        if (!pec || !looksLikePec(pec)) { toast.error('PEC non valida'); return }
        const denominazione = (multaData?.ente_denominazione || '').trim() || `Ente ${multaData?.comune || ''}`.trim()
        const { data, error } = await supabase.from('enti_notificatori').insert({
            denominazione,
            tipo_ente: multaData?.ente_tipo || 'altro',
            comune: multaData?.comune || null,
            provincia: multaData?.provincia || null,
            pec,
            fonte: 'verbale',
            verificata_il: new Date().toISOString(),
        }).select('id').single()
        if (error) { toast.error('Errore salvataggio rubrica: ' + error.message); return }
        setChosenEnteId(data.id)
        toast.success('Ente aggiunto alla rubrica')
    }

    // PEC History
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [pecHistory, setPecHistory] = useState<any[]>([])
    const [loadingHistory, setLoadingHistory] = useState(false)

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { loadPecHistory() }, [biz])

    async function loadPecHistory() {
        setLoadingHistory(true)
        try {
            const { data, error } = await supabase
                .from('multe_pec_log')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(200)
            if (!error && data) {
                // Business della multa = business della prenotazione collegata.
                const ids = Array.from(new Set(data.map(r => r.booking_id).filter(Boolean)))
                const bizById = new Map<string, string>()
                if (ids.length) {
                    const { data: bks } = await supabase
                        .from('bookings')
                        .select('id, service_type, vehicle_type, booking_details')
                        .in('id', ids)
                    for (const b of (bks || [])) bizById.set(String(b.id), bookingBelongsTo(b, biz) ? 'yes' : 'no')
                }
                const filtered = data.filter(r => {
                    if (!r.booking_id) return biz === 'rental'
                    return bizById.get(String(r.booking_id)) === 'yes'
                })
                setPecHistory(filtered.slice(0, 50))
            }
        } catch {
            // Table might not exist yet — that's fine
            logger.warn('[GestioneMulte] multe_pec_log table not found, skipping history')
        } finally {
            setLoadingHistory(false)
        }
    }

    // ── Multa Upload Handlers ────────────────────────────────────────────────

    function handleMultaFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        setMultaFile(file)
        setMultaStep('upload')
        setMultaData(null)
        setDriverData(null)
        setLetterText('')
        setPecResult(null)
        const reader = new FileReader()
        reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1]
            setMultaPdfBase64(base64)
        }
        reader.readAsDataURL(file)
    }

    async function handleProcessMulta() {
        if (!multaPdfBase64) { toast.error('Carica prima un PDF'); return }
        setMultaProcessing(true)
        try {
            const res = await fetch('/.netlify/functions/process-multa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'fullProcess', pdfBase64: multaPdfBase64 }),
            })
            const data = await res.json()
            if (data.error) {
                toast.error(data.error)
                if (data.multaData) setMultaData(data.multaData)
                return
            }
            setMultaData(data.multaData)
            setDriverData(data.driver)
            setLetterText(data.letterText)
            // Destinatario PEC proposto dal riconoscimento dell'organo accertatore.
            const rec = data.pecRecipient || null
            setPecRecipient(rec)
            // Se dal verbale non si ricava l'ente si usa il "Destinatario di
            // riserva" di Centralina Pro > Gestione Multe, invece di lasciare
            // il campo vuoto: quello e' il posto dove l'indirizzo si cambia.
            const riserva = (aziendaBase.destinatario_default || '').trim()
            const proposto = rec?.pec || riserva
            setChosenPec(proposto)
            setChosenEnteId(rec?.ente_id || null)
            setSelMode(rec?.source === 'verbale' ? 'verbale' : rec?.source === 'rubrica' ? (rec.confidence >= 0.85 ? 'automatica' : 'rubrica') : 'manuale')
            setConfirmRecipient(false)
            // Con la riserva la proposta c'e' ma va comunque guardata.
            setShowChangeRecipient(!rec?.pec)
            setMultaStep('review')
            toast.success('Conducente trovato! Controlla i dati prima di inviare.')
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + _errMsg)
        } finally {
            setMultaProcessing(false)
        }
    }

    async function handleSendPec() {
        if (!multaData || !driverData) { toast.error('Dati mancanti'); return }
        // Regola non negoziabile: mai un invio a destinatario non confermato.
        // Piu' destinatari: si possono scrivere separati da virgola, punto e
        // virgola o a capo. Il primo e' il destinatario, gli altri viaggiano in
        // copia (il log e la conferma mostrano l'elenco completo).
        const destList = chosenPec.split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean)
        const destInvalidi = destList.filter(x => !/\S+@\S+\.\S+/.test(x))
        if (destList.length === 0 || destInvalidi.length > 0) {
            toast.error(destInvalidi.length > 0
                ? `Indirizzo non valido: ${destInvalidi[0]}`
                : 'Destinatario PEC mancante — scegli o inserisci un indirizzo')
            return
        }
        const dest = destList[0]
        const destExtra = destList.slice(1)
        if (!confirmRecipient) {
            toast.error('Conferma il destinatario prima di inviare'); return
        }
        // Avviso invio duplicato per la stessa multa (non blocca, chiede conferma).
        const alreadySent = pecHistory.find(h => h.numero_verbale && multaData.numero_verbale && h.numero_verbale === multaData.numero_verbale)
        if (alreadySent && !window.confirm(`Questa multa (verbale ${multaData.numero_verbale}) risulta già inviata il ${new Date(alreadySent.created_at).toLocaleDateString('it-IT')} a ${alreadySent.pec_to}. Inviare di nuovo?`)) {
            return
        }
        const ccList = [
            ...destExtra,
            ...ccInput.split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(s => /\S+@\S+\.\S+/.test(s)),
        ].filter((v, i, a) => a.indexOf(v) === i && v !== dest)
        setPecSending(true)
        try {
            const res = await fetch('/.netlify/functions/process-multa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'sendPec',
                    pdfBase64: multaPdfBase64,
                    pdfFileName: multaFile?.name,
                    multaData,
                    driverData,
                    letterText,
                    pecTo: dest,
                    pecCc: ccList,
                    // Solo i campi davvero cambiati rispetto alla config: il
                    // backend ignora le stringhe vuote e tiene i suoi valori.
                    aziendaOverride: Object.fromEntries(
                        (Object.keys(azienda) as Array<keyof MulteConfigValues>)
                            .filter(k => azienda[k] !== aziendaBase[k])
                            .map(k => [k, azienda[k]])
                    ),
                }),
            })
            const data = await res.json()
            if (data.error) { toast.error('Errore invio PEC: ' + data.error); return }
            setPecResult({ ...data, pecTo: destList.join(', ') })
            setMultaStep('sent')
            toast.success(`PEC inviata con ${data.attachmentCount} allegati!`)

            // Save to history log — destinatario EFFETTIVO + modalità + confidenza.
            await supabase.from('multe_pec_log').insert({
                numero_verbale: multaData.numero_verbale || null,
                targa: multaData.targa || null,
                data_infrazione: multaData.data_infrazione || null,
                importo: multaData.importo || null,
                conducente_nome: driverData.nome || null,
                conducente_cognome: driverData.cognome || null,
                conducente_codice_fiscale: driverData.codice_fiscale || null,
                booking_id: driverData.booking_id || null,
                pec_message_id: data.messageId || null,
                pec_to: destList.join(', '),
                ente_id: chosenEnteId,
                modalita_selezione: selMode,
                confidenza: pecRecipient?.confidence ?? null,
                pec_cc: ccList.length ? ccList : null,
                allegati_count: data.attachmentCount || 0,
                has_patente: (driverData.license_urls?.length || 0) > 0,
                // Il contratto puo' essere generato al momento dell'invio:
                // conta quello che il server ha davvero allegato.
                has_contratto: data.contractAttached ?? !!driverData.contract_url,
                has_documento_id: (driverData.id_urls?.length || 0) > 0,
                pdf_filename: multaFile?.name || null,
            }).then(() => loadPecHistory())
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + _errMsg)
        } finally {
            setPecSending(false)
        }
    }

    function resetMulta() {
        setMultaFile(null)
        setMultaPdfBase64('')
        setMultaStep('upload')
        setMultaData(null)
        setDriverData(null)
        setLetterText('')
        setPecResult(null)
        setPecRecipient(null); setChosenPec(''); setChosenEnteId(null)
        setSelMode('manuale'); setConfirmRecipient(false); setShowChangeRecipient(false)
        setRubricaQuery(''); setRubricaResults([]); setCcInput('')
        if (fileInputRef.current) fileInputRef.current.value = ''
    }



    return (
        <div className="space-y-4 lg:space-y-6">
            {/* Header */}
            <div className="bg-theme-bg-secondary rounded-lg p-3 lg:p-4 border border-theme-border">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                        <h2 className="text-2xl font-bold text-theme-text-primary">Multe — {BUSINESS_LABELS[biz]}</h2>
                        <p className="text-sm text-theme-text-muted mt-0.5">
                            {activeSubTab === 'history' ? 'Storico comunicazioni PEC inviate' : "Carica il verbale: il destinatario PEC viene proposto dall'organo accertatore"}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            onClick={handleSyncIpa}
                            disabled={syncingIpa}
                            title="Aggiorna la rubrica degli enti accertatori dal registro ufficiale IPA"
                            className="px-3 py-2 text-xs font-medium rounded-lg border border-theme-border bg-theme-bg-tertiary text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors min-h-[44px] disabled:opacity-50"
                        >
                            {syncingIpa ? 'Sync IPA…' : 'Aggiorna rubrica IPA'}
                        </button>
                        <div className="flex bg-theme-bg-tertiary rounded-lg border border-theme-border overflow-hidden">
                            <button
                                onClick={() => setActiveSubTab('history')}
                                className={`px-4 py-2 text-sm font-medium transition-colors min-h-[44px] ${activeSubTab === 'history' ? 'bg-dr7-gold text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                            >
                                Storico PEC
                            </button>
                            <button
                                onClick={() => setActiveSubTab('upload')}
                                className={`px-4 py-2 text-sm font-medium transition-colors min-h-[44px] ${activeSubTab === 'upload' ? 'bg-dr7-gold text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                            >
                                Carica &amp; Invia PEC
                            </button>
                        </div>
                    </div>
                </div>

                {/* Business come sotto-schede: una sola voce "Multe" nel menu di
                    Amministrazione invece di cinque. */}
                {mostraSelettore && (
                    <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-theme-border">
                        {BUSINESSES.map(b => (
                            <button
                                key={b}
                                onClick={() => { setBizScelto(b); resetMulta() }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                                    biz === b
                                        ? 'bg-dr7-gold text-white border-dr7-gold'
                                        : 'bg-theme-bg-tertiary text-theme-text-secondary border-theme-border hover:text-theme-text-primary hover:bg-theme-bg-hover'
                                }`}
                            >
                                {BUSINESS_LABELS[b]}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* ── STORICO PEC ──────────────────────────────────────────── */}
            {activeSubTab === 'history' && (
                <div className="space-y-4">
                    {/* Summary stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-4 text-center">
                            <div className="text-2xl font-bold text-theme-text-primary">{pecHistory.length}</div>
                            <div className="text-xs text-theme-text-muted mt-0.5">PEC Inviate</div>
                        </div>
                        <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-4 text-center">
                            <div className="text-2xl font-bold text-green-400">{pecHistory.filter(l => l.has_patente).length}</div>
                            <div className="text-xs text-theme-text-muted mt-0.5">Con Patente</div>
                        </div>
                        <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-4 text-center">
                            <div className="text-2xl font-bold text-green-400">{pecHistory.filter(l => l.has_contratto).length}</div>
                            <div className="text-xs text-theme-text-muted mt-0.5">Con Contratto</div>
                        </div>
                        <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-4 text-center">
                            <div className="text-2xl font-bold text-theme-text-primary">
                                {pecHistory.reduce((sum, l) => sum + (l.allegati_count || 0), 0)}
                            </div>
                            <div className="text-xs text-theme-text-muted mt-0.5">Allegati Totali</div>
                        </div>
                    </div>

                    {/* PEC List */}
                    <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
                        <div className="px-5 py-3 border-b border-theme-border bg-theme-bg-tertiary/30 flex justify-between items-center">
                            <h3 className="text-sm font-bold text-theme-text-primary">Comunicazioni PEC Inviate</h3>
                            <button onClick={loadPecHistory} className="text-xs text-dr7-gold hover:underline">Aggiorna</button>
                        </div>
                        {loadingHistory ? (
                            <div className="p-4"><ScheletroTabella righe={5} colonne={4} /></div>
                        ) : pecHistory.length === 0 ? (
                            <div className="p-8 text-center">
                                <svg className="w-12 h-12 mx-auto mb-3 text-theme-text-muted opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                                <p className="text-sm text-theme-text-muted">Nessuna PEC inviata</p>
                                <p className="text-xs text-theme-text-muted mt-1 opacity-60">Vai su "Carica &amp; Invia PEC" per inviare la prima comunicazione</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-theme-border">
                                {pecHistory.map((log) => (
                                    <div key={log.id} className="px-5 py-4 hover:bg-theme-bg-tertiary/20 transition-colors">
                                        <div className="flex items-start gap-4">
                                            {/* Status icon */}
                                            <div className="flex-shrink-0 mt-0.5">
                                                <div className="w-9 h-9 bg-green-500/10 rounded-full flex items-center justify-center">
                                                    <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                                </div>
                                            </div>

                                            {/* Main content */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-sm font-bold text-theme-text-primary">
                                                        {log.conducente_nome} {log.conducente_cognome}
                                                    </span>
                                                    <span className="px-2 py-0.5 bg-theme-bg-tertiary rounded text-xs font-mono text-theme-text-primary border border-theme-border">
                                                        {log.targa}
                                                    </span>
                                                    {log.importo && (
                                                        <span className="text-xs text-red-400 font-medium">&euro;{log.importo}</span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-3 mt-1 text-xs text-theme-text-muted">
                                                    <span>Verbale n. {log.numero_verbale || 'N/D'}</span>
                                                    <span>Infrazione: {log.data_infrazione || 'N/D'}</span>
                                                    {log.conducente_codice_fiscale && (
                                                        <span className="font-mono">{log.conducente_codice_fiscale}</span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-3 mt-1 text-xs text-theme-text-muted">
                                                    <span>A: {log.pec_to}</span>
                                                    {log.pdf_filename && (
                                                        <span className="opacity-60">File: {log.pdf_filename}</span>
                                                    )}
                                                </div>

                                                {/* Allegati badges */}
                                                <div className="flex items-center gap-2 mt-2">
                                                    <span className="text-[10px] text-theme-text-muted uppercase">Allegati:</span>
                                                    <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] rounded border border-blue-500/20">
                                                        Verbale PDF
                                                    </span>
                                                    {log.has_patente ? (
                                                        <span className="px-1.5 py-0.5 bg-green-500/10 text-green-400 text-[10px] rounded border border-green-500/20">Patente</span>
                                                    ) : (
                                                        <span className="px-1.5 py-0.5 bg-red-500/10 text-red-400 text-[10px] rounded border border-red-500/20">Patente mancante</span>
                                                    )}
                                                    {log.has_documento_id ? (
                                                        <span className="px-1.5 py-0.5 bg-green-500/10 text-green-400 text-[10px] rounded border border-green-500/20">Doc. ID</span>
                                                    ) : (
                                                        <span className="px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 text-[10px] rounded border border-yellow-500/20">Doc. ID mancante</span>
                                                    )}
                                                    {log.has_contratto ? (
                                                        <span className="px-1.5 py-0.5 bg-green-500/10 text-green-400 text-[10px] rounded border border-green-500/20">Contratto</span>
                                                    ) : (
                                                        <span className="px-1.5 py-0.5 bg-red-500/10 text-red-400 text-[10px] rounded border border-red-500/20">Contratto mancante</span>
                                                    )}
                                                    <span className="text-[10px] text-theme-text-muted">({log.allegati_count} totali)</span>
                                                </div>
                                            </div>

                                            {/* Date/time */}
                                            <div className="flex-shrink-0 text-right">
                                                <div className="text-sm font-medium text-theme-text-primary">
                                                    {new Date(log.created_at).toLocaleDateString('it-IT')}
                                                </div>
                                                <div className="text-xs text-theme-text-muted">
                                                    {new Date(log.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                                {log.pec_message_id && (
                                                    <div className="text-[10px] font-mono text-theme-text-muted opacity-40 mt-1 max-w-[120px] truncate" title={log.pec_message_id}>
                                                        {log.pec_message_id}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── CARICA & INVIA PEC ─────────────────────────────────────── */}
            {activeSubTab === 'upload' && (
                <div className="max-w-4xl mx-auto space-y-4">
                    {/* Step 1: Upload */}
                    {multaStep === 'upload' && (
                        <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
                            <div className="px-5 py-4 border-b border-theme-border">
                                <h3 className="text-base font-bold text-theme-text-primary">Carica Multa</h3>
                                <p className="text-xs text-theme-text-muted mt-0.5">
                                    Carica il PDF del verbale — i dati verranno estratti automaticamente e inviati via PEC
                                </p>
                            </div>
                            <div className="p-5 space-y-4">
                                <label className={`relative flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                                    multaFile ? 'border-green-500/50 bg-green-500/5' : 'border-theme-border hover:border-dr7-gold/50 hover:bg-dr7-gold/5'
                                }`}>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="application/pdf"
                                        onChange={handleMultaFileChange}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                    {multaFile ? (
                                        <>
                                            <svg className="w-10 h-10 mb-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                            <span className="text-sm font-medium text-theme-text-primary">{multaFile.name}</span>
                                            <span className="text-xs text-theme-text-muted mt-1">{(multaFile.size / 1024).toFixed(0)} KB — Clicca per cambiare</span>
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-10 h-10 mb-2 text-theme-text-muted opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                                            <span className="text-sm text-theme-text-muted">Trascina il PDF o clicca per selezionare</span>
                                            <span className="text-xs text-theme-text-muted mt-1 opacity-60">Solo file PDF</span>
                                        </>
                                    )}
                                </label>

                                <Button
                                    onClick={handleProcessMulta}
                                    disabled={!multaFile || multaProcessing}
                                    className="w-full bg-dr7-gold hover:bg-dr7-gold/90 text-white flex items-center justify-center gap-2"
                                >
                                    {multaProcessing ? (
                                        <>
                                            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                                            Estrazione dati e ricerca conducente...
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                                            Analizza e Trova Conducente
                                        </>
                                    )}
                                </Button>

                                {multaData && !driverData && (
                                    <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg space-y-2">
                                        <div className="text-sm font-medium text-yellow-400">Dati estratti dal verbale (conducente non trovato):</div>
                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                            {multaData.targa && <div><span className="text-theme-text-muted">Targa:</span> <span className="font-mono text-theme-text-primary">{multaData.targa}</span></div>}
                                            {multaData.data_infrazione && <div><span className="text-theme-text-muted">Data:</span> <span className="text-theme-text-primary">{multaData.data_infrazione}</span></div>}
                                            {multaData.ora_infrazione && <div><span className="text-theme-text-muted">Ora:</span> <span className="text-theme-text-primary">{multaData.ora_infrazione}</span></div>}
                                            {multaData.numero_verbale && <div><span className="text-theme-text-muted">Verbale:</span> <span className="text-theme-text-primary">{multaData.numero_verbale}</span></div>}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Step 2: Review */}
                    {multaStep === 'review' && multaData && driverData && (
                        <div className="space-y-4">
                            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
                                <div className="px-5 py-3 border-b border-theme-border bg-theme-bg-tertiary/30">
                                    <h3 className="text-sm font-bold text-theme-text-primary">Dati Verbale</h3>
                                </div>
                                <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                                    <div>
                                        <div className="text-[10px] text-theme-text-muted uppercase">Targa</div>
                                        <div className="font-mono font-bold text-theme-text-primary">{multaData.targa}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] text-theme-text-muted uppercase">Data</div>
                                        <div className="text-theme-text-primary">{multaData.data_infrazione}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] text-theme-text-muted uppercase">Ora</div>
                                        <div className="text-theme-text-primary">{multaData.ora_infrazione || 'N/D'}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] text-theme-text-muted uppercase">Verbale N.</div>
                                        <div className="text-theme-text-primary">{multaData.numero_verbale || 'N/D'}</div>
                                    </div>
                                    {multaData.importo && (
                                        <div>
                                            <div className="text-[10px] text-theme-text-muted uppercase">Importo</div>
                                            <div className="text-theme-text-primary font-medium">&euro;{multaData.importo}</div>
                                        </div>
                                    )}
                                    {multaData.luogo_infrazione && (
                                        <div className="col-span-2">
                                            <div className="text-[10px] text-theme-text-muted uppercase">Luogo</div>
                                            <div className="text-theme-text-primary">{multaData.luogo_infrazione}</div>
                                        </div>
                                    )}
                                    {multaData.articolo && (
                                        <div>
                                            <div className="text-[10px] text-theme-text-muted uppercase">Articolo</div>
                                            <div className="text-theme-text-primary">{multaData.articolo}</div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="bg-theme-bg-secondary rounded-lg border border-green-500/30 overflow-hidden">
                                <div className="px-5 py-3 border-b border-green-500/30 bg-green-500/5">
                                    <div className="flex items-center gap-2">
                                        <svg className="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                        <h3 className="text-sm font-bold text-green-400">Conducente Trovato</h3>
                                    </div>
                                </div>
                                <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                                    <div>
                                        <div className="text-[10px] text-theme-text-muted uppercase">Nome</div>
                                        <div className="text-theme-text-primary font-medium">{driverData.nome} {driverData.cognome}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] text-theme-text-muted uppercase">Codice Fiscale</div>
                                        <div className="font-mono text-theme-text-primary">{driverData.codice_fiscale || <span className="text-yellow-500">Mancante</span>}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] text-theme-text-muted uppercase">Patente</div>
                                        <div className="font-mono text-theme-text-primary">{driverData.patente_numero || <span className="text-yellow-500">Mancante</span>}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] text-theme-text-muted uppercase">Telefono</div>
                                        <div className="text-theme-text-primary"><NumeroTelefono valore={driverData.customer_phone} vuoto="N/D" /></div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] text-theme-text-muted uppercase">Residenza</div>
                                        <div className="text-theme-text-primary">{[driverData.indirizzo, driverData.citta, driverData.provincia].filter(Boolean).join(', ') || 'N/D'}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] text-theme-text-muted uppercase">Noleggio</div>
                                        <div className="text-theme-text-primary text-xs">
                                            {new Date(driverData.pickup_date).toLocaleDateString('it-IT')} — {new Date(driverData.dropoff_date).toLocaleDateString('it-IT')}
                                        </div>
                                    </div>
                                </div>

                                <div className="px-4 pb-4">
                                    <div className="text-[10px] text-theme-text-muted uppercase mb-2">Allegati PEC</div>
                                    <div className="flex flex-wrap gap-2">
                                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-theme-bg-tertiary rounded text-xs text-theme-text-primary border border-theme-border">
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                            Verbale ({multaFile?.name})
                                        </span>
                                        {driverData.license_urls?.length > 0 ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-500/10 rounded text-xs text-green-400 border border-green-500/30">
                                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                                Patente ({driverData.license_urls.length} file)
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-500/10 rounded text-xs text-red-400 border border-red-500/30">
                                                Patente non trovata
                                            </span>
                                        )}
                                        {driverData.id_urls?.length > 0 && (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-500/10 rounded text-xs text-green-400 border border-green-500/30">
                                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                                Documento ID ({driverData.id_urls.length} file)
                                            </span>
                                        )}
                                        {driverData.codice_fiscale_urls?.length > 0 && (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-500/10 rounded text-xs text-green-400 border border-green-500/30">
                                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                                Codice Fiscale ({driverData.codice_fiscale_urls.length} file)
                                            </span>
                                        )}
                                        {driverData.contract_url ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-500/10 rounded text-xs text-green-400 border border-green-500/30">
                                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                                Contratto noleggio
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-500/10 rounded text-xs text-yellow-400 border border-yellow-500/30">
                                                Contratto non trovato — generato all'invio
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* ── Destinatario PEC dinamico ─────────────────────── */}
                            {(() => {
                                const conf = pecRecipient?.confidence ?? 0
                                const badge = !chosenPec
                                    ? { c: 'bg-red-500/15 text-red-300 border-red-500/40', t: 'Nessun destinatario' }
                                    : conf >= 0.85 || selMode === 'verbale'
                                        ? { c: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', t: `Confidenza alta${conf ? ` ${Math.round(conf * 100)}%` : ''}` }
                                        : conf >= 0.5
                                            ? { c: 'bg-amber-500/15 text-amber-300 border-amber-500/40', t: `Confidenza media ${Math.round(conf * 100)}%` }
                                            : { c: 'bg-red-500/15 text-red-300 border-red-500/40', t: 'Confidenza bassa — verifica' }
                                const riservaCfg = (aziendaBase.destinatario_default || '').trim().toLowerCase()
                                const daRiserva = !pecRecipient?.pec && !!riservaCfg && chosenPec.trim().toLowerCase() === riservaCfg
                                const sourceLabel = selMode === 'verbale' ? 'rilevata dal verbale'
                                    : selMode === 'rubrica' || selMode === 'automatica' ? 'da rubrica'
                                    : daRiserva ? 'destinatario di riserva (Centralina Pro)'
                                    : 'inserita manualmente'
                                const pecNotInRubrica = selMode === 'verbale' && !chosenEnteId
                                return (
                                    <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-4 space-y-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <h3 className="text-sm font-bold text-theme-text-primary">Destinatario PEC</h3>
                                            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${badge.c}`}>{badge.t}</span>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-mono text-sm text-theme-text-primary break-all">{chosenPec || '— nessuna PEC —'}</span>
                                            {chosenPec && <span className="text-[11px] text-theme-text-muted">({sourceLabel})</span>}
                                        </div>
                                        {pecRecipient?.denominazione && <div className="text-xs text-theme-text-muted">{pecRecipient.denominazione}</div>}
                                        {/* 24/08/2026: indirizzo e dati azienda per QUESTA multa.
                                            I valori fissi vivono in Centralina Pro > Gestione Multe;
                                            qui si scostano solo per il verbale in corso. */}
                                        <div className="pt-1">
                                            <button
                                                onClick={() => setMostraAzienda(v => !v)}
                                                className="text-xs text-theme-text-secondary underline"
                                            >
                                                {mostraAzienda ? 'Chiudi dati azienda' : 'Indirizzo e dati azienda per questa multa'}
                                            </button>
                                            {mostraAzienda && (
                                                <div className="mt-2 rounded-lg border border-theme-border bg-theme-bg-tertiary/40 p-3 space-y-2">
                                                    {([
                                                        ['indirizzo', 'Indirizzo'],
                                                        ['pec_mittente', 'PEC mittente'],
                                                        ['rappresentante_legale', 'Rappresentante legale'],
                                                        ['telefono', 'Telefono'],
                                                    ] as Array<[keyof MulteConfigValues, string]>).map(([k, label]) => (
                                                        <div key={k}>
                                                            <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1">{label}</label>
                                                            <input
                                                                type="text"
                                                                value={azienda[k]}
                                                                onChange={e => setAzienda(prev => ({ ...prev, [k]: e.target.value }))}
                                                                className="w-full px-2.5 h-8 rounded-lg border border-theme-border bg-theme-bg-primary text-xs text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-dr7-gold"
                                                            />
                                                        </div>
                                                    ))}
                                                    <div className="flex items-center justify-between pt-1">
                                                        <span className="text-[10px] text-theme-text-muted">
                                                            {JSON.stringify(azienda) === JSON.stringify(aziendaBase)
                                                                ? 'Valori standard di Centralina Pro'
                                                                : 'Valori modificati solo per questa multa'}
                                                        </span>
                                                        <button
                                                            onClick={() => setAzienda(aziendaBase)}
                                                            className="text-[11px] text-theme-text-secondary underline"
                                                        >
                                                            Ripristina
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        {chosenPec && !looksLikePec(chosenPec) && (
                                            <div className="text-[11px] text-amber-400">Questo indirizzo non sembra una PEC — confermi comunque?</div>
                                        )}
                                        {pecNotInRubrica && (
                                            <button onClick={handleAddToRubrica} className="text-xs px-3 py-1.5 rounded-lg bg-dr7-gold/15 text-dr7-gold border border-dr7-gold/40 hover:bg-dr7-gold/25">+ Aggiungi alla rubrica</button>
                                        )}
                                        <div>
                                            <button onClick={() => setShowChangeRecipient(v => !v)} className="text-xs text-theme-text-secondary underline">
                                                {showChangeRecipient ? 'Chiudi' : 'Cambia destinatario'}
                                            </button>
                                        </div>
                                        {showChangeRecipient && (
                                            <div className="rounded-lg border border-theme-border bg-theme-bg-tertiary/40 p-3 space-y-3">
                                                <div>
                                                    <label className="block text-[11px] uppercase tracking-wide text-theme-text-muted mb-1">Cerca in rubrica (nome / comune)</label>
                                                    <input value={rubricaQuery} onChange={e => searchRubrica(e.target.value)} placeholder="Es. Olbia, Polizia Locale…" className="w-full px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-sm text-theme-text-primary" />
                                                    {rubricaResults.length > 0 && (
                                                        <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-theme-border divide-y divide-theme-border/50">
                                                            {rubricaResults.map(e => (
                                                                <button key={e.id} onClick={() => pickRubricaEnte(e)} className="w-full text-left px-3 py-2 hover:bg-theme-bg-hover">
                                                                    <div className="text-sm text-theme-text-primary">{e.denominazione}</div>
                                                                    <div className="text-[11px] text-theme-text-muted">{e.comune || ''}{e.provincia ? ` (${e.provincia})` : ''} · <span className="font-mono">{e.pec}</span></div>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                <div>
                                                    <label className="block text-[11px] uppercase tracking-wide text-theme-text-muted mb-1">…oppure inserisci gli indirizzi manualmente</label>
                                                    <input value={chosenPec} onChange={e => { setChosenPec(e.target.value); setChosenEnteId(null); setSelMode('manuale'); setConfirmRecipient(false) }} placeholder="pec@comune.esempio.legalmail.it, altro@ente.it" className="w-full px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-sm text-theme-text-primary font-mono" />
                                                    <p className="mt-1 text-[11px] text-theme-text-muted">
                                                        Piu' indirizzi separati da virgola: il primo e' il destinatario, gli altri vanno in copia.
                                                    </p>
                                                    {(aziendaBase.destinatario_default || '').trim() && (
                                                        <button
                                                            type="button"
                                                            onClick={() => { setChosenPec(aziendaBase.destinatario_default.trim()); setChosenEnteId(null); setSelMode('manuale'); setConfirmRecipient(false) }}
                                                            className="mt-1.5 text-[11px] text-theme-text-secondary underline"
                                                            title="Il destinatario di riserva impostato in Centralina Pro > Gestione Multe"
                                                        >
                                                            Usa il destinatario di riserva ({aziendaBase.destinatario_default.trim()})
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        <div>
                                            <label className="block text-[11px] uppercase tracking-wide text-theme-text-muted mb-1">CC (facoltativo — studio legale / cliente)</label>
                                            <input value={ccInput} onChange={e => setCcInput(e.target.value)} placeholder="email separate da virgola" className="w-full px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-sm text-theme-text-primary" />
                                        </div>
                                        <label className="flex items-center gap-2 text-sm text-theme-text-primary cursor-pointer">
                                            <input type="checkbox" checked={confirmRecipient} onChange={e => setConfirmRecipient(e.target.checked)} className="w-4 h-4 accent-dr7-gold" />
                                            Confermo che il destinatario è corretto
                                        </label>
                                    </div>
                                )
                            })()}

                            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
                                <div className="px-5 py-3 border-b border-theme-border bg-theme-bg-tertiary/30 flex justify-between items-center">
                                    <h3 className="text-sm font-bold text-theme-text-primary">Anteprima Comunicazione PEC</h3>
                                    <div className="text-xs text-theme-text-muted break-all">
                                        A: {chosenPec || '—'}
                                    </div>
                                </div>
                                <div className="p-4">
                                    <textarea
                                        value={letterText}
                                        onChange={(e) => setLetterText(e.target.value)}
                                        rows={18}
                                        className="w-full bg-theme-bg-primary border border-theme-border rounded-lg p-3 text-sm text-theme-text-primary font-mono leading-relaxed focus:ring-2 focus:ring-dr7-gold/50 focus:border-dr7-gold outline-none"
                                    />
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <Button variant="secondary" onClick={resetMulta} className="flex-1">
                                    Annulla
                                </Button>
                                <Button
                                    onClick={handleSendPec}
                                    disabled={pecSending || !chosenPec || !confirmRecipient}
                                    className="flex-[2] bg-green-600 hover:bg-green-500 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {pecSending ? (
                                        <>
                                            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                                            Invio PEC in corso...
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                                            {confirmRecipient ? 'Invia PEC' : 'Conferma il destinatario'}
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Sent */}
                    {multaStep === 'sent' && pecResult && (
                        <div className="bg-theme-bg-secondary rounded-lg border border-green-500/30 overflow-hidden">
                            <div className="p-8 text-center space-y-4">
                                <div className="w-16 h-16 mx-auto bg-green-500/10 rounded-full flex items-center justify-center">
                                    <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-green-400">PEC Inviata</h3>
                                    <p className="text-sm text-theme-text-muted mt-1 break-all">
                                        Comunicazione inviata a {pecResult.pecTo || chosenPec}
                                    </p>
                                </div>
                                <div className="text-xs text-theme-text-muted space-y-1">
                                    <div>Allegati: {pecResult.attachmentCount}</div>
                                    {/* Prova della presa in carico: chi ha accettato il server PEC
                                        e cosa ha risposto. "Inviata" senza questo non dimostrava niente. */}
                                    {Array.isArray(pecResult.accepted) && pecResult.accepted.length > 0 && (
                                        <div>Accettati dal server PEC: <span className="font-mono">{pecResult.accepted.join(', ')}</span></div>
                                    )}
                                    {Array.isArray(pecResult.rejected) && pecResult.rejected.length > 0 && (
                                        <div className="text-red-400">Rifiutati: <span className="font-mono">{pecResult.rejected.join(', ')}</span></div>
                                    )}
                                    {pecResult.smtpResponse && (
                                        <div className="font-mono opacity-60 break-all">Risposta server: {pecResult.smtpResponse}</div>
                                    )}
                                    <div className="font-mono opacity-60">ID: {pecResult.messageId}</div>
                                    <div className="opacity-70">
                                        La ricevuta di accettazione e consegna arriva sulla casella PEC del mittente.
                                    </div>
                                </div>
                                <Button onClick={resetMulta} className="mt-4">
                                    Nuova Multa
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}

        </div>
    )
}
