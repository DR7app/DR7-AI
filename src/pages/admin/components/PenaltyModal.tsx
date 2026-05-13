import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { logAdminAction } from '../../../utils/logAdminAction'
import { buildBookingContext } from '../../../utils/adminLogHelpers'
import { authFetch } from '../../../utils/authFetch'
import { usePaymentMethods } from '../../../hooks/usePaymentMethods'

/**
 * Normalizza un input monetario: accetta sia "." che "," come separatore
 * decimale. Risolve il bug "non riesco a digitare il punto" su browser
 * in locale italiano (type=number rifiutava il punto).
 */
function sanitizeMoney(raw: string): string {
    if (!raw) return ''
    let s = String(raw).trim().replace(/,/g, '.')
    s = s.replace(/[^0-9.\-]/g, '')
    s = s.replace(/(?!^)-/g, '')
    const firstDot = s.indexOf('.')
    if (firstDot !== -1) {
        s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '')
    }
    return s
}

interface PenaltyModalProps {
    isOpen: boolean
    booking: {
        id: string
        customer_name: string
        customer_id?: string
        user_id?: string
        vehicle_name?: string
        km_overage_fee?: number
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// Penalty presets are now sourced ONLY from Centralina Pro
// (centralina_pro_config.config.penali). Removed the hardcoded
// SUPERCAR_PENALTIES / URBAN_UTILITAIRE_PENALTIES arrays so a price change
// in Centralina is reflected here without code edits.

export default function PenaltyModal({ isOpen, booking, onClose, onSuccess, onEditCustomer }: PenaltyModalProps) {
    const [cart, setCart] = useState<CartItem[]>([])
    const [customAmount, setCustomAmount] = useState('')
    const [customLabel, setCustomLabel] = useState('')
    const [note, setNote] = useState('')
    const [paymentStatus, setPaymentStatus] = useState<'pending' | 'paid' | 'nexi_pay_by_link'>('pending')
    const [paymentMethod, setPaymentMethod] = useState('Contanti')
    const paymentMethods = usePaymentMethods()
    const [isGenerating, setIsGenerating] = useState(false)
    const [error, setError] = useState('')
    // Final desired price — when set & < subtotal, the difference becomes a
    // "Sconto" line on the fattura while the original items stay intact.
    const [finalPriceInput, setFinalPriceInput] = useState('')
    // Per-category penalty list from Centralina Pro — single source of truth.
    const [penaliFromCfg, setPenaliFromCfg] = useState<Record<string, PenaltyItem[]> | null>(null)
    const [resolvedCategory, setResolvedCategory] = useState<string>('')

    useEffect(() => {
        if (!isOpen) return
        let cancelled = false
        ;(async () => {
            // 1. Pro penali
            try {
                const { data } = await supabase
                    .from('centralina_pro_config')
                    .select('config')
                    .eq('id', 'main')
                    .maybeSingle()
                const proPenali = data?.config?.penali as Record<string, Array<{ id: string; label: string; amount: number; description?: string; enabled?: boolean }>> | undefined
                if (!cancelled && proPenali) {
                    const PRO_TO_DB: Record<string, string> = { supercars: 'exotic', urban: 'urban', aziendali: 'aziendali' }
                    const out: Record<string, PenaltyItem[]> = {}
                    for (const [proCat, items] of Object.entries(proPenali)) {
                        if (!Array.isArray(items)) continue
                        const dbCat = PRO_TO_DB[proCat] || proCat
                        out[dbCat] = items
                            .filter(it => it && it.enabled !== false)
                            .map(it => ({
                                id: String(it.id || ''),
                                label: String(it.label || ''),
                                amount: typeof it.amount === 'number' ? it.amount : Number(it.amount) || 0,
                                description: String(it.description || ''),
                            }))
                    }
                    setPenaliFromCfg(out)
                }
            } catch { /* ignore */ }

            // 2. Resolve vehicle category — try booking_details, fall back to
            //    vehicles table by id/plate.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const bd = (booking as { booking_details?: any }).booking_details
            let cat = String(bd?.vehicle?.category || bd?.vehicleCategory || bd?.category || '').toLowerCase().trim()
            if (!cat) {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const vid = (booking as any).vehicle_id || bd?.vehicle?.id || bd?.vehicle_id
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const plate = (booking as any).vehicle_plate || bd?.vehicle?.plate || bd?.vehicle_plate
                    if (vid) {
                        const { data: v } = await supabase.from('vehicles').select('category').eq('id', vid).maybeSingle()
                        if (v?.category) cat = String(v.category).toLowerCase().trim()
                    }
                    if (!cat && plate) {
                        const { data: v } = await supabase.from('vehicles').select('category').eq('plate', plate).maybeSingle()
                        if (v?.category) cat = String(v.category).toLowerCase().trim()
                    }
                } catch { /* ignore */ }
            }
            // Normalise common aliases
            if (cat === 'supercar' || cat === 'supercars') cat = 'exotic'
            if (cat === 'furgone' || cat === 'furgoni' || cat === 'ncc') cat = 'aziendali'
            if (cat === 'utilitaria' || cat === 'utilitarie') cat = 'urban'
            if (!cancelled) setResolvedCategory(cat)
        })()
        return () => { cancelled = true }
    }, [isOpen, booking])

    const vehicleCategory = resolvedCategory ||
        booking.booking_details?.vehicle?.category ||
        booking.booking_details?.vehicleCategory ||
        booking.booking_details?.category || ''

    const isSupercar = vehicleCategory === 'exotic'
    // SPECIAL CASE — Km Sforo: per-km rate comes from the BOOKING's locked-in
    // rate (booking.km_overage_fee), NOT current Centralina. Always injected
    // as a synthetic row at the top so the operator doesn't have to add it
    // to Centralina Pro manually for every category. Match liberally by id
    // OR label keyword so any "sforo" / "eccesso" entry triggers the override.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bookingSforoRate = Number((booking as any).km_overage_fee
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?? (booking as { booking_details?: any }).booking_details?.km_overage_fee
        ?? 0)
    const isSforoRow = (it: { id?: string; label?: string }): boolean => {
        const id = String(it.id || '').toLowerCase()
        const label = String(it.label || '').toLowerCase()
        if (id.includes('sforo') || id.includes('eccesso')) return true
        if (label.includes('sforo')) return true
        if (label.includes('km extra') || label.includes('km eccesso')) return true
        if (label.includes('eccesso km')) return true
        return false
    }
    const penaltyList: PenaltyItem[] = useMemo(() => {
        const base = penaliFromCfg ? (penaliFromCfg[vehicleCategory] || []) : []
        const overridden = base.map(it => {
            if (isSforoRow(it)) {
                return {
                    ...it,
                    amount: bookingSforoRate,
                    description: bookingSforoRate > 0
                        ? `€${bookingSforoRate.toFixed(2)}/km — tariffa contratto`
                        : 'Tariffa contratto non disponibile',
                }
            }
            return it
        })
        const hasSforoRow = overridden.some(isSforoRow)
        if (hasSforoRow) return overridden
        if (bookingSforoRate <= 0) return overridden
        return [
            {
                id: 'km_sforo',
                label: 'Sforo Km',
                amount: bookingSforoRate,
                description: `€${bookingSforoRate.toFixed(2)}/km — tariffa contratto`,
            },
            ...overridden,
        ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [penaliFromCfg, vehicleCategory, bookingSforoRate])

    const vehicleTypeLabel = isSupercar ? 'Supercar' : vehicleCategory === 'aziendali' ? 'Aziendali' : 'Urban / Utilitarie'

    if (!isOpen) return null

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

    function setSforoKm(penalty: PenaltyItem, km: number) {
        const safeKm = Number.isFinite(km) && km > 0 ? Math.floor(km) : 0
        setCart(prev => {
            const existing = prev.find(c => c.penaltyId === penalty.id)
            if (safeKm <= 0) return prev.filter(c => c.penaltyId !== penalty.id)
            if (existing) {
                return prev.map(c => c.penaltyId === penalty.id ? { ...c, unitPrice: penalty.amount, quantity: safeKm } : c)
            }
            return [...prev, { penaltyId: penalty.id, label: penalty.label, unitPrice: penalty.amount, quantity: safeKm }]
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

    const cartSubtotal = cart.reduce((sum, c) => sum + c.unitPrice * c.quantity, 0)
    const cartItemCount = cart.reduce((sum, c) => sum + c.quantity, 0)
    const finalPriceParsed = parseFloat(finalPriceInput)
    const hasFinalPrice = Number.isFinite(finalPriceParsed) && finalPriceParsed > 0 && finalPriceParsed < cartSubtotal
    const cartDiscount = hasFinalPrice ? Math.round((cartSubtotal - finalPriceParsed) * 100) / 100 : 0
    const cartTotal = hasFinalPrice ? finalPriceParsed : cartSubtotal

    const handleSubmit = async () => {
        setError('')
        if (cart.length === 0) { setError('Aggiungi almeno una penale.'); return }
        if (cartTotal <= 0) { setError('Il totale deve essere maggiore di zero.'); return }

        setIsGenerating(true)
        try {
            if (paymentStatus === 'paid') {
                // PAGATO: generate fattura + send to SDI
                const response = await authFetch('/.netlify/functions/generate-penalty-invoice', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        bookingId: booking.id,
                        customerId: booking.customer_id || booking.user_id,
                        items: cart.map(c => ({ label: c.label, amount: c.unitPrice, quantity: c.quantity })),
                        discountAmount: cartDiscount > 0 ? cartDiscount : undefined,
                        note: note || undefined,
                        paymentStatus
                    })
                })

                const data = await response.json()
                if (!response.ok) throw new Error(data.message || data.error || 'Errore nella generazione.')

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
                logAdminAction('create_penalty', 'booking', booking.id, {
                  ...buildBookingContext(booking),
                  amount: cartTotal,
                  status: paymentStatus,
                  paymentMethod,
                  items: cart.map(c => c.label).join(', '),
                  fattura_number: data?.invoice?.numero_fattura,
                })
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
                    const custEmail = currentBookingNexi?.customer_email || booking.booking_details?.customer?.email
                    const custName = currentBookingNexi?.customer_name || booking.customer_name

                    const linkRes = await authFetch('/.netlify/functions/nexi-pay-by-link', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            bookingId: booking.id,
                            amount: cartTotal,
                            customerEmail: custEmail || '',
                            customerName: custName || 'Cliente',
                            description: `Penali — ${custName}`,
                            expirationHours: 1,
                            paymentPurpose: 'penali',
                        }),
                    })
                    const linkData = await linkRes.json()

                    if (linkRes.ok && linkData.paymentUrl) {
                        // Nessun messaggio WhatsApp automatico al cliente: la
                        // direzione invia il link manualmente quando vuole.
                        try { await navigator.clipboard.writeText(linkData.paymentUrl) } catch { /* clipboard not available */ }
                        toast.success(`Pay by Link penali creato (€${cartTotal.toFixed(2)}) — copiato negli appunti`)
                    } else {
                        toast.error('Errore creazione Pay by Link: ' + (linkData.error || 'Errore'))
                    }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } catch (linkErr: any) {
                    toast.error('Errore Pay by Link: ' + linkErr.message)
                }
                logAdminAction('create_penalty', 'booking', booking.id, {
                  ...buildBookingContext(booking),
                  amount: cartTotal,
                  status: 'nexi_pay_by_link',
                  items: cart.map(c => c.label).join(', '),
                })
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
                logAdminAction('create_penalty', 'booking', booking.id, {
                  ...buildBookingContext(booking),
                  amount: cartTotal,
                  status: paymentStatus,
                  items: cart.map(c => c.label).join(', '),
                })
            }

            setCart([]); setNote(''); onSuccess(); onClose()
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            console.error('Error generating penalty:', err)
            setError(_errMsg || 'Errore nella generazione.')
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
                    {penaltyList.length === 0 && (
                        <div className="rounded-2xl bg-amber-500/[0.08] border border-amber-500/30 p-4 mb-3 text-[13px] text-amber-300">
                            Nessuna penale configurata per la categoria <strong>{vehicleCategory || 'sconosciuta'}</strong>.
                            Apri <strong>Centralina Pro → Danni &amp; Penali → Penali → tab {vehicleCategory || 'corretto'}</strong> e aggiungi le voci.
                        </div>
                    )}
                    {/* Grouped list — iOS Settings style */}
                    <div className="rounded-2xl overflow-hidden bg-white/[0.04] border border-white/[0.06]">
                        {penaltyList.map((penalty, idx) => {
                            const qty = getCartQty(penalty.id)
                            const isVariable = penalty.amount === 0
                            const isLast = idx === penaltyList.length - 1
                            const isSforo = isSforoRow(penalty)
                            return (
                                <div
                                    key={penalty.id}
                                    className={`flex items-center gap-3 px-4 py-3 ${!isLast ? 'border-b border-white/[0.06]' : ''} ${qty > 0 ? 'bg-dr7-gold/[0.06]' : ''}`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-[13px] leading-tight ${qty > 0 ? 'text-theme-text-primary font-medium' : 'text-theme-text-primary'}`}>
                                            {penalty.label}
                                        </p>
                                        <p className="text-[11px] text-theme-text-muted leading-tight mt-0.5">{penalty.description}</p>
                                    </div>

                                    {isSforo ? (
                                        <>
                                            <span className={`text-[11px] shrink-0 ${qty > 0 ? 'text-dr7-gold' : 'text-theme-text-muted'}`}>
                                                {penalty.amount > 0 ? `€${penalty.amount.toFixed(2)}/km` : '—'}
                                            </span>
                                            <div className="relative shrink-0">
                                                <input
                                                    type="number"
                                                    min={0}
                                                    step={1}
                                                    inputMode="numeric"
                                                    value={qty || ''}
                                                    onChange={e => setSforoKm(penalty, parseInt(e.target.value, 10) || 0)}
                                                    placeholder="0"
                                                    disabled={penalty.amount <= 0}
                                                    className="w-20 pl-2 pr-7 py-1.5 bg-white/[0.06] border border-white/[0.08] rounded-lg text-theme-text-primary text-[13px] text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-dr7-gold/50 disabled:opacity-40"
                                                />
                                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-theme-text-muted pointer-events-none">km</span>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <span className={`text-[13px] font-medium shrink-0 ${qty > 0 ? 'text-dr7-gold' : 'text-theme-text-muted'}`}>
                                                {isVariable ? 'Var.' : `€${penalty.amount % 1 === 0 ? penalty.amount : penalty.amount.toFixed(2)}`}
                                            </span>
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
                                                        className="w-8 h-8 flex items-center justify-center text-dr7-gold hover:text-[#0A8FA3] transition-colors rounded-r-full"
                                                    >
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            )}
                                        </>
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
                                    type="text"
                                    inputMode="decimal"
                                    value={customAmount}
                                    onChange={e => setCustomAmount(sanitizeMoney(e.target.value))}
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
                                                type="text"
                                                inputMode="decimal"
                                                onChange={e => {
                                                    const v = sanitizeMoney(e.target.value)
                                                    e.target.value = v
                                                    updateCartPrice(item.penaltyId, parseFloat(v.replace(',', '.')) || 0)
                                                }}
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

                    {/* Prezzo finale desiderato (sconto auto-calcolato) */}
                    {cart.length > 0 && (
                        <div className="flex items-center gap-2">
                            <label className="text-[12px] text-theme-text-muted shrink-0">Prezzo Finale (€)</label>
                            <div className="relative flex-1">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted text-[12px]">&euro;</span>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={finalPriceInput}
                                    onChange={e => setFinalPriceInput(sanitizeMoney(e.target.value))}
                                    placeholder={`Lascia vuoto per ${cartSubtotal.toFixed(2)}`}
                                    disabled={isGenerating}
                                    className="w-full pl-6 pr-2 py-1.5 bg-white/[0.06] border border-white/[0.08] rounded-lg text-theme-text-primary text-[13px] focus:outline-none focus:ring-1 focus:ring-dr7-gold/50"
                                />
                            </div>
                        </div>
                    )}

                    {/* Subtotale + Sconto */}
                    {hasFinalPrice && (
                        <div className="space-y-0.5">
                            <div className="flex items-center justify-between text-[12px] text-theme-text-muted">
                                <span>Subtotale</span>
                                <span className="tabular-nums">€{cartSubtotal.toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-between text-[12px] text-dr7-gold">
                                <span>Sconto</span>
                                <span className="tabular-nums">-€{cartDiscount.toFixed(2)}</span>
                            </div>
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
                                {paymentMethods.map(pm => (
                                    <option key={pm.key} value={pm.label}>{pm.label}</option>
                                ))}
                                {paymentMethod && !paymentMethods.some(pm => pm.label === paymentMethod) && (
                                    <option value={paymentMethod}>{paymentMethod}</option>
                                )}
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
                            disabled={isGenerating || cart.length === 0 || cartTotal < 10}
                            className="flex-1 py-3 bg-dr7-gold hover:bg-[#0A8FA3] text-white text-[15px] font-semibold rounded-2xl transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                            title={cartTotal > 0 && cartTotal < 10 ? 'Importo minimo: €10.00' : undefined}
                        >
                            {isGenerating ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Generazione...
                                </span>
                            ) : cartTotal > 0 && cartTotal < 10 ? `Minimo €10.00` : `Conferma`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
