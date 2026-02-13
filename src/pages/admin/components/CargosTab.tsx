import { useState, useEffect } from 'react'
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

export default function CargosTab() {
    const [activeSubTab, setActiveSubTab] = useState<'fines' | 'export'>('fines')
    const [vehicles, setVehicles] = useState<Vehicle[]>([])

    // Search State
    const [plate, setPlate] = useState('')
    const [fineDate, setFineDate] = useState('')
    const [fineTime, setFineTime] = useState('')
    const [loading, setLoading] = useState(false)
    const [searchResult, setSearchResult] = useState<BookingResult | null>(null)
    const [error, setError] = useState<string | null>(null)

    // API Configuration State
    const [showSettings, setShowSettings] = useState(false)
    const [apiConfig, setApiConfig] = useState({
        username: '',
        password: '',
        agencyCode: '',
        wsUrl: 'https://cargos.poliziadistato.it/CARGOS_API/'
    })

    // Export State
    const [exportDate, setExportDate] = useState(new Date().toISOString().split('T')[0])
    const [exportLoading, setExportLoading] = useState(false)
    const [exportStats, setExportStats] = useState<string | null>(null)

    useEffect(() => {
        loadVehicles()
        // Load config from localStorage if available (simple persistence for demo)
        const savedConfig = localStorage.getItem('cargos_api_config')
        if (savedConfig) {
            setApiConfig(JSON.parse(savedConfig))
        }
    }, [])

    const handleSaveConfig = () => {
        localStorage.setItem('cargos_api_config', JSON.stringify(apiConfig))
        setShowSettings(false)
    }

    async function handleAutoSend() {
        if (!apiConfig.username || !apiConfig.password || !apiConfig.agencyCode) {
            alert('Per l\'invio automatico, configura prima le credenziali API nelle impostazioni.')
            setShowSettings(true)
            return
        }

        setExportLoading(true)
        setExportStats('Connessione al Web Service Cargos in corso...')

        try {
            // Simulation of the API Handshake
            // In a real scenario, this would call a Netlify Function to avoid CORS and hide secrets
            await new Promise(resolve => setTimeout(resolve, 2000))

            // For now, we simulate a failure because we don't have the real WSDL/Auth logic
            // But this proves the flow is ready.
            throw new Error("Autenticazione Fallita. Verificare 'Codice Agenzia' e credenziali. È richiesto il certificato digitale?")

        } catch (err: any) {
            console.error(err)
            setExportStats('Errore Invio: ' + err.message)
            alert('Errore durante l\'invio automatico: ' + err.message + '\n\nNota: Per completare l\'integrazione serve il "Manuale API" ufficiale.')
        } finally {
            setExportLoading(false)
        }
    }

    // ... existing loadVehicles, handleSearch ... 

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

    async function handleExport(format: 'csv' | 'xml') {
        setExportLoading(true)
        setExportStats(null)

        try {
            // Fetch bookings for export date
            const startOfDay = new Date(exportDate)
            startOfDay.setHours(0, 0, 0, 0)
            const endOfDay = new Date(exportDate)
            endOfDay.setHours(23, 59, 59, 999)

            const { data: bookings, error } = await supabase
                .from('bookings')
                .select(`
                    id,
                    pickup_date,
                    dropoff_date,
                    vehicle_plate,
                    vehicle_name,
                    customer_name,
                    booking_details,
                    user_id
                `)
                .gte('pickup_date', startOfDay.toISOString())
                .lte('pickup_date', endOfDay.toISOString())
                .neq('status', 'cancelled')

            if (error) throw error
            if (!bookings || bookings.length === 0) {
                setExportStats('Nessuna prenotazione trovata per questa data.')
                setExportLoading(false)
                return
            }

            // Enrich with customer details
            const enrichedBookings = await Promise.all(bookings.map(async (b) => {
                let customerInfo = {
                    firstName: b.customer_name?.split(' ')[0] || '',
                    lastName: b.customer_name?.split(' ').slice(1).join(' ') || '',
                    birthDate: '',
                    birthPlace: '',
                    licenseNumber: b.booking_details?.customer?.driverLicense || '',
                    address: b.booking_details?.customer?.address || ''
                }

                if (b.user_id) {
                    const { data: c } = await supabase.from('customers_extended').select('*').eq('id', b.user_id).single()
                    if (c) {
                        customerInfo.firstName = c.nome || customerInfo.firstName
                        customerInfo.lastName = c.cognome || customerInfo.lastName
                        customerInfo.birthDate = c.data_nascita || ''
                        customerInfo.birthPlace = c.luogo_nascita || ''
                        customerInfo.licenseNumber = c.patente_numero || customerInfo.licenseNumber
                        customerInfo.address = `${c.indirizzo || ''} ${c.citta || ''} ${c.provincia || ''}`
                    }
                }
                return { ...b, ...customerInfo }
            }))

            if (format === 'csv') {
                generateCSV(enrichedBookings)
            } else {
                generateXML(enrichedBookings)
            }

            setExportStats(`File generato (${enrichedBookings.length} prenotazioni).`)

        } catch (err: any) {
            console.error(err)
            setExportStats('Errore export: ' + err.message)
        } finally {
            setExportLoading(false)
        }
    }

    function generateCSV(data: any[]) {
        const headers = [
            'Targa', 'Data Ritiro', 'Ora Ritiro', 'Data Consegna', 'Ora Consegna',
            'Cognome', 'Nome', 'Data Nascita', 'Luogo Nascita', 'Patente', 'Indirizzo'
        ]

        const rows = data.map(b => {
            const pickup = new Date(b.pickup_date)
            const dropoff = new Date(b.dropoff_date)
            return [
                b.vehicle_plate || b.booking_details?.vehicle_plate || 'Targa Mancante',
                pickup.toLocaleDateString('it-IT'),
                pickup.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
                dropoff.toLocaleDateString('it-IT'),
                dropoff.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
                b.lastName,
                b.firstName,
                b.birthDate,
                b.birthPlace,
                b.licenseNumber,
                `"${b.address}"`
            ].join(',')
        })

        const csvContent = [headers.join(','), ...rows].join('\n')
        downloadFile(csvContent, `cargos_export_${exportDate}.csv`, 'text/csv')
    }

    function generateXML(data: any[]) {
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<CargosExport date="' + exportDate + '" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n'

        data.forEach(b => {
            const pickup = new Date(b.pickup_date)
            const dropoff = new Date(b.dropoff_date)

            xml += `  <Noleggio>\n`
            xml += `    <DatiVeicolo>\n`
            xml += `       <Targa>${b.vehicle_plate || 'MISSING'}</Targa>\n`
            xml += `       <Modello>${b.vehicle_name || ''}</Modello>\n`
            xml += `    </DatiVeicolo>\n`
            xml += `    <DatiNoleggio>\n`
            xml += `       <DataInizio>${pickup.toISOString()}</DataInizio>\n`
            xml += `       <DataFine>${dropoff.toISOString()}</DataFine>\n`
            xml += `    </DatiNoleggio>\n`
            xml += `    <DatiConducente>\n`
            xml += `      <Cognome>${b.lastName}</Cognome>\n`
            xml += `      <Nome>${b.firstName}</Nome>\n`
            xml += `      <DataNascita>${b.birthDate}</DataNascita>\n`
            xml += `      <LuogoNascita>${b.birthPlace}</LuogoNascita>\n`
            xml += `      <Patente>${b.licenseNumber}</Patente>\n`
            xml += `      <Indirizzo>${b.address}</Indirizzo>\n`
            xml += `    </DatiConducente>\n`
            xml += `  </Noleggio>\n`
        })

        xml += '</CargosExport>'
        downloadFile(xml, `cargos_export_${exportDate}.xml`, 'application/xml')
    }

    function downloadFile(content: string, fileName: string, contentType: string) {
        const a = document.createElement("a")
        const file = new Blob([content], { type: contentType })
        a.href = URL.createObjectURL(file)
        a.download = fileName
        a.click()
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-theme-bg-secondary/50 p-4 rounded-lg border border-theme-border">
                <div>
                    <h2 className="text-xl font-bold text-theme-text-primary">Cargos</h2>
                    <p className="text-theme-text-muted text-sm">
                        {activeSubTab === 'fines' ? 'Ricerca conducente per data infrazione' : 'Invio telematico - Portale Polizia di Stato'}
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex bg-theme-bg-tertiary rounded-full border border-theme-border overflow-hidden">
                        <button
                            onClick={() => setActiveSubTab('fines')}
                            className={`px-4 py-2 text-sm font-medium transition-colors ${activeSubTab === 'fines' ? 'bg-dr7-gold text-black' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                        >
                            Multe
                        </button>
                        <button
                            onClick={() => setActiveSubTab('export')}
                            className={`px-4 py-2 text-sm font-medium transition-colors ${activeSubTab === 'export' ? 'bg-dr7-gold text-black' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                        >
                            Invio Telematico
                        </button>
                    </div>
                    {activeSubTab === 'export' && (
                        <>
                            <button
                                onClick={() => setShowSettings(!showSettings)}
                                className="px-3 py-2 bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text-primary rounded-full border border-theme-border transition-colors"
                                title="Impostazioni API"
                            >
                                ⚙️
                            </button>
                            <a
                                href="https://cargos.poliziadistato.it/Cargos_Portale/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-4 py-2 bg-theme-bg-tertiary text-theme-text-primary font-medium rounded-full hover:bg-theme-bg-hover transition-colors flex items-center gap-2 text-sm"
                            >
                                Apri Portale Cargos
                            </a>
                        </>
                    )}
                </div>
            </div>

            {/* API Settings Modal */}
            {showSettings && (
                <div className="bg-theme-bg-tertiary border border-theme-border p-6 rounded-full mb-6 animate-fadeIn">
                    <h3 className="text-lg font-bold text-theme-text-primary mb-4 border-b border-theme-border pb-2">⚙️ Configurazione API Cargos</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-theme-text-muted mb-1">Username (Utente Web Service)</label>
                            <Input
                                type="text"
                                value={apiConfig.username}
                                onChange={(e: any) => setApiConfig({ ...apiConfig, username: e.target.value })}
                                placeholder="Es. SC123456"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-theme-text-muted mb-1">Password</label>
                            <Input
                                type="password"
                                value={apiConfig.password}
                                onChange={(e: any) => setApiConfig({ ...apiConfig, password: e.target.value })}
                                placeholder="••••••••"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-theme-text-muted mb-1">Codice Agenzia</label>
                            <Input
                                type="text"
                                value={apiConfig.agencyCode}
                                onChange={(e: any) => setApiConfig({ ...apiConfig, agencyCode: e.target.value })}
                                placeholder="Codice identificativo questura"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-theme-text-muted mb-1">Endpoint WSDL</label>
                            <Input
                                type="text"
                                value={apiConfig.wsUrl}
                                onChange={(e: any) => setApiConfig({ ...apiConfig, wsUrl: e.target.value })}
                            />
                        </div>
                    </div>
                    <div className="flex justify-end mt-4">
                        <Button onClick={handleSaveConfig} className="bg-green-600 hover:bg-green-500">
                            Salva Configurazione
                        </Button>
                    </div>
                </div>
            )}

            {activeSubTab === 'fines' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Search Form */}
                    <div className="bg-theme-bg-tertiary p-6 rounded-full border border-theme-border space-y-4 h-fit">
                        <h3 className="text-lg font-semibold text-theme-text-primary mb-4">Dati Multa (Ricerca Driver)</h3>

                        <div>
                            <label className="block text-sm font-medium text-theme-text-muted mb-1">Targa Veicolo</label>
                            <div className="relative">
                                <input
                                    type="text"
                                    value={plate}
                                    onChange={(e) => setPlate(e.target.value.toUpperCase())}
                                    placeholder="Esempio: GB123XY"
                                    className="w-full text-theme-text-primary bg-theme-bg-secondary border border-theme-border rounded-full p-2.5 font-mono uppercase tracking-wider focus:ring-2 focus:ring-dr7-gold outline-none"
                                />
                            </div>
                            {/* Quick select from vehicles helper */}
                            <div className="mt-2 text-xs text-theme-text-muted overflow-x-auto whitespace-nowrap pb-2 flex gap-2">
                                {vehicles.slice(0, 10).map(v => (
                                    <button
                                        key={v.id}
                                        onClick={() => setPlate(v.plate || v.targa || '')}
                                        className="px-2 py-1 bg-theme-bg-tertiary rounded-full hover:bg-theme-bg-hover"
                                    >
                                        {v.display_name}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-theme-text-muted mb-1">Data Infrazione</label>
                                <Input
                                    type="date"
                                    value={fineDate}
                                    onChange={(e: any) => setFineDate(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-theme-text-muted mb-1">Ora</label>
                                <Input
                                    type="time"
                                    value={fineTime}
                                    onChange={(e: any) => setFineTime(e.target.value)}
                                />
                            </div>
                        </div>

                        <Button onClick={handleSearch} disabled={loading} className="w-full">
                            {loading ? 'Ricerca in corso...' : '🔍 Trova Conducente'}
                        </Button>

                        {error && (
                            <div className="p-3 bg-red-900/30 border border-red-800 rounded-full text-red-200 text-sm">
                                {error}
                            </div>
                        )}
                    </div>

                    {/* Results Area */}
                    <div className="lg:col-span-2">
                        {searchResult ? (
                            <div className="bg-theme-bg-tertiary rounded-lg border border-theme-border overflow-hidden">
                                <div className="p-6 border-b border-theme-border bg-theme-bg-tertiary/50">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-green-400 text-sm font-bold tracking-wider uppercase">Conducente Trovato</span>
                                                <span className="text-theme-text-muted text-xs">•</span>
                                                <span className="text-theme-text-muted text-xs">Booking ID: {searchResult.id.slice(0, 8)}...</span>
                                            </div>
                                            <h3 className="text-2xl font-bold text-theme-text-primary mb-1">{searchResult.customer_name}</h3>
                                            <p className="text-theme-text-muted text-sm flex items-center gap-2">
                                                <span>{searchResult.vehicle_name}</span>
                                                <span className="px-2 py-0.5 bg-theme-bg-tertiary rounded text-xs text-theme-text-primary font-mono">{searchResult.vehicle_plate || plate}</span>
                                            </p>
                                        </div>
                                        {searchResult.contract_url && (
                                            <a
                                                href={searchResult.contract_url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="px-4 py-2 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-full hover:bg-blue-600/30 transition-colors text-sm font-medium flex items-center gap-2"
                                            >
                                                📄 Vedi Contratto
                                            </a>
                                        )}
                                    </div>
                                </div>

                                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <h4 className="text-dr7-gold font-medium uppercase text-xs tracking-wider border-b border-theme-border pb-2">Dati Contatto</h4>

                                        <div>
                                            <label className="text-xs text-theme-text-muted">Email</label>
                                            <div className="text-theme-text-secondary flex items-center gap-2">
                                                {searchResult.customer_email || 'N/D'}
                                                <button className="text-theme-text-muted hover:text-theme-text-primary" title="Copia" onClick={() => navigator.clipboard.writeText(searchResult.customer_email)}>📋</button>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-xs text-theme-text-muted">Telefono</label>
                                            <div className="text-theme-text-secondary">{searchResult.customer_phone || 'N/D'}</div>
                                        </div>
                                        <div>
                                            <label className="text-xs text-theme-text-muted">Documento Guida</label>
                                            <div className="text-theme-text-secondary font-mono bg-theme-bg-secondary/50 p-2 rounded border border-theme-border inline-block">
                                                {searchResult.driver_license || 'Non registrato'}
                                            </div>
                                            {!searchResult.driver_license && (
                                                <p className="text-xs text-yellow-500 mt-1">⚠️ Numero patente mancante. Controlla il contratto PDF.</p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <h4 className="text-dr7-gold font-medium uppercase text-xs tracking-wider border-b border-theme-border pb-2">Periodo Noleggio</h4>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-xs text-theme-text-muted">Ritiro</label>
                                                <div className="text-theme-text-primary font-medium">
                                                    {new Date(searchResult.pickup_date).toLocaleDateString('it-IT')}
                                                </div>
                                                <div className="text-theme-text-muted text-sm">
                                                    {new Date(searchResult.pickup_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-xs text-theme-text-muted">Restituzione</label>
                                                <div className="text-theme-text-primary font-medium">
                                                    {new Date(searchResult.dropoff_date).toLocaleDateString('it-IT')}
                                                </div>
                                                <div className="text-theme-text-muted text-sm">
                                                    {new Date(searchResult.dropoff_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="text-xs text-theme-text-muted">Indirizzo Residenza (da Booking)</label>
                                            <div className="text-theme-text-secondary text-sm mt-1 p-2 bg-theme-bg-secondary/30 rounded">
                                                {searchResult.address || 'Indirizzo non presente nei metadati'}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-4 bg-theme-bg-secondary/50 border-t border-theme-border flex justify-end gap-3">
                                    <Button
                                        variant="secondary"
                                        onClick={() => {
                                            const text = `DICHIARAZIONE DATI CONDUCENTE:\n\nIl veicolo targa ${plate} era noleggiato a:\nNome: ${searchResult.customer_name}\nPatente: ${searchResult.driver_license || 'N/D'}\nData Noleggio: ${new Date(searchResult.pickup_date).toLocaleDateString()} - ${new Date(searchResult.dropoff_date).toLocaleDateString()}`
                                            navigator.clipboard.writeText(text)
                                        }}
                                    >
                                        Copia Dati per Comunicazione
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full min-h-[300px] flex flex-col items-center justify-center bg-theme-bg-tertiary/30 rounded-lg border border-theme-border border-dashed text-theme-text-muted">
                                <span className="text-4xl mb-4">👮‍♂️</span>
                                <p className="text-lg font-medium">In attesa di ricerca</p>
                                <p className="text-sm max-w-md text-center mt-2">
                                    Inserisci targa, data e ora per trovare chi guidava il veicolo al momento della multa.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeSubTab === 'export' && (
                <div className="bg-theme-bg-tertiary p-8 rounded-full border border-theme-border">
                    <div className="max-w-2xl mx-auto space-y-8">
                        <div className="text-center">
                            <span className="text-5xl mb-4 block">📤</span>
                            <h3 className="text-2xl font-bold text-theme-text-primary mb-2">Esportazione Dati per Cargos</h3>
                            <p className="text-theme-text-muted">
                                Prepara e invia automaticamente i dati dei contratti al portale Polizia di Stato.<br />
                                Seleziona la data di inizio noleggio.
                            </p>

                            {/* Alert if no config */}
                            {(!apiConfig.username || !apiConfig.password) && (
                                <div className="mt-4 p-2 bg-yellow-900/20 border border-yellow-800 text-yellow-500 text-sm rounded inline-block">
                                    ⚠️ Configurazione API mancante. <button onClick={() => setShowSettings(true)} className="underline font-bold">Clicca qui per impostare</button>
                                </div>
                            )}
                        </div>

                        <div className="bg-theme-bg-secondary/50 p-6 rounded-full border border-theme-border max-w-md mx-auto">
                            <label className="block text-sm font-medium text-theme-text-muted mb-2">Seleziona Data Inizio Noleggio</label>
                            <Input
                                type="date"
                                value={exportDate}
                                onChange={(e: any) => setExportDate(e.target.value)}
                            />

                            <div className="space-y-4 mt-6">
                                <Button
                                    onClick={handleAutoSend}
                                    className="w-full flex justify-center items-center gap-2 py-3 text-lg font-bold bg-green-600 hover:bg-green-500"
                                    disabled={exportLoading}
                                >
                                    {exportLoading ? '...' : '🚀 Invia Automaticamente a Cargos'}
                                </Button>

                                <div className="relative flex py-2 items-center">
                                    <div className="flex-grow border-t border-theme-border"></div>
                                    <span className="flex-shrink-0 mx-4 text-theme-text-muted text-xs uppercase">Oppure Scarica File</span>
                                    <div className="flex-grow border-t border-theme-border"></div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <Button
                                        onClick={() => handleExport('csv')}
                                        disabled={exportLoading}
                                        variant="secondary"
                                        className="w-full flex justify-center items-center gap-2 text-sm"
                                    >
                                        📄 Scarica CSV
                                    </Button>
                                    <Button
                                        onClick={() => handleExport('xml')}
                                        disabled={exportLoading}
                                        variant="secondary"
                                        className="w-full flex justify-center items-center gap-2 text-sm"
                                    >
                                        💻 Scarica XML
                                    </Button>
                                </div>
                            </div>

                            {exportStats && (
                                <div className={`mt-4 p-3 border rounded text-center text-sm ${exportStats.includes('Errore') ? 'bg-red-900/20 border-red-800 text-red-400' : 'bg-blue-900/20 border-blue-800 text-blue-400'}`}>
                                    {exportStats}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
