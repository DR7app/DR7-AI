import { useState, useRef, useEffect, useMemo } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { logAdminAction } from '../../../utils/logAdminAction'
import { buildBookingContext } from '../../../utils/adminLogHelpers'
import { authFetch } from '../../../utils/authFetch'

interface DanniPenaliModalProps {
    isOpen: boolean
    booking: {
        id: string
        customer_name: string
        customer_id?: string
        user_id?: string
        customer_email?: string
        customer_phone?: string
        vehicle_name?: string
        km_overage_fee?: number
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        booking_details?: any
    }
    onClose: () => void
    onSuccess: () => void
    onEditCustomer?: (customerId: string) => void
    initialTab?: 'danni' | 'penali'
}

interface CartItem {
    id: string
    type: 'danno' | 'penale'
    label: string
    unitPrice: number
    quantity: number
}

interface PenaltyPreset {
    id: string
    label: string
    amount: number
    description: string
}

// Penalty + danno presets are now sourced ONLY from Centralina Pro
// (centralina_pro_config.config.penali / .danni). The previous hardcoded
// SUPERCAR_PENALTIES / URBAN_PENALTIES arrays are removed so a price change
// in Centralina is reflected here without code edits. If a category isn't
// configured, the modal shows an empty-state with a pointer back to
// Centralina Pro.

export default function DanniPenaliModal({ isOpen, booking, onClose, onSuccess, onEditCustomer, initialTab = 'danni' }: DanniPenaliModalProps) {
    const [activeTab, setActiveTab] = useState<'danni' | 'penali'>(initialTab)
    const [cart, setCart] = useState<CartItem[]>([])
    const [note, setNote] = useState('')
    const [paymentStatus, setPaymentStatus] = useState<'pending' | 'paid' | 'nexi_pay_by_link'>('pending')
    const [paymentMethod, setPaymentMethod] = useState('Contanti')
    const [amountPaid, setAmountPaid] = useState('')
    // Final desired price — when set & < subtotal, the difference becomes a
    // "Sconto" line on the fattura while the original items stay intact.
    const [finalPriceInput, setFinalPriceInput] = useState('')
    const [isGenerating, setIsGenerating] = useState(false)
    const [error, setError] = useState('')

    // Danni-specific
    const [dannoLabel, setDannoLabel] = useState('')
    const [dannoAmount, setDannoAmount] = useState('')
    const [photos, setPhotos] = useState<File[]>([])
    const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([])
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Penali-specific
    const [penaleLabel, setPenaleLabel] = useState('')
    const [penaleAmount, setPenaleAmount] = useState('')

    // Per-category penali / danni pulled from Centralina Pro at open time.
    // The modal renders an empty-state when nothing is configured for the
    // booking's vehicle category — single source of truth, no fallback.
    const [penaliFromCfg, setPenaliFromCfg] = useState<Record<string, PenaltyPreset[]> | null>(null)
    const [danniFromCfg, setDanniFromCfg] = useState<Record<string, PenaltyPreset[]> | null>(null)
    // Vehicle category resolved at open time. Bookings often don't carry the
    // category in booking_details, so we look it up via vehicle_id when missing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [resolvedCategory, setResolvedCategory] = useState<string>('')

    useEffect(() => {
        if (!isOpen) return
        let cancelled = false
        ;(async () => {
            // 1. Centralina Pro penali + danni
            try {
                const { data } = await supabase
                    .from('centralina_pro_config')
                    .select('config')
                    .eq('id', 'main')
                    .maybeSingle()
                const cfg = data?.config as { penali?: Record<string, Array<{ id: string; label: string; amount: number; description?: string; enabled?: boolean }>>; danni?: Record<string, Array<{ id: string; label: string; amount: number; description?: string; enabled?: boolean }>> } | undefined
                if (!cancelled && cfg) {
                    const PRO_TO_DB: Record<string, string> = { supercars: 'exotic', urban: 'urban', aziendali: 'aziendali' }
                    const mapList = (raw?: Record<string, Array<{ id: string; label: string; amount: number; description?: string; enabled?: boolean }>>) => {
                        const out: Record<string, PenaltyPreset[]> = {}
                        if (!raw) return out
                        for (const [proCat, items] of Object.entries(raw)) {
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
                        return out
                    }
                    if (cfg.penali) setPenaliFromCfg(mapList(cfg.penali))
                    if (cfg.danni) setDanniFromCfg(mapList(cfg.danni))
                }
            } catch {
                // ignore
            }

            // 2. Resolve vehicle category. Try booking_details first, otherwise
            //    look up the vehicle row via the booking's vehicle_id / plate.
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
                        const { data: v } = await supabase
                            .from('vehicles')
                            .select('category')
                            .eq('id', vid)
                            .maybeSingle()
                        if (v?.category) cat = String(v.category).toLowerCase().trim()
                    }
                    if (!cat && plate) {
                        const { data: v } = await supabase
                            .from('vehicles')
                            .select('category')
                            .eq('plate', plate)
                            .maybeSingle()
                        if (v?.category) cat = String(v.category).toLowerCase().trim()
                    }
                } catch { /* ignore */ }
            }
            if (!cancelled) setResolvedCategory(cat)
        })()
        return () => { cancelled = true }
    }, [isOpen, booking])

    const rawCategory = resolvedCategory ||
        booking.booking_details?.vehicle?.category ||
        booking.booking_details?.vehicleCategory ||
        booking.booking_details?.category || ''
    // Normalise legacy category strings to the keys Centralina Pro uses.
    // exotic/supercar → 'exotic', furgone → 'aziendali', everything else stays.
    const vehicleCategory = (() => {
        const c = String(rawCategory || '').toLowerCase().trim()
        if (c === 'supercar' || c === 'supercars' || c === 'exotic') return 'exotic'
        if (c === 'furgone' || c === 'aziendali' || c === 'furgoni' || c === 'ncc') return 'aziendali'
        if (c === 'urban' || c === 'utilitaria' || c === 'utilitarie') return 'urban'
        return c
    })()
    // Single source of truth: Centralina Pro. No hardcoded fallback.
    // If the admin hasn't configured a list for this category, the modal
    // shows the empty-state below so the operator knows where to fix it.
    //
    // SPECIAL CASE — Km Sforo: when a penalty has id 'km_sforo' (or
    // 'sforo_km' / 'km_eccesso'), its per-km amount is taken from the
    // BOOKING's locked-in rate (booking.km_overage_fee) — what was agreed
    // in the contract at booking time — NOT the current Centralina Pro
    // price. All other penalties continue to read from Centralina.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bookingSforoRate = Number((booking as any).km_overage_fee
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?? (booking as { booking_details?: any }).booking_details?.km_overage_fee
        ?? 0)

    // Match Sforo Km rows liberally — by id OR by label keyword. Admins might
    // have used different ids in Centralina (sforo_kilometri, km_extra, ecc.)
    // so we don't want a strict id whitelist.
    const isSforoRow = (it: { id?: string; label?: string }): boolean => {
        const id = String(it.id || '').toLowerCase()
        const label = String(it.label || '').toLowerCase()
        if (id.includes('sforo') || id.includes('eccesso')) return true
        if (label.includes('sforo')) return true
        if (label.includes('km extra') || label.includes('km eccesso')) return true
        if (label.includes('eccesso km')) return true
        return false
    }

    const penaltyList: PenaltyPreset[] = useMemo(() => {
        const base = penaliFromCfg ? (penaliFromCfg[vehicleCategory] || []) : []
        // Apply Km Sforo override on any matching row in Centralina (uses
        // contract rate, not Pro current). Then inject the synthetic row at
        // the top if Centralina didn't include one, so the operator always
        // has it available without configuring it.
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
    const danniPresetList: PenaltyPreset[] = useMemo(() => {
        if (!danniFromCfg) return []
        return danniFromCfg[vehicleCategory] || []
    }, [danniFromCfg, vehicleCategory])

    if (!isOpen) return null

    const danniItems = cart.filter(c => c.type === 'danno')
    const penaliItems = cart.filter(c => c.type === 'penale')
    const cartSubtotal = cart.reduce((sum, c) => sum + c.unitPrice * c.quantity, 0)
    const cartItemCount = cart.reduce((sum, c) => sum + c.quantity, 0)
    const finalPriceParsed = parseFloat(finalPriceInput)
    const hasFinalPrice = Number.isFinite(finalPriceParsed) && finalPriceParsed > 0 && finalPriceParsed < cartSubtotal
    const cartDiscount = hasFinalPrice ? Math.round((cartSubtotal - finalPriceParsed) * 100) / 100 : 0
    const cartTotal = hasFinalPrice ? finalPriceParsed : cartSubtotal

    // ── Danni helpers ──
    function addDanno() {
        const amt = parseFloat(dannoAmount)
        if (!dannoLabel.trim() || isNaN(amt) || amt <= 0) return
        setCart(prev => [...prev, { id: `danno_${Date.now()}`, type: 'danno', label: dannoLabel.trim(), unitPrice: amt, quantity: 1 }])
        setDannoLabel('')
        setDannoAmount('')
    }

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
            const { error } = await supabase.storage.from('booking-photos').upload(path, file)
            if (!error) {
                const { data: urlData } = supabase.storage.from('booking-photos').getPublicUrl(path)
                if (urlData?.publicUrl) urls.push(urlData.publicUrl)
            }
        }
        return urls
    }

    // ── Penali helpers ──
    function getCartQty(penaltyId: string): number {
        return cart.find(c => c.id === penaltyId)?.quantity || 0
    }

    function addPenaltyPreset(penalty: PenaltyPreset) {
        setCart(prev => {
            const existing = prev.find(c => c.id === penalty.id)
            if (existing) {
                return prev.map(c => c.id === penalty.id ? { ...c, quantity: c.quantity + 1 } : c)
            }
            return [...prev, { id: penalty.id, type: 'penale' as const, label: penalty.label, unitPrice: penalty.amount, quantity: 1 }]
        })
    }

    function removePenaltyPreset(penaltyId: string) {
        setCart(prev => {
            const existing = prev.find(c => c.id === penaltyId)
            if (existing && existing.quantity > 1) {
                return prev.map(c => c.id === penaltyId ? { ...c, quantity: c.quantity - 1 } : c)
            }
            return prev.filter(c => c.id !== penaltyId)
        })
    }

    // Sforo Km row: operator types the kilometers; total = km × contract rate.
    function setSforoKm(penalty: PenaltyPreset, km: number) {
        const safeKm = Number.isFinite(km) && km > 0 ? Math.floor(km) : 0
        setCart(prev => {
            const existing = prev.find(c => c.id === penalty.id)
            if (safeKm <= 0) return prev.filter(c => c.id !== penalty.id)
            if (existing) {
                return prev.map(c => c.id === penalty.id ? { ...c, unitPrice: penalty.amount, quantity: safeKm } : c)
            }
            return [...prev, { id: penalty.id, type: 'penale' as const, label: penalty.label, unitPrice: penalty.amount, quantity: safeKm }]
        })
    }

    // Same +/stepper behaviour as the penalty list, applied to danni presets
    // so the Danni tab matches Penali visually (iOS-Settings list).
    function addDannoPreset(d: PenaltyPreset) {
        const cartId = `danno_${d.id}`
        setCart(prev => {
            const existing = prev.find(c => c.id === cartId)
            if (existing) {
                return prev.map(c => c.id === cartId ? { ...c, quantity: c.quantity + 1 } : c)
            }
            return [...prev, { id: cartId, type: 'danno' as const, label: d.label, unitPrice: d.amount, quantity: 1 }]
        })
    }
    function removeDannoPreset(d: PenaltyPreset) {
        const cartId = `danno_${d.id}`
        setCart(prev => {
            const existing = prev.find(c => c.id === cartId)
            if (existing && existing.quantity > 1) {
                return prev.map(c => c.id === cartId ? { ...c, quantity: c.quantity - 1 } : c)
            }
            return prev.filter(c => c.id !== cartId)
        })
    }
    function getDannoCartQty(d: PenaltyPreset): number {
        return cart.find(c => c.id === `danno_${d.id}`)?.quantity || 0
    }

    function updateCartPrice(itemId: string, newPrice: number) {
        setCart(prev => prev.map(c => c.id === itemId ? { ...c, unitPrice: newPrice } : c))
    }

    function addCustomPenale() {
        const amt = parseFloat(penaleAmount)
        if (isNaN(amt) || amt <= 0) return
        const label = penaleLabel.trim() || 'Penale personalizzata'
        setCart(prev => [...prev, { id: `penale_${Date.now()}`, type: 'penale', label, unitPrice: amt, quantity: 1 }])
        setPenaleLabel('')
        setPenaleAmount('')
    }

    function removeItem(itemId: string) {
        setCart(prev => prev.filter(c => c.id !== itemId))
    }

    function incrementQty(itemId: string) {
        setCart(prev => prev.map(c => c.id === itemId ? { ...c, quantity: c.quantity + 1 } : c))
    }

    function decrementQty(itemId: string) {
        setCart(prev => {
            const item = prev.find(c => c.id === itemId)
            if (item && item.quantity > 1) return prev.map(c => c.id === itemId ? { ...c, quantity: c.quantity - 1 } : c)
            return prev.filter(c => c.id !== itemId)
        })
    }

    // ── Submit ──
    const handleSubmit = async () => {
        setError('')
        if (cart.length === 0) { setError('Aggiungi almeno un danno o una penale.'); return }
        if (cartTotal <= 0) { setError('Il totale deve essere maggiore di zero.'); return }

        setIsGenerating(true)
        try {
            // Upload photos
            let photoUrls: string[] = []
            if (photos.length > 0) photoUrls = await uploadDanniPhotos()

            // Fetch current booking
            const { data: currentBooking, error: fetchErr } = await supabase
                .from('bookings')
                .select('booking_details, customer_phone, customer_email, customer_name')
                .eq('id', booking.id)
                .single()
            if (fetchErr) throw new Error('Errore nel recupero della prenotazione.')

            const details = currentBooking?.booking_details || {}
            const italyDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
            const paidAmount = amountPaid ? parseFloat(amountPaid) : cartTotal
            const isPartial = paymentStatus === 'paid' && paidAmount < cartTotal

            // Build danni entries
            const existingDanni = details.danni || []
            const newDanniEntries = danniItems.map(c => {
                const itemTotal = Math.round(c.unitPrice * c.quantity * 100) / 100
                let itemPaid = 0
                if (paymentStatus === 'paid') {
                    if (isPartial) {
                        itemPaid = Math.round((itemTotal / cartTotal) * paidAmount * 100) / 100
                    } else {
                        itemPaid = itemTotal
                    }
                }
                return {
                    label: c.label, amount: c.unitPrice, quantity: c.quantity, total: itemTotal,
                    note: note || '', date: italyDate,
                    paymentStatus: isPartial ? 'partial' : paymentStatus,
                    paymentMethod: paymentStatus === 'paid' ? paymentMethod : undefined,
                    amountPaid: itemPaid, photos: photoUrls,
                }
            })

            // Build penalty entries
            const existingPenalties = details.penalties || []
            const newPenaltyEntries = penaliItems.map(c => {
                const itemTotal = Math.round(c.unitPrice * c.quantity * 100) / 100
                let itemPaid = 0
                if (paymentStatus === 'paid') {
                    if (isPartial) {
                        itemPaid = Math.round((itemTotal / cartTotal) * paidAmount * 100) / 100
                    } else {
                        itemPaid = itemTotal
                    }
                }
                return {
                    label: c.label, amount: c.unitPrice, quantity: c.quantity, total: itemTotal,
                    note: note || '', date: italyDate,
                    paymentStatus: isPartial ? 'partial' : paymentStatus,
                    paymentMethod: paymentStatus === 'paid' ? paymentMethod : undefined,
                    amountPaid: itemPaid,
                }
            })

            // Save to booking_details
            const updatedDetails = { ...details }
            if (newDanniEntries.length > 0) updatedDetails.danni = [...existingDanni, ...newDanniEntries]
            if (newPenaltyEntries.length > 0) updatedDetails.penalties = [...existingPenalties, ...newPenaltyEntries]

            const { error: updateErr } = await supabase
                .from('bookings')
                .update({ booking_details: updatedDetails })
                .eq('id', booking.id)
            if (updateErr) throw new Error('Errore nel salvataggio.')

            // Determine what we're saving
            const hasDanni = danniItems.length > 0
            const hasPenali = penaliItems.length > 0
            const purposeLabel = hasDanni && hasPenali ? 'danni/penali' : hasDanni ? 'danni' : 'penali'
            const paymentPurpose = hasDanni && hasPenali ? 'danni_penali' : hasDanni ? 'danni' : 'penali'

            if (paymentStatus === 'paid' && paidAmount < cartTotal) {
                // PARTIAL
                toast.success(`${purposeLabel} registrato (Parziale: €${paidAmount.toFixed(2)} / €${cartTotal.toFixed(2)})`)
                logAdminAction('create_danni_penali', 'booking', booking.id, {
                  ...buildBookingContext(booking),
                  amount: cartTotal,
                  amountPaid: paidAmount,
                  status: 'partial',
                  tipo: purposeLabel,
                })
            } else if (paymentStatus === 'paid') {
                // FULLY PAID → fattura
                const allItems = [
                    ...danniItems.map(c => ({ label: c.label, amount: c.unitPrice, quantity: c.quantity })),
                    ...penaliItems.map(c => ({ label: c.label, amount: c.unitPrice, quantity: c.quantity })),
                ]
                const response = await authFetch('/.netlify/functions/generate-penalty-invoice', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        bookingId: booking.id,
                        customerId: booking.customer_id || booking.user_id,
                        items: allItems,
                        discountAmount: cartDiscount > 0 ? cartDiscount : undefined,
                        note: note || undefined,
                        type: paymentPurpose,
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
                toast.success(`Fattura ${purposeLabel} generata! N. ${data.invoice?.numero_fattura || 'N/A'} — €${cartTotal.toFixed(2)}`)
                logAdminAction('create_danni_penali', 'booking', booking.id, {
                  ...buildBookingContext(booking),
                  amount: cartTotal,
                  status: paymentStatus,
                  paymentMethod,
                  tipo: purposeLabel,
                  fattura_number: data?.invoice?.numero_fattura,
                })
            } else if (paymentStatus === 'nexi_pay_by_link') {
                // NEXI PAY BY LINK — one combined link
                try {
                    const custPhone = currentBooking?.customer_phone || booking.customer_phone || booking.booking_details?.customer?.phone
                    const custEmail = currentBooking?.customer_email || booking.customer_email || booking.booking_details?.customer?.email
                    const custName = currentBooking?.customer_name || booking.customer_name

                    const linkRes = await authFetch('/.netlify/functions/nexi-pay-by-link', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            bookingId: booking.id,
                            amount: cartTotal,
                            customerEmail: custEmail || '',
                            customerName: custName || 'Cliente',
                            description: `${purposeLabel.charAt(0).toUpperCase() + purposeLabel.slice(1)} — ${custName}`,
                            expirationHours: 1,
                            paymentPurpose,
                        }),
                    })
                    const linkData = await linkRes.json()

                    if (linkRes.ok && linkData.paymentUrl) {
                        const bookingRef = (booking.id || '').substring(0, 8).toUpperCase() || 'N/A'
                        if (custPhone) {
                            const sendRes = await fetch('/.netlify/functions/send-whatsapp-notification', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    customPhone: custPhone,
                                    templateKey: 'pro_richiesta_danni_penali',
                                    templateVars: (() => {
                                        const customerName = custName || 'Cliente'
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
                        try { await navigator.clipboard.writeText(linkData.paymentUrl) } catch { /* clipboard not available */ }
                        toast.success(`Pay by Link ${purposeLabel} inviato! €${cartTotal.toFixed(2)}`)
                    } else {
                        toast.error('Errore creazione Pay by Link: ' + (linkData.error || 'Errore'))
                    }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } catch (linkErr: any) {
                    toast.error('Errore Pay by Link: ' + linkErr.message)
                }
                logAdminAction('create_danni_penali', 'booking', booking.id, {
                  ...buildBookingContext(booking),
                  amount: cartTotal,
                  status: 'nexi_pay_by_link',
                  tipo: purposeLabel,
                })
            } else {
                // DA SALDARE
                toast.success(`${purposeLabel} registrato (Da Saldare) — €${cartTotal.toFixed(2)}`)
                logAdminAction('create_danni_penali', 'booking', booking.id, {
                  ...buildBookingContext(booking),
                  amount: cartTotal,
                  status: paymentStatus,
                  tipo: purposeLabel,
                })
            }

            resetAndClose()
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            console.error('Error generating danni/penali:', err)
            setError(_errMsg || 'Errore nella generazione.')
        } finally {
            setIsGenerating(false)
        }
    }

    function resetAndClose() {
        setCart([]); setNote(''); setPhotos([]); setPhotoPreviewUrls([])
        setDannoLabel(''); setDannoAmount(''); setPenaleLabel(''); setPenaleAmount('')
        setPaymentStatus('pending'); setPaymentMethod('Contanti'); setAmountPaid('')
        setError(''); setActiveTab(initialTab)
        onSuccess(); onClose()
    }

    const handleClose = () => {
        if (isGenerating) return
        setCart([]); setNote(''); setPhotos([]); setPhotoPreviewUrls([])
        setDannoLabel(''); setDannoAmount(''); setPenaleLabel(''); setPenaleAmount('')
        setPaymentStatus('pending'); setPaymentMethod('Contanti'); setAmountPaid('')
        setError(''); setActiveTab(initialTab)
        onClose()
    }

    const isCustomerDataError = error.includes('incomplete') || error.includes('obbligatorio')

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={handleClose}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            <div
                className="relative w-full sm:max-w-lg max-h-[92vh] flex flex-col bg-theme-bg-secondary/95 backdrop-blur-xl rounded-t-3xl sm:rounded-3xl shadow-2xl border border-white/10 overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Drag handle (mobile) */}
                <div className="sm:hidden flex justify-center pt-3 pb-1">
                    <div className="w-10 h-1 rounded-full bg-white/20" />
                </div>

                {/* Header */}
                <div className="px-6 pt-4 sm:pt-6 pb-2">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-theme-text-primary tracking-tight">Danni & Penali</h2>
                            <p className="text-[13px] text-theme-text-muted mt-0.5">{booking.customer_name}</p>
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

                    {/* Tabs */}
                    <div className="flex mt-3 rounded-xl bg-white/[0.04] border border-white/[0.06] p-1">
                        <button
                            onClick={() => setActiveTab('danni')}
                            className={`flex-1 py-2 text-[13px] font-medium rounded-lg transition-all ${activeTab === 'danni' ? 'bg-red-500/20 text-red-400' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                        >
                            Danni {danniItems.length > 0 && `(${danniItems.length})`}
                        </button>
                        <button
                            onClick={() => setActiveTab('penali')}
                            className={`flex-1 py-2 text-[13px] font-medium rounded-lg transition-all ${activeTab === 'penali' ? 'bg-dr7-gold/20 text-dr7-gold' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                        >
                            Penali {penaliItems.length > 0 && `(${penaliItems.length})`}
                        </button>
                    </div>
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto px-4 pb-4">
                    {activeTab === 'danni' ? (
                        <>
                            {/* Preset danni from Centralina Pro — iOS Settings
                                style list, same shape as the Penali tab. */}
                            {danniPresetList.length === 0 && (
                                <div className="rounded-2xl bg-amber-500/[0.08] border border-amber-500/30 p-4 mb-3 text-[13px] text-amber-300">
                                    Nessun danno configurato per la categoria <strong>{vehicleCategory || 'sconosciuta'}</strong>.
                                    Apri <strong>Centralina Pro → Danni &amp; Penali → Danni → tab {vehicleCategory || 'corretto'}</strong> e aggiungi le voci.
                                </div>
                            )}
                            {danniPresetList.length > 0 && (
                                <div className="rounded-2xl overflow-hidden bg-white/[0.04] border border-white/[0.06] mb-3">
                                    {danniPresetList.map((d, idx) => {
                                        const qty = getDannoCartQty(d)
                                        const isVariable = d.amount === 0
                                        const isLast = idx === danniPresetList.length - 1
                                        return (
                                            <div key={d.id} className={`flex items-center gap-3 px-4 py-3 ${!isLast ? 'border-b border-white/[0.06]' : ''} ${qty > 0 ? 'bg-red-500/[0.06]' : ''}`}>
                                                <div className="flex-1 min-w-0">
                                                    <p className={`text-[13px] leading-tight ${qty > 0 ? 'text-theme-text-primary font-medium' : 'text-theme-text-primary'}`}>{d.label}</p>
                                                    <p className="text-[11px] text-theme-text-muted leading-tight mt-0.5">{d.description}</p>
                                                </div>
                                                <span className={`text-[13px] font-medium shrink-0 ${qty > 0 ? 'text-red-400' : 'text-theme-text-muted'}`}>
                                                    {isVariable ? 'Var.' : `€${d.amount % 1 === 0 ? d.amount : d.amount.toFixed(2)}`}
                                                </span>
                                                {qty === 0 ? (
                                                    <button type="button" onClick={() => addDannoPreset(d)} className="w-7 h-7 rounded-full bg-red-500/15 text-red-400 hover:bg-red-500/25 flex items-center justify-center transition-all shrink-0">
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                                                    </button>
                                                ) : (
                                                    <div className="flex items-center rounded-full bg-white/[0.06] border border-white/[0.08] shrink-0">
                                                        <button type="button" onClick={() => removeDannoPreset(d)} className="w-8 h-8 flex items-center justify-center text-theme-text-muted hover:text-red-400 transition-colors rounded-l-full">
                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" d="M5 12h14" /></svg>
                                                        </button>
                                                        <span className="w-7 text-center text-[13px] font-semibold text-theme-text-primary tabular-nums">{qty}</span>
                                                        <button type="button" onClick={() => addDannoPreset(d)} className="w-8 h-8 flex items-center justify-center text-red-400 hover:text-red-300 transition-colors rounded-r-full">
                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}

                            {/* Add danno */}
                            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4">
                                <p className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-widest mb-3">Aggiungi danno personalizzato</p>
                                <div className="space-y-2">
                                    <input
                                        type="text" value={dannoLabel} onChange={e => setDannoLabel(e.target.value)}
                                        placeholder="Descrizione danno"
                                        className="w-full px-3 py-2 bg-white/[0.06] border border-white/[0.08] rounded-xl text-theme-text-primary text-[13px] placeholder-theme-text-muted/50 focus:outline-none focus:ring-1 focus:ring-red-500/50"
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDanno() } }}
                                    />
                                    <div className="flex gap-2 items-center">
                                        <div className="relative flex-1">
                                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted text-[13px]">&euro;</span>
                                            <input
                                                type="number" step="0.01" min="0" value={dannoAmount}
                                                onChange={e => setDannoAmount(e.target.value)}
                                                placeholder="Importo"
                                                className="w-full pl-7 pr-2 py-2 bg-white/[0.06] border border-white/[0.08] rounded-xl text-theme-text-primary text-[13px] placeholder-theme-text-muted/50 focus:outline-none focus:ring-1 focus:ring-red-500/50"
                                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDanno() } }}
                                            />
                                        </div>
                                        <button type="button" onClick={addDanno}
                                            disabled={!dannoLabel.trim() || !dannoAmount || parseFloat(dannoAmount) <= 0}
                                            className="w-9 h-9 rounded-full bg-red-500/15 text-red-400 hover:bg-red-500/25 flex items-center justify-center transition-all disabled:opacity-20 disabled:cursor-not-allowed shrink-0"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Danni in cart */}
                            {danniItems.length > 0 && (
                                <div className="mt-3 rounded-2xl overflow-hidden bg-white/[0.04] border border-white/[0.06]">
                                    {danniItems.map((item, idx) => (
                                        <div key={item.id} className={`flex items-center gap-3 px-4 py-3 ${idx < danniItems.length - 1 ? 'border-b border-white/[0.06]' : ''} bg-red-500/[0.06]`}>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[13px] leading-tight text-theme-text-primary font-medium">{item.label}</p>
                                                <p className="text-[11px] text-theme-text-muted leading-tight mt-0.5">
                                                    €{item.unitPrice % 1 === 0 ? item.unitPrice : item.unitPrice.toFixed(2)}
                                                    {item.quantity > 1 && ` × ${item.quantity}`}
                                                </p>
                                            </div>
                                            <span className="font-semibold text-red-400 shrink-0 tabular-nums text-[13px]">
                                                €{(item.unitPrice * item.quantity).toFixed(2)}
                                            </span>
                                            <div className="flex items-center rounded-full bg-white/[0.06] border border-white/[0.08] shrink-0">
                                                <button type="button" onClick={() => decrementQty(item.id)} className="w-7 h-7 flex items-center justify-center text-theme-text-muted hover:text-red-400 transition-colors rounded-l-full">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" d="M5 12h14" /></svg>
                                                </button>
                                                <span className="w-5 text-center text-[12px] font-semibold text-theme-text-primary tabular-nums">{item.quantity}</span>
                                                <button type="button" onClick={() => incrementQty(item.id)} className="w-7 h-7 flex items-center justify-center text-red-400 hover:text-red-300 transition-colors rounded-r-full">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                                                </button>
                                            </div>
                                            <button type="button" onClick={() => removeItem(item.id)} className="w-5 h-5 rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 flex items-center justify-center transition-all shrink-0">
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                            </button>
                                        </div>
                                    ))}
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
                                    <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePhotoSelect} className="hidden" disabled={isGenerating} />
                                </label>
                                {photoPreviewUrls.length > 0 && (
                                    <div className="flex gap-2 mt-2 flex-wrap">
                                        {photoPreviewUrls.map((url, i) => (
                                            <div key={i} className="relative group">
                                                <img src={url} alt={`Foto ${i + 1}`} className="w-16 h-16 object-cover rounded-lg border border-white/10" />
                                                <button type="button" onClick={() => removePhoto(i)} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">X</button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Preset penalties — empty state when nothing
                                configured for this vehicle's category. */}
                            {penaltyList.length === 0 && (
                                <div className="rounded-2xl bg-amber-500/[0.08] border border-amber-500/30 p-4 mb-3 text-[13px] text-amber-300">
                                    Nessuna penale configurata per la categoria <strong>{vehicleCategory || 'sconosciuta'}</strong>.
                                    Apri <strong>Centralina Pro → Danni &amp; Penali → Penali → tab {vehicleCategory || 'corretto'}</strong> e aggiungi le voci.
                                </div>
                            )}
                            <div className="rounded-2xl overflow-hidden bg-white/[0.04] border border-white/[0.06]">
                                {penaltyList.map((penalty, idx) => {
                                    const qty = getCartQty(penalty.id)
                                    const isVariable = penalty.amount === 0
                                    const isLast = idx === penaltyList.length - 1
                                    const isSforo = isSforoRow(penalty)
                                    return (
                                        <div key={penalty.id} className={`flex items-center gap-3 px-4 py-3 ${!isLast ? 'border-b border-white/[0.06]' : ''} ${qty > 0 ? 'bg-dr7-gold/[0.06]' : ''}`}>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-[13px] leading-tight ${qty > 0 ? 'text-theme-text-primary font-medium' : 'text-theme-text-primary'}`}>{penalty.label}</p>
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
                                                        <button type="button" onClick={() => addPenaltyPreset(penalty)} className="w-7 h-7 rounded-full bg-dr7-gold/15 text-dr7-gold hover:bg-dr7-gold/25 flex items-center justify-center transition-all shrink-0">
                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                                                        </button>
                                                    ) : (
                                                        <div className="flex items-center rounded-full bg-white/[0.06] border border-white/[0.08] shrink-0">
                                                            <button type="button" onClick={() => removePenaltyPreset(penalty.id)} className="w-8 h-8 flex items-center justify-center text-theme-text-muted hover:text-red-400 transition-colors rounded-l-full">
                                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" d="M5 12h14" /></svg>
                                                            </button>
                                                            <span className="w-7 text-center text-[13px] font-semibold text-theme-text-primary tabular-nums">{qty}</span>
                                                            <button type="button" onClick={() => addPenaltyPreset(penalty)} className="w-8 h-8 flex items-center justify-center text-dr7-gold hover:text-[#247a6f] transition-colors rounded-r-full">
                                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
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
                                    <input type="text" value={penaleLabel} onChange={e => setPenaleLabel(e.target.value)} placeholder="Descrizione"
                                        className="flex-1 px-3 py-2 bg-white/[0.06] border border-white/[0.08] rounded-xl text-theme-text-primary text-[13px] placeholder-theme-text-muted/50 focus:outline-none focus:ring-1 focus:ring-dr7-gold/50"
                                    />
                                    <div className="relative w-20">
                                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted text-[13px]">&euro;</span>
                                        <input type="number" step="0.01" min="0" value={penaleAmount} onChange={e => setPenaleAmount(e.target.value)} placeholder="0"
                                            className="w-full pl-7 pr-2 py-2 bg-white/[0.06] border border-white/[0.08] rounded-xl text-theme-text-primary text-[13px] text-right placeholder-theme-text-muted/50 focus:outline-none focus:ring-1 focus:ring-dr7-gold/50"
                                        />
                                    </div>
                                    <button type="button" onClick={addCustomPenale}
                                        disabled={!penaleAmount || parseFloat(penaleAmount) <= 0}
                                        className="w-9 h-9 rounded-full bg-dr7-gold/15 text-dr7-gold hover:bg-dr7-gold/25 flex items-center justify-center transition-all disabled:opacity-20 disabled:cursor-not-allowed shrink-0"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                                    </button>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Note */}
                    <div className="mt-3 rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4">
                        <p className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-widest mb-2">Note interne</p>
                        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                            className="w-full px-3 py-2 bg-white/[0.06] border border-white/[0.08] rounded-xl text-theme-text-primary text-[13px] placeholder-theme-text-muted/50 focus:outline-none focus:ring-1 focus:ring-dr7-gold/50 resize-none"
                            placeholder="Opzionale..." disabled={isGenerating}
                        />
                    </div>
                </div>

                {/* Bottom: combined cart summary + payment + CTA */}
                <div className="border-t border-white/[0.08] bg-theme-bg-secondary/98 backdrop-blur-xl px-6 py-4 space-y-3 shrink-0">
                    {/* Combined cart summary */}
                    {cart.length > 0 && (
                        <div className="space-y-1.5 max-h-28 overflow-y-auto">
                            {cart.map(item => (
                                <div key={item.id} className="flex items-center gap-2 text-[13px]">
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.type === 'danno' ? 'bg-red-400' : 'bg-dr7-gold'}`} />
                                    <span className="flex-1 text-theme-text-primary truncate">{item.label}</span>
                                    {item.unitPrice === 0 ? (
                                        <div className="relative w-16 shrink-0">
                                            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-theme-text-muted text-[11px]">&euro;</span>
                                            <input type="number" step="0.01" min="0"
                                                onChange={e => updateCartPrice(item.id, parseFloat(e.target.value) || 0)}
                                                placeholder="0"
                                                className="w-full pl-5 pr-1 py-0.5 bg-white/[0.06] border border-dr7-gold/30 rounded-lg text-theme-text-primary text-[11px] text-right focus:outline-none focus:ring-1 focus:ring-dr7-gold/50"
                                            />
                                        </div>
                                    ) : (
                                        <span className="text-theme-text-muted text-[11px] shrink-0">
                                            {item.quantity > 1 && `${item.quantity} × €${item.unitPrice % 1 === 0 ? item.unitPrice : item.unitPrice.toFixed(2)}`}
                                        </span>
                                    )}
                                    <span className={`font-semibold shrink-0 w-14 text-right tabular-nums ${item.type === 'danno' ? 'text-red-400' : 'text-dr7-gold'}`}>
                                        €{(item.unitPrice * item.quantity).toFixed(2)}
                                    </span>
                                    <button type="button" onClick={() => removeItem(item.id)} className="w-5 h-5 rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 flex items-center justify-center transition-all shrink-0">
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
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
                                    type="number"
                                    step="0.01"
                                    min={0}
                                    value={finalPriceInput}
                                    onChange={e => setFinalPriceInput(e.target.value)}
                                    placeholder={`Lascia vuoto per ${cartSubtotal.toFixed(2)}`}
                                    disabled={isGenerating}
                                    className="w-full pl-6 pr-2 py-1.5 bg-white/[0.06] border border-white/[0.08] rounded-lg text-theme-text-primary text-[13px] focus:outline-none focus:ring-1 focus:ring-dr7-gold/50"
                                />
                            </div>
                        </div>
                    )}

                    {/* Subtotale + Sconto (visibili solo se applicato) */}
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
                            {cart.length === 0 ? 'Nessuna voce' : `${cartItemCount} ${cartItemCount === 1 ? 'voce' : 'voci'}${danniItems.length > 0 && penaliItems.length > 0 ? ` (${danniItems.length}D + ${penaliItems.length}P)` : ''}`}
                        </span>
                        <span className="text-2xl font-bold text-theme-text-primary tracking-tight tabular-nums">
                            €{cartTotal % 1 === 0 ? cartTotal : cartTotal.toFixed(2)}
                        </span>
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 space-y-2">
                            <p className="text-red-400 text-[13px]">{error}</p>
                            {isCustomerDataError && onEditCustomer && (
                                <button type="button"
                                    onClick={async () => {
                                        let cid = booking.customer_id || booking.user_id
                                        if (!cid && booking.customer_email) {
                                            const { data } = await supabase.from('customers_extended').select('id').eq('email', booking.customer_email).maybeSingle()
                                            if (data?.id) cid = data.id
                                        }
                                        if (cid && onEditCustomer) { onEditCustomer(cid); handleClose() }
                                        else toast.error('Cliente non trovato.')
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
                        <select value={paymentStatus}
                            onChange={e => { setPaymentStatus(e.target.value as typeof paymentStatus); if (e.target.value !== 'paid') setAmountPaid('') }}
                            disabled={isGenerating}
                            className="flex-1 px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-xl text-theme-text-primary text-[13px] focus:outline-none focus:ring-1 focus:ring-dr7-gold/50"
                        >
                            <option value="pending" className="bg-theme-bg-secondary text-theme-text-primary">Da Saldare</option>
                            <option value="nexi_pay_by_link" className="bg-theme-bg-secondary text-theme-text-primary">Nexi Pay by Link</option>
                            <option value="paid" className="bg-theme-bg-secondary text-theme-text-primary">Pagato</option>
                        </select>
                    </div>

                    {/* Payment method */}
                    {paymentStatus === 'paid' && (
                        <>
                            <div className="flex items-center gap-3">
                                <span className="text-[13px] text-theme-text-muted">Metodo</span>
                                <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} disabled={isGenerating}
                                    className="flex-1 px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-xl text-theme-text-primary text-[13px] focus:outline-none focus:ring-1 focus:ring-dr7-gold/50"
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
                            <div className="flex items-center gap-3">
                                <span className="text-[13px] text-theme-text-muted">Importo pagato (€)</span>
                                <input type="number" step="0.01" value={amountPaid} onChange={e => setAmountPaid(e.target.value)}
                                    placeholder={cartTotal.toFixed(2)} disabled={isGenerating}
                                    className="flex-1 px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-xl text-theme-text-primary text-[13px] focus:outline-none focus:ring-1 focus:ring-dr7-gold/50 placeholder-theme-text-muted/50"
                                />
                            </div>
                        </>
                    )}

                    {/* CTA */}
                    <div className="flex gap-3 pt-1">
                        <button type="button" onClick={handleClose} disabled={isGenerating}
                            className="flex-1 py-3 bg-white/[0.08] hover:bg-white/[0.12] text-theme-text-primary text-[15px] font-medium rounded-2xl transition-all disabled:opacity-50"
                        >
                            Annulla
                        </button>
                        <button type="button" onClick={handleSubmit} disabled={isGenerating || cart.length === 0 || cartTotal < 10}
                            className="flex-1 py-3 bg-gradient-to-r from-red-500 to-dr7-gold hover:from-red-600 hover:to-[#247a6f] text-white text-[15px] font-semibold rounded-2xl transition-all disabled:opacity-30 disabled:cursor-not-allowed"
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
                            ) : cartTotal > 0 && cartTotal < 10 ? 'Minimo €10.00' : 'Conferma'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
