import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'
import { logAdminAction } from '../../../utils/logAdminAction'
import { logger } from '../../../utils/logger'
import { authFetch } from '../../../utils/authFetch'

// ── Types ─────────────────────────────────────────────────────────────────────

interface UnpaidBooking {
  id: string
  service_type: 'rental' | 'car_wash' | 'mechanical_service'
  customer_name: string
  customer_email: string
  customer_phone: string
  customer_id?: string
  user_id?: string
  customer_codice_fiscale?: string
  customer_indirizzo?: string
  customer_numero_civico?: string
  customer_citta?: string
  customer_cap?: string
  customer_provincia?: string
  service_name?: string
  vehicle_name?: string
  vehicle_plate?: string
  appointment_date?: string
  appointment_time?: string
  pickup_date?: string
  dropoff_date?: string
  price_total: number
  status: string
  payment_status: string
  payment_method?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking_details?: any
  created_at: string
}

interface FatturaItem {
  fatturaId: string
  fatturaNumero: string
  bookingId: string
  description: string
  total: number
  amountPaid: number
  paymentStatus: string
  type: 'penalties' | 'danni'
  itemIndex: number
}

interface PendingItem {
  bookingId: string
  booking: UnpaidBooking
  label: string
  amount: number         // EUR total
  amountPaid: number     // EUR paid
  remaining: number      // EUR remaining
  paymentStatus: string
  source: 'booking_details' | 'fattura'
  fatturaId?: string
  fatturaNumero?: string
  itemIndex?: number
  type: 'penalties' | 'danni'
  originalIndex: number
}

interface CustomerGroup {
  customerKey: string
  customerName: string
  customerEmail: string
  customerPhone: string
  noleggioBookings: UnpaidBooking[]
  primeWashBookings: UnpaidBooking[]
  penaliItems: PendingItem[]
  danniItems: PendingItem[]
  totalRemaining: number  // in cents
  chargedViaMit: number   // cents already collected via addebito MIT
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function UnpaidBookingsTab() {
  const [bookings, setBookings] = useState<UnpaidBooking[]>([])
  const [fatturaItemsMap, setFatturaItemsMap] = useState<Record<string, FatturaItem[]>>({})
  const [mitChargedMap, setMitChargedMap] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [filterService, setFilterService] = useState<'all' | 'rental' | 'prime_wash'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [partialPayItemKey, setPartialPayItemKey] = useState<string | null>(null)
  const [partialPayValue, setPartialPayValue] = useState('')
  const [editAmountKey, setEditAmountKey] = useState<string | null>(null)
  const [editAmountValue, setEditAmountValue] = useState('')
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set())
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'amount' | 'name'>('amount')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [processingKey, setProcessingKey] = useState<string | null>(null)

  // Addebito state
  const [showAddebitoModal, setShowAddebitoModal] = useState(false)
  const [addebitoGroup, setAddebitoGroup] = useState<CustomerGroup | null>(null)
  const [addebitoContractId, setAddebitoContractId] = useState<string | null>(null)
  const [addebitoDanniPhotos, setAddebitoDanniPhotos] = useState<string[]>([])
  const [addebitoSending, setAddebitoSending] = useState(false)
  const [addebitoItemAmount, setAddebitoItemAmount] = useState<number | null>(null) // cents, null = full group
  const [addebitoItemLabel, setAddebitoItemLabel] = useState<string | null>(null)
  const [addebitoCarryForward, setAddebitoCarryForward] = useState<number>(0) // cents carry-forward from other unpaid items

  // Partial link state
  const [partialLinkKey, setPartialLinkKey] = useState<string | null>(null)
  const [partialLinkValue, setPartialLinkValue] = useState('')

  useEffect(() => {
    loadUnpaidBookings()

    const subscription = supabase
      .channel('unpaid-bookings-updates')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        () => loadUnpaidBookings()
      )
      .subscribe()

    return () => { subscription.unsubscribe() }
  }, [])

  // ── Addebito ──────────────────────────────────────────────────────────

  async function openAddebitoNexi(group: CustomerGroup, itemAmountCents?: number, itemLabel?: string) {
    setAddebitoGroup(group)
    setAddebitoSending(false)
    setAddebitoContractId(null)
    setAddebitoDanniPhotos([])

    // Calculate carry-forward: remaining from OTHER items when charging a single item
    let carryForward = 0
    if (itemAmountCents != null) {
      // totalRemaining includes ALL items; subtract this item to get carry-forward
      carryForward = Math.max(0, group.totalRemaining - itemAmountCents)
    }
    setAddebitoCarryForward(carryForward)
    // Total charge = item amount + carry-forward from other unpaid items
    setAddebitoItemAmount(itemAmountCents != null ? itemAmountCents + carryForward : null)
    setAddebitoItemLabel(itemLabel ?? null)
    setShowAddebitoModal(true)

    // Collect danni photos from all bookings in the group
    const allPhotos: string[] = []
    const allBookings = [...group.noleggioBookings, ...group.primeWashBookings]
    for (const b of allBookings) {
      const danni = b.booking_details?.danni || []
      for (const d of danni) {
        if (d.photos && Array.isArray(d.photos)) {
          allPhotos.push(...d.photos)
        }
      }
    }
    setAddebitoDanniPhotos(allPhotos)

    // Lookup contract_id: 1) customer metadata, 2) nexi_transactions by email
    let contractId: string | null = null

    // Try customer metadata first (most reliable — saved on every payment)
    if (group.customerEmail) {
      const { data: cust } = await supabase
        .from('customers_extended')
        .select('metadata')
        .eq('email', group.customerEmail.toLowerCase().trim())
        .maybeSingle()
      if (cust?.metadata?.nexi_contract_id) {
        contractId = cust.metadata.nexi_contract_id
      }
    }

    // Fallback: search nexi_transactions
    if (!contractId) {
      const { data: txs } = await supabase
        .from('nexi_transactions')
        .select('metadata')
        .eq('customer_email', group.customerEmail)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(10)
      contractId = txs?.find(t => t.metadata?.contract_id)?.metadata?.contract_id || null
    }

    // Fallback: check booking_details.nexi_contract_id
    if (!contractId) {
      const allBookings = [...group.noleggioBookings, ...group.primeWashBookings]
      for (const b of allBookings) {
        if (b.booking_details?.nexi_contract_id) {
          contractId = b.booking_details.nexi_contract_id
          break
        }
      }
    }

    setAddebitoContractId(contractId)
    if (!contractId) {
      toast.error('Nessun Contract ID Nexi trovato per questo cliente')
    }
  }

  async function handleAddebitoUnpaid() {
    if (!addebitoGroup) return
    const amountCents = addebitoItemAmount != null ? addebitoItemAmount : addebitoGroup.totalRemaining
    const amount = amountCents / 100
    if (amount <= 0) return
    setAddebitoSending(true)
    try {
      const res = await authFetch('/.netlify/functions/nexi-nuovo-addebito', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: null,
          bookingId: addebitoGroup.noleggioBookings[0]?.id || addebitoGroup.primeWashBookings[0]?.id || null,
          customerName: addebitoGroup.customerName,
          customerEmail: addebitoGroup.customerEmail,
          contractNumber: addebitoGroup.noleggioBookings[0]?.id?.substring(0, 8)?.toUpperCase() || 'N/A',
          amount: amount.toFixed(2),
          causale: addebitoItemLabel ? `${addebitoItemLabel} - ${addebitoGroup.customerName}` : `Saldo dovuto - ${addebitoGroup.customerName}`,
          contractId: addebitoContractId || null,
          recurring: false,
          intervalHours: null,
          photoUrls: addebitoDanniPhotos,
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast.success(data.message || 'Addebito programmato')
        setShowAddebitoModal(false)
      } else {
        toast.error(data.error || 'Errore')
      }
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error('Errore: ' + _errMsg)
    } finally {
      setAddebitoSending(false)
    }
  }

  // ── Data Layer (preserved from original) ──────────────────────────────────

  async function loadUnpaidBookings() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .not('status', 'in', '(cancelled,annullata,completed,completata,deleted)')
        .neq('customer_name', 'Lavaggio Rientro')
        .order('created_at', { ascending: false })

      if (error) throw error

      const { data: fatture } = await supabase
        .from('fatture')
        .select('id, booking_id, numero_fattura, items')

      const fItemsMap: Record<string, FatturaItem[]> = {}
      const bookingIdsWithFatturaItems = new Set<string>()

      for (const f of (fatture || [])) {
        if (!f.items || !Array.isArray(f.items) || !f.booking_id) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        f.items.forEach((fi: any, idx: number) => {
          if (!fi.description) return
          const desc = fi.description as string
          const isDanniPenali = desc.includes('Penale prenotazione') || desc.includes('Danno prenotazione')
          if (!isDanniPenali) return
          if (fi.paymentStatus === 'paid') return

          const total = fi.total || (fi.unit_price || 0) * (fi.quantity || 1)
          const type: 'penalties' | 'danni' = desc.includes('Danno prenotazione') ? 'danni' : 'penalties'
          const item: FatturaItem = {
            fatturaId: f.id,
            fatturaNumero: f.numero_fattura || '',
            bookingId: f.booking_id,
            description: desc,
            total,
            amountPaid: fi.amountPaid || 0,
            paymentStatus: fi.paymentStatus || 'pending',
            type,
            itemIndex: idx,
          }
          if (!fItemsMap[f.booking_id]) fItemsMap[f.booking_id] = []
          fItemsMap[f.booking_id].push(item)
          bookingIdsWithFatturaItems.add(f.booking_id)
        })
      }

      setFatturaItemsMap(fItemsMap)

      // Fetch charged amounts from pending_addebiti
      const { data: addebiti } = await supabase
        .from('pending_addebiti')
        .select('customer_email, charged_amount_cents, amount_cents, status')
        .eq('status', 'charged')

      const mitMap: Record<string, number> = {}
      for (const a of (addebiti || [])) {
        if (a.customer_email) {
          // Use charged_amount_cents if available, otherwise fall back to amount_cents (full charge)
          const charged = a.charged_amount_cents || a.amount_cents || 0
          if (charged > 0) {
            const key = a.customer_email.toLowerCase().trim()
            mitMap[key] = (mitMap[key] || 0) + charged
          }
        }
      }
      setMitChargedMap(mitMap)

      const isPaid = (s: string) => s === 'paid' || s === 'completed' || s === 'succeeded'

      const unpaidBookings = (data || []).filter(booking => {
        if (booking.payment_status === 'pending' || booking.payment_status === 'unpaid') return true

        const extensions = booking.booking_details?.extension_history || []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (extensions.some((ext: any) => ext.payment_status === 'pending' || ext.payment_status === 'partial' || ext.payment_status === 'nexi_pay_by_link')) return true

        const penalties = booking.booking_details?.penalties || []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (penalties.some((p: any) => !p.paymentStatus || p.paymentStatus === 'pending' || p.paymentStatus === 'partial' || p.paymentStatus === 'nexi_pay_by_link')) return true

        const danni = booking.booking_details?.danni || []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (danni.some((d: any) => !d.paymentStatus || d.paymentStatus === 'pending' || d.paymentStatus === 'partial' || d.paymentStatus === 'nexi_pay_by_link')) return true

        // Only keep for fattura items if the booking itself is NOT paid
        if (bookingIdsWithFatturaItems.has(booking.id) && !isPaid(booking.payment_status)) return true

        return false
      })

      setBookings(unpaidBookings)
    } catch (error) {
      console.error('Failed to load unpaid bookings:', error)
    } finally {
      setLoading(false)
    }
  }

  // ── Payment & Delete functions (preserved) ─────────────────────────────────

  async function updatePaymentStatus(bookingId: string, newStatus: string) {
    try {
      const { error } = await supabase
        .from('bookings')
        .update({
          payment_status: newStatus,
          status: newStatus === 'paid' ? 'confirmed' : 'pending',
          updated_at: new Date().toISOString()
        })
        .eq('id', bookingId)

      if (error) throw error
      toast.success('Stato pagamento aggiornato!')
      logAdminAction('mark_paid', 'booking', bookingId, { method: newStatus })

      if (newStatus === 'paid') {
        try {
          // Check if fattura already exists for this booking
          const { data: existingFattura } = await supabase
            .from('fatture')
            .select('id, numero_fattura')
            .eq('booking_id', bookingId)
            .maybeSingle()

          if (existingFattura) {
            toast.success(`Fattura ${existingFattura.numero_fattura} già esistente`)
          } else {
            const invoiceRes = await authFetch('/.netlify/functions/generate-invoice-from-booking', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bookingId, includeIVA: true })
            })
            if (invoiceRes.ok) {
              const invoiceData = await invoiceRes.json()
              toast.success(`Fattura ${invoiceData.invoice?.numero_fattura || ''} generata`)
            }
          }
        } catch (invoiceErr) {
          logger.warn('Auto-invoice generation failed:', invoiceErr)
        }
      }

      loadUnpaidBookings()
    } catch (error: unknown) {
      console.error('Failed to update payment status:', error)
      const _errMsg = error instanceof Error ? error.message : ((error as any)?.message || JSON.stringify(error))
      const errorMessage = _errMsg || JSON.stringify(error)
      toast.error(`Errore: ${errorMessage}`)
    }
  }

  async function removeSinglePenaltyDanno(booking: UnpaidBooking, type: 'penalties' | 'danni', originalIndex: number) {
    try {
      // Re-fetch fresh booking_details to avoid overwriting concurrent changes
      const { data: fresh, error: fetchErr } = await supabase
        .from('bookings')
        .select('booking_details')
        .eq('id', booking.id)
        .single()
      if (fetchErr) throw fetchErr

      const details = fresh?.booking_details || {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr: any[] = [...(details[type] || [])]
      arr.splice(originalIndex, 1)

      const { error } = await supabase
        .from('bookings')
        .update({ booking_details: { ...details, [type]: arr } })
        .eq('id', booking.id)

      if (error) throw error
      toast.success(`${type === 'danni' ? 'Danno' : 'Penale'} rimosso!`)
      setConfirmDeleteKey(null)
      loadUnpaidBookings()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : ((error as any)?.message || JSON.stringify(error))
      console.error('Failed to remove item:', error)
      toast.error('Errore: ' + (_errMsg || JSON.stringify(error)))
    }
  }

  async function updateSinglePenaltyDannoAmount(booking: UnpaidBooking, type: 'penalties' | 'danni', originalIndex: number, newAmount: number) {
    try {
      // Re-fetch fresh booking_details to avoid overwriting concurrent changes
      const { data: fresh, error: fetchErr } = await supabase
        .from('bookings')
        .select('booking_details')
        .eq('id', booking.id)
        .single()
      if (fetchErr) throw fetchErr

      const details = fresh?.booking_details || {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr: any[] = [...(details[type] || [])]
      if (arr[originalIndex]) {
        arr[originalIndex] = { ...arr[originalIndex], total: newAmount, amount: newAmount, quantity: 1 }
      }

      const { error } = await supabase
        .from('bookings')
        .update({ booking_details: { ...details, [type]: arr } })
        .eq('id', booking.id)

      if (error) throw error
      toast.success('Importo aggiornato!')
      setEditAmountKey(null)
      loadUnpaidBookings()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : ((error as any)?.message || JSON.stringify(error))
      console.error('Failed to update amount:', error)
      toast.error('Errore: ' + (_errMsg || JSON.stringify(error)))
    }
  }

  async function deleteSingleExtension(booking: UnpaidBooking, extIndex: number) {
    try {
      const extensions = [...(booking.booking_details?.extension_history || [])]
      const deletedExt = extensions[extIndex]
      if (!deletedExt) return
      extensions.splice(extIndex, 1)

      // Revert dropoff_date: if no extensions remain, use the deleted one's previous_dropoff.
      // If other extensions remain, use the last remaining extension's new_dropoff.
      let revertedDropoff: string | undefined
      let revertedTotal: number | undefined
      if (extensions.length === 0 && deletedExt.previous_dropoff) {
        revertedDropoff = deletedExt.previous_dropoff
        // Subtract extension amount from total
        const extAmount = deletedExt.additional_amount || 0
        const currentTotal = booking.price_total || 0
        revertedTotal = Math.max(0, currentTotal - extAmount)
      } else if (extensions.length > 0) {
        // Last remaining extension's new_dropoff becomes the dropoff_date
        const lastExt = extensions[extensions.length - 1]
        revertedDropoff = lastExt.new_dropoff
        // Subtract only the deleted extension's amount
        const extAmount = deletedExt.additional_amount || 0
        const currentTotal = booking.price_total || 0
        revertedTotal = Math.max(0, currentTotal - extAmount)
      }

      const updatePayload: any = {
        booking_details: { ...booking.booking_details, extension_history: extensions },
      }
      if (revertedDropoff) updatePayload.dropoff_date = revertedDropoff
      if (revertedTotal !== undefined) updatePayload.price_total = revertedTotal

      const { error } = await supabase
        .from('bookings')
        .update(updatePayload)
        .eq('id', booking.id)

      if (error) throw error
      toast.success('Estensione rimossa e date ripristinate!')
      logAdminAction('delete_extension', 'booking', booking.id)
      setConfirmDeleteKey(null)
      loadUnpaidBookings()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : ((error as any)?.message || JSON.stringify(error))
      toast.error('Errore: ' + (_errMsg || JSON.stringify(error)))
    }
  }

  async function markSingleExtensionPaid(booking: UnpaidBooking, extIndex: number) {
    try {
      const extensions = [...(booking.booking_details?.extension_history || [])]
      const ext = extensions[extIndex]
      if (!ext) return

      extensions[extIndex] = { ...ext, payment_status: 'paid' }

      const { error } = await supabase
        .from('bookings')
        .update({ booking_details: { ...booking.booking_details, extension_history: extensions } })
        .eq('id', booking.id)

      if (error) throw error
      toast.success('Estensione segnata come pagata!')
      logAdminAction('mark_extension_paid', 'booking', booking.id, { extension_index: extIndex })

      // Generate fattura for the extension
      const extAmount = ext.additional_amount || 0
      if (extAmount > 0) {
        try {
          const invoiceRes = await authFetch('/.netlify/functions/generate-invoice-from-booking', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId: booking.id, includeIVA: true, extensionAmount: extAmount })
          })
          if (invoiceRes.ok) {
            toast.success('Fattura estensione generata!')
          } else {
            const errData = await invoiceRes.json()
            const errMsg = errData.message || errData.error || 'Errore sconosciuto'
            toast.error(`Fattura estensione non generata: ${errMsg}`, { duration: 8000 })
          }
        } catch (invoiceError) {
          console.error('Failed to generate extension fattura:', invoiceError)
        }
      }

      loadUnpaidBookings()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : ((error as any)?.message || JSON.stringify(error))
      toast.error('Errore: ' + (_errMsg || JSON.stringify(error)))
    }
  }

  async function handleExtensionPartialPayment(booking: UnpaidBooking, extIndex: number, paymentAmount: number) {
    try {
      const extensions = [...(booking.booking_details?.extension_history || [])]
      const ext = extensions[extIndex]
      if (!ext) return

      const total = ext.additional_amount || 0
      const currentPaid = ext.amount_paid || 0
      const newPaid = Math.min(currentPaid + paymentAmount, total)

      extensions[extIndex] = {
        ...ext,
        amount_paid: newPaid,
        payment_status: newPaid >= total ? 'paid' : 'partial'
      }

      const { error } = await supabase
        .from('bookings')
        .update({ booking_details: { ...booking.booking_details, extension_history: extensions } })
        .eq('id', booking.id)

      if (error) throw error
      toast.success('Pagamento parziale estensione registrato!')
      logAdminAction('partial_payment', 'booking', booking.id, { amount: paymentAmount })
      setPartialPayItemKey(null)

      // Generate fattura when fully paid
      if (newPaid >= total && total > 0) {
        try {
          const invoiceRes = await authFetch('/.netlify/functions/generate-invoice-from-booking', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId: booking.id, includeIVA: true, extensionAmount: total })
          })
          if (invoiceRes.ok) {
            toast.success('Fattura estensione generata!')
          } else {
            const errData = await invoiceRes.json()
            const errMsg = errData.message || errData.error || 'Errore sconosciuto'
            toast.error(`Fattura estensione non generata: ${errMsg}`, { duration: 8000 })
          }
        } catch (invoiceError) {
          console.error('Failed to generate extension fattura:', invoiceError)
        }
      }

      loadUnpaidBookings()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : ((error as any)?.message || JSON.stringify(error))
      toast.error('Errore: ' + (_errMsg || JSON.stringify(error)))
    }
  }

  async function deleteSingleBooking(bookingId: string) {
    try {
      const { data: booking } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single()

      if (booking && (booking.payment_status === 'paid' || booking.payment_status === 'completed' || booking.payment_status === 'succeeded')) {
        toast.error('Impossibile eliminare una prenotazione gia pagata!')
        return
      }

      if (booking) {
        try {
          await fetch('/.netlify/functions/delete-calendar-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bookingId: booking.id,
              customerName: booking.customer_name,
              vehicleName: booking.vehicle_name || booking.service_name || 'Servizio'
            }),
          })
        } catch (calError) {
          logger.warn('Failed to delete from Google Calendar:', calError)
        }
      }

      const res = await authFetch('/.netlify/functions/delete-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete booking')
      }

      toast.success('Prenotazione eliminata!')
      logAdminAction('delete_unpaid_booking', 'booking', bookingId)
      setConfirmDeleteKey(null)
      loadUnpaidBookings()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : ((error as any)?.message || JSON.stringify(error))
      console.error('Failed to delete booking:', error)
      toast.error('Errore: ' + (_errMsg || JSON.stringify(error)))
    }
  }

  async function handleFatturaItemPayment(fi: FatturaItem, paymentAmount: number) {
    try {
      const { data: fattura, error: fetchErr } = await supabase
        .from('fatture')
        .select('id, items')
        .eq('id', fi.fatturaId)
        .single()

      if (fetchErr || !fattura) throw fetchErr || new Error('Fattura non trovata')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = Array.isArray(fattura.items) ? [...fattura.items] : []
      if (items[fi.itemIndex]) {
        const existing = items[fi.itemIndex]
        const total = existing.total || (existing.unit_price || 0) * (existing.quantity || 1)
        const newAmountPaid = Math.min((existing.amountPaid || 0) + paymentAmount, total)
        items[fi.itemIndex] = {
          ...existing,
          amountPaid: newAmountPaid,
          paymentStatus: newAmountPaid >= total ? 'paid' : 'partial',
        }
      }

      const { error: updateErr } = await supabase
        .from('fatture')
        .update({ items })
        .eq('id', fi.fatturaId)

      if (updateErr) throw updateErr
      toast.success('Pagamento registrato')
      loadUnpaidBookings()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    }
  }

  async function sendPayByLink(booking: UnpaidBooking, amountEur: number, description: string) {
    try {
      toast.loading('Generazione link...', { id: 'paylink' })
      const res = await authFetch('/.netlify/functions/nexi-pay-by-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          amount: amountEur,
          customerEmail: booking.customer_email || booking.booking_details?.customer?.email || '',
          customerName: booking.customer_name || booking.booking_details?.customer?.fullName || 'Cliente',
          description,
          expirationDays: 7
        })
      })
      const result = await res.json()
      toast.dismiss('paylink')
      if (!res.ok) throw new Error(result.error || 'Errore')
      if (result.paymentUrl) {
        await navigator.clipboard.writeText(result.paymentUrl)
        toast.success('Link copiato!')
        // Send via WhatsApp
        const phone = booking.customer_phone || booking.booking_details?.customer?.phone
        if (phone) {
          await fetch('/.netlify/functions/send-whatsapp-notification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customPhone: phone,
              customMessage: `Gentile ${booking.customer_name || 'Cliente'},\n\nPer completare il pagamento di *€${amountEur.toFixed(2)}* (${description}), clicchi qui:\n${result.paymentUrl}\n\nGrazie,\nDR7`
            })
          })
          toast.success('Link inviato via WhatsApp!')
        }
      }
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.dismiss('paylink')
      toast.error(_errMsg || 'Errore')
    }
  }

  async function markSingleFatturaItemPaid(fi: FatturaItem) {
    try {
      const { data: fattura, error: fetchErr } = await supabase
        .from('fatture').select('id, items').eq('id', fi.fatturaId).single()
      if (fetchErr || !fattura) throw fetchErr || new Error('Fattura non trovata')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = Array.isArray(fattura.items) ? [...fattura.items] : []
      if (items[fi.itemIndex]) {
        const existing = items[fi.itemIndex]
        const total = existing.total || (existing.unit_price || 0) * (existing.quantity || 1)
        items[fi.itemIndex] = { ...existing, amountPaid: total, paymentStatus: 'paid' }
      }

      await supabase.from('fatture').update({ items }).eq('id', fi.fatturaId)
      logAdminAction('mark_fattura_item_paid', 'fattura', fi.fatturaId)
      toast.success('Pagamento registrato')
      loadUnpaidBookings()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    }
  }

  async function markAllTypePaid(booking: UnpaidBooking, type: 'penalties' | 'danni') {
    const key = `type:${booking.id}:${type}`
    if (processingKey) return
    setProcessingKey(key)
    try {
      // Re-fetch fresh booking_details
      const { data: fresh } = await supabase.from('bookings').select('booking_details').eq('id', booking.id).single()
      const details = fresh?.booking_details || booking.booking_details || {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr: any[] = details[type] || []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pending = arr.filter((item: any) => item.paymentStatus !== 'paid')

      // 1. FIRST: Mark items as paid in DB (this must succeed)
      if (pending.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updated = arr.map((item: any) => {
          if (item.paymentStatus !== 'paid') {
            const total = item.total || (item.amount || 0) * (item.quantity || 1)
            return { ...item, paymentStatus: 'paid', amountPaid: total }
          }
          return item
        })
        const { error: updateErr } = await supabase.from('bookings').update({ booking_details: { ...details, [type]: updated } }).eq('id', booking.id)
        if (updateErr) throw updateErr
      }

      // Mark fattura source items as paid
      const fItems = (fatturaItemsMap[booking.id] || []).filter(fi => fi.type === type)
      for (const fi of fItems) {
        await markSingleFatturaItemPaid(fi)
      }

      toast.success(`${type === 'danni' ? 'Danni' : 'Penali'} segnati come pagati`)
      logAdminAction('mark_type_paid', 'booking', booking.id, { type })

      // 2. THEN: Try to generate fattura (non-blocking — payment is already marked)
      if (pending.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoiceItems = pending.map((item: any) => {
          const total = item.total || (item.amount || 0) * (item.quantity || 1)
          const remaining = total - (item.amountPaid || 0)
          return { label: item.label, amount: remaining, quantity: 1 }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }).filter((i: any) => i.amount > 0)

        if (invoiceItems.length > 0) {
          try {
            const res = await authFetch('/.netlify/functions/generate-penalty-invoice', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                bookingId: booking.id,
                customerId: booking.customer_id || booking.user_id,
                items: invoiceItems,
                type: type === 'danni' ? 'danni' : undefined,
                paymentStatus: 'paid'
              })
            })
            if (res.ok) {
              const data = await res.json()
              toast.success(`Fattura ${data.invoice?.numero_fattura || ''} generata`)
            } else {
              const err = await res.json()
              toast.error('Fattura non generata: ' + (err.message || err.error || 'errore'))
            }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (invErr: any) {
            toast.error('Fattura non generata: ' + (invErr.message || 'errore'))
          }
        }
      }

      loadUnpaidBookings()
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _errMsg = err instanceof Error ? err.message : (err as any)?.message || JSON.stringify(err)
      toast.error(_errMsg || 'Errore')
    } finally {
      setProcessingKey(null)
    }
  }

  async function handleTypePartialPayment(booking: UnpaidBooking, type: 'penalties' | 'danni', paymentAmount: number) {
    try {
      let remaining = paymentAmount
      // Re-fetch fresh booking_details
      const { data: fresh } = await supabase.from('bookings').select('booking_details').eq('id', booking.id).single()
      const details = fresh?.booking_details || booking.booking_details || {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr: any[] = [...(details[type] || [])]
      let changed = false
      for (let i = 0; i < arr.length; i++) {
        if (remaining <= 0) break
        const item = arr[i]
        if (item.paymentStatus === 'paid') continue
        if (item.paymentStatus && item.paymentStatus !== 'pending' && item.paymentStatus !== 'partial') continue
        const total = item.total || (item.amount || 0) * (item.quantity || 1)
        const itemRemaining = total - (item.amountPaid || 0)
        const toApply = Math.min(remaining, itemRemaining)
        if (toApply > 0) {
          const newPaid = (item.amountPaid || 0) + toApply
          arr[i] = { ...item, amountPaid: newPaid, paymentStatus: newPaid >= total ? 'paid' : 'partial' }
          remaining -= toApply
          changed = true
        }
      }
      if (changed) {
        await supabase.from('bookings').update({ booking_details: { ...details, [type]: arr } }).eq('id', booking.id)
      }

      if (remaining > 0) {
        const fItems = (fatturaItemsMap[booking.id] || []).filter(fi => fi.type === type)
        for (const fi of fItems) {
          if (remaining <= 0) break
          const fiRemaining = fi.total - fi.amountPaid
          const toApply = Math.min(remaining, fiRemaining)
          if (toApply > 0) {
            await handleFatturaItemPayment(fi, toApply)
            remaining -= toApply
          }
        }
      }

      toast.success('Pagamento parziale registrato')
      loadUnpaidBookings()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    }
  }

  async function handleBookingPartialPayment(bookingId: string, amount: number) {
    try {
      const booking = bookings.find(b => b.id === bookingId)
      if (!booking) return

      const details = booking.booking_details || {}
      const currentPaid = details.amountPaid || 0
      const newPaid = currentPaid + Math.round(amount * 100)

      const { error } = await supabase
        .from('bookings')
        .update({
          booking_details: { ...details, amountPaid: newPaid },
          payment_status: newPaid >= booking.price_total ? 'paid' : 'partial'
        })
        .eq('id', bookingId)

      if (error) throw error
      toast.success('Pagamento parziale registrato')
      setPartialPayItemKey(null)
      loadUnpaidBookings()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    }
  }

  async function markAllCustomerItemsPaid(group: CustomerGroup, type: 'penalties' | 'danni') {
    const key = `allitems:${group.customerKey}:${type}`
    if (processingKey) return // Already processing something
    setProcessingKey(key)
    try {
      const items = type === 'penalties' ? group.penaliItems : group.danniItems
      if (items.length === 0) { setProcessingKey(null); return }

      // Collect invoice line items from booking_details source items
      const invoiceLineItems: { label: string; amount: number; quantity: number }[] = []
      const bookingUpdates = new Map<string, { booking: UnpaidBooking; indices: number[] }>()

      for (const item of items) {
        if (item.source === 'booking_details' && item.remaining > 0) {
          invoiceLineItems.push({ label: item.label, amount: item.remaining, quantity: 1 })
          if (!bookingUpdates.has(item.bookingId)) {
            bookingUpdates.set(item.bookingId, { booking: item.booking, indices: [] })
          }
          bookingUpdates.get(item.bookingId)!.indices.push(item.originalIndex)
        }
      }

      // 1. FIRST: Mark all booking_details items as paid in DB
      for (const [bookingId, { booking, indices }] of bookingUpdates) {
        const details = booking.booking_details || {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const arr: any[] = [...(details[type] || [])]
        for (const idx of indices) {
          if (arr[idx]) {
            const total = arr[idx].total || (arr[idx].amount || 0) * (arr[idx].quantity || 1)
            arr[idx] = { ...arr[idx], paymentStatus: 'paid', amountPaid: total }
          }
        }
        await supabase.from('bookings').update({ booking_details: { ...details, [type]: arr } }).eq('id', bookingId)
      }

      // Mark all fattura source items as paid
      const fatturaItems = items.filter(i => i.source === 'fattura')
      for (const fItem of fatturaItems) {
        const fi = (fatturaItemsMap[fItem.bookingId] || []).find(f => f.fatturaId === fItem.fatturaId && f.itemIndex === fItem.itemIndex)
        if (fi) await markSingleFatturaItemPaid(fi)
      }

      toast.success(`Tutti ${type === 'danni' ? 'i danni' : 'le penali'} segnati come pagati`)

      // 2. THEN: Try to generate fattura (non-blocking — payment is already marked)
      if (invoiceLineItems.length > 0) {
        const firstItem = items.find(i => i.source === 'booking_details')!
        try {
          const res = await authFetch('/.netlify/functions/generate-penalty-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bookingId: firstItem.bookingId,
              customerId: firstItem.booking.customer_id || firstItem.booking.user_id,
              items: invoiceLineItems,
              type: type === 'danni' ? 'danni' : undefined,
              paymentStatus: 'paid'
            })
          })
          if (res.ok) {
            const data = await res.json()
            toast.success(`Fattura ${data.invoice?.numero_fattura || ''} generata`)
          } else {
            const err = await res.json()
            toast.error('Fattura non generata: ' + (err.message || err.error || 'errore'))
          }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (invErr: any) {
          toast.error('Fattura non generata: ' + (invErr.message || 'errore'))
        }
      }

      loadUnpaidBookings()
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _errMsg = err instanceof Error ? err.message : (err as any)?.message || JSON.stringify(err)
      toast.error(_errMsg || 'Errore')
    } finally {
      setProcessingKey(null)
    }
  }

  async function markBookingAndExtensionsPaid(booking: UnpaidBooking) {
    try {
      const isPending = booking.payment_status === 'pending' || booking.payment_status === 'unpaid' || booking.payment_status === 'partial'
      const vehicle = booking.vehicle_name || booking.booking_details?.vehicle?.name || 'Noleggio'
      const plate = booking.vehicle_plate || booking.booking_details?.vehicle?.plate || ''

      // 1. Collect unpaid line items for fattura
      const invoiceLineItems: { label: string; amount: number; quantity: number }[] = []

      // Add base booking only if it's actually unpaid
      if (isPending) {
        const totalCents = booking.price_total || 0
        const paidCents = booking.booking_details?.amountPaid || 0
        const remainingEur = Math.max(0, (totalCents - paidCents) / 100)
        if (remainingEur > 0) {
          invoiceLineItems.push({
            label: `Noleggio ${vehicle}${plate ? ` (${plate})` : ''}`,
            amount: remainingEur,
            quantity: 1
          })
        }
      }

      // 2. Mark pending extensions as paid and collect their amounts
      const extensions = [...(booking.booking_details?.extension_history || [])]
      for (let i = 0; i < extensions.length; i++) {
        if (extensions[i].payment_status === 'pending' || extensions[i].payment_status === 'partial' || extensions[i].payment_status === 'nexi_pay_by_link') {
          const extTotal = extensions[i].additional_amount || 0
          const extPaid = extensions[i].amount_paid || 0
          const extRemaining = Math.max(0, extTotal - extPaid)
          if (extRemaining > 0) {
            let days = extensions[i].additional_days
            if (!days && extensions[i].previous_dropoff && extensions[i].new_dropoff) {
              const prev = new Date(extensions[i].previous_dropoff)
              const next = new Date(extensions[i].new_dropoff)
              days = Math.round((next.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24))
            }
            invoiceLineItems.push({
              label: `Estensione +${days || '?'}gg ${vehicle}`,
              amount: extRemaining,
              quantity: 1
            })
          }
          extensions[i] = { ...extensions[i], payment_status: 'paid', amount_paid: extensions[i].additional_amount || 0 }
        }
      }

      // 3. Generate fattura FIRST — if it fails, abort before marking as paid
      if (invoiceLineItems.length > 0) {
        const res = await authFetch('/.netlify/functions/generate-penalty-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: booking.id,
            customerId: booking.customer_id || booking.user_id,
            items: invoiceLineItems,
            rawDescriptions: true,
            paymentStatus: 'paid'
          })
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.message || err.error || 'Errore generazione fattura — nessun elemento segnato come pagato.')
        }
        const data = await res.json()
        toast.success(`Fattura ${data.invoice?.numero_fattura || ''} generata!`)
      }

      // 4. Fattura succeeded — NOW update booking in DB
      const { error } = await supabase.from('bookings').update({
        payment_status: 'paid',
        status: 'confirmed',
        booking_details: { ...booking.booking_details, extension_history: extensions }
      }).eq('id', booking.id)
      if (error) throw error
      toast.success('Tutto segnato come pagato!')
      logAdminAction('mark_booking_extensions_paid', 'booking', booking.id)

      loadUnpaidBookings()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    }
  }

  async function markAllCustomerPaid(group: CustomerGroup) {
    const key = `allcustomer:${group.customerKey}`
    if (processingKey) return
    setProcessingKey(key)
    try {
      // Collect ALL line items for ONE combined fattura
      const invoiceLineItems: { label: string; amount: number; quantity: number }[] = []

      // Pick a bookingId to anchor the fattura (first available)
      let anchorBookingId = group.noleggioBookings[0]?.id || group.primeWashBookings[0]?.id || group.penaliItems[0]?.bookingId || group.danniItems[0]?.bookingId
      let anchorCustomerId = ''

      // 1. Noleggio bookings + extensions → collect line items (DO NOT mark paid yet — fattura first)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const noleggioUpdates: { bookingId: string; extensions: any[]; booking: UnpaidBooking }[] = []
      for (const booking of group.noleggioBookings) {
        if (!anchorCustomerId) anchorCustomerId = booking.customer_id || booking.user_id || ''
        if (!anchorBookingId) anchorBookingId = booking.id

        const vehicle = booking.vehicle_name || booking.booking_details?.vehicle?.name || booking.booking_details?.vehicle_name || 'Noleggio'
        const plate = booking.vehicle_plate || booking.booking_details?.vehicle?.plate || booking.booking_details?.vehicle_plate || ''
        const isPending = booking.payment_status === 'pending' || booking.payment_status === 'unpaid' || booking.payment_status === 'partial'

        if (isPending) {
          const totalCents = booking.price_total || 0
          const paidCents = booking.booking_details?.amountPaid || 0
          const remainingEur = Math.max(0, (totalCents - paidCents) / 100)
          if (remainingEur > 0) {
            invoiceLineItems.push({
              label: `Noleggio ${vehicle}${plate ? ` (${plate})` : ''}`,
              amount: remainingEur,
              quantity: 1
            })
          }
        }

        const extensions = [...(booking.booking_details?.extension_history || [])]
        for (let i = 0; i < extensions.length; i++) {
          if (extensions[i].payment_status === 'pending' || extensions[i].payment_status === 'partial' || extensions[i].payment_status === 'nexi_pay_by_link') {
            const extTotal = extensions[i].additional_amount || 0
            const extPaid = extensions[i].amount_paid || 0
            const extRemaining = Math.max(0, extTotal - extPaid)
            if (extRemaining > 0) {
              let days = extensions[i].additional_days
              if (!days && extensions[i].previous_dropoff && extensions[i].new_dropoff) {
                const prev = new Date(extensions[i].previous_dropoff)
                const next = new Date(extensions[i].new_dropoff)
                days = Math.round((next.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24))
              }
              invoiceLineItems.push({
                label: `Estensione +${days || '?'}gg ${vehicle}`,
                amount: extRemaining,
                quantity: 1
              })
            }
            extensions[i] = { ...extensions[i], payment_status: 'paid', amount_paid: extensions[i].additional_amount || 0 }
          }
        }

        noleggioUpdates.push({ bookingId: booking.id, extensions, booking })
      }

      // 2. Prime Wash bookings → collect line items (DO NOT mark paid yet — fattura first)
      const primeWashBookingIds: string[] = []
      for (const booking of group.primeWashBookings) {
        if (!anchorCustomerId) anchorCustomerId = booking.customer_id || booking.user_id || ''
        if (!anchorBookingId) anchorBookingId = booking.id

        const serviceName = booking.service_name || 'Servizio'
        const totalCents = booking.price_total || 0
        const paidCents = booking.booking_details?.amountPaid || 0
        const remainingEur = Math.max(0, (totalCents - paidCents) / 100)
        if (remainingEur > 0) {
          invoiceLineItems.push({ label: serviceName, amount: remainingEur, quantity: 1 })
        }

        primeWashBookingIds.push(booking.id)
      }

      // 3. Penali → collect line items (DO NOT mark paid yet — fattura first)
      const penaliBookingUpdates = new Map<string, { booking: UnpaidBooking; indices: number[] }>()
      for (const item of group.penaliItems) {
        if (!anchorCustomerId) anchorCustomerId = item.booking.customer_id || item.booking.user_id || ''
        if (!anchorBookingId) anchorBookingId = item.bookingId

        if (item.source === 'booking_details' && item.remaining > 0) {
          invoiceLineItems.push({ label: `Penale - ${item.label}`, amount: item.remaining, quantity: 1 })
          if (!penaliBookingUpdates.has(item.bookingId)) {
            penaliBookingUpdates.set(item.bookingId, { booking: item.booking, indices: [] })
          }
          penaliBookingUpdates.get(item.bookingId)!.indices.push(item.originalIndex)
        }
      }

      // 4. Danni → collect line items (DO NOT mark paid yet — fattura first)
      const danniBookingUpdates = new Map<string, { booking: UnpaidBooking; indices: number[] }>()
      for (const item of group.danniItems) {
        if (!anchorCustomerId) anchorCustomerId = item.booking.customer_id || item.booking.user_id || ''
        if (!anchorBookingId) anchorBookingId = item.bookingId

        if (item.source === 'booking_details' && item.remaining > 0) {
          invoiceLineItems.push({ label: `Danno - ${item.label}`, amount: item.remaining, quantity: 1 })
          if (!danniBookingUpdates.has(item.bookingId)) {
            danniBookingUpdates.set(item.bookingId, { booking: item.booking, indices: [] })
          }
          danniBookingUpdates.get(item.bookingId)!.indices.push(item.originalIndex)
        }
      }

      // 5. Generate fattura FIRST — if it fails, abort before marking anything as paid
      if (invoiceLineItems.length > 0 && anchorBookingId) {
        const res = await authFetch('/.netlify/functions/generate-penalty-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: anchorBookingId,
            customerId: anchorCustomerId,
            items: invoiceLineItems,
            rawDescriptions: true,
            paymentStatus: 'paid'
          })
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.message || err.error || 'Errore generazione fattura — nessun elemento segnato come pagato.')
        }
        const data = await res.json()
        toast.success(`Fattura unica ${data.invoice?.numero_fattura || ''} generata per ${group.customerName}!`)
      }

      // 6. Fattura succeeded (or no items) — NOW mark everything as paid in DB
      for (const { bookingId, extensions, booking } of noleggioUpdates) {
        await supabase.from('bookings').update({
          payment_status: 'paid', status: 'confirmed',
          booking_details: { ...booking.booking_details, extension_history: extensions }
        }).eq('id', bookingId)
      }

      for (const pwId of primeWashBookingIds) {
        await supabase.from('bookings').update({
          payment_status: 'paid', status: 'confirmed'
        }).eq('id', pwId)
      }

      for (const [bookingId, { booking, indices }] of penaliBookingUpdates) {
        const details = booking.booking_details || {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const arr: any[] = [...(details.penalties || [])]
        for (const idx of indices) {
          if (arr[idx]) {
            const total = arr[idx].total || (arr[idx].amount || 0) * (arr[idx].quantity || 1)
            arr[idx] = { ...arr[idx], paymentStatus: 'paid', amountPaid: total }
          }
        }
        await supabase.from('bookings').update({ booking_details: { ...details, penalties: arr } }).eq('id', bookingId)
      }

      for (const [bookingId, { booking, indices }] of danniBookingUpdates) {
        const details = booking.booking_details || {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const arr: any[] = [...(details.danni || [])]
        for (const idx of indices) {
          if (arr[idx]) {
            const total = arr[idx].total || (arr[idx].amount || 0) * (arr[idx].quantity || 1)
            arr[idx] = { ...arr[idx], paymentStatus: 'paid', amountPaid: total }
          }
        }
        await supabase.from('bookings').update({ booking_details: { ...details, danni: arr } }).eq('id', bookingId)
      }

      // 7. Mark fattura-source penali/danni items as paid
      const fatturaSourceItems = [...group.penaliItems, ...group.danniItems].filter(i => i.source === 'fattura')
      for (const fItem of fatturaSourceItems) {
        const fi = (fatturaItemsMap[fItem.bookingId] || []).find(f => f.fatturaId === fItem.fatturaId && f.itemIndex === fItem.itemIndex)
        if (fi) await markSingleFatturaItemPaid(fi)
      }

      if (invoiceLineItems.length === 0) {
        toast.success(`Tutto pagato per ${group.customerName}!`)
      }

      logAdminAction('mark_all_customer_paid', 'customer', group.customerKey)
      loadUnpaidBookings()
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _errMsg = err instanceof Error ? err.message : (err as any)?.message || JSON.stringify(err)
      toast.error(_errMsg || 'Errore')
    } finally {
      setProcessingKey(null)
    }
  }

  async function updateBookingAmount(bookingId: string, newAmountEur: number) {
    try {
      const newAmountCents = Math.round(newAmountEur * 100)
      const { error } = await supabase
        .from('bookings')
        .update({ price_total: newAmountCents })
        .eq('id', bookingId)

      if (error) throw error
      toast.success('Importo aggiornato!')
      setEditAmountKey(null)
      loadUnpaidBookings()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    }
  }

  async function deleteFatturaItem(fi: FatturaItem) {
    try {
      const { data: fattura, error: fetchErr } = await supabase
        .from('fatture')
        .select('id, items')
        .eq('id', fi.fatturaId)
        .single()

      if (fetchErr || !fattura) throw fetchErr || new Error('Fattura non trovata')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = Array.isArray(fattura.items) ? [...fattura.items] : []
      items.splice(fi.itemIndex, 1)

      const { error: updateErr } = await supabase
        .from('fatture')
        .update({ items })
        .eq('id', fi.fatturaId)

      if (updateErr) throw updateErr
      toast.success('Elemento fattura eliminato!')
      setConfirmDeleteKey(null)
      loadUnpaidBookings()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    }
  }

  async function updateFatturaItemAmount(fi: FatturaItem, newAmountEur: number) {
    try {
      const { data: fattura, error: fetchErr } = await supabase
        .from('fatture')
        .select('id, items')
        .eq('id', fi.fatturaId)
        .single()

      if (fetchErr || !fattura) throw fetchErr || new Error('Fattura non trovata')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = Array.isArray(fattura.items) ? [...fattura.items] : []
      if (items[fi.itemIndex]) {
        items[fi.itemIndex] = {
          ...items[fi.itemIndex],
          total: newAmountEur,
          unit_price: newAmountEur,
          quantity: 1,
        }
      }

      const { error: updateErr } = await supabase
        .from('fatture')
        .update({ items })
        .eq('id', fi.fatturaId)

      if (updateErr) throw updateErr
      toast.success('Importo fattura aggiornato!')
      setEditAmountKey(null)
      loadUnpaidBookings()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    }
  }

  // ── Helper functions (preserved) ───────────────────────────────────────────

  const getEffectiveType = (booking: UnpaidBooking): 'rental' | 'prime_wash' | 'other' => {
    if (booking.service_type === 'rental') return 'rental'
    if (booking.service_type === 'car_wash' || booking.service_type === 'mechanical_service') return 'prime_wash'
    if (booking.vehicle_name || booking.booking_details?.vehicle) return 'rental'
    if (booking.service_name) {
      const sn = booking.service_name.toLowerCase()
      if (sn.includes('lavaggio') || sn.includes('wash') || sn.includes('meccanica') || sn.includes('mechanical')) return 'prime_wash'
    }
    return 'rental'
  }

  const getRemainingAmount = (booking: UnpaidBooking) => {
    let remaining = 0

    if (booking.payment_status === 'pending' || booking.payment_status === 'unpaid') {
      const total = booking.price_total || 0
      const paid = booking.booking_details?.amountPaid || 0
      remaining += Math.max(0, total - paid)
    } else {
      const extensions = booking.booking_details?.extension_history || []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extensions.forEach((ext: any) => {
        if ((ext.payment_status === 'pending' || ext.payment_status === 'partial' || ext.payment_status === 'nexi_pay_by_link') && ext.additional_amount) {
          const extTotal = ext.additional_amount * 100
          const extPaid = (ext.amount_paid || 0) * 100
          remaining += Math.max(0, extTotal - extPaid)
        }
      })
    }

    const penalties = booking.booking_details?.penalties || []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    penalties.forEach((p: any) => {
      if (!p.paymentStatus || p.paymentStatus === 'pending' || p.paymentStatus === 'partial' || p.paymentStatus === 'nexi_pay_by_link') {
        const total = p.total || (p.amount || 0) * (p.quantity || 1)
        const paid = p.amountPaid || 0
        remaining += Math.round((total - paid) * 100)
      }
    })

    const danni = booking.booking_details?.danni || []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    danni.forEach((d: any) => {
      if (!d.paymentStatus || d.paymentStatus === 'pending' || d.paymentStatus === 'partial' || d.paymentStatus === 'nexi_pay_by_link') {
        const total = d.total || (d.amount || 0) * (d.quantity || 1)
        const paid = d.amountPaid || 0
        remaining += Math.round((total - paid) * 100)
      }
    })

    const fItems = fatturaItemsMap[booking.id] || []
    fItems.forEach(fi => {
      remaining += Math.round((fi.total - fi.amountPaid) * 100)
    })

    return remaining
  }

  const getPendingExtensions = (booking: UnpaidBooking) => {
    const extensions = booking.booking_details?.extension_history || []
    return extensions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((ext: any, idx: number) => ({ ext, idx }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter(({ ext }: any) => ext.payment_status === 'pending' || ext.payment_status === 'partial' || ext.payment_status === 'nexi_pay_by_link')
  }

  const getPendingWithIndex = (booking: UnpaidBooking, arrayKey: 'penalties' | 'danni') => {
    const arr = booking.booking_details?.[arrayKey] || []
    return arr
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((item: any, realIdx: number) => ({ item, realIdx }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter(({ item }: any) => !item.paymentStatus || item.paymentStatus === 'pending' || item.paymentStatus === 'partial' || item.paymentStatus === 'nexi_pay_by_link')
  }

  // ── Build Customer Groups ──────────────────────────────────────────────────

  const customerGroups = useMemo((): CustomerGroup[] => {
    const groupMap = new Map<string, CustomerGroup>()

    for (const booking of bookings) {
      const name = booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A'
      const key = name.toLowerCase().trim()

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          customerKey: key,
          customerName: name,
          customerEmail: booking.customer_email || booking.booking_details?.customer?.email || '',
          customerPhone: booking.customer_phone || booking.booking_details?.customer?.phone || '',
          noleggioBookings: [],
          primeWashBookings: [],
          penaliItems: [],
          danniItems: [],
          totalRemaining: 0,
          chargedViaMit: 0,
        })
      }

      const group = groupMap.get(key)!
      // Update contact info if empty (pick from any booking that has it)
      if (!group.customerEmail && (booking.customer_email || booking.booking_details?.customer?.email)) {
        group.customerEmail = booking.customer_email || booking.booking_details?.customer?.email
      }
      if (!group.customerPhone && (booking.customer_phone || booking.booking_details?.customer?.phone)) {
        group.customerPhone = booking.customer_phone || booking.booking_details?.customer?.phone
      }

      const effectiveType = getEffectiveType(booking)

      // Only show in Noleggio/PW column if the main booking payment is unpaid
      // (or has unpaid extensions). If the booking is paid but has only unpaid
      // danni/penali, it belongs ONLY in those columns.
      const mainIsUnpaid = booking.payment_status === 'pending' || booking.payment_status === 'unpaid'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasUnpaidExtensions = (booking.booking_details?.extension_history || []).some((ext: any) => ext.payment_status === 'pending' || ext.payment_status === 'partial' || ext.payment_status === 'nexi_pay_by_link')

      if (mainIsUnpaid || hasUnpaidExtensions) {
        if (effectiveType === 'rental') {
          group.noleggioBookings.push(booking)
        } else {
          group.primeWashBookings.push(booking)
        }
      }

      // Collect pending penalties from booking_details
      const pendingPenalties = getPendingWithIndex(booking, 'penalties')
      for (const { item, realIdx } of pendingPenalties) {
        const total = item.total || (item.amount || 0) * (item.quantity || 1)
        const paid = item.amountPaid || 0
        group.penaliItems.push({
          bookingId: booking.id,
          booking,
          label: item.label || 'Penale',
          amount: total,
          amountPaid: paid,
          remaining: total - paid,
          paymentStatus: item.paymentStatus || 'pending',
          source: 'booking_details',
          type: 'penalties',
          originalIndex: realIdx,
        })
      }

      // Collect pending danni from booking_details
      const pendingDanni = getPendingWithIndex(booking, 'danni')
      for (const { item, realIdx } of pendingDanni) {
        const total = item.total || (item.amount || 0) * (item.quantity || 1)
        const paid = item.amountPaid || 0
        group.danniItems.push({
          bookingId: booking.id,
          booking,
          label: item.label || 'Danno',
          amount: total,
          amountPaid: paid,
          remaining: total - paid,
          paymentStatus: item.paymentStatus || 'pending',
          source: 'booking_details',
          type: 'danni',
          originalIndex: realIdx,
        })
      }

      // Collect from fattura items
      const fItems = fatturaItemsMap[booking.id] || []
      for (const fi of fItems) {
        const target = fi.type === 'danni' ? group.danniItems : group.penaliItems
        target.push({
          bookingId: booking.id,
          booking,
          label: `${fi.description} (${fi.fatturaNumero})`,
          amount: fi.total,
          amountPaid: fi.amountPaid,
          remaining: fi.total - fi.amountPaid,
          paymentStatus: fi.paymentStatus,
          source: 'fattura',
          fatturaId: fi.fatturaId,
          fatturaNumero: fi.fatturaNumero,
          itemIndex: fi.itemIndex,
          type: fi.type,
          originalIndex: fi.itemIndex,
        })
      }

      group.totalRemaining += getRemainingAmount(booking)
    }

    // Subtract MIT charged amounts from totalRemaining
    for (const group of groupMap.values()) {
      const emailKey = (group.customerEmail || '').toLowerCase().trim()
      const charged = mitChargedMap[emailKey] || 0
      if (charged > 0) {
        group.chargedViaMit = charged
        group.totalRemaining = Math.max(0, group.totalRemaining - charged)
      }
    }

    let groups = Array.from(groupMap.values())

    // Apply filter
    if (filterService === 'rental') {
      groups = groups.filter(g => g.noleggioBookings.length > 0)
    } else if (filterService === 'prime_wash') {
      groups = groups.filter(g => g.primeWashBookings.length > 0)
    }

    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      groups = groups.filter(g =>
        g.customerName.toLowerCase().includes(q) ||
        g.customerEmail.toLowerCase().includes(q) ||
        g.customerPhone.includes(q)
      )
    }

    // Sort
    groups.sort((a, b) => {
      if (sortBy === 'amount') {
        return sortDir === 'desc' ? b.totalRemaining - a.totalRemaining : a.totalRemaining - b.totalRemaining
      }
      // name
      const cmp = a.customerName.localeCompare(b.customerName, 'it')
      return sortDir === 'desc' ? -cmp : cmp
    })

    return groups
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, fatturaItemsMap, mitChargedMap, filterService, searchQuery, sortBy, sortDir])

  // ── Stats ──────────────────────────────────────────────────────────────────

  const totalUnpaid = customerGroups.reduce((sum, g) => sum + g.totalRemaining, 0)
  const allGroups = useMemo(() => {
    // Stats computed on unfiltered bookings (respecting column assignment logic)
    const gMap = new Map<string, { rental: boolean; pw: boolean; penali: boolean; danni: boolean }>()
    for (const b of bookings) {
      const key = (b.customer_name || '').toLowerCase().trim()
      if (!gMap.has(key)) gMap.set(key, { rental: false, pw: false, penali: false, danni: false })
      const g = gMap.get(key)!
      const mainUnpaid = b.payment_status === 'pending' || b.payment_status === 'unpaid'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasUnpaidExt = (b.booking_details?.extension_history || []).some((ext: any) => ext.payment_status === 'pending' || ext.payment_status === 'partial' || ext.payment_status === 'nexi_pay_by_link')
      if (mainUnpaid || hasUnpaidExt) {
        if (getEffectiveType(b) === 'rental') g.rental = true
        else g.pw = true
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasPen = (b.booking_details?.penalties || []).some((p: any) => p.paymentStatus !== 'paid')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasDan = (b.booking_details?.danni || []).some((d: any) => d.paymentStatus !== 'paid')
      if (hasPen || (fatturaItemsMap[b.id] || []).some(fi => fi.type === 'penalties')) g.penali = true
      if (hasDan || (fatturaItemsMap[b.id] || []).some(fi => fi.type === 'danni')) g.danni = true
    }
    const vals = Array.from(gMap.values())
    return {
      total: gMap.size,
      rental: vals.filter(v => v.rental).length,
      pw: vals.filter(v => v.pw).length,
      penali: vals.filter(v => v.penali).length,
      danni: vals.filter(v => v.danni).length,
    }
  }, [bookings, fatturaItemsMap])

  // ── Mobile accordion toggle ────────────────────────────────────────────────

  function handleSort(col: 'amount' | 'name') {
    if (sortBy === col) {
      setSortDir(prev => prev === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(col)
      setSortDir(col === 'amount' ? 'desc' : 'asc')
    }
  }

  function SortArrow({ col }: { col: 'amount' | 'name' }) {
    if (sortBy !== col) return <span className="text-theme-text-muted/30 ml-1">↕</span>
    return <span className="ml-1">{sortDir === 'desc' ? '↓' : '↑'}</span>
  }

  function toggleExpanded(key: string) {
    setExpandedCustomers(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ── Inline partial pay helper ──────────────────────────────────────────────

  function PartialPayInput({ itemKey, onSubmit, onCancel }: { itemKey: string; onSubmit: (v: number) => void; onCancel: () => void }) {
    if (partialPayItemKey !== itemKey) return null
    return (
      <div className="flex items-center gap-1 mt-1">
        <div className="relative flex-1">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-theme-text-muted text-xs">€</span>
          <input
            type="number" step="0.01" min="0.01"
            value={partialPayValue}
            onChange={e => setPartialPayValue(e.target.value)}
            placeholder="Importo"
            className="w-full pl-5 pr-2 py-1 bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            onKeyDown={e => {
              if (e.key === 'Enter') { const v = parseFloat(partialPayValue); if (!isNaN(v) && v > 0) onSubmit(v) }
              if (e.key === 'Escape') onCancel()
            }}
            autoFocus
          />
        </div>
        <button
          onClick={() => { const v = parseFloat(partialPayValue); if (!isNaN(v) && v > 0) onSubmit(v) }}
          disabled={!partialPayValue || parseFloat(partialPayValue) <= 0}
          className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold disabled:opacity-30"
        >OK</button>
        <button onClick={onCancel} className="px-2 py-1 bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover rounded text-xs">x</button>
      </div>
    )
  }

  // ── Edit amount helper ─────────────────────────────────────────────────────

  function EditAmountInput({ itemKey, currentAmount, onSubmit, onCancel }: { itemKey: string; currentAmount: number; onSubmit: (v: number) => void; onCancel: () => void }) {
    if (editAmountKey !== itemKey) return null
    return (
      <div className="flex items-center gap-1 mt-1">
        <div className="relative flex-1">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-theme-text-muted text-xs">€</span>
          <input
            type="number" step="0.01" min="0.01"
            value={editAmountValue}
            onChange={e => setEditAmountValue(e.target.value)}
            placeholder={currentAmount.toFixed(2)}
            className="w-full pl-5 pr-2 py-1 bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-dr7-gold/50"
            onKeyDown={e => {
              if (e.key === 'Enter') { const v = parseFloat(editAmountValue); if (!isNaN(v) && v > 0) onSubmit(v) }
              if (e.key === 'Escape') onCancel()
            }}
            autoFocus
          />
        </div>
        <button
          onClick={() => { const v = parseFloat(editAmountValue); if (!isNaN(v) && v > 0) onSubmit(v) }}
          disabled={!editAmountValue || parseFloat(editAmountValue) <= 0}
          className="px-2 py-1 bg-dr7-gold hover:bg-[#247a6f] text-white rounded text-xs font-semibold disabled:opacity-30"
        >OK</button>
        <button onClick={onCancel} className="px-2 py-1 bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover rounded text-xs">x</button>
      </div>
    )
  }

  // ── Confirm delete helper ──────────────────────────────────────────────────

  function ConfirmDelete({ itemKey, onConfirm, onCancel }: { itemKey: string; onConfirm: () => void; onCancel: () => void }) {
    if (confirmDeleteKey !== itemKey) return null
    return (
      <div className="flex items-center gap-1 mt-1 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
        <span className="text-xs text-red-400">Confermi?</span>
        <button onClick={onConfirm} className="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold">Si</button>
        <button onClick={onCancel} className="px-2 py-0.5 bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover rounded text-xs">No</button>
      </div>
    )
  }

  // ── Render: Noleggio cell content ──────────────────────────────────────────

  function NoleggioCell({ group }: { group: CustomerGroup }) {
    if (group.noleggioBookings.length === 0) return <span className="text-theme-text-muted text-sm italic">-</span>

    return (
      <div className="space-y-3">
        {group.noleggioBookings.map(booking => {
          const vehicle = booking.vehicle_name || booking.booking_details?.vehicle?.name || booking.booking_details?.vehicle_name || '-'
          const plate = booking.vehicle_plate || booking.booking_details?.vehicle?.plate || booking.booking_details?.vehicle_plate || ''
          const pickupDate = booking.pickup_date || booking.booking_details?.pickup_date
          const dropoffDate = booking.dropoff_date || booking.booking_details?.dropoff_date
          const isPending = booking.payment_status === 'pending' || booking.payment_status === 'unpaid'
          const pendingExts = getPendingExtensions(booking)
          const bkKey = `noleggio:${booking.id}`
          const editKey = `edit:noleggio:${booking.id}`
          const totalCents = booking.price_total || 0
          const paidCents = booking.booking_details?.amountPaid || 0
          const remainingCents = Math.max(0, totalCents - paidCents)

          return (
            <div key={booking.id} className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-2.5">
              <div className="text-sm font-semibold text-theme-text-primary">{vehicle}</div>
              {plate && <div className="text-xs text-theme-text-muted font-mono">{plate}</div>}
              <div className="text-xs text-theme-text-muted">
                {pickupDate && new Date(pickupDate).toLocaleDateString('it-IT')} - {dropoffDate && new Date(dropoffDate).toLocaleDateString('it-IT')}
              </div>
              <div className="text-red-400 font-bold text-sm mt-1">
                €{(remainingCents / 100).toFixed(2)}
                {paidCents > 0 && (
                  <span className="text-xs text-theme-text-muted font-normal ml-1">
                    su €{(totalCents / 100).toFixed(2)}
                  </span>
                )}
              </div>

              {/* Pending extensions */}
              {pendingExts.length > 0 && (
                <div className="mt-1.5 space-y-1.5">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {pendingExts.map(({ ext, idx: extIdx }: any) => {
                    let days = ext.additional_days
                    if (!days && ext.previous_dropoff && ext.new_dropoff) {
                      const prev = new Date(ext.previous_dropoff)
                      const next = new Date(ext.new_dropoff)
                      days = Math.round((next.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24))
                    }
                    const extTotal = ext.additional_amount || 0
                    const extPaid = ext.amount_paid || 0
                    const extRemaining = extTotal - extPaid
                    const extPartialKey = `ext:${booking.id}:${extIdx}`
                    return (
                      <div key={extIdx} className="bg-purple-500/10 border border-purple-500/20 rounded-lg px-2 py-1.5">
                        <div className="text-xs text-purple-400 font-medium">
                          Estensione +{days || '?'}gg
                        </div>
                        <div className="text-purple-400 font-bold text-sm">
                          €{extRemaining.toFixed(2)}
                          {extPaid > 0 && (
                            <span className="text-xs text-theme-text-muted font-normal ml-1">
                              su €{extTotal.toFixed(2)}
                            </span>
                          )}
                        </div>
                        {ext.payment_status === 'partial' && (
                          <div className="text-[10px] text-blue-400">
                            €{extPaid.toFixed(2)} pagati
                          </div>
                        )}
                        <div className="flex gap-1 flex-wrap mt-1 pt-1 border-t border-purple-500/10">
                          <button
                            onClick={() => markSingleExtensionPaid(booking, extIdx)}
                            className="px-2 py-0.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold"
                          >Pagato</button>
                          <button
                            onClick={() => sendPayByLink(booking, extRemaining, `Estensione ${booking.vehicle_name || ''}`)}
                            className="px-2 py-0.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold"
                          >Invia Link</button>
                          {partialPayItemKey !== extPartialKey && (
                            <button
                              onClick={() => { setPartialPayItemKey(extPartialKey); setPartialPayValue('') }}
                              className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
                            >Parziale</button>
                          )}
                          {confirmDeleteKey !== extPartialKey ? (
                            <button
                              onClick={() => setConfirmDeleteKey(extPartialKey)}
                              className="px-2 py-0.5 bg-red-600/80 hover:bg-red-700 text-white rounded text-xs font-semibold"
                            >x</button>
                          ) : (
                            <div className="flex gap-1 items-center">
                              <button
                                onClick={() => deleteSingleExtension(booking, extIdx)}
                                className="px-2 py-0.5 bg-red-600 text-white rounded text-xs font-semibold"
                              >Conferma</button>
                              <button
                                onClick={() => setConfirmDeleteKey(null)}
                                className="px-2 py-0.5 bg-gray-600 text-white rounded text-xs font-semibold"
                              >Annulla</button>
                            </div>
                          )}
                        </div>
                        <PartialPayInput
                          itemKey={extPartialKey}
                          onSubmit={(v) => handleExtensionPartialPayment(booking, extIdx, v)}
                          onCancel={() => setPartialPayItemKey(null)}
                        />
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Segna Tutto Pagato — booking + extensions in one fattura */}
              {((isPending ? 1 : 0) + pendingExts.length) >= 2 && (
                <button
                  onClick={() => markBookingAndExtensionsPaid(booking)}
                  className="w-full mt-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold transition-colors"
                >Segna Tutto Pagato (fattura unica)</button>
              )}

              {/* Action buttons */}
              <div className="flex gap-1 flex-wrap mt-2 pt-2 border-t border-blue-500/10">
                {isPending && (
                  <button
                    onClick={() => updatePaymentStatus(booking.id, 'paid')}
                    className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold"
                  >Pagato</button>
                )}
                {isPending && (
                  <button
                    onClick={() => sendPayByLink(booking, remainingCents / 100, `Noleggio ${booking.vehicle_name || ''}`)}
                    className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold"
                  >Invia Link</button>
                )}
                {isPending && partialLinkKey !== bkKey && (
                  <button
                    onClick={() => { setPartialLinkKey(bkKey); setPartialLinkValue('') }}
                    className="px-2 py-1 bg-purple-400 hover:bg-purple-500 text-white rounded text-xs font-semibold"
                  >Link Parziale</button>
                )}
                {partialLinkKey === bkKey && (
                  <div className="flex items-center gap-1 w-full mt-1">
                    <input type="number" step="0.01" min="1" max={remainingCents / 100}
                      value={partialLinkValue} onChange={e => setPartialLinkValue(e.target.value)}
                      placeholder={`Max €${(remainingCents / 100).toFixed(2)}`}
                      className="flex-1 px-2 py-1 bg-theme-bg-tertiary border border-purple-500/50 rounded text-xs text-theme-text-primary"
                      autoFocus
                    />
                    <button onClick={() => {
                      const amt = parseFloat(partialLinkValue)
                      if (!amt || amt <= 0) return
                      sendPayByLink(booking, Math.min(amt, remainingCents / 100), `Noleggio ${booking.vehicle_name || ''} (parziale)`)
                      setPartialLinkKey(null)
                    }} className="px-2 py-1 bg-purple-600 text-white rounded text-xs font-semibold">Invia</button>
                    <button onClick={() => setPartialLinkKey(null)} className="px-2 py-1 bg-gray-600 text-white rounded text-xs">X</button>
                  </div>
                )}
                {isPending && partialPayItemKey !== bkKey && (
                  <button
                    onClick={() => { setPartialPayItemKey(bkKey); setPartialPayValue('') }}
                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
                  >Parziale</button>
                )}
                {editAmountKey !== editKey && (
                  <button
                    onClick={() => { setEditAmountKey(editKey); setEditAmountValue((totalCents / 100).toFixed(2)) }}
                    className="px-2 py-1 bg-dr7-gold hover:bg-[#247a6f] text-white rounded text-xs font-semibold"
                  >Modifica</button>
                )}
                {confirmDeleteKey !== bkKey && (
                  <button
                    onClick={() => setConfirmDeleteKey(bkKey)}
                    className="px-2 py-1 bg-red-600/80 hover:bg-red-700 text-white rounded text-xs font-semibold"
                  >x</button>
                )}
              </div>
              <PartialPayInput
                itemKey={bkKey}
                onSubmit={(v) => { handleBookingPartialPayment(booking.id, v) }}
                onCancel={() => setPartialPayItemKey(null)}
              />
              <EditAmountInput
                itemKey={editKey}
                currentAmount={totalCents / 100}
                onSubmit={(v) => updateBookingAmount(booking.id, v)}
                onCancel={() => setEditAmountKey(null)}
              />
              <ConfirmDelete
                itemKey={bkKey}
                onConfirm={() => deleteSingleBooking(booking.id)}
                onCancel={() => setConfirmDeleteKey(null)}
              />
            </div>
          )
        })}
      </div>
    )
  }

  // ── Render: Prime Wash cell content ────────────────────────────────────────

  function PrimeWashCell({ group }: { group: CustomerGroup }) {
    if (group.primeWashBookings.length === 0) return <span className="text-theme-text-muted text-sm italic">-</span>

    return (
      <div className="space-y-3">
        {group.primeWashBookings.map(booking => {
          const serviceName = booking.service_name || '-'
          const bkKey = `pw:${booking.id}`
          const editKey = `edit:pw:${booking.id}`
          const totalCents = booking.price_total || 0
          const paidCents = booking.booking_details?.amountPaid || 0
          const remainingCents = Math.max(0, totalCents - paidCents)

          return (
            <div key={booking.id} className="bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-2.5">
              <div className="text-sm font-semibold text-theme-text-primary uppercase">{serviceName}</div>
              <div className="text-xs text-theme-text-muted">
                {booking.appointment_date && new Date(booking.appointment_date).toLocaleDateString('it-IT')} {booking.appointment_time || ''}
              </div>
              <div className="text-red-400 font-bold text-sm mt-1">
                €{(remainingCents / 100).toFixed(2)}
                {paidCents > 0 && (
                  <span className="text-xs text-theme-text-muted font-normal ml-1">
                    su €{(totalCents / 100).toFixed(2)}
                  </span>
                )}
              </div>

              <div className="flex gap-1 flex-wrap mt-2 pt-2 border-t border-cyan-500/10">
                <button
                  onClick={() => updatePaymentStatus(booking.id, 'paid')}
                  className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold"
                >Pagato</button>
                <button
                  onClick={() => sendPayByLink(booking, remainingCents / 100, `Prime Wash ${serviceName}`)}
                  className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold"
                >Invia Link</button>
                {partialLinkKey !== bkKey && (
                  <button
                    onClick={() => { setPartialLinkKey(bkKey); setPartialLinkValue('') }}
                    className="px-2 py-1 bg-purple-400 hover:bg-purple-500 text-white rounded text-xs font-semibold"
                  >Link Parziale</button>
                )}
                {partialLinkKey === bkKey && (
                  <div className="flex items-center gap-1 w-full mt-1">
                    <input type="number" step="0.01" min="1" max={remainingCents / 100}
                      value={partialLinkValue} onChange={e => setPartialLinkValue(e.target.value)}
                      placeholder={`Max €${(remainingCents / 100).toFixed(2)}`}
                      className="flex-1 px-2 py-1 bg-theme-bg-tertiary border border-purple-500/50 rounded text-xs text-theme-text-primary"
                      autoFocus
                    />
                    <button onClick={() => {
                      const amt = parseFloat(partialLinkValue)
                      if (!amt || amt <= 0) return
                      sendPayByLink(booking, Math.min(amt, remainingCents / 100), `Prime Wash ${serviceName} (parziale)`)
                      setPartialLinkKey(null)
                    }} className="px-2 py-1 bg-purple-600 text-white rounded text-xs font-semibold">Invia</button>
                    <button onClick={() => setPartialLinkKey(null)} className="px-2 py-1 bg-gray-600 text-white rounded text-xs">X</button>
                  </div>
                )}
                {partialPayItemKey !== bkKey && (
                  <button
                    onClick={() => { setPartialPayItemKey(bkKey); setPartialPayValue('') }}
                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
                  >Parziale</button>
                )}
                {editAmountKey !== editKey && (
                  <button
                    onClick={() => { setEditAmountKey(editKey); setEditAmountValue((totalCents / 100).toFixed(2)) }}
                    className="px-2 py-1 bg-dr7-gold hover:bg-[#247a6f] text-white rounded text-xs font-semibold"
                  >Modifica</button>
                )}
                {confirmDeleteKey !== bkKey && (
                  <button
                    onClick={() => setConfirmDeleteKey(bkKey)}
                    className="px-2 py-1 bg-red-600/80 hover:bg-red-700 text-white rounded text-xs font-semibold"
                  >x</button>
                )}
              </div>
              <PartialPayInput
                itemKey={bkKey}
                onSubmit={(v) => { handleBookingPartialPayment(booking.id, v) }}
                onCancel={() => setPartialPayItemKey(null)}
              />
              <EditAmountInput
                itemKey={editKey}
                currentAmount={totalCents / 100}
                onSubmit={(v) => updateBookingAmount(booking.id, v)}
                onCancel={() => setEditAmountKey(null)}
              />
              <ConfirmDelete
                itemKey={bkKey}
                onConfirm={() => deleteSingleBooking(booking.id)}
                onCancel={() => setConfirmDeleteKey(null)}
              />
            </div>
          )
        })}
      </div>
    )
  }

  // ── Render: Penali/Danni cell content (shared) ─────────────────────────────

  function PendingItemsCell({ items, type, onMarkAllPaid, onAddebito, onAddebitoItem, chargedViaMit }: { items: PendingItem[]; type: 'penalties' | 'danni'; onMarkAllPaid?: () => void; onAddebito?: () => void; onAddebitoItem?: (amountCents: number, label: string) => void; chargedViaMit?: number }) {
    if (items.length === 0) return <span className="text-theme-text-muted text-sm italic">-</span>

    const colorClasses = type === 'penalties'
      ? { bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', text: 'text-yellow-400', divider: 'border-yellow-500/10' }
      : { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400', divider: 'border-red-500/10' }

    return (
      <div className="space-y-2">
        {items.length >= 2 && onMarkAllPaid && (
          <button
            onClick={onMarkAllPaid}
            disabled={!!processingKey}
            className="w-full px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >{processingKey ? 'Elaborazione...' : `Segna Tutti Pagato (${items.length})`}</button>
        )}
        {onAddebito && (
          <button
            onClick={onAddebito}
            className="w-full px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-semibold transition-colors"
          >Addebito</button>
        )}
        {chargedViaMit != null && chargedViaMit > 0 && (() => {
          const totalItemsCents = Math.round(items.reduce((s, i) => s + i.remaining, 0) * 100)
          return (
            <div className="text-xs text-orange-400 bg-orange-900/20 border border-orange-700/30 rounded-lg px-3 py-1.5 font-medium">
              Da incassare: €{(totalItemsCents / 100).toFixed(2)}
            </div>
          )
        })()}
        {items.map((item, idx) => {
          const itemKey = `${type}:${item.bookingId}:${item.source}:${item.originalIndex}`
          const partialKey = `partial:${itemKey}`
          const editKey = `edit:${itemKey}`

          return (
            <div key={idx} className={`${colorClasses.bg} border ${colorClasses.border} rounded-lg p-2.5`}>
              <div className="text-xs text-theme-text-primary font-medium">{item.label}</div>
              <div className={`font-bold text-sm ${colorClasses.text}`}>€{item.remaining.toFixed(2)}</div>
              {item.paymentStatus === 'partial' && (
                <div className="text-[10px] text-blue-400">
                  €{item.amountPaid.toFixed(2)} pagati su €{item.amount.toFixed(2)}
                </div>
              )}

              <div className={`flex gap-1 flex-wrap mt-2 pt-2 border-t ${colorClasses.divider}`}>
                {item.source === 'booking_details' ? (
                  <>
                    <button
                      onClick={() => markAllTypePaid(item.booking, type)}
                      disabled={!!processingKey}
                      className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold disabled:opacity-50"
                    >Pagato</button>
                    <button
                      onClick={() => sendPayByLink(item.booking, item.remaining, `${type === 'penalties' ? 'Penale' : 'Danno'} — ${item.label}`)}
                      className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold"
                    >Invia Link</button>
                    {partialLinkKey !== itemKey && partialPayItemKey !== partialKey && (
                      <button
                        onClick={() => { setPartialLinkKey(itemKey); setPartialLinkValue('') }}
                        className="px-2 py-1 bg-purple-400 hover:bg-purple-500 text-white rounded text-xs font-semibold"
                      >Link Parziale</button>
                    )}
                    {partialLinkKey === itemKey && (
                      <div className="flex items-center gap-1 w-full mt-1">
                        <input type="number" step="0.01" min="1" max={item.remaining}
                          value={partialLinkValue} onChange={e => setPartialLinkValue(e.target.value)}
                          placeholder={`Max €${item.remaining.toFixed(2)}`}
                          className="flex-1 px-2 py-1 bg-theme-bg-tertiary border border-purple-500/50 rounded text-xs text-theme-text-primary"
                          autoFocus
                        />
                        <button onClick={() => {
                          const amt = parseFloat(partialLinkValue)
                          if (!amt || amt <= 0) return
                          sendPayByLink(item.booking, Math.min(amt, item.remaining), `${type === 'penalties' ? 'Penale' : 'Danno'} — ${item.label} (parziale)`)
                          setPartialLinkKey(null)
                        }} className="px-2 py-1 bg-purple-600 text-white rounded text-xs font-semibold">Invia</button>
                        <button onClick={() => setPartialLinkKey(null)} className="px-2 py-1 bg-gray-600 text-white rounded text-xs">X</button>
                      </div>
                    )}
                    {partialPayItemKey !== partialKey && (
                      <button
                        onClick={() => { setPartialPayItemKey(partialKey); setPartialPayValue('') }}
                        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
                      >Parziale</button>
                    )}
                    {onAddebitoItem && (
                      <button
                        onClick={() => onAddebitoItem(Math.round(item.remaining * 100), item.label)}
                        className="px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs font-semibold"
                      >Addebito</button>
                    )}
                    {editAmountKey !== editKey && (
                      <button
                        onClick={() => { setEditAmountKey(editKey); setEditAmountValue(item.amount.toFixed(2)) }}
                        className="px-2 py-1 bg-dr7-gold hover:bg-[#247a6f] text-white rounded text-xs font-semibold"
                      >Modifica</button>
                    )}
                    <button
                      onClick={() => removeSinglePenaltyDanno(item.booking, type, item.originalIndex)}
                      className="px-2 py-1 bg-red-600/80 hover:bg-red-700 text-white rounded text-xs font-semibold"
                    >x</button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        const fi = (fatturaItemsMap[item.bookingId] || []).find(f => f.fatturaId === item.fatturaId && f.itemIndex === item.itemIndex)
                        if (fi) markSingleFatturaItemPaid(fi)
                      }}
                      className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold"
                    >Pagato</button>
                    {partialPayItemKey !== partialKey && (
                      <button
                        onClick={() => { setPartialPayItemKey(partialKey); setPartialPayValue('') }}
                        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
                      >Parziale</button>
                    )}
                    {onAddebitoItem && (
                      <button
                        onClick={() => onAddebitoItem(Math.round(item.remaining * 100), item.label)}
                        className="px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs font-semibold"
                      >Addebito</button>
                    )}
                    {editAmountKey !== editKey && (
                      <button
                        onClick={() => { setEditAmountKey(editKey); setEditAmountValue(item.amount.toFixed(2)) }}
                        className="px-2 py-1 bg-dr7-gold hover:bg-[#247a6f] text-white rounded text-xs font-semibold"
                      >Modifica</button>
                    )}
                    <button
                      onClick={() => {
                        const fi = (fatturaItemsMap[item.bookingId] || []).find(f => f.fatturaId === item.fatturaId && f.itemIndex === item.itemIndex)
                        if (fi) deleteFatturaItem(fi)
                      }}
                      className="px-2 py-1 bg-red-600/80 hover:bg-red-700 text-white rounded text-xs font-semibold"
                    >x</button>
                  </>
                )}
              </div>

              <PartialPayInput
                itemKey={partialKey}
                onSubmit={(v) => {
                  if (item.source === 'booking_details') {
                    handleTypePartialPayment(item.booking, type, v)
                  } else {
                    const fi = (fatturaItemsMap[item.bookingId] || []).find(f => f.fatturaId === item.fatturaId && f.itemIndex === item.itemIndex)
                    if (fi) handleFatturaItemPayment(fi, v)
                  }
                  setPartialPayItemKey(null)
                }}
                onCancel={() => setPartialPayItemKey(null)}
              />
              {item.source === 'booking_details' ? (
                <EditAmountInput
                  itemKey={editKey}
                  currentAmount={item.amount}
                  onSubmit={(v) => updateSinglePenaltyDannoAmount(item.booking, type, item.originalIndex, v)}
                  onCancel={() => setEditAmountKey(null)}
                />
              ) : (
                <EditAmountInput
                  itemKey={editKey}
                  currentAmount={item.amount}
                  onSubmit={(v) => {
                    const fi = (fatturaItemsMap[item.bookingId] || []).find(f => f.fatturaId === item.fatturaId && f.itemIndex === item.itemIndex)
                    if (fi) updateFatturaItemAmount(fi, v)
                  }}
                  onCancel={() => setEditAmountKey(null)}
                />
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ── Loading state ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-text-primary mx-auto mb-4"></div>
        <p className="text-theme-text-primary">Caricamento prenotazioni da saldare...</p>
      </div>
    )
  }

  // ── Main Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="bg-theme-bg-secondary rounded-lg p-3 lg:p-4 border border-theme-border">
        <h2 className="text-2xl font-bold text-theme-text-primary">Da Saldare — Vista per Cliente</h2>
        <p className="text-sm text-theme-text-muted mt-1">
          Prenotazioni con pagamento in sospeso, raggruppate per cliente
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 lg:gap-3">
        <div className="bg-theme-bg-secondary p-3 rounded-lg border border-theme-border">
          <div className="text-xs text-theme-text-muted">Totale</div>
          <div className="text-lg lg:text-xl font-bold text-red-400">€{(totalUnpaid / 100).toFixed(2)}</div>
        </div>
        <div className="bg-theme-bg-secondary p-3 rounded-lg border border-theme-border">
          <div className="text-xs text-theme-text-muted">Clienti</div>
          <div className="text-lg lg:text-xl font-bold text-theme-text-primary">{allGroups.total}</div>
        </div>
        <div className="bg-theme-bg-secondary p-3 rounded-lg border border-blue-500/30">
          <div className="text-xs text-blue-400">Noleggio</div>
          <div className="text-lg lg:text-xl font-bold text-blue-400">{allGroups.rental}</div>
        </div>
        <div className="bg-theme-bg-secondary p-3 rounded-lg border border-cyan-500/30">
          <div className="text-xs text-cyan-400">Prime Wash</div>
          <div className="text-lg lg:text-xl font-bold text-cyan-400">{allGroups.pw}</div>
        </div>
        <div className="bg-theme-bg-secondary p-3 rounded-lg border border-yellow-500/30">
          <div className="text-xs text-yellow-400">Penali</div>
          <div className="text-lg lg:text-xl font-bold text-yellow-400">{allGroups.penali}</div>
        </div>
        <div className="bg-theme-bg-secondary p-3 rounded-lg border border-red-500/30">
          <div className="text-xs text-red-400">Danni</div>
          <div className="text-lg lg:text-xl font-bold text-red-400">{allGroups.danni}</div>
        </div>
      </div>

      {/* Filters + Search */}
      <div className="bg-theme-bg-secondary rounded-lg p-3 lg:p-4 border border-theme-border">
        <div className="flex flex-col lg:flex-row justify-between gap-3 lg:gap-4">
          <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0 lg:flex-wrap">
            {(['all', 'rental', 'prime_wash'] as const).map(f => {
              const labels: Record<string, string> = { all: `Tutti (${allGroups.total})`, rental: `Noleggio (${allGroups.rental})`, prime_wash: `Prime Wash (${allGroups.pw})` }
              return (
                <button
                  key={f}
                  onClick={() => setFilterService(f)}
                  className={`px-4 py-2 rounded-full font-medium transition-colors whitespace-nowrap ${
                    filterService === f
                      ? 'bg-dr7-gold text-theme-bg-primary'
                      : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                  }`}
                >{labels[f]}</button>
              )
            })}
          </div>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Cerca cliente..."
              className="pl-9 pr-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-dr7-gold/50 w-full lg:w-64"
            />
          </div>
        </div>
      </div>

      {/* ── Mobile Card View ─────────────────────────────────────────────── */}
      <div className="lg:hidden space-y-3">
        {/* Mobile sort bar */}
        <div className="flex gap-2">
          <button
            onClick={() => handleSort('name')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${sortBy === 'name' ? 'bg-dr7-gold text-theme-bg-primary' : 'bg-theme-bg-tertiary text-theme-text-muted'}`}
          >Nome {sortBy === 'name' && (sortDir === 'asc' ? '↑' : '↓')}</button>
          <button
            onClick={() => handleSort('amount')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${sortBy === 'amount' ? 'bg-dr7-gold text-theme-bg-primary' : 'bg-theme-bg-tertiary text-theme-text-muted'}`}
          >Importo {sortBy === 'amount' && (sortDir === 'asc' ? '↑' : '↓')}</button>
        </div>
        {customerGroups.map(group => {
          const isExpanded = expandedCustomers.has(group.customerKey)
          const hasNoleggio = group.noleggioBookings.length > 0
          const hasPW = group.primeWashBookings.length > 0
          const hasPenali = group.penaliItems.length > 0
          const hasDanni = group.danniItems.length > 0

          return (
            <div key={group.customerKey} className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
              {/* Accordion Header */}
              <button
                onClick={() => toggleExpanded(group.customerKey)}
                className="w-full flex items-center justify-between p-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-theme-text-primary truncate">{group.customerName}</div>
                  <div className="flex gap-2 mt-0.5">
                    {hasNoleggio && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-300">Noleggio</span>}
                    {hasPW && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/50 text-cyan-300">Prime Wash</span>}
                    {hasPenali && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-300">Penali</span>}
                    {hasDanni && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/50 text-red-300">Danni</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="text-right">
                    <span className="text-red-400 font-bold">€{(group.totalRemaining / 100).toFixed(2)}</span>
                    {group.chargedViaMit > 0 && (
                      <div className="text-[10px] text-green-400">Incassato: €{(group.chargedViaMit / 100).toFixed(2)}</div>
                    )}
                  </div>
                  <svg className={`w-5 h-5 text-theme-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* Accordion Body */}
              {isExpanded && (
                <div className="border-t border-theme-border p-3 space-y-4">
                  {/* Contact info */}
                  <div className="text-xs text-theme-text-muted space-y-0.5">
                    {group.customerEmail && <div>{group.customerEmail}</div>}
                    {group.customerPhone && <div>{group.customerPhone}</div>}
                  </div>

                  {/* Salda Tutto button */}
                  {(group.noleggioBookings.length + group.primeWashBookings.length + group.penaliItems.length + group.danniItems.length) >= 2 && (
                    <button
                      onClick={() => markAllCustomerPaid(group)}
                      disabled={!!processingKey}
                      className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >{processingKey ? 'Elaborazione...' : 'Salda Tutto — Fattura Unica'}</button>
                  )}

                  {/* Addebito button */}
                  <button
                    onClick={() => openAddebitoNexi(group)}
                    className="w-full px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-semibold transition-colors"
                  >Addebito (auto-retry -10%)</button>

                  {/* Noleggio section */}
                  {hasNoleggio && (
                    <div>
                      <div className="text-xs font-bold text-blue-400 uppercase mb-1.5">Noleggio</div>
                      <NoleggioCell group={group} />
                    </div>
                  )}

                  {/* Prime Wash section */}
                  {hasPW && (
                    <div>
                      <div className="text-xs font-bold text-cyan-400 uppercase mb-1.5">Prime Wash</div>
                      <PrimeWashCell group={group} />
                    </div>
                  )}

                  {/* Penali section */}
                  {hasPenali && (
                    <div>
                      <div className="text-xs font-bold text-yellow-400 uppercase mb-1.5">Penali</div>
                      <PendingItemsCell items={group.penaliItems} type="penalties" onMarkAllPaid={() => markAllCustomerItemsPaid(group, 'penalties')} onAddebito={() => openAddebitoNexi(group)} onAddebitoItem={(amt, label) => openAddebitoNexi(group, amt, label)} chargedViaMit={group.chargedViaMit} />
                    </div>
                  )}

                  {/* Danni section */}
                  {hasDanni && (
                    <div>
                      <div className="text-xs font-bold text-red-400 uppercase mb-1.5">Danni</div>
                      <PendingItemsCell items={group.danniItems} type="danni" onMarkAllPaid={() => markAllCustomerItemsPaid(group, 'danni')} onAddebito={() => openAddebitoNexi(group)} onAddebitoItem={(amt, label) => openAddebitoNexi(group, amt, label)} chargedViaMit={group.chargedViaMit} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {customerGroups.length === 0 && (
          <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-8 text-center text-theme-text-muted">
            {searchQuery ? 'Nessun cliente trovato' : 'Nessuna prenotazione da saldare!'}
          </div>
        )}
      </div>

      {/* ── Desktop Table View ───────────────────────────────────────────── */}
      <div className="block bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b-2 border-theme-border">
                <th className="px-4 py-3 text-left text-sm font-semibold w-[18%]">
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleSort('name')} className="flex items-center text-theme-text-primary hover:text-dr7-gold transition-colors">
                      Cliente<SortArrow col="name" />
                    </button>
                    <span className="text-theme-text-muted/40">|</span>
                    <button onClick={() => handleSort('amount')} className="flex items-center text-red-400 hover:text-red-300 transition-colors text-xs">
                      €<SortArrow col="amount" />
                    </button>
                  </div>
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-blue-400 w-[24%] border-l border-theme-border">Noleggio</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-cyan-400 w-[18%] border-l border-theme-border">Prime Wash</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-yellow-400 w-[20%] border-l border-theme-border">Penali</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-red-400 w-[20%] border-l border-theme-border">Danni</th>
              </tr>
            </thead>
            <tbody>
              {customerGroups.map(group => (
                <tr key={group.customerKey} className="border-t border-theme-border hover:bg-theme-bg-tertiary/30 align-top">
                  {/* Cliente column */}
                  <td className="px-4 py-3">
                    <div className="text-sm font-bold text-theme-text-primary">{group.customerName}</div>
                    {group.customerEmail && <div className="text-xs text-theme-text-muted mt-0.5 truncate max-w-[180px]">{group.customerEmail}</div>}
                    {group.customerPhone && <div className="text-xs text-theme-text-muted">{group.customerPhone}</div>}
                    <div className="text-red-400 font-bold text-lg mt-2">
                      €{(group.totalRemaining / 100).toFixed(2)}
                    </div>
                    {group.chargedViaMit > 0 && (
                      <div className="text-xs text-orange-400 mt-0.5">Da incassare: €{(group.totalRemaining / 100).toFixed(2)}</div>
                    )}
                    {(group.noleggioBookings.length + group.primeWashBookings.length + group.penaliItems.length + group.danniItems.length) >= 2 && (
                      <button
                        onClick={() => markAllCustomerPaid(group)}
                        disabled={!!processingKey}
                        className="w-full mt-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >{processingKey ? 'Elaborazione...' : 'Salda Tutto (fattura unica)'}</button>
                    )}
                    <button
                      onClick={() => openAddebitoNexi(group)}
                      className="w-full mt-1 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-semibold transition-colors"
                    >Addebito</button>
                  </td>

                  {/* Noleggio column */}
                  <td className="px-4 py-3 border-l border-theme-border">
                    <NoleggioCell group={group} />
                  </td>

                  {/* Prime Wash column */}
                  <td className="px-4 py-3 border-l border-theme-border">
                    <PrimeWashCell group={group} />
                  </td>

                  {/* Penali column */}
                  <td className="px-4 py-3 border-l border-theme-border">
                    <PendingItemsCell items={group.penaliItems} type="penalties" onMarkAllPaid={() => markAllCustomerItemsPaid(group, 'penalties')} onAddebito={() => openAddebitoNexi(group)} onAddebitoItem={(amt, label) => openAddebitoNexi(group, amt, label)} chargedViaMit={group.chargedViaMit} />
                  </td>

                  {/* Danni column */}
                  <td className="px-4 py-3 border-l border-theme-border">
                    <PendingItemsCell items={group.danniItems} type="danni" onMarkAllPaid={() => markAllCustomerItemsPaid(group, 'danni')} onAddebito={() => openAddebitoNexi(group)} onAddebitoItem={(amt, label) => openAddebitoNexi(group, amt, label)} chargedViaMit={group.chargedViaMit} />
                  </td>
                </tr>
              ))}
              {customerGroups.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-theme-text-muted">
                    {searchQuery ? 'Nessun cliente trovato' : 'Nessuna prenotazione da saldare!'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Addebito Modal */}
      {showAddebitoModal && addebitoGroup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-theme-bg-secondary rounded-xl border border-theme-border p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-theme-text-primary">
              Addebito{addebitoItemLabel ? ` — ${addebitoItemLabel}` : ''} — {addebitoGroup.customerName}
            </h3>
            <div className="text-sm text-theme-text-secondary space-y-1">
              <p><strong>Email:</strong> {addebitoGroup.customerEmail}</p>
              <p><strong>Da incassare:</strong> <span className="text-red-400 font-bold">€{((addebitoItemAmount != null ? addebitoItemAmount : addebitoGroup.totalRemaining) / 100).toFixed(2)}</span></p>
              {addebitoItemAmount != null && addebitoCarryForward > 0 && (
                <div className="text-xs bg-orange-900/20 border border-orange-700/30 rounded-lg p-2 mt-1 space-y-0.5">
                  <p className="text-theme-text-muted">
                    {addebitoItemLabel}: <span className="text-theme-text-primary font-semibold">€{((addebitoItemAmount - addebitoCarryForward) / 100).toFixed(2)}</span>
                  </p>
                  <p className="text-theme-text-muted">
                    Saldo precedente non riscosso: <span className="text-orange-400 font-semibold">+€{(addebitoCarryForward / 100).toFixed(2)}</span>
                  </p>
                  <p className="text-theme-text-primary font-bold pt-0.5 border-t border-orange-700/20">
                    Totale addebito: €{(addebitoItemAmount / 100).toFixed(2)}
                  </p>
                </div>
              )}
              <p><strong>Contract ID:</strong> {addebitoContractId ? <span className="font-mono text-xs text-green-400">{addebitoContractId}</span> : <span className="text-red-400">Non trovato</span>}</p>
            </div>

            {/* Danni photos from booking */}
            {addebitoDanniPhotos.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Foto Danni ({addebitoDanniPhotos.length})</label>
                <div className="flex gap-2 flex-wrap">
                  {addebitoDanniPhotos.map((url, i) => (
                    <img key={i} src={url} alt={`Danno ${i + 1}`} className="w-16 h-16 object-cover rounded-lg border border-theme-border" />
                  ))}
                </div>
                <p className="text-xs text-theme-text-muted mt-1">Allegate automaticamente dalla scheda danni</p>
              </div>
            )}

            <div className="p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg text-xs text-yellow-300">
              <strong>Flusso:</strong> Email formale inviata subito → seconda email con foto danni → addebito MIT con auto-retry -10%.
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowAddebitoModal(false)}
                disabled={addebitoSending}
                className="px-4 py-2 rounded-lg text-sm bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover transition-colors disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                onClick={handleAddebitoUnpaid}
                disabled={addebitoSending || !addebitoContractId}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {addebitoSending ? 'Invio...' : `Invia Email e Programma Addebito €${((addebitoItemAmount != null ? addebitoItemAmount : addebitoGroup.totalRemaining) / 100).toFixed(2)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
