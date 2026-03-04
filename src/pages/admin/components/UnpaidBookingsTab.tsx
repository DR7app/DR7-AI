import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

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
  return_date?: string
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

export default function UnpaidBookingsTab() {
  const [bookings, setBookings] = useState<UnpaidBooking[]>([])
  const [fatturaItemsMap, setFatturaItemsMap] = useState<Record<string, FatturaItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [filterService, setFilterService] = useState<'all' | 'rental' | 'car_wash' | 'mechanical_service'>('all')
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedBookings, setSelectedBookings] = useState<Set<string>>(new Set())
  const [partialPayItemKey, setPartialPayItemKey] = useState<string | null>(null) // "bookingId:type:index"
  const [partialPayValue, setPartialPayValue] = useState('')

  useEffect(() => {
    loadUnpaidBookings()

    // Real-time subscription
    const subscription = supabase
      .channel('unpaid-bookings-updates')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        () => loadUnpaidBookings()
      )
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  async function loadUnpaidBookings() {
    setLoading(true)
    try {
      // Load all bookings
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .neq('status', 'cancelled')
        .neq('customer_name', 'Lavaggio Rientro')
        .order('created_at', { ascending: false })

      if (error) throw error

      // Also load fatture with danni/penali items that aren't fully paid
      const { data: fatture } = await supabase
        .from('fatture')
        .select('id, booking_id, numero_fattura, items')

      const fItemsMap: Record<string, FatturaItem[]> = {}
      const bookingIdsWithFatturaItems = new Set<string>()

      for (const f of (fatture || [])) {
        if (!f.items || !Array.isArray(f.items) || !f.booking_id) continue
        f.items.forEach((fi: any, idx: number) => {
          if (!fi.description) return
          const desc = (fi.description as string)
          const isDanniPenali = desc.includes('Penale prenotazione') || desc.includes('Danno prenotazione')
          if (!isDanniPenali) return
          // Include if NOT explicitly paid
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

      // Filter bookings
      const unpaidBookings = (data || []).filter(booking => {
        if (booking.payment_status === 'pending' || booking.payment_status === 'unpaid') return true

        const extensions = booking.booking_details?.extension_history || []
        if (extensions.some((ext: any) => ext.payment_status === 'pending')) return true

        const penalties = booking.booking_details?.penalties || []
        if (penalties.some((p: any) => !p.paymentStatus || p.paymentStatus === 'pending' || p.paymentStatus === 'partial')) return true

        const danni = booking.booking_details?.danni || []
        if (danni.some((d: any) => !d.paymentStatus || d.paymentStatus === 'pending' || d.paymentStatus === 'partial')) return true

        // Include if booking has unpaid fattura danni/penali items
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

      // Auto-generate fattura + send to SDI when marking as paid
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
      toast.error(`Errore nell'aggiornamento dello stato pagamento: ${errorMessage} (ID: ${bookingId.substring(0, 8)})`)
    }
  }

  // Check if booking has any pending penalties/danni in booking_details
  function hasPendingPenaltyDanni(booking: UnpaidBooking): boolean {
    const penalties = booking.booking_details?.penalties || []
    const danni = booking.booking_details?.danni || []
    const hasBD = penalties.some((p: any) => !p.paymentStatus || p.paymentStatus === 'pending' || p.paymentStatus === 'partial') || danni.some((d: any) => !d.paymentStatus || d.paymentStatus === 'pending' || d.paymentStatus === 'partial')
    const hasFattura = (fatturaItemsMap[booking.id] || []).length > 0
    return hasBD || hasFattura
  }

  async function removePendingPenaltiesDanni(booking: UnpaidBooking) {
    try {
      const details = booking.booking_details || {}
      const penalties = (details.penalties || []).filter((p: any) => p.paymentStatus && p.paymentStatus !== 'pending' && p.paymentStatus !== 'partial')
      const danni = (details.danni || []).filter((d: any) => d.paymentStatus && d.paymentStatus !== 'pending' && d.paymentStatus !== 'partial')

      const { error } = await supabase
        .from('bookings')
        .update({
          booking_details: {
            ...details,
            penalties,
            danni
          }
        })
        .eq('id', booking.id)

      if (error) throw error

      toast.success('Penali/Danni rimossi!')
      loadUnpaidBookings()
    } catch (error: any) {
      console.error('Failed to remove penalties/danni:', error)
      toast.error('Errore: ' + (error.message || error))
    }
  }

  async function markExtensionsPaid(booking: UnpaidBooking) {
    try {
      // Update all pending extensions to paid
      const extensions = booking.booking_details?.extension_history || []
      const updatedExtensions = extensions.map((ext: any) => ({
        ...ext,
        payment_status: ext.payment_status === 'pending' ? 'paid' : ext.payment_status
      }))

      const { error } = await supabase
        .from('bookings')
        .update({
          booking_details: {
            ...booking.booking_details,
            extension_history: updatedExtensions
          }
        })
        .eq('id', booking.id)

      if (error) throw error

      toast.success('Estensioni segnate come pagate!')
      loadUnpaidBookings()
    } catch (error: any) {
      console.error('Failed to update extension payment status:', error)
      toast.error('Errore: ' + (error.message || error))
    }
  }

  async function markSelectedAsPaid() {
    if (selectedBookings.size === 0) return

    try {
      const { error } = await supabase
        .from('bookings')
        .update({
          payment_status: 'paid',
          status: 'confirmed'
        })
        .in('id', Array.from(selectedBookings))

      if (error) throw error

      toast.success(`${selectedBookings.size} prenotazioni segnate come pagate!`)
      setSelectedBookings(new Set())
      setMultiSelectMode(false)
      loadUnpaidBookings()
    } catch (error) {
      console.error('Failed to mark bookings as paid:', error)
      toast.error('Errore durante l\'aggiornamento dello stato pagamento')
    }
  }

  async function deleteSelectedBookings() {
    if (selectedBookings.size === 0) return

    try {
      // First, get all selected bookings to check for Google Calendar event IDs
      const { data: bookingsToDelete } = await supabase
        .from('bookings')
        .select('*')
        .in('id', Array.from(selectedBookings))

      // Delete from Google Calendar for each booking that has an event ID
      if (bookingsToDelete) {
        for (const booking of bookingsToDelete) {
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
            console.log('Google Calendar event deletion requested for:', booking.id)
          } catch (calError) {
            console.warn('Failed to delete from Google Calendar:', calError)
            // Continue with other deletions
          }
        }
      }

      // Delete from database using serverless function to bypass RLS
      const deletionPromises = Array.from(selectedBookings).map(bookingId =>
        fetch('/.netlify/functions/delete-booking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId })
        }).then(async res => {
          if (!res.ok) {
            const data = await res.json()
            throw new Error(data.error || 'Failed to delete booking')
          }
          return res.json()
        })
      )

      await Promise.all(deletionPromises)

      toast.success(`${selectedBookings.size} prenotazioni eliminate con successo!`)
      setSelectedBookings(new Set())
      setMultiSelectMode(false)
      loadUnpaidBookings()
    } catch (error: any) {
      console.error('Failed to delete bookings:', error)
      toast.error('Errore durante l\'eliminazione delle prenotazioni: ' + (error.message || error))
    }
  }

  async function deleteSingleBooking(bookingId: string) {
    try {
      // First, get the booking to check status and Google Calendar event ID
      const { data: booking } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single()

      // Safety: NEVER delete a paid booking from this tab
      if (booking && (booking.payment_status === 'paid' || booking.payment_status === 'completed' || booking.payment_status === 'succeeded')) {
        toast.error('Impossibile eliminare una prenotazione già pagata!')
        return
      }

      // Try to delete from Google Calendar if event ID exists
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
          console.log('Google Calendar event deletion requested for:', booking.id)
        } catch (calError) {
          console.warn('Failed to delete from Google Calendar:', calError)
          // Continue with database deletion even if Google Calendar deletion fails
        }
      }

      // Delete from database using serverless function
      const res = await fetch('/.netlify/functions/delete-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete booking')
      }

      toast.success('Prenotazione eliminata con successo!')
      loadUnpaidBookings()
    } catch (error: any) {
      console.error('Failed to delete booking:', error)
      toast.error('Errore durante l\'eliminazione della prenotazione: ' + (error.message || error))
    }
  }

  function toggleBookingSelection(bookingId: string) {
    const newSelected = new Set(selectedBookings)
    if (newSelected.has(bookingId)) {
      newSelected.delete(bookingId)
    } else {
      newSelected.add(bookingId)
    }
    setSelectedBookings(newSelected)
  }

  function toggleSelectAll() {
    if (selectedBookings.size === filteredBookings.length) {
      setSelectedBookings(new Set())
    } else {
      setSelectedBookings(new Set(filteredBookings.map(b => b.id)))
    }
  }

  const filteredBookings = filterService === 'all'
    ? bookings
    : bookings.filter(b => b.service_type === filterService)

  const getRemainingAmount = (booking: UnpaidBooking) => {
    let remaining = 0

    // Check main booking payment
    // price_total already includes extension amounts, so don't double-count
    if (booking.payment_status === 'pending' || booking.payment_status === 'unpaid') {
      const total = booking.price_total || 0
      const paid = booking.booking_details?.amountPaid || 0
      remaining += Math.max(0, total - paid)
    } else {
      // Main booking is paid — only count pending extension payments separately
      const extensions = booking.booking_details?.extension_history || []
      extensions.forEach((ext: any) => {
        if (ext.payment_status === 'pending' && ext.additional_amount) {
          remaining += (ext.additional_amount * 100) // Convert to cents
        }
      })
    }

    // Add pending/partial penalties (amounts are in EUR, convert to cents; subtract amountPaid)
    const penalties = booking.booking_details?.penalties || []
    penalties.forEach((p: any) => {
      if (!p.paymentStatus || p.paymentStatus === 'pending' || p.paymentStatus === 'partial') {
        const total = p.total || (p.amount || 0) * (p.quantity || 1)
        const paid = p.amountPaid || 0
        remaining += Math.round((total - paid) * 100)
      }
    })

    // Add pending/partial danni (amounts are in EUR, convert to cents; subtract amountPaid)
    const danni = booking.booking_details?.danni || []
    danni.forEach((d: any) => {
      if (!d.paymentStatus || d.paymentStatus === 'pending' || d.paymentStatus === 'partial') {
        const total = d.total || (d.amount || 0) * (d.quantity || 1)
        const paid = d.amountPaid || 0
        remaining += Math.round((total - paid) * 100)
      }
    })

    // Add unpaid fattura danni/penali items (amounts in EUR, convert to cents)
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

  const getPendingPenalties = (booking: UnpaidBooking) => {
    const penalties = booking.booking_details?.penalties || []
    return penalties.filter((p: any) => !p.paymentStatus || p.paymentStatus === 'pending' || p.paymentStatus === 'partial')
  }

  const getPendingDanni = (booking: UnpaidBooking) => {
    const danni = booking.booking_details?.danni || []
    return danni.filter((d: any) => !d.paymentStatus || d.paymentStatus === 'pending' || d.paymentStatus === 'partial')
  }

  // Returns pending items with their real index in the original array
  const getPendingWithIndex = (booking: UnpaidBooking, arrayKey: 'penalties' | 'danni') => {
    const arr = booking.booking_details?.[arrayKey] || []
    return arr
      .map((item: any, realIdx: number) => ({ item, realIdx }))
      .filter(({ item }: any) => !item.paymentStatus || item.paymentStatus === 'pending' || item.paymentStatus === 'partial')
  }

  const totalUnpaid = filteredBookings.reduce((sum, b) => sum + getRemainingAmount(b), 0)

  // ── Partial payment on a fattura danni/penali item ──────────────────────────
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

  // ── Mark a single fattura item as fully paid ───────────────────────────────
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

  // ── Mark ALL pending penali or danni as paid (grouped) ──────────────────────
  async function markAllTypePaid(booking: UnpaidBooking, type: 'penalties' | 'danni') {
    try {
      const details = booking.booking_details || {}
      const arr: any[] = details[type] || []
      const pending = arr.filter((item: any) => !item.paymentStatus || item.paymentStatus === 'pending' || item.paymentStatus === 'partial')

      if (pending.length > 0) {
        // Generate fattura for remaining amounts
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

        // Mark all as paid in booking_details
        const updated = arr.map((item: any) => {
          if (!item.paymentStatus || item.paymentStatus === 'pending' || item.paymentStatus === 'partial') {
            const total = item.total || (item.amount || 0) * (item.quantity || 1)
            return { ...item, paymentStatus: 'paid', amountPaid: total }
          }
          return item
        })
        await supabase.from('bookings').update({ booking_details: { ...details, [type]: updated } }).eq('id', booking.id)
      }

      // Also mark fattura items of this type as paid
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

  // ── Partial payment across all pending items of a type (single DB write) ────
  async function handleTypePartialPayment(booking: UnpaidBooking, type: 'penalties' | 'danni', paymentAmount: number) {
    try {
      let remaining = paymentAmount

      // Apply to booking_details items
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

      // Apply to fattura items of this type
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

  // Compute total remaining for a type (penalties or danni)
  function getTypeRemaining(booking: UnpaidBooking, type: 'penalties' | 'danni'): number {
    let total = 0
    const pending = getPendingWithIndex(booking, type)
    for (const { item } of pending) {
      const t = item.total || (item.amount || 0) * (item.quantity || 1)
      total += t - (item.amountPaid || 0)
    }
    const fItems = (fatturaItemsMap[booking.id] || []).filter((fi: FatturaItem) => fi.type === type)
    for (const fi of fItems) {
      total += fi.total - fi.amountPaid
    }
    return total
  }

  const getStatusBadge = (booking: UnpaidBooking): { label: string; className: string } => {
    const mainPending = booking.payment_status === 'pending' || booking.payment_status === 'unpaid'
    const bdItems = [...(booking.booking_details?.penalties || []), ...(booking.booking_details?.danni || [])]
    const fItems = fatturaItemsMap[booking.id] || []
    const hasPartial = bdItems.some((item: any) => item.paymentStatus === 'partial') || fItems.some(fi => fi.paymentStatus === 'partial')

    if (mainPending) {
      return { label: 'Da Saldare', className: 'bg-yellow-600 text-black' }
    }
    if (hasPartial) {
      return { label: 'Parziale', className: 'bg-blue-600 text-white' }
    }
    if (hasPendingPenaltyDanni(booking)) {
      const hasPen = getTypeRemaining(booking, 'penalties') > 0
      const hasDan = getTypeRemaining(booking, 'danni') > 0
      const label = hasPen && hasDan ? 'Danni/Penali' : hasDan ? 'Danni' : 'Penali'
      return { label, className: 'bg-orange-600 text-white' }
    }
    if (getPendingExtensions(booking).length > 0) {
      return { label: 'Estensione', className: 'bg-purple-600 text-white' }
    }
    return { label: 'Non Pagato', className: 'bg-red-600 text-theme-text-primary' }
  }

  const getServiceTypeLabel = (serviceType: string) => {
    switch (serviceType) {
      case 'rental': return 'Noleggio'
      case 'car_wash': return 'Lavaggio'
      case 'mechanical_service': return 'Meccanica'
      default: return serviceType || 'Altro'
    }
  }

  const getServiceLabel = (booking: UnpaidBooking) => {
    const serviceType = booking.service_type

    // Check known service types first
    switch (serviceType) {
      case 'rental': return 'Noleggio'
      case 'car_wash': return 'Lavaggio'
      case 'mechanical_service': return 'Meccanica'
    }

    // Fallback logic: determine service type from booking details
    if (booking.vehicle_name) {
      return 'Noleggio' // Has vehicle = rental
    }

    if (booking.service_name) {
      const serviceName = booking.service_name.toLowerCase()
      if (serviceName.includes('lavaggio') || serviceName.includes('wash')) {
        return 'Lavaggio'
      }
      if (serviceName.includes('meccanica') || serviceName.includes('mechanical')) {
        return 'Meccanica'
      }
      return 'Servizio' // Generic service
    }

    // Last resort: show actual value or 'Altro'
    return serviceType || 'Altro'
  }

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-text-primary mx-auto mb-4"></div>
        <p className="text-theme-text-primary">Caricamento prenotazioni da saldare...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="bg-theme-bg-secondary rounded-lg p-3 lg:p-4 border border-theme-border">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-theme-text-primary">Prenotazioni Da Saldare</h2>
            <p className="text-sm text-theme-text-muted mt-1">
              Tutte le prenotazioni con pagamento in sospeso
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
        <div className="bg-theme-bg-secondary p-3 lg:p-4 rounded-lg border border-theme-border">
          <div className="text-xs lg:text-sm text-theme-text-muted">Totale Da Saldare</div>
          <div className="text-xl lg:text-2xl font-bold text-red-400">
            €{(totalUnpaid / 100).toFixed(2)}
          </div>
        </div>
        <div className="bg-theme-bg-secondary p-3 lg:p-4 rounded-lg border border-theme-border">
          <div className="text-xs lg:text-sm text-theme-text-muted">Prenotazioni</div>
          <div className="text-xl lg:text-2xl font-bold text-theme-text-primary">{filteredBookings.length}</div>
        </div>
        <div className="bg-theme-bg-secondary p-3 lg:p-4 rounded-lg border border-theme-border">
          <div className="text-xs lg:text-sm text-theme-text-muted">Noleggio</div>
          <div className="text-xl lg:text-2xl font-bold text-theme-text-primary">
            {bookings.filter(b => b.service_type === 'rental').length}
          </div>
        </div>
        <div className="bg-theme-bg-secondary p-3 lg:p-4 rounded-lg border border-theme-border">
          <div className="text-xs lg:text-sm text-theme-text-muted">Lavaggio + Meccanica</div>
          <div className="text-xl lg:text-2xl font-bold text-theme-text-primary">
            {bookings.filter(b => b.service_type === 'car_wash' || b.service_type === 'mechanical_service').length}
          </div>
        </div>
      </div>

      {/* Filter and Actions */}
      <div className="bg-theme-bg-secondary rounded-lg p-3 lg:p-4 border border-theme-border">
        <div className="flex flex-col lg:flex-row justify-between gap-3 lg:gap-4">
          <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0 lg:flex-wrap">
            <button
              onClick={() => setFilterService('all')}
              className={`px-4 py-2 rounded-full font-medium transition-colors ${filterService === 'all'
                ? 'bg-dr7-gold text-theme-bg-primary'
                : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                }`}
            >
              Tutti ({bookings.length})
            </button>
            <button
              onClick={() => setFilterService('rental')}
              className={`px-4 py-2 rounded-full font-medium transition-colors ${filterService === 'rental'
                ? 'bg-dr7-gold text-theme-bg-primary'
                : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                }`}
            >
              Noleggio ({bookings.filter(b => b.service_type === 'rental').length})
            </button>
            <button
              onClick={() => setFilterService('car_wash')}
              className={`px-4 py-2 rounded-full font-medium transition-colors ${filterService === 'car_wash'
                ? 'bg-dr7-gold text-theme-bg-primary'
                : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                }`}
            >
              Lavaggio ({bookings.filter(b => b.service_type === 'car_wash').length})
            </button>
            <button
              onClick={() => setFilterService('mechanical_service')}
              className={`px-4 py-2 rounded-full font-medium transition-colors ${filterService === 'mechanical_service'
                ? 'bg-dr7-gold text-theme-bg-primary'
                : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                }`}
            >
              Meccanica ({bookings.filter(b => b.service_type === 'mechanical_service').length})
            </button>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => {
                setMultiSelectMode(!multiSelectMode)
                setSelectedBookings(new Set())
              }}
              className={`px-4 py-2 rounded-full font-medium transition-colors ${multiSelectMode
                ? 'bg-blue-600 text-theme-text-primary'
                : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                }`}
            >
              Selezione Multipla
            </button>
            {multiSelectMode && selectedBookings.size > 0 && (
              <>
                <button
                  onClick={markSelectedAsPaid}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-theme-text-primary rounded-full font-medium transition-colors"
                >
                  Segna Pagato ({selectedBookings.size})
                </button>
                <button
                  onClick={deleteSelectedBookings}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-theme-text-primary rounded-full font-medium transition-colors"
                >
                  × ({selectedBookings.size})
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="lg:hidden space-y-3">
        {filteredBookings.map((booking) => (
          <div key={booking.id} className={`bg-theme-bg-secondary rounded-lg border border-theme-border p-3 ${selectedBookings.has(booking.id) ? 'ring-2 ring-blue-500' : ''}`}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                {multiSelectMode && (
                  <input
                    type="checkbox"
                    checked={selectedBookings.has(booking.id)}
                    onChange={() => toggleBookingSelection(booking.id)}
                    className="w-5 h-5 cursor-pointer"
                  />
                )}
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                  booking.service_type === 'rental' ? 'bg-blue-900 text-blue-200' :
                  booking.service_type === 'car_wash' ? 'bg-cyan-900 text-cyan-200' :
                  'bg-orange-900 text-orange-200'
                }`}>
                  {getServiceLabel(booking)}
                </span>
                <span className="text-sm font-semibold text-theme-text-primary">
                  {booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A'}
                </span>
              </div>
              <span className={`px-2 py-0.5 rounded text-xs font-bold flex-shrink-0 ${getStatusBadge(booking).className}`}>
                {getStatusBadge(booking).label}
              </span>
            </div>

            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-theme-text-muted">
                {booking.service_type === 'rental' ? (
                  <>
                    <div className="font-medium">{booking.vehicle_name || '-'}</div>
                    {booking.vehicle_plate && <div className="text-xs">{booking.vehicle_plate}</div>}
                    <div className="text-xs">
                      {booking.pickup_date && new Date(booking.pickup_date).toLocaleDateString('it-IT')} - {booking.return_date && new Date(booking.return_date).toLocaleDateString('it-IT')}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-medium">{booking.service_name || '-'}</div>
                    <div className="text-xs">
                      {booking.appointment_date && new Date(booking.appointment_date).toLocaleDateString('it-IT')} {booking.appointment_time}
                    </div>
                  </>
                )}
              </div>
              <div className="text-right">
                <span className="text-red-400 font-bold text-lg">
                  €{(getRemainingAmount(booking) / 100).toFixed(2)}
                </span>
                {booking.booking_details?.amountPaid > 0 && (
                  <div className="text-xs text-theme-text-muted">
                    su €{(booking.price_total / 100).toFixed(2)}
                  </div>
                )}
                {getPendingExtensions(booking).length > 0 && (
                  <div className="text-xs text-purple-400">
                    incl. {getPendingExtensions(booking).length} estensione/i
                  </div>
                )}
              </div>
            </div>

            {/* Detailed danni/penali items (info only) */}
            {(getPendingPenalties(booking).length > 0 || getPendingDanni(booking).length > 0 || (fatturaItemsMap[booking.id] || []).length > 0) && (
              <div className="space-y-1.5 mb-2">
                {getPendingPenalties(booking).map((p: any, idx: number) => {
                  const pTotal = p.total || (p.amount || 0) * (p.quantity || 1)
                  const pPaid = p.amountPaid || 0
                  return (
                    <DanniPenaliItemRow key={`pen-${idx}`} label={p.label || 'Penale'} total={pTotal} amountPaid={pPaid} remaining={pTotal - pPaid} isPartial={p.paymentStatus === 'partial'} color="yellow" tag="PENALE" />
                  )
                })}
                {getPendingDanni(booking).map((d: any, idx: number) => {
                  const dTotal = d.total || (d.amount || 0) * (d.quantity || 1)
                  const dPaid = d.amountPaid || 0
                  return (
                    <DanniPenaliItemRow key={`dan-${idx}`} label={d.label || 'Danno'} total={dTotal} amountPaid={dPaid} remaining={dTotal - dPaid} isPartial={d.paymentStatus === 'partial'} color="red" tag="DANNO" />
                  )
                })}
                {(fatturaItemsMap[booking.id] || []).map((fi, idx) => (
                  <DanniPenaliItemRow key={`fat-${idx}`} label={`${fi.description} (${fi.fatturaNumero})`} total={fi.total} amountPaid={fi.amountPaid} remaining={fi.total - fi.amountPaid} isPartial={fi.paymentStatus === 'partial'} color={fi.type === 'danni' ? 'red' : 'yellow'} tag={fi.type === 'danni' ? 'DANNO' : 'PENALE'} />
                ))}
              </div>
            )}

            <div className="flex gap-2 flex-wrap pt-2 border-t border-theme-border/50">
              {(booking.payment_status === 'pending' || booking.payment_status === 'unpaid') && (
                <button
                  onClick={() => updatePaymentStatus(booking.id, 'paid')}
                  className="px-3 py-2 min-h-[44px] bg-green-600 hover:bg-green-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors flex-1"
                >
                  Segna Pagato
                </button>
              )}
              {/* Grouped penali buttons */}
              {getTypeRemaining(booking, 'penalties') > 0 && (
                <>
                  <button
                    onClick={() => markAllTypePaid(booking, 'penalties')}
                    className="px-3 py-2 min-h-[44px] bg-green-600 hover:bg-green-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors flex-1"
                  >
                    Penali Pagato
                  </button>
                  {partialPayItemKey !== `${booking.id}:type:penalties` && (
                    <button
                      onClick={() => { setPartialPayItemKey(`${booking.id}:type:penalties`); setPartialPayValue('') }}
                      className="px-3 py-2 min-h-[44px] bg-blue-600 hover:bg-blue-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors flex-1"
                    >
                      Penali Parziale
                    </button>
                  )}
                </>
              )}
              {partialPayItemKey === `${booking.id}:type:penalties` && (
                <div className="flex items-center gap-1.5 flex-1">
                  <div className="relative flex-1">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted text-xs">€</span>
                    <input type="number" step="0.01" min="0.01" value={partialPayValue} onChange={e => setPartialPayValue(e.target.value)} placeholder="Importo" className="w-full pl-6 pr-2 py-2 min-h-[44px] bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/50" onKeyDown={e => { if (e.key === 'Enter') { const v = parseFloat(partialPayValue); if (!isNaN(v) && v > 0) { handleTypePartialPayment(booking, 'penalties', v); setPartialPayItemKey(null) } } if (e.key === 'Escape') setPartialPayItemKey(null) }} autoFocus />
                  </div>
                  <button onClick={() => { const v = parseFloat(partialPayValue); if (!isNaN(v) && v > 0) { handleTypePartialPayment(booking, 'penalties', v); setPartialPayItemKey(null) } }} disabled={!partialPayValue || parseFloat(partialPayValue) <= 0} className="px-3 py-2 min-h-[44px] bg-green-600 hover:bg-green-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors disabled:opacity-30">OK</button>
                  <button onClick={() => setPartialPayItemKey(null)} className="px-3 py-2 min-h-[44px] bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover rounded-full text-xs font-semibold transition-colors">×</button>
                </div>
              )}
              {/* Grouped danni buttons */}
              {getTypeRemaining(booking, 'danni') > 0 && (
                <>
                  <button
                    onClick={() => markAllTypePaid(booking, 'danni')}
                    className="px-3 py-2 min-h-[44px] bg-green-600 hover:bg-green-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors flex-1"
                  >
                    Danni Pagato
                  </button>
                  {partialPayItemKey !== `${booking.id}:type:danni` && (
                    <button
                      onClick={() => { setPartialPayItemKey(`${booking.id}:type:danni`); setPartialPayValue('') }}
                      className="px-3 py-2 min-h-[44px] bg-blue-600 hover:bg-blue-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors flex-1"
                    >
                      Danni Parziale
                    </button>
                  )}
                </>
              )}
              {partialPayItemKey === `${booking.id}:type:danni` && (
                <div className="flex items-center gap-1.5 flex-1">
                  <div className="relative flex-1">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted text-xs">€</span>
                    <input type="number" step="0.01" min="0.01" value={partialPayValue} onChange={e => setPartialPayValue(e.target.value)} placeholder="Importo" className="w-full pl-6 pr-2 py-2 min-h-[44px] bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/50" onKeyDown={e => { if (e.key === 'Enter') { const v = parseFloat(partialPayValue); if (!isNaN(v) && v > 0) { handleTypePartialPayment(booking, 'danni', v); setPartialPayItemKey(null) } } if (e.key === 'Escape') setPartialPayItemKey(null) }} autoFocus />
                  </div>
                  <button onClick={() => { const v = parseFloat(partialPayValue); if (!isNaN(v) && v > 0) { handleTypePartialPayment(booking, 'danni', v); setPartialPayItemKey(null) } }} disabled={!partialPayValue || parseFloat(partialPayValue) <= 0} className="px-3 py-2 min-h-[44px] bg-green-600 hover:bg-green-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors disabled:opacity-30">OK</button>
                  <button onClick={() => setPartialPayItemKey(null)} className="px-3 py-2 min-h-[44px] bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover rounded-full text-xs font-semibold transition-colors">×</button>
                </div>
              )}
              {getPendingExtensions(booking).length > 0 && (
                <button
                  onClick={() => markExtensionsPaid(booking)}
                  className="px-3 py-2 min-h-[44px] bg-purple-600 hover:bg-purple-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors flex-1"
                >
                  Estensioni Pagate
                </button>
              )}
              {hasPendingPenaltyDanni(booking) ? (
                <button
                  onClick={() => removePendingPenaltiesDanni(booking)}
                  className="px-3 py-2 min-h-[44px] bg-red-600 hover:bg-red-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors"
                >
                  ×
                </button>
              ) : (
                <button
                  onClick={() => deleteSingleBooking(booking.id)}
                  className="px-3 py-2 min-h-[44px] bg-red-600 hover:bg-red-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
        {filteredBookings.length === 0 && (
          <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-8 text-center text-theme-text-muted">
            {filterService === 'all'
              ? 'Nessuna prenotazione da saldare!'
              : `Nessuna prenotazione ${getServiceTypeLabel(filterService).toLowerCase()} da saldare`
            }
          </div>
        )}
      </div>

      {/* Bookings Table (Desktop) */}
      <div className="hidden lg:block bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="">
              <tr>
                {multiSelectMode && (
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">
                    <input
                      type="checkbox"
                      checked={selectedBookings.size === filteredBookings.length && filteredBookings.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 cursor-pointer"
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Servizio</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Cliente</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Dettagli</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Data</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Da Saldare</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Stato</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filteredBookings.map((booking) => (
                <tr key={booking.id} className={`border-t border-theme-border hover:bg-theme-bg-tertiary ${selectedBookings.has(booking.id) ? 'bg-blue-900/30' : ''
                  }`}>
                  {multiSelectMode && (
                    <td className="px-4 py-3 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedBookings.has(booking.id)}
                        onChange={() => toggleBookingSelection(booking.id)}
                        className="w-4 h-4 cursor-pointer"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 text-sm">
                    <span className="text-theme-text-primary font-medium">{getServiceLabel(booking)}</span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="text-theme-text-primary font-semibold">{booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A'}</div>
                    <div className="text-theme-text-muted text-xs">{booking.customer_email || booking.booking_details?.customer?.email || '-'}</div>
                    <div className="text-theme-text-muted text-xs">{booking.customer_phone || booking.booking_details?.customer?.phone || '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {booking.service_type === 'rental' ? (
                      <div>
                        <div className="text-theme-text-primary font-medium">{booking.vehicle_name || '-'}</div>
                        {booking.vehicle_plate && <div className="text-theme-text-muted text-xs">{booking.vehicle_plate}</div>}
                        <div className="text-theme-text-muted text-xs">
                          {booking.pickup_date && new Date(booking.pickup_date).toLocaleDateString('it-IT')} - {booking.return_date && new Date(booking.return_date).toLocaleDateString('it-IT')}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-theme-text-primary font-medium">{booking.service_name || '-'}</div>
                        <div className="text-theme-text-muted text-xs">
                          {booking.appointment_date && new Date(booking.appointment_date).toLocaleDateString('it-IT')} {booking.appointment_time}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-theme-text-muted">
                    {new Date(booking.created_at).toLocaleDateString('it-IT')}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className="text-red-400 font-bold text-lg">
                      €{(getRemainingAmount(booking) / 100).toFixed(2)}
                    </span>
                    {booking.booking_details?.amountPaid > 0 && (
                      <div className="text-xs text-theme-text-muted">
                        su €{(booking.price_total / 100).toFixed(2)}
                      </div>
                    )}
                    {getPendingExtensions(booking).length > 0 && (
                      <div className="text-xs text-purple-400 mt-1">
                        incl. {getPendingExtensions(booking).length} estensione/i
                      </div>
                    )}
                    {/* Detailed danni/penali items (info only) */}
                    {getPendingPenalties(booking).map((p: any, idx: number) => {
                      const pTotal = p.total || (p.amount || 0) * (p.quantity || 1)
                      const pPaid = p.amountPaid || 0
                      return <DanniPenaliItemRow key={`pen-${idx}`} label={p.label || 'Penale'} total={pTotal} amountPaid={pPaid} remaining={pTotal - pPaid} isPartial={p.paymentStatus === 'partial'} color="yellow" tag="PENALE" />
                    })}
                    {getPendingDanni(booking).map((d: any, idx: number) => {
                      const dTotal = d.total || (d.amount || 0) * (d.quantity || 1)
                      const dPaid = d.amountPaid || 0
                      return <DanniPenaliItemRow key={`dan-${idx}`} label={d.label || 'Danno'} total={dTotal} amountPaid={dPaid} remaining={dTotal - dPaid} isPartial={d.paymentStatus === 'partial'} color="red" tag="DANNO" />
                    })}
                    {(fatturaItemsMap[booking.id] || []).map((fi, idx) => (
                      <DanniPenaliItemRow key={`fat-${idx}`} label={`${fi.description} (${fi.fatturaNumero})`} total={fi.total} amountPaid={fi.amountPaid} remaining={fi.total - fi.amountPaid} isPartial={fi.paymentStatus === 'partial'} color={fi.type === 'danni' ? 'red' : 'yellow'} tag={fi.type === 'danni' ? 'DANNO' : 'PENALE'} />
                    ))}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${getStatusBadge(booking).className}`}>
                      {getStatusBadge(booking).label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex gap-2 flex-wrap">
                      {(booking.payment_status === 'pending' || booking.payment_status === 'unpaid') && (
                        <button
                          onClick={() => updatePaymentStatus(booking.id, 'paid')}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors"
                        >
                          Segna Pagato
                        </button>
                      )}
                      {/* Grouped penali buttons */}
                      {getTypeRemaining(booking, 'penalties') > 0 && (
                        <>
                          <button
                            onClick={() => markAllTypePaid(booking, 'penalties')}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors"
                          >
                            Penali Pagato
                          </button>
                          {partialPayItemKey !== `${booking.id}:type:penalties` && (
                            <button
                              onClick={() => { setPartialPayItemKey(`${booking.id}:type:penalties`); setPartialPayValue('') }}
                              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors"
                            >
                              Penali Parziale
                            </button>
                          )}
                        </>
                      )}
                      {partialPayItemKey === `${booking.id}:type:penalties` && (
                        <div className="flex items-center gap-1">
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-theme-text-muted text-xs">€</span>
                            <input type="number" step="0.01" min="0.01" value={partialPayValue} onChange={e => setPartialPayValue(e.target.value)} placeholder="Importo" className="w-24 pl-5 pr-1.5 py-1 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/50" onKeyDown={e => { if (e.key === 'Enter') { const v = parseFloat(partialPayValue); if (!isNaN(v) && v > 0) { handleTypePartialPayment(booking, 'penalties', v); setPartialPayItemKey(null) } } if (e.key === 'Escape') setPartialPayItemKey(null) }} autoFocus />
                          </div>
                          <button onClick={() => { const v = parseFloat(partialPayValue); if (!isNaN(v) && v > 0) { handleTypePartialPayment(booking, 'penalties', v); setPartialPayItemKey(null) } }} disabled={!partialPayValue || parseFloat(partialPayValue) <= 0} className="px-2 py-1 bg-green-600 hover:bg-green-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors disabled:opacity-30">OK</button>
                          <button onClick={() => setPartialPayItemKey(null)} className="px-2 py-1 bg-theme-bg-tertiary hover:bg-theme-bg-secondary text-theme-text-muted rounded-full text-xs transition-colors">×</button>
                        </div>
                      )}
                      {/* Grouped danni buttons */}
                      {getTypeRemaining(booking, 'danni') > 0 && (
                        <>
                          <button
                            onClick={() => markAllTypePaid(booking, 'danni')}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors"
                          >
                            Danni Pagato
                          </button>
                          {partialPayItemKey !== `${booking.id}:type:danni` && (
                            <button
                              onClick={() => { setPartialPayItemKey(`${booking.id}:type:danni`); setPartialPayValue('') }}
                              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors"
                            >
                              Danni Parziale
                            </button>
                          )}
                        </>
                      )}
                      {partialPayItemKey === `${booking.id}:type:danni` && (
                        <div className="flex items-center gap-1">
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-theme-text-muted text-xs">€</span>
                            <input type="number" step="0.01" min="0.01" value={partialPayValue} onChange={e => setPartialPayValue(e.target.value)} placeholder="Importo" className="w-24 pl-5 pr-1.5 py-1 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/50" onKeyDown={e => { if (e.key === 'Enter') { const v = parseFloat(partialPayValue); if (!isNaN(v) && v > 0) { handleTypePartialPayment(booking, 'danni', v); setPartialPayItemKey(null) } } if (e.key === 'Escape') setPartialPayItemKey(null) }} autoFocus />
                          </div>
                          <button onClick={() => { const v = parseFloat(partialPayValue); if (!isNaN(v) && v > 0) { handleTypePartialPayment(booking, 'danni', v); setPartialPayItemKey(null) } }} disabled={!partialPayValue || parseFloat(partialPayValue) <= 0} className="px-2 py-1 bg-green-600 hover:bg-green-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors disabled:opacity-30">OK</button>
                          <button onClick={() => setPartialPayItemKey(null)} className="px-2 py-1 bg-theme-bg-tertiary hover:bg-theme-bg-secondary text-theme-text-muted rounded-full text-xs transition-colors">×</button>
                        </div>
                      )}
                      {getPendingExtensions(booking).length > 0 && (
                        <button
                          onClick={() => markExtensionsPaid(booking)}
                          className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors"
                        >
                          Estensioni Pagate
                        </button>
                      )}
                      {hasPendingPenaltyDanni(booking) ? (
                        <button
                          onClick={() => removePendingPenaltiesDanni(booking)}
                          className="px-3 py-1 bg-red-600 hover:bg-red-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors"
                        >
                          ×
                        </button>
                      ) : (
                        <button
                          onClick={() => deleteSingleBooking(booking.id)}
                          className="px-3 py-1 bg-red-600 hover:bg-red-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredBookings.length === 0 && (
                <tr>
                  <td colSpan={multiSelectMode ? 8 : 7} className="px-4 py-8 text-center text-theme-text-muted">
                    {filterService === 'all'
                      ? 'Nessuna prenotazione da saldare!'
                      : `Nessuna prenotazione ${getServiceTypeLabel(filterService).toLowerCase()} da saldare`
                    }
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

// ── Info-only danni/penali item row ───────────────────────────────────────────
function DanniPenaliItemRow({ label, total, amountPaid, remaining, isPartial, color, tag }: {
  label: string
  total: number
  amountPaid: number
  remaining: number
  isPartial: boolean
  color: 'yellow' | 'red'
  tag: string
}) {
  const colorClasses = color === 'yellow'
    ? { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20' }
    : { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' }

  return (
    <div className={`${colorClasses.bg} border ${colorClasses.border} rounded-lg px-2.5 py-1.5 mt-1`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] font-bold ${colorClasses.text}`}>{tag}</span>
            <span className="text-[11px] text-theme-text-primary truncate">{label}</span>
          </div>
          {isPartial && (
            <div className="text-[10px] text-blue-400">
              €{amountPaid.toFixed(2)} pagati su €{total.toFixed(2)} — €{remaining.toFixed(2)} rimanenti
            </div>
          )}
        </div>
        <span className={`font-semibold text-[12px] tabular-nums shrink-0 ${colorClasses.text}`}>
          €{remaining.toFixed(2)}
        </span>
      </div>
    </div>
  )
}
