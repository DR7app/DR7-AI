import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import Input from './Input'

interface Vehicle {
    id: string
    display_name: string
    plate: string | null
    targa?: string | null
}

interface BookingResult {
    id: string
    customer_name: string
    customer_email: string
    customer_phone: string
    pickup_date: string
    dropoff_date: string
    vehicle_name: string
    vehicle_plate?: string
    contract_url?: string
    booking_details: any
    // Customer extended data if available
    driver_license?: string
    address?: string
    city?: string
    zip?: string
    province?: string
}

export default function GestioneMulteTab() {
    const [activeSubTab, setActiveSubTab] = useState<'search' | 'upload'>('search')
    const [vehicles, setVehicles] = useState<Vehicle[]>([])

    // Search State
    const [plate, setPlate] = useState('')
    const [fineDate, setFineDate] = useState('')
    const [fineTime, setFineTime] = useState('')
    const [loading, setLoading] = useState(false)
    const [searchResult, setSearchResult] = useState<BookingResult | null>(null)
    const [error, setError] = useState<string | null>(null)

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
        loadVehicles()
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
        } catch (e) {
            // Table might not exist yet — that's fine
            console.warn('[GestioneMulte] multe_pec_log table not found, skipping history')
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



    async function loadVehicles() {
        const { data } = await supabase
            .from('vehicles')
            .select('id, display_name, plate, targa')

        if (data) {
            setVehicles(data)
        }
    }

    async function handleSearch() {
        if (!plate || !fineDate || !fineTime) {
            setError('Inserisci targa, data e ora della multa')
            return
        }

        setLoading(true)
        setError(null)
        setSearchResult(null)

        try {
            const searchDateTime = new Date(`${fineDate}T${fineTime}`)
            const isoSearch = searchDateTime.toISOString()

            // 1. Find bookings for this car that overlap with the date
            let query = supabase
                .from('bookings')
                .select(`
                    id, 
                    pickup_date, 
                    dropoff_date, 
                    customer_name, 
                    customer_email, 
                    customer_phone, 
                    vehicle_name, 
                    vehicle_plate, 
                    booking_details,
                    user_id
                `)
                .lte('pickup_date', isoSearch) // pickup before or at fine time
                .gte('dropoff_date', isoSearch) // dropoff after or at fine time

            const { data: potentialBookings, error: bookingError } = await query

            if (bookingError) throw bookingError

            if (!potentialBookings || potentialBookings.length === 0) {
                setError('Nessuna prenotazione trovata in quella data/ora.')
                setLoading(false)
                return
            }

            // Filter by Plate in JS
            const normalize = (s: string) => s?.replace(/\s/g, '').toUpperCase() || ''
            const targetPlate = normalize(plate)

            const match = potentialBookings.find(b => {
                const bPlate = normalize(b.vehicle_plate || b.booking_details?.vehicle_plate || '')
                const bName = normalize(b.vehicle_name || '')

                return bPlate.includes(targetPlate) || (targetPlate.length > 4 && bName.includes(targetPlate))
            })

            if (!match) {
                setError('Prenotazione trovata per data/ora, ma la targa non corrisponde.')
                setLoading(false)
                return
            }

            // 2. Fetch Customer Details for the match
            let driverLicense = match.booking_details?.customer?.driverLicense || ''
            let address = match.booking_details?.customer?.address || ''

            // Try to get extended details if we have user_id
            if (match.user_id) {
                const { data: customerData } = await supabase
                    .from('customers_extended')
                    .select('*')
                    .eq('id', match.user_id)
                    .single()

                if (customerData) {
                    driverLicense = customerData.patente_numero || driverLicense
                    address = `${customerData.indirizzo || ''} ${customerData.citta || ''}`.trim() || address
                }
            }

            // 3. Get Contract if exists
            const { data: contractData } = await supabase
                .from('contracts')
                .select('signed_pdf_url')
                .eq('booking_id', match.id)
                .maybeSingle() // Use maybeSingle to avoid 406 error if multiple (shouldn't happen but safe) or none

            setSearchResult({
                id: match.id,
                customer_name: match.customer_name,
                customer_email: match.customer_email,
                customer_phone: match.customer_phone,
                pickup_date: match.pickup_date,
                dropoff_date: match.dropoff_date,
                vehicle_name: match.vehicle_name,
                vehicle_plate: match.vehicle_plate,
                driver_license: driverLicense,
                address: address,
                contract_url: contractData?.signed_pdf_url,
                booking_details: match.booking_details
            })

        } catch (err: any) {
            console.error(err)
            setError('Errore durante la ricerca: ' + err.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-4 lg:space-y-6">
            {/* Header */}
            <div className="bg-theme-bg-secondary rounded-lg p-3 lg:p-4 border border-theme-border">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                        <h2 className="text-2xl font-bold text-theme-text-primary">Gestione Multe</h2>
                        <p className="text-sm text-theme-text-muted mt-0.5">
                            {activeSubTab === 'search' ? 'Ricerca conducente per data infrazione' : 'Carica verbale e invia PEC alla Polizia Municipale'}
                        </p>
                    </div>
                    <div className="flex bg-theme-bg-tertiary rounded-lg border border-theme-border overflow-hidden">
                        <button
                            onClick={() => setActiveSubTab('search')}
                            className={`px-4 py-2 text-sm font-medium transition-colors ${activeSubTab === 'search' ? 'bg-dr7-gold text-black' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                        >
                            Ricerca Multa
                        </button>
                        <button
                            onClick={() => setActiveSubTab('upload')}
                            className={`px-4 py-2 text-sm font-medium transition-colors ${activeSubTab === 'upload' ? 'bg-dr7-gold text-black' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                        >
                            Carica &amp; Invia PEC
                        </button>
                    </div>
                </div>
            </div>

            {/* ── RICERCA MULTA ─────────────────────────────────────────── */}
            {activeSubTab === 'search' && (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-6">
                    {/* Search Form — 2 cols */}
                    <div className="lg:col-span-2 bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden h-fit">
                        <div className="px-5 py-4 border-b border-theme-border">
                            <h3 className="text-base font-bold text-theme-text-primary">Dati Multa</h3>
                            <p className="text-xs text-theme-text-muted mt-0.5">Inserisci i dati per trovare il conducente</p>
                        </div>

                        <div className="p-5 space-y-4">
                            {/* Plate input */}
                            <div>
                                <label className="block text-xs font-medium text-theme-text-muted mb-1.5 uppercase tracking-wider">Targa Veicolo</label>
                                <input
                                    type="text"
                                    value={plate}
                                    onChange={(e) => setPlate(e.target.value.toUpperCase())}
                                    placeholder="ES: GB123XY"
                                    className="w-full text-theme-text-primary bg-theme-bg-primary border border-theme-border rounded-lg px-4 py-3 font-mono text-lg uppercase tracking-widest focus:ring-2 focus:ring-dr7-gold/50 focus:border-dr7-gold outline-none transition-colors"
                                />
                                {/* Vehicle quick-select chips */}
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {vehicles.slice(0, 8).map(v => {
                                        const vPlate = v.plate || v.targa || ''
                                        const isSelected = plate === vPlate
                                        return (
                                            <button
                                                key={v.id}
                                                onClick={() => setPlate(vPlate)}
                                                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                                                    isSelected
                                                        ? 'bg-dr7-gold/20 text-dr7-gold border border-dr7-gold/40 font-semibold'
                                                        : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover border border-transparent'
                                                }`}
                                            >
                                                <span className="font-medium">{v.display_name}</span>
                                                {vPlate && <span className="ml-1 opacity-60 font-mono text-[10px]">{vPlate}</span>}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Date & Time */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-theme-text-muted mb-1.5 uppercase tracking-wider">Data Infrazione</label>
                                    <Input type="date" value={fineDate} onChange={(e: any) => setFineDate(e.target.value)} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-theme-text-muted mb-1.5 uppercase tracking-wider">Ora</label>
                                    <Input type="time" value={fineTime} onChange={(e: any) => setFineTime(e.target.value)} />
                                </div>
                            </div>

                            {/* Search button */}
                            <Button onClick={handleSearch} disabled={loading} className="w-full flex items-center justify-center gap-2">
                                {loading ? (
                                    <>
                                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                                        Ricerca in corso...
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                        Trova Conducente
                                    </>
                                )}
                            </Button>

                            {error && (
                                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-start gap-2">
                                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    {error}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Results Area — 3 cols */}
                    <div className="lg:col-span-3">
                        {searchResult ? (
                            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
                                {/* Result header */}
                                <div className="px-5 py-4 border-b border-theme-border">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-500/10 border border-green-500/30 rounded text-green-400 text-xs font-bold uppercase">
                                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                                    Conducente Trovato
                                                </span>
                                                <span className="text-theme-text-muted text-xs font-mono">#{searchResult.id.slice(0, 8)}</span>
                                            </div>
                                            <h3 className="text-xl font-bold text-theme-text-primary">{searchResult.customer_name}</h3>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-theme-text-muted text-sm">{searchResult.vehicle_name}</span>
                                                <span className="px-2 py-0.5 bg-theme-bg-tertiary rounded text-xs text-theme-text-primary font-mono border border-theme-border">{searchResult.vehicle_plate || plate}</span>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            {searchResult.contract_url && (
                                                <a
                                                    href={searchResult.contract_url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="px-3 py-2 bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/20 transition-colors text-xs font-medium flex items-center gap-1.5"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                                    Contratto
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Result body */}
                                <div className="p-5">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* Contact data */}
                                        <div className="space-y-3">
                                            <h4 className="text-dr7-gold font-semibold uppercase text-xs tracking-wider pb-2 border-b border-theme-border">Dati Contatto</h4>
                                            <div className="space-y-2.5">
                                                <div className="flex items-center justify-between bg-theme-bg-tertiary/50 rounded-lg px-3 py-2">
                                                    <div>
                                                        <div className="text-[10px] text-theme-text-muted uppercase">Email</div>
                                                        <div className="text-sm text-theme-text-primary">{searchResult.customer_email || 'N/D'}</div>
                                                    </div>
                                                    {searchResult.customer_email && (
                                                        <button className="p-1.5 text-theme-text-muted hover:text-theme-text-primary rounded hover:bg-theme-bg-hover transition-colors" title="Copia" onClick={() => { navigator.clipboard.writeText(searchResult.customer_email); toast.success('Email copiata') }}>
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="flex items-center justify-between bg-theme-bg-tertiary/50 rounded-lg px-3 py-2">
                                                    <div>
                                                        <div className="text-[10px] text-theme-text-muted uppercase">Telefono</div>
                                                        <div className="text-sm text-theme-text-primary">{searchResult.customer_phone || 'N/D'}</div>
                                                    </div>
                                                    {searchResult.customer_phone && (
                                                        <button className="p-1.5 text-theme-text-muted hover:text-theme-text-primary rounded hover:bg-theme-bg-hover transition-colors" title="Copia" onClick={() => { navigator.clipboard.writeText(searchResult.customer_phone); toast.success('Telefono copiato') }}>
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="bg-theme-bg-tertiary/50 rounded-lg px-3 py-2">
                                                    <div className="text-[10px] text-theme-text-muted uppercase">Patente</div>
                                                    <div className="text-sm text-theme-text-primary font-mono">
                                                        {searchResult.driver_license || <span className="text-yellow-500 font-sans">Non registrato</span>}
                                                    </div>
                                                    {!searchResult.driver_license && (
                                                        <p className="text-[10px] text-yellow-500/80 mt-0.5">Numero patente mancante — controlla il contratto PDF</p>
                                                    )}
                                                </div>
                                                <div className="bg-theme-bg-tertiary/50 rounded-lg px-3 py-2">
                                                    <div className="text-[10px] text-theme-text-muted uppercase">Indirizzo Residenza</div>
                                                    <div className="text-sm text-theme-text-primary">
                                                        {searchResult.address || <span className="text-theme-text-muted italic">Non disponibile</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Rental period */}
                                        <div className="space-y-3">
                                            <h4 className="text-dr7-gold font-semibold uppercase text-xs tracking-wider pb-2 border-b border-theme-border">Periodo Noleggio</h4>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="bg-theme-bg-tertiary/50 rounded-lg px-3 py-2">
                                                    <div className="text-[10px] text-theme-text-muted uppercase">Ritiro</div>
                                                    <div className="text-sm text-theme-text-primary font-medium">
                                                        {new Date(searchResult.pickup_date).toLocaleDateString('it-IT')}
                                                    </div>
                                                    <div className="text-xs text-theme-text-muted">
                                                        {new Date(searchResult.pickup_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </div>
                                                <div className="bg-theme-bg-tertiary/50 rounded-lg px-3 py-2">
                                                    <div className="text-[10px] text-theme-text-muted uppercase">Restituzione</div>
                                                    <div className="text-sm text-theme-text-primary font-medium">
                                                        {new Date(searchResult.dropoff_date).toLocaleDateString('it-IT')}
                                                    </div>
                                                    <div className="text-xs text-theme-text-muted">
                                                        {new Date(searchResult.dropoff_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Quick summary card */}
                                            <div className="bg-dr7-gold/5 border border-dr7-gold/20 rounded-lg p-3 mt-2">
                                                <div className="text-xs text-dr7-gold font-semibold uppercase mb-1">Riepilogo Infrazione</div>
                                                <div className="text-sm text-theme-text-primary">
                                                    <span className="font-medium">{searchResult.customer_name}</span> guidava <span className="font-mono font-medium">{searchResult.vehicle_plate || plate}</span> ({searchResult.vehicle_name}) il <span className="font-medium">{fineDate && new Date(fineDate).toLocaleDateString('it-IT')}</span> alle <span className="font-medium">{fineTime}</span>.
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Actions footer */}
                                <div className="px-5 py-3 bg-theme-bg-tertiary/30 border-t border-theme-border flex justify-end gap-2">
                                    <Button
                                        variant="secondary"
                                        onClick={() => {
                                            const text = `DICHIARAZIONE DATI CONDUCENTE:\n\nIl veicolo targa ${plate} era noleggiato a:\nNome: ${searchResult.customer_name}\nPatente: ${searchResult.driver_license || 'N/D'}\nData Noleggio: ${new Date(searchResult.pickup_date).toLocaleDateString('it-IT')} - ${new Date(searchResult.dropoff_date).toLocaleDateString('it-IT')}\nEmail: ${searchResult.customer_email || 'N/D'}\nTelefono: ${searchResult.customer_phone || 'N/D'}\nIndirizzo: ${searchResult.address || 'N/D'}`
                                            navigator.clipboard.writeText(text)
                                            toast.success('Dati copiati negli appunti')
                                        }}
                                    >
                                        <span className="flex items-center gap-1.5">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                            Copia Dati per Comunicazione
                                        </span>
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full min-h-[400px] flex flex-col items-center justify-center bg-theme-bg-secondary rounded-lg border border-theme-border border-dashed text-theme-text-muted">
                                <svg className="w-16 h-16 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                <p className="text-base font-medium">In attesa di ricerca</p>
                                <p className="text-sm max-w-sm text-center mt-1 opacity-60">
                                    Inserisci targa, data e ora per trovare chi guidava il veicolo al momento della multa.
                                </p>
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
                                    className="w-full bg-dr7-gold hover:bg-dr7-gold/90 text-black flex items-center justify-center gap-2"
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
                    {/* ── Storico PEC Inviate ─────────────────────────── */}
                    <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden mt-6">
                        <div className="px-5 py-3 border-b border-theme-border bg-theme-bg-tertiary/30 flex justify-between items-center">
                            <h3 className="text-sm font-bold text-theme-text-primary">Storico PEC Inviate</h3>
                            <span className="text-xs text-theme-text-muted">{pecHistory.length} invii</span>
                        </div>
                        {loadingHistory ? (
                            <div className="p-6 text-center text-sm text-theme-text-muted">Caricamento...</div>
                        ) : pecHistory.length === 0 ? (
                            <div className="p-6 text-center text-sm text-theme-text-muted">Nessuna PEC inviata</div>
                        ) : (
                            <div className="divide-y divide-theme-border">
                                {pecHistory.map((log) => (
                                    <div key={log.id} className="px-5 py-3 flex items-center gap-4">
                                        <div className="flex-shrink-0">
                                            <div className="w-8 h-8 bg-green-500/10 rounded-full flex items-center justify-center">
                                                <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                            </div>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-medium text-theme-text-primary">
                                                    {log.conducente_nome} {log.conducente_cognome}
                                                </span>
                                                <span className="text-xs font-mono text-theme-text-muted">{log.targa}</span>
                                            </div>
                                            <div className="flex items-center gap-3 mt-0.5 text-xs text-theme-text-muted">
                                                <span>Verbale {log.numero_verbale || 'N/D'}</span>
                                                <span>Infrazione: {log.data_infrazione || 'N/D'}</span>
                                                {log.importo && <span>&euro;{log.importo}</span>}
                                            </div>
                                        </div>
                                        <div className="flex-shrink-0 flex items-center gap-2">
                                            <div className="flex gap-1">
                                                {log.has_patente && (
                                                    <span className="px-1.5 py-0.5 bg-green-500/10 text-green-400 text-[10px] rounded border border-green-500/20">Patente</span>
                                                )}
                                                {log.has_documento_id && (
                                                    <span className="px-1.5 py-0.5 bg-green-500/10 text-green-400 text-[10px] rounded border border-green-500/20">Doc ID</span>
                                                )}
                                                {log.has_contratto && (
                                                    <span className="px-1.5 py-0.5 bg-green-500/10 text-green-400 text-[10px] rounded border border-green-500/20">Contratto</span>
                                                )}
                                            </div>
                                            <div className="text-right">
                                                <div className="text-xs text-theme-text-muted">
                                                    {new Date(log.created_at).toLocaleDateString('it-IT')}
                                                </div>
                                                <div className="text-[10px] text-theme-text-muted opacity-60">
                                                    {new Date(log.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                            </div>
                                            <div className="text-xs font-medium text-theme-text-muted">
                                                {log.allegati_count} allegati
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

        </div>
    )
}
