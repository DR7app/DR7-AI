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

// Organized by KIND of message (purpose), not by service.
// All pro_* keys start with empty body — admin fills them in from scratch.
type ProTemplateDef = { key: string; label: string; description: string }
const PRO_MESSAGE_CATEGORIES: { label: string; templates: ProTemplateDef[] }[] = [
  {
    label: 'Conferma',
    templates: [
      { key: 'pro_conferma_noleggio',          label: 'Conferma Noleggio',             description: 'Conferma al cliente dopo creazione prenotazione noleggio' },
      { key: 'pro_conferma_lavaggio',          label: 'Conferma Lavaggio',             description: 'Conferma al cliente dopo prenotazione lavaggio' },
      { key: 'pro_conferma_meccanica',         label: 'Conferma Meccanica',            description: 'Conferma al cliente dopo prenotazione meccanica' },
      { key: 'pro_conferma_pagamento',         label: 'Conferma Pagamento',            description: 'Conferma ricezione pagamento' },
      { key: 'pro_conferma_contratto_firmato', label: 'Conferma Contratto Firmato',    description: 'Conferma dopo firma contratto' },
      { key: 'pro_conferma_preventivo',        label: 'Conferma Preventivo Inviato',   description: 'Conferma invio preventivo al cliente' },
    ],
  },
  {
    label: 'Modifica',
    templates: [
      { key: 'pro_modifica_noleggio',  label: 'Modifica Noleggio',  description: 'Comunicazione al cliente dopo modifica di una prenotazione noleggio' },
      { key: 'pro_modifica_lavaggio',  label: 'Modifica Lavaggio',  description: 'Comunicazione al cliente dopo modifica di una prenotazione lavaggio' },
      { key: 'pro_modifica_meccanica', label: 'Modifica Meccanica', description: 'Comunicazione al cliente dopo modifica di una prenotazione meccanica' },
    ],
  },
  {
    label: 'Email',
    templates: [
      { key: 'pro_email_addebito',         label: 'Email Addebito — Corpo',    description: 'Corpo dell\'email di comunicazione addebito (var: {customer_name}, {contract_ref}, {amount}, {causale})' },
      { key: 'pro_email_addebito_subject', label: 'Email Addebito — Oggetto',  description: 'Oggetto dell\'email di addebito (var: {contract_ref})' },
    ],
  },
  {
    label: 'Promemoria',
    templates: [
      { key: 'pro_promemoria_pickup',        label: 'Promemoria Ritiro',         description: 'Promemoria prima del ritiro veicolo' },
      { key: 'pro_promemoria_dropoff',       label: 'Promemoria Riconsegna',     description: 'Promemoria prima della riconsegna veicolo' },
      { key: 'pro_promemoria_checkin',       label: 'Promemoria Check-in',       description: 'Promemoria check-in lavaggio / meccanica' },
      { key: 'pro_promemoria_checkout',      label: 'Promemoria Check-out',      description: 'Promemoria check-out lavaggio / meccanica' },
      { key: 'pro_promemoria_firma',         label: 'Promemoria Firma',          description: 'Promemoria firma contratto pendente' },
      { key: 'pro_promemoria_pagamento',     label: 'Promemoria Pagamento',      description: 'Promemoria pagamento da saldare' },
      { key: 'pro_promemoria_appuntamento',  label: 'Promemoria Appuntamento',   description: 'Promemoria generico appuntamento' },
    ],
  },
  {
    label: 'Richieste al Cliente',
    templates: [
      { key: 'pro_richiesta_pagamento',  label: 'Richiesta Pagamento',        description: 'Invio link di pagamento al cliente' },
      { key: 'pro_richiesta_firma',      label: 'Richiesta Firma',            description: 'Invio link firma contratto' },
      { key: 'pro_richiesta_otp',        label: 'Richiesta OTP',              description: 'Invio codice OTP per conferma firma' },
      { key: 'pro_richiesta_iban',       label: 'Richiesta IBAN',             description: 'Richiesta IBAN per rimborso cauzione' },
      { key: 'pro_richiesta_documenti',  label: 'Richiesta Documenti',        description: 'Richiesta documenti aggiuntivi al cliente' },
    ],
  },
  {
    label: 'Notifiche Admin',
    templates: [
      { key: 'pro_admin_nuova_prenotazione', label: 'Admin: Nuova Prenotazione', description: 'Alert interno per nuova prenotazione' },
      { key: 'pro_admin_nuovo_preventivo',   label: 'Admin: Nuovo Preventivo',   description: 'Alert interno per nuovo preventivo dal sito' },
      { key: 'pro_admin_contratto_firmato',  label: 'Admin: Contratto Firmato',  description: 'Alert interno dopo firma contratto' },
      { key: 'pro_admin_pagamento_ricevuto', label: 'Admin: Pagamento Ricevuto', description: 'Alert interno dopo pagamento ricevuto' },
      { key: 'pro_admin_annullamento',       label: 'Admin: Annullamento',       description: 'Alert interno per annullamento prenotazione' },
      { key: 'pro_admin_carta_bloccata',     label: 'Admin: Carta Bloccata',     description: 'Alert interno per carta prepagata bloccata' },
    ],
  },
  {
    label: 'Documenti',
    templates: [
      { key: 'pro_documento_contratto', label: 'Invio Contratto PDF',  description: 'Messaggio che accompagna il PDF del contratto' },
      { key: 'pro_documento_fattura',   label: 'Invio Fattura PDF',    description: 'Messaggio che accompagna il PDF della fattura' },
      { key: 'pro_documento_penale',    label: 'Invio Penale PDF',     description: 'Messaggio che accompagna il PDF della penale' },
      { key: 'pro_documento_ricevuta',  label: 'Invio Ricevuta',       description: 'Messaggio che accompagna la ricevuta di pagamento' },
    ],
  },
  {
    label: 'Annullamenti & Rimborsi',
    templates: [
      { key: 'pro_annullamento_cliente', label: 'Annullamento al Cliente', description: 'Comunicazione annullamento prenotazione al cliente' },
      { key: 'pro_rimborso_iniziato',    label: 'Rimborso Iniziato',       description: 'Notifica al cliente che il rimborso è in lavorazione' },
      { key: 'pro_rimborso_completato',  label: 'Rimborso Completato',     description: 'Notifica al cliente a rimborso completato' },
    ],
  },
  {
    label: 'Marketing',
    templates: [
      { key: 'pro_marketing_recensione', label: 'Richiesta Recensione', description: 'Richiesta di recensione dopo il servizio' },
      { key: 'pro_marketing_compleanno', label: 'Messaggio Compleanno', description: 'Auguri di compleanno al cliente' },
      { key: 'pro_marketing_referral',   label: 'Codice Referral',      description: 'Invio codice referral al cliente' },
      { key: 'pro_marketing_rinnovo',    label: 'Promemoria Rinnovo',   description: 'Promemoria rinnovo membership DR7 Club' },
      { key: 'pro_wallet_bonus_cliente', label: 'Bonus Wallet Cliente', description: 'Notifica bonus wallet accreditato al cliente' },
    ],
  },
  {
    label: 'Wrapper Messaggio',
    templates: [
      { key: 'pro_wrapper_header', label: 'Header Messaggio', description: 'Testo in cima a ogni messaggio (opzionale)' },
      { key: 'pro_wrapper_footer', label: 'Footer Messaggio', description: 'Testo in fondo a ogni messaggio (opzionale)' },
    ],
  },
]

const ALL_PRO_TEMPLATES: ProTemplateDef[] = PRO_MESSAGE_CATEGORIES.flatMap(c => c.templates)

// Wrappers are never numbered and never bulk-deleted by "Elimina non attivi"
const WRAPPER_KEYS = new Set(['pro_wrapper_header', 'pro_wrapper_footer'])


export default function MessaggiSistemaProTab() {
    // Template state
    const [templates, setTemplates] = useState<SystemMessage[]>([])
    const [loading, setLoading] = useState(true)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editBody, setEditBody] = useState('')
    const [editLabel, setEditLabel] = useState('')
    const [saving, setSaving] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')

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
            // Fetch every pro_* row AND any pro_custom_* the admin created
            const { data, error } = await supabase
                .from('system_messages')
                .select('*')
                .like('message_key', 'pro_%')
                .order('created_at', { ascending: true })

            if (error) throw error
            let rows = data || []

            // Auto-seed all pro_* rows ONLY on first-ever visit (zero rows exist).
            // After that, respect user deletions — a deleted template must stay deleted.
            const missing = rows.length === 0
                ? ALL_PRO_TEMPLATES
                : []
            if (missing.length > 0) {
                const toInsert = missing.map(t => ({
                    message_key: t.key,
                    label: t.label,
                    description: t.description,
                    message_body: '',
                    is_automatic: false,
                    is_enabled: false,
                    include_header: false,
                    trigger_event: 'before_dropoff',
                    trigger_offset_hours: 24,
                    send_hour: 9,
                    target_category: 'all',
                    target_status: 'confirmed,active',
                }))
                const { data: inserted, error: insErr } = await supabase
                    .from('system_messages')
                    .insert(toInsert)
                    .select()
                if (insErr) {
                    console.error('Auto-seed pro templates failed:', insErr)
                } else if (inserted) {
                    rows = [...rows, ...inserted]
                }
            }

            // One-time cleanup: flip include_header=false on untouched seeded rows
            // (empty body + manual + disabled = admin hasn't configured yet)
            const untouchedWithHeader = rows.filter(r =>
                r.include_header === true &&
                !r.message_body &&
                r.is_automatic === false &&
                r.is_enabled === false
            )
            if (untouchedWithHeader.length > 0) {
                const ids = untouchedWithHeader.map(r => r.id)
                const { error: upErr } = await supabase
                    .from('system_messages')
                    .update({ include_header: false })
                    .in('id', ids)
                if (upErr) {
                    console.error('Reset include_header on untouched pro rows failed:', upErr)
                } else {
                    rows = rows.map(r => ids.includes(r.id) ? { ...r, include_header: false } : r)
                }
            }

            setTemplates(rows)
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
        const trimmedLabel = editLabel.trim()
        if (!trimmedLabel) {
            toast.error('Il titolo non può essere vuoto')
            return
        }
        setSaving(true)
        try {
            // Try the Netlify function first (service-role, bypasses RLS).
            // Fall back to direct supabase.update() if the function errors.
            const updatedAt = new Date().toISOString()
            const payload = { message_body: editBody, label: trimmedLabel }
            let saved = false
            try {
                const response = await authFetch('/.netlify/functions/update-system-message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, ...payload })
                })
                if (response.ok) {
                    saved = true
                } else {
                    const result = await response.json().catch(() => ({}))
                    console.warn('[Pro] update-system-message fn failed, falling back:', result)
                }
            } catch (fnErr) {
                console.warn('[Pro] update-system-message fn threw, falling back:', fnErr)
            }

            if (!saved) {
                const { data, error } = await supabase
                    .from('system_messages')
                    .update({ ...payload, updated_at: updatedAt })
                    .eq('id', id)
                    .select()
                    .single()
                if (error) throw error
                if (!data) throw new Error('Nessuna riga aggiornata')
            }

            // Re-fetch to be certain DB state matches UI
            const { data: fresh } = await supabase
                .from('system_messages')
                .select('*')
                .eq('id', id)
                .single()
            if (fresh) {
                setTemplates(prev => prev.map(t => t.id === id ? fresh : t))
            } else {
                setTemplates(prev => prev.map(t => t.id === id ? { ...t, ...payload, updated_at: updatedAt } : t))
            }
            setEditingId(null)
            toast.success('Messaggio salvato')
        } catch (err: unknown) {
            const _errMsg = err instanceof Error ? err.message : String(err)
            console.error('Error saving template:', err)
            toast.error('Errore salvataggio: ' + _errMsg)
        } finally {
            setSaving(false)
        }
    }

    async function handleCreateTemplate() {
        if (!newLabel.trim()) {
            toast.error('Il nome del messaggio è obbligatorio')
            return
        }
        setCreatingNew(true)
        const messageKey = 'pro_custom_' + newLabel
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, '_')
            .substring(0, 40) + '_' + Date.now()

        try {
            const { data, error } = await supabase
                .from('system_messages')
                .insert({
                    message_key: messageKey,
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
            toast.success('Nuovo messaggio Pro creato')
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
        if (!confirm(`Eliminare definitivamente il messaggio "${template.label}"?\n\nQuesta operazione non è reversibile.`)) return

        try {
            let deleted = false
            try {
                const res = await authFetch('/.netlify/functions/delete-system-message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: template.id }),
                })
                const json = await res.json().catch(() => ({}))
                if (res.ok && !json?.error) {
                    deleted = true
                } else {
                    console.warn('[Pro] delete-system-message fn failed, falling back:', json)
                }
            } catch (fnErr) {
                console.warn('[Pro] delete-system-message fn threw, falling back:', fnErr)
            }

            if (!deleted) {
                const { error } = await supabase
                    .from('system_messages')
                    .delete()
                    .eq('id', template.id)
                if (error) throw error
            }

            // Verify the row is really gone before updating UI
            const { data: stillThere } = await supabase
                .from('system_messages')
                .select('id')
                .eq('id', template.id)
                .maybeSingle()
            if (stillThere) throw new Error('Il messaggio non è stato rimosso dal database')

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
            const { data: byName } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, telefono')
                .or(`nome.ilike.%${q}%,cognome.ilike.%${q}%`)
                .limit(20)

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

    // Canonical sort order: follow PRO_MESSAGE_CATEGORIES declaration, then any custom pro_custom_*
    const keyOrder: Record<string, number> = {}
    ALL_PRO_TEMPLATES.forEach((t, i) => { keyOrder[t.key] = i })
    const sortedTemplates = [...templates].sort((a, b) => {
        const ai = keyOrder[a.message_key] ?? 9999
        const bi = keyOrder[b.message_key] ?? 9999
        if (ai !== bi) return ai - bi
        return (a.label || '').localeCompare(b.label || '')
    })

    // Dynamic numbering: 1..N for every non-wrapper template currently in DB, in sorted order.
    // Wrappers (pro_wrapper_header, pro_wrapper_footer) never get a number.
    const templateNumberById: Record<string, number> = {}
    sortedTemplates
        .filter(t => !WRAPPER_KEYS.has(t.message_key))
        .forEach((t, i) => { templateNumberById[t.id] = i + 1 })

    const q = searchQuery.trim().toLowerCase()
    const filteredTemplates = q
        ? sortedTemplates.filter(t =>
            (t.label || '').toLowerCase().includes(q) ||
            (t.description || '').toLowerCase().includes(q) ||
            (t.message_body || '').toLowerCase().includes(q) ||
            (t.message_key || '').toLowerCase().includes(q)
          )
        : sortedTemplates

    return (
        <div className="space-y-8">
            {/* ═══════════ SECTION A: Template Manager (Pro) ═══════════ */}
            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <div>
                        <h3 className="text-lg font-bold text-theme-text-primary">Messaggi di Sistema Pro</h3>
                        <p className="text-theme-text-primary text-sm">Template dei messaggi WhatsApp organizzati per tipologia</p>
                    </div>
                    <div className="flex gap-2">
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
                        <h4 className="font-semibold text-theme-text-primary">Nuovo Template Pro</h4>
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
                                disabled={creatingNew || !newLabel.trim()}
                                className="px-5 py-2 rounded-full text-sm font-semibold bg-dr7-gold text-white hover:bg-[#247a6f] transition-colors disabled:opacity-50"
                            >
                                {creatingNew ? 'Salvataggio...' : 'Crea Messaggio'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Search */}
                <div className="relative">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Cerca messaggio (es. compleanno, noleggio, firma...)"
                        className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 text-sm"
                    />
                    <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary text-lg leading-none"
                            aria-label="Svuota ricerca"
                        >
                            &times;
                        </button>
                    )}
                </div>

                {/* Template list — flat */}
                <div className="space-y-2">
                    {filteredTemplates.length === 0 && (
                        <div className="text-center py-8 text-theme-text-muted border border-theme-border rounded-lg">
                            {q ? `Nessun messaggio trovato per "${searchQuery}"` : 'Nessun messaggio'}
                        </div>
                    )}
                    {filteredTemplates.map((template) => (
                                        <details key={template.id} className={`border rounded-lg overflow-hidden ${template.is_enabled === false ? 'border-red-500/30 opacity-60' : 'border-theme-border'}`}>
                                            <summary className="px-4 py-3 cursor-pointer hover:bg-theme-bg-hover/30">
                                                <div className="flex items-center gap-3">
                                                    <button
                                                        onClick={(e) => { e.preventDefault(); handleToggleEnabled(template) }}
                                                        className={`w-10 h-5 rounded-full relative transition-colors shrink-0 ${template.is_enabled !== false ? 'bg-green-500' : 'bg-gray-600'}`}
                                                    >
                                                        <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${template.is_enabled !== false ? 'left-5' : 'left-0.5'}`} />
                                                    </button>
                                                    {templateNumberById[template.id] && (
                                                        <span className="shrink-0 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-dr7-gold/20 text-dr7-gold text-[11px] font-bold">
                                                            {templateNumberById[template.id]}
                                                        </span>
                                                    )}
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
                                                        <button
                                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteTemplate(template) }}
                                                            title="Elimina definitivamente"
                                                            aria-label="Elimina"
                                                            className="p-1.5 rounded-full bg-red-600/20 text-red-400 hover:bg-red-600/40 hover:text-red-300 transition-colors"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                <polyline points="3 6 5 6 21 6" />
                                                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                                                <path d="M10 11v6" />
                                                                <path d="M14 11v6" />
                                                                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>
                                                <p className="text-xs text-theme-text-primary mt-1 ml-[52px]">{template.description}</p>
                                            </summary>

                                            <div className="p-4 border-t border-theme-border space-y-3">
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

                                                {editingId === template.id ? (
                                                    <div className="space-y-3">
                                                        <div>
                                                            <label className="block text-xs font-medium text-theme-text-primary mb-1">Titolo</label>
                                                            <input
                                                                type="text"
                                                                value={editLabel}
                                                                onChange={e => setEditLabel(e.target.value)}
                                                                placeholder="Titolo del messaggio"
                                                                className="w-full px-4 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 text-sm"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-medium text-theme-text-primary mb-1">Messaggio</label>
                                                            <textarea
                                                                value={editBody}
                                                                onChange={e => setEditBody(e.target.value)}
                                                                rows={6}
                                                                placeholder="Buongiorno {nome},&#10;&#10;..."
                                                                className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 font-mono text-sm"
                                                            />
                                                            <p className="text-xs text-theme-text-muted mt-1">Placeholder: <code className="bg-theme-bg-tertiary px-1.5 py-0.5 rounded">{"{"+"nome}"}</code> = nome del cliente</p>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <pre className="px-4 py-3 rounded-lg bg-theme-bg-primary text-xs text-theme-text-secondary whitespace-pre-wrap max-h-72 overflow-y-auto border border-theme-border">
                                                        {template.message_body}
                                                    </pre>
                                                    {template.include_header === true && (
                                                        <p className="text-[11px] text-amber-400 mt-1">
                                                            Wrapper attivo: header/footer da “Intestazione/Piè di pagina” verranno aggiunti automaticamente.
                                                        </p>
                                                    )}
                                                )}

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
                                                            <button onClick={() => { setEditingId(template.id); setEditBody(template.message_body); setEditLabel(template.label) }}
                                                                className="px-3 py-1.5 rounded-full text-xs font-medium bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover transition-colors">Modifica</button>
                                                            <button onClick={() => handleDeleteTemplate(template)}
                                                                className="px-3 py-1.5 rounded-full text-xs font-medium bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors">Elimina</button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </details>
                                    ))}
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

                    {sendMode === 'template' ? (
                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Seleziona template</label>
                            <select
                                value={selectedTemplateId}
                                onChange={e => setSelectedTemplateId(e.target.value)}
                                className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50"
                            >
                                <option value="">-- Scegli un messaggio --</option>
                                {templates.filter(t => t.message_body).map(t => (
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

                    <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-1">Destinatari</label>

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

                    {getMessageText() && (
                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Anteprima</label>
                            <pre className="px-4 py-3 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-secondary text-sm whitespace-pre-wrap font-sans">
                                {getPreviewText()}
                            </pre>
                        </div>
                    )}

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
