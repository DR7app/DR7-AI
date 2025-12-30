import { useState } from 'react'

interface PenaltyModalProps {
    isOpen: boolean
    booking: {
        id: string
        customer_name: string
        customer_id?: string
        user_id?: string
    }
    onClose: () => void
    onSuccess: () => void
    onEditCustomer?: (customerId: string) => void
}

export default function PenaltyModal({ isOpen, booking, onClose, onSuccess, onEditCustomer }: PenaltyModalProps) {
    const [amount, setAmount] = useState('')
    const [motivo, setMotivo] = useState('')
    const [note, setNote] = useState('')
    const [isGenerating, setIsGenerating] = useState(false)
    const [error, setError] = useState('')

    if (!isOpen) return null

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
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 rounded-lg shadow-xl max-w-md w-full p-6 border border-gray-700">
                <h2 className="text-2xl font-bold text-dr7-gold mb-4">Penali</h2>

                <div className="mb-4 p-3 bg-gray-800 rounded border border-gray-700">
                    <p className="text-sm text-gray-400">Cliente</p>
                    <p className="text-white font-semibold">{booking.customer_name}</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Amount field */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Importo penale (netto, senza IVA) *
                        </label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">€</span>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="w-full pl-8 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-dr7-gold"
                                placeholder="0.00"
                                disabled={isGenerating}
                                required
                            />
                        </div>
                    </div>

                    {/* Motivo field */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Motivo (opzionale)
                        </label>
                        <input
                            type="text"
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-dr7-gold"
                            placeholder="Es: Ritardo nella riconsegna"
                            disabled={isGenerating}
                        />
                    </div>

                    {/* Note field */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Note interne (opzionale)
                        </label>
                        <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={3}
                            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-dr7-gold resize-none"
                            placeholder="Note per uso interno..."
                            disabled={isGenerating}
                        />
                    </div>

                    {/* Error message with edit customer button */}
                    {error && (
                        <div className="p-3 bg-red-900/30 border border-red-700 rounded-md space-y-2">
                            <p className="text-red-300 text-sm">{error}</p>
                            {isCustomerDataError && onEditCustomer && (booking.customer_id || booking.user_id) && (
                                <button
                                    type="button"
                                    onClick={handleEditCustomerClick}
                                    className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
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
                            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Annulla
                        </button>
                        <button
                            type="submit"
                            disabled={isGenerating}
                            className="flex-1 px-4 py-2 bg-dr7-gold hover:bg-yellow-500 text-black font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isGenerating ? 'Generazione...' : 'Genera Fattura'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
