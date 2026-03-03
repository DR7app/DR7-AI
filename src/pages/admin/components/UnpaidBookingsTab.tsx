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

export default function UnpaidBookingsTab() {
  const [bookings, setBookings] = useState<UnpaidBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [filterService, setFilterService] = useState<'all' | 'rental' | 'car_wash' | 'mechanical_service'>('all')
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedBookings, setSelectedBookings] = useState<Set<string>>(new Set())

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
      // Load bookings with pending payment OR bookings with pending extension payments
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .neq('status', 'cancelled')
        .neq('customer_name', 'Lavaggio Rientro')  // Exclude auto-generated car wash rientri
        .order('created_at', { ascending: false })

      if (error) throw error

      // Filter to include:
      // 1. Bookings with pending/unpaid payment_status
      // 2. Bookings with extension_history containing pending payments
      // 3. Bookings with pending penalties or danni in booking_details
      const unpaidBookings = (data || []).filter(booking => {
        // Check main payment status
        if (booking.payment_status === 'pending' || booking.payment_status === 'unpaid') {
          return true
        }

        // Check extension payments
        const extensions = booking.booking_details?.extension_history || []
        const hasPendingExtension = extensions.some((ext: any) => ext.payment_status === 'pending')
        if (hasPendingExtension) return true

        // Check pending penalties
        const penalties = booking.booking_details?.penalties || []
        const hasPendingPenalty = penalties.some((p: any) => p.paymentStatus === 'pending')
        if (hasPendingPenalty) return true

        // Check pending danni
        const danni = booking.booking_details?.danni || []
        const hasPendingDanno = danni.some((d: any) => d.paymentStatus === 'pending')
        if (hasPendingDanno) return true

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
    return penalties.some((p: any) => p.paymentStatus === 'pending') || danni.some((d: any) => d.paymentStatus === 'pending')
  }

  async function removePendingPenaltiesDanni(booking: UnpaidBooking) {
    try {
      const details = booking.booking_details || {}
      const penalties = (details.penalties || []).filter((p: any) => p.paymentStatus !== 'pending')
      const danni = (details.danni || []).filter((d: any) => d.paymentStatus !== 'pending')

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

  async function markPenaltiesDanniPaid(booking: UnpaidBooking) {
    try {
      const details = booking.booking_details || {}
      const pendingPenalties = (details.penalties || []).filter((p: any) => p.paymentStatus === 'pending')
      const pendingDanni = (details.danni || []).filter((d: any) => d.paymentStatus === 'pending')

      // Generate fattura for pending penalties
      if (pendingPenalties.length > 0) {
        const res = await fetch('/.netlify/functions/generate-penalty-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: booking.id,
            customerId: booking.customer_id || booking.user_id,
            items: pendingPenalties.map((p: any) => ({ label: p.label, amount: p.amount, quantity: p.quantity || 1 })),
            paymentStatus: 'paid'
          })
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.message || err.error || 'Errore generazione fattura penali')
        }
      }

      // Generate fattura for pending danni
      if (pendingDanni.length > 0) {
        const res = await fetch('/.netlify/functions/generate-penalty-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: booking.id,
            customerId: booking.customer_id || booking.user_id,
            items: pendingDanni.map((d: any) => ({ label: d.label, amount: d.amount, quantity: d.quantity || 1 })),
            type: 'danni',
            paymentStatus: 'paid'
          })
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.message || err.error || 'Errore generazione fattura danni')
        }
      }

      // Remove pending entries from booking_details
      const updatedPenalties = (details.penalties || []).filter((p: any) => p.paymentStatus !== 'pending')
      const updatedDanni = (details.danni || []).filter((d: any) => d.paymentStatus !== 'pending')

      await supabase
        .from('bookings')
        .update({
          booking_details: {
            ...details,
            penalties: updatedPenalties,
            danni: updatedDanni
          }
        })
        .eq('id', booking.id)

      toast.success('Penali/Danni segnati come pagati! Fattura generata e inviata a SDI.')
      loadUnpaidBookings()
    } catch (error: any) {
      console.error('Failed to mark penalties/danni as paid:', error)
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

    // Add pending penalties (amounts are in EUR, convert to cents)
    const penalties = booking.booking_details?.penalties || []
    penalties.forEach((p: any) => {
      if (p.paymentStatus === 'pending') {
        remaining += Math.round((p.total || (p.amount || 0) * (p.quantity || 1)) * 100)
      }
    })

    // Add pending danni (amounts are in EUR, convert to cents)
    const danni = booking.booking_details?.danni || []
    danni.forEach((d: any) => {
      if (d.paymentStatus === 'pending') {
        remaining += Math.round((d.total || (d.amount || 0) * (d.quantity || 1)) * 100)
      }
    })

    return remaining
  }

  const getPendingExtensions = (booking: UnpaidBooking) => {
    const extensions = booking.booking_details?.extension_history || []
    return extensions.filter((ext: any) => ext.payment_status === 'pending')
  }

  const getPendingPenalties = (booking: UnpaidBooking) => {
    const penalties = booking.booking_details?.penalties || []
    return penalties.filter((p: any) => p.paymentStatus === 'pending')
  }

  const getPendingDanni = (booking: UnpaidBooking) => {
    const danni = booking.booking_details?.danni || []
    return danni.filter((d: any) => d.paymentStatus === 'pending')
  }

  const totalUnpaid = filteredBookings.reduce((sum, b) => sum + getRemainingAmount(b), 0)

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
              <span className={`px-2 py-0.5 rounded text-xs font-bold flex-shrink-0 ${booking.payment_status === 'pending'
                ? 'bg-yellow-600 text-black'
                : 'bg-red-600 text-theme-text-primary'
              }`}>
                {booking.payment_status === 'pending' ? 'Da Saldare' : 'Non Pagato'}
              </span>
            </div>

            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-theme-text-muted">
                {booking.service_type === 'rental' ? (
                  <>
                    <div>{booking.vehicle_name}</div>
                    <div className="text-xs">
                      {booking.pickup_date && new Date(booking.pickup_date).toLocaleDateString('it-IT')} - {booking.return_date && new Date(booking.return_date).toLocaleDateString('it-IT')}
                    </div>
                  </>
                ) : (
                  <>
                    <div>{booking.service_name}</div>
                    <div className="text-xs">
                      {booking.appointment_date && new Date(booking.appointment_date).toLocaleDateString('it-IT')} {booking.appointment_time}
                    </div>
                  </>
                )}
                {getPendingPenalties(booking).length > 0 && (
                  <div className="text-xs text-yellow-400 font-medium mt-1">PENALE</div>
                )}
                {getPendingDanni(booking).length > 0 && (
                  <div className="text-xs text-red-400 font-medium mt-1">DANNO</div>
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
                {getPendingPenalties(booking).length > 0 && (
                  <div className="text-xs text-yellow-400">
                    incl. {getPendingPenalties(booking).length} penale/i
                  </div>
                )}
                {getPendingDanni(booking).length > 0 && (
                  <div className="text-xs text-red-400">
                    incl. {getPendingDanni(booking).length} danno/i
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 flex-wrap pt-2 border-t border-theme-border/50">
              {(booking.payment_status === 'pending' || booking.payment_status === 'unpaid') && (
                <button
                  onClick={() => updatePaymentStatus(booking.id, 'paid')}
                  className="px-3 py-2 min-h-[44px] bg-green-600 hover:bg-green-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors flex-1"
                >
                  Segna Pagato
                </button>
              )}
              {hasPendingPenaltyDanni(booking) && (
                <button
                  onClick={() => markPenaltiesDanniPaid(booking)}
                  className="px-3 py-2 min-h-[44px] bg-green-600 hover:bg-green-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors flex-1"
                >
                  Segna Pagato
                </button>
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
                        <div className="text-theme-text-primary">{booking.vehicle_name}</div>
                        <div className="text-theme-text-muted text-xs">
                          {booking.pickup_date && new Date(booking.pickup_date).toLocaleDateString('it-IT')} -
                          {booking.return_date && new Date(booking.return_date).toLocaleDateString('it-IT')}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-theme-text-primary">{booking.service_name}</div>
                        <div className="text-theme-text-muted text-xs">
                          {booking.appointment_date && new Date(booking.appointment_date).toLocaleDateString('it-IT')} {booking.appointment_time}
                        </div>
                      </div>
                    )}
                    {getPendingPenalties(booking).length > 0 && (
                      <div className="text-xs text-yellow-400 font-medium mt-1">PENALE</div>
                    )}
                    {getPendingDanni(booking).length > 0 && (
                      <div className="text-xs text-red-400 font-medium mt-1">DANNO</div>
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
                    {getPendingPenalties(booking).length > 0 && (
                      <div className="text-xs text-yellow-400 mt-1">
                        incl. {getPendingPenalties(booking).length} penale/i
                      </div>
                    )}
                    {getPendingDanni(booking).length > 0 && (
                      <div className="text-xs text-red-400 mt-1">
                        incl. {getPendingDanni(booking).length} danno/i
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${booking.payment_status === 'pending'
                      ? 'bg-yellow-600 text-black'
                      : 'bg-red-600 text-theme-text-primary'
                      }`}>
                      {booking.payment_status === 'pending' ? 'Da Saldare' : 'Non Pagato'}
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
                      {hasPendingPenaltyDanni(booking) && (
                        <button
                          onClick={() => markPenaltiesDanniPaid(booking)}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 text-theme-text-primary rounded-full text-xs font-semibold transition-colors"
                        >
                          Segna Pagato
                        </button>
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
