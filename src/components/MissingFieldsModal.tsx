import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'

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
    citta: 'Città'
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

        setIsSaving(true)
        try {
            console.log('[MissingFieldsModal] Saving missing fields:', formData)

            // Prepare update data
            const updateData: any = { ...formData }

            // Handle special field mappings
            if (formData.patente || formData.numero_patente) {
                updateData.patente = formData.patente || formData.numero_patente
                updateData.numero_patente = formData.patente || formData.numero_patente
            }

            // Update customer in database
            const { data, error } = await supabase
                .from('customers_extended')
                .update(updateData)
                .eq('id', customerId)
                .select()
                .single()

            if (error) {
                console.error('[MissingFieldsModal] Error updating customer:', error)
                throw error
            }

            console.log('[MissingFieldsModal] Customer updated successfully:', data)

            // 2. ALSO update the basic 'customers' table to ensure the main list view updates
            // We merge existing data with updates to ensure we have full name components
            const mergedData = { ...customerData, ...updateData }

            const basicData: any = {
                updated_at: new Date().toISOString()
            }

            // Reconstruct full name if relevant fields changed or exist
            if (mergedData.tipo_cliente === 'persona_fisica') {
                const nome = mergedData.nome || ''
                const cognome = mergedData.cognome || ''
                if (nome || cognome) {
                    basicData.full_name = `${nome} ${cognome}`.trim()
                }
            } else {
                const companyName = mergedData.ragione_sociale || mergedData.denominazione
                if (companyName) {
                    basicData.full_name = companyName
                }
            }

            // Sync other common fields if they are in the update
            if (updateData.email) basicData.email = updateData.email
            if (updateData.telefono) basicData.phone = updateData.telefono
            if (updateData.patente || updateData.numero_patente) {
                basicData.driver_license_number = updateData.patente || updateData.numero_patente
            }

            if (Object.keys(basicData).length > 1) { // more than just updated_at
                console.log('[MissingFieldsModal] Syncing basic customers table:', basicData)
                const { error: basicError } = await supabase
                    .from('customers')
                    .update(basicData)
                    .eq('id', customerId)

                if (basicError) {
                    console.warn('[MissingFieldsModal] Warning: Could not sync basic customers table:', basicError)
                } else {
                    console.log('[MissingFieldsModal] Basic customers table synced')
                }
            }

            alert('Dati aggiornati con successo!')

            // Call onSave callback with updated data
            onSave(data)
            onClose()
        } catch (error: any) {
            console.error('[MissingFieldsModal] Save error:', error)
            alert(`Errore durante il salvataggio: ${error.message}`)
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
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        {label} *
                    </label>
                    <select
                        value={value}
                        onChange={(e) => handleChange(field, e.target.value)}
                        className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
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

        if (field === 'data_nascita' || field.includes('data_')) {
            return (
                <div key={field} className="mb-4">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        {label} *
                    </label>
                    <input
                        type="date"
                        value={value}
                        onChange={(e) => handleChange(field, e.target.value)}
                        className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
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
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        {label} *
                    </label>
                    <input
                        type="email"
                        value={value}
                        onChange={(e) => handleChange(field, e.target.value)}
                        className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
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
                <label className="block text-sm font-medium text-gray-300 mb-2">
                    {label} *
                </label>
                <input
                    type="text"
                    value={value}
                    onChange={(e) => handleChange(field, e.target.value)}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
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
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
                {/* Header */}
                <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-6 flex justify-between items-center z-10">
                    <div>
                        <h2 className="text-2xl font-bold text-white">Completa Dati Cliente</h2>
                        <p className="text-sm text-gray-400 mt-1">
                            Compila i campi mancanti per continuare
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white text-3xl leading-none"
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
                <div className="sticky bottom-0 bg-gray-900 border-t border-gray-700 p-6 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={isSaving}
                        className="px-6 py-2.5 border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-800 transition-colors font-medium disabled:opacity-50"
                    >
                        Annulla
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSaving ? 'Salvataggio...' : 'Salva e Continua'}
                    </button>
                </div>
            </div>
        </div>
    )
}
