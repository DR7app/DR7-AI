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

export default function MarketingTab() {
    const [customers, setCustomers] = useState<Customer[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')

    // Selection
    const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set())

    // Modal
    const [showGiftVoucherModal, setShowGiftVoucherModal] = useState(false)

    // Pagination
    const [currentPage, setCurrentPage] = useState(1)
    const CUSTOMERS_PER_PAGE = 50
    const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([])

    useEffect(() => {
        loadCustomers()
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

    async function handleSendGiftVouchers(data: { subject: string; message: string; image: File | null }) {
        if (!data.image) {
            alert('Immagine richiesta')
            return
        }

        try {
            const selectedCustomersList = customers.filter(c => selectedCustomerIds.has(c.id))

            const reader = new FileReader()
            const imageBase64 = await new Promise<string>((resolve, reject) => {
                reader.onloadend = () => resolve(reader.result as string)
                reader.onerror = reject
                reader.readAsDataURL(data.image!)
            })

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
                    imageBase64,
                    imageName: data.image.name
                })
            })

            const result = await response.json()

            if (result.success) {
                alert(`✅ Buoni regalo inviati con successo a ${result.sent} ${result.sent === 1 ? 'cliente' : 'clienti'}!`)
                setSelectedCustomerIds(new Set())
            } else {
                throw new Error(result.error || 'Errore sconosciuto')
            }
        } catch (error: any) {
            console.error('Error sending gift vouchers:', error)
            alert('❌ Errore nell\'invio dei buoni regalo: ' + (error.message || 'Errore sconosciuto'))
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
            <div className="flex justify-between items-center bg-gray-900/50 p-4 rounded-xl border border-gray-700">
                <div>
                    <h2 className="text-xl font-bold text-white">Marketing & Promozioni</h2>
                    <p className="text-gray-400 text-sm">Gestisci campagne e invio buoni regalo</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <span className="block text-2xl font-bold text-dr7-gold">{selectedCustomerIds.size}</span>
                        <span className="text-xs text-gray-400">Selezionati</span>
                    </div>
                    <Button
                        onClick={() => setShowGiftVoucherModal(true)}
                        disabled={selectedCustomerIds.size === 0}
                    >
                        🎁 Invia Buono Regalo
                    </Button>
                </div>
            </div>

            {/* Tools Bar */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Search */}
                <div className="bg-gray-800 p-3 rounded-lg border border-gray-700">
                    <input
                        type="text"
                        placeholder="Cerca cliente..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-transparent text-white outline-none"
                    />
                </div>

                {/* Bulk Actions */}
                <div className="lg:col-span-3 flex gap-2 flex-wrap">
                    <Button variant="secondary" onClick={handleSelectAll}>Seleziona Tutti ({filteredCustomers.length})</Button>
                    <Button variant="secondary" onClick={handleSelectFirst500}>Seleziona Primi 500</Button>
                    {selectedCustomerIds.size > 0 && (
                        <Button variant="danger" onClick={handleDeselectAll}>Deseleziona Tutti</Button>
                    )}
                </div>
            </div>

            {/* Customers List Table */}
            <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-gray-400">
                        <thead className="bg-gray-900/50 text-gray-300 uppercase font-medium">
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
                                        className="rounded border-gray-600 bg-gray-700 text-dr7-gold focus:ring-dr7-gold"
                                    />
                                </th>
                                <th className="p-4">Cliente</th>
                                <th className="p-4">Email</th>
                                <th className="p-4">Telefono</th>
                                <th className="p-4 text-right">Data Reg.</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {paginatedCustomers.map((customer) => (
                                <tr
                                    key={customer.id}
                                    className={`hover:bg-gray-700/50 transition-colors cursor-pointer ${selectedCustomerIds.has(customer.id) ? 'bg-dr7-gold/5' : ''}`}
                                    onClick={() => toggleSelection(customer.id)}
                                >
                                    <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                                        <input
                                            type="checkbox"
                                            checked={selectedCustomerIds.has(customer.id)}
                                            onChange={() => toggleSelection(customer.id)}
                                            className="rounded border-gray-600 bg-gray-700 text-dr7-gold focus:ring-dr7-gold"
                                        />
                                    </td>
                                    <td className="p-4 font-medium text-white">{customer.full_name}</td>
                                    <td className="p-4">{customer.email || '-'}</td>
                                    <td className="p-4">{customer.phone || '-'}</td>
                                    <td className="p-4 text-right">
                                        {new Date(customer.created_at).toLocaleDateString('it-IT')}
                                    </td>
                                </tr>
                            ))}
                            {paginatedCustomers.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-gray-500">
                                        Nessun cliente trovato
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                    <div className="bg-gray-900/50 p-4 border-t border-gray-700 flex justify-between items-center">
                        <span className="text-gray-400 text-sm">
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

            <GiftVoucherModal
                isOpen={showGiftVoucherModal}
                onClose={() => setShowGiftVoucherModal(false)}
                selectedCustomers={customers.filter(c => selectedCustomerIds.has(c.id))}
                onSend={handleSendGiftVouchers}
            />
        </div>
    )
}
