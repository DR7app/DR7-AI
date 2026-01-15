import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import { FinancialData } from '../../../components/FinancialData'
import { useAdminRole } from '../../../hooks/useAdminRole'
import { getRomeDateComponents } from '../../../utils/timezoneUtils'

interface CarWashBooking {
  id: string
  customer_name: string
  customer_email: string
  customer_phone: string
  service_name: string
  appointment_date: string
  appointment_time: string
  price_total: number
  status: string
  payment_status: string
  booking_details: any
  created_at: string
}

// Service durations in minutes
const SERVICE_DURATIONS: Record<string, number> = {
  'Lavaggio Completo': 45,
  'Lavaggio Top': 90,
  'Lavaggio VIP': 120,
  'Lavaggio DR7 Luxury': 150,
  // New services added Jan 2026
  'Lavaggio Scooter': 15,
  'Lavaggio Solo Esterno': 15,
  'Lavaggio Solo Interno': 30
}

const getServiceDuration = (serviceName: string): number => {
  // Try exact match first
  if (SERVICE_DURATIONS[serviceName]) {
    return SERVICE_DURATIONS[serviceName]
  }

  // Try case-insensitive match
  const lowerServiceName = serviceName.toLowerCase()

  // Match patterns
  if (lowerServiceName.includes('completo')) return 45
  if (lowerServiceName.includes('top')) return 90
  if (lowerServiceName.includes('vip')) return 120
  if (lowerServiceName.includes('dr7') || lowerServiceName.includes('luxury')) return 150
  if (lowerServiceName.includes('scooter')) return 15
  if (lowerServiceName.includes('solo esterno') || lowerServiceName.includes('exterior only')) return 15
  if (lowerServiceName.includes('solo interno') || lowerServiceName.includes('interior only')) return 30

  // Default to 60 minutes if no match
  return 60
}

const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins} minuti`
  if (mins === 0) return `${hours} ${hours === 1 ? 'ora' : 'ore'}`
  return `${hours} ${hours === 1 ? 'ora' : 'ore'} e ${mins} minuti`
}

// Generate time slots for car wash: 9h-13h and 15h-18h, every 15 minutes
const generateTimeSlots = () => {
  const slots: string[] = []

  // Morning slots: 9h-13h
  for (let hour = 9; hour < 13; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
      slots.push(time)
    }
  }

  // Afternoon slots: 15h-18h (18:00 is the maximum/last slot)
  for (let hour = 15; hour < 19; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
      // Stop at 18:00 - no slots after
      if (hour === 18 && minute > 0) break
      slots.push(time)
    }
  }

  return slots
}

const TIME_SLOTS = generateTimeSlots()

export default function CarWashCalendarTab() {
  const { canViewFinancials } = useAdminRole()
  const [hideFinancials, setHideFinancials] = useState(false)
  const [bookings, setBookings] = useState<CarWashBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedCell, setSelectedCell] = useState<{
    date: string
    time: string
    bookings: CarWashBooking[]
  } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    loadData()

    // Real-time subscription
    const subscription = supabase
      .channel('carwash-calendar-updates')
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
      // Load car wash bookings (exclude cancelled)
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .eq('service_type', 'car_wash')
        .neq('status', 'cancelled')
        .order('appointment_date', { ascending: true })

      if (bookingsError) throw bookingsError

      console.log('🧼 CAR WASH CALENDAR - Prenotazioni caricate:', bookingsData?.length || 0)

      setBookings(bookingsData || [])
    } catch (error) {
      console.error('Failed to load car wash bookings:', error)
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

    // Convert timeSlot to minutes
    const [slotHours, slotMinutes] = timeSlot.split(':').map(Number)
    const slotTimeInMinutes = slotHours * 60 + slotMinutes

    return bookings.some(booking => {
      // Get booking date in Rome timezone
      const bookingComponents = getRomeDateComponents(booking.appointment_date)

      // Check if booking is on this day
      if (bookingComponents.year !== year ||
        bookingComponents.month !== (month + 1) || // month is 1-indexed in components
        bookingComponents.day !== day) {
        return false
      }

      // Get booking start time and duration
      const [bookingHours, bookingMinutes] = booking.appointment_time.split(':').map(Number)
      const bookingStartMinutes = bookingHours * 60 + bookingMinutes
      const duration = getServiceDuration(booking.service_name)
      const bookingEndMinutes = bookingStartMinutes + duration

      // Check if this slot falls within the booking's time range
      return slotTimeInMinutes >= bookingStartMinutes && slotTimeInMinutes < bookingEndMinutes
    })
  }

  const getSlotBookings = (day: number, timeSlot: string): CarWashBooking[] => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()

    // Convert timeSlot to minutes
    const [slotHours, slotMinutes] = timeSlot.split(':').map(Number)
    const slotTimeInMinutes = slotHours * 60 + slotMinutes

    return bookings.filter(booking => {
      // Get booking date in Rome timezone
      const bookingComponents = getRomeDateComponents(booking.appointment_date)

      // Check if booking is on this day
      if (bookingComponents.year !== year ||
        bookingComponents.month !== (month + 1) || // month is 1-indexed in components
        bookingComponents.day !== day) {
        return false
      }

      // Get booking start time and duration
      const [bookingHours, bookingMinutes] = booking.appointment_time.split(':').map(Number)
      const bookingStartMinutes = bookingHours * 60 + bookingMinutes
      const duration = getServiceDuration(booking.service_name)
      const bookingEndMinutes = bookingStartMinutes + duration

      // Return booking if this slot falls within its time range
      return slotTimeInMinutes >= bookingStartMinutes && slotTimeInMinutes < bookingEndMinutes
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
        <p className="text-theme-text-primary">Caricamento calendario lavaggi...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="bg-theme-bg-secondary rounded-lg p-3 lg:p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap flex-1">
            <h2 className="text-lg font-bold text-theme-text-primary">Calendario Lavaggi</h2>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                placeholder="Cerca clienti..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-3 py-1.5 bg-theme-bg-tertiary text-theme-text-primary rounded-full border border-theme-border focus:border-dr7-gold focus:outline-none text-sm w-48"
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
                }).length} lavaggi
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
              className="px-3 py-1.5 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-full transition-colors text-sm font-semibold"
              aria-label="Mese precedente"
            >
              ← Precedente
            </button>
            <button
              onClick={() => navigateMonth('next')}
              className="px-3 py-1.5 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-full transition-colors text-sm font-semibold"
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
                    setSelectedCell({
                      date: `${new Date(booking.appointment_date).getDate()}/${currentDate.getMonth() + 1}/${currentDate.getFullYear()}`,
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
                    {booking.booking_details?.additionalService && (
                      <p className="text-theme-text-primary">
                        <span className="text-theme-text-muted">+ Aggiuntivo:</span> {booking.booking_details.additionalService}
                      </p>
                    )}
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
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedCell(null)}
        >
          <div
            className="bg-theme-bg-secondary rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-theme-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-theme-border">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-2xl font-bold text-theme-text-primary mb-2">
                    Prenotazione Lavaggio
                  </h3>
                  <p className="text-theme-text-muted">{selectedCell.date} - {selectedCell.time}</p>
                </div>
                <button
                  onClick={() => setSelectedCell(null)}
                  className="text-theme-text-muted hover:text-theme-text-primary transition-colors text-3xl leading-none"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {selectedCell.bookings.map(booking => (
                <div key={booking.id} className="bg-theme-bg-tertiary/50 rounded-lg p-5 border border-red-500/30">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="text-theme-text-primary font-bold text-lg mb-1">{booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A'}</div>
                      <div className="text-theme-text-muted text-sm">{booking.customer_email || booking.booking_details?.customer?.email || 'N/A'}</div>
                      <div className="text-theme-text-muted text-sm">{booking.customer_phone || booking.booking_details?.customer?.phone || 'N/A'}</div>
                    </div>
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                      {booking.status}
                    </span>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-theme-text-muted">Servizio:</span>
                      <span className="text-theme-text-primary font-medium">{booking.service_name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-theme-text-muted">Durata:</span>
                      <span className="text-theme-text-primary font-medium">{formatDuration(getServiceDuration(booking.service_name))}</span>
                    </div>
                    {booking.booking_details?.additionalService && (
                      <div className="flex justify-between">
                        <span className="text-theme-text-muted">Servizio Aggiuntivo:</span>
                        <span className="text-theme-text-primary font-medium text-xs">{booking.booking_details.additionalService}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-2 border-t border-theme-border">
                      <span className="text-theme-text-muted">Prezzo Totale:</span>
                      <span className="text-dr7-gold font-bold text-lg">
                        €{(booking.price_total / 100).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-theme-text-muted">Stato Pagamento:</span>
                      <span className={`font-medium ${booking.payment_status === 'paid' ||
                        booking.payment_status === 'completed' ||
                        (booking.booking_details?.amountPaid && booking.booking_details.amountPaid >= booking.price_total)
                        ? 'text-green-400'
                        : 'text-red-400'
                        }`}>
                        {booking.payment_status === 'paid' ||
                          booking.payment_status === 'completed' ||
                          (booking.booking_details?.amountPaid && booking.booking_details.amountPaid >= booking.price_total)
                          ? 'Pagato'
                          : 'Non Pagato'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-gray-500">
                    ID: DR7-{booking.id.toUpperCase().slice(0, 8)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
