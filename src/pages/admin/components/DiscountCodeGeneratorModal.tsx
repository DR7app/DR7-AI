import { useState } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

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
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateField = (field: string, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }))
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
                qr_url: `https://dr7empire.com/promo/${formData.code.toUpperCase().trim()}`,
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
                        className="px-6 py-2 bg-dr7-gold text-white font-semibold rounded-full hover:bg-[#247a6f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Salvataggio...' : isEditing ? 'Salva Modifiche' : 'Crea Codice'}
                    </button>
                </div>
            </div>
        </div>
    )
}
