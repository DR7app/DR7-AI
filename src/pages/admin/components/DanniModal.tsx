import { useState, useRef } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { logAdminAction } from '../../../utils/logAdminAction'
import { buildBookingContext } from '../../../utils/adminLogHelpers'
import { authFetch } from '../../../utils/authFetch'

interface DanniModalProps {
    isOpen: boolean
    booking: {
        id: string
        customer_name: string
        customer_id?: string
        user_id?: string
        customer_email?: string
        customer_phone?: string
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
    const [paymentStatus, setPaymentStatus] = useState<'pending' | 'paid' | 'nexi_pay_by_link'>('pending')
    const [paymentMethod, setPaymentMethod] = useState('Contanti')
    const [amountPaid, setAmountPaid] = useState('')
    const [isGenerating, setIsGenerating] = useState(false)
    const [error, setError] = useState('')
    const [photos, setPhotos] = useState<File[]>([])
    const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([])
    const fileInputRef = useRef<HTMLInputElement>(null)

    if (!isOpen) return null

    function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files || [])
        setPhotos(prev => [...prev, ...files])
        setPhotoPreviewUrls(prev => [...prev, ...files.map(f => URL.createObjectURL(f))])
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    function removePhoto(index: number) {
        URL.revokeObjectURL(photoPreviewUrls[index])
        setPhotos(prev => prev.filter((_, i) => i !== index))
        setPhotoPreviewUrls(prev => prev.filter((_, i) => i !== index))
    }

    async function uploadDanniPhotos(): Promise<string[]> {
        const urls: string[] = []
        for (const file of photos) {
            const ext = file.name.split('.').pop() || 'jpg'
            const path = `danni/${booking.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
            const { error } = await supabase.storage.from('contracts').upload(path, file)
            if (!error) {
                const { data: publicUrl } = supabase.storage.from('contracts').getPublicUrl(path)
                urls.push(publicUrl.publicUrl)
            }
        }
        return urls
    }

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
            // Upload photos if any
            let photoUrls: string[] = []
            if (photos.length > 0) {
                photoUrls = await uploadDanniPhotos()
            }

            // Always save danni to booking_details first (prevents data loss if fattura fails)
            const { data: currentBooking, error: fetchErr } = await supabase
                .from('bookings')
                .select('booking_details')
                .eq('id', booking.id)
                .single()

            if (fetchErr) throw new Error('Errore nel recupero della prenotazione.')

            const details = currentBooking?.booking_details || {}
            const existingDanni = details.danni || []
            const italyDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })

            const paidAmount = amountPaid ? parseFloat(amountPaid) : cartTotal
            const isPartial = paymentStatus === 'paid' && paidAmount < cartTotal

            // For partial payments, distribute paid amount proportionally across items
            const newEntries = cart.map(c => {
                const itemTotal = Math.round(c.unitPrice * c.quantity * 100) / 100
                let itemPaid = 0
                if (paymentStatus === 'paid') {
                    if (isPartial) {
                        // Proportional: each item gets (its share / total) * amountPaid
                        itemPaid = Math.round((itemTotal / cartTotal) * paidAmount * 100) / 100
                    } else {
                        itemPaid = itemTotal
                    }
                }
                return {
                    label: c.label,
                    amount: c.unitPrice,
                    quantity: c.quantity,
                    total: itemTotal,
                    note: note || '',
                    date: italyDate,
                    paymentStatus: isPartial ? 'partial' : paymentStatus,
                    paymentMethod: paymentStatus === 'paid' ? paymentMethod : undefined,
                    amountPaid: itemPaid,
                    photos: photoUrls,
                }
            })

            const { error: updateErr } = await supabase
                .from('bookings')
                .update({
                    booking_details: {
                        ...details,
                        danni: [...existingDanni, ...newEntries]
                    }
                })
                .eq('id', booking.id)

            if (updateErr) throw new Error('Errore nel salvataggio del danno.')

            const isFullyPaid = paymentStatus === 'paid' && paidAmount >= cartTotal

            if (paymentStatus === 'paid' && paidAmount < cartTotal) {
                // PARTIAL: save but no fattura
                toast.success(`Danno registrato (Parziale: €${paidAmount.toFixed(2)} / €${cartTotal.toFixed(2)}) — fattura non generata`)
                logAdminAction('create_danni', 'booking', booking.id, {
                  ...buildBookingContext(booking),
                  amount: cartTotal,
                  amountPaid: paidAmount,
                  status: 'partial',
                  items: cart.map(c => c.label).join(', '),
                })
            } else if (isFullyPaid) {
                // FULLY PAID: generate fattura + send to SDI
                const response = await authFetch('/.netlify/functions/generate-penalty-invoice', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        bookingId: booking.id,
                        customerId: booking.customer_id || booking.user_id,
                        items: cart.map(c => ({ label: c.label, amount: c.unitPrice, quantity: c.quantity })),
                        note: note || undefined,
                        type: 'danni',
                        paymentStatus
                    })
                })

                const data = await response.json()
                if (!response.ok) {
                    const errMsg = data.message || data.error || 'Errore nella generazione.'
                    toast.error(`Fattura NON generata: ${errMsg}`, { duration: 10000 })
                    throw new Error(errMsg)
                }

                if (data.invoiceId) {
                    const pdfResponse = await authFetch('/.netlify/functions/generate-invoice-pdf', {
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
                logAdminAction('create_danni', 'booking', booking.id, {
                  ...buildBookingContext(booking),
                  amount: cartTotal,
                  status: paymentStatus,
                  items: cart.map(c => c.label).join(', '),
                  fattura_number: data?.invoice?.numero_fattura,
                })
            } else if (paymentStatus === 'nexi_pay_by_link') {
                // NEXI PAY BY LINK: generate link + send WhatsApp
                try {
                    const linkRes = await authFetch('/.netlify/functions/nexi-pay-by-link', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            bookingId: booking.id,
                            amount: cartTotal,
                            customerEmail: booking.customer_email || '',
                            customerName: booking.customer_name || 'Cliente',
                            description: `Danni — ${booking.customer_name}`,
                            expirationHours: 1,
                            paymentPurpose: 'danni',
                        }),
                    })
                    const linkData = await linkRes.json()

                    if (linkRes.ok && linkData.paymentUrl) {
                        // Send WhatsApp to customer
                        const custPhone = booking.customer_phone
                        const bookingRef = (booking.id || '').substring(0, 8).toUpperCase() || 'N/A'
                        if (custPhone) {
                            const sendRes = await fetch('/.netlify/functions/send-whatsapp-notification', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    customPhone: custPhone,
                                    templateKey: 'pro_richiesta_danni',
                                    templateVars: (() => {
                                        const customerName = booking.customer_name || 'Cliente'
                                        const amountStr = cartTotal.toFixed(2)
                                        return {
                                            '{customer_name}': customerName,
                                            '{nome}': customerName.split(' ')[0] || 'Cliente',
                                            '{amount}': amountStr,
                                            '{total}': amountStr,
                                            '{importo}': amountStr,
                                            '{link}': linkData.paymentUrl,
                                            '{payment_link}': linkData.paymentUrl,
                                            '{booking_ref}': bookingRef,
                                            '{booking_id}': bookingRef,
                                            '{contract_ref}': bookingRef,
                                        }
                                    })(),
                                    skipHeader: false,
                                })
                            })
                            const sendJson = await sendRes.json().catch(() => ({}))
                            if (sendJson?.skipped && sendJson?.reason === 'pro_template_unavailable') {
                                toast.error('Template mancante in Messaggi di Sistema Pro')
                            }
                        }

                        // Copy link to clipboard
                        try { await navigator.clipboard.writeText(linkData.paymentUrl) } catch { /* clipboard not available */ }

                        toast.success(`Pay by Link inviato al cliente! €${cartTotal.toFixed(2)}`)
                    } else {
                        toast.error('Errore creazione Pay by Link: ' + (linkData.error || 'Errore'))
                    }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } catch (linkErr: any) {
                    toast.error('Errore Pay by Link: ' + linkErr.message)
                }
                logAdminAction('create_danni', 'booking', booking.id, {
                  ...buildBookingContext(booking),
                  amount: cartTotal,
                  status: 'nexi_pay_by_link',
                  items: cart.map(c => c.label).join(', '),
                })
            } else {
                // DA SALDARE: already saved above, just show toast
                toast.success(`Danno registrato (Da Saldare) — €${cartTotal.toFixed(2)}`)
                logAdminAction('create_danni', 'booking', booking.id, {
                  ...buildBookingContext(booking),
                  amount: cartTotal,
                  status: paymentStatus,
                  items: cart.map(c => c.label).join(', '),
                })
            }

            setCart([]); setNote(''); setPhotos([]); setPhotoPreviewUrls([]); onSuccess(); onClose()
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            console.error('Error generating danni:', err)
            setError(_errMsg || 'Errore nella generazione.')
        } finally {
            setIsGenerating(false)
        }
    }

    const handleClose = () => {
        if (isGenerating) return
        setCart([]); setCustomAmount(''); setCustomLabel(''); setNote(''); setPaymentStatus('pending'); setPaymentMethod('Contanti'); setAmountPaid(''); setError(''); setPhotos([]); setPhotoPreviewUrls([]);  onClose()
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

                    {/* Foto Danni */}
                    <div className="mt-3 rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4">
                        <p className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-widest mb-2">Foto Danni</p>
                        <label className="flex items-center justify-center w-full px-3 py-3 rounded-xl bg-white/[0.06] border border-dashed border-white/[0.12] text-theme-text-muted hover:border-red-500/50 hover:text-red-400 cursor-pointer transition-colors">
                            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span className="text-[13px]">{photos.length > 0 ? `${photos.length} foto` : 'Aggiungi foto...'}</span>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={handlePhotoSelect}
                                className="hidden"
                                disabled={isGenerating}
                            />
                        </label>
                        {photoPreviewUrls.length > 0 && (
                            <div className="flex gap-2 mt-2 flex-wrap">
                                {photoPreviewUrls.map((url, i) => (
                                    <div key={i} className="relative group">
                                        <img src={url} alt={`Foto ${i + 1}`} className="w-16 h-16 object-cover rounded-lg border border-white/10" />
                                        <button
                                            type="button"
                                            onClick={() => removePhoto(i)}
                                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                        >X</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

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
                            {isCustomerDataError && onEditCustomer && (
                                <button
                                    type="button"
                                    onClick={async () => {
                                        let cid = booking.customer_id || booking.user_id
                                        if (!cid && booking.customer_email) {
                                            const { data } = await supabase
                                                .from('customers_extended')
                                                .select('id')
                                                .eq('email', booking.customer_email)
                                                .maybeSingle()
                                            if (data?.id) cid = data.id
                                        }
                                        if (cid && onEditCustomer) { onEditCustomer(cid); handleClose() }
                                        else toast.error('Cliente non trovato. Aggiorna manualmente il profilo.')
                                    }}
                                    className="w-full py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-[13px] font-medium rounded-xl transition-colors"
                                >
                                    Modifica Dati Cliente
                                </button>
                            )}
                        </div>
                    )}

                    {/* Payment status */}
                    <div className="flex items-center gap-3">
                        <span className="text-[13px] text-theme-text-muted">Stato pagamento</span>
                        <select
                            value={paymentStatus}
                            onChange={e => { setPaymentStatus(e.target.value as 'paid' | 'pending' | 'nexi_pay_by_link'); if (e.target.value !== 'paid') setAmountPaid('') }}
                            disabled={isGenerating}
                            className="flex-1 px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-xl text-theme-text-primary text-[13px] focus:outline-none focus:ring-1 focus:ring-red-500/50"
                        >
                            <option value="pending" className="bg-theme-bg-secondary text-theme-text-primary">Da Saldare</option>
                            <option value="nexi_pay_by_link" className="bg-theme-bg-secondary text-theme-text-primary">Nexi Pay by Link</option>
                            <option value="paid" className="bg-theme-bg-secondary text-theme-text-primary">Pagato</option>
                        </select>
                    </div>

                    {/* Payment method - shown when Pagato */}
                    {paymentStatus === 'paid' && (
                        <div className="flex items-center gap-3">
                            <span className="text-[13px] text-theme-text-muted">Metodo</span>
                            <select
                                value={paymentMethod}
                                onChange={e => setPaymentMethod(e.target.value)}
                                disabled={isGenerating}
                                className="flex-1 px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-xl text-theme-text-primary text-[13px] focus:outline-none focus:ring-1 focus:ring-red-500/50"
                            >
                                <option value="Nexi Pay by Link">Nexi - Pay by Link</option>
                                <option value="Bonifico">Bonifico</option>
                                <option value="Contanti">Contanti</option>
                                <option value="Credit Wallet">Credit Wallet</option>
                                <option value="Carta di Credito / bancomat">Carta di Credito / bancomat</option>
                                <option value="Paypal">Paypal</option>
                                <option value="RIBA">RIBA</option>
                                <option value="RID">RID</option>
                                <option value="Bollettino postale">Bollettino postale</option>
                                <option value="Assegno">Assegno</option>
                                <option value="Assegno circolare">Assegno circolare</option>
                                <option value="PagoPA">PagoPA</option>
                                <option value="RID utenze">RID utenze</option>
                                <option value="RIB veloce">RIB veloce</option>
                                <option value="SEPA Direct Debit">SEPA Direct Debit</option>
                                <option value="SEPA Direct Debit CORE">SEPA Direct Debit CORE</option>
                                <option value="SEPA Direct Debit B2B">SEPA Direct Debit B2B</option>
                                <option value="Domiciliazione bancaria">Domiciliazione bancaria</option>
                                <option value="Domiciliazione postale">Domiciliazione postale</option>
                                <option value="Trattenuta su somme già riscosse">Trattenuta su somme già riscosse</option>
                                <option value="Bollettino bancario">Bollettino bancario</option>
                                <option value="Contanti presso tesoreria">Contanti presso tesoreria</option>
                                <option value="Vaglia cambiario">Vaglia cambiario</option>
                                <option value="Quietanza erario">Quietanza erario</option>
                                <option value="Giroconto su conti di contabilità">Giroconto su conti di contabilità</option>
                            </select>
                        </div>
                    )}

                    {/* Amount paid - shown when Pagato */}
                    {paymentStatus === 'paid' && (
                        <div className="flex items-center gap-3">
                            <span className="text-[13px] text-theme-text-muted">Importo pagato (€)</span>
                            <input
                                type="number"
                                step="0.01"
                                value={amountPaid}
                                onChange={e => setAmountPaid(e.target.value)}
                                placeholder={cartTotal.toFixed(2)}
                                disabled={isGenerating}
                                className="flex-1 px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-xl text-theme-text-primary text-[13px] focus:outline-none focus:ring-1 focus:ring-red-500/50 placeholder-theme-text-muted/50"
                            />
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
                            ) : `Conferma`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
