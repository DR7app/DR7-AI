import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import { FinancialData } from '../../../components/FinancialData'
import { useAdminRole } from '../../../hooks/useAdminRole'
import { getRomeDateComponents, formatRomeDate } from '../../../utils/timezoneUtils'
import { getHolidayForDate, isSunday } from '../../../data/italianHolidays'

// --- Configuration ---
const CELL_WIDTH = 45 // Fixed width for day cells
const MIN_ROW_HEIGHT = 60
const BAR_HEIGHT = 60

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

export default function CarWashCalendarTab() {
  const { canViewFinancials } = useAdminRole()
  const [hideFinancials, setHideFinancials] = useState(false)
  const [bookings, setBookings] = useState<CarWashBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBooking, setSelectedBooking] = useState<CarWashBooking | null>(null)

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
  }, [currentDate]) // Reload when month changes

  async function loadData() {
    setLoading(true)
    try {
      // Calculate date range for ONLY current month (more performant)
      const year = currentDate.getFullYear()
      const month = currentDate.getMonth()

      // Start: first day of current month
      const startDate = new Date(year, month, 1)
      const startDateStr = startDate.toISOString().split('T')[0]

      // End: last day of current month
      const endDate = new Date(year, month + 1, 0)
      const endDateStr = endDate.toISOString().split('T')[0]

      // Load car wash bookings (exclude cancelled) - OPTIMIZED: only load relevant date range
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .eq('service_type', 'car_wash')
        .neq('status', 'cancelled')
        .gte('appointment_date', startDateStr)
        .lte('appointment_date', endDateStr)
        .order('appointment_date', { ascending: true })

      if (bookingsError) throw bookingsError

      console.log('🧼 CAR WASH CALENDAR - Prenotazioni caricate:', bookingsData?.length || 0, `(${startDateStr} to ${endDateStr})`)

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

  const daysArray = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth])

  const navigateMonth = (dir: 'prev' | 'next') => {
    setCurrentDate(p => {
      const n = new Date(p)
      n.setMonth(p.getMonth() + (dir === 'prev' ? -1 : 1))
      return n
    })
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

  const maxLanes = useMemo(() => {
    let max = 1
    eventsByDay.forEach(events => {
      max = Math.max(max, events.length)
    })
    return max
  }, [eventsByDay])

  const rowHeight = Math.max(MIN_ROW_HEIGHT, (maxLanes * (BAR_HEIGHT + 4)) + 12)

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
            <button onClick={() => navigateMonth('prev')} className="px-3 py-1 bg-white/5 hover:bg-white/10 rounded border border-white/10 text-sm text-white/90 hover:text-white">Prec</button>
            <button onClick={() => navigateMonth('next')} className="px-3 py-1 bg-white/5 hover:bg-white/10 rounded border border-white/10 text-sm text-white/90 hover:text-white">Succ</button>
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
      <div className="flex-1 overflow-auto relative flex flex-col w-full">

        {/* A. Sticky Header Row */}
        <div className="flex sticky top-0 z-[40] bg-[#0d0d0e] shadow-md min-w-max h-[42px] border-b border-white/5">
          {/* Header Spacer for Left Column */}
          <div className="sticky left-0 w-[200px] z-[41] bg-[#0d0d0e] border-r border-white/5 flex items-center px-4 font-bold text-xs text-gray-400 uppercase tracking-wider backdrop-blur-sm shadow-[4px_0_10px_-2px_rgba(0,0,0,0.5)]">
            Lavaggi
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
                    flex flex-col items-center justify-center border-r border-white/[0.03] relative
                    ${(isHol || isSun) ? 'bg-white/[0.02]' : ''}
                    ${isToday ? 'bg-dr7-gold/40 border-l-2 border-r-2 border-dr7-gold/70' : ''}
                  `}
                  style={{ width: CELL_WIDTH }}
                >
                  {/* Red dot for Sundays and holidays */}
                  {(isHol || isSun) && (
                    <div
                      className="absolute top-1 right-1 w-1 h-1 rounded-full bg-red-500/70"
                      title={isHol ? isHol.name : 'Domenica'}
                    />
                  )}

                  <span
                    className="text-[10px]"
                    style={{ color: 'rgba(255, 255, 255, 0.75)' }}
                  >
                    {day}
                  </span>
                  <span
                    className="text-[8px] uppercase"
                    style={{ color: 'rgba(255, 255, 255, 0.45)' }}
                  >
                    {d.toLocaleDateString('it-IT', { weekday: 'short' })}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* B. Calendar Row */}
        <div className="min-w-max pb-32">
          <div
            className="flex border-b border-white/50 hover:bg-theme-bg-tertiary/30 transition-colors group relative"
            style={{ height: rowHeight }}
          >
            {/* Left Sticky Column */}
            <div className="sticky left-0 w-[200px] z-[30] bg-[#0d0d0e]/95 group-hover:bg-[#111112]/95 border-r border-white/5 flex items-center px-4 backdrop-blur-sm shrink-0 shadow-[4px_0_10px_-2px_rgba(0,0,0,0.5)]">
              <div className="flex flex-col overflow-hidden">
                <span className="font-medium text-sm text-theme-text-primary">Servizi Lavaggio</span>
                <span className="text-xs text-theme-text-muted">{eventsWithLanes.length} prenotazioni</span>
              </div>
            </div>

            {/* The Day Grid & Events Container */}
            <div className="relative flex-1">

              {/* 1. Background Grid Cells */}
              <div className="flex h-full absolute inset-0 z-0 pointer-events-none">
                {daysArray.map((day) => {
                  const d = new Date(currentRomeComponents.year, currentRomeComponents.month, day)
                  const isRedDay = getHolidayForDate(d) || isSunday(d)
                  const isToday = day === todayDay

                  return (
                    <div
                      key={day}
                      className={`
                        border-r border-white/[0.02] h-full
                        ${isToday ? 'bg-dr7-gold/40 border-l-2 border-r-2 border-dr7-gold/70' : 'bg-green-500/[0.15]'}
                        ${isRedDay && !isToday ? 'bg-white/[0.01]' : ''}
                      `}
                      style={{ width: CELL_WIDTH }}
                    />
                  )
                })}
              </div>

              {/* 2. Rendered Events Layer */}
              <div className="absolute inset-0 z-20 pointer-events-none">
                {eventsWithLanes.map(evt => {
                  const bgClass = "bg-red-800"
                  const borderClass = "border-red-700/30"

                  const top = 6 + (evt.laneIndex * (BAR_HEIGHT + 4))

                  return (
                    <div
                      key={evt.booking.id}
                      className={`
                        absolute rounded shadow-md border pointer-events-auto group/evt overflow-hidden flex flex-col justify-center text-white 
                        ${bgClass} ${borderClass} 
                        hover:z-50 hover:shadow-xl hover:brightness-110 transition-all cursor-pointer
                      `}
                      style={{
                        left: evt.leftPx,
                        width: CELL_WIDTH,
                        top: top,
                        height: BAR_HEIGHT,
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedBooking(evt.booking)
                      }}
                    >
                      <div className="px-1 flex flex-col justify-center h-full items-center gap-0.5">
                        <span className="font-bold text-[10px] leading-tight truncate max-w-full">
                          {(() => {
                            const name = evt.booking.customer_name || 'Cliente'
                            // Abbreviate long names
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
                        <span className="font-bold text-[11px] leading-tight">
                          {evt.booking.appointment_time}
                        </span>
                        <span className="text-[9px] leading-tight opacity-80">
                          {(() => {
                            const svc = evt.booking.service_name.toLowerCase()
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

                      {/* Left Edge Marker */}
                      <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-white/50"></div>
                      {/* Right Edge Marker */}
                      <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-white/50"></div>

                      {/* TOOLTIP ON HOVER */}
                      <div className="hidden group-hover/evt:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-900 border border-theme-border text-white text-xs p-3 rounded shadow-2xl w-max z-[100] pointer-events-none min-w-[200px]">
                        <div className="font-bold mb-1 text-base">{evt.booking.customer_name}</div>
                        <div className="text-gray-400 mb-2">{evt.booking.service_name}</div>

                        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                          <span className="text-gray-500">Orario:</span>
                          <span className="font-mono">{evt.booking.appointment_time}</span>

                          <span className="text-gray-500">Durata:</span>
                          <span className="font-mono">{formatDuration(evt.duration)}</span>

                          <span className="text-gray-500">Prezzo:</span>
                          <span className="font-mono">€{(evt.booking.price_total / 100).toFixed(2)}</span>

                          <span className="text-gray-500">Stato:</span>
                          <span className="uppercase font-bold tracking-wider text-[10px]">{evt.booking.status}</span>
                        </div>

                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45 border-r border-b border-theme-border"></div>
                      </div>

                    </div>
                  )
                })}
              </div>
            </div>

          </div>

          {eventsWithLanes.length === 0 && !loading && (
            <div className="p-12 text-center text-theme-text-muted">Nessun lavaggio prenotato questo mese.</div>
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
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
