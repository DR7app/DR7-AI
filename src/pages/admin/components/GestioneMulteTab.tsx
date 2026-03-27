import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import { logger } from '../../../utils/logger'

export default function GestioneMulteTab() {
    const [activeSubTab, setActiveSubTab] = useState<'history' | 'upload'>('history')
    // Multa Upload + PEC State
    const [multaFile, setMultaFile] = useState<File | null>(null)
    const [multaPdfBase64, setMultaPdfBase64] = useState('')
    const [multaProcessing, setMultaProcessing] = useState(false)
    const [multaStep, setMultaStep] = useState<'upload' | 'review' | 'sent'>('upload')
    const [multaData, setMultaData] = useState<any>(null)
    const [driverData, setDriverData] = useState<any>(null)
    const [letterText, setLetterText] = useState('')
    const [pecSending, setPecSending] = useState(false)
    const [pecResult, setPecResult] = useState<any>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // PEC History
    const [pecHistory, setPecHistory] = useState<any[]>([])
    const [loadingHistory, setLoadingHistory] = useState(false)

    useEffect(() => {
        loadPecHistory()
    }, [])

    async function loadPecHistory() {
        setLoadingHistory(true)
        try {
            const { data, error } = await supabase
                .from('multe_pec_log')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(50)
            if (!error && data) setPecHistory(data)
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
            setMultaStep('review')
            toast.success('Conducente trovato! Controlla i dati prima di inviare.')
        } catch (err: any) {
            toast.error('Errore: ' + err.message)
        } finally {
            setMultaProcessing(false)
        }
    }

    async function handleSendPec() {
        if (!multaData || !driverData) { toast.error('Dati mancanti'); return }
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
                }),
            })
            const data = await res.json()
            if (data.error) { toast.error('Errore invio PEC: ' + data.error); return }
            setPecResult(data)
            setMultaStep('sent')
            toast.success(`PEC inviata con ${data.attachmentCount} allegati!`)

            // Save to history log
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
                pec_to: 'poliziamunicipale@comune.cagliari.legalmail.it',
                allegati_count: data.attachmentCount || 0,
                has_patente: (driverData.license_urls?.length || 0) > 0,
                has_contratto: !!driverData.contract_url,
                has_documento_id: (driverData.id_urls?.length || 0) > 0,
                pdf_filename: multaFile?.name || null,
            }).then(() => loadPecHistory())
        } catch (err: any) {
            toast.error('Errore: ' + err.message)
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
        if (fileInputRef.current) fileInputRef.current.value = ''
    }



    return (
        <div className="space-y-4 lg:space-y-6">
            {/* Header */}
            <div className="bg-theme-bg-secondary rounded-lg p-3 lg:p-4 border border-theme-border">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                        <h2 className="text-2xl font-bold text-theme-text-primary">Gestione Multe</h2>
                        <p className="text-sm text-theme-text-muted mt-0.5">
                            {activeSubTab === 'history' ? 'Storico comunicazioni PEC inviate' : 'Carica verbale e invia PEC alla Polizia Municipale'}
                        </p>
                    </div>
                    <div className="flex bg-theme-bg-tertiary rounded-lg border border-theme-border overflow-hidden">
                        <button
                            onClick={() => setActiveSubTab('history')}
                            className={`px-4 py-2 text-sm font-medium transition-colors ${activeSubTab === 'history' ? 'bg-dr7-gold text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                        >
                            Storico PEC
                        </button>
                        <button
                            onClick={() => setActiveSubTab('upload')}
                            className={`px-4 py-2 text-sm font-medium transition-colors ${activeSubTab === 'upload' ? 'bg-dr7-gold text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                        >
                            Carica &amp; Invia PEC
                        </button>
                    </div>
                </div>
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
                            <div className="p-8 text-center text-sm text-theme-text-muted">Caricamento storico...</div>
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
                                        <div className="text-theme-text-primary">{driverData.customer_phone || 'N/D'}</div>
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
                                        {driverData.contract_url ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-500/10 rounded text-xs text-green-400 border border-green-500/30">
                                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                                Contratto noleggio
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-500/10 rounded text-xs text-yellow-400 border border-yellow-500/30">
                                                Contratto non trovato
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
                                <div className="px-5 py-3 border-b border-theme-border bg-theme-bg-tertiary/30 flex justify-between items-center">
                                    <h3 className="text-sm font-bold text-theme-text-primary">Anteprima Comunicazione PEC</h3>
                                    <div className="text-xs text-theme-text-muted">
                                        A: poliziamunicipale@comune.cagliari.legalmail.it
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
                                    disabled={pecSending}
                                    className="flex-[2] bg-green-600 hover:bg-green-500 flex items-center justify-center gap-2"
                                >
                                    {pecSending ? (
                                        <>
                                            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                                            Invio PEC in corso...
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                                            Invia PEC a Polizia Municipale
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
                                    <p className="text-sm text-theme-text-muted mt-1">
                                        Comunicazione inviata a poliziamunicipale@comune.cagliari.legalmail.it
                                    </p>
                                </div>
                                <div className="text-xs text-theme-text-muted space-y-1">
                                    <div>Allegati: {pecResult.attachmentCount}</div>
                                    <div className="font-mono opacity-60">ID: {pecResult.messageId}</div>
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
