import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import GiftVoucherModal from './GiftVoucherModal'

interface Customer {
    id: string
    full_name: string
    email: string | null
    phone: string | null
    created_at: string
    tipo_cliente?: 'persona_fisica' | 'azienda' | 'pubblica_amministrazione'
    nome?: string
    cognome?: string
}

interface UserConsent {
    id: string
    user_id: string
    consent_type: string
    consent_text: string
    accepted_at: string
    ip_address: string | null
    source: string
    status: string
    revoked_at: string | null
    user_agent: string | null
    created_at: string
    // Joined from customers_extended
    user_name?: string
    user_email?: string
}

export default function MarketingTab() {
    const [customers, setCustomers] = useState<Customer[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')

    // Selection
    const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set())
    const [multiSelectMode, setMultiSelectMode] = useState(false)

    // Modal
    const [showGiftVoucherModal, setShowGiftVoucherModal] = useState(false)

    // Pagination
    const [currentPage, setCurrentPage] = useState(1)
    const CUSTOMERS_PER_PAGE = 50
    const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([])

    // GDPR Consents Section
    const [activeSection, setActiveSection] = useState<'customers' | 'consents'>('customers')
    const [consents, setConsents] = useState<UserConsent[]>([])
    const [consentsLoading, setConsentsLoading] = useState(false)
    const [consentFilter, setConsentFilter] = useState<'all' | 'active' | 'revoked'>('all')
    const [consentSearchQuery, setConsentSearchQuery] = useState('')
    const [consentPage, setConsentPage] = useState(1)
    const CONSENTS_PER_PAGE = 50

    useEffect(() => {
        loadCustomers()
        loadConsents()
    }, [])

    useEffect(() => {
        if (searchQuery) {
            setCurrentPage(1)
        }
    }, [searchQuery])

    useEffect(() => {
        if (!customers.length) return

        let result = [...customers]

        if (searchQuery) {
            const query = searchQuery.toLowerCase()
            result = result.filter((customer) => (
                customer.full_name?.toLowerCase().includes(query) ||
                customer.email?.toLowerCase().includes(query)
            ))
        }

        // Sort alphabetically
        result.sort((a, b) => a.full_name.localeCompare(b.full_name))

        setFilteredCustomers(result)
    }, [customers, searchQuery])

    async function loadCustomers() {
        setLoading(true)
        try {
            // Fetch customers from BOTH bookings (legacy/simple) and customers_extended (detailed)
            // This mirrors the logic in CustomersTab to ensure we get the full count (e.g. 523)

            // 1. Get unique customers from bookings table
            const { data: bookingsData, error: bookingsError } = await supabase
                .from('bookings')
                .select('customer_name, customer_email, customer_phone, user_id, booked_at, booking_details')
                .order('booked_at', { ascending: false })

            if (bookingsError) throw bookingsError

            const customerMap = new Map<string, Customer>()

            // Process bookings data
            if (bookingsData) {
                bookingsData.forEach((booking: any) => {
                    const details = booking.booking_details?.customer || {}
                    const customerName = booking.customer_name || details.fullName || 'Cliente'
                    const customerEmail = booking.customer_email || details.email || null
                    const customerPhone = booking.customer_phone || details.phone || null

                    // Key for uniqueness: email is best, then phone, then user_id
                    const key = customerEmail || customerPhone || booking.user_id

                    if (key) {
                        if (!customerMap.has(key)) {
                            customerMap.set(key, {
                                id: booking.user_id || key, // Use key as ID if user_id is missing
                                full_name: customerName,
                                email: customerEmail,
                                phone: customerPhone,
                                created_at: booking.booked_at,
                                tipo_cliente: 'persona_fisica', // Default to private if unknown
                                nome: customerName.split(' ')[0],
                                cognome: customerName.split(' ').slice(1).join(' ')
                            })
                        }
                    }
                })
            }

            // 2. Get customers from customers_extended and merge/overwrite
            const { data: extendedData, error: extendedError } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, email, telefono, created_at, tipo_cliente, ragione_sociale, denominazione')

            if (extendedError && extendedError.code !== '42P01') throw extendedError

            if (extendedData) {
                extendedData.forEach((c: any) => {
                    const key = c.email || c.telefono || c.id

                    const fullName = c.tipo_cliente === 'persona_fisica'
                        ? `${c.nome || ''} ${c.cognome || ''}`.trim()
                        : (c.ragione_sociale || c.denominazione || 'Cliente')

                    const customerObj: Customer = {
                        id: c.id,
                        full_name: fullName || 'Cliente',
                        email: c.email,
                        phone: c.telefono,
                        created_at: c.created_at,
                        tipo_cliente: c.tipo_cliente,
                        nome: c.nome,
                        cognome: c.cognome
                    }

                    // Overwrite or add
                    customerMap.set(key, customerObj)
                })
            }

            // 3. Get customers from customers table (legacy/main site source)
            const { data: customersData, error: customersError } = await supabase
                .from('customers')
                .select('*')
                .order('created_at', { ascending: false })

            if (!customersError && customersData) {
                customersData.forEach((c: any) => {
                    const key = c.email || c.phone || c.id
                    if (key && !customerMap.has(key)) {
                        customerMap.set(key, {
                            id: c.id,
                            full_name: c.full_name || 'Cliente',
                            email: c.email,
                            phone: c.phone,
                            created_at: c.created_at,
                            tipo_cliente: 'persona_fisica', // Default
                        })
                    }
                })
            }

            // Convert map to array
            const allCustomers = Array.from(customerMap.values())

            // Initial Sort by Name
            allCustomers.sort((a, b) => a.full_name.localeCompare(b.full_name))

            setCustomers(allCustomers)
            setFilteredCustomers(allCustomers)
        } catch (error) {
            console.error('Error loading customers for marketing:', error)
        } finally {
            setLoading(false)
        }
    }

    async function loadConsents() {
        setConsentsLoading(true)
        try {
            // Fetch all consents
            const { data: consentsData, error: consentsError } = await supabase
                .from('user_consents')
                .select('*')
                .order('accepted_at', { ascending: false })

            if (consentsError) {
                console.error('Error loading consents:', consentsError)
                setConsents([])
                return
            }

            // Fetch user details to enrich consent data
            const userIds = [...new Set(consentsData?.map(c => c.user_id) || [])]

            const { data: usersData } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, email, ragione_sociale, denominazione, tipo_cliente')
                .in('id', userIds)

            const userMap = new Map<string, { name: string; email: string }>()
            usersData?.forEach((u: any) => {
                const name = u.tipo_cliente === 'persona_fisica'
                    ? `${u.nome || ''} ${u.cognome || ''}`.trim()
                    : (u.ragione_sociale || u.denominazione || 'N/A')
                userMap.set(u.id, { name: name || 'N/A', email: u.email || 'N/A' })
            })

            // Enrich consents with user info
            const enrichedConsents: UserConsent[] = (consentsData || []).map(consent => ({
                ...consent,
                user_name: userMap.get(consent.user_id)?.name || 'Utente non trovato',
                user_email: userMap.get(consent.user_id)?.email || '-'
            }))

            setConsents(enrichedConsents)
        } catch (error) {
            console.error('Error loading consents:', error)
            setConsents([])
        } finally {
            setConsentsLoading(false)
        }
    }

    // Filter and paginate consents
    const filteredConsents = consents.filter(consent => {
        // Status filter
        if (consentFilter === 'active' && consent.status !== 'active') return false
        if (consentFilter === 'revoked' && consent.status !== 'revoked') return false

        // Search filter
        if (consentSearchQuery) {
            const query = consentSearchQuery.toLowerCase()
            return (
                consent.user_name?.toLowerCase().includes(query) ||
                consent.user_email?.toLowerCase().includes(query) ||
                consent.consent_type?.toLowerCase().includes(query)
            )
        }
        return true
    })

    const paginatedConsents = filteredConsents.slice(
        (consentPage - 1) * CONSENTS_PER_PAGE,
        consentPage * CONSENTS_PER_PAGE
    )
    const totalConsentPages = Math.ceil(filteredConsents.length / CONSENTS_PER_PAGE)

    // Selection Logic
    const handleSelectAll = () => {
        const allIds = new Set(filteredCustomers.map(c => c.id))
        setSelectedCustomerIds(allIds)
    }

    const handleSelectFirst500 = () => {
        // Select first 500 of the CURRENT filtered list
        const first500 = filteredCustomers.slice(0, 500).map(c => c.id)
        setSelectedCustomerIds(new Set(first500))
    }

    const handleDeselectAll = () => {
        setSelectedCustomerIds(new Set())
    }

    const toggleSelection = (id: string) => {
        const newSelection = new Set(selectedCustomerIds)
        if (newSelection.has(id)) {
            newSelection.delete(id)
        } else {
            newSelection.add(id)
        }
        setSelectedCustomerIds(newSelection)
    }

    async function handleSendGiftVouchers(data: { subject: string; message: string; images: File[]; channel?: 'email' | 'whatsapp' }) {
        const channel = data.channel || 'email' // Default to email for backward compatibility

        if (channel === 'email' && data.images.length === 0) {
            alert('Immagine richiesta per email')
            return
        }

        try {
            const selectedCustomersList = customers.filter(c => selectedCustomerIds.has(c.id))

            if (channel === 'whatsapp') {
                // WhatsApp Logic
                const response = await fetch('/.netlify/functions/send-whatsapp-voucher', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        customers: selectedCustomersList.map(c => ({
                            id: c.id,
                            nome: c.nome || c.full_name.split(' ')[0],
                            cognome: c.cognome || c.full_name.split(' ').slice(1).join(' '),
                            phone: c.phone || c.email // Fallback or strict? Function handles cleaning.
                        })),
                        message: data.message
                    })
                })

                const result = await response.json()
                if (result.success) {
                    alert(`Messaggi WhatsApp inviati a ${result.sent} clienti!`)
                    if (result.errors) {
                        console.warn('WhatsApp errors:', result.errors)
                        alert(`Alcuni messaggi non inviati: ${result.errors.length}`)
                    }
                    setSelectedCustomerIds(new Set())
                } else {
                    throw new Error(result.error || 'Errore invio WhatsApp')
                }

            } else {
                // Email Logic (Multiple Images)
                const imagesData = await Promise.all(
                    data.images.map(async (file) => {
                        return new Promise<{ filename: string; content: string }>((resolve, reject) => {
                            const reader = new FileReader()
                            reader.onloadend = () => resolve({
                                filename: file.name,
                                content: reader.result as string
                            })
                            reader.onerror = reject
                            reader.readAsDataURL(file)
                        })
                    })
                )

                const response = await fetch('/.netlify/functions/send-gift-voucher', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        customers: selectedCustomersList.map(c => ({
                            id: c.id,
                            nome: c.nome || c.full_name.split(' ')[0],
                            cognome: c.cognome || c.full_name.split(' ').slice(1).join(' '),
                            email: c.email
                        })),
                        subject: data.subject,
                        message: data.message,
                        images: imagesData // Array of { filename, content }
                    })
                })

                const result = await response.json()

                if (result.success) {
                    alert(`Buoni regalo inviati con successo a ${result.sent} ${result.sent === 1 ? 'cliente' : 'clienti'}!`)
                    setSelectedCustomerIds(new Set())
                } else {
                    throw new Error(result.error || 'Errore sconosciuto')
                }
            }
        } catch (error: any) {
            console.error('Error sending gift vouchers:', error)
            alert('Errore nell\'invio: ' + (error.message || 'Errore sconosciuto'))
        }
    }

    // Pagination for display
    const paginatedCustomers = filteredCustomers.slice(
        (currentPage - 1) * CUSTOMERS_PER_PAGE,
        currentPage * CUSTOMERS_PER_PAGE
    )
    const totalPages = Math.ceil(filteredCustomers.length / CUSTOMERS_PER_PAGE)

    if (loading) return <div className="text-center py-10 text-dr7-gold">Caricamento Marketing...</div>

    return (
        <div className="space-y-6">
            {/* Section Tabs */}
            <div className="flex gap-2 border-b border-theme-border pb-2">
                <button
                    onClick={() => setActiveSection('customers')}
                    className={`px-4 py-2 rounded-t font-semibold transition-colors ${
                        activeSection === 'customers'
                            ? 'bg-dr7-gold text-black'
                            : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                    }`}
                >
                    Clienti & Campagne
                </button>
                <button
                    onClick={() => setActiveSection('consents')}
                    className={`px-4 py-2 rounded-t font-semibold transition-colors ${
                        activeSection === 'consents'
                            ? 'bg-dr7-gold text-black'
                            : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                    }`}
                >
                    Consensi GDPR ({consents.filter(c => c.status === 'active').length} attivi)
                </button>
            </div>

            {/* CONSENTS SECTION */}
            {activeSection === 'consents' && (
                <div className="space-y-4">
                    <div className="flex justify-between items-center bg-theme-bg-secondary/50 p-4 rounded-lg border border-theme-border">
                        <div>
                            <h2 className="text-xl font-bold text-theme-text-primary">Consensi Marketing GDPR</h2>
                            <p className="text-theme-text-muted text-sm">Registro dei consensi raccolti con prova legale</p>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="text-center">
                                <span className="block text-2xl font-bold text-green-500">{consents.filter(c => c.status === 'active').length}</span>
                                <span className="text-xs text-theme-text-muted">Attivi</span>
                            </div>
                            <div className="text-center">
                                <span className="block text-2xl font-bold text-red-500">{consents.filter(c => c.status === 'revoked').length}</span>
                                <span className="text-xs text-theme-text-muted">Revocati</span>
                            </div>
                            <Button variant="secondary" onClick={loadConsents}>
                                Aggiorna
                            </Button>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="flex gap-4 flex-wrap">
                        <div className="bg-theme-bg-tertiary p-3 rounded-lg border border-theme-border flex-1 min-w-[200px]">
                            <input
                                type="text"
                                placeholder="Cerca per nome o email..."
                                value={consentSearchQuery}
                                onChange={(e) => {
                                    setConsentSearchQuery(e.target.value)
                                    setConsentPage(1)
                                }}
                                className="w-full bg-transparent text-theme-text-primary outline-none"
                            />
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => { setConsentFilter('all'); setConsentPage(1) }}
                                className={`px-4 py-2 rounded font-medium transition-colors ${
                                    consentFilter === 'all' ? 'bg-dr7-gold text-black' : 'bg-theme-bg-tertiary text-theme-text-primary hover:bg-theme-bg-hover'
                                }`}
                            >
                                Tutti ({consents.length})
                            </button>
                            <button
                                onClick={() => { setConsentFilter('active'); setConsentPage(1) }}
                                className={`px-4 py-2 rounded font-medium transition-colors ${
                                    consentFilter === 'active' ? 'bg-green-600 text-white' : 'bg-theme-bg-tertiary text-theme-text-primary hover:bg-theme-bg-hover'
                                }`}
                            >
                                Attivi ({consents.filter(c => c.status === 'active').length})
                            </button>
                            <button
                                onClick={() => { setConsentFilter('revoked'); setConsentPage(1) }}
                                className={`px-4 py-2 rounded font-medium transition-colors ${
                                    consentFilter === 'revoked' ? 'bg-red-600 text-white' : 'bg-theme-bg-tertiary text-theme-text-primary hover:bg-theme-bg-hover'
                                }`}
                            >
                                Revocati ({consents.filter(c => c.status === 'revoked').length})
                            </button>
                        </div>
                    </div>

                    {/* Consents Table */}
                    {consentsLoading ? (
                        <div className="text-center py-10 text-dr7-gold">Caricamento consensi...</div>
                    ) : (
                        <div className="bg-theme-bg-tertiary rounded-lg overflow-hidden border border-theme-border">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm text-theme-text-muted">
                                    <thead className="bg-theme-bg-secondary/50 text-theme-text-secondary uppercase font-medium">
                                        <tr>
                                            <th className="p-4">Utente</th>
                                            <th className="p-4">Email</th>
                                            <th className="p-4">Tipo Consenso</th>
                                            <th className="p-4">Stato</th>
                                            <th className="p-4">Data Accettazione</th>
                                            <th className="p-4">IP Address</th>
                                            <th className="p-4">Source</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-theme-border">
                                        {paginatedConsents.map((consent) => (
                                            <tr key={consent.id} className="hover:bg-theme-bg-hover/50 transition-colors">
                                                <td className="p-4 font-medium text-theme-text-primary">{consent.user_name}</td>
                                                <td className="p-4">{consent.user_email}</td>
                                                <td className="p-4">
                                                    <span className="px-2 py-1 bg-blue-900/50 text-blue-300 rounded text-xs">
                                                        {consent.consent_type}
                                                    </span>
                                                </td>
                                                <td className="p-4">
                                                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                                                        consent.status === 'active'
                                                            ? 'bg-green-900/50 text-green-300'
                                                            : 'bg-red-900/50 text-red-300'
                                                    }`}>
                                                        {consent.status === 'active' ? 'ATTIVO' : 'REVOCATO'}
                                                    </span>
                                                </td>
                                                <td className="p-4">
                                                    {new Date(consent.accepted_at).toLocaleString('it-IT', {
                                                        day: '2-digit',
                                                        month: '2-digit',
                                                        year: 'numeric',
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    })}
                                                </td>
                                                <td className="p-4 font-mono text-xs">{consent.ip_address || '-'}</td>
                                                <td className="p-4">
                                                    <span className="px-2 py-1 bg-theme-bg-tertiary rounded text-xs">
                                                        {consent.source}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                        {paginatedConsents.length === 0 && (
                                            <tr>
                                                <td colSpan={7} className="p-8 text-center text-theme-text-muted">
                                                    Nessun consenso trovato
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Pagination */}
                            {totalConsentPages > 1 && (
                                <div className="bg-theme-bg-secondary/50 p-4 border-t border-theme-border flex justify-between items-center">
                                    <span className="text-theme-text-muted text-sm">
                                        Pagina {consentPage} di {totalConsentPages} ({filteredConsents.length} consensi)
                                    </span>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="secondary"
                                            onClick={() => setConsentPage(p => Math.max(1, p - 1))}
                                            disabled={consentPage === 1}
                                        >
                                            Precedente
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            onClick={() => setConsentPage(p => Math.min(totalConsentPages, p + 1))}
                                            disabled={consentPage === totalConsentPages}
                                        >
                                            Successiva
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* CUSTOMERS SECTION */}
            {activeSection === 'customers' && (
            <>
            <div className="flex justify-between items-center bg-theme-bg-secondary/50 p-4 rounded-lg border border-theme-border">
                <div>
                    <h2 className="text-xl font-bold text-theme-text-primary">Marketing & Promozioni</h2>
                    <p className="text-theme-text-muted text-sm">Gestisci campagne e invio buoni regalo</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <span className="block text-2xl font-bold text-dr7-gold">{selectedCustomerIds.size}</span>
                        <span className="text-xs text-theme-text-muted">Selezionati</span>
                    </div>
                    <Button
                        onClick={() => setShowGiftVoucherModal(true)}
                        disabled={selectedCustomerIds.size === 0}
                    >
                        Invia Buono Regalo
                    </Button>
                </div>
            </div>

            {/* Tools Bar */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Search */}
                <div className="bg-theme-bg-tertiary p-3 rounded-full border border-theme-border">
                    <input
                        type="text"
                        placeholder="Cerca cliente..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-transparent text-theme-text-primary outline-none"
                    />
                </div>

                {/* Bulk Actions */}
                <div className="lg:col-span-3 flex gap-2 flex-wrap">
                    <button
                        onClick={() => {
                            setMultiSelectMode(!multiSelectMode)
                            if (multiSelectMode) {
                                setSelectedCustomerIds(new Set())
                            }
                        }}
                        className={`px-4 py-2 rounded-full font-semibold transition-colors ${multiSelectMode
                                ? 'bg-orange-600 text-theme-text-primary hover:bg-orange-700'
                                : 'bg-theme-bg-tertiary text-theme-text-primary hover:bg-theme-bg-hover'
                            }`}
                    >
                        {multiSelectMode ? 'Selezione Multipla ON' : 'Selezione Multipla'}
                    </button>
                    <Button variant="secondary" onClick={handleSelectAll}>Seleziona Tutti ({filteredCustomers.length})</Button>
                    <Button variant="secondary" onClick={handleSelectFirst500}>Seleziona Primi 500</Button>
                    {selectedCustomerIds.size > 0 && (
                        <Button variant="danger" onClick={handleDeselectAll}>Deseleziona Tutti ({selectedCustomerIds.size})</Button>
                    )}
                </div>
            </div>

            {/* Customers List Table */}
            <div className="bg-theme-bg-tertiary rounded-lg overflow-hidden border border-theme-border">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-theme-text-muted">
                        <thead className="bg-theme-bg-secondary/50 text-theme-text-secondary uppercase font-medium">
                            <tr>
                                <th className="p-4 w-12 text-center">
                                    <input
                                        type="checkbox"
                                        checked={paginatedCustomers.length > 0 && paginatedCustomers.every(c => selectedCustomerIds.has(c.id))}
                                        onChange={(e) => {
                                            if (e.target.checked) {
                                                // Select all on current page
                                                const newSet = new Set(selectedCustomerIds)
                                                paginatedCustomers.forEach(c => newSet.add(c.id))
                                                setSelectedCustomerIds(newSet)
                                            } else {
                                                // Deselect all on current page
                                                const newSet = new Set(selectedCustomerIds)
                                                paginatedCustomers.forEach(c => newSet.delete(c.id))
                                                setSelectedCustomerIds(newSet)
                                            }
                                        }}
                                        className="rounded-full border-theme-border-light bg-theme-bg-tertiary text-dr7-gold focus:ring-dr7-gold"
                                    />
                                </th>
                                <th className="p-4">Cliente</th>
                                <th className="p-4">Email</th>
                                <th className="p-4">Telefono</th>
                                <th className="p-4 text-right">Data Reg.</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-theme-border">
                            {paginatedCustomers.map((customer) => (
                                <tr
                                    key={customer.id}
                                    className={`hover:bg-theme-bg-hover/50 transition-colors cursor-pointer ${selectedCustomerIds.has(customer.id) ? 'bg-dr7-gold/5' : ''}`}
                                    onClick={() => toggleSelection(customer.id)}
                                >
                                    <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                                        <input
                                            type="checkbox"
                                            checked={selectedCustomerIds.has(customer.id)}
                                            onChange={() => toggleSelection(customer.id)}
                                            className="rounded-full border-theme-border-light bg-theme-bg-tertiary text-dr7-gold focus:ring-dr7-gold"
                                        />
                                    </td>
                                    <td className="p-4 font-medium text-theme-text-primary">{customer.full_name}</td>
                                    <td className="p-4">{customer.email || '-'}</td>
                                    <td className="p-4">{customer.phone || '-'}</td>
                                    <td className="p-4 text-right">
                                        {new Date(customer.created_at).toLocaleDateString('it-IT')}
                                    </td>
                                </tr>
                            ))}
                            {paginatedCustomers.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-theme-text-muted">
                                        Nessun cliente trovato
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                    <div className="bg-theme-bg-secondary/50 p-4 border-t border-theme-border flex justify-between items-center">
                        <span className="text-theme-text-muted text-sm">
                            Pagina {currentPage} di {totalPages}
                        </span>
                        <div className="flex gap-2">
                            <Button
                                variant="secondary"
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                            >
                                Precedente
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                            >
                                Successiva
                            </Button>
                        </div>
                    </div>
                )}
            </div>
            </>
            )}

            <GiftVoucherModal
                isOpen={showGiftVoucherModal}
                onClose={() => setShowGiftVoucherModal(false)}
                selectedCustomers={customers.filter(c => selectedCustomerIds.has(c.id))}
                onSend={handleSendGiftVouchers}
            />
        </div>
    )
}
