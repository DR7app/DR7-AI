import { useState } from 'react'
import toast from 'react-hot-toast'

interface DanniModalProps {
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

interface CartItem {
    id: string
    label: string
    unitPrice: number
    quantity: number
}

export default function DanniModal({ isOpen, booking, onClose, onSuccess, onEditCustomer }: DanniModalProps) {
    const [cart, setCart] = useState<CartItem[]>([])
    const [customAmount, setCustomAmount] = useState('')
    const [customLabel, setCustomLabel] = useState('')
    const [note, setNote] = useState('')
    const [isGenerating, setIsGenerating] = useState(false)
    const [error, setError] = useState('')

    if (!isOpen) return null

    function addToCart() {
        const amt = parseFloat(customAmount)
        if (!customLabel.trim() || isNaN(amt) || amt <= 0) return
        setCart(prev => [...prev, { id: `danno_${Date.now()}`, label: customLabel.trim(), unitPrice: amt, quantity: 1 }])
        setCustomAmount('')
        setCustomLabel('')
    }

    function removeFromCart(id: string) {
        setCart(prev => prev.filter(c => c.id !== id))
    }

    function incrementQty(id: string) {
        setCart(prev => prev.map(c => c.id === id ? { ...c, quantity: c.quantity + 1 } : c))
    }

    function decrementQty(id: string) {
        setCart(prev => {
            const item = prev.find(c => c.id === id)
            if (item && item.quantity > 1) {
                return prev.map(c => c.id === id ? { ...c, quantity: c.quantity - 1 } : c)
            }
            return prev.filter(c => c.id !== id)
        })
    }

    const cartTotal = cart.reduce((sum, c) => sum + c.unitPrice * c.quantity, 0)
    const cartItemCount = cart.reduce((sum, c) => sum + c.quantity, 0)

    const handleSubmit = async () => {
        setError('')
        if (cart.length === 0) { setError('Aggiungi almeno un danno.'); return }
        if (cartTotal <= 0) { setError('Il totale deve essere maggiore di zero.'); return }

        setIsGenerating(true)
        try {
            const response = await fetch('/.netlify/functions/generate-penalty-invoice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: booking.id,
                    customerId: booking.customer_id || booking.user_id,
                    items: cart.map(c => ({ label: c.label, amount: c.unitPrice, quantity: c.quantity })),
                    note: note || undefined,
                    type: 'danni'
                })
            })

            const data = await response.json()
            if (!response.ok) throw new Error(data.message || data.error || 'Errore nella generazione.')

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
                    const w = window.open(url, '_blank')
                    if (w) setTimeout(() => URL.revokeObjectURL(url), 3000)
                }
            }

            toast.success(`Fattura danni generata! N. ${data.invoice?.numero_fattura || 'N/A'} — €${cartTotal.toFixed(2)}`)
            setCart([]); setNote(''); onSuccess(); onClose()
        } catch (err: any) {
            console.error('Error generating danni invoice:', err)
            setError(err.message || 'Errore nella generazione.')
        } finally {
            setIsGenerating(false)
        }
    }

    const handleClose = () => {
        if (isGenerating) return
        setCart([]); setCustomAmount(''); setCustomLabel(''); setNote(''); setError(''); onClose()
    }

    const isCustomerDataError = error.includes('incomplete') || error.includes('obbligatorio')

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={handleClose}>
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* Modal */}
            <div
                className="relative w-full sm:max-w-lg max-h-[92vh] flex flex-col bg-theme-bg-secondary/95 backdrop-blur-xl rounded-t-3xl sm:rounded-3xl shadow-2xl border border-white/10 overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Drag handle (mobile) */}
                <div className="sm:hidden flex justify-center pt-3 pb-1">
                    <div className="w-10 h-1 rounded-full bg-white/20" />
                </div>

                {/* Header */}
                <div className="px-6 pt-4 sm:pt-6 pb-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-theme-text-primary tracking-tight">Danni</h2>
                            <p className="text-[13px] text-theme-text-muted mt-0.5">
                                {booking.customer_name}
                            </p>
                        </div>
                        <button
                            onClick={handleClose}
                            disabled={isGenerating}
                            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-theme-text-muted hover:text-theme-text-primary transition-all"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto px-4 pb-4">
                    {/* Add damage entry */}
                    <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4">
                        <p className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-widest mb-3">Aggiungi danno</p>
                        <div className="space-y-2">
                            <input
                                type="text"
                                value={customLabel}
                                onChange={e => setCustomLabel(e.target.value)}
                                placeholder="Descrizione danno"
                                className="w-full px-3 py-2 bg-white/[0.06] border border-white/[0.08] rounded-xl text-theme-text-primary text-[13px] placeholder-theme-text-muted/50 focus:outline-none focus:ring-1 focus:ring-red-500/50"
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addToCart() } }}
                            />
                            <div className="flex gap-2 items-center">
                                <div className="relative flex-1">
                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted text-[13px]">&euro;</span>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={customAmount}
                                        onChange={e => setCustomAmount(e.target.value)}
                                        placeholder="Importo"
                                        className="w-full pl-7 pr-2 py-2 bg-white/[0.06] border border-white/[0.08] rounded-xl text-theme-text-primary text-[13px] placeholder-theme-text-muted/50 focus:outline-none focus:ring-1 focus:ring-red-500/50"
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addToCart() } }}
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={addToCart}
                                    disabled={!customLabel.trim() || !customAmount || parseFloat(customAmount) <= 0}
                                    className="w-9 h-9 rounded-full bg-red-500/15 text-red-400 hover:bg-red-500/25 flex items-center justify-center transition-all disabled:opacity-20 disabled:cursor-not-allowed shrink-0"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                        <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Cart items */}
                    {cart.length > 0 && (
                        <div className="mt-3 rounded-2xl overflow-hidden bg-white/[0.04] border border-white/[0.06]">
                            {cart.map((item, idx) => {
                                const isLast = idx === cart.length - 1
                                return (
                                    <div
                                        key={item.id}
                                        className={`flex items-center gap-3 px-4 py-3 ${!isLast ? 'border-b border-white/[0.06]' : ''} bg-red-500/[0.06]`}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[13px] leading-tight text-theme-text-primary font-medium">{item.label}</p>
                                            <p className="text-[11px] text-theme-text-muted leading-tight mt-0.5">
                                                €{item.unitPrice % 1 === 0 ? item.unitPrice : item.unitPrice.toFixed(2)}
                                                {item.quantity > 1 && ` × ${item.quantity}`}
                                            </p>
                                        </div>

                                        <span className="font-semibold text-red-400 shrink-0 tabular-nums text-[13px]">
                                            €{(item.unitPrice * item.quantity) % 1 === 0 ? (item.unitPrice * item.quantity) : (item.unitPrice * item.quantity).toFixed(2)}
                                        </span>

                                        {/* Stepper */}
                                        <div className="flex items-center rounded-full bg-white/[0.06] border border-white/[0.08] shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => decrementQty(item.id)}
                                                className="w-7 h-7 flex items-center justify-center text-theme-text-muted hover:text-red-400 transition-colors rounded-l-full"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" d="M5 12h14" />
                                                </svg>
                                            </button>
                                            <span className="w-5 text-center text-[12px] font-semibold text-theme-text-primary tabular-nums">{item.quantity}</span>
                                            <button
                                                type="button"
                                                onClick={() => incrementQty(item.id)}
                                                className="w-7 h-7 flex items-center justify-center text-red-400 hover:text-red-300 transition-colors rounded-r-full"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                                                </svg>
                                            </button>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => removeFromCart(item.id)}
                                            className="w-5 h-5 rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 flex items-center justify-center transition-all shrink-0"
                                        >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                                <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {/* Note */}
                    <div className="mt-3 rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4">
                        <p className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-widest mb-2">Note interne</p>
                        <textarea
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            rows={2}
                            className="w-full px-3 py-2 bg-white/[0.06] border border-white/[0.08] rounded-xl text-theme-text-primary text-[13px] placeholder-theme-text-muted/50 focus:outline-none focus:ring-1 focus:ring-red-500/50 resize-none"
                            placeholder="Opzionale..."
                            disabled={isGenerating}
                        />
                    </div>
                </div>

                {/* Bottom total + CTA */}
                <div className="border-t border-white/[0.08] bg-theme-bg-secondary/98 backdrop-blur-xl px-6 py-4 space-y-3 shrink-0">
                    {/* Totale */}
                    <div className="flex items-center justify-between">
                        <span className="text-[13px] text-theme-text-muted">
                            {cart.length === 0 ? 'Nessun danno inserito' : `${cartItemCount} ${cartItemCount === 1 ? 'voce' : 'voci'}`}
                        </span>
                        <span className="text-2xl font-bold text-red-400 tracking-tight tabular-nums">
                            €{cartTotal % 1 === 0 ? cartTotal : cartTotal.toFixed(2)}
                        </span>
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 space-y-2">
                            <p className="text-red-400 text-[13px]">{error}</p>
                            {isCustomerDataError && onEditCustomer && (booking.customer_id || booking.user_id) && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const cid = booking.customer_id || booking.user_id
                                        if (cid && onEditCustomer) { onEditCustomer(cid); handleClose() }
                                    }}
                                    className="w-full py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-[13px] font-medium rounded-xl transition-colors"
                                >
                                    Modifica Dati Cliente
                                </button>
                            )}
                        </div>
                    )}

                    {/* CTA buttons */}
                    <div className="flex gap-3 pt-1">
                        <button
                            type="button"
                            onClick={handleClose}
                            disabled={isGenerating}
                            className="flex-1 py-3 bg-white/[0.08] hover:bg-white/[0.12] text-theme-text-primary text-[15px] font-medium rounded-2xl transition-all disabled:opacity-50"
                        >
                            Annulla
                        </button>
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={isGenerating || cart.length === 0}
                            className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white text-[15px] font-semibold rounded-2xl transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            {isGenerating ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Generazione...
                                </span>
                            ) : `Genera Fattura`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
