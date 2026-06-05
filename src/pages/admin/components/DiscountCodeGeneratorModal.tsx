import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

interface CustomerOption {
    id: string
    nome: string | null
    cognome: string | null
    denominazione: string | null
    email: string | null
    telefono: string | null
}

interface DiscountCodeGeneratorModalProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editingCode?: any | null
    onClose: () => void
    onSave: () => void
}

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const SCOPE_OPTIONS = [
    { value: 'noleggio', label: 'Noleggio' },
    { value: 'lavaggi', label: 'Lavaggi' },
    { value: 'supercar', label: 'Supercar' },
    { value: 'utilitarie', label: 'Utilitarie' },
    { value: 'aziendali', label: 'Aziendali' },
    { value: 'tutti_i_servizi', label: 'Tutti i servizi' },
]

function generateCode(): string {
    let code = 'DR7-'
    for (let i = 0; i < 8; i++) {
        if (i === 4) code += '-'
        code += CHARSET[Math.floor(Math.random() * CHARSET.length)]
    }
    return code
}

export default function DiscountCodeGeneratorModal({ editingCode, onClose, onSave }: DiscountCodeGeneratorModalProps) {
    const isEditing = !!editingCode

    const submitLockRef = useRef(false)
    const [loading, setLoading] = useState(false)
    const [formData, setFormData] = useState({
        code_type: editingCode?.code_type || 'codice_sconto' as 'codice_sconto' | 'gift_card',
        scope: editingCode?.scope || ['tutti_i_servizi'] as string[],
        value_type: editingCode?.value_type || 'fixed' as 'fixed' | 'percentage',
        value_amount: editingCode?.value_amount?.toString() || '',
        has_minimum_spend: editingCode?.minimum_spend != null,
        minimum_spend: editingCode?.minimum_spend?.toString() || '',
        valid_from: editingCode?.valid_from ? new Date(editingCode.valid_from).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        valid_until: editingCode?.valid_until ? new Date(editingCode.valid_until).toISOString().slice(0, 10) : '',
        single_use: editingCode?.single_use ?? true,
        code_mode: 'auto' as 'auto' | 'manual',
        code: editingCode?.code || generateCode(),
        message: editingCode?.message || '',
        usage_conditions: editingCode?.usage_conditions || '',
        customer_email: editingCode?.customer_email || '',
        customer_phone: editingCode?.customer_phone || '',
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateField = (field: string, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }))
    }

    // Picker "cliente esistente": carica i clienti con email o telefono e
    // permette di selezionarli per pre-compilare i campi customer_email /
    // customer_phone. La logica di restrizione lato sito (validate /
    // redeem) usa esattamente quei due campi, quindi qui ci limitiamo a
    // riempirli — niente legame esplicito al customer_id (serve un cliente
    // con account auth, non un anagrafica admin).
    const [customers, setCustomers] = useState<CustomerOption[]>([])
    const [customerSearch, setCustomerSearch] = useState('')
    const [showCustomerList, setShowCustomerList] = useState(false)
    const [selectedCustomerLabel, setSelectedCustomerLabel] = useState<string>('')
    const customerBoxRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const { data } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, denominazione, email, telefono')
                .or('email.not.is.null,telefono.not.is.null')
                .order('updated_at', { ascending: false })
                .limit(1000)
            if (!cancelled) setCustomers((data as CustomerOption[]) || [])
        })()
        return () => { cancelled = true }
    }, [])

    // Hide the suggestion list when clicking outside it.
    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (!customerBoxRef.current) return
            if (!customerBoxRef.current.contains(e.target as Node)) setShowCustomerList(false)
        }
        document.addEventListener('mousedown', onDocClick)
        return () => document.removeEventListener('mousedown', onDocClick)
    }, [])

    const customerName = (c: CustomerOption) =>
        c.denominazione || `${c.nome || ''} ${c.cognome || ''}`.trim() || c.email || c.telefono || 'Cliente'

    const filteredCustomers = useMemo(() => {
        const q = customerSearch.trim().toLowerCase()
        if (!q) return customers.slice(0, 20)
        return customers
            .filter(c => {
                const name = customerName(c).toLowerCase()
                const email = (c.email || '').toLowerCase()
                const phone = (c.telefono || '').toLowerCase()
                return name.includes(q) || email.includes(q) || phone.includes(q)
            })
            .slice(0, 20)
    }, [customers, customerSearch])

    const pickCustomer = (c: CustomerOption) => {
        setFormData(prev => ({
            ...prev,
            customer_email: c.email || '',
            customer_phone: c.telefono || '',
        }))
        setSelectedCustomerLabel(`${customerName(c)}${c.email ? ` · ${c.email}` : ''}${c.telefono ? ` · ${c.telefono}` : ''}`)
        setCustomerSearch('')
        setShowCustomerList(false)
    }

    const clearCustomer = () => {
        setFormData(prev => ({ ...prev, customer_email: '', customer_phone: '' }))
        setSelectedCustomerLabel('')
        setCustomerSearch('')
    }

    const handleCodeTypeChange = (type: 'codice_sconto' | 'gift_card') => {
        updateField('code_type', type)
        if (type === 'gift_card') {
            updateField('value_type', 'fixed')
        }
    }

    const handleScopeToggle = (scopeValue: string) => {
        if (scopeValue === 'tutti_i_servizi') {
            updateField('scope', ['tutti_i_servizi'])
            return
        }
        let newScope = formData.scope.filter((s: string) => s !== 'tutti_i_servizi')
        if (newScope.includes(scopeValue)) {
            newScope = newScope.filter((s: string) => s !== scopeValue)
        } else {
            newScope = [...newScope, scopeValue]
        }
        if (newScope.length === 0) {
            newScope = ['tutti_i_servizi']
        }
        updateField('scope', newScope)
    }

    const regenerateCode = () => {
        updateField('code', generateCode())
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (submitLockRef.current) return

        // Validation
        if (!formData.value_amount || Number(formData.value_amount) <= 0) {
            toast.error('Inserisci un valore valido')
            return
        }
        if (!formData.valid_until) {
            toast.error('Inserisci una data di fine validità')
            return
        }
        if (!formData.code.trim()) {
            toast.error('Il codice non può essere vuoto')
            return
        }
        if (formData.value_type === 'percentage' && Number(formData.value_amount) > 100) {
            toast.error('La percentuale non può superare il 100%')
            return
        }
        const trimmedEmail = formData.customer_email.trim()
        if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
            toast.error('Inserisci un indirizzo email valido')
            return
        }
        const trimmedPhone = formData.customer_phone.trim()
        if (trimmedPhone && !/^[+\d][\d\s().-]{5,}$/.test(trimmedPhone)) {
            toast.error('Inserisci un numero di telefono valido')
            return
        }

        submitLockRef.current = true
        setLoading(true)
        try {
            // Check uniqueness (skip if editing and code unchanged)
            if (!isEditing || formData.code !== editingCode?.code) {
                const { data: existing } = await supabase
                    .from('discount_codes')
                    .select('id')
                    .eq('code', formData.code.toUpperCase().trim())
                    .maybeSingle()

                if (existing) {
                    toast.error('Questo codice esiste già. Genera un nuovo codice o inseriscine uno diverso.')
                    setLoading(false)
                    return
                }
            }

            const dataToSave = {
                code: formData.code.toUpperCase().trim(),
                code_type: formData.code_type,
                scope: formData.scope,
                value_type: formData.value_type,
                value_amount: Number(formData.value_amount),
                minimum_spend: formData.has_minimum_spend && formData.minimum_spend ? Number(formData.minimum_spend) : null,
                valid_from: new Date(formData.valid_from).toISOString(),
                valid_until: new Date(formData.valid_until + 'T23:59:59').toISOString(),
                single_use: formData.single_use,
                message: formData.message || null,
                usage_conditions: formData.usage_conditions || null,
                customer_email: formData.customer_email.trim().toLowerCase() || null,
                customer_phone: formData.customer_phone.trim() || null,
                qr_url: `https://dr7.app/promo/${formData.code.toUpperCase().trim()}`,
                status: 'active',
                updated_at: new Date().toISOString(),
            }

            if (isEditing) {
                const { error } = await supabase
                    .from('discount_codes')
                    .update(dataToSave)
                    .eq('id', editingCode.id)
                if (error) throw error
                toast.success('Codice aggiornato con successo')
            } else {
                const { error } = await supabase
                    .from('discount_codes')
                    .insert([dataToSave])
                if (error) throw error
                toast.success('Codice sconto creato con successo')
            }

            onSave()
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error saving discount code:', error)
            toast.error(`Errore nel salvataggio: ${_errMsg}`)
        } finally {
            submitLockRef.current = false
            setLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-theme-overlay flex items-center justify-center z-50 p-4">
            <div className="bg-theme-bg-secondary rounded-3xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="p-6 border-b border-theme-border flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-theme-text-primary">
                        {isEditing ? 'Modifica Codice' : 'Genera Codice Sconto'}
                    </h2>
                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="text-theme-text-muted hover:text-theme-text-primary text-3xl leading-none disabled:opacity-50"
                    >
                        ×
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {/* 1. Tipo di codice */}
                    <div>
                        <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                            Tipo di codice
                        </label>
                        <div className="flex gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="code_type"
                                    checked={formData.code_type === 'codice_sconto'}
                                    onChange={() => handleCodeTypeChange('codice_sconto')}
                                    className="text-dr7-gold focus:ring-dr7-gold"
                                />
                                <span className="text-theme-text-primary">Codice sconto</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="code_type"
                                    checked={formData.code_type === 'gift_card'}
                                    onChange={() => handleCodeTypeChange('gift_card')}
                                    className="text-dr7-gold focus:ring-dr7-gold"
                                />
                                <span className="text-theme-text-primary">Gift card</span>
                            </label>
                        </div>
                    </div>

                    {/* 2. Ambito di validità */}
                    <div>
                        <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                            Ambito di validità
                        </label>
                        <div className="flex flex-wrap gap-3">
                            {SCOPE_OPTIONS.map((opt) => (
                                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={formData.scope.includes(opt.value)}
                                        onChange={() => handleScopeToggle(opt.value)}
                                        className="rounded border-theme-border-light bg-gray-700 text-dr7-gold focus:ring-dr7-gold"
                                    />
                                    <span className="text-theme-text-secondary text-sm">{opt.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* 3. Valore */}
                    <div>
                        <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                            Valore
                        </label>
                        <div className="flex gap-4 mb-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="value_type"
                                    checked={formData.value_type === 'fixed'}
                                    onChange={() => updateField('value_type', 'fixed')}
                                    className="text-dr7-gold focus:ring-dr7-gold"
                                />
                                <span className="text-theme-text-primary">Fisso (€)</span>
                            </label>
                            <label className={`flex items-center gap-2 ${formData.code_type === 'gift_card' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                                <input
                                    type="radio"
                                    name="value_type"
                                    checked={formData.value_type === 'percentage'}
                                    onChange={() => updateField('value_type', 'percentage')}
                                    disabled={formData.code_type === 'gift_card'}
                                    className="text-dr7-gold focus:ring-dr7-gold"
                                />
                                <span className="text-theme-text-primary">Percentuale (%)</span>
                            </label>
                        </div>
                        <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            max={formData.value_type === 'percentage' ? 100 : undefined}
                            value={formData.value_amount}
                            onChange={(e) => updateField('value_amount', e.target.value)}
                            placeholder={formData.value_type === 'fixed' ? '0.00 €' : '0 %'}
                            required
                            className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                        />
                        {formData.code_type === 'gift_card' && (
                            <p className="text-xs text-theme-text-muted mt-1">Le gift card hanno sempre un valore fisso in euro</p>
                        )}
                    </div>

                    {/* 4. Vincoli di spesa */}
                    <div>
                        <label className="flex items-center gap-2 cursor-pointer mb-2">
                            <input
                                type="checkbox"
                                checked={formData.has_minimum_spend}
                                onChange={(e) => updateField('has_minimum_spend', e.target.checked)}
                                className="rounded border-theme-border-light bg-gray-700 text-dr7-gold focus:ring-dr7-gold"
                            />
                            <span className="text-sm font-semibold text-theme-text-primary">Spesa minima</span>
                        </label>
                        {formData.has_minimum_spend && (
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={formData.minimum_spend}
                                onChange={(e) => updateField('minimum_spend', e.target.value)}
                                placeholder="Importo minimo in €"
                                className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                            />
                        )}
                    </div>

                    {/* 5. Durata */}
                    <div>
                        <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                            Durata validità
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-theme-text-muted mb-1">Inizio</label>
                                <input
                                    type="date"
                                    value={formData.valid_from}
                                    onChange={(e) => updateField('valid_from', e.target.value)}
                                    required
                                    className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-theme-text-muted mb-1">Fine</label>
                                <input
                                    type="date"
                                    value={formData.valid_until}
                                    onChange={(e) => updateField('valid_until', e.target.value)}
                                    required
                                    className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                                />
                            </div>
                        </div>
                    </div>

                    {/* 6. Limiti utilizzo */}
                    <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.single_use}
                                onChange={(e) => updateField('single_use', e.target.checked)}
                                className="rounded border-theme-border-light bg-gray-700 text-dr7-gold focus:ring-dr7-gold"
                            />
                            <span className="text-sm font-semibold text-theme-text-primary">Utilizzabile una sola volta</span>
                        </label>
                    </div>

                    {/* 6b. Limita a cliente specifico */}
                    <div>
                        <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                            Limita a cliente specifico (opzionale)
                        </label>
                        <p className="text-xs text-theme-text-muted mb-2">
                            Seleziona un cliente esistente oppure compila Email/Telefono manualmente. Lascia vuoto per rendere il codice pubblico.
                        </p>

                        {/* Picker cliente esistente */}
                        <div className="mb-3 relative" ref={customerBoxRef}>
                            <label className="block text-xs text-theme-text-muted mb-1">Cliente esistente</label>
                            {selectedCustomerLabel ? (
                                <div className="flex items-center justify-between gap-2 px-4 py-3 bg-theme-bg-tertiary border border-dr7-gold/40 rounded-lg">
                                    <div className="text-sm text-theme-text-primary truncate">
                                        <span className="text-dr7-gold mr-2">●</span>{selectedCustomerLabel}
                                    </div>
                                    <button type="button" onClick={clearCustomer} className="text-xs text-theme-text-muted hover:text-red-400 underline shrink-0">
                                        Rimuovi
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <input
                                        type="text"
                                        value={customerSearch}
                                        onChange={(e) => { setCustomerSearch(e.target.value); setShowCustomerList(true) }}
                                        onFocus={() => setShowCustomerList(true)}
                                        placeholder="Cerca per nome, email o telefono..."
                                        className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                                    />
                                    {showCustomerList && filteredCustomers.length > 0 && (
                                        <div className="absolute z-10 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-theme-bg-secondary border border-theme-border rounded-lg shadow-2xl">
                                            {filteredCustomers.map(c => (
                                                <button
                                                    type="button"
                                                    key={c.id}
                                                    onClick={() => pickCustomer(c)}
                                                    className="w-full text-left px-3 py-2 hover:bg-theme-bg-hover border-b border-theme-border/50 last:border-b-0"
                                                >
                                                    <div className="text-sm text-theme-text-primary font-medium truncate">{customerName(c)}</div>
                                                    <div className="text-xs text-theme-text-muted truncate">
                                                        {c.email || '—'}{c.telefono ? ` · ${c.telefono}` : ''}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {showCustomerList && customerSearch.trim() && filteredCustomers.length === 0 && (
                                        <div className="absolute z-10 left-0 right-0 mt-1 px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-xs text-theme-text-muted">
                                            Nessun cliente trovato
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-theme-text-muted mb-1">Email cliente</label>
                                <input
                                    type="email"
                                    value={formData.customer_email}
                                    onChange={(e) => updateField('customer_email', e.target.value)}
                                    placeholder="es. massimorunchina69@gmail.com"
                                    className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-theme-text-muted mb-1">Telefono cliente</label>
                                <input
                                    type="tel"
                                    value={formData.customer_phone}
                                    onChange={(e) => updateField('customer_phone', e.target.value)}
                                    placeholder="es. +39 345 790 5205"
                                    className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                                />
                            </div>
                        </div>
                    </div>

                    {/* 7. Codice */}
                    <div>
                        <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                            Codice
                        </label>
                        <div className="flex gap-4 mb-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="code_mode"
                                    checked={formData.code_mode === 'auto'}
                                    onChange={() => {
                                        updateField('code_mode', 'auto')
                                        regenerateCode()
                                    }}
                                    className="text-dr7-gold focus:ring-dr7-gold"
                                />
                                <span className="text-theme-text-primary">Generazione automatica</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="code_mode"
                                    checked={formData.code_mode === 'manual'}
                                    onChange={() => updateField('code_mode', 'manual')}
                                    className="text-dr7-gold focus:ring-dr7-gold"
                                />
                                <span className="text-theme-text-primary">Manuale</span>
                            </label>
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={formData.code}
                                onChange={(e) => updateField('code', e.target.value.toUpperCase())}
                                readOnly={formData.code_mode === 'auto'}
                                maxLength={30}
                                className={`flex-1 px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg font-mono text-lg tracking-wider text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors ${formData.code_mode === 'auto' ? 'opacity-75' : ''}`}
                            />
                            {formData.code_mode === 'auto' && (
                                <button
                                    type="button"
                                    onClick={regenerateCode}
                                    className="px-4 py-3 bg-gray-700 text-theme-text-primary rounded-lg hover:bg-gray-600 transition-colors text-sm"
                                >
                                    Rigenera
                                </button>
                            )}
                        </div>
                        <div className="mt-2 px-4 py-2 bg-theme-bg-tertiary rounded-lg border border-theme-border">
                            <span className="text-xs text-theme-text-muted">Anteprima: </span>
                            <span className="font-mono text-dr7-gold font-bold tracking-wider">{formData.code || '---'}</span>
                        </div>
                    </div>

                    {/* 8. Messaggio */}
                    <div>
                        <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                            Messaggio promozionale
                        </label>
                        <textarea
                            value={formData.message}
                            onChange={(e) => updateField('message', e.target.value)}
                            rows={3}
                            placeholder="Messaggio opzionale da associare al codice..."
                            className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors resize-none"
                        />
                    </div>

                    {/* 10. Condizioni di utilizzo */}
                    <div>
                        <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                            Condizioni di utilizzo
                        </label>
                        <textarea
                            value={formData.usage_conditions}
                            onChange={(e) => updateField('usage_conditions', e.target.value)}
                            rows={2}
                            placeholder="Condizioni e restrizioni opzionali..."
                            className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors resize-none"
                        />
                    </div>
                </form>

                {/* Footer */}
                <div className="p-6 border-t border-theme-border flex gap-3 justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={loading}
                        className="px-6 py-2 bg-gray-600 text-white rounded-full hover:bg-gray-700 transition-colors disabled:opacity-50"
                    >
                        Annulla
                    </button>
                    <button
                        type="submit"
                        onClick={handleSubmit}
                        disabled={loading}
                        className="px-6 py-2 bg-dr7-gold text-white font-semibold rounded-full hover:bg-[#0A8FA3] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Salvataggio...' : isEditing ? 'Salva Modifiche' : 'Crea Codice'}
                    </button>
                </div>
            </div>
        </div>
    )
}
