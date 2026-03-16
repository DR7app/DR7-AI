import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'

interface MissingFieldsModalProps {
    isOpen: boolean
    onClose: () => void
    customerId: string
    customerData: any
    missingFields: string[]
    onSave: (updatedData: any) => void
}

// Field labels in Italian
const FIELD_LABELS: Record<string, string> = {
    nome: 'Nome',
    cognome: 'Cognome',
    codice_fiscale: 'Codice Fiscale',
    data_nascita: 'Data di Nascita',
    luogo_nascita: 'Luogo di Nascita',
    indirizzo: 'Indirizzo',
    citta_residenza: 'Città di Residenza',
    provincia_residenza: 'Provincia',
    codice_postale: 'CAP',
    patente: 'Numero Patente',
    numero_patente: 'Numero Patente',
    email: 'Email',
    telefono: 'Telefono',
    sesso: 'Sesso',
    denominazione: 'Ragione Sociale',
    partita_iva: 'Partita IVA',
    sede_legale: 'Sede Legale',
    codice_univoco: 'Codice Univoco',
    cf_pa: 'Codice Fiscale',
    ente_ufficio: 'Ente/Ufficio',
    citta: 'Città',
    numero_documento: 'Numero Documento Identità',
    tipo_documento: 'Tipo Documento'
}

export default function MissingFieldsModal({
    isOpen,
    onClose,
    customerId,
    customerData,
    missingFields,
    onSave
}: MissingFieldsModalProps) {
    const [formData, setFormData] = useState<Record<string, any>>({})
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [isSaving, setIsSaving] = useState(false)

    console.log('[MissingFieldsModal] 🟢 RENDERED', { isOpen, customerId, missingFieldsCount: missingFields?.length })


    // Initialize form data with existing customer data
    useEffect(() => {
        if (isOpen && customerData) {
            const initialData: Record<string, any> = {}
            missingFields.forEach(field => {
                initialData[field] = customerData[field] || ''
            })
            setFormData(initialData)
        }
    }, [isOpen, customerData, missingFields])

    const handleChange = (field: string, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }))
        // Clear error when user starts typing
        if (errors[field]) {
            setErrors(prev => {
                const newErrors = { ...prev }
                delete newErrors[field]
                return newErrors
            })
        }
    }

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {}

        missingFields.forEach(field => {
            if (!formData[field] || formData[field].toString().trim() === '') {
                newErrors[field] = `${FIELD_LABELS[field] || field} è obbligatorio`
            }
        })

        setErrors(newErrors)
        return Object.keys(newErrors).length === 0
    }

    const handleSave = async () => {
        if (!validateForm()) {
            return
        }

        if (!customerId) {
            console.error('[MissingFieldsModal] Critical Error: No customer ID provided!')
            toast.error('Errore interno: ID cliente mancante. Riprova o contatta il supporto.')
            return
        }

        setIsSaving(true)
        try {
            console.log('[MissingFieldsModal] Saving missing fields:', formData)

            // Build the payload: merge existing customer data with new form values
            const savePayload: any = { ...customerData, ...formData }

            // Handle special field mappings
            if (formData.patente || formData.numero_patente) {
                savePayload.patente = formData.patente || formData.numero_patente
                savePayload.numero_patente = formData.patente || formData.numero_patente
            }

            // Ensure tipo_cliente is set
            if (!savePayload.tipo_cliente) {
                savePayload.tipo_cliente = 'persona_fisica'
            }

            // Remove non-column fields that may be in customerData
            delete savePayload.bookings
            delete savePayload.booking_details
            delete savePayload.full_name

            console.log('[MissingFieldsModal] Saving via save-customer:', customerId, savePayload)

            // Use save-customer Netlify function (bypasses RLS, handles update-or-insert)
            const response = await fetch('/.netlify/functions/save-customer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customerData: savePayload,
                    customerId: customerId
                })
            })

            const result = await response.json()
            if (!response.ok) {
                console.error('[MissingFieldsModal] Save error:', result)
                throw new Error(result.error || 'Errore nel salvataggio')
            }

            const data = result.customer
            console.log('[MissingFieldsModal] Customer saved:', data)

            toast.success('Dati aggiornati con successo!')

            // Call onSave callback with updated data
            onSave(data)
            onClose()
        } catch (error: any) {
            console.error('[MissingFieldsModal] Save error:', error)
            toast.error(`Errore durante il salvataggio: ${error.message}`)
        } finally {
            setIsSaving(false)
        }
    }

    const renderField = (field: string) => {
        const label = FIELD_LABELS[field] || field
        const value = formData[field] || ''

        // Special handling for different field types
        if (field === 'sesso') {
            return (
                <div key={field} className="mb-4">
                    <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                        {label} *
                    </label>
                    <select
                        value={value}
                        onChange={(e) => handleChange(field, e.target.value)}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded-full px-4 py-2.5 text-theme-text-primary focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    >
                        <option value="">Seleziona...</option>
                        <option value="M">Maschio</option>
                        <option value="F">Femmina</option>
                    </select>
                    {errors[field] && (
                        <p className="text-red-500 text-xs mt-1">{errors[field]}</p>
                    )}
                </div>
            )
        }

        if (field === 'tipo_documento') {
            return (
                <div key={field} className="mb-4">
                    <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                        {label} *
                    </label>
                    <select
                        value={value}
                        onChange={(e) => handleChange(field, e.target.value)}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded-full px-4 py-2.5 text-theme-text-primary focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    >
                        <option value="">Seleziona...</option>
                        <option value="carta_identita">Carta d'Identità</option>
                        <option value="passaporto">Passaporto</option>
                        <option value="patente">Patente di Guida</option>
                    </select>
                    {errors[field] && (
                        <p className="text-red-500 text-xs mt-1">{errors[field]}</p>
                    )}
                </div>
            )
        }

        if (field === 'data_nascita' || field.includes('data_')) {
            return (
                <div key={field} className="mb-4">
                    <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                        {label} *
                    </label>
                    <input
                        type="date"
                        value={value}
                        onChange={(e) => handleChange(field, e.target.value)}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded-full px-4 py-2.5 text-theme-text-primary focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                    {errors[field] && (
                        <p className="text-red-500 text-xs mt-1">{errors[field]}</p>
                    )}
                </div>
            )
        }

        if (field === 'email') {
            return (
                <div key={field} className="mb-4">
                    <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                        {label} *
                    </label>
                    <input
                        type="email"
                        value={value}
                        onChange={(e) => handleChange(field, e.target.value)}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded-full px-4 py-2.5 text-theme-text-primary focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                        placeholder="esempio@email.com"
                    />
                    {errors[field] && (
                        <p className="text-red-500 text-xs mt-1">{errors[field]}</p>
                    )}
                </div>
            )
        }

        // Default text input
        return (
            <div key={field} className="mb-4">
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                    {label} *
                </label>
                <input
                    type="text"
                    value={value}
                    onChange={(e) => handleChange(field, e.target.value)}
                    className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded-full px-4 py-2.5 text-theme-text-primary focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    placeholder={`Inserisci ${label.toLowerCase()}`}
                />
                {errors[field] && (
                    <p className="text-red-500 text-xs mt-1">{errors[field]}</p>
                )}
            </div>
        )
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-theme-overlay backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-theme-bg-secondary border border-theme-border rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
                {/* Header */}
                <div className="sticky top-0 bg-theme-bg-secondary border-b border-theme-border p-6 flex justify-between items-center z-10">
                    <div>
                        <h2 className="text-2xl font-bold text-theme-text-primary">Completa Dati Cliente</h2>
                        <p className="text-sm text-theme-text-muted mt-1">
                            Compila i campi mancanti per continuare
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-theme-text-muted hover:text-theme-text-primary text-3xl leading-none"
                    >
                        &times;
                    </button>
                </div>

                {/* Body */}
                <div className="p-6">
                    <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4 mb-6">
                        <p className="text-blue-300 text-sm">
                            ℹ️ Sono richiesti {missingFields.length} campi per completare il profilo del cliente
                        </p>
                    </div>

                    <div className="space-y-2">
                        {missingFields.map(field => renderField(field))}
                    </div>
                </div>

                {/* Footer */}
                <div className="sticky bottom-0 bg-theme-bg-secondary border-t border-theme-border p-6 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={isSaving}
                        className="px-6 py-2.5 border border-theme-border-light text-theme-text-secondary rounded-full hover:bg-theme-bg-tertiary transition-colors font-medium disabled:opacity-50"
                    >
                        Annulla
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-6 py-2.5 bg-blue-600 text-theme-text-primary rounded-full hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSaving ? 'Salvataggio...' : 'Salva e Continua'}
                    </button>
                </div>
            </div>
        </div>
    )
}
