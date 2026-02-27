import { useState } from 'react'
import toast from 'react-hot-toast'

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

interface PenaltyItem {
    id: string
    label: string
    amount: number
    description: string
}

interface CartItem {
    penaltyId: string
    label: string
    unitPrice: number
    quantity: number
}

// Supercar Penalties
const SUPERCAR_PENALTIES: PenaltyItem[] = [
    { id: 'fermo_incidente', label: 'Fermo veicolo per incidente o danni', amount: 350, description: '€350/giorno di inutilizzo del veicolo' },
    { id: 'fermo_alto_valore', label: 'Fermo veicolo (auto > €200k)', amount: 700, description: '€700/giorno per vetture > €200.000' },
    { id: 'fumo', label: 'Fumo nell\'auto (odore/cenere)', amount: 50, description: '€50 senza danni, solo odore o cenere' },
    { id: 'foro_sigaretta', label: 'Foro da sigaretta (per foro)', amount: 50, description: '€50 per ogni foro nella tappezzeria' },
    { id: 'guidatore_non_indicato', label: 'Guidatore non citato nel contratto', amount: 200, description: 'Solo persone citate nel contratto' },
    { id: 'carburante_8', label: 'Carburante mancante (8 tacche)', amount: 25, description: '€25 se il quadro ha 8 tacche' },
    { id: 'carburante_4', label: 'Carburante mancante (4 tacche)', amount: 50, description: '€50 se il quadro ha 4 tacche' },
    { id: 'gonfia_ripara', label: 'Bomboletta "gonfia e ripara"', amount: 100, description: '€100 per pneumatico' },
    { id: 'sporco', label: 'Veicolo sporco (interni/rifiuti)', amount: 30, description: 'Sporco interni, portiere, sedili, bagagliaio' },
    { id: 'igienizzazione', label: 'Igienizzazione straordinaria', amount: 100, description: 'In aggiunta alla penale per sporco' },
    { id: 'controlli_elettronici', label: 'Disattivazione controlli elettronici', amount: 100, description: 'ESP, controlli di stabilità disattivati' },
    { id: 'multe', label: 'Multe e sanzioni', amount: 0, description: '100% a carico del cliente' },
    { id: 'assenza_intestatario', label: 'Assenza intestatario a consegna/ritiro', amount: 150, description: 'Intestatario deve essere presente' },
    { id: 'ritardo_checkout_base', label: 'Ritardo al check-out (dopo 30 min)', amount: 50, description: '€50 minimo dopo i primi 30 minuti' },
    { id: 'ritardo_checkout_minuto', label: 'Ritardo al check-out (per minuto)', amount: 0.5, description: '+€0.50 per ogni minuto oltre i 30 min' },
    { id: 'pista', label: 'Utilizzo in pista o competizioni', amount: 5000, description: '€5.000 + risarcimento danni totali' },
    { id: 'cani', label: 'Presenza di cani o pelo di cane', amount: 100, description: 'Non tollerato' },
    { id: 'subnoleggio', label: 'Subnoleggio non autorizzato', amount: 1000, description: 'Violazione grave del contratto' },
    { id: 'neopatentati', label: 'Guida neopatentati/non abilitati', amount: 0, description: 'Responsabilità TOTALE' },
    { id: 'patente_mancante', label: 'Mancata esibizione patente fisica', amount: 0, description: 'Perdita prenotazione e importo versato' },
    { id: 'ritardo_riconsegna', label: 'Ritardo riconsegna (oltre 22h30)', amount: 0, description: 'Penale max = tariffa giornaliera' },
]

// Urban/Utilitarie/Furgone/NCC Penalties
const URBAN_UTILITAIRE_PENALTIES: PenaltyItem[] = [
    { id: 'fermo_utilitarie', label: 'Fermo veicolo (Utilitarie)', amount: 30, description: '€30/giorno di inutilizzo' },
    { id: 'fermo_furgoni', label: 'Fermo veicolo (Furgoni/NCC)', amount: 100, description: '€100/giorno di inutilizzo' },
    { id: 'fumo', label: 'Fumo nell\'auto (odore/cenere)', amount: 50, description: '€50 senza danni, solo odore o cenere' },
    { id: 'foro_sigaretta', label: 'Foro da sigaretta (per foro)', amount: 50, description: '€50 per ogni foro nella tappezzeria' },
    { id: 'guidatore_non_indicato', label: 'Guidatore non citato nel contratto', amount: 200, description: 'Solo persone citate nel contratto' },
    { id: 'carburante_8', label: 'Carburante mancante (8 tacche)', amount: 15, description: '€15 se il quadro ha 8 tacche' },
    { id: 'carburante_4', label: 'Carburante mancante (4 tacche)', amount: 30, description: '€30 se il quadro ha 4 tacche' },
    { id: 'gonfia_ripara', label: 'Bomboletta "gonfia e ripara"', amount: 100, description: '€100 per pneumatico' },
    { id: 'sporco', label: 'Veicolo sporco (interni/rifiuti)', amount: 30, description: 'Sporco interni, portiere, sedili, bagagliaio' },
    { id: 'igienizzazione', label: 'Igienizzazione straordinaria', amount: 100, description: 'In aggiunta alla penale per sporco' },
    { id: 'multe', label: 'Multe e sanzioni', amount: 0, description: '100% a carico del cliente' },
    { id: 'assenza_intestatario', label: 'Assenza intestatario a consegna/ritiro', amount: 150, description: 'Intestatario deve essere presente' },
    { id: 'ritardo_checkout_base', label: 'Ritardo al check-out (dopo 30 min)', amount: 20, description: '€20 minimo dopo i primi 30 minuti' },
    { id: 'ritardo_checkout_minuto', label: 'Ritardo al check-out (per minuto)', amount: 0.5, description: '+€0.50 per ogni minuto oltre i 30 min' },
    { id: 'neopatentati', label: 'Guida neopatentati/non abilitati', amount: 0, description: 'Responsabilità TOTALE' },
    { id: 'cani', label: 'Presenza di cani o pelo di cane', amount: 100, description: 'Non tollerato' },
    { id: 'subnoleggio', label: 'Subnoleggio non autorizzato', amount: 1000, description: 'Violazione grave del contratto' },
    { id: 'ritardo_riconsegna', label: 'Ritardo riconsegna (oltre 22h30)', amount: 0, description: 'Penale max = tariffa giornaliera' },
]

export default function PenaltyModal({ isOpen, booking, onClose, onSuccess, onEditCustomer }: PenaltyModalProps) {
    const [cart, setCart] = useState<CartItem[]>([])
    const [customAmount, setCustomAmount] = useState('')
    const [customLabel, setCustomLabel] = useState('')
    const [note, setNote] = useState('')
    const [isGenerating, setIsGenerating] = useState(false)
    const [error, setError] = useState('')

    if (!isOpen) return null

    const vehicleCategory = booking.booking_details?.vehicle?.category ||
        booking.booking_details?.vehicleCategory ||
        booking.booking_details?.category || ''

    const isSupercar = vehicleCategory === 'exotic'
    const penaltyList = isSupercar ? SUPERCAR_PENALTIES : URBAN_UTILITAIRE_PENALTIES
    const vehicleTypeLabel = isSupercar ? 'Supercar' : 'Urban/Utilitarie'

    // Cart helpers
    function getCartQty(penaltyId: string): number {
        return cart.find(c => c.penaltyId === penaltyId)?.quantity || 0
    }

    function addToCart(penalty: PenaltyItem) {
        setCart(prev => {
            const existing = prev.find(c => c.penaltyId === penalty.id)
            if (existing) {
                return prev.map(c => c.penaltyId === penalty.id ? { ...c, quantity: c.quantity + 1 } : c)
            }
            return [...prev, { penaltyId: penalty.id, label: penalty.label, unitPrice: penalty.amount, quantity: 1 }]
        })
    }

    function removeFromCart(penaltyId: string) {
        setCart(prev => {
            const existing = prev.find(c => c.penaltyId === penaltyId)
            if (existing && existing.quantity > 1) {
                return prev.map(c => c.penaltyId === penaltyId ? { ...c, quantity: c.quantity - 1 } : c)
            }
            return prev.filter(c => c.penaltyId !== penaltyId)
        })
    }

    function updateCartPrice(penaltyId: string, newPrice: number) {
        setCart(prev => prev.map(c => c.penaltyId === penaltyId ? { ...c, unitPrice: newPrice } : c))
    }

    function addCustomToCart() {
        const amt = parseFloat(customAmount)
        if (!customLabel.trim() || isNaN(amt) || amt <= 0) return
        const customId = `custom_${Date.now()}`
        setCart(prev => [...prev, { penaltyId: customId, label: customLabel.trim(), unitPrice: amt, quantity: 1 }])
        setCustomAmount('')
        setCustomLabel('')
    }

    const cartTotal = cart.reduce((sum, c) => sum + c.unitPrice * c.quantity, 0)
    const cartItemCount = cart.reduce((sum, c) => sum + c.quantity, 0)

    const handleSubmit = async () => {
        setError('')

        if (cart.length === 0) {
            setError('Aggiungi almeno una penale al carrello.')
            return
        }

        if (cartTotal <= 0) {
            setError('Il totale deve essere maggiore di zero.')
            return
        }

        setIsGenerating(true)
        try {
            const response = await fetch('/.netlify/functions/generate-penalty-invoice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: booking.id,
                    customerId: booking.customer_id || booking.user_id,
                    items: cart.map(c => ({
                        label: c.label,
                        amount: c.unitPrice,
                        quantity: c.quantity,
                    })),
                    note: note || undefined
                })
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.message || data.error || 'Errore durante la generazione della fattura.')
            }

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

            toast.success(`Fattura penale generata! N. ${data.invoice?.numero_fattura || 'N/A'} - €${cartTotal.toFixed(2)} (${cartItemCount} voci)`)

            setCart([])
            setNote('')
            onSuccess()
            onClose()
        } catch (error: any) {
            console.error('Error generating penalty invoice:', error)
            setError(error.message || 'Errore durante la generazione della fattura.')
        } finally {
            setIsGenerating(false)
        }
    }

    const handleClose = () => {
        if (!isGenerating) {
            setCart([])
            setCustomAmount('')
            setCustomLabel('')
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

    const isCustomerDataError = error.includes('incomplete') || error.includes('obbligatorio')

    return (
        <div className="fixed inset-0 bg-theme-bg-primary/80 flex items-center justify-center z-50 p-4">
            <div className="bg-theme-bg-secondary rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col border border-theme-border">
                {/* Header */}
                <div className="flex justify-between items-center p-5 pb-3 border-b border-theme-border shrink-0">
                    <div>
                        <h2 className="text-2xl font-bold text-dr7-gold">Penali</h2>
                        <p className="text-sm text-theme-text-muted mt-0.5">
                            {booking.customer_name} &middot; {vehicleTypeLabel}
                        </p>
                    </div>
                    <button
                        onClick={handleClose}
                        disabled={isGenerating}
                        className="text-theme-text-muted hover:text-theme-text-primary text-3xl leading-none disabled:opacity-50"
                    >
                        &times;
                    </button>
                </div>

                {/* Scrollable content */}
                <div className="overflow-y-auto flex-1 p-5 space-y-4">
                    {/* Penalty items list */}
                    <div className="space-y-1.5">
                        {penaltyList.map(penalty => {
                            const qty = getCartQty(penalty.id)
                            const isVariable = penalty.amount === 0
                            return (
                                <div
                                    key={penalty.id}
                                    className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                                        qty > 0
                                            ? 'border-dr7-gold/40 bg-dr7-gold/5'
                                            : 'border-theme-border/50 bg-theme-bg-tertiary/30 hover:bg-theme-bg-tertiary/50'
                                    }`}
                                >
                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-theme-text-primary leading-tight truncate">{penalty.label}</p>
                                        <p className="text-[11px] text-theme-text-muted leading-tight">{penalty.description}</p>
                                    </div>

                                    {/* Price */}
                                    <div className="text-right shrink-0 w-16">
                                        <span className="text-sm font-semibold text-dr7-gold">
                                            {isVariable ? 'Var.' : `€${penalty.amount.toFixed(2)}`}
                                        </span>
                                    </div>

                                    {/* Qty controls */}
                                    <div className="flex items-center gap-1 shrink-0">
                                        {qty > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => removeFromCart(penalty.id)}
                                                className="w-7 h-7 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 flex items-center justify-center text-lg font-bold transition-colors"
                                            >
                                                &minus;
                                            </button>
                                        )}
                                        {qty > 0 && (
                                            <span className="w-6 text-center text-sm font-bold text-theme-text-primary">{qty}</span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (isVariable && qty === 0) {
                                                    // For variable-price items, add with 0 and let user edit in cart
                                                    addToCart(penalty)
                                                } else {
                                                    addToCart(penalty)
                                                }
                                            }}
                                            className="w-7 h-7 rounded-full bg-dr7-gold/20 text-dr7-gold hover:bg-dr7-gold/30 flex items-center justify-center text-lg font-bold transition-colors"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {/* Custom penalty */}
                    <div className="border border-dashed border-theme-border rounded-lg p-3">
                        <p className="text-xs font-semibold text-theme-text-muted uppercase tracking-wider mb-2">Penale personalizzata</p>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={customLabel}
                                onChange={e => setCustomLabel(e.target.value)}
                                placeholder="Descrizione..."
                                className="flex-1 px-3 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm placeholder-theme-text-muted focus:outline-none focus:border-dr7-gold"
                            />
                            <div className="relative w-24">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-theme-text-muted text-sm">&euro;</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={customAmount}
                                    onChange={e => setCustomAmount(e.target.value)}
                                    placeholder="0.00"
                                    className="w-full pl-6 pr-2 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm text-right placeholder-theme-text-muted focus:outline-none focus:border-dr7-gold"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={addCustomToCart}
                                disabled={!customLabel.trim() || !customAmount || parseFloat(customAmount) <= 0}
                                className="px-3 py-1.5 bg-dr7-gold/20 text-dr7-gold rounded font-semibold text-sm hover:bg-dr7-gold/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                +
                            </button>
                        </div>
                    </div>

                    {/* Note */}
                    <div>
                        <label className="block text-xs font-medium text-theme-text-muted mb-1">Note interne (opzionale)</label>
                        <textarea
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            rows={2}
                            className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm placeholder-theme-text-muted focus:outline-none focus:border-dr7-gold resize-none"
                            placeholder="Note per uso interno..."
                            disabled={isGenerating}
                        />
                    </div>
                </div>

                {/* Cart summary + actions (sticky footer) */}
                <div className="border-t border-theme-border p-5 pt-4 shrink-0 space-y-3">
                    {/* Cart items summary */}
                    {cart.length > 0 && (
                        <div className="space-y-1.5 max-h-36 overflow-y-auto">
                            {cart.map(item => (
                                <div key={item.penaltyId} className="flex items-center justify-between text-sm gap-2">
                                    <div className="flex-1 min-w-0">
                                        <span className="text-theme-text-primary truncate block">{item.label}</span>
                                    </div>
                                    {/* Editable unit price for variable items */}
                                    {item.unitPrice === 0 ? (
                                        <div className="relative w-20 shrink-0">
                                            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-theme-text-muted text-xs">&euro;</span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value=""
                                                onChange={e => updateCartPrice(item.penaltyId, parseFloat(e.target.value) || 0)}
                                                placeholder="0.00"
                                                className="w-full pl-5 pr-1 py-0.5 bg-theme-bg-tertiary border border-dr7-gold/50 rounded text-theme-text-primary text-xs text-right focus:outline-none focus:border-dr7-gold"
                                            />
                                        </div>
                                    ) : (
                                        <span className="text-theme-text-muted shrink-0 text-xs">
                                            {item.quantity > 1 ? `${item.quantity} x €${item.unitPrice.toFixed(2)}` : `€${item.unitPrice.toFixed(2)}`}
                                        </span>
                                    )}
                                    <span className="font-semibold text-dr7-gold shrink-0 w-16 text-right">
                                        €{(item.unitPrice * item.quantity).toFixed(2)}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setCart(prev => prev.filter(c => c.penaltyId !== item.penaltyId))}
                                        className="text-red-400 hover:text-red-300 text-xs shrink-0"
                                    >
                                        &times;
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Total */}
                    <div className="flex items-center justify-between pt-2 border-t border-theme-border/50">
                        <span className="text-theme-text-muted text-sm">
                            {cart.length === 0 ? 'Carrello vuoto' : `${cartItemCount} ${cartItemCount === 1 ? 'voce' : 'voci'}`}
                        </span>
                        <span className="text-xl font-bold text-dr7-gold">
                            €{cartTotal.toFixed(2)}
                        </span>
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg space-y-2">
                            <p className="text-red-300 text-sm">{error}</p>
                            {isCustomerDataError && onEditCustomer && (booking.customer_id || booking.user_id) && (
                                <button
                                    type="button"
                                    onClick={handleEditCustomerClick}
                                    className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-full transition-colors"
                                >
                                    Modifica Dati Cliente
                                </button>
                            )}
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={handleClose}
                            disabled={isGenerating}
                            className="flex-1 px-4 py-2.5 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-full transition-colors disabled:opacity-50"
                        >
                            Annulla
                        </button>
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={isGenerating || cart.length === 0}
                            className="flex-1 px-4 py-2.5 bg-dr7-gold hover:bg-yellow-500 text-black font-semibold rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isGenerating ? 'Generazione...' : `Genera Fattura (€${cartTotal.toFixed(2)})`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
