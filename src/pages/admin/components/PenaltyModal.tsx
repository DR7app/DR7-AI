import { useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { logAdminAction } from '../../../utils/logAdminAction'

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
    { id: 'fermo_incidente', label: 'Fermo veicolo incidente/danni', amount: 350, description: '€350/giorno' },
    { id: 'fermo_alto_valore', label: 'Fermo veicolo (auto > €200k)', amount: 700, description: '€700/giorno' },
    { id: 'fumo', label: 'Fumo nell\'auto', amount: 50, description: 'Odore/cenere' },
    { id: 'foro_sigaretta', label: 'Foro da sigaretta', amount: 50, description: 'Per foro' },
    { id: 'guidatore_non_indicato', label: 'Guidatore non nel contratto', amount: 200, description: 'Violazione contratto' },
    { id: 'carburante_8', label: 'Carburante mancante (8 tacche)', amount: 25, description: 'Quadro 8 tacche' },
    { id: 'carburante_4', label: 'Carburante mancante (4 tacche)', amount: 50, description: 'Quadro 4 tacche' },
    { id: 'gonfia_ripara', label: 'Bomboletta gonfia e ripara', amount: 100, description: 'Per pneumatico' },
    { id: 'sporco', label: 'Veicolo sporco', amount: 30, description: 'Interni/rifiuti' },
    { id: 'igienizzazione', label: 'Igienizzazione straordinaria', amount: 100, description: 'Pulizia profonda' },
    { id: 'controlli_elettronici', label: 'Controlli elettronici disattivati', amount: 100, description: 'ESP/stabilita' },
    { id: 'multe', label: 'Multe e sanzioni', amount: 0, description: '100% a carico cliente' },
    { id: 'assenza_intestatario', label: 'Assenza intestatario', amount: 150, description: 'Consegna/ritiro' },
    { id: 'ritardo_checkout_base', label: 'Ritardo check-out (> 30 min)', amount: 50, description: 'Base minima' },
    { id: 'ritardo_checkout_minuto', label: 'Ritardo check-out (per min)', amount: 0.5, description: 'Oltre i 30 min' },
    { id: 'pista', label: 'Utilizzo in pista', amount: 5000, description: 'Kasko non attiva' },
    { id: 'cani', label: 'Cani / pelo di cane', amount: 100, description: 'Non tollerato' },
    { id: 'subnoleggio', label: 'Subnoleggio non autorizzato', amount: 1000, description: 'Violazione grave' },
    { id: 'neopatentati', label: 'Guida neopatentati', amount: 0, description: 'Responsabilita TOTALE' },
    { id: 'patente_mancante', label: 'Mancata esibizione patente', amount: 0, description: 'Perdita prenotazione' },
    { id: 'ritardo_riconsegna', label: 'Ritardo riconsegna (> 22h30)', amount: 0, description: 'Max = tariffa giornaliera' },
]

// Urban/Utilitarie/Furgone/NCC Penalties
const URBAN_UTILITAIRE_PENALTIES: PenaltyItem[] = [
    { id: 'fermo_utilitarie', label: 'Fermo veicolo (Utilitarie)', amount: 30, description: '€30/giorno' },
    { id: 'fermo_furgoni', label: 'Fermo veicolo (Furgoni/NCC)', amount: 100, description: '€100/giorno' },
    { id: 'fumo', label: 'Fumo nell\'auto', amount: 50, description: 'Odore/cenere' },
    { id: 'foro_sigaretta', label: 'Foro da sigaretta', amount: 50, description: 'Per foro' },
    { id: 'guidatore_non_indicato', label: 'Guidatore non nel contratto', amount: 200, description: 'Violazione contratto' },
    { id: 'carburante_8', label: 'Carburante mancante (8 tacche)', amount: 15, description: 'Quadro 8 tacche' },
    { id: 'carburante_4', label: 'Carburante mancante (4 tacche)', amount: 30, description: 'Quadro 4 tacche' },
    { id: 'gonfia_ripara', label: 'Bomboletta gonfia e ripara', amount: 100, description: 'Per pneumatico' },
    { id: 'sporco', label: 'Veicolo sporco', amount: 30, description: 'Interni/rifiuti' },
    { id: 'igienizzazione', label: 'Igienizzazione straordinaria', amount: 100, description: 'Pulizia profonda' },
    { id: 'multe', label: 'Multe e sanzioni', amount: 0, description: '100% a carico cliente' },
    { id: 'assenza_intestatario', label: 'Assenza intestatario', amount: 150, description: 'Consegna/ritiro' },
    { id: 'ritardo_checkout_base', label: 'Ritardo check-out (> 30 min)', amount: 20, description: 'Base minima' },
    { id: 'ritardo_checkout_minuto', label: 'Ritardo check-out (per min)', amount: 0.5, description: 'Oltre i 30 min' },
    { id: 'neopatentati', label: 'Guida neopatentati', amount: 0, description: 'Responsabilita TOTALE' },
    { id: 'cani', label: 'Cani / pelo di cane', amount: 100, description: 'Non tollerato' },
    { id: 'subnoleggio', label: 'Subnoleggio non autorizzato', amount: 1000, description: 'Violazione grave' },
    { id: 'ritardo_riconsegna', label: 'Ritardo riconsegna (> 22h30)', amount: 0, description: 'Max = tariffa giornaliera' },
]

export default function PenaltyModal({ isOpen, booking, onClose, onSuccess, onEditCustomer }: PenaltyModalProps) {
    const [cart, setCart] = useState<CartItem[]>([])
    const [customAmount, setCustomAmount] = useState('')
    const [customLabel, setCustomLabel] = useState('')
    const [note, setNote] = useState('')
    const [paymentStatus, setPaymentStatus] = useState<'pending' | 'paid' | 'nexi_pay_by_link'>('pending')
    const [paymentMethod, setPaymentMethod] = useState('Contanti')
    const [isGenerating, setIsGenerating] = useState(false)
    const [error, setError] = useState('')

    if (!isOpen) return null

    const vehicleCategory = booking.booking_details?.vehicle?.category ||
        booking.booking_details?.vehicleCategory ||
        booking.booking_details?.category || ''

    const isSupercar = vehicleCategory === 'exotic'
    const penaltyList = isSupercar ? SUPERCAR_PENALTIES : URBAN_UTILITAIRE_PENALTIES
    const vehicleTypeLabel = isSupercar ? 'Supercar' : 'Urban / Utilitarie'

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
        if (cart.length === 0) { setError('Aggiungi almeno una penale.'); return }
        if (cartTotal <= 0) { setError('Il totale deve essere maggiore di zero.'); return }

        setIsGenerating(true)
        try {
            if (paymentStatus === 'paid') {
                // PAGATO: generate fattura + send to SDI
                const response = await fetch('/.netlify/functions/generate-penalty-invoice', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        bookingId: booking.id,
                        customerId: booking.customer_id || booking.user_id,
                        items: cart.map(c => ({ label: c.label, amount: c.unitPrice, quantity: c.quantity })),
                        note: note || undefined,
                        paymentStatus
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

                // Also save to booking_details with paymentMethod
                const { data: currentBookingPaid, error: fetchErrPaid } = await supabase
                    .from('bookings')
                    .select('booking_details')
                    .eq('id', booking.id)
                    .single()

                if (!fetchErrPaid && currentBookingPaid) {
                    const detailsPaid = currentBookingPaid.booking_details || {}
                    const existingPenaltiesPaid = detailsPaid.penalties || []
                    const italyDatePaid = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
                    const paidEntries = cart.map(c => ({
                        label: c.label,
                        amount: c.unitPrice,
                        quantity: c.quantity,
                        total: Math.round(c.unitPrice * c.quantity * 100) / 100,
                        note: note || '',
                        date: italyDatePaid,
                        paymentStatus: 'paid',
                        paymentMethod,
                    }))
                    await supabase.from('bookings').update({
                        booking_details: { ...detailsPaid, penalties: [...existingPenaltiesPaid, ...paidEntries] }
                    }).eq('id', booking.id)
                }

                toast.success(`Fattura penale generata! N. ${data.invoice?.numero_fattura || 'N/A'} — €${cartTotal.toFixed(2)}`)
                logAdminAction('create_penalty', 'booking', booking.id, { amount: cartTotal, status: paymentStatus, paymentMethod })
            } else if (paymentStatus === 'nexi_pay_by_link') {
                // NEXI PAY BY LINK: save to booking_details + generate link + WhatsApp
                const { data: currentBookingNexi, error: fetchErrNexi } = await supabase
                    .from('bookings')
                    .select('booking_details, customer_phone, customer_email, customer_name')
                    .eq('id', booking.id)
                    .single()

                if (fetchErrNexi) throw new Error('Errore nel recupero della prenotazione.')

                const detailsNexi = currentBookingNexi?.booking_details || {}
                const existingPenaltiesNexi = detailsNexi.penalties || []
                const italyDateNexi = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })

                const nexiEntries = cart.map(c => ({
                    label: c.label,
                    amount: c.unitPrice,
                    quantity: c.quantity,
                    total: Math.round(c.unitPrice * c.quantity * 100) / 100,
                    note: note || '',
                    date: italyDateNexi,
                    paymentStatus: 'nexi_pay_by_link',
                }))

                await supabase.from('bookings').update({
                    booking_details: { ...detailsNexi, penalties: [...existingPenaltiesNexi, ...nexiEntries] }
                }).eq('id', booking.id)

                // Generate Pay by Link
                try {
                    const custPhone = currentBookingNexi?.customer_phone || booking.booking_details?.customer?.phone
                    const custEmail = currentBookingNexi?.customer_email || booking.booking_details?.customer?.email
                    const custName = currentBookingNexi?.customer_name || booking.customer_name

                    const linkRes = await fetch('/.netlify/functions/nexi-pay-by-link', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            bookingId: booking.id,
                            amount: cartTotal,
                            customerEmail: custEmail || '',
                            customerName: custName || 'Cliente',
                            description: `Penali — ${custName}`,
                            expirationHours: 1,
                        }),
                    })
                    const linkData = await linkRes.json()

                    if (linkRes.ok && linkData.paymentUrl) {
                        if (custPhone) {
                            await fetch('/.netlify/functions/send-whatsapp-notification', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    customPhone: custPhone,
                                    customMessage: `MESSAGGIO AUTOMATICO GENERATO DA RENTORA\nQuesto messaggio è stato inviato tramite il sistema automatizzato Rentora.\n\nGentile ${custName},\n\nIn riferimento al contratto di noleggio, sono state rilevate penali per un importo di €${cartTotal.toFixed(2)}.\n\nPer procedere al pagamento, clicchi sul seguente link sicuro:\n${linkData.paymentUrl}\n\n⚠️ Il link ha validità di 1 ora.\n\nGrazie per la collaborazione.\n\nDR7`
                                })
                            })
                        }
                        try { await navigator.clipboard.writeText(linkData.paymentUrl) } catch {}
                        toast.success(`Pay by Link penali inviato! €${cartTotal.toFixed(2)}`)
                    } else {
                        toast.error('Errore creazione Pay by Link: ' + (linkData.error || 'Errore'))
                    }
                } catch (linkErr: any) {
                    toast.error('Errore Pay by Link: ' + linkErr.message)
                }
                logAdminAction('create_penalty', 'booking', booking.id, { amount: cartTotal, status: 'nexi_pay_by_link' })
            } else {
                // DA SALDARE: save to booking_details.penalties[] (no fattura)
                const { data: currentBooking, error: fetchErr } = await supabase
                    .from('bookings')
                    .select('booking_details')
                    .eq('id', booking.id)
                    .single()

                if (fetchErr) throw new Error('Errore nel recupero della prenotazione.')

                const details = currentBooking?.booking_details || {}
                const existingPenalties = details.penalties || []
                const italyDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })

                const newEntries = cart.map(c => ({
                    label: c.label,
                    amount: c.unitPrice,
                    quantity: c.quantity,
                    total: Math.round(c.unitPrice * c.quantity * 100) / 100,
                    note: note || '',
                    date: italyDate,
                    paymentStatus: 'pending'
                }))

                const { error: updateErr } = await supabase
                    .from('bookings')
                    .update({
                        booking_details: {
                            ...details,
                            penalties: [...existingPenalties, ...newEntries]
                        }
                    })
                    .eq('id', booking.id)

                if (updateErr) throw new Error('Errore nel salvataggio della penale.')

                toast.success(`Penale registrata (Da Saldare) — €${cartTotal.toFixed(2)}`)
                logAdminAction('create_penalty', 'booking', booking.id, { amount: cartTotal, status: paymentStatus })
            }

            setCart([]); setNote(''); onSuccess(); onClose()
        } catch (err: any) {
            console.error('Error generating penalty:', err)
            setError(err.message || 'Errore nella generazione.')
        } finally {
            setIsGenerating(false)
        }
    }

    const handleClose = () => {
        if (isGenerating) return
        setCart([]); setCustomAmount(''); setCustomLabel(''); setNote(''); setPaymentStatus('pending'); setPaymentMethod('Contanti'); setError(''); onClose()
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
                            <h2 className="text-xl font-bold text-theme-text-primary tracking-tight">Penali</h2>
                            <p className="text-[13px] text-theme-text-muted mt-0.5">
                                {booking.customer_name} &middot; {vehicleTypeLabel}
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

                {/* Scrollable items */}
                <div className="flex-1 overflow-y-auto px-4 pb-4">
                    {/* Grouped list — iOS Settings style */}
                    <div className="rounded-2xl overflow-hidden bg-white/[0.04] border border-white/[0.06]">
                        {penaltyList.map((penalty, idx) => {
                            const qty = getCartQty(penalty.id)
                            const isVariable = penalty.amount === 0
                            const isLast = idx === penaltyList.length - 1
                            return (
                                <div
                                    key={penalty.id}
                                    className={`flex items-center gap-3 px-4 py-3 ${!isLast ? 'border-b border-white/[0.06]' : ''} ${qty > 0 ? 'bg-dr7-gold/[0.06]' : ''}`}
                                >
                                    {/* Label + description */}
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-[13px] leading-tight ${qty > 0 ? 'text-theme-text-primary font-medium' : 'text-theme-text-primary'}`}>
                                            {penalty.label}
                                        </p>
                                        <p className="text-[11px] text-theme-text-muted leading-tight mt-0.5">{penalty.description}</p>
                                    </div>

                                    {/* Price tag */}
                                    <span className={`text-[13px] font-medium shrink-0 ${qty > 0 ? 'text-dr7-gold' : 'text-theme-text-muted'}`}>
                                        {isVariable ? 'Var.' : `€${penalty.amount % 1 === 0 ? penalty.amount : penalty.amount.toFixed(2)}`}
                                    </span>

                                    {/* iOS-style stepper */}
                                    {qty === 0 ? (
                                        <button
                                            type="button"
                                            onClick={() => addToCart(penalty)}
                                            className="w-7 h-7 rounded-full bg-dr7-gold/15 text-dr7-gold hover:bg-dr7-gold/25 flex items-center justify-center transition-all shrink-0"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                                <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                                            </svg>
                                        </button>
                                    ) : (
                                        <div className="flex items-center rounded-full bg-white/[0.06] border border-white/[0.08] shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => removeFromCart(penalty.id)}
                                                className="w-8 h-8 flex items-center justify-center text-theme-text-muted hover:text-red-400 transition-colors rounded-l-full"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" d="M5 12h14" />
                                                </svg>
                                            </button>
                                            <span className="w-7 text-center text-[13px] font-semibold text-theme-text-primary tabular-nums">{qty}</span>
                                            <button
                                                type="button"
                                                onClick={() => addToCart(penalty)}
                                                className="w-8 h-8 flex items-center justify-center text-dr7-gold hover:text-yellow-400 transition-colors rounded-r-full"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                                                </svg>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>

                    {/* Custom penalty */}
                    <div className="mt-3 rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4">
                        <p className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-widest mb-3">Penale personalizzata</p>
                        <div className="flex gap-2 items-center">
                            <input
                                type="text"
                                value={customLabel}
                                onChange={e => setCustomLabel(e.target.value)}
                                placeholder="Descrizione"
                                className="flex-1 px-3 py-2 bg-white/[0.06] border border-white/[0.08] rounded-xl text-theme-text-primary text-[13px] placeholder-theme-text-muted/50 focus:outline-none focus:ring-1 focus:ring-dr7-gold/50"
                            />
                            <div className="relative w-20">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted text-[13px]">&euro;</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={customAmount}
                                    onChange={e => setCustomAmount(e.target.value)}
                                    placeholder="0"
                                    className="w-full pl-7 pr-2 py-2 bg-white/[0.06] border border-white/[0.08] rounded-xl text-theme-text-primary text-[13px] text-right placeholder-theme-text-muted/50 focus:outline-none focus:ring-1 focus:ring-dr7-gold/50"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={addCustomToCart}
                                disabled={!customLabel.trim() || !customAmount || parseFloat(customAmount) <= 0}
                                className="w-9 h-9 rounded-full bg-dr7-gold/15 text-dr7-gold hover:bg-dr7-gold/25 flex items-center justify-center transition-all disabled:opacity-20 disabled:cursor-not-allowed shrink-0"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Note */}
                    <div className="mt-3 rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4">
                        <p className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-widest mb-2">Note interne</p>
                        <textarea
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            rows={2}
                            className="w-full px-3 py-2 bg-white/[0.06] border border-white/[0.08] rounded-xl text-theme-text-primary text-[13px] placeholder-theme-text-muted/50 focus:outline-none focus:ring-1 focus:ring-dr7-gold/50 resize-none"
                            placeholder="Opzionale..."
                            disabled={isGenerating}
                        />
                    </div>
                </div>

                {/* Bottom cart + CTA */}
                <div className="border-t border-white/[0.08] bg-theme-bg-secondary/98 backdrop-blur-xl px-6 py-4 space-y-3 shrink-0">
                    {/* Cart line items */}
                    {cart.length > 0 && (
                        <div className="space-y-2 max-h-32 overflow-y-auto">
                            {cart.map(item => (
                                <div key={item.penaltyId} className="flex items-center gap-2 text-[13px]">
                                    <span className="flex-1 text-theme-text-primary truncate">{item.label}</span>
                                    {item.unitPrice === 0 ? (
                                        <div className="relative w-16 shrink-0">
                                            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-theme-text-muted text-[11px]">&euro;</span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value=""
                                                onChange={e => updateCartPrice(item.penaltyId, parseFloat(e.target.value) || 0)}
                                                placeholder="0"
                                                className="w-full pl-5 pr-1 py-0.5 bg-white/[0.06] border border-dr7-gold/30 rounded-lg text-theme-text-primary text-[11px] text-right focus:outline-none focus:ring-1 focus:ring-dr7-gold/50"
                                            />
                                        </div>
                                    ) : (
                                        <span className="text-theme-text-muted text-[11px] shrink-0">
                                            {item.quantity > 1 && `${item.quantity} × €${item.unitPrice % 1 === 0 ? item.unitPrice : item.unitPrice.toFixed(2)}`}
                                        </span>
                                    )}
                                    <span className="font-semibold text-dr7-gold shrink-0 w-14 text-right tabular-nums">
                                        €{(item.unitPrice * item.quantity) % 1 === 0 ? (item.unitPrice * item.quantity) : (item.unitPrice * item.quantity).toFixed(2)}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setCart(prev => prev.filter(c => c.penaltyId !== item.penaltyId))}
                                        className="w-5 h-5 rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 flex items-center justify-center transition-all shrink-0"
                                    >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                            <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Totale */}
                    <div className="flex items-center justify-between">
                        <span className="text-[13px] text-theme-text-muted">
                            {cart.length === 0 ? 'Nessuna penale selezionata' : `${cartItemCount} ${cartItemCount === 1 ? 'voce' : 'voci'}`}
                        </span>
                        <span className="text-2xl font-bold text-dr7-gold tracking-tight tabular-nums">
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

                    {/* Payment status */}
                    <div className="flex items-center gap-3">
                        <span className="text-[13px] text-theme-text-muted">Stato pagamento</span>
                        <select
                            value={paymentStatus}
                            onChange={e => setPaymentStatus(e.target.value as 'paid' | 'pending' | 'nexi_pay_by_link')}
                            disabled={isGenerating}
                            className="flex-1 px-3 py-2 bg-white/[0.06] border border-white/[0.08] rounded-xl text-theme-text-primary text-[13px] focus:outline-none focus:ring-1 focus:ring-dr7-gold/50"
                        >
                            <option value="pending">Da Saldare</option>
                            <option value="nexi_pay_by_link">Nexi Pay by Link</option>
                            <option value="paid">Pagato</option>
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
                                className="flex-1 px-3 py-2 bg-white/[0.06] border border-white/[0.08] rounded-xl text-theme-text-primary text-[13px] focus:outline-none focus:ring-1 focus:ring-dr7-gold/50"
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
                            className="flex-1 py-3 bg-dr7-gold hover:bg-yellow-500 text-black text-[15px] font-semibold rounded-2xl transition-all disabled:opacity-30 disabled:cursor-not-allowed"
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
