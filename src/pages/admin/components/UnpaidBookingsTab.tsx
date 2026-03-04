import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

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
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function UnpaidBookingsTab() {
  const [bookings, setBookings] = useState<UnpaidBooking[]>([])
  const [fatturaItemsMap, setFatturaItemsMap] = useState<Record<string, FatturaItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [filterService, setFilterService] = useState<'all' | 'rental' | 'prime_wash'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [partialPayItemKey, setPartialPayItemKey] = useState<string | null>(null)
  const [partialPayValue, setPartialPayValue] = useState('')
  const [editAmountKey, setEditAmountKey] = useState<string | null>(null)
  const [editAmountValue, setEditAmountValue] = useState('')
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set())
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null)

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

  // ── Data Layer (preserved from original) ──────────────────────────────────

  async function loadUnpaidBookings() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .neq('status', 'cancelled')
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

      const unpaidBookings = (data || []).filter(booking => {
        if (booking.payment_status === 'pending' || booking.payment_status === 'unpaid') return true

        const extensions = booking.booking_details?.extension_history || []
        if (extensions.some((ext: any) => ext.payment_status === 'pending')) return true

        const penalties = booking.booking_details?.penalties || []
        if (penalties.some((p: any) => !p.paymentStatus || p.paymentStatus === 'pending' || p.paymentStatus === 'partial')) return true

        const danni = booking.booking_details?.danni || []
        if (danni.some((d: any) => !d.paymentStatus || d.paymentStatus === 'pending' || d.paymentStatus === 'partial')) return true

        if (bookingIdsWithFatturaItems.has(booking.id)) return true

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
          status: newStatus === 'paid' ? 'confirmed' : 'pending'
        })
        .eq('id', bookingId)

      if (error) throw error
      toast.success('Stato pagamento aggiornato!')

      if (newStatus === 'paid') {
        try {
          const invoiceRes = await fetch('/.netlify/functions/generate-invoice-from-booking', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId, includeIVA: true })
          })
          if (invoiceRes.ok) {
            const invoiceData = await invoiceRes.json()
            toast.success(`Fattura ${invoiceData.invoice?.numero_fattura || ''} generata e inviata a SDI`)
          }
        } catch (invoiceErr) {
          console.warn('Auto-invoice generation failed:', invoiceErr)
        }
      }

      loadUnpaidBookings()
    } catch (error: any) {
      console.error('Failed to update payment status:', error)
      const errorMessage = error?.message || error?.details || JSON.stringify(error)
      toast.error(`Errore: ${errorMessage}`)
    }
  }

  async function removeSinglePenaltyDanno(booking: UnpaidBooking, type: 'penalties' | 'danni', originalIndex: number) {
    try {
      const details = booking.booking_details || {}
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
    } catch (error: any) {
      console.error('Failed to remove item:', error)
      toast.error('Errore: ' + (error.message || error))
    }
  }

  async function updateSinglePenaltyDannoAmount(booking: UnpaidBooking, type: 'penalties' | 'danni', originalIndex: number, newAmount: number) {
    try {
      const details = booking.booking_details || {}
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
    } catch (error: any) {
      console.error('Failed to update amount:', error)
      toast.error('Errore: ' + (error.message || error))
    }
  }

  async function markExtensionsPaid(booking: UnpaidBooking) {
    try {
      const extensions = booking.booking_details?.extension_history || []
      const updatedExtensions = extensions.map((ext: any) => ({
        ...ext,
        payment_status: ext.payment_status === 'pending' ? 'paid' : ext.payment_status
      }))

      const { error } = await supabase
        .from('bookings')
        .update({ booking_details: { ...booking.booking_details, extension_history: updatedExtensions } })
        .eq('id', booking.id)

      if (error) throw error
      toast.success('Estensioni segnate come pagate!')
      loadUnpaidBookings()
    } catch (error: any) {
      console.error('Failed to update extension payment status:', error)
      toast.error('Errore: ' + (error.message || error))
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
          console.warn('Failed to delete from Google Calendar:', calError)
        }
      }

      const res = await fetch('/.netlify/functions/delete-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete booking')
      }

      toast.success('Prenotazione eliminata!')
      setConfirmDeleteKey(null)
      loadUnpaidBookings()
    } catch (error: any) {
      console.error('Failed to delete booking:', error)
      toast.error('Errore: ' + (error.message || error))
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
    } catch (err: any) {
      toast.error(err.message || 'Errore')
    }
  }

  async function markSingleFatturaItemPaid(fi: FatturaItem) {
    try {
      const { data: fattura, error: fetchErr } = await supabase
        .from('fatture').select('id, items').eq('id', fi.fatturaId).single()
      if (fetchErr || !fattura) throw fetchErr || new Error('Fattura non trovata')

      const items: any[] = Array.isArray(fattura.items) ? [...fattura.items] : []
      if (items[fi.itemIndex]) {
        const existing = items[fi.itemIndex]
        const total = existing.total || (existing.unit_price || 0) * (existing.quantity || 1)
        items[fi.itemIndex] = { ...existing, amountPaid: total, paymentStatus: 'paid' }
      }

      await supabase.from('fatture').update({ items }).eq('id', fi.fatturaId)
      toast.success('Pagamento registrato')
      loadUnpaidBookings()
    } catch (err: any) {
      toast.error(err.message || 'Errore')
    }
  }

  async function markAllTypePaid(booking: UnpaidBooking, type: 'penalties' | 'danni') {
    try {
      const details = booking.booking_details || {}
      const arr: any[] = details[type] || []
      const pending = arr.filter((item: any) => !item.paymentStatus || item.paymentStatus === 'pending' || item.paymentStatus === 'partial')

      if (pending.length > 0) {
        const invoiceItems = pending.map((item: any) => {
          const total = item.total || (item.amount || 0) * (item.quantity || 1)
          const remaining = total - (item.amountPaid || 0)
          return { label: item.label, amount: remaining, quantity: 1 }
        }).filter((i: any) => i.amount > 0)

        if (invoiceItems.length > 0) {
          const res = await fetch('/.netlify/functions/generate-penalty-invoice', {
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
          if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || err.error || 'Errore generazione fattura')
          }
        }

        const updated = arr.map((item: any) => {
          if (!item.paymentStatus || item.paymentStatus === 'pending' || item.paymentStatus === 'partial') {
            const total = item.total || (item.amount || 0) * (item.quantity || 1)
            return { ...item, paymentStatus: 'paid', amountPaid: total }
          }
          return item
        })
        await supabase.from('bookings').update({ booking_details: { ...details, [type]: updated } }).eq('id', booking.id)
      }

      const fItems = (fatturaItemsMap[booking.id] || []).filter(fi => fi.type === type)
      for (const fi of fItems) {
        await markSingleFatturaItemPaid(fi)
      }

      toast.success(`${type === 'danni' ? 'Danni' : 'Penali'} segnati come pagati`)
      loadUnpaidBookings()
    } catch (err: any) {
      toast.error(err.message || 'Errore')
    }
  }

  async function handleTypePartialPayment(booking: UnpaidBooking, type: 'penalties' | 'danni', paymentAmount: number) {
    try {
      let remaining = paymentAmount
      const details = booking.booking_details || {}
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
    } catch (err: any) {
      toast.error(err.message || 'Errore')
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
    } catch (err: any) {
      toast.error(err.message || 'Errore')
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
    } catch (err: any) {
      toast.error(err.message || 'Errore')
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
    } catch (err: any) {
      toast.error(err.message || 'Errore')
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
      extensions.forEach((ext: any) => {
        if (ext.payment_status === 'pending' && ext.additional_amount) {
          remaining += (ext.additional_amount * 100)
        }
      })
    }

    const penalties = booking.booking_details?.penalties || []
    penalties.forEach((p: any) => {
      if (!p.paymentStatus || p.paymentStatus === 'pending' || p.paymentStatus === 'partial') {
        const total = p.total || (p.amount || 0) * (p.quantity || 1)
        const paid = p.amountPaid || 0
        remaining += Math.round((total - paid) * 100)
      }
    })

    const danni = booking.booking_details?.danni || []
    danni.forEach((d: any) => {
      if (!d.paymentStatus || d.paymentStatus === 'pending' || d.paymentStatus === 'partial') {
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
    return extensions.filter((ext: any) => ext.payment_status === 'pending')
  }

  const getPendingWithIndex = (booking: UnpaidBooking, arrayKey: 'penalties' | 'danni') => {
    const arr = booking.booking_details?.[arrayKey] || []
    return arr
      .map((item: any, realIdx: number) => ({ item, realIdx }))
      .filter(({ item }: any) => !item.paymentStatus || item.paymentStatus === 'pending' || item.paymentStatus === 'partial')
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
      const hasUnpaidExtensions = (booking.booking_details?.extension_history || []).some((ext: any) => ext.payment_status === 'pending')

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

    // Sort by totalRemaining DESC
    groups.sort((a, b) => b.totalRemaining - a.totalRemaining)

    return groups
  }, [bookings, fatturaItemsMap, filterService, searchQuery])

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
      const hasUnpaidExt = (b.booking_details?.extension_history || []).some((ext: any) => ext.payment_status === 'pending')
      if (mainUnpaid || hasUnpaidExt) {
        if (getEffectiveType(b) === 'rental') g.rental = true
        else g.pw = true
      }
      const hasPen = (b.booking_details?.penalties || []).some((p: any) => !p.paymentStatus || p.paymentStatus === 'pending' || p.paymentStatus === 'partial')
      const hasDan = (b.booking_details?.danni || []).some((d: any) => !d.paymentStatus || d.paymentStatus === 'pending' || d.paymentStatus === 'partial')
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
            className="w-full pl-5 pr-2 py-1 bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-yellow-500/50"
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
          className="px-2 py-1 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-xs font-semibold disabled:opacity-30"
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
                <div className="mt-1.5 space-y-0.5">
                  {pendingExts.map((ext: any, i: number) => (
                    <div key={i} className="text-xs text-purple-400 bg-purple-500/10 rounded px-1.5 py-0.5">
                      Estensione +{ext.additional_days || '?'}gg €{(ext.additional_amount || 0).toFixed(2)}
                    </div>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-1 flex-wrap mt-2 pt-2 border-t border-blue-500/10">
                {isPending && (
                  <button
                    onClick={() => updatePaymentStatus(booking.id, 'paid')}
                    className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold"
                  >Pagato</button>
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
                    className="px-2 py-1 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-xs font-semibold"
                  >Modifica</button>
                )}
                {pendingExts.length > 0 && (
                  <button
                    onClick={() => markExtensionsPaid(booking)}
                    className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold"
                  >Ext. Pagate</button>
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
                {partialPayItemKey !== bkKey && (
                  <button
                    onClick={() => { setPartialPayItemKey(bkKey); setPartialPayValue('') }}
                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
                  >Parziale</button>
                )}
                {editAmountKey !== editKey && (
                  <button
                    onClick={() => { setEditAmountKey(editKey); setEditAmountValue((totalCents / 100).toFixed(2)) }}
                    className="px-2 py-1 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-xs font-semibold"
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

  function PendingItemsCell({ items, type }: { items: PendingItem[]; type: 'penalties' | 'danni' }) {
    if (items.length === 0) return <span className="text-theme-text-muted text-sm italic">-</span>

    const colorClasses = type === 'penalties'
      ? { bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', text: 'text-yellow-400', divider: 'border-yellow-500/10' }
      : { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400', divider: 'border-red-500/10' }

    return (
      <div className="space-y-2">
        {items.map((item, idx) => {
          const itemKey = `${type}:${item.bookingId}:${item.source}:${item.originalIndex}`
          const partialKey = `partial:${itemKey}`
          const editKey = `edit:${itemKey}`
          const deleteKey = `delete:${itemKey}`

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
                      className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold"
                    >Pagato</button>
                    {partialPayItemKey !== partialKey && (
                      <button
                        onClick={() => { setPartialPayItemKey(partialKey); setPartialPayValue('') }}
                        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
                      >Parziale</button>
                    )}
                    {editAmountKey !== editKey && (
                      <button
                        onClick={() => { setEditAmountKey(editKey); setEditAmountValue(item.amount.toFixed(2)) }}
                        className="px-2 py-1 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-xs font-semibold"
                      >Modifica</button>
                    )}
                    {confirmDeleteKey !== deleteKey && (
                      <button
                        onClick={() => setConfirmDeleteKey(deleteKey)}
                        className="px-2 py-1 bg-red-600/80 hover:bg-red-700 text-white rounded text-xs font-semibold"
                      >x</button>
                    )}
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
                    {editAmountKey !== editKey && (
                      <button
                        onClick={() => { setEditAmountKey(editKey); setEditAmountValue(item.amount.toFixed(2)) }}
                        className="px-2 py-1 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-xs font-semibold"
                      >Modifica</button>
                    )}
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
                <>
                  <EditAmountInput
                    itemKey={editKey}
                    currentAmount={item.amount}
                    onSubmit={(v) => updateSinglePenaltyDannoAmount(item.booking, type, item.originalIndex, v)}
                    onCancel={() => setEditAmountKey(null)}
                  />
                  <ConfirmDelete
                    itemKey={deleteKey}
                    onConfirm={() => removeSinglePenaltyDanno(item.booking, type, item.originalIndex)}
                    onCancel={() => setConfirmDeleteKey(null)}
                  />
                </>
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
                  <span className="text-red-400 font-bold">€{(group.totalRemaining / 100).toFixed(2)}</span>
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
                      <PendingItemsCell items={group.penaliItems} type="penalties" />
                    </div>
                  )}

                  {/* Danni section */}
                  {hasDanni && (
                    <div>
                      <div className="text-xs font-bold text-red-400 uppercase mb-1.5">Danni</div>
                      <PendingItemsCell items={group.danniItems} type="danni" />
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
      <div className="hidden lg:block bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-theme-border">
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary w-[18%]">Cliente</th>
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
                    <PendingItemsCell items={group.penaliItems} type="penalties" />
                  </td>

                  {/* Danni column */}
                  <td className="px-4 py-3 border-l border-theme-border">
                    <PendingItemsCell items={group.danniItems} type="danni" />
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
    </div>
  )
}
