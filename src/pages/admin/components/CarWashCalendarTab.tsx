import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import { FinancialData } from '../../../components/FinancialData'
import { useAdminRole } from '../../../hooks/useAdminRole'
import { getRomeDateComponents } from '../../../utils/timezoneUtils'
import { getHolidayForDate, isSunday } from '../../../data/italianHolidays'

// --- Configuration ---
const CELL_WIDTH = 52 // Balanced width: fits full month on screen while maintaining readability
const CELL_HEIGHT = 28 // Height for each 15-minute time slot (compact)

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
  vehicle_name?: string
  vehicle_plate?: string
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
  if (hours === 0) return `${mins} min`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}min`
}

interface CarWashCalendarTabProps {
  onNewBooking?: (date: string, time: string) => void
}

export default function CarWashCalendarTab({ onNewBooking }: CarWashCalendarTabProps) {
  const { canViewFinancials } = useAdminRole()
  const [hideFinancials, setHideFinancials] = useState(false)
  const [bookings, setBookings] = useState<CarWashBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBooking, setSelectedBooking] = useState<CarWashBooking | null>(null)
  const [editingBooking, setEditingBooking] = useState<CarWashBooking | null>(null)

  useEffect(() => {
    loadData()

    // Real-time subscription for car wash bookings
    const subscription = supabase
      .channel('carwash-calendar-realtime')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        (payload) => {
          console.log('🔄 CarWash Calendar: Real-time update received', payload.eventType, payload)
          // Reload data when any booking changes
          loadData()
        }
      )
      .subscribe((status) => {
        console.log('📡 CarWash Calendar subscription status:', status)
      })

    return () => {
      console.log('🔌 CarWash Calendar: Unsubscribing from real-time')
      subscription.unsubscribe()
    }
  }, [currentDate]) // Reload when month changes

  async function loadData() {
    setLoading(true)
    try {
      // Calculate date range for ONLY current month (more performant)
      const year = currentDate.getFullYear()
      const month = currentDate.getMonth()

      // Start: first day of current month at 00:00:00
      const startDate = new Date(year, month, 1, 0, 0, 0)
      const startDateISO = startDate.toISOString()

      // End: last day of current month at 23:59:59
      const endDate = new Date(year, month + 1, 0, 23, 59, 59)
      const endDateISO = endDate.toISOString()

      console.log('🔍 CarWash Calendar loading for range:', startDateISO, 'to', endDateISO)

      // Load car wash bookings (exclude cancelled) - use full timestamp comparison
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .eq('service_type', 'car_wash')
        .neq('status', 'cancelled')
        .gte('appointment_date', startDateISO)
        .lte('appointment_date', endDateISO)
        .order('appointment_date', { ascending: true })

      if (bookingsError) throw bookingsError

      console.log('🧼 CAR WASH CALENDAR - Prenotazioni caricate:', bookingsData?.length || 0, `(${startDateISO} to ${endDateISO})`)
      if (bookingsData && bookingsData.length > 0) {
        console.log('🧼 CAR WASH CALENDAR - Bookings:', bookingsData.map(b => ({
          id: b.id?.substring(0, 8),
          date: b.appointment_date,
          time: b.appointment_time,
          service: b.service_name,
          customer: b.customer_name,
          status: b.status
        })))
      }

      setBookings(bookingsData || [])
    } catch (error) {
      console.error('Failed to load car wash bookings:', error)
    } finally {
      setLoading(false)
    }
  }

  const currentRomeComponents = useMemo(() => {
    return {
      year: currentDate.getFullYear(),
      month: currentDate.getMonth() // 0-indexed
    }
  }, [currentDate])

  const daysInMonth = useMemo(() => {
    return new Date(currentRomeComponents.year, currentRomeComponents.month + 1, 0).getDate()
  }, [currentRomeComponents])

  // Generate all days in the month for full monthly view
  const daysArray = useMemo(() => {
    const days = []
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i)
    }
    return days
  }, [daysInMonth])

  const navigateMonth = (dir: 'prev' | 'next') => {
    setCurrentDate(p => {
      const n = new Date(p)
      n.setMonth(p.getMonth() + (dir === 'prev' ? -1 : 1))
      return n
    })
    // Month changed
  }

  // Process bookings into calendar events
  const calendarEvents = useMemo(() => {
    return bookings
      .filter(booking => {
        const bookingComponents = getRomeDateComponents(booking.appointment_date)
        return bookingComponents.year === currentRomeComponents.year &&
          bookingComponents.month === (currentRomeComponents.month + 1)
      })
      .map(booking => {
        const bookingComponents = getRomeDateComponents(booking.appointment_date)
        const day = bookingComponents.day

        // Parse time
        const [hours, minutes] = booking.appointment_time.split(':').map(Number)
        const duration = getServiceDuration(booking.service_name)

        // Calculate position
        const dayIndex = day - 1
        const leftPx = dayIndex * CELL_WIDTH

        return {
          booking,
          day,
          leftPx,
          duration,
          hours,
          minutes
        }
      })
      .sort((a, b) => {
        // Sort by day, then by time
        if (a.day !== b.day) return a.day - b.day
        if (a.hours !== b.hours) return a.hours - b.hours
        return a.minutes - b.minutes
      })
  }, [bookings, currentRomeComponents, daysInMonth])

  // Filter by search query
  const filteredEvents = useMemo(() => {
    if (!searchQuery.trim()) return calendarEvents
    const q = searchQuery.toLowerCase()
    return calendarEvents.filter(evt => {
      const customerName = evt.booking.customer_name || evt.booking.booking_details?.customer?.fullName || ''
      return customerName.toLowerCase().includes(q) ||
        evt.booking.service_name.toLowerCase().includes(q)
    })
  }, [calendarEvents, searchQuery])

  // Group events by day for lane assignment
  const eventsByDay = useMemo(() => {
    const grouped = new Map<number, typeof filteredEvents>()
    filteredEvents.forEach(evt => {
      if (!grouped.has(evt.day)) {
        grouped.set(evt.day, [])
      }
      grouped.get(evt.day)!.push(evt)
    })
    return grouped
  }, [filteredEvents])

  // Assign lanes to prevent overlaps within each day
  const eventsWithLanes = useMemo(() => {
    return filteredEvents.map(evt => {
      const dayEvents = eventsByDay.get(evt.day) || []
      const evtIndex = dayEvents.indexOf(evt)
      return {
        ...evt,
        laneIndex: evtIndex
      }
    })
  }, [filteredEvents, eventsByDay])





  // Get today
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
    <div className="flex flex-col h-[calc(100vh-200px)] bg-transparent rounded-xl border border-white/5 shadow-2xl overflow-hidden">

      {/* 1. Control Bar */}
      <div className="flex justify-between items-center p-4 bg-black/20 backdrop-blur-md border-b border-white/5 z-10 shadow-sm">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-light text-theme-text-primary capitalize w-48">
            {currentDate.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}
          </h2>
          <div className="flex gap-2">
            <button onClick={() => navigateMonth('prev')} className="px-3 py-1 bg-white/5 hover:bg-white/10 rounded border border-white/10 text-sm text-white/90 hover:text-white">◄ Mese</button>
            <button onClick={() => navigateMonth('next')} className="px-3 py-1 bg-white/5 hover:bg-white/10 rounded border border-white/10 text-sm text-white/90 hover:text-white">Mese ►</button>
          </div>

        </div>

        <div className="flex items-center gap-4">
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
          <input
            type="text"
            placeholder="Cerca cliente o servizio..."
            className="bg-black/20 border border-white/10 rounded-full px-4 py-1.5 text-sm w-64 text-white placeholder-white/50 focus:outline-none focus:border-dr7-gold/50"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 2. Scrollable Calendar Area */}
      <div className="flex-1 overflow-auto relative flex flex-col w-full bg-[#0a0b0d]">

        {/* A. Sticky Header Row - Days */}
        <div className="flex sticky top-0 z-[40] bg-[#0d0d0e] shadow-lg min-w-max border-b border-white/10">
          {/* Header Spacer for Time Column */}
          <div className="sticky left-0 w-[70px] z-[41] bg-[#0d0d0e] border-r border-white/10 flex items-center justify-center font-bold text-xs text-gray-400 uppercase tracking-wider backdrop-blur-sm shadow-[4px_0_10px_-2px_rgba(0,0,0,0.5)]" style={{ height: '50px' }}>
            Orario
          </div>

          {/* Day Columns Header */}
          <div className="flex">
            {daysArray.map((day) => {
              const d = new Date(currentRomeComponents.year, currentRomeComponents.month, day)
              const isHol = getHolidayForDate(d)
              const isSun = isSunday(d)
              const isToday = day === todayDay

              return (
                <div
                  key={day}
                  className={`
                    flex flex-col items-center justify-center border-r border-white/[0.08] relative transition-colors
                    ${(isHol || isSun) ? 'bg-red-950/20' : ''}
                    ${isToday ? 'bg-[#c9a84a]/30 border-l-2 border-r-2 border-[#c9a84a]' : ''}
                  `}
                  style={{ width: CELL_WIDTH, height: '50px' }}
                >
                  {/* Red dot for Sundays and holidays */}
                  {(isHol || isSun) && (
                    <div
                      className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-red-500"
                      title={isHol ? isHol.name : 'Domenica'}
                    />
                  )}

                  <span
                    className={`text-sm font-bold ${isToday ? 'text-[#c9a84a]' : 'text-white/90'}`}
                  >
                    {day}
                  </span>
                  <span
                    className={`text-[9px] uppercase tracking-wide ${isToday ? 'text-[#c9a84a]/80' : 'text-white/50'}`}
                  >
                    {d.toLocaleDateString('it-IT', { weekday: 'short' })}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* B. Time Slots Grid */}
        <div className="min-w-max relative">
          {/* Generate time slots from 09:00 to 18:00 in 15-minute intervals (37 slots) */}
          {Array.from({ length: 37 }, (_, i) => {
            const totalMinutes = 9 * 60 + i * 15 // Start at 09:00
            const hours = Math.floor(totalMinutes / 60)
            const minutes = totalMinutes % 60
            const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
            const isFullHour = minutes === 0

            return (
              <div
                key={timeString}
                className={`flex ${isFullHour ? 'border-t-2 border-white/20' : 'border-t border-white/[0.05]'}`}
                style={{ height: CELL_HEIGHT }}
              >
                {/* Time Label Column (Sticky Left) */}
                <div
                  className={`sticky left-0 w-[70px] z-[30] bg-[#0d0d0e]/98 border-r border-white/10 flex items-center justify-center backdrop-blur-sm shadow-[4px_0_6px_-2px_rgba(0,0,0,0.4)] ${isFullHour ? 'font-bold' : 'font-normal'}`}
                >
                  <span className={`text-xs ${isFullHour ? 'text-white/95 text-sm' : 'text-white/60'}`}>
                    {timeString}
                  </span>
                </div>

                {/* Day Cells */}
                <div className="flex flex-1">
                  {daysArray.map((day) => {
                    const d = new Date(currentRomeComponents.year, currentRomeComponents.month, day)
                    const isRedDay = getHolidayForDate(d) || isSunday(d)
                    const isToday = day === todayDay

                    // Check if this time slot has a booking
                    const slotBooking = eventsWithLanes.find(evt => {
                      if (evt.day !== day) return false

                      // Parse booking time
                      const [bookingHours, bookingMinutes] = evt.booking.appointment_time.split(':').map(Number)
                      const bookingStartMinutes = bookingHours * 60 + bookingMinutes
                      const bookingEndMinutes = bookingStartMinutes + evt.duration

                      // Check if current slot is within booking duration
                      return totalMinutes >= bookingStartMinutes && totalMinutes < bookingEndMinutes
                    })

                    // Determine if this is the first slot of a booking (to render the booking block)
                    const isBookingStart = slotBooking && (() => {
                      const [bookingHours, bookingMinutes] = slotBooking.booking.appointment_time.split(':').map(Number)
                      const bookingStartMinutes = bookingHours * 60 + bookingMinutes
                      return totalMinutes === bookingStartMinutes
                    })()

                    return (
                      <div
                        key={`${day}-${timeString}`}
                        className={`
                          relative border-r border-white/[0.05] transition-all
                          ${isToday ? 'bg-[#c9a84a]/20 border-l border-r border-[#c9a84a]/30' : ''}
                          ${!isToday && !slotBooking && !isRedDay ? 'bg-green-600/15 hover:bg-green-600/25 cursor-pointer' : ''}
                          ${!isToday && !slotBooking && isRedDay ? 'bg-red-950/10 hover:bg-red-950/20' : ''}
                          ${slotBooking && !isBookingStart ? 'bg-transparent' : ''}
                        `}
                        style={{ width: CELL_WIDTH, height: CELL_HEIGHT }}
                        onClick={() => {
                          // Only allow booking on available slots (green cells)
                          if (!slotBooking && !isRedDay && onNewBooking) {
                            const dateStr = `${currentRomeComponents.year}-${String(currentRomeComponents.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                            onNewBooking(dateStr, timeString)
                          }
                        }}
                      >
                        {/* Render booking block on the first slot */}
                        {isBookingStart && slotBooking && (
                          <div
                            className="absolute inset-x-0 bg-red-800 border border-red-700/30 rounded shadow-md hover:shadow-xl hover:brightness-110 transition-all cursor-pointer z-20 overflow-hidden group/booking"
                            style={{
                              height: `${(slotBooking.duration / 15) * CELL_HEIGHT - 2}px`,
                              top: '1px'
                            }}
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedBooking(slotBooking.booking)
                            }}
                          >
                            {/* Inner glow effect */}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />

                            {/* Content */}
                            <div className="relative px-2 py-1.5 flex flex-col justify-center h-full items-center gap-0.5 text-center">
                              <span className="font-bold text-[11px] leading-tight truncate max-w-full text-white drop-shadow-md">
                                {(() => {
                                  const name = slotBooking.booking.customer_name || 'Cliente'
                                  if (name.length > 10) {
                                    const parts = name.split(' ')
                                    if (parts.length > 1) {
                                      return parts[0].substring(0, 8) + '.'
                                    }
                                    return name.substring(0, 8) + '.'
                                  }
                                  return name
                                })()}
                              </span>
                              <span className="font-bold text-[12px] leading-tight text-white drop-shadow-md">
                                {slotBooking.booking.appointment_time}
                              </span>
                              <span className="text-[9px] leading-tight text-white/90 drop-shadow-sm">
                                {(() => {
                                  const svc = slotBooking.booking.service_name.toLowerCase()
                                  if (svc.includes('scooter')) return 'Scooter'
                                  if (svc.includes('solo esterno') || svc.includes('exterior')) return 'Esterno'
                                  if (svc.includes('solo interno') || svc.includes('interior')) return 'Interno'
                                  if (svc.includes('completo')) return 'Completo'
                                  if (svc.includes('top')) return 'Top'
                                  if (svc.includes('vip')) return 'VIP'
                                  if (svc.includes('luxury') || svc.includes('dr7')) return 'Luxury'
                                  return 'Lavaggio'
                                })()}
                              </span>
                            </div>

                            {/* Left accent bar */}
                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-white/40" />
                            {/* Right accent bar */}
                            <div className="absolute right-0 top-0 bottom-0 w-1 bg-white/40" />

                            {/* Tooltip on hover */}
                            <div className="hidden group-hover/booking:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-900 border border-gray-700 text-white text-xs p-3 rounded-lg shadow-2xl w-max z-[100] pointer-events-none min-w-[220px]">
                              <div className="font-bold mb-1 text-base">{slotBooking.booking.customer_name}</div>
                              <div className="text-gray-400 mb-2">{slotBooking.booking.service_name}</div>

                              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                                <span className="text-gray-500">Orario:</span>
                                <span className="font-mono">{slotBooking.booking.appointment_time}</span>

                                <span className="text-gray-500">Durata:</span>
                                <span className="font-mono">{formatDuration(slotBooking.duration)}</span>

                                <span className="text-gray-500">Prezzo:</span>
                                <span className="font-mono">€{(slotBooking.booking.price_total / 100).toFixed(2)}</span>

                                <span className="text-gray-500">Stato:</span>
                                <span className="uppercase font-bold tracking-wider text-[10px]">{slotBooking.booking.status}</span>
                              </div>

                              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45 border-r border-b border-gray-700" />
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {eventsWithLanes.length === 0 && !loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-theme-text-muted bg-black/40 backdrop-blur-sm px-8 py-6 rounded-lg border border-white/10">
                <p className="text-lg">Nessun lavaggio prenotato questo mese.</p>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Booking Details Modal */}
      {selectedBooking && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedBooking(null)}
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
                  <p className="text-theme-text-muted">{new Date(selectedBooking.appointment_date).toLocaleDateString('it-IT')} - {selectedBooking.appointment_time}</p>
                </div>
                <button
                  onClick={() => setSelectedBooking(null)}
                  className="text-theme-text-muted hover:text-theme-text-primary transition-colors text-3xl leading-none"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-theme-bg-tertiary/50 rounded-lg p-5 border border-red-500/30">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="text-theme-text-primary font-bold text-lg mb-1">{selectedBooking.customer_name || selectedBooking.booking_details?.customer?.fullName || 'N/A'}</div>
                    <div className="text-theme-text-muted text-sm">{selectedBooking.customer_email || selectedBooking.booking_details?.customer?.email || 'N/A'}</div>
                    <div className="text-theme-text-muted text-sm">{selectedBooking.customer_phone || selectedBooking.booking_details?.customer?.phone || 'N/A'}</div>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                    {selectedBooking.status}
                  </span>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-theme-text-muted">Servizio:</span>
                    <span className="text-theme-text-primary font-medium">{selectedBooking.service_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-theme-text-muted">Durata:</span>
                    <span className="text-theme-text-primary font-medium">{formatDuration(getServiceDuration(selectedBooking.service_name))}</span>
                  </div>
                  {selectedBooking.booking_details?.additionalService && (
                    <div className="flex justify-between">
                      <span className="text-theme-text-muted">Servizio Aggiuntivo:</span>
                      <span className="text-theme-text-primary font-medium text-xs">{selectedBooking.booking_details.additionalService}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t border-theme-border">
                    <span className="text-theme-text-muted">Prezzo Totale:</span>
                    <span className="text-dr7-gold font-bold text-lg">
                      €{(selectedBooking.price_total / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-theme-text-muted">Stato Pagamento:</span>
                    <span className={`font-medium ${selectedBooking.payment_status === 'paid' ||
                      selectedBooking.payment_status === 'completed' ||
                      (selectedBooking.booking_details?.amountPaid && selectedBooking.booking_details.amountPaid >= selectedBooking.price_total)
                      ? 'text-green-400'
                      : 'text-red-400'
                      }`}>
                      {selectedBooking.payment_status === 'paid' ||
                        selectedBooking.payment_status === 'completed' ||
                        (selectedBooking.booking_details?.amountPaid && selectedBooking.booking_details.amountPaid >= selectedBooking.price_total)
                        ? 'Pagato'
                        : 'Non Pagato'}
                    </span>
                  </div>
                </div>

                <div className="mt-3 text-xs text-gray-500">
                  ID: DR7-{selectedBooking.id.toUpperCase().slice(0, 8)}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t border-theme-border">
                <button
                  onClick={() => {
                    setEditingBooking(selectedBooking)
                    setSelectedBooking(null)
                  }}
                  className="flex-1 px-4 py-2 bg-dr7-gold/20 hover:bg-dr7-gold/30 text-dr7-gold rounded border border-dr7-gold/30 font-medium transition-colors"
                >
                  Modifica Prenotazione
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Booking Modal */}
      {editingBooking && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-theme-bg-secondary rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-theme-border">
            <div className="p-6 border-b border-theme-border">
              <div className="flex justify-between items-start">
                <h3 className="text-2xl font-bold text-theme-text-primary">Modifica Prenotazione</h3>
                <button
                  onClick={() => setEditingBooking(null)}
                  className="text-theme-text-muted hover:text-theme-text-primary text-2xl"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Cliente</label>
                <input
                  type="text"
                  value={editingBooking.customer_name}
                  onChange={(e) => setEditingBooking({ ...editingBooking, customer_name: e.target.value })}
                  className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Email</label>
                  <input
                    type="email"
                    value={editingBooking.customer_email || ''}
                    onChange={(e) => setEditingBooking({ ...editingBooking, customer_email: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Telefono</label>
                  <input
                    type="tel"
                    value={editingBooking.customer_phone || ''}
                    onChange={(e) => setEditingBooking({ ...editingBooking, customer_phone: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Servizio</label>
                <input
                  type="text"
                  value={editingBooking.service_name}
                  onChange={(e) => setEditingBooking({ ...editingBooking, service_name: e.target.value })}
                  className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Data</label>
                  <input
                    type="date"
                    value={editingBooking.appointment_date}
                    onChange={(e) => setEditingBooking({ ...editingBooking, appointment_date: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Ora</label>
                  <input
                    type="time"
                    value={editingBooking.appointment_time}
                    onChange={(e) => setEditingBooking({ ...editingBooking, appointment_time: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Prezzo (€)</label>
                <input
                  type="number"
                  value={editingBooking.price_total / 100}
                  onChange={(e) => setEditingBooking({ ...editingBooking, price_total: parseFloat(e.target.value) * 100 })}
                  step="0.01"
                  className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Stato</label>
                  <select
                    value={editingBooking.status}
                    onChange={(e) => setEditingBooking({ ...editingBooking, status: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                  >
                    <option value="pending">In Attesa</option>
                    <option value="confirmed">Confermata</option>
                    <option value="cancelled">Annullata</option>
                    <option value="completed">Completata</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Pagamento</label>
                  <select
                    value={editingBooking.payment_status}
                    onChange={(e) => setEditingBooking({ ...editingBooking, payment_status: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                  >
                    <option value="pending">In Attesa</option>
                    <option value="paid">Pagato</option>
                    <option value="completed">Completato</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-theme-border flex gap-3">
              <button
                onClick={async () => {
                  try {
                    const { error } = await supabase
                      .from('bookings')
                      .update({
                        customer_name: editingBooking.customer_name,
                        customer_email: editingBooking.customer_email,
                        customer_phone: editingBooking.customer_phone,
                        service_name: editingBooking.service_name,
                        appointment_date: editingBooking.appointment_date,
                        appointment_time: editingBooking.appointment_time,
                        price_total: editingBooking.price_total,
                        status: editingBooking.status,
                        payment_status: editingBooking.payment_status,
                      })
                      .eq('id', editingBooking.id)

                    if (error) throw error

                    alert('✅ Prenotazione aggiornata!')
                    setEditingBooking(null)
                    loadData()
                  } catch (error) {
                    console.error('Failed to update booking:', error)
                    alert('❌ Errore durante l\'aggiornamento')
                  }
                }}
                className="flex-1 bg-dr7-gold hover:bg-dr7-gold/90 text-black px-6 py-3 rounded-full font-medium transition-colors"
              >
                Salva Modifiche
              </button>
              <button
                onClick={() => setEditingBooking(null)}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-theme-text-primary rounded font-medium transition-colors"
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
