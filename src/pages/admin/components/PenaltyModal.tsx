import { useState } from 'react'

interface PenaltyModalProps {
    isOpen: boolean
    booking: {
        id: string
        customer_name: string
        customer_id?: string
        user_id?: string
        vehicle_name?: string
        booking_details?: any
    }
    onClose: () => void
    onSuccess: () => void
    onEditCustomer?: (customerId: string) => void
}

// Supercar Penalties
const SUPERCAR_PENALTIES = [
    { id: 'fermo_incidente', label: 'Fermo veicolo per incidente o danni', amount: 350, description: '€350/giorno di inutilizzo del veicolo' },
    { id: 'fermo_alto_valore', label: 'Fermo veicolo (auto valore > €200.000)', amount: 700, description: '€700/giorno per vetture di valore superiore a €200.000' },
    { id: 'fumo', label: 'Fumo nell\'auto (odore/cenere)', amount: 50, description: '€50 senza danni, solo odore o residui di cenere' },
    { id: 'foro_sigaretta', label: 'Foro da sigaretta (per foro)', amount: 50, description: '€50 per ogni foro nella tappezzeria causato da sigaretta' },
    { id: 'guidatore_non_indicato', label: 'Guidatore non citato nel contratto', amount: 200, description: 'Possono guidare SOLO le persone citate nel contratto' },
    { id: 'carburante_8', label: 'Carburante mancante (8 tacche)', amount: 25, description: '€25 se il quadro ha 8 tacche' },
    { id: 'carburante_4', label: 'Carburante mancante (4 tacche)', amount: 50, description: '€50 se il quadro ha 4 tacche' },
    { id: 'gonfia_ripara', label: 'Utilizzo bomboletta "gonfia e ripara"', amount: 100, description: '€100 per pneumatico - Salvo maggior danno' },
    { id: 'sporco', label: 'Veicolo sporco (interni/rifiuti)', amount: 30, description: 'Sporco interni, tasche portiere, portaoggetti, poggiagomito, sedili, bagagliaio' },
    { id: 'igienizzazione', label: 'Igienizzazione straordinaria', amount: 100, description: 'In aggiunta alla penale per sporco' },
    { id: 'controlli_elettronici', label: 'Disattivazione controlli elettronici', amount: 100, description: 'ESP, controlli di stabilità o sicurezza disattivati' },
    { id: 'multe', label: 'Multe e sanzioni', amount: 0, description: '100% a carico del cliente - Nessuna esclusione' },
    { id: 'assenza_intestatario', label: 'Assenza intestatario a consegna/ritiro', amount: 150, description: 'Intestatario deve essere presente per consegna e ritiro a domicilio' },
    { id: 'ritardo_checkout_base', label: 'Ritardo al check-out (dopo 30 min)', amount: 50, description: '€50 minimo dopo i primi 30 minuti' },
    { id: 'ritardo_checkout_minuto', label: 'Ritardo al check-out (per minuto)', amount: 0.5, description: '+€0.50 per ogni minuto di ritardo oltre i 30 min' },
    { id: 'pista', label: 'Utilizzo in pista o competizioni', amount: 5000, description: '€5.000 + risarcimento danni totali - Kasko non attiva' },
    { id: 'cani', label: 'Presenza di cani o pelo di cane', amount: 100, description: 'Non tollerato' },
    { id: 'subnoleggio', label: 'Subnoleggio non autorizzato', amount: 1000, description: 'Violazione grave del contratto' },
    { id: 'neopatentati', label: 'Guida neopatentati/non abilitati (art. 117 CdS)', amount: 0, description: 'Responsabilità TOTALE: sanzioni, fermo amministrativo, danni' },
    { id: 'patente_mancante', label: 'Mancata esibizione patente fisica', amount: 0, description: 'Perdita prenotazione e importo versato - Patente fisica obbligatoria al ritiro' },
    { id: 'ritardo_riconsegna', label: 'Ritardo riconsegna (oltre 22h30)', amount: 0, description: 'Penale max = tariffa giornaliera. Oltre 22h30 = giornata aggiuntiva + risarcimento danni a terzi' },
]

// Urban/Utilitarie/Furgone/NCC Penalties
const URBAN_UTILITAIRE_PENALTIES = [
    { id: 'fermo_utilitarie', label: 'Fermo veicolo (Utilitarie)', amount: 30, description: '€30/giorno di inutilizzo' },
    { id: 'fermo_furgoni', label: 'Fermo veicolo (Furgoni/NCC)', amount: 100, description: '€100/giorno di inutilizzo' },
    { id: 'fumo', label: 'Fumo nell\'auto (odore/cenere)', amount: 50, description: '€50 senza danni, solo odore o residui di cenere' },
    { id: 'foro_sigaretta', label: 'Foro da sigaretta (per foro)', amount: 50, description: '€50 per ogni foro nella tappezzeria causato da sigaretta' },
    { id: 'guidatore_non_indicato', label: 'Guidatore non citato nel contratto', amount: 200, description: 'Possono guidare SOLO le persone citate nel contratto' },
    { id: 'carburante_8', label: 'Carburante mancante (8 tacche)', amount: 15, description: '€15 se il quadro ha 8 tacche' },
    { id: 'carburante_4', label: 'Carburante mancante (4 tacche)', amount: 30, description: '€30 se il quadro ha 4 tacche' },
    { id: 'gonfia_ripara', label: 'Utilizzo bomboletta "gonfia e ripara"', amount: 100, description: '€100 per pneumatico - Salvo maggior danno' },
    { id: 'sporco', label: 'Veicolo sporco (interni/rifiuti)', amount: 30, description: 'Sporco interni, tasche portiere, portaoggetti, poggiagomito, sedili, bagagliaio' },
    { id: 'igienizzazione', label: 'Igienizzazione straordinaria', amount: 100, description: 'In aggiunta alla penale per sporco' },
    { id: 'multe', label: 'Multe e sanzioni', amount: 0, description: '100% a carico del cliente - Nessuna esclusione' },
    { id: 'assenza_intestatario', label: 'Assenza intestatario a consegna/ritiro', amount: 150, description: 'Intestatario deve essere presente per consegna e ritiro a domicilio' },
    { id: 'ritardo_checkout_base', label: 'Ritardo al check-out (dopo 30 min)', amount: 20, description: '€20 minimo dopo i primi 30 minuti' },
    { id: 'ritardo_checkout_minuto', label: 'Ritardo al check-out (per minuto)', amount: 0.5, description: '+€0.50 per ogni minuto di ritardo oltre i 30 min' },
    { id: 'neopatentati', label: 'Guida neopatentati/non abilitati (art. 117 CdS)', amount: 0, description: 'Responsabilità TOTALE: sanzioni, fermo amministrativo, danni' },
    { id: 'cani', label: 'Presenza di cani o pelo di cane', amount: 100, description: 'Non tollerato' },
    { id: 'subnoleggio', label: 'Subnoleggio non autorizzato', amount: 1000, description: 'Violazione grave del contratto' },
    { id: 'ritardo_riconsegna', label: 'Ritardo riconsegna (oltre 22h30)', amount: 0, description: 'Penale max = tariffa giornaliera. Oltre 22h30 = giornata aggiuntiva + risarcimento danni a terzi' },
]

export default function PenaltyModal({ isOpen, booking, onClose, onSuccess, onEditCustomer }: PenaltyModalProps) {
    const [selectedPenalty, setSelectedPenalty] = useState('')
    const [amount, setAmount] = useState('')
    const [motivo, setMotivo] = useState('')
    const [note, setNote] = useState('')
    const [isGenerating, setIsGenerating] = useState(false)
    const [error, setError] = useState('')

    if (!isOpen) return null

    // Get vehicle category from booking_details
    const vehicleCategory = booking.booking_details?.vehicle?.category ||
        booking.booking_details?.vehicleCategory ||
        booking.booking_details?.category || ''

    // Determine penalty list based on vehicle category:
    // - 'exotic' = Supercar penalties
    // - 'urban' or 'aziendali' = Urban/Utilitarie/Furgone/NCC penalties
    const isSupercar = vehicleCategory === 'exotic'
    const penaltyList = isSupercar ? SUPERCAR_PENALTIES : URBAN_UTILITAIRE_PENALTIES
    const vehicleTypeLabel = isSupercar ? 'Supercar' : 'Urban/Utilitarie/Furgone/NCC'

    // Handle penalty selection
    const handlePenaltySelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const penaltyId = e.target.value
        setSelectedPenalty(penaltyId)

        if (penaltyId === 'custom') {
            // Reset to manual entry
            setAmount('')
            setMotivo('')
        } else if (penaltyId) {
            // Auto-fill from selected penalty
            const penalty = penaltyList.find(p => p.id === penaltyId)
            if (penalty) {
                setAmount(penalty.amount > 0 ? penalty.amount.toString() : '')
                setMotivo(penalty.label)
            }
        } else {
            // Reset if empty selection
            setAmount('')
            setMotivo('')
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')

        // Validate amount
        const amountNum = parseFloat(amount)
        if (!amount || isNaN(amountNum) || amountNum <= 0) {
            setError('Inserisci un importo valido.')
            return
        }

        setIsGenerating(true)
        try {
            // Generate penalty invoice
            const response = await fetch('/.netlify/functions/generate-penalty-invoice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: booking.id,
                    customerId: booking.customer_id || booking.user_id,
                    amount: amountNum,
                    motivo: motivo || undefined,
                    note: note || undefined
                })
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.message || data.error || 'Errore durante la generazione della fattura. Riprova.')
            }

            // Success - open invoice PDF
            if (data.invoiceId) {
                const pdfResponse = await fetch('/.netlify/functions/generate-invoice-pdf', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ invoiceId: data.invoiceId })
                })

                if (pdfResponse.ok) {
                    const html = await pdfResponse.text()
                    const blob = new Blob([html], { type: 'text/html' })
                    const url = URL.createObjectURL(blob)
                    const printWindow = window.open(url, '_blank')

                    if (printWindow) {
                        setTimeout(() => URL.revokeObjectURL(url), 3000)
                    }
                }
            }

            alert(`✅ Fattura penale generata con successo!\n\nNumero: ${data.invoice?.numero_fattura || 'N/A'}\nImporto: €${amountNum.toFixed(2)}`)

            // Reset form and close
            setAmount('')
            setMotivo('')
            setNote('')
            onSuccess()
            onClose()
        } catch (error: any) {
            console.error('Error generating penalty invoice:', error)

            // Show detailed error message
            const errorMessage = error.message || 'Errore durante la generazione della fattura. Riprova.'
            setError(errorMessage)
        } finally {
            setIsGenerating(false)
        }
    }

    const handleClose = () => {
        if (!isGenerating) {
            setSelectedPenalty('')
            setAmount('')
            setMotivo('')
            setNote('')
            setError('')
            onClose()
        }
    }

    const handleEditCustomerClick = () => {
        const customerId = booking.customer_id || booking.user_id
        if (customerId && onEditCustomer) {
            onEditCustomer(customerId)
            handleClose()
        }
    }

    // Check if error is about missing customer data
    const isCustomerDataError = error.includes('incomplete') || error.includes('obbligatorio')

    return (
        <div className="fixed inset-0 bg-theme-bg-primary/80 flex items-center justify-center z-50 p-4">
            <div className="bg-theme-bg-secondary rounded-lg shadow-xl max-w-md w-full p-6 border border-theme-border">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-dr7-gold">Penali</h2>
                    <button
                        onClick={handleClose}
                        disabled={isGenerating}
                        className="text-theme-text-muted hover:text-theme-text-primary text-3xl leading-none disabled:opacity-50"
                    >
                        ×
                    </button>
                </div>

                <div className="mb-4 p-3 bg-theme-bg-tertiary rounded border border-theme-border">
                    <p className="text-sm text-theme-text-muted">Cliente</p>
                    <p className="text-theme-text-primary font-semibold">{booking.customer_name}</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Penalty Selection Dropdown */}
                    <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                            Seleziona Penale ({vehicleTypeLabel})
                        </label>
                        <select
                            value={selectedPenalty}
                            onChange={handlePenaltySelect}
                            className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold"
                            disabled={isGenerating}
                        >
                            <option value="">-- Seleziona una penale --</option>
                            {penaltyList.map(penalty => (
                                <option key={penalty.id} value={penalty.id}>
                                    {penalty.label} - €{penalty.amount > 0 ? penalty.amount : 'Variabile'}
                                </option>
                            ))}
                            <option value="custom">Penale personalizzata</option>
                        </select>
                        {selectedPenalty && selectedPenalty !== 'custom' && (
                            <p className="mt-2 text-xs text-theme-text-muted">
                                {penaltyList.find(p => p.id === selectedPenalty)?.description}
                            </p>
                        )}
                    </div>

                    {/* Amount field */}
                    <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                            Importo penale (netto, senza IVA) *
                        </label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted">€</span>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="w-full pl-8 pr-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-dr7-gold"
                                placeholder="0.00"
                                disabled={isGenerating}
                                required
                            />
                        </div>
                    </div>

                    {/* Motivo field */}
                    <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                            Motivo (opzionale)
                        </label>
                        <input
                            type="text"
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-dr7-gold"
                            placeholder="Es: Ritardo nella riconsegna"
                            disabled={isGenerating}
                        />
                    </div>

                    {/* Note field */}
                    <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                            Note interne (opzionale)
                        </label>
                        <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={3}
                            className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-dr7-gold resize-none"
                            placeholder="Note per uso interno..."
                            disabled={isGenerating}
                        />
                    </div>

                    {/* Error message with edit customer button */}
                    {error && (
                        <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg space-y-2">
                            <p className="text-red-300 text-sm">{error}</p>
                            {isCustomerDataError && onEditCustomer && (booking.customer_id || booking.user_id) && (
                                <button
                                    type="button"
                                    onClick={handleEditCustomerClick}
                                    className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-theme-text-primary text-sm rounded-full transition-colors"
                                >
                                    Modifica Dati Cliente
                                </button>
                            )}
                        </div>
                    )}

                    {/* Buttons */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={handleClose}
                            disabled={isGenerating}
                            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-theme-text-primary rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Annulla
                        </button>
                        <button
                            type="submit"
                            disabled={isGenerating}
                            className="flex-1 px-4 py-2 bg-dr7-gold hover:bg-yellow-500 text-black font-semibold rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isGenerating ? 'Generazione...' : 'Genera Fattura'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
