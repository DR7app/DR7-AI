import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import { getHolidayForDate, isSunday } from '../../../data/italianHolidays'
import { formatRomeDate } from '../../../utils/timezoneUtils'
import { normalizeBooking, computeLanes, type CalendarEvent } from '../../../utils/calendarLogic'
import BookingDetailsPanel from './BookingDetailsPanel'

// --- Configuration ---
const CELL_WIDTH = 45 // Fixed width for day cells
const MIN_ROW_HEIGHT = 60
const BAR_HEIGHT = 30

interface Vehicle {
  id: string
  display_name: string
  plate?: string | null
  status: string
  category: 'exotic' | 'urban' | 'aziendali' | null
  metadata?: {
    unavailable_from?: string
    unavailable_until?: string
    display_group?: string
  }
}

interface Booking {
  id: string
  vehicle_id?: string
  vehicle_name: string
  vehicle_plate?: string
  pickup_date: string
  dropoff_date: string
  status: string
  customer_name: string
  customer_email: string
  price_total: number
  service_type?: string
  booking_details?: any
  type?: 'check-in' | 'check-out' | 'lavaggio' | 'meccanica' | 'varie'
}

export default function CalendarTab({ onNewBooking }: { onNewBooking?: (vehicleName: string, date: Date) => void }) {
  // const { canViewFinancials } = useAdminRole()
  // const [hideFinancials, setHideFinancials] = useState(false) // Removed for now to focus on clean layout


  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)

  // Scroll Sync Refs
  const gridRef = useRef<HTMLDivElement>(null)

  // --- Data Loading ---
  useEffect(() => {
    loadData()
    const subscription = supabase
      .channel('calendar-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => loadData())
      .subscribe()
    return () => { subscription.unsubscribe() }
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const { data: vehiclesData } = await supabase
        .from('vehicles')
        .select('id, display_name, plate, status, category, metadata')
        .neq('status', 'retired')

      const { data: allBookings } = await supabase
        .from('bookings')
        .select('*')
        .neq('status', 'cancelled')
        .order('pickup_date', { ascending: true })

      if (vehiclesData) {
        // Sort: Exotic -> Urban -> Aziendali
        const sorted = vehiclesData.sort((a, b) => {
          const order: Record<string, number> = { 'exotic': 1, 'urban': 2, 'aziendali': 3 }
          const oa = order[a.category || ''] || 99
          const ob = order[b.category || ''] || 99
          return oa - ob || a.display_name.localeCompare(b.display_name)
        })
        setVehicles(sorted)
      }

      if (allBookings) {
        // Filter out irrelevant service types if needed
        const validBookings = allBookings.filter(b =>
          !['car_wash', 'mechanical_service', 'mechanical'].includes(b.service_type || '')
        )
        setBookings(validBookings)
      }
    } catch (e) {
      console.error("Data load failed", e)
    } finally {
      setLoading(false)
    }
  }

  // --- Date Logic ---
  const currentRomeComponents = useMemo(() => {
    // Current view context (Rome Time)
    // We treat 'currentDate' as the state container. 
    // To match the utils logic, we extract the year/month we want to display.
    // If currentDate is local browser time, we just take getFullYear/getMonth.
    return {
      year: currentDate.getFullYear(),
      month: currentDate.getMonth() // 0-indexed
    }
  }, [currentDate])

  const daysInMonth = useMemo(() => {
    // 0-indexed month for Date constructor is correct
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

  // --- Processing ---

  // 1. Group Bookings by Vehicle
  // 2. Normalize to CalendarEvents
  // 3. Compute Lanes
  const processedRows = useMemo(() => {
    const rows: { vehicle: Vehicle, events: CalendarEvent[], laneCount: number }[] = []

    vehicles.forEach(vehicle => {
      const vehicleBookings = bookings.filter(b => {
        // STRICT PLATE-ONLY MATCHING (Non-negotiable)
        // A booking belongs to ONE physical car identified by license plate

        // Normalize plates for comparison (remove spaces, uppercase)
        const vPlate = vehicle.plate?.replace(/\s/g, '').toUpperCase()
        const bPlate = (b.vehicle_plate || b.booking_details?.vehicle?.plate)?.replace(/\s/g, '').toUpperCase()

        // Data integrity check: flag bookings with missing plate
        if (!bPlate) {
          console.warn(`⚠️ MISSING PLATE: Booking ${b.id} for customer "${b.customer_name}" has no license plate. Skipping.`)
          return false
        }

        if (!vPlate) {
          console.warn(`⚠️ MISSING PLATE: Vehicle "${vehicle.display_name}" has no license plate. Cannot match bookings.`)
          return false
        }

        // STRICT EQUALITY: booking.license_plate === vehicle.license_plate
        // Forbidden: matching by model name, display name, or any fuzzy matching
        return vPlate === bPlate
      })

      // Normalize
      const events: CalendarEvent[] = []
      vehicleBookings.forEach(b => {
        const evt = normalizeBooking(b, currentRomeComponents.year, currentRomeComponents.month, {
          cellWidth: CELL_WIDTH,
          daysInMonth
        })
        if (evt) events.push(evt)
      })

      // Compute Lanes
      const laningResults = computeLanes(events)
      const maxLane = laningResults.reduce((max, e) => Math.max(max, e.laneIndex), -1)

      // Filter by search query if needed
      let displayEvents = laningResults
      if (searchQuery) {
        // If filtering, we still might want to show the row, 
        // but maybe dim non-matching? Or just filter the VEHICLES list?
        // Let's rely on the vehicle filter below ideally, but here we process all.
      }

      rows.push({
        vehicle,
        events: displayEvents,
        laneCount: Math.max(1, maxLane + 1) // At least 1 lane height
      })
    })

    // CRITICAL: Duplicate booking detection (always enabled)
    // Ensure no booking appears on multiple vehicle rows
    {
      const bookingToVehicles = new Map<string, string[]>()
      rows.forEach(row => {
        row.events.forEach(evt => {
          const bookingId = evt.booking.id
          if (!bookingToVehicles.has(bookingId)) {
            bookingToVehicles.set(bookingId, [])
          }
          bookingToVehicles.get(bookingId)!.push(row.vehicle.display_name)
        })
      })

      // Check for duplicates
      bookingToVehicles.forEach((vehicleNames, bookingId) => {
        if (vehicleNames.length > 1) {
          console.error(`🚨 CRITICAL: Booking ${bookingId} appears on ${vehicleNames.length} vehicles: ${vehicleNames.join(', ')}`)
        }
      })
    }

    return rows
  }, [vehicles, bookings, currentRomeComponents, daysInMonth])

  // Filter Rows for Display
  const visibleRows = useMemo(() => {
    if (!searchQuery) return processedRows
    const q = searchQuery.toLowerCase()
    return processedRows.filter(row => {
      // Create a simplified flattened string to search
      const vehicleMatch = row.vehicle.display_name.toLowerCase().includes(q) ||
        (row.vehicle.plate || '').toLowerCase().includes(q)
      const bookingMatch = row.events.some(e =>
        e.booking.customer_name.toLowerCase().includes(q)
      )
      return vehicleMatch || bookingMatch
    })
  }, [processedRows, searchQuery])


  // --- Render Helpers ---
  const today = new Date()


  if (loading) return <div className="p-8 text-center animate-pulse">Caricamento Calendario...</div>

  return (
    <div className="flex flex-col h-[calc(100vh-200px)] bg-transparent rounded-xl border border-white/5 shadow-2xl overflow-hidden">

      {/* 1. Control Bar */}
      <div className="flex justify-between items-center p-4 bg-black/20 backdrop-blur-md border-b border-white/5 z-50 shadow-sm">
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
          <input
            type="text"
            placeholder="Cerca veicolo o cliente..."
            className="bg-black/20 border border-white/10 rounded-full px-4 py-1.5 text-sm w-64 focus:outline-none focus:border-dr7-gold/50"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 2. Scrollable Calendar Area */}
      <div className="flex-1 overflow-auto relative flex flex-col w-full" ref={gridRef}>

        {/* A. Sticky Header Row */}
        <div className="flex sticky top-0 z-[40] bg-[#0d0d0e] shadow-md min-w-max h-[42px] border-b border-white/5">
          {/* Header Spacer for Left Column */}
          <div className="sticky left-0 w-[300px] z-[41] bg-[#0d0d0e] border-r border-white/5 flex items-center px-4 font-bold text-xs text-gray-400 uppercase tracking-wider backdrop-blur-sm shadow-[4px_0_10px_-2px_rgba(0,0,0,0.5)]">
            Veicolo / Targa
          </div>

          {/* Day Columns Header */}
          <div className="flex">
            {daysArray.map((day) => {
              const d = new Date(currentRomeComponents.year, currentRomeComponents.month, day)
              const isHol = getHolidayForDate(d)
              const isSun = isSunday(d)

              return (
                <div
                  key={day}
                  className={`
                    flex flex-col items-center justify-center border-r border-white/[0.03] relative
                    ${(isHol || isSun) ? 'bg-white/[0.02]' : ''}
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

        {/* B. Vehicle Rows */}
        <div className="min-w-max pb-32"> {/* Extra padding bottom for tooltips */}
          {visibleRows.map((row) => {
            // Calculate dynamic height based on lanes
            const extraPadding = 12 // Top/Bottom padding
            const rowHeight = Math.max(MIN_ROW_HEIGHT, (row.laneCount * (BAR_HEIGHT + 4)) + extraPadding)

            return (
              <div
                key={row.vehicle.id}
                className="flex border-b border-theme-border/30 hover:bg-theme-bg-tertiary/30 transition-colors group relative"
                style={{ height: rowHeight }}
              >
                {/* Left Sticky Column */}
                <div className="sticky left-0 w-[300px] z-[30] bg-[#0d0d0e]/95 group-hover:bg-[#111112]/95 border-r border-white/5 flex items-center px-4 backdrop-blur-sm shrink-0 shadow-[4px_0_10px_-2px_rgba(0,0,0,0.5)]">
                  <div className="flex flex-col overflow-hidden">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-theme-text-primary truncate" title={row.vehicle.display_name}>{row.vehicle.display_name}</span>
                      {row.vehicle.category && (
                        <span className={`text-[9px] px-2 py-0.5 rounded uppercase font-bold tracking-wider ${row.vehicle.category === 'exotic' ? 'bg-purple-900/50 text-purple-200' :
                          row.vehicle.category === 'urban' ? 'bg-blue-900/50 text-blue-200' :
                            'bg-orange-900/50 text-orange-200'
                          }`}>
                          {row.vehicle.category === 'aziendali' ? 'AZIENDALE' : row.vehicle.category.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-theme-text-muted font-mono">{row.vehicle.plate || '-'}</span>
                  </div>
                </div>

                {/* The Day Grid & Events Container */}
                <div className="relative flex-1">

                  {/* 1. Background Grid Cells */}
                  <div className="flex h-full absolute inset-0 z-0 pointer-events-none">
                    {daysArray.map((day) => {

                      const d = new Date(currentRomeComponents.year, currentRomeComponents.month, day)
                      const isRedDay = getHolidayForDate(d) || isSunday(d)

                      return (
                        <div
                          key={day}
                          className={`
                                border-r border-white/[0.02] h-full
                                bg-green-500/[0.15]
                                ${isRedDay ? 'bg-white/[0.01]' : ''}
                              `}
                          style={{ width: CELL_WIDTH }}
                        />
                      )
                    })}
                  </div>

                  {/* 2. Interactive Click Layer (Create Booking) */}
                  <div className="flex h-full absolute inset-0 z-10">
                    {daysArray.map((day) => (
                      <div
                        key={day}
                        className="h-full hover:bg-white/5 cursor-pointer transition-colors"
                        style={{ width: CELL_WIDTH }}
                        onClick={() => {
                          const date = new Date(currentRomeComponents.year, currentRomeComponents.month, day, 10, 0, 0)
                          if (onNewBooking) onNewBooking(row.vehicle.display_name, date)
                        }}
                        title={`Nuova prenotazione: ${day}/${currentRomeComponents.month + 1}`}
                      />
                    ))}
                  </div>

                  {/* 3. Rendered Events Layer */}
                  <div className="absolute inset-0 z-20 pointer-events-none">
                    {row.events.map(evt => {
                      // STRICT COLOR CONTRACT (Premium Dark Theme)
                      // RED = Customer booking (clean, modern red)
                      // ORANGE = Unavailable (muted orange)

                      let bgClass = "bg-red-500"
                      let borderClass = "border-red-400/30"

                      // Check if this is an unavailability/mechanic booking
                      const isUnavailability = ['car_wash', 'mechanical_service', 'mechanical', 'internal_block'].includes(evt.booking.service_type || '')

                      if (isUnavailability) {
                        bgClass = "bg-orange-500/80"
                        borderClass = "border-orange-400/30"
                      }

                      const top = 6 + (evt.laneIndex * (BAR_HEIGHT + 4))

                      // Markers text

                      // Visual Width Logic: At least 1 cell, but real width is strictly calc'd
                      // If strict width is 0 (e.g. same day small hours?), force min width
                      const finalWidth = Math.max(evt.widthPx, CELL_WIDTH)

                      return (
                        <div
                          key={evt.id}
                          className={`
                                absolute rounded shadow-md border pointer-events-auto group/evt overflow-hidden flex flex-col justify-center text-white 
                                ${bgClass} ${borderClass} 
                                hover:z-50 hover:shadow-xl hover:brightness-110 transition-all
                              `}
                          style={{
                            left: evt.leftPx,
                            width: finalWidth,
                            top: top,
                            height: BAR_HEIGHT,
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            // TODO: Properly open booking edit modal
                            // For now we just alert, but in real integration this should open the modal
                            setSelectedBooking(evt.booking)
                          }}
                        >
                          <div className="px-2 flex flex-col justify-center h-full">
                            <span className="font-bold text-[10px] truncate leading-tight">
                              {evt.booking.customer_name || 'Cliente Sconosciuto'} • {(() => {
                                // Calculate drop-off day: if end time is exactly 00:00, use previous day
                                const endHours = evt.endLocal.getHours()
                                const endMinutes = evt.endLocal.getMinutes()
                                if (endHours === 0 && endMinutes === 0) {
                                  // Exactly midnight - drop-off is previous day
                                  const prevDay = new Date(evt.endLocal)
                                  prevDay.setDate(prevDay.getDate() - 1)
                                  return prevDay.getDate()
                                } else {
                                  // Any other time - drop-off is this day
                                  return evt.endLocal.getDate()
                                }
                              })()}
                            </span>

                          </div>

                          {/* Left Edge Marker (Pickup) */}
                          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-white/50"></div>
                          {/* Right Edge Marker (Dropoff) */}
                          <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-white/50"></div>


                          {/* TOOLTIP ON HOVER */}
                          <div className="hidden group-hover/evt:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-900 border border-theme-border text-white text-xs p-3 rounded shadow-2xl w-max z-[100] pointer-events-none min-w-[200px]">
                            <div className="font-bold mb-1 text-base">{evt.booking.customer_name}</div>
                            <div className="text-gray-400 mb-2">{evt.booking.vehicle_name} ({evt.booking.vehicle_plate})</div>

                            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                              <span className="text-gray-500">Ritiro:</span>
                              <span className="font-mono">{formatRomeDate(evt.startLocal, { dateStyle: 'full', timeStyle: 'short' })}</span>

                              <span className="text-gray-500">Rientro:</span>
                              <span className="font-mono">{formatRomeDate(evt.endLocal, { dateStyle: 'full', timeStyle: 'short' })}</span>

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
            )
          })}

          {visibleRows.length === 0 && !loading && (
            <div className="p-12 text-center text-theme-text-muted">Nessun veicolo trovato.</div>
          )}
        </div>

      </div>

      {/* Booking Details Panel */}
      {selectedBooking && (
        <BookingDetailsPanel
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
        />
      )}
    </div>
  )
}
