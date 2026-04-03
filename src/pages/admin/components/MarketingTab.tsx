import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import GiftVoucherModal from './GiftVoucherModal'
import DiscountCodeGeneratorModal from './DiscountCodeGeneratorModal'
import { QRCodeSVG } from 'qrcode.react'
import toast from 'react-hot-toast'
import ReferralProgramTab from './ReferralProgramTab'
import CustomerWalletTab from './CustomerWalletTab'
import MessaggiSistemaTab from './MessaggiSistemaTab'
import { logger } from '../../../utils/logger'

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

interface DiscountCode {
    id: string
    code: string
    code_type: 'codice_sconto' | 'gift_card'
    scope: string[]
    value_type: 'fixed' | 'percentage'
    value_amount: number
    minimum_spend: number | null
    valid_from: string
    valid_until: string
    single_use: boolean
    message: string | null
    usage_conditions: string | null
    qr_url: string | null
    status: 'active' | 'deactivated' | 'expired'
    created_at: string
    updated_at: string
    usage_count?: number
    usage_total?: number
    last_used_at?: string | null
}

interface CustomerMarketingConsent {
    id: string
    full_name: string
    email: string | null
    phone: string | null
    marketing_consent: boolean | null
    marketing_consent_date: string | null
}

type ActiveSection = 'customers' | 'consents' | 'discount_codes' | 'marketing_consent'
type MarketingConsentFilter = 'all' | 'yes' | 'no' | 'unregistered'
type DiscountCodeFilter = 'all' | 'active' | 'deactivated' | 'expired'
type MarketingSubTab = 'marketing' | 'referral' | 'wallet' | 'messaggi'

export default function MarketingTab() {
    const [activeSubTab, setActiveSubTab] = useState<MarketingSubTab>('marketing')

    return (
        <div className="space-y-6">
            {/* Sub-tab Navigation */}
            <div className="flex gap-2 border-b border-theme-border pb-3">
                <button
                    onClick={() => setActiveSubTab('marketing')}
                    className={`px-5 py-2.5 rounded-full font-semibold text-sm transition-colors ${
                        activeSubTab === 'marketing'
                            ? 'bg-dr7-gold text-white'
                            : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                    }`}
                >
                    Marketing
                </button>
                <button
                    onClick={() => setActiveSubTab('referral')}
                    className={`px-5 py-2.5 rounded-full font-semibold text-sm transition-colors ${
                        activeSubTab === 'referral'
                            ? 'bg-dr7-gold text-white'
                            : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                    }`}
                >
                    Referral
                </button>
                <button
                    onClick={() => setActiveSubTab('wallet')}
                    className={`px-5 py-2.5 rounded-full font-semibold text-sm transition-colors ${
                        activeSubTab === 'wallet'
                            ? 'bg-dr7-gold text-white'
                            : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                    }`}
                >
                    Credit Wallet
                </button>
                <button
                    onClick={() => setActiveSubTab('messaggi')}
                    className={`px-5 py-2.5 rounded-full font-semibold text-sm transition-colors ${
                        activeSubTab === 'messaggi'
                            ? 'bg-dr7-gold text-white'
                            : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                    }`}
                >
                    Messaggi di Sistema
                </button>
            </div>

            {/* Sub-tab Content */}
            {activeSubTab === 'referral' && <ReferralProgramTab />}
            {activeSubTab === 'wallet' && <CustomerWalletTab />}
            {activeSubTab === 'messaggi' && <MessaggiSistemaTab />}
            {activeSubTab === 'marketing' && <MarketingContent />}
        </div>
    )
}

function MarketingContent() {
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
    const [activeSection, setActiveSection] = useState<ActiveSection>('customers')
    const [consents, setConsents] = useState<UserConsent[]>([])
    const [consentsLoading, setConsentsLoading] = useState(false)
    const [consentFilter, setConsentFilter] = useState<'all' | 'active' | 'revoked'>('all')
    const [consentSearchQuery, setConsentSearchQuery] = useState('')
    const [consentPage, setConsentPage] = useState(1)
    const CONSENTS_PER_PAGE = 50

    // Discount codes state
    const [discountCodes, setDiscountCodes] = useState<DiscountCode[]>([])
    const [discountCodesLoading, setDiscountCodesLoading] = useState(false)
    const [showDiscountCodeModal, setShowDiscountCodeModal] = useState(false)
    const [discountCodeFilter, setDiscountCodeFilter] = useState<DiscountCodeFilter>('all')
    const [discountCodeSearch, setDiscountCodeSearch] = useState('')
    const [selectedCodeForQR, setSelectedCodeForQR] = useState<DiscountCode | null>(null)
    const [editingCode, setEditingCode] = useState<DiscountCode | null>(null)

    // Marketing consent section state
    const [marketingConsentCustomers, setMarketingConsentCustomers] = useState<CustomerMarketingConsent[]>([])
    const [marketingConsentLoading, setMarketingConsentLoading] = useState(false)
    const [marketingConsentFilter, setMarketingConsentFilter] = useState<MarketingConsentFilter>('all')
    const [marketingConsentSearch, setMarketingConsentSearch] = useState('')
    const [marketingConsentPage, setMarketingConsentPage] = useState(1)
    const MARKETING_CONSENT_PER_PAGE = 50

    useEffect(() => {
        loadCustomers()
        loadConsents()
    }, [])

    useEffect(() => {
        if (activeSection === 'discount_codes' && discountCodes.length === 0 && !discountCodesLoading) {
            loadDiscountCodes()
        }
        if (activeSection === 'marketing_consent' && marketingConsentCustomers.length === 0 && !marketingConsentLoading) {
            loadMarketingConsentCustomers()
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSection])

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
            const { data: bookingsData, error: bookingsError } = await supabase
                .from('bookings')
                .select('customer_name, customer_email, customer_phone, user_id, booked_at, booking_details')
                .order('booked_at', { ascending: false })

            if (bookingsError) throw bookingsError

            const customerMap = new Map<string, Customer>()

            if (bookingsData) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                bookingsData.forEach((booking: any) => {
                    const details = booking.booking_details?.customer || {}
                    const customerName = booking.customer_name || details.fullName || 'Cliente'
                    const customerEmail = booking.customer_email || details.email || null
                    const customerPhone = booking.customer_phone || details.phone || null

                    const key = customerEmail || customerPhone || booking.user_id

                    if (key) {
                        if (!customerMap.has(key)) {
                            customerMap.set(key, {
                                id: booking.user_id || key,
                                full_name: customerName,
                                email: customerEmail,
                                phone: customerPhone,
                                created_at: booking.booked_at,
                                tipo_cliente: 'persona_fisica',
                                nome: customerName.split(' ')[0],
                                cognome: customerName.split(' ').slice(1).join(' ')
                            })
                        }
                    }
                })
            }

            const { data: extendedData, error: extendedError } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, email, telefono, created_at, tipo_cliente, ragione_sociale, denominazione')

            if (extendedError && extendedError.code !== '42P01') throw extendedError

            if (extendedData) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

                    customerMap.set(key, customerObj)
                })
            }

            const { data: customersData, error: customersError } = await supabase
                .from('customers')
                .select('*')
                .order('created_at', { ascending: false })

            if (!customersError && customersData) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                customersData.forEach((c: any) => {
                    const key = c.email || c.phone || c.id
                    if (key && !customerMap.has(key)) {
                        customerMap.set(key, {
                            id: c.id,
                            full_name: c.full_name || 'Cliente',
                            email: c.email,
                            phone: c.phone,
                            created_at: c.created_at,
                            tipo_cliente: 'persona_fisica',
                        })
                    }
                })
            }

            const allCustomers = Array.from(customerMap.values())
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
            const { data: consentsData, error: consentsError } = await supabase
                .from('user_consents')
                .select('*')
                .order('accepted_at', { ascending: false })

            if (consentsError) {
                console.error('Error loading consents:', consentsError)
                setConsents([])
                return
            }

            const userIds = [...new Set(consentsData?.map(c => c.user_id) || [])]

            const { data: usersData } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, email, ragione_sociale, denominazione, tipo_cliente')
                .in('id', userIds)

            const userMap = new Map<string, { name: string; email: string }>()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            usersData?.forEach((u: any) => {
                const name = u.tipo_cliente === 'persona_fisica'
                    ? `${u.nome || ''} ${u.cognome || ''}`.trim()
                    : (u.ragione_sociale || u.denominazione || 'N/A')
                userMap.set(u.id, { name: name || 'N/A', email: u.email || 'N/A' })
            })

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

    async function loadMarketingConsentCustomers() {
        setMarketingConsentLoading(true)
        try {
            const { data, error } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, email, telefono, ragione_sociale, denominazione, tipo_cliente, marketing_consent, marketing_consent_date')
                .order('marketing_consent_date', { ascending: false, nullsFirst: false })

            if (error) throw error

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const results: CustomerMarketingConsent[] = (data || []).map((c: any) => {
                const fullName = c.tipo_cliente === 'persona_fisica'
                    ? `${c.nome || ''} ${c.cognome || ''}`.trim()
                    : (c.ragione_sociale || c.denominazione || 'Cliente')
                return {
                    id: c.id,
                    full_name: fullName || 'Cliente',
                    email: c.email,
                    phone: c.telefono,
                    marketing_consent: c.marketing_consent ?? null,
                    marketing_consent_date: c.marketing_consent_date ?? null,
                }
            })

            setMarketingConsentCustomers(results)
        } catch (error) {
            console.error('Error loading marketing consent customers:', error)
            toast.error('Errore nel caricamento dei consensi marketing')
        } finally {
            setMarketingConsentLoading(false)
        }
    }

    // --- Discount codes logic ---

    async function loadDiscountCodes() {
        setDiscountCodesLoading(true)
        try {
            const { data: codes, error } = await supabase
                .from('discount_codes')
                .select('*')
                .order('created_at', { ascending: false })

            if (error) throw error

            if (!codes) {
                setDiscountCodes([])
                return
            }

            const now = new Date()
            const expiredIds: string[] = []

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const processedCodes = codes.map((code: any) => {
                if (code.status === 'active' && new Date(code.valid_until) < now) {
                    expiredIds.push(code.id)
                    return { ...code, status: 'expired' }
                }
                return code
            })

            if (expiredIds.length > 0) {
                supabase
                    .from('discount_codes')
                    .update({ status: 'expired', updated_at: new Date().toISOString() })
                    .in('id', expiredIds)
                    .then(({ error: updateError }) => {
                        if (updateError) console.error('Error auto-expiring codes:', updateError)
                    })
            }

            const { data: usageData, error: usageError } = await supabase
                .from('discount_code_usages')
                .select('discount_code_id, discount_applied, used_at')

            if (usageError && usageError.code !== '42P01') {
                console.error('Error loading usage stats:', usageError)
            }

            const usageMap = new Map<string, { count: number; total: number; lastUsed: string | null }>()
            if (usageData) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                usageData.forEach((u: any) => {
                    const existing = usageMap.get(u.discount_code_id) || { count: 0, total: 0, lastUsed: null }
                    existing.count += 1
                    existing.total += Number(u.discount_applied) || 0
                    if (!existing.lastUsed || new Date(u.used_at) > new Date(existing.lastUsed)) {
                        existing.lastUsed = u.used_at
                    }
                    usageMap.set(u.discount_code_id, existing)
                })
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const codesWithUsage: DiscountCode[] = processedCodes.map((code: any) => {
                const usage = usageMap.get(code.id)
                return {
                    ...code,
                    usage_count: usage?.count || 0,
                    usage_total: usage?.total || 0,
                    last_used_at: usage?.lastUsed || null,
                }
            })

            setDiscountCodes(codesWithUsage)
        } catch (error) {
            console.error('Error loading discount codes:', error)
        } finally {
            setDiscountCodesLoading(false)
        }
    }

    async function toggleCodeStatus(id: string, currentStatus: string) {
        if (currentStatus === 'expired') {
            toast.error('Un codice scaduto non può essere riattivato.')
            return
        }

        const newStatus = currentStatus === 'active' ? 'deactivated' : 'active'

        try {
            const { error } = await supabase
                .from('discount_codes')
                .update({ status: newStatus, updated_at: new Date().toISOString() })
                .eq('id', id)

            if (error) throw error

            setDiscountCodes(prev => prev.map(c =>
                c.id === id ? { ...c, status: newStatus as DiscountCode['status'] } : c
            ))
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error toggling code status:', error)
            toast.error(`Errore: ${_errMsg}`)
        }
    }

    function copyCode(code: string) {
        navigator.clipboard.writeText(code).then(() => {
            toast.success('Codice copiato!')
        }).catch(() => {
            const el = document.createElement('textarea')
            el.value = code
            document.body.appendChild(el)
            el.select()
            document.execCommand('copy')
            document.body.removeChild(el)
            toast.success('Codice copiato!')
        })
    }

    // Filter and paginate consents
    const filteredConsents = consents.filter(consent => {
        if (consentFilter === 'active' && consent.status !== 'active') return false
        if (consentFilter === 'revoked' && consent.status !== 'revoked') return false

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

    // Filtered marketing consent customers
    const filteredMarketingConsentCustomers = marketingConsentCustomers.filter(c => {
        if (marketingConsentFilter === 'yes' && c.marketing_consent !== true) return false
        if (marketingConsentFilter === 'no' && c.marketing_consent !== false) return false
        if (marketingConsentFilter === 'unregistered' && c.marketing_consent !== null) return false
        if (marketingConsentSearch) {
            const q = marketingConsentSearch.toLowerCase()
            return (
                c.full_name.toLowerCase().includes(q) ||
                c.email?.toLowerCase().includes(q)
            )
        }
        return true
    })

    const paginatedMarketingConsentCustomers = filteredMarketingConsentCustomers.slice(
        (marketingConsentPage - 1) * MARKETING_CONSENT_PER_PAGE,
        marketingConsentPage * MARKETING_CONSENT_PER_PAGE
    )
    const totalMarketingConsentPages = Math.ceil(filteredMarketingConsentCustomers.length / MARKETING_CONSENT_PER_PAGE)

    // Filtered discount codes
    const filteredDiscountCodes = discountCodes.filter(code => {
        if (discountCodeFilter !== 'all' && code.status !== discountCodeFilter) return false
        if (discountCodeSearch) {
            const q = discountCodeSearch.toLowerCase()
            return (
                code.code.toLowerCase().includes(q) ||
                code.message?.toLowerCase().includes(q) ||
                code.code_type.toLowerCase().includes(q)
            )
        }
        return true
    })

    // Selection Logic
    const handleSelectAll = () => {
        const allIds = new Set(filteredCustomers.map(c => c.id))
        setSelectedCustomerIds(allIds)
    }

    const handleSelectFirst500 = () => {
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
        const channel = data.channel || 'email'

        if (channel === 'email' && data.images.length === 0) {
            toast.error('Immagine richiesta per email')
            return
        }

        try {
            const selectedCustomersList = customers.filter(c => selectedCustomerIds.has(c.id))

            if (channel === 'whatsapp') {
                const response = await fetch('/.netlify/functions/send-whatsapp-voucher', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        customers: selectedCustomersList.map(c => ({
                            id: c.id,
                            nome: c.nome || c.full_name.split(' ')[0],
                            cognome: c.cognome || c.full_name.split(' ').slice(1).join(' '),
                            phone: c.phone || c.email
                        })),
                        message: data.message
                    })
                })

                const result = await response.json()
                if (result.success) {
                    toast.success(`Messaggi WhatsApp inviati a ${result.sent} clienti!`)
                    if (result.errors) {
                        logger.warn('WhatsApp errors:', result.errors)
                        toast.error(`Alcuni messaggi non inviati: ${result.errors.length}`)
                    }
                    setSelectedCustomerIds(new Set())
                } else {
                    throw new Error(result.error || 'Errore invio WhatsApp')
                }

            } else {
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
                        images: imagesData
                    })
                })

                const result = await response.json()

                if (result.success) {
                    toast.success(`Buoni regalo inviati con successo a ${result.sent} ${result.sent === 1 ? 'cliente' : 'clienti'}!`)
                    setSelectedCustomerIds(new Set())
                } else {
                    throw new Error(result.error || 'Errore sconosciuto')
                }
            }
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error sending gift vouchers:', error)
            toast.error('Errore nell\'invio: ' + (_errMsg || 'Errore sconosciuto'))
        }
    }

    // Pagination for display
    const paginatedCustomers = filteredCustomers.slice(
        (currentPage - 1) * CUSTOMERS_PER_PAGE,
        currentPage * CUSTOMERS_PER_PAGE
    )
    const totalPages = Math.ceil(filteredCustomers.length / CUSTOMERS_PER_PAGE)

    // --- Helpers ---

    function formatScopeBadges(scope: string[]) {
        const labels: Record<string, string> = {
            noleggio: 'Noleggio',
            lavaggi: 'Lavaggi',
            supercar: 'Supercar',
            utilitarie: 'Utilitarie',
            tutti_i_servizi: 'Tutti',
        }
        return scope.map(s => labels[s] || s)
    }

    function statusBadge(status: string) {
        const config: Record<string, { bg: string; text: string; label: string }> = {
            active: { bg: 'bg-green-600/20', text: 'text-green-400', label: 'Attivo' },
            deactivated: { bg: 'bg-gray-600/20', text: 'text-gray-400', label: 'Disattivato' },
            expired: { bg: 'bg-red-600/20', text: 'text-red-400', label: 'Scaduto' },
        }
        const c = config[status] || config.expired
        return (
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
                {c.label}
            </span>
        )
    }

    if (loading) return <div className="text-center py-10 text-dr7-gold">Caricamento Marketing...</div>

    return (
        <div className="space-y-6">
            {/* Section Tabs */}
            <div className="flex gap-2 border-b border-theme-border pb-2">
                <button
                    onClick={() => setActiveSection('customers')}
                    className={`px-4 py-2 rounded-t font-semibold transition-colors ${
                        activeSection === 'customers'
                            ? 'bg-dr7-gold text-theme-bg-primary'
                            : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                    }`}
                >
                    Clienti & Campagne
                </button>
                <button
                    onClick={() => setActiveSection('consents')}
                    className={`px-4 py-2 rounded-t font-semibold transition-colors ${
                        activeSection === 'consents'
                            ? 'bg-dr7-gold text-theme-bg-primary'
                            : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                    }`}
                >
                    Consensi GDPR ({consents.filter(c => c.status === 'active').length} attivi)
                </button>
                <button
                    onClick={() => setActiveSection('discount_codes')}
                    className={`px-4 py-2 rounded-t font-semibold transition-colors ${
                        activeSection === 'discount_codes'
                            ? 'bg-dr7-gold text-theme-bg-primary'
                            : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                    }`}
                >
                    Codici Sconto
                </button>
                <button
                    onClick={() => setActiveSection('marketing_consent')}
                    className={`px-4 py-2 rounded-t font-semibold transition-colors ${
                        activeSection === 'marketing_consent'
                            ? 'bg-dr7-gold text-theme-bg-primary'
                            : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                    }`}
                >
                    Consenso Marketing
                </button>
            </div>

            {/* ===================== CONSENTS SECTION ===================== */}
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
                                    consentFilter === 'all' ? 'bg-dr7-gold text-theme-bg-primary' : 'bg-theme-bg-tertiary text-theme-text-primary hover:bg-theme-bg-hover'
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

            {/* ===================== CUSTOMERS SECTION ===================== */}
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
                <div className="bg-theme-bg-tertiary p-3 rounded-full border border-theme-border">
                    <input
                        type="text"
                        placeholder="Cerca cliente..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-transparent text-theme-text-primary outline-none"
                    />
                </div>
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
                                                const newSet = new Set(selectedCustomerIds)
                                                paginatedCustomers.forEach(c => newSet.add(c.id))
                                                setSelectedCustomerIds(newSet)
                                            } else {
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

            {/* ===================== DISCOUNT CODES SECTION ===================== */}
            {activeSection === 'discount_codes' && (
                <>
                    <div className="flex justify-between items-center">
                        <div>
                            <h3 className="text-lg font-bold text-theme-text-primary">Codici Sconto & Gift Card</h3>
                            <p className="text-theme-text-muted text-sm">Genera, gestisci e traccia codici sconto e gift card</p>
                        </div>
                        <Button onClick={() => { setEditingCode(null); setShowDiscountCodeModal(true) }}>
                            Genera Codice
                        </Button>
                    </div>

                    {/* Filter bar */}
                    <div className="flex flex-wrap gap-3 items-center">
                        <div className="flex gap-2">
                            {([
                                { key: 'all' as DiscountCodeFilter, label: 'Tutti' },
                                { key: 'active' as DiscountCodeFilter, label: 'Attivi' },
                                { key: 'deactivated' as DiscountCodeFilter, label: 'Disattivati' },
                                { key: 'expired' as DiscountCodeFilter, label: 'Scaduti' },
                            ]).map(f => (
                                <button
                                    key={f.key}
                                    onClick={() => setDiscountCodeFilter(f.key)}
                                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                        discountCodeFilter === f.key
                                            ? 'bg-dr7-gold text-white'
                                            : 'bg-theme-bg-tertiary text-theme-text-primary hover:bg-theme-bg-hover'
                                    }`}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                        <div className="flex-1 min-w-[200px]">
                            <div className="bg-theme-bg-tertiary p-3 rounded-full border border-theme-border">
                                <input
                                    type="text"
                                    placeholder="Cerca codice..."
                                    value={discountCodeSearch}
                                    onChange={(e) => setDiscountCodeSearch(e.target.value)}
                                    className="w-full bg-transparent text-theme-text-primary outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Codes Table */}
                    {discountCodesLoading ? (
                        <div className="text-center py-10 text-dr7-gold">Caricamento codici...</div>
                    ) : (
                        <div className="bg-theme-bg-tertiary rounded-lg overflow-hidden border border-theme-border">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm text-theme-text-muted">
                                    <thead className="bg-theme-bg-secondary/50 text-theme-text-secondary uppercase font-medium">
                                        <tr>
                                            <th className="p-4">Codice</th>
                                            <th className="p-4">Tipo</th>
                                            <th className="p-4">Valore</th>
                                            <th className="p-4">Ambito</th>
                                            <th className="p-4">Validità</th>
                                            <th className="p-4">Stato</th>
                                            <th className="p-4">Utilizzi</th>
                                            <th className="p-4 text-right">Azioni</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-theme-border">
                                        {filteredDiscountCodes.map((code) => (
                                            <tr key={code.id} className="hover:bg-theme-bg-hover/50 transition-colors">
                                                <td className="p-4">
                                                    <span className="font-mono font-bold text-theme-text-primary tracking-wider">
                                                        {code.code}
                                                    </span>
                                                </td>
                                                <td className="p-4">
                                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                        code.code_type === 'gift_card'
                                                            ? 'bg-purple-600/20 text-purple-400'
                                                            : 'bg-blue-600/20 text-blue-400'
                                                    }`}>
                                                        {code.code_type === 'gift_card' ? 'Gift Card' : 'Sconto'}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-theme-text-primary font-medium">
                                                    {code.value_type === 'percentage'
                                                        ? `${code.value_amount}%`
                                                        : `${code.value_amount.toFixed(2)} €`
                                                    }
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex flex-wrap gap-1">
                                                        {formatScopeBadges(code.scope).map((label, i) => (
                                                            <span key={i} className="px-2 py-0.5 rounded-full text-xs bg-theme-bg-secondary text-theme-text-secondary">
                                                                {label}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td className="p-4 text-xs">
                                                    <div>{new Date(code.valid_from).toLocaleDateString('it-IT')}</div>
                                                    <div className="text-theme-text-muted">{new Date(code.valid_until).toLocaleDateString('it-IT')}</div>
                                                </td>
                                                <td className="p-4">
                                                    {statusBadge(code.status)}
                                                </td>
                                                <td className="p-4 text-center">
                                                    <span className="text-theme-text-primary font-medium">{code.usage_count || 0}</span>
                                                    {code.usage_total ? (
                                                        <div className="text-xs text-theme-text-muted">{code.usage_total.toFixed(2)} €</div>
                                                    ) : null}
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex gap-2 justify-end">
                                                        <button
                                                            onClick={() => toggleCodeStatus(code.id, code.status)}
                                                            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                                                                code.status === 'active'
                                                                    ? 'bg-gray-600 text-white hover:bg-gray-500'
                                                                    : code.status === 'deactivated'
                                                                    ? 'bg-green-600/80 text-white hover:bg-green-600'
                                                                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                                            }`}
                                                            title={
                                                                code.status === 'active' ? 'Disattiva' :
                                                                code.status === 'deactivated' ? 'Riattiva' :
                                                                'Non riattivabile'
                                                            }
                                                        >
                                                            {code.status === 'active' ? 'Disattiva' :
                                                             code.status === 'deactivated' ? 'Riattiva' :
                                                             'Scaduto'}
                                                        </button>
                                                        <button
                                                            onClick={() => setSelectedCodeForQR(code)}
                                                            className="px-3 py-1 rounded-full text-xs font-medium bg-dr7-gold/20 text-dr7-gold hover:bg-dr7-gold/30 transition-colors"
                                                        >
                                                            QR
                                                        </button>
                                                        <button
                                                            onClick={() => copyCode(code.code)}
                                                            className="px-3 py-1 rounded-full text-xs font-medium bg-theme-bg-secondary text-theme-text-secondary hover:bg-theme-bg-hover transition-colors"
                                                        >
                                                            Copia
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                        {filteredDiscountCodes.length === 0 && (
                                            <tr>
                                                <td colSpan={8} className="p-8 text-center text-theme-text-muted">
                                                    {discountCodes.length === 0
                                                        ? 'Nessun codice sconto creato. Clicca "Genera Codice" per iniziare.'
                                                        : 'Nessun codice trovato con i filtri selezionati.'
                                                    }
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {showDiscountCodeModal && (
                        <DiscountCodeGeneratorModal
                            editingCode={editingCode}
                            onClose={() => { setShowDiscountCodeModal(false); setEditingCode(null) }}
                            onSave={() => { setShowDiscountCodeModal(false); setEditingCode(null); loadDiscountCodes() }}
                        />
                    )}

                    {selectedCodeForQR && (
                        <div className="fixed inset-0 bg-theme-overlay flex items-center justify-center z-50 p-4" onClick={() => setSelectedCodeForQR(null)}>
                            <div className="bg-theme-bg-secondary rounded-3xl shadow-xl max-w-md w-full p-8" onClick={(e) => e.stopPropagation()}>
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="text-xl font-bold text-theme-text-primary">QR Code</h3>
                                    <button
                                        onClick={() => setSelectedCodeForQR(null)}
                                        className="text-theme-text-muted hover:text-theme-text-primary text-3xl leading-none"
                                    >
                                        ×
                                    </button>
                                </div>

                                <div id="qr-print-area" className="flex flex-col items-center gap-4">
                                    <div className="bg-white p-4 rounded-xl">
                                        <QRCodeSVG
                                            value={`https://dr7empire.com/promo/${selectedCodeForQR.code}`}
                                            size={200}
                                        />
                                    </div>
                                    <div className="text-center">
                                        <p className="font-mono text-lg font-bold text-dr7-gold tracking-wider">
                                            {selectedCodeForQR.code}
                                        </p>
                                        <p className="text-sm text-theme-text-secondary mt-1">
                                            {selectedCodeForQR.value_type === 'percentage'
                                                ? `${selectedCodeForQR.value_amount}% di sconto`
                                                : `${selectedCodeForQR.value_amount.toFixed(2)} € di sconto`
                                            }
                                        </p>
                                        {selectedCodeForQR.message && (
                                            <p className="text-sm text-theme-text-muted mt-2 italic">
                                                {selectedCodeForQR.message}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="flex gap-3 justify-center mt-6">
                                    <button
                                        onClick={() => window.print()}
                                        className="px-6 py-2 bg-dr7-gold text-white font-semibold rounded-full hover:bg-[#247a6f] transition-colors"
                                    >
                                        Stampa
                                    </button>
                                    <button
                                        onClick={() => copyCode(selectedCodeForQR.code)}
                                        className="px-6 py-2 bg-gray-600 text-white rounded-full hover:bg-gray-700 transition-colors"
                                    >
                                        Copia Codice
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ===================== MARKETING CONSENT SECTION ===================== */}
            {activeSection === 'marketing_consent' && (
                <div className="space-y-4">
                    <div className="flex justify-between items-center bg-theme-bg-secondary/50 p-4 rounded-lg border border-theme-border">
                        <div>
                            <h2 className="text-xl font-bold text-theme-text-primary">Consenso Marketing</h2>
                            <p className="text-theme-text-muted text-sm">Consenso raccolto alla firma del contratto (GDPR)</p>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="text-center">
                                <span className="block text-2xl font-bold text-green-500">
                                    {marketingConsentCustomers.filter(c => c.marketing_consent === true).length}
                                </span>
                                <span className="text-xs text-theme-text-muted">Si</span>
                            </div>
                            <div className="text-center">
                                <span className="block text-2xl font-bold text-red-500">
                                    {marketingConsentCustomers.filter(c => c.marketing_consent === false).length}
                                </span>
                                <span className="text-xs text-theme-text-muted">No</span>
                            </div>
                            <div className="text-center">
                                <span className="block text-2xl font-bold text-theme-text-muted">
                                    {marketingConsentCustomers.filter(c => c.marketing_consent === null).length}
                                </span>
                                <span className="text-xs text-theme-text-muted">Non registrato</span>
                            </div>
                            <Button variant="secondary" onClick={loadMarketingConsentCustomers}>
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
                                value={marketingConsentSearch}
                                onChange={(e) => {
                                    setMarketingConsentSearch(e.target.value)
                                    setMarketingConsentPage(1)
                                }}
                                className="w-full bg-transparent text-theme-text-primary outline-none"
                            />
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            {(
                                [
                                    { value: 'all', label: `Tutti (${marketingConsentCustomers.length})` },
                                    { value: 'yes', label: `Si (${marketingConsentCustomers.filter(c => c.marketing_consent === true).length})`, activeClass: 'bg-green-600 text-white' },
                                    { value: 'no', label: `No (${marketingConsentCustomers.filter(c => c.marketing_consent === false).length})`, activeClass: 'bg-red-600 text-white' },
                                    { value: 'unregistered', label: `Non registrato (${marketingConsentCustomers.filter(c => c.marketing_consent === null).length})`, activeClass: 'bg-gray-600 text-white' },
                                ] as { value: MarketingConsentFilter; label: string; activeClass?: string }[]
                            ).map(({ value, label, activeClass }) => (
                                <button
                                    key={value}
                                    onClick={() => { setMarketingConsentFilter(value); setMarketingConsentPage(1) }}
                                    className={`px-4 py-2 rounded font-medium transition-colors ${
                                        marketingConsentFilter === value
                                            ? (activeClass || 'bg-dr7-gold text-theme-bg-primary')
                                            : 'bg-theme-bg-tertiary text-theme-text-primary hover:bg-theme-bg-hover'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Table */}
                    {marketingConsentLoading ? (
                        <div className="text-center py-10 text-dr7-gold">Caricamento consensi marketing...</div>
                    ) : (
                        <div className="bg-theme-bg-tertiary rounded-lg overflow-hidden border border-theme-border">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm text-theme-text-muted">
                                    <thead className="bg-theme-bg-secondary/50 text-theme-text-secondary uppercase font-medium">
                                        <tr>
                                            <th className="p-4">Nome</th>
                                            <th className="p-4">Email</th>
                                            <th className="p-4">Telefono</th>
                                            <th className="p-4">Consenso</th>
                                            <th className="p-4">Data Consenso</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-theme-border">
                                        {paginatedMarketingConsentCustomers.map((c) => (
                                            <tr key={c.id} className="hover:bg-theme-bg-hover/50 transition-colors">
                                                <td className="p-4 font-medium text-theme-text-primary">{c.full_name}</td>
                                                <td className="p-4">{c.email || '-'}</td>
                                                <td className="p-4">{c.phone || '-'}</td>
                                                <td className="p-4">
                                                    {c.marketing_consent === true && (
                                                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-600/20 text-green-400">
                                                            Si
                                                        </span>
                                                    )}
                                                    {c.marketing_consent === false && (
                                                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-600/20 text-red-400">
                                                            No
                                                        </span>
                                                    )}
                                                    {c.marketing_consent === null && (
                                                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-600/20 text-gray-400">
                                                            Non registrato
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="p-4">
                                                    {c.marketing_consent_date
                                                        ? new Date(c.marketing_consent_date).toLocaleString('it-IT', {
                                                            day: '2-digit',
                                                            month: '2-digit',
                                                            year: 'numeric',
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                        })
                                                        : '-'}
                                                </td>
                                            </tr>
                                        ))}
                                        {paginatedMarketingConsentCustomers.length === 0 && (
                                            <tr>
                                                <td colSpan={5} className="p-8 text-center text-theme-text-muted">
                                                    Nessun cliente trovato
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {totalMarketingConsentPages > 1 && (
                                <div className="bg-theme-bg-secondary/50 p-4 border-t border-theme-border flex justify-between items-center">
                                    <span className="text-theme-text-muted text-sm">
                                        Pagina {marketingConsentPage} di {totalMarketingConsentPages} ({filteredMarketingConsentCustomers.length} clienti)
                                    </span>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="secondary"
                                            onClick={() => setMarketingConsentPage(p => Math.max(1, p - 1))}
                                            disabled={marketingConsentPage === 1}
                                        >
                                            Precedente
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            onClick={() => setMarketingConsentPage(p => Math.min(totalMarketingConsentPages, p + 1))}
                                            disabled={marketingConsentPage === totalMarketingConsentPages}
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

            <GiftVoucherModal
                isOpen={showGiftVoucherModal}
                onClose={() => setShowGiftVoucherModal(false)}
                selectedCustomers={customers.filter(c => selectedCustomerIds.has(c.id))}
                onSend={handleSendGiftVouchers}
            />
        </div>
    )
}
