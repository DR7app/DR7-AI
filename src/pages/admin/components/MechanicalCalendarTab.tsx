import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import { FinancialData } from '../../../components/FinancialData'
import { useAdminRole } from '../../../hooks/useAdminRole'
import MechanicalBookingForm from './MechanicalBookingForm'

interface MechanicalBooking {
  id: string
  customer_name: string
  customer_email: string
  customer_phone: string
  service_name: string
  vehicle_name: string
  appointment_date: string
  appointment_time: string
  price_total: number
  status: string
  payment_status: string
  booking_details: any
  created_at: string
}

interface Customer {
  id: string
  full_name: string
  email: string | null
  phone: string | null
}

// Generate time slots for mechanical: 9h-19h, every 30 minutes
const generateTimeSlots = () => {
  const slots: string[] = []

  // Morning slots: 9h-13h
  for (let hour = 9; hour <= 12; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
      slots.push(time)
    }
  }
  slots.push('13:00') // Add 13:00 slot

  // Afternoon slots: 15h-19h
  for (let hour = 15; hour <= 18; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
      slots.push(time)
    }
  }
  slots.push('19:00') // Add 19:00 slot

  return slots
}

const TIME_SLOTS = generateTimeSlots()

export default function MechanicalCalendarTab() {
  const { canViewFinancials } = useAdminRole()
  const [hideFinancials, setHideFinancials] = useState(false)
  const [bookings, setBookings] = useState<MechanicalBooking[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedCell, setSelectedCell] = useState<{
    date: string
    time: string
    bookings: MechanicalBooking[]
  } | null>(null)
  const [editingBooking, setEditingBooking] = useState<MechanicalBooking | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    loadData()

    // Real-time subscription
    const subscription = supabase
      .channel('mechanical-calendar-updates')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        () => loadData()
      )
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      // Load customers from customers_extended (includes all customers from all sources)
      const { data: customersData, error: customersError } = await supabase
        .from('customers_extended')
        .select('id, nome, cognome, ragione_sociale, email, telefono')
        .order('cognome')

      if (customersError) throw customersError

      // Map customers_extended to Customer interface
      const mappedCustomers: Customer[] = (customersData || []).map((c: any) => ({
        id: c.id,
        full_name: c.ragione_sociale || `${c.nome || ''} ${c.cognome || ''}`.trim(),
        email: c.email,
        phone: c.telefono
      }))

      setCustomers(mappedCustomers)

      // Load mechanical bookings (exclude cancelled)
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .eq('service_type', 'mechanical_service')
        .neq('status', 'cancelled')
        .order('appointment_date', { ascending: true })

      if (bookingsError) throw bookingsError

      console.log('🔧 MECHANICAL CALENDAR - Prenotazioni caricate:', bookingsData?.length || 0)

      setBookings(bookingsData || [])
    } catch (error) {
      console.error('Failed to load mechanical bookings:', error)
    } finally {
      setLoading(false)
    }
  }

  const daysInMonth = useMemo(() => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const lastDay = new Date(year, month + 1, 0).getDate()
    return Array.from({ length: lastDay }, (_, i) => i + 1)
  }, [currentDate])

  const isSlotBooked = (day: number, timeSlot: string): boolean => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const checkDate = new Date(year, month, day)
    const dateString = checkDate.toISOString().split('T')[0]

    return bookings.some(booking => {
      const bookingDate = booking.appointment_date?.split('T')[0]
      return bookingDate === dateString && booking.appointment_time === timeSlot
    })
  }

  const getSlotBookings = (day: number, timeSlot: string): MechanicalBooking[] => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const checkDate = new Date(year, month, day)
    const dateString = checkDate.toISOString().split('T')[0]

    return bookings.filter(booking => {
      const bookingDate = booking.appointment_date?.split('T')[0]
      return bookingDate === dateString && booking.appointment_time === timeSlot
    })
  }

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(prev => {
      const newDate = new Date(prev)
      if (direction === 'prev') {
        newDate.setMonth(prev.getMonth() - 1)
      } else {
        newDate.setMonth(prev.getMonth() + 1)
      }
      return newDate
    })
  }

  const monthName = currentDate.toLocaleDateString('it-IT', {
    month: 'long',
    year: 'numeric'
  })

  // Filter bookings by customer search
  const matchingBookings = useMemo(() => {
    if (!searchQuery.trim()) return []

    const query = searchQuery.toLowerCase()
    return bookings.filter(booking => {
      const customerName = booking.customer_name || booking.booking_details?.customer?.fullName
      if (!customerName) return false
      return customerName.toLowerCase().includes(query)
    })
  }, [bookings, searchQuery])

  // Get today's date for highlighting
  const today = new Date()
  const isCurrentMonth = today.getMonth() === currentDate.getMonth() &&
    today.getFullYear() === currentDate.getFullYear()
  const todayDay = isCurrentMonth ? today.getDate() : null

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
        <p className="text-theme-text-primary">Caricamento calendario meccanica...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="bg-theme-bg-secondary rounded-lg p-3 lg:p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap flex-1">
            <h2 className="text-lg font-bold text-theme-text-primary">Calendario Meccanica</h2>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                placeholder="Cerca clienti..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-3 py-1.5 bg-theme-bg-tertiary text-theme-text-primary rounded-md border border-theme-border focus:border-dr7-gold focus:outline-none text-sm w-48"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary"
                >
                  ×
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-theme-text-muted">Questo Mese:</span>
              <span className="text-dr7-gold font-bold text-sm">
                {bookings.filter(b => {
                  const bookingDate = new Date(b.appointment_date)
                  return bookingDate.getMonth() === currentDate.getMonth() &&
                    bookingDate.getFullYear() === currentDate.getFullYear()
                }).length} interventi
              </span>
            </div>
            {canViewFinancials && !hideFinancials && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-theme-text-muted">Fatturato:</span>
                <span className="text-green-400 font-bold text-sm">
                  <FinancialData type="total">
                    €{(bookings
                      .filter(b => {
                        const bookingDate = new Date(b.appointment_date)
                        return bookingDate.getMonth() === currentDate.getMonth() &&
                          bookingDate.getFullYear() === currentDate.getFullYear()
                      })
                      .reduce((sum, b) => sum + (b.price_total || 0), 0) / 100).toFixed(2)}
                  </FinancialData>
                </span>
              </div>
            )}
            {canViewFinancials && (
              <button
                onClick={() => setHideFinancials(!hideFinancials)}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${hideFinancials
                  ? 'bg-green-600 text-theme-text-primary hover:bg-green-700'
                  : 'bg-yellow-600 text-black hover:bg-yellow-700'
                  }`}
              >
                {hideFinancials ? 'MOSTRA' : 'NASCONDI'}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigateMonth('prev')}
              className="px-3 py-1.5 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-md transition-colors text-sm font-semibold"
              aria-label="Mese precedente"
            >
              ← Precedente
            </button>
            <button
              onClick={() => navigateMonth('next')}
              className="px-3 py-1.5 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-md transition-colors text-sm font-semibold"
              aria-label="Mese successivo"
            >
              Successivo →
            </button>
          </div>
        </div>

        <div className="mt-2 text-center">
          <h3 className="text-base text-theme-text-primary capitalize font-semibold">{monthName}</h3>
        </div>
      </div>

      {/* Search Results */}
      {searchQuery && (
        <div className="bg-theme-bg-secondary rounded-lg p-4 border border-theme-border">
          <h3 className="text-lg font-bold text-theme-text-primary mb-3">
            Risultati ricerca: "{searchQuery}"
          </h3>
          {matchingBookings.length === 0 ? (
            <p className="text-theme-text-muted text-sm">Nessun cliente trovato</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {matchingBookings.map(booking => (
                <div
                  key={booking.id}
                  className="bg-theme-bg-tertiary border border-theme-border rounded-lg p-3 hover:border-dr7-gold transition-colors cursor-pointer"
                  onClick={() => {
                    const dateString = booking.appointment_date.split('T')[0]
                    setSelectedCell({
                      date: dateString,
                      time: booking.appointment_time,
                      bookings: [booking]
                    })
                    setSearchQuery('')
                  }}
                >
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="text-theme-text-primary font-bold text-sm">{booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A'}</h4>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${booking.status === 'confirmed' ? 'bg-green-600 text-theme-text-primary' :
                      booking.status === 'pending' ? 'bg-yellow-600 text-black' :
                        'bg-gray-600 text-theme-text-primary'
                      }`}>
                      {booking.status}
                    </span>
                  </div>
                  <p className="text-theme-text-muted text-xs mb-2">{booking.customer_email || booking.booking_details?.customer?.email || 'N/A'}</p>
                  <div className="space-y-1 text-xs">
                    <p className="text-theme-text-primary">
                      <span className="text-theme-text-muted">Servizio:</span> {booking.service_name}
                    </p>
                    <p className="text-theme-text-primary">
                      <span className="text-theme-text-muted">Veicolo:</span> {booking.vehicle_name}
                    </p>
                    <p className="text-theme-text-primary">
                      <span className="text-theme-text-muted">Data:</span>{' '}
                      {new Date(booking.appointment_date).toLocaleDateString('it-IT')} - {booking.appointment_time}
                    </p>
                    <p className="text-dr7-gold font-bold">€{(booking.price_total / 100).toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Battleship-style Calendar Grid */}
      <div className="bg-theme-bg-secondary rounded-lg p-4 lg:p-6 overflow-x-auto">
        <div className="min-w-max">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-theme-bg-secondary border border-theme-border px-2 py-1 text-left text-theme-text-primary font-bold text-xs min-w-[80px]">
                  Orario
                </th>
                {daysInMonth.map(day => (
                  <th
                    key={day}
                    className={`border border-theme-border px-1 py-1 text-center text-[10px] font-semibold min-w-[28px] ${day === todayDay ? 'bg-dr7-gold/20 text-dr7-gold' : 'text-theme-text-muted'
                      }`}
                  >
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TIME_SLOTS.map(timeSlot => (
                <tr key={timeSlot}>
                  <td className="sticky left-0 z-10 bg-theme-bg-secondary border border-theme-border px-2 py-1 text-theme-text-primary font-semibold text-xs">
                    {timeSlot}
                  </td>
                  {daysInMonth.map(day => {
                    const isBooked = isSlotBooked(day, timeSlot)
                    const slotBookings = getSlotBookings(day, timeSlot)
                    return (
                      <td
                        key={day}
                        onClick={() => slotBookings.length > 0 && setSelectedCell({
                          date: `${day}/${currentDate.getMonth() + 1}/${currentDate.getFullYear()}`,
                          time: timeSlot,
                          bookings: slotBookings
                        })}
                        className={`border border-theme-border p-0.5 min-w-[28px] h-6 transition-all ${isBooked
                          ? 'bg-red-500 hover:bg-red-600 cursor-pointer'
                          : 'bg-green-500 hover:bg-green-600'
                          } ${day === todayDay ? 'ring-1 ring-dr7-gold ring-inset' : ''}`}
                        title={isBooked ? `${timeSlot} - Occupato` : `${timeSlot} - Libero`}
                      />
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Booking Details Modal */}
      {selectedCell && (
        <div
          className="fixed inset-0 bg-theme-bg-primary bg-opacity-80 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedCell(null)}
        >
          <div
            className="bg-theme-bg-secondary border-2 border-dr7-gold rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xl font-bold text-theme-text-primary mb-1">
                  Prenotazioni Meccanica
                </h3>
                <p className="text-theme-text-muted text-sm">
                  {new Date(selectedCell.date).toLocaleDateString('it-IT', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })} - {selectedCell.time}
                </p>
              </div>
              <button
                onClick={() => setSelectedCell(null)}
                className="text-theme-text-muted hover:text-theme-text-primary text-2xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              {selectedCell.bookings.map((booking) => (
                <div
                  key={booking.id}
                  className="bg-theme-bg-tertiary border border-theme-border rounded-lg p-4"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h4 className="text-theme-text-primary font-bold text-lg">{booking.service_name}</h4>
                      <p className="text-theme-text-muted text-sm">ID: {booking.id.substring(0, 8)}</p>
                    </div>
                    <div className="flex gap-2">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${booking.status === 'confirmed' ? 'bg-green-600 text-theme-text-primary' :
                        booking.status === 'pending' ? 'bg-yellow-600 text-black' :
                          'bg-gray-600 text-theme-text-primary'
                        }`}>
                        {booking.status}
                      </span>
                      <span className={`px-2 py-1 rounded text-xs font-bold ${booking.payment_status === 'paid' ||
                          (booking.booking_details?.amountPaid && booking.booking_details.amountPaid >= booking.price_total)
                          ? 'bg-green-600 text-theme-text-primary'
                          : booking.payment_status === 'pending'
                            ? 'bg-yellow-600 text-black'
                            : 'bg-red-600 text-theme-text-primary'
                        }`}>
                        {booking.payment_status === 'paid' ||
                          (booking.booking_details?.amountPaid && booking.booking_details.amountPaid >= booking.price_total)
                          ? 'Pagato'
                          : booking.payment_status}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-theme-text-muted">Cliente:</span>
                      <p className="text-theme-text-primary font-semibold">{booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Telefono:</span>
                      <p className="text-theme-text-primary font-semibold">{booking.customer_phone || booking.booking_details?.customer?.phone || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Email:</span>
                      <p className="text-theme-text-primary font-semibold text-xs">{booking.customer_email || booking.booking_details?.customer?.email || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Veicolo:</span>
                      <p className="text-theme-text-primary font-semibold">{booking.vehicle_name}</p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Prezzo:</span>
                      <p className="text-dr7-gold font-bold">€{(booking.price_total / 100).toFixed(2)}</p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Creato il:</span>
                      <p className="text-theme-text-primary font-semibold text-xs">
                        {new Date(booking.created_at).toLocaleDateString('it-IT')}
                      </p>
                    </div>
                  </div>

                  {booking.booking_details?.notes && (
                    <div className="mt-3 pt-3 border-t border-theme-border">
                      <span className="text-theme-text-muted text-xs">Note:</span>
                      <p className="text-theme-text-primary text-sm mt-1">{booking.booking_details.notes}</p>
                    </div>
                  )}

                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={() => setEditingBooking(booking)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-theme-text-primary text-sm font-bold rounded-full transition-colors"
                    >
                      Modifica
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setSelectedCell(null)}
              className="mt-6 w-full bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary font-bold py-2 px-4 rounded-full transition-colors"
            >
              Chiudi
            </button>
          </div>
        </div>
      )}

      {/* Editing Modal */}
      {editingBooking && (
        <div className="fixed inset-0 bg-theme-bg-primary/80 flex items-center justify-center z-[60] p-4">
          <div className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <MechanicalBookingForm
              initialData={editingBooking}
              editingId={editingBooking.id}
              customers={customers}
              onSave={() => {
                setEditingBooking(null)
                setSelectedCell(null)
                loadData()
              }}
              onCancel={() => setEditingBooking(null)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
