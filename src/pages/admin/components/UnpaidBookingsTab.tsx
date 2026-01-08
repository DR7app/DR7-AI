import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

interface UnpaidBooking {
  id: string
  service_type: 'rental' | 'car_wash' | 'mechanical_service'
  customer_name: string
  customer_email: string
  customer_phone: string
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
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .in('payment_status', ['pending', 'unpaid'])
        .neq('status', 'cancelled')
        .neq('customer_name', 'Auto-generato (Rientro)')  // Exclude auto-generated car wash rientri
        .order('created_at', { ascending: false })

      if (error) throw error

      setBookings(data || [])
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
        .update({ payment_status: newStatus })
        .eq('id', bookingId)

      if (error) throw error

      alert('Stato pagamento aggiornato!')
      loadUnpaidBookings()
    } catch (error) {
      console.error('Failed to update payment status:', error)
      alert('Errore nell\'aggiornamento dello stato pagamento')
    }
  }

  async function markSelectedAsPaid() {
    if (selectedBookings.size === 0) return

    if (!confirm(`Segnare ${selectedBookings.size} prenotazioni come pagate?`)) {
      return
    }

    try {
      const { error } = await supabase
        .from('bookings')
        .update({
          payment_status: 'paid',
          status: 'confirmed'
        })
        .in('id', Array.from(selectedBookings))

      if (error) throw error

      alert(`${selectedBookings.size} prenotazioni segnate come pagate!`)
      setSelectedBookings(new Set())
      setMultiSelectMode(false)
      loadUnpaidBookings()
    } catch (error) {
      console.error('Failed to mark bookings as paid:', error)
      alert('Errore durante l\'aggiornamento dello stato pagamento')
    }
  }

  async function deleteSelectedBookings() {
    if (selectedBookings.size === 0) return

    if (!confirm(`Sei sicuro di voler eliminare ${selectedBookings.size} prenotazioni?`)) {
      return
    }

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

      alert(`${selectedBookings.size} prenotazioni eliminate con successo!`)
      setSelectedBookings(new Set())
      setMultiSelectMode(false)
      loadUnpaidBookings()
    } catch (error: any) {
      console.error('Failed to delete bookings:', error)
      alert('Errore durante l\'eliminazione delle prenotazioni: ' + (error.message || error))
    }
  }

  async function deleteSingleBooking(bookingId: string) {
    if (!confirm('Sei sicuro di voler eliminare questa prenotazione?')) {
      return
    }

    try {
      // First, get the booking to check if it has a Google Calendar event ID
      const { data: booking } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single()

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

      alert('Prenotazione eliminata con successo!')
      loadUnpaidBookings()
    } catch (error: any) {
      console.error('Failed to delete booking:', error)
      alert('Errore durante l\'eliminazione della prenotazione: ' + (error.message || error))
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
    const total = booking.price_total || 0
    const paid = booking.booking_details?.amountPaid || 0
    return Math.max(0, total - paid)
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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
        <p className="text-white">Caricamento prenotazioni da saldare...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-white">Prenotazioni Da Saldare</h2>
            <p className="text-sm text-gray-400 mt-1">
              Tutte le prenotazioni con pagamento in sospeso
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gray-900 p-4 rounded-lg border border-gray-700">
          <div className="text-sm text-gray-400">Totale Da Saldare</div>
          <div className="text-2xl font-bold text-red-400">
            €{(totalUnpaid / 100).toFixed(2)}
          </div>
        </div>
        <div className="bg-gray-900 p-4 rounded-lg border border-gray-700">
          <div className="text-sm text-gray-400">Prenotazioni</div>
          <div className="text-2xl font-bold text-white">{filteredBookings.length}</div>
        </div>
        <div className="bg-gray-900 p-4 rounded-lg border border-gray-700">
          <div className="text-sm text-gray-400">Noleggio</div>
          <div className="text-2xl font-bold text-white">
            {bookings.filter(b => b.service_type === 'rental').length}
          </div>
        </div>
        <div className="bg-gray-900 p-4 rounded-lg border border-gray-700">
          <div className="text-sm text-gray-400">Lavaggio + Meccanica</div>
          <div className="text-2xl font-bold text-white">
            {bookings.filter(b => b.service_type === 'car_wash' || b.service_type === 'mechanical_service').length}
          </div>
        </div>
      </div>

      {/* Filter and Actions */}
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
        <div className="flex flex-col lg:flex-row justify-between gap-4">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setFilterService('all')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${filterService === 'all'
                ? 'bg-dr7-gold text-black'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
            >
              Tutti ({bookings.length})
            </button>
            <button
              onClick={() => setFilterService('rental')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${filterService === 'rental'
                ? 'bg-dr7-gold text-black'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
            >
              Noleggio ({bookings.filter(b => b.service_type === 'rental').length})
            </button>
            <button
              onClick={() => setFilterService('car_wash')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${filterService === 'car_wash'
                ? 'bg-dr7-gold text-black'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
            >
              Lavaggio ({bookings.filter(b => b.service_type === 'car_wash').length})
            </button>
            <button
              onClick={() => setFilterService('mechanical_service')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${filterService === 'mechanical_service'
                ? 'bg-dr7-gold text-black'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
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
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${multiSelectMode
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
            >
              Selezione Multipla
            </button>
            {multiSelectMode && selectedBookings.size > 0 && (
              <>
                <button
                  onClick={markSelectedAsPaid}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                >
                  Segna Pagato ({selectedBookings.size})
                </button>
                <button
                  onClick={deleteSelectedBookings}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
                >
                  Elimina ({selectedBookings.size})
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Bookings Table */}
      <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-black">
              <tr>
                {multiSelectMode && (
                  <th className="px-4 py-3 text-left text-sm font-semibold text-white">
                    <input
                      type="checkbox"
                      checked={selectedBookings.size === filteredBookings.length && filteredBookings.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 cursor-pointer"
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left text-sm font-semibold text-white">Servizio</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-white">Cliente</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-white">Dettagli</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-white">Data</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-white">Da Saldare</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-white">Stato</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-white">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filteredBookings.map((booking) => (
                <tr key={booking.id} className={`border-t border-gray-700 hover:bg-gray-800 ${selectedBookings.has(booking.id) ? 'bg-blue-900/30' : ''
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
                    <span className="text-white font-medium">{getServiceLabel(booking)}</span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="text-white font-semibold">{booking.customer_name}</div>
                    <div className="text-gray-400 text-xs">{booking.customer_email}</div>
                    <div className="text-gray-400 text-xs">{booking.customer_phone}</div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {booking.service_type === 'rental' ? (
                      <div>
                        <div className="text-white">{booking.vehicle_name}</div>
                        <div className="text-gray-400 text-xs">
                          {booking.pickup_date && new Date(booking.pickup_date).toLocaleDateString('it-IT')} -
                          {booking.return_date && new Date(booking.return_date).toLocaleDateString('it-IT')}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-white">{booking.service_name}</div>
                        <div className="text-gray-400 text-xs">
                          {booking.appointment_date && new Date(booking.appointment_date).toLocaleDateString('it-IT')} {booking.appointment_time}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">
                    {new Date(booking.created_at).toLocaleDateString('it-IT')}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className="text-red-400 font-bold text-lg">
                      €{(getRemainingAmount(booking) / 100).toFixed(2)}
                    </span>
                    {booking.booking_details?.amountPaid > 0 && (
                      <div className="text-xs text-gray-400">
                        su €{(booking.price_total / 100).toFixed(2)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${booking.payment_status === 'pending'
                      ? 'bg-yellow-600 text-black'
                      : 'bg-red-600 text-white'
                      }`}>
                      {booking.payment_status === 'pending' ? 'Da Saldare' : 'Non Pagato'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex gap-2">
                      <button
                        onClick={() => updatePaymentStatus(booking.id, 'paid')}
                        className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold transition-colors"
                      >
                        Segna Pagato
                      </button>
                      <button
                        onClick={() => deleteSingleBooking(booking.id)}
                        className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition-colors"
                      >
                        Elimina
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredBookings.length === 0 && (
                <tr>
                  <td colSpan={multiSelectMode ? 8 : 7} className="px-4 py-8 text-center text-gray-500">
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
