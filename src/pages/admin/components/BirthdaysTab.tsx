import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import Button from './Button'

interface CustomerBirthday {
    id: string
    full_name: string
    phone: string | null
    email: string | null
    data_nascita: string | null
    days_until: number
    has_marketing_consent: boolean
    already_sent_this_year: boolean
}

interface BirthdaySentRecord {
    customer_id: string
    year: number
    sent_at: string
}

const DEFAULT_BIRTHDAY_MESSAGE = `Ciao {nome} 👋🏻

mancano esattamente 10 giorni a una data speciale: il tuo compleanno 🥳

Non vogliamo anticipare gli auguri, ma fare qualcosa di più autentico: riconoscere il tuo valore, prima ancora di celebrarlo.

In qualità di nostro cliente, abbiamo il piacere di riservarti un pensiero dedicato, in linea con il tuo stile 🎁

Per questo ti abbiamo riservato:

Credito personale di €100 utilizzabile per un noleggio DR7

Buono sconto di €10 per un lavaggio auto DR7

CODICE SCONTO: {codice}

Non è solo un regalo, ma un invito a concederti un'esperienza che ti rappresenti: potente, elegante, inconfondibile.

Ti basterà rispondere a questo messaggio per attivare il tuo credito. Saremo lieti di accompagnarti nella scelta 👇🏻

Con stima,
Dubai Rent 7.0 S.p.A.
Ogni compleanno merita uno stile all'altezza.`

export default function BirthdaysTab() {
    const [customers, setCustomers] = useState<CustomerBirthday[]>([])
    const [, setSentRecords] = useState<BirthdaySentRecord[]>([])
    const [loading, setLoading] = useState(true)
    const [sending, setSending] = useState<string | null>(null)
    const [bulkSending, setBulkSending] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

    // Filters
    const [daysRange, setDaysRange] = useState(10)
    const [showOnlyWithConsent, setShowOnlyWithConsent] = useState(false)
    const [showOnlyWithPhone, setShowOnlyWithPhone] = useState(true)
    const [showOnlyNotSent, setShowOnlyNotSent] = useState(false)

    // Editable birthday message template
    const currentYear = new Date().getFullYear()
    const [messageTemplate, setMessageTemplate] = useState(DEFAULT_BIRTHDAY_MESSAGE)
    const [editingMessage, setEditingMessage] = useState(false)
    const [draftMessage, setDraftMessage] = useState('')
    const [savingMessage, setSavingMessage] = useState(false)

    async function saveMessageTemplate() {
        setSavingMessage(true)
        try {
            const { error } = await supabase
                .from('app_settings')
                .upsert({
                    key: 'birthday_message_template',
                    value: draftMessage,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'key' })

            if (error) throw error

            setMessageTemplate(draftMessage)
            setEditingMessage(false)
            alert('Messaggio salvato!')
        } catch (error: any) {
            console.error('Error saving message template:', error)
            alert(`Errore nel salvataggio: ${error.message}`)
        } finally {
            setSavingMessage(false)
        }
    }

    // Generate unique discount code
    function generateDiscountCode(): string {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        let code = 'BDAY-'
        for (let i = 0; i < 4; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length))
        }
        code += '-'
        for (let i = 0; i < 4; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length))
        }
        return code
    }

    useEffect(() => {
        loadData()
    }, [])

    async function loadData() {
        setLoading(true)
        try {
            // Load saved birthday message template
            const { data: settingData } = await supabase
                .from('app_settings')
                .select('value')
                .eq('key', 'birthday_message_template')
                .single()

            if (settingData?.value) {
                setMessageTemplate(settingData.value)
            }

            // Load customers with birthdays
            const { data: customersData, error: customersError } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, email, telefono, data_nascita, ragione_sociale, denominazione, tipo_cliente')
                .not('data_nascita', 'is', null)

            if (customersError) throw customersError

            // Load sent birthday messages for current year
            const { data: sentData, error: sentError } = await supabase
                .from('birthday_messages')
                .select('customer_id, year, sent_at')
                .eq('year', currentYear)

            if (sentError && sentError.code !== '42P01') {
                console.warn('birthday_messages table may not exist:', sentError)
            }

            const sentSet = new Set((sentData || []).map(s => s.customer_id))
            setSentRecords(sentData || [])

            // Load marketing consents
            const { data: consentsData } = await supabase
                .from('user_consents')
                .select('user_id')
                .eq('consent_type', 'marketing')
                .eq('status', 'active')

            const consentSet = new Set((consentsData || []).map(c => c.user_id))

            // Process customers
            const today = new Date()
            today.setHours(0, 0, 0, 0)

            const processedCustomers: CustomerBirthday[] = (customersData || [])
                .map((c: any) => {
                    const fullName = c.tipo_cliente === 'persona_fisica'
                        ? `${c.nome || ''} ${c.cognome || ''}`.trim()
                        : (c.ragione_sociale || c.denominazione || 'Cliente')

                    // Parse birthday and calculate days until
                    let daysUntil = -1
                    if (c.data_nascita) {
                        const birthDate = parseBirthday(c.data_nascita)
                        if (birthDate) {
                            daysUntil = calculateDaysUntilBirthday(birthDate, today)
                        }
                    }

                    return {
                        id: c.id,
                        full_name: fullName || 'Cliente',
                        phone: c.telefono,
                        email: c.email,
                        data_nascita: c.data_nascita,
                        days_until: daysUntil,
                        has_marketing_consent: consentSet.has(c.id),
                        already_sent_this_year: sentSet.has(c.id)
                    }
                })
                .filter((c: CustomerBirthday) => c.days_until >= 0) // Only future birthdays
                .sort((a: CustomerBirthday, b: CustomerBirthday) => a.days_until - b.days_until)

            setCustomers(processedCustomers)
        } catch (error) {
            console.error('Error loading birthday data:', error)
        } finally {
            setLoading(false)
        }
    }

    function parseBirthday(dateStr: string): Date | null {
        if (!dateStr) return null

        // Try different formats
        // Format: DD/MM/YYYY or DD-MM-YYYY
        const ddmmyyyy = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
        if (ddmmyyyy) {
            return new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]))
        }

        // Format: YYYY-MM-DD (ISO)
        const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
        if (iso) {
            return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
        }

        return null
    }

    function calculateDaysUntilBirthday(birthDate: Date, today: Date): number {
        // Get this year's birthday
        let thisYearBirthday = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate())
        thisYearBirthday.setHours(0, 0, 0, 0)

        // If birthday has passed this year, get next year's
        if (thisYearBirthday < today) {
            thisYearBirthday = new Date(today.getFullYear() + 1, birthDate.getMonth(), birthDate.getDate())
        }

        const diffTime = thisYearBirthday.getTime() - today.getTime()
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    }

    function formatBirthday(dateStr: string | null): string {
        if (!dateStr) return '-'
        const date = parseBirthday(dateStr)
        if (!date) return dateStr
        return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
    }

    // Filtered customers
    const filteredCustomers = useMemo(() => {
        return customers.filter(c => {
            if (c.days_until > daysRange) return false
            if (showOnlyWithConsent && !c.has_marketing_consent) return false
            if (showOnlyWithPhone && !c.phone) return false
            if (showOnlyNotSent && c.already_sent_this_year) return false
            return true
        })
    }, [customers, daysRange, showOnlyWithConsent, showOnlyWithPhone, showOnlyNotSent])

    // Count of customers with birthdays in next 10 days (for badge)
    const upcomingCount = customers.filter(c => c.days_until <= 10 && !c.already_sent_this_year).length

    // Selectable customers (with phone, not yet sent)
    const selectableCustomers = filteredCustomers.filter(c => c.phone && !c.already_sent_this_year)

    // Toggle selection
    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedIds)
        if (newSet.has(id)) {
            newSet.delete(id)
        } else {
            newSet.add(id)
        }
        setSelectedIds(newSet)
    }

    // Select all visible
    const selectAll = () => {
        const newSet = new Set(selectableCustomers.map(c => c.id))
        setSelectedIds(newSet)
    }

    // Deselect all
    const deselectAll = () => {
        setSelectedIds(new Set())
    }

    // Bulk send messages
    async function sendBulkMessages() {
        const toSend = filteredCustomers.filter(c => selectedIds.has(c.id) && c.phone && !c.already_sent_this_year)

        if (toSend.length === 0) {
            alert('Nessun cliente selezionato')
            return
        }

        if (!confirm(`Inviare auguri a ${toSend.length} clienti?`)) {
            return
        }

        setBulkSending(true)
        let sent = 0
        let errors = 0
        const generatedCodes: string[] = []

        for (const customer of toSend) {
            try {
                // Generate unique discount code
                let discountCode = generateDiscountCode()

                // Check if code exists (retry if needed)
                let attempts = 0
                while (attempts < 5) {
                    const { data: existingCode } = await supabase
                        .from('birthday_discount_codes')
                        .select('code')
                        .eq('code', discountCode)
                        .single()

                    if (!existingCode) break
                    discountCode = generateDiscountCode()
                    attempts++
                }

                // Save discount code to database
                const { error: codeError } = await supabase
                    .from('birthday_discount_codes')
                    .insert({
                        code: discountCode,
                        customer_id: customer.id,
                        customer_name: customer.full_name,
                        customer_phone: customer.phone,
                        rental_credit: 100.00,
                        car_wash_discount: 10.00,
                        sent_via: 'whatsapp_bulk'
                    })

                if (codeError) {
                    console.error('Error saving discount code:', codeError)
                    errors++
                    continue
                }

                const firstName = customer.full_name.split(' ')[0]
                const personalizedMessage = messageTemplate
                    .replace('{nome}', firstName)
                    .replace('{codice}', discountCode)

                let cleanPhone = customer.phone!.replace(/\s+/g, '').replace(/[^\d+]/g, '')
                if (cleanPhone.startsWith('0')) {
                    cleanPhone = '39' + cleanPhone.substring(1)
                } else if (cleanPhone.startsWith('+')) {
                    cleanPhone = cleanPhone.substring(1)
                }
                if (!cleanPhone.startsWith('39') && cleanPhone.length === 10) {
                    cleanPhone = '39' + cleanPhone
                }

                const response = await fetch('/.netlify/functions/send-whatsapp-notification', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        customMessage: personalizedMessage,
                        customPhone: cleanPhone
                    })
                })

                const result = await response.json()

                if (response.ok && result.success) {
                    // Record as sent
                    await supabase
                        .from('birthday_messages')
                        .insert({
                            customer_id: customer.id,
                            year: currentYear,
                            message_text: personalizedMessage,
                            sent_via: 'green_api'
                        })

                    setCustomers(prev => prev.map(c =>
                        c.id === customer.id ? { ...c, already_sent_this_year: true } : c
                    ))
                    generatedCodes.push(`${customer.full_name}: ${discountCode}`)
                    sent++
                } else {
                    errors++
                }

                // Small delay between messages (Green API rate limit)
                await new Promise(resolve => setTimeout(resolve, 1500))
            } catch (error) {
                console.error('Error sending to', customer.full_name, error)
                errors++
            }
        }

        setBulkSending(false)
        setSelectedIds(new Set())
        alert(`Invio completato!\n\nInviati: ${sent}\nErrori: ${errors}\n\nCodici generati:\n${generatedCodes.join('\n')}`)
    }

    async function sendBirthdayMessage(customer: CustomerBirthday) {
        if (!customer.phone) {
            alert('Questo cliente non ha un numero di telefono')
            return
        }

        setSending(customer.id)

        try {
            // Generate unique discount code
            let discountCode = generateDiscountCode()

            // Check if code exists (retry if needed)
            let attempts = 0
            while (attempts < 5) {
                const { data: existingCode } = await supabase
                    .from('birthday_discount_codes')
                    .select('code')
                    .eq('code', discountCode)
                    .single()

                if (!existingCode) break
                discountCode = generateDiscountCode()
                attempts++
            }

            // Save discount code to database
            const { error: codeError } = await supabase
                .from('birthday_discount_codes')
                .insert({
                    code: discountCode,
                    customer_id: customer.id,
                    customer_name: customer.full_name,
                    customer_phone: customer.phone,
                    rental_credit: 100.00,
                    car_wash_discount: 10.00,
                    sent_via: 'whatsapp_manual'
                })

            if (codeError) {
                console.error('Error saving discount code:', codeError)
                throw new Error('Errore nel generare il codice sconto')
            }

            // Prepare personalized message with code
            const firstName = customer.full_name.split(' ')[0]
            const personalizedMessage = messageTemplate
                .replace('{nome}', firstName)
                .replace('{codice}', discountCode)

            // Clean phone number
            let cleanPhone = customer.phone.replace(/\s+/g, '').replace(/[^\d+]/g, '')
            if (cleanPhone.startsWith('0')) {
                cleanPhone = '39' + cleanPhone.substring(1)
            } else if (cleanPhone.startsWith('+')) {
                cleanPhone = cleanPhone.substring(1)
            }
            if (!cleanPhone.startsWith('39') && cleanPhone.length === 10) {
                cleanPhone = '39' + cleanPhone
            }

            // Send via Green API (automated)
            const response = await fetch('/.netlify/functions/send-whatsapp-notification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customMessage: personalizedMessage,
                    customPhone: cleanPhone
                })
            })

            const result = await response.json()

            if (!response.ok || !result.success) {
                throw new Error(result.error || result.message || 'Errore invio messaggio')
            }

            // Record the message as sent
            const { error: insertError } = await supabase
                .from('birthday_messages')
                .insert({
                    customer_id: customer.id,
                    year: currentYear,
                    message_text: personalizedMessage,
                    sent_via: 'green_api'
                })

            if (insertError) {
                console.error('Error recording birthday message:', insertError)
            }

            // Update local state
            setCustomers(prev => prev.map(c =>
                c.id === customer.id ? { ...c, already_sent_this_year: true } : c
            ))

            // Show success with code
            alert(`Messaggio inviato a ${customer.full_name}!\n\nCodice sconto generato: ${discountCode}`)
        } catch (error: any) {
            console.error('Error sending birthday message:', error)
            alert('Errore nell\'invio: ' + (error.message || 'Errore sconosciuto'))
        } finally {
            setSending(null)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-dr7-gold mx-auto mb-4"></div>
                    <p className="text-theme-text-muted">Caricamento compleanni...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center bg-theme-bg-secondary/50 p-4 rounded-lg border border-theme-border">
                <div>
                    <h2 className="text-xl font-bold text-theme-text-primary flex items-center gap-2">
                        Compleanni
                        {upcomingCount > 0 && (
                            <span className="bg-dr7-gold text-black text-sm font-bold px-2 py-0.5 rounded-full">
                                {upcomingCount}
                            </span>
                        )}
                    </h2>
                    <p className="text-theme-text-muted text-sm">Invia auguri di compleanno ai clienti</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-center">
                        <span className="block text-2xl font-bold text-dr7-gold">{filteredCustomers.length}</span>
                        <span className="text-xs text-theme-text-muted">Da contattare</span>
                    </div>
                    {selectedIds.size > 0 && (
                        <div className="text-center">
                            <span className="block text-2xl font-bold text-green-400">{selectedIds.size}</span>
                            <span className="text-xs text-theme-text-muted">Selezionati</span>
                        </div>
                    )}
                    <Button variant="secondary" onClick={loadData} disabled={bulkSending}>
                        Aggiorna
                    </Button>
                    {selectedIds.size > 0 && (
                        <Button
                            variant="primary"
                            onClick={sendBulkMessages}
                            disabled={bulkSending}
                        >
                            {bulkSending ? 'Invio in corso...' : `Invia a ${selectedIds.size} clienti`}
                        </Button>
                    )}
                </div>
            </div>

            {/* Filters */}
            <div className="bg-theme-bg-tertiary p-4 rounded-lg border border-theme-border">
                <div className="flex flex-wrap gap-4 items-center justify-between">
                    <div className="flex flex-wrap gap-4 items-center">
                        {/* Days Range */}
                        <div className="flex items-center gap-2">
                            <label className="text-theme-text-muted text-sm">Prossimi</label>
                            <select
                                value={daysRange}
                                onChange={(e) => setDaysRange(parseInt(e.target.value))}
                                className="bg-theme-bg-secondary border border-theme-border rounded px-3 py-1.5 text-theme-text-primary text-sm"
                            >
                                <option value={3}>3 giorni</option>
                                <option value={7}>7 giorni</option>
                                <option value={10}>10 giorni</option>
                                <option value={14}>14 giorni</option>
                                <option value={30}>30 giorni</option>
                            </select>
                        </div>

                        {/* Consent Filter */}
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={showOnlyWithConsent}
                                onChange={(e) => setShowOnlyWithConsent(e.target.checked)}
                                className="rounded border-theme-border bg-theme-bg-secondary text-dr7-gold focus:ring-dr7-gold"
                            />
                            <span className="text-theme-text-muted text-sm">Solo con consenso marketing</span>
                        </label>

                        {/* Phone Filter */}
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={showOnlyWithPhone}
                                onChange={(e) => setShowOnlyWithPhone(e.target.checked)}
                                className="rounded border-theme-border bg-theme-bg-secondary text-dr7-gold focus:ring-dr7-gold"
                            />
                            <span className="text-theme-text-muted text-sm">Solo con telefono</span>
                        </label>

                        {/* Not Sent Filter */}
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={showOnlyNotSent}
                                onChange={(e) => setShowOnlyNotSent(e.target.checked)}
                                className="rounded border-theme-border bg-theme-bg-secondary text-dr7-gold focus:ring-dr7-gold"
                            />
                            <span className="text-theme-text-muted text-sm">Non ancora inviato quest'anno</span>
                        </label>
                    </div>

                    {/* Selection Controls */}
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={selectAll} disabled={selectableCustomers.length === 0}>
                            Seleziona tutti ({selectableCustomers.length})
                        </Button>
                        {selectedIds.size > 0 && (
                            <Button variant="danger" onClick={deselectAll}>
                                Deseleziona
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* Editable Message Template */}
            <div className="bg-theme-bg-tertiary p-4 rounded-lg border border-theme-border">
                <div className="flex justify-between items-center mb-2">
                    <h3 className="text-theme-text-primary font-semibold">Messaggio Auguri</h3>
                    {!editingMessage ? (
                        <Button
                            variant="secondary"
                            onClick={() => { setDraftMessage(messageTemplate); setEditingMessage(true) }}
                            className="!py-1.5 !px-3 !text-xs"
                        >
                            Modifica
                        </Button>
                    ) : (
                        <div className="flex gap-2">
                            <Button
                                variant="secondary"
                                onClick={() => setEditingMessage(false)}
                                disabled={savingMessage}
                                className="!py-1.5 !px-3 !text-xs"
                            >
                                Annulla
                            </Button>
                            <Button
                                variant="primary"
                                onClick={saveMessageTemplate}
                                disabled={savingMessage}
                                className="!py-1.5 !px-3 !text-xs"
                            >
                                {savingMessage ? 'Salvataggio...' : 'Salva'}
                            </Button>
                        </div>
                    )}
                </div>
                {editingMessage ? (
                    <>
                        <textarea
                            value={draftMessage}
                            onChange={(e) => setDraftMessage(e.target.value)}
                            rows={18}
                            className="w-full text-theme-text-primary text-sm whitespace-pre-wrap bg-theme-bg-secondary p-3 rounded border border-theme-border focus:outline-none focus:border-dr7-gold resize-y"
                        />
                        <p className="text-xs text-yellow-400 mt-2">Usa <code className="bg-theme-bg-secondary px-1 rounded">{'{nome}'}</code> per il nome del cliente e <code className="bg-theme-bg-secondary px-1 rounded">{'{codice}'}</code> per il codice sconto generato automaticamente.</p>
                    </>
                ) : (
                    <>
                        <pre className="text-theme-text-muted text-sm whitespace-pre-wrap bg-theme-bg-secondary p-3 rounded border border-theme-border">
                            {messageTemplate.replace('{nome}', '[Nome Cliente]').replace('{codice}', 'BDAY-XXXX-XXXX')}
                        </pre>
                        <p className="text-xs text-green-400 mt-2">Il codice sconto viene generato automaticamente per ogni cliente</p>
                    </>
                )}
            </div>

            {/* Customers Table */}
            <div className="bg-theme-bg-tertiary rounded-lg overflow-hidden border border-theme-border">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-theme-text-muted">
                        <thead className="bg-theme-bg-secondary/50 text-theme-text-secondary uppercase font-medium">
                            <tr>
                                <th className="p-4 w-12"></th>
                                <th className="p-4">Cliente</th>
                                <th className="p-4">Telefono</th>
                                <th className="p-4">Data Nascita</th>
                                <th className="p-4 text-center">Giorni</th>
                                <th className="p-4 text-center">Consenso</th>
                                <th className="p-4 text-center">Stato Invio</th>
                                <th className="p-4 text-right">Azione</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-theme-border">
                            {filteredCustomers.map((customer) => (
                                <tr key={customer.id} className={`hover:bg-theme-bg-hover/50 transition-colors ${selectedIds.has(customer.id) ? 'bg-dr7-gold/10' : ''}`}>
                                    <td className="p-4">
                                        {customer.phone && !customer.already_sent_this_year ? (
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(customer.id)}
                                                onChange={() => toggleSelection(customer.id)}
                                                className="rounded border-theme-border bg-theme-bg-secondary text-dr7-gold focus:ring-dr7-gold"
                                                disabled={bulkSending}
                                            />
                                        ) : (
                                            <span className="text-gray-600">-</span>
                                        )}
                                    </td>
                                    <td className="p-4 font-medium text-theme-text-primary">{customer.full_name}</td>
                                    <td className="p-4">
                                        {customer.phone ? (
                                            <a href={`tel:${customer.phone}`} className="text-blue-400 hover:underline">
                                                {customer.phone}
                                            </a>
                                        ) : (
                                            <span className="text-theme-text-muted">-</span>
                                        )}
                                    </td>
                                    <td className="p-4">{formatBirthday(customer.data_nascita)}</td>
                                    <td className="p-4 text-center">
                                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                                            customer.days_until === 0
                                                ? 'bg-green-900/50 text-green-300'
                                                : customer.days_until <= 3
                                                    ? 'bg-orange-900/50 text-orange-300'
                                                    : 'bg-theme-bg-tertiary text-theme-text-secondary'
                                        }`}>
                                            {customer.days_until === 0 ? 'OGGI' : `${customer.days_until}g`}
                                        </span>
                                    </td>
                                    <td className="p-4 text-center">
                                        {customer.has_marketing_consent ? (
                                            <span className="text-green-400" title="Consenso marketing attivo">
                                                <svg className="w-5 h-5 inline" fill="currentColor" viewBox="0 0 20 20">
                                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                </svg>
                                            </span>
                                        ) : (
                                            <span className="text-theme-text-muted" title="Nessun consenso marketing">
                                                <svg className="w-5 h-5 inline" fill="currentColor" viewBox="0 0 20 20">
                                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                                </svg>
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-4 text-center">
                                        {customer.already_sent_this_year ? (
                                            <span className="px-2 py-1 bg-green-900/50 text-green-300 rounded text-xs font-medium">
                                                INVIATO
                                            </span>
                                        ) : (
                                            <span className="px-2 py-1 bg-theme-bg-tertiary text-theme-text-secondary rounded text-xs font-medium">
                                                DA INVIARE
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-4 text-right">
                                        <Button
                                            variant="primary"
                                            onClick={() => sendBirthdayMessage(customer)}
                                            disabled={!customer.phone || sending === customer.id}
                                            className="!py-1.5 !px-3 !text-xs"
                                        >
                                            {sending === customer.id ? (
                                                <span className="flex items-center gap-1">
                                                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                                    </svg>
                                                    Invio...
                                                </span>
                                            ) : customer.already_sent_this_year ? (
                                                'Reinvia'
                                            ) : (
                                                <span className="flex items-center gap-1">
                                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                                                    </svg>
                                                    WhatsApp
                                                </span>
                                            )}
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                            {filteredCustomers.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="p-8 text-center text-theme-text-muted">
                                        {customers.length === 0
                                            ? 'Nessun cliente con data di nascita registrata'
                                            : 'Nessun compleanno nei prossimi giorni con i filtri selezionati'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Legend */}
            <div className="bg-theme-bg-tertiary p-4 rounded-lg border border-theme-border">
                <h4 className="text-theme-text-primary font-semibold mb-2">Legenda</h4>
                <div className="flex flex-wrap gap-4 text-sm">
                    <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-green-900/50 text-green-300 rounded text-xs font-medium">OGGI</span>
                        <span className="text-theme-text-muted">Compleanno oggi</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-orange-900/50 text-orange-300 rounded text-xs font-medium">1-3g</span>
                        <span className="text-theme-text-muted">Compleanno imminente</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-green-400">
                            <svg className="w-4 h-4 inline" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                        </span>
                        <span className="text-theme-text-muted">Consenso marketing attivo</span>
                    </div>
                </div>
            </div>
        </div>
    )
}

// Export birthday count for badge in navigation
export function useBirthdayCount() {
    const [count, setCount] = useState(0)

    useEffect(() => {
        async function loadCount() {
            try {
                const currentYear = new Date().getFullYear()
                const today = new Date()
                today.setHours(0, 0, 0, 0)

                const { data: customersData } = await supabase
                    .from('customers_extended')
                    .select('id, data_nascita')
                    .not('data_nascita', 'is', null)

                const { data: sentData } = await supabase
                    .from('birthday_messages')
                    .select('customer_id')
                    .eq('year', currentYear)

                const sentSet = new Set((sentData || []).map(s => s.customer_id))

                let upcomingCount = 0
                ;(customersData || []).forEach((c: any) => {
                    if (sentSet.has(c.id)) return

                    const birthDate = parseBirthdayForHook(c.data_nascita)
                    if (birthDate) {
                        const daysUntil = calculateDaysUntilBirthdayForHook(birthDate, today)
                        if (daysUntil >= 0 && daysUntil <= 10) {
                            upcomingCount++
                        }
                    }
                })

                setCount(upcomingCount)
            } catch (error) {
                console.error('Error loading birthday count:', error)
            }
        }

        loadCount()
        // Refresh every 5 minutes
        const interval = setInterval(loadCount, 5 * 60 * 1000)
        return () => clearInterval(interval)
    }, [])

    return count
}

function parseBirthdayForHook(dateStr: string): Date | null {
    if (!dateStr) return null
    const ddmmyyyy = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
    if (ddmmyyyy) {
        return new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]))
    }
    const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (iso) {
        return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
    }
    return null
}

function calculateDaysUntilBirthdayForHook(birthDate: Date, today: Date): number {
    let thisYearBirthday = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate())
    thisYearBirthday.setHours(0, 0, 0, 0)
    if (thisYearBirthday < today) {
        thisYearBirthday = new Date(today.getFullYear() + 1, birthDate.getMonth(), birthDate.getDate())
    }
    const diffTime = thisYearBirthday.getTime() - today.getTime()
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}
