import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'
import toast from 'react-hot-toast'

interface SystemMessage {
    id: string
    message_key: string
    label: string
    description: string
    message_body: string
    is_automatic: boolean
    is_enabled: boolean
    include_header: boolean
    trigger_event: string
    trigger_offset_hours: number
    send_hour: number | null
    target_category: string
    target_status: string
    created_at: string
    updated_at: string
}

interface CustomerResult {
    id: string
    nome: string
    cognome: string
    telefono: string
    full_name: string
}

interface SentMessageLog {
    id: string
    customer_name: string
    customer_phone: string
    message_text: string
    template_label: string | null
    sent_at: string
    status: string
}

const TRIGGER_LABELS: Record<string, string> = {
    'before_pickup': 'Prima del ritiro',
    'after_pickup': 'Dopo il ritiro',
    'before_dropoff': 'Prima della riconsegna',
    'after_dropoff': 'Dopo la riconsegna',
    'on_booking': 'Alla creazione prenotazione',
    'on_payment': 'Al pagamento',
    'on_preventivo': 'Invio preventivo',
}

const CATEGORY_LABELS: Record<string, string> = {
    'all': 'Tutti i veicoli',
    'exotic': 'Supercar / Exotic',
    'urban': 'Utilitarie',
    'aziendali': 'Aziendali',
    'furgone': 'Furgoni',
}

const SYSTEM_KEYS = ['booking_confirmation', 'booking_reminder', 'return_reminder', 'deposit_reminder']


export default function MessaggiSistemaTab() {
    // Template state
    const [templates, setTemplates] = useState<SystemMessage[]>([])
    const [loading, setLoading] = useState(true)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editBody, setEditBody] = useState('')
    const [saving, setSaving] = useState(false)

    // New template form
    const [showNewForm, setShowNewForm] = useState(false)
    const [newLabel, setNewLabel] = useState('')
    const [newDescription, setNewDescription] = useState('')
    const [newBody, setNewBody] = useState('')
    const [newIsAutomatic, setNewIsAutomatic] = useState(false)
    const [newTriggerEvent, setNewTriggerEvent] = useState('before_dropoff')
    const [newTriggerOffset, setNewTriggerOffset] = useState(24)
    const [newSendHour, setNewSendHour] = useState<number | null>(9)
    const [newTargetCategory, setNewTargetCategory] = useState('all')
    const [creatingNew, setCreatingNew] = useState(false)

    // Send section state
    const [sendMode, setSendMode] = useState<'template' | 'free'>('template')
    const [selectedTemplateId, setSelectedTemplateId] = useState('')
    const [freeText, setFreeText] = useState('')
    const [customerSearch, setCustomerSearch] = useState('')
    const [customerResults, setCustomerResults] = useState<CustomerResult[]>([])
    const [selectedCustomers, setSelectedCustomers] = useState<CustomerResult[]>([])
    const [searching, setSearching] = useState(false)
    const [sending, setSending] = useState(false)
    const [sendProgress, setSendProgress] = useState({ current: 0, total: 0 })
    const [showResults, setShowResults] = useState(false)
    const searchRef = useRef<HTMLDivElement>(null)

    // Sent messages log
    const [sentLogs, setSentLogs] = useState<SentMessageLog[]>([])
    const [logsLoading, setLogsLoading] = useState(false)

    useEffect(() => {
        loadTemplates()
        loadSentLogs()
    }, [])

    // Close search results when clicking outside
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setShowResults(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    async function loadTemplates() {
        setLoading(true)
        try {
            const { data, error } = await supabase
                .from('system_messages')
                .select('*')
                .order('created_at', { ascending: true })

            if (error) throw error
            setTemplates(data || [])
        } catch (err: unknown) {
            console.error('Error loading templates:', err)
            toast.error('Errore caricamento messaggi')
        } finally {
            setLoading(false)
        }
    }

    async function loadSentLogs() {
        setLogsLoading(true)
        try {
            const { data, error } = await supabase
                .from('sent_messages_log')
                .select('*')
                .order('sent_at', { ascending: false })
                .limit(100)

            if (error && error.code !== '42P01') throw error
            setSentLogs(data || [])
        } catch (err: unknown) {
            console.error('Error loading sent logs:', err)
        } finally {
            setLogsLoading(false)
        }
    }

    async function handleSaveEdit(id: string) {
        if (!editBody.trim()) {
            toast.error('Il messaggio non può essere vuoto')
            return
        }
        setSaving(true)
        try {
            // Use authFetch with service role to bypass RLS
            const response = await authFetch('/.netlify/functions/update-system-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, message_body: editBody })
            })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error || 'Errore salvataggio')

            setTemplates(prev => prev.map(t => t.id === id ? { ...t, message_body: editBody, updated_at: new Date().toISOString() } : t))
            setEditingId(null)
            toast.success('Messaggio aggiornato')
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            console.error('Error saving template:', err)
            toast.error('Errore salvataggio: ' + _errMsg)
        } finally {
            setSaving(false)
        }
    }

    async function handleCreateTemplate() {
        if (!newLabel.trim() || !newBody.trim()) {
            toast.error('Label e messaggio sono obbligatori')
            return
        }
        setCreatingNew(true)
        const messageKey = newLabel
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, '_')
            .substring(0, 50)

        try {
            const { data, error } = await supabase
                .from('system_messages')
                .insert({
                    message_key: messageKey + '_' + Date.now(),
                    label: newLabel.trim(),
                    description: newDescription.trim(),
                    message_body: newBody.trim(),
                    is_automatic: newIsAutomatic,
                    is_enabled: true,
                    trigger_event: newTriggerEvent,
                    trigger_offset_hours: newTriggerOffset,
                    send_hour: newSendHour,
                    target_category: newTargetCategory,
                    target_status: 'confirmed,active',
                })
                .select()
                .single()

            if (error) throw error
            setTemplates(prev => [...prev, data])
            setShowNewForm(false)
            setNewLabel('')
            setNewDescription('')
            setNewBody('')
            setNewIsAutomatic(false)
            setNewTriggerEvent('before_dropoff')
            setNewTriggerOffset(24)
            setNewSendHour(9)
            setNewTargetCategory('all')
            toast.success('Nuovo messaggio creato')
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            console.error('Error creating template:', err)
            toast.error('Errore creazione: ' + _errMsg)
        } finally {
            setCreatingNew(false)
        }
    }

    async function handleToggleAutomatic(template: SystemMessage) {
        try {
            const newVal = !template.is_automatic
            const { error } = await supabase
                .from('system_messages')
                .update({ is_automatic: newVal, updated_at: new Date().toISOString() })
                .eq('id', template.id)
            if (error) throw error
            setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, is_automatic: newVal } : t))
            toast.success(newVal ? 'Invio automatico attivato' : 'Invio automatico disattivato')
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + _errMsg)
        }
    }

    async function handleToggleEnabled(template: SystemMessage) {
        try {
            const newVal = !template.is_enabled
            const { error } = await supabase
                .from('system_messages')
                .update({ is_enabled: newVal, updated_at: new Date().toISOString() })
                .eq('id', template.id)
            if (error) throw error
            setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, is_enabled: newVal } : t))
            toast.success(newVal ? 'Messaggio attivato' : 'Messaggio disattivato')
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + _errMsg)
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function handleUpdateAutomation(templateId: string, field: string, value: any) {
        try {
            const { error } = await supabase
                .from('system_messages')
                .update({ [field]: value, updated_at: new Date().toISOString() })
                .eq('id', templateId)
            if (error) throw error
            setTemplates(prev => prev.map(t => t.id === templateId ? { ...t, [field]: value } : t))
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + _errMsg)
        }
    }

    async function handleDeleteTemplate(template: SystemMessage) {
        if (SYSTEM_KEYS.includes(template.message_key)) {
            toast.error('I messaggi di sistema non possono essere eliminati')
            return
        }
        if (!confirm(`Eliminare il messaggio "${template.label}"?`)) return

        try {
            const { error } = await supabase
                .from('system_messages')
                .delete()
                .eq('id', template.id)

            if (error) throw error
            setTemplates(prev => prev.filter(t => t.id !== template.id))
            toast.success('Messaggio eliminato')
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            console.error('Error deleting template:', err)
            toast.error('Errore eliminazione: ' + _errMsg)
        }
    }

    async function searchCustomers(query: string) {
        setCustomerSearch(query)
        if (query.length < 2) {
            setCustomerResults([])
            setShowResults(false)
            return
        }

        setSearching(true)
        setShowResults(true)
        try {
            const q = query.toLowerCase()
            // Search by name
            const { data: byName } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, telefono')
                .or(`nome.ilike.%${q}%,cognome.ilike.%${q}%`)
                .limit(20)

            // Search by phone
            const cleanQ = query.replace(/[\s\-+()]/g, '')
            const { data: byPhone } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, telefono')
                .ilike('telefono', `%${cleanQ}%`)
                .limit(10)

            const merged = new Map<string, CustomerResult>()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const process = (items: any[] | null) => {
                items?.forEach(c => {
                    if (c.telefono && !merged.has(c.id)) {
                        merged.set(c.id, {
                            id: c.id,
                            nome: c.nome || '',
                            cognome: c.cognome || '',
                            telefono: c.telefono,
                            full_name: `${c.nome || ''} ${c.cognome || ''}`.trim() || 'Cliente',
                        })
                    }
                })
            }
            process(byName)
            process(byPhone)

            // Filter out already-selected
            const selectedIds = new Set(selectedCustomers.map(c => c.id))
            setCustomerResults(Array.from(merged.values()).filter(c => !selectedIds.has(c.id)))
        } catch (err: unknown) {
            console.error('Error searching customers:', err)
        } finally {
            setSearching(false)
        }
    }

    function addCustomer(customer: CustomerResult) {
        setSelectedCustomers(prev => [...prev, customer])
        setCustomerResults(prev => prev.filter(c => c.id !== customer.id))
        setCustomerSearch('')
        setShowResults(false)
    }

    function removeCustomer(id: string) {
        setSelectedCustomers(prev => prev.filter(c => c.id !== id))
    }

    function getMessageText(): string {
        if (sendMode === 'free') return freeText
        const template = templates.find(t => t.id === selectedTemplateId)
        return template?.message_body || ''
    }

    function getPreviewText(): string {
        const text = getMessageText()
        if (!text) return ''
        const firstName = selectedCustomers.length > 0
            ? (selectedCustomers[0].nome || selectedCustomers[0].full_name.split(' ')[0])
            : '{nome}'
        return text.replace(/\{nome\}/g, firstName)
    }

    function cleanPhone(phone: string): string {
        let cleaned = phone.replace(/[\s\-+()]/g, '').replace(/[^\d]/g, '')
        if (cleaned.startsWith('00')) {
            cleaned = cleaned.substring(2)
        }
        if (cleaned.length === 10) {
            cleaned = '39' + cleaned
        }
        return cleaned
    }

    async function handleSend() {
        const messageText = getMessageText()
        if (!messageText.trim()) {
            toast.error('Scrivi o seleziona un messaggio')
            return
        }
        if (selectedCustomers.length === 0) {
            toast.error('Seleziona almeno un cliente')
            return
        }

        const customersWithPhone = selectedCustomers.filter(c => c.telefono)
        if (customersWithPhone.length === 0) {
            toast.error('Nessun cliente selezionato ha un numero di telefono')
            return
        }

        if (!confirm(`Inviare il messaggio WhatsApp a ${customersWithPhone.length} cliente/i?`)) return

        setSending(true)
        setSendProgress({ current: 0, total: customersWithPhone.length })
        let successCount = 0
        let failCount = 0

        for (let i = 0; i < customersWithPhone.length; i++) {
            const customer = customersWithPhone[i]
            const firstName = customer.nome || customer.full_name.split(' ')[0]
            const personalizedMessage = messageText.replace(/\{nome\}/g, firstName)
            const phone = cleanPhone(customer.telefono)

            setSendProgress({ current: i + 1, total: customersWithPhone.length })

            try {
                const response = await fetch('/.netlify/functions/send-whatsapp-notification', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        customMessage: personalizedMessage,
                        customPhone: phone,
                        skipHeader: sendMode === 'free'
                          || !(templates.find(t => t.id === selectedTemplateId)?.include_header),
                    }),
                })

                const result = await response.json()
                if (response.ok && result.success) {
                    successCount++
                    // Log the sent message
                    const templateLabel = sendMode === 'template'
                        ? templates.find(t => t.id === selectedTemplateId)?.label || null
                        : null
                    await supabase.from('sent_messages_log').insert({
                        customer_id: customer.id,
                        customer_name: customer.full_name,
                        customer_phone: phone,
                        message_text: personalizedMessage,
                        template_label: templateLabel,
                        status: 'sent',
                    })
                } else {
                    failCount++
                    console.error(`Failed to send to ${customer.full_name}:`, result)
                }
            } catch (err) {
                failCount++
                console.error(`Error sending to ${customer.full_name}:`, err)
            }

            // Rate limit delay between sends
            if (i < customersWithPhone.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1500))
            }
        }

        setSending(false)
        setSendProgress({ current: 0, total: 0 })

        if (successCount > 0) {
            toast.success(`Inviato a ${successCount} cliente/i`)
        }
        if (failCount > 0) {
            toast.error(`${failCount} invio/i fallito/i`)
        }

        if (successCount > 0) {
            setSelectedCustomers([])
            setFreeText('')
            loadSentLogs()
        }
    }

    if (loading) {
        return <div className="text-center py-10 text-dr7-gold">Caricamento messaggi...</div>
    }

    return (
        <div className="space-y-8">
            {/* ═══════════ SECTION A: Template Manager ═══════════ */}
            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <div>
                        <h3 className="text-lg font-bold text-theme-text-primary">Messaggi di Sistema</h3>
                        <p className="text-theme-text-muted text-sm">Template dei messaggi WhatsApp automatici e personalizzati</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={async () => {
                                try {
                                    const res = await fetch('/.netlify/functions/seed-system-messages', { method: 'POST' })
                                    const data = await res.json()
                                    if (res.ok) {
                                        toast.success(`Sincronizzati ${data.count} messaggi reali`)
                                        loadTemplates()
                                    } else {
                                        toast.error('Errore: ' + (data.error || 'sconosciuto'))
                                    }
                                } catch { toast.error('Errore sincronizzazione') }
                            }}
                            className="px-5 py-2.5 rounded-full font-semibold text-sm transition-colors bg-blue-600 text-white hover:bg-blue-500"
                        >
                            Sincronizza Messaggi Reali
                        </button>
                        <button
                            onClick={() => setShowNewForm(!showNewForm)}
                            className="px-5 py-2.5 rounded-full font-semibold text-sm transition-colors bg-dr7-gold text-white hover:bg-[#247a6f]"
                        >
                            + Nuovo Messaggio
                        </button>
                    </div>
                </div>

                {/* New Template Form */}
                {showNewForm && (
                    <div className="bg-theme-bg-secondary rounded-xl border border-dr7-gold/30 p-5 space-y-4 animate-fadeIn">
                        <h4 className="font-semibold text-theme-text-primary">Nuovo Template</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Nome del messaggio</label>
                                <input
                                    type="text"
                                    value={newLabel}
                                    onChange={e => setNewLabel(e.target.value)}
                                    placeholder="es. Promemoria appuntamento"
                                    className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Pianificazione</label>
                                <input
                                    type="text"
                                    value={newDescription}
                                    onChange={e => setNewDescription(e.target.value)}
                                    placeholder="es. 60 min dopo fine noleggio, 1 giorno prima, manuale..."
                                    className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Testo del messaggio</label>
                            <textarea
                                value={newBody}
                                onChange={e => setNewBody(e.target.value)}
                                rows={5}
                                placeholder="Buongiorno {nome},&#10;&#10;..."
                                className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 font-mono text-sm"
                            />
                            <p className="text-xs text-theme-text-muted mt-1">Placeholder: <code className="bg-theme-bg-tertiary px-1.5 py-0.5 rounded">{"{"+"nome}"}</code> = nome del cliente</p>
                        </div>

                        {/* Automation toggle */}
                        <div className="border border-theme-border rounded-lg p-4">
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={newIsAutomatic}
                                    onChange={e => setNewIsAutomatic(e.target.checked)}
                                    className="w-5 h-5 rounded border-theme-border accent-dr7-gold"
                                />
                                <div>
                                    <span className="text-sm font-semibold text-theme-text-primary">Invio Automatico</span>
                                    <p className="text-xs text-theme-text-muted">Il messaggio verrà inviato automaticamente quando le condizioni sono soddisfatte</p>
                                </div>
                            </label>

                            {newIsAutomatic && (
                                <div className="mt-4 grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-theme-text-muted mb-1">Evento</label>
                                        <select value={newTriggerEvent} onChange={e => setNewTriggerEvent(e.target.value)}
                                            className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                            {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                                                <option key={k} value={k}>{v}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-theme-text-muted mb-1">Quanto prima/dopo (ore)</label>
                                        <input type="number" value={newTriggerOffset} onChange={e => setNewTriggerOffset(parseInt(e.target.value) || 0)}
                                            className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm" />
                                        <p className="text-xs text-theme-text-muted mt-1">24 = 1 giorno, 48 = 2 giorni</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-theme-text-muted mb-1">Ora di invio (Roma)</label>
                                        <select value={newSendHour ?? ''} onChange={e => setNewSendHour(e.target.value === '' ? null : parseInt(e.target.value))}
                                            className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                            <option value="">Appena possibile</option>
                                            {Array.from({ length: 24 }, (_, i) => (
                                                <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-theme-text-muted mb-1">Categoria veicolo</label>
                                        <select value={newTargetCategory} onChange={e => setNewTargetCategory(e.target.value)}
                                            className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                                                <option key={k} value={k}>{v}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => { setShowNewForm(false); setNewLabel(''); setNewDescription(''); setNewBody('') }}
                                className="px-4 py-2 rounded-full text-sm font-medium bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover transition-colors"
                            >
                                Annulla
                            </button>
                            <button
                                onClick={handleCreateTemplate}
                                disabled={creatingNew || !newLabel.trim() || !newBody.trim()}
                                className="px-5 py-2 rounded-full text-sm font-semibold bg-dr7-gold text-white hover:bg-[#247a6f] transition-colors disabled:opacity-50"
                            >
                                {creatingNew ? 'Salvataggio...' : 'Crea Messaggio'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Template Cards — Expandable style */}
                <div className="space-y-3">
                    {templates.map((template) => (
                        <details key={template.id} className={`border rounded-lg overflow-hidden ${template.is_enabled === false ? 'border-red-500/30 opacity-60' : 'border-theme-border'}`}>
                            <summary className="px-4 py-3 cursor-pointer hover:bg-theme-bg-hover/30">
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={(e) => { e.preventDefault(); handleToggleEnabled(template) }}
                                        className={`w-10 h-5 rounded-full relative transition-colors shrink-0 ${template.is_enabled !== false ? 'bg-green-500' : 'bg-gray-600'}`}
                                    >
                                        <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${template.is_enabled !== false ? 'left-5' : 'left-0.5'}`} />
                                    </button>
                                    <span className="font-semibold text-theme-text-primary text-sm min-w-0">{template.label}</span>
                                    <div className="flex items-center gap-1.5 ml-auto shrink-0">
                                        <button
                                            onClick={(e) => { e.preventDefault(); handleToggleAutomatic(template) }}
                                            className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                                template.is_automatic
                                                    ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                                                    : 'bg-purple-600/20 text-purple-400 hover:bg-purple-600/30'
                                            }`}
                                        >
                                            {template.is_automatic ? 'Automatico' : 'Manuale'}
                                        </button>
                                        {template.is_enabled === false && (
                                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-600/20 text-red-400">OFF</span>
                                        )}
                                        <button
                                            onClick={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                const newVal = !template.include_header
                                                authFetch('/.netlify/functions/update-system-message', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ id: template.id, include_header: newVal })
                                                }).then(res => {
                                                    if (!res.ok) { toast.error('Errore aggiornamento'); return }
                                                    setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, include_header: newVal } : t))
                                                    toast.success(newVal ? 'Header/Footer attivato' : 'Header/Footer disattivato')
                                                }).catch(() => toast.error('Errore di rete'))
                                            }}
                                            className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                                template.include_header
                                                    ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30'
                                                    : 'bg-gray-600/20 text-gray-500 hover:bg-gray-600/30'
                                            }`}
                                        >
                                            {template.include_header ? 'H/F ✓' : 'H/F ✗'}
                                        </button>
                                    </div>
                                </div>
                                <p className="text-xs text-theme-text-muted mt-1 ml-[52px]">{template.description}</p>
                            </summary>

                            <div className="p-4 border-t border-theme-border space-y-3">
                                {/* Automation config */}
                                {template.is_automatic && (
                                    <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-lg bg-theme-bg-primary border border-theme-border/50">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                                            <select value={template.trigger_event || 'before_dropoff'}
                                                onChange={e => handleUpdateAutomation(template.id, 'trigger_event', e.target.value)}
                                                className="text-xs bg-transparent border-none text-theme-text-secondary focus:outline-none cursor-pointer">
                                                {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                                                    <option key={k} value={k}>{v}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <span className="text-theme-text-muted text-xs">―</span>
                                        <div className="flex items-center gap-1">
                                            <input type="number" value={template.trigger_offset_hours || 24}
                                                onChange={e => handleUpdateAutomation(template.id, 'trigger_offset_hours', parseInt(e.target.value) || 0)}
                                                className="w-12 text-xs text-center bg-dr7-gold/15 text-dr7-gold font-bold rounded-full px-2 py-1 border-none focus:outline-none" />
                                            <span className="text-xs text-dr7-gold font-bold">ore</span>
                                        </div>
                                        <span className="text-theme-text-muted text-xs">―</span>
                                        <div className="flex items-center gap-1">
                                            <select value={template.send_hour ?? ''}
                                                onChange={e => handleUpdateAutomation(template.id, 'send_hour', e.target.value === '' ? null : parseInt(e.target.value))}
                                                className="text-xs bg-transparent border-none text-theme-text-secondary focus:outline-none cursor-pointer">
                                                <option value="">Subito</option>
                                                {Array.from({ length: 24 }, (_, i) => (
                                                    <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                                                ))}
                                            </select>
                                        </div>
                                        <span className="text-theme-text-muted text-xs">―</span>
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                                            <select value={template.target_category || 'all'}
                                                onChange={e => handleUpdateAutomation(template.id, 'target_category', e.target.value)}
                                                className="text-xs bg-transparent border-none text-theme-text-secondary focus:outline-none cursor-pointer">
                                                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                                                    <option key={k} value={k}>{v}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                )}

                                {/* Message body */}
                                {editingId === template.id ? (
                                    <div>
                                        <textarea
                                            value={editBody}
                                            onChange={e => setEditBody(e.target.value)}
                                            rows={6}
                                            className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 font-mono text-sm"
                                        />
                                        <p className="text-xs text-theme-text-muted mt-1">Placeholder: <code className="bg-theme-bg-tertiary px-1.5 py-0.5 rounded">{"{"+"nome}"}</code> = nome del cliente</p>
                                    </div>
                                ) : (
                                    <pre className="px-4 py-3 rounded-lg bg-theme-bg-primary text-xs text-theme-text-secondary whitespace-pre-wrap max-h-72 overflow-y-auto border border-theme-border">
                                        {template.include_header !== false
                                            ? `*MESSAGGIO AUTOMATICO GENERATO DA RENTORA*\n_Questo messaggio è stato inviato tramite il sistema automatizzato sviluppato da Rentora, Tecnologia Proprietaria DR7_\n\n${template.message_body}\n\n_Se questo messaggio non era destinato a lei, oppure lo ha già ricevuto in precedenza, può semplicemente ignorarlo._`
                                            : template.message_body}
                                    </pre>
                                )}

                                {/* Actions */}
                                <div className="flex gap-2 justify-end">
                                    {editingId === template.id ? (
                                        <>
                                            <button onClick={() => setEditingId(null)}
                                                className="px-3 py-1.5 rounded-full text-xs font-medium bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover transition-colors">Annulla</button>
                                            <button onClick={() => handleSaveEdit(template.id)} disabled={saving}
                                                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-dr7-gold text-white hover:bg-[#247a6f] transition-colors disabled:opacity-50">
                                                {saving ? 'Salvataggio...' : 'Salva'}
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button onClick={() => { setEditingId(template.id); setEditBody(template.message_body) }}
                                                className="px-3 py-1.5 rounded-full text-xs font-medium bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover transition-colors">Modifica</button>
                                            <button onClick={() => handleDeleteTemplate(template)}
                                                className="px-3 py-1.5 rounded-full text-xs font-medium bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors">Elimina</button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </details>
                    ))}

                    {templates.length === 0 && (
                        <div className="text-center py-8 text-theme-text-muted border border-theme-border rounded-lg">
                            Nessun messaggio trovato
                        </div>
                    )}
                </div>
            </div>

            {/* ═══════════ SECTION B: Invia Messaggio Manuale ═══════════ */}
            <details className="border border-theme-border rounded-lg overflow-hidden">
                <summary className="p-4 cursor-pointer hover:bg-theme-bg-hover/30 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-600/20 text-green-400">INVIO</span>
                        <span className="font-medium text-theme-text-primary">Invia Messaggio Manuale</span>
                    </div>
                    <span className="text-xs text-theme-text-muted">Template o testo libero via WhatsApp</span>
                </summary>
            <div className="p-4 border-t border-theme-border space-y-4">

                {/* Mode toggle */}
                <div className="flex gap-2">
                    <button
                        onClick={() => setSendMode('template')}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                            sendMode === 'template'
                                ? 'bg-dr7-gold text-white'
                                : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                        }`}
                    >
                        Da Template
                    </button>
                    <button
                        onClick={() => setSendMode('free')}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                            sendMode === 'free'
                                ? 'bg-dr7-gold text-white'
                                : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                        }`}
                    >
                        Testo Libero
                    </button>
                </div>

                {/* Template selector or free text */}
                {sendMode === 'template' ? (
                    <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-1">Seleziona template</label>
                        <select
                            value={selectedTemplateId}
                            onChange={e => setSelectedTemplateId(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50"
                        >
                            <option value="">-- Scegli un messaggio --</option>
                            {templates.map(t => (
                                <option key={t.id} value={t.id}>{t.label}</option>
                            ))}
                        </select>
                    </div>
                ) : (
                    <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-1">Messaggio</label>
                        <textarea
                            value={freeText}
                            onChange={e => setFreeText(e.target.value)}
                            rows={5}
                            placeholder="Buongiorno {nome},&#10;&#10;..."
                            className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 font-mono text-sm"
                        />
                        <p className="text-xs text-theme-text-muted mt-1">Placeholder: <code className="bg-theme-bg-tertiary px-1.5 py-0.5 rounded">{"{"+"nome}"}</code> = nome del cliente</p>
                    </div>
                )}

                {/* Customer picker */}
                <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">Destinatari</label>

                    {/* Selected pills */}
                    {selectedCustomers.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                            {selectedCustomers.map(c => (
                                <span
                                    key={c.id}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-dr7-gold/20 text-dr7-gold border border-dr7-gold/30"
                                >
                                    {c.full_name}
                                    <button
                                        onClick={() => removeCustomer(c.id)}
                                        className="hover:text-red-400 transition-colors text-lg leading-none"
                                    >
                                        &times;
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Search input */}
                    <div ref={searchRef} className="relative">
                        <input
                            type="text"
                            value={customerSearch}
                            onChange={e => searchCustomers(e.target.value)}
                            onFocus={() => { if (customerResults.length > 0) setShowResults(true) }}
                            placeholder="Cerca per nome o telefono..."
                            className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50"
                        />
                        {searching && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted text-sm">
                                Ricerca...
                            </div>
                        )}

                        {/* Results dropdown */}
                        {showResults && customerResults.length > 0 && (
                            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-xl max-h-60 overflow-y-auto">
                                {customerResults.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => addCustomer(c)}
                                        className="w-full text-left px-4 py-2.5 hover:bg-theme-bg-hover transition-colors border-b border-theme-border last:border-0"
                                    >
                                        <span className="font-medium text-theme-text-primary">{c.full_name}</span>
                                        <span className="text-theme-text-muted text-sm ml-2">{c.telefono}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        {showResults && customerSearch.length >= 2 && customerResults.length === 0 && !searching && (
                            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-xl px-4 py-3 text-theme-text-muted text-sm">
                                Nessun cliente trovato con numero di telefono
                            </div>
                        )}
                    </div>
                </div>

                {/* Preview */}
                {getMessageText() && (
                    <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-1">Anteprima</label>
                        <pre className="px-4 py-3 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-secondary text-sm whitespace-pre-wrap font-sans">
                            {getPreviewText()}
                        </pre>
                    </div>
                )}

                {/* Send button */}
                <div className="flex items-center gap-4">
                    <button
                        onClick={handleSend}
                        disabled={sending || !getMessageText().trim() || selectedCustomers.length === 0}
                        className="px-6 py-2.5 rounded-full font-semibold text-sm transition-colors bg-dr7-gold text-white hover:bg-[#247a6f] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {sending
                            ? `Invio ${sendProgress.current}/${sendProgress.total}...`
                            : `Invia WhatsApp (${selectedCustomers.length})`
                        }
                    </button>
                    {sending && (
                        <span className="text-theme-text-muted text-sm">
                            Invio in corso... Non chiudere la pagina
                        </span>
                    )}
                </div>
            </div>
            </details>

            {/* Section B2 removed — all messages are in Section A (editable templates) */}

            {/* ═══════════ SECTION C: Storico Messaggi Inviati ═══════════ */}
            <div className="space-y-3">
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-bold text-theme-text-primary">Storico Messaggi Inviati</h3>
                    <button
                        onClick={loadSentLogs}
                        className="px-4 py-2 rounded-full text-sm font-medium bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover transition-colors"
                    >
                        Aggiorna
                    </button>
                </div>

                {logsLoading ? (
                    <div className="text-center py-6 text-dr7-gold">Caricamento storico...</div>
                ) : sentLogs.length === 0 ? (
                    <div className="text-center py-8 text-theme-text-muted border border-theme-border rounded-lg">
                        Nessun messaggio inviato ancora
                    </div>
                ) : (
                    <div className="space-y-2">
                        {sentLogs.map(log => (
                            <details key={log.id} className="border border-theme-border rounded-lg overflow-hidden">
                                <summary className="p-3 cursor-pointer hover:bg-theme-bg-hover/30 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-600/20 text-green-400">
                                            {log.status === 'sent' ? 'Inviato' : log.status}
                                        </span>
                                        {log.template_label && (
                                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-600/20 text-blue-400">
                                                {log.template_label}
                                            </span>
                                        )}
                                        <span className="font-medium text-theme-text-primary text-sm">{log.customer_name}</span>
                                        <span className="text-xs text-theme-text-muted font-mono">{log.customer_phone}</span>
                                    </div>
                                    <span className="text-xs text-theme-text-muted">
                                        {new Date(log.sent_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </summary>
                                <pre className="p-4 bg-theme-bg-primary text-xs text-theme-text-secondary whitespace-pre-wrap border-t border-theme-border max-h-72 overflow-y-auto">
                                    {log.message_text}
                                </pre>
                            </details>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
