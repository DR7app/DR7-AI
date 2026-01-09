import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import { FinancialData } from '../../../components/FinancialData'
import { useAdminRole } from '../../../hooks/useAdminRole'
import { getHolidayForDate, isSunday } from '../../../data/italianHolidays'

interface Vehicle {
  id: string
  display_name: string
  plate?: string | null
  status: string
  category: 'exotic' | 'urban' | 'aziendali' | null
  metadata?: {
    unavailable_from?: string
    unavailable_until?: string
    unavailable_from_time?: string
    unavailable_until_time?: string
    unavailable_reason?: string
    display_group?: string
  }
}

interface Booking {
  id: string
  vehicle_id?: string // Added vehicle_id
  vehicle_name: string
  vehicle_plate?: string
  pickup_date: string
  dropoff_date: string
  status: string
  customer_name: string
  customer_email: string
  price_total: number
  payment_status?: string
  amount_paid?: string
  booking_details?: any
  type?: 'check-in' | 'check-out' | 'lavaggio' | 'meccanica' | 'varie'
}

type CellStatus = 'available' | 'rented' | 'unavailable'

export default function CalendarTab({ onNewBooking: _onNewBooking }: { onNewBooking?: (vehicleName: string, date: Date) => void }) {
  const { canViewFinancials } = useAdminRole()
  const [hideFinancials, setHideFinancials] = useState(false)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedCell, setSelectedCell] = useState<{
    vehicle: string
    date: string
    bookings: Booking[]
  } | null>(null)
  const [selectedUnavailability, setSelectedUnavailability] = useState<Vehicle | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [changingVehicle, setChangingVehicle] = useState<string | null>(null) // booking id being changed
  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    loadData()
    // Fetch current user email
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserEmail(data.user.email || null)
      }
    })

    // Real-time subscription
    const subscription = supabase
      .channel('calendar-updates')
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
      // Load vehicles - Custom order: Exotic → Urban → Aziendali
      const { data: vehiclesData, error: vehiclesError } = await supabase
        .from('vehicles')
        .select('id, display_name, plate, status, category, metadata')
        .neq('status', 'retired')

      console.log('🚗 RAW VEHICLES QUERY RESULT:', { vehiclesData, vehiclesError })

      if (vehiclesError) {
        console.error('❌ VEHICLES ERROR:', vehiclesError)
        throw vehiclesError
      }

      // Sort vehicles by category: exotic first, then urban, then aziendali
      const sortedVehicles = vehiclesData?.sort((a, b) => {
        const categoryOrder: Record<string, number> = {
          'exotic': 1,
          'urban': 2,
          'aziendali': 3
        }
        const orderA = categoryOrder[a.category || ''] || 999
        const orderB = categoryOrder[b.category || ''] || 999

        if (orderA !== orderB) return orderA - orderB
        return a.display_name.localeCompare(b.display_name)
      })

      // Load bookings (only car rentals, not car wash) - include ALL statuses except cancelled
      const { data: allBookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .neq('status', 'cancelled')
        .order('pickup_date', { ascending: true })

      if (bookingsError) throw bookingsError

      // Filter out car wash and mechanical bookings client-side
      const bookingsData = allBookingsData?.filter(b =>
        b.service_type !== 'car_wash' &&
        b.service_type !== 'mechanical_service' &&
        b.service_type !== 'mechanical'
      ) || []

      console.log('📅 CALENDARIO - Veicoli caricati:', vehiclesData?.length || 0)
      console.log('📅 CALENDARIO - Prenotazioni caricate:', bookingsData?.length || 0)

      if (bookingsData && bookingsData.length > 0) {
        console.log('📅 CALENDARIO - Prima prenotazione:', {
          vehicle: bookingsData[0].vehicle_name,
          pickup: bookingsData[0].pickup_date,
          dropoff: bookingsData[0].dropoff_date,
          status: bookingsData[0].status
        })
      }

      // Log vehicle names for debugging matching
      const vehicleNames = sortedVehicles?.map(v => v.display_name) || []
      const bookingNames = [...new Set(bookingsData?.map(b => b.vehicle_name))]

      console.log('📅 CALENDARIO - Nomi veicoli:', vehicleNames)
      console.log('📅 CALENDARIO - Nomi nelle prenotazioni:', bookingNames)

      // Check for mismatches
      console.log('📅 CALENDARIO - CONFRONTO NOMI:')
      bookingNames.forEach(bookingName => {
        const exactMatch = vehicleNames.some(vName => vName === bookingName)
        const normalizedMatch = vehicleNames.some(vName =>
          vName?.trim().toLowerCase() === bookingName?.trim().toLowerCase()
        )
        const partialMatch = vehicleNames.find(vName =>
          vName?.toLowerCase().includes(bookingName?.toLowerCase()) ||
          bookingName?.toLowerCase().includes(vName?.toLowerCase())
        )

        console.log(`  "${bookingName}" → Exact: ${exactMatch}, Normalized: ${normalizedMatch}, Partial: "${partialMatch || 'NO MATCH'}"`)
      })

      setVehicles(sortedVehicles || [])
      setBookings(bookingsData || [])
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Get alternative vehicles for a booking (grouped vehicles or similar models)
  function getAlternativeVehicles(currentVehicleName: string): Vehicle[] {
    const currentVehicle = vehicles.find(v => v.display_name === currentVehicleName)

    if (!currentVehicle) {
      return []
    }

    // If vehicle has a display_group, get all vehicles in that group
    const displayGroup = currentVehicle.metadata?.display_group
    if (displayGroup) {
      return vehicles.filter(v => v.metadata?.display_group === displayGroup)
    }

    // Otherwise, find vehicles with similar names (for manual grouping)
    const baseName = currentVehicleName.split('(')[0].trim().toLowerCase()
    return vehicles.filter(v =>
      v.display_name.toLowerCase().includes(baseName) ||
      baseName.includes(v.display_name.toLowerCase())
    )
  }

  // Update booking vehicle
  async function changeBookingVehicle(bookingId: string, newVehicleName: string) {
    setChangingVehicle(bookingId)
    try {
      const newVehicle = vehicles.find(v => v.display_name === newVehicleName)

      const { error } = await supabase
        .from('bookings')
        .update({
          vehicle_name: newVehicleName,
          vehicle_plate: newVehicle?.plate || null
        })
        .eq('id', bookingId)

      if (error) throw error

      // Reload data to reflect changes
      await loadData()

      // Update selectedCell if it's open
      if (selectedCell) {
        const updatedBookings = selectedCell.bookings.map(b =>
          b.id === bookingId
            ? { ...b, vehicle_name: newVehicleName, vehicle_plate: newVehicle?.plate || undefined }
            : b
        )
        setSelectedCell({ ...selectedCell, bookings: updatedBookings })
      }

      alert('✅ Veicolo modificato con successo!')
    } catch (error) {
      console.error('Error changing vehicle:', error)
      alert('❌ Errore durante la modifica del veicolo')
    } finally {
      setChangingVehicle(null)
    }
  }

  const daysInMonth = useMemo(() => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const lastDay = new Date(year, month + 1, 0).getDate()
    return Array.from({ length: lastDay }, (_, i) => i + 1)
  }, [currentDate])

  const getCellStatus = (vehicle: Vehicle, day: number): CellStatus => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const checkDate = new Date(year, month, day)
    checkDate.setHours(0, 0, 0, 0)

    // Check if vehicle is marked as unavailable
    if (vehicle.status === 'unavailable') {
      // If no date range specified, mark ALL dates as unavailable
      if (!vehicle.metadata?.unavailable_from && !vehicle.metadata?.unavailable_until) {
        return 'unavailable'
      }

      // If date range specified, check if current date falls within range
      if (vehicle.metadata?.unavailable_from && vehicle.metadata?.unavailable_until) {
        const unavailableFrom = new Date(vehicle.metadata.unavailable_from)
        const unavailableUntil = new Date(vehicle.metadata.unavailable_until)
        unavailableFrom.setHours(0, 0, 0, 0)
        unavailableUntil.setHours(0, 0, 0, 0)

        if (checkDate >= unavailableFrom && checkDate <= unavailableUntil) {
          return 'unavailable'
        }
      }
    }

    // Find bookings for this vehicle on this day
    const vehicleBookings = bookings.filter(booking => {
      let isMatch = false
      // Check root vehicle_id first, then nested
      const bookingVehicleId = booking.vehicle_id || booking.booking_details?.vehicle?.id || booking.booking_details?.vehicle_id

      // Get plate from any possible source
      const bookingPlate = booking.vehicle_plate ||
        booking.booking_details?.vehicle?.plate ||
        booking.booking_details?.vehicle?.targa ||
        booking.booking_details?.targa

      // 1. Match by Vehicle ID (most accurate)
      if (bookingVehicleId && bookingVehicleId === vehicle.id) {
        isMatch = true
      }
      // 2. Match by Plate (Strict)
      else if (bookingPlate) {
        if (vehicle.plate) {
          isMatch = vehicle.plate.trim().toUpperCase() === bookingPlate.trim().toUpperCase()
        } else {
          // Booking has plate, Vehicle doesn't. 
          // STRICTLY reject match to avoid duplicates across generic "Clio Blue" rows.
          isMatch = false
        }
      }
      // 3. Fallback to Name (Only if no ID and no Plate info on booking)
      else {
        isMatch = booking.vehicle_name?.trim().toLowerCase() === vehicle.display_name?.trim().toLowerCase()
      }

      if (!isMatch) return false

      const pickupDate = new Date(booking.pickup_date)
      const dropoffDate = new Date(booking.dropoff_date)
      pickupDate.setHours(0, 0, 0, 0)
      dropoffDate.setHours(0, 0, 0, 0)

      return checkDate >= pickupDate && checkDate < dropoffDate
    })

    return vehicleBookings.length > 0 ? 'rented' : 'available'
  }

  interface BookingSegment {
    bookingId: string
    vehicleId: string
    startDay: number
    endDay: number
    columnSpan: number
    booking: Booking
  }

  // Helper to normalize plate strings (remove spaces, uppercase)
  const normalizePlate = (s: string | null | undefined) => {
    if (!s) return ''
    return s.replace(/\s+/g, '').toUpperCase()
  }

  // ... inside component ...

  // Build booking segments for overlay bars
  const buildBookingSegments = useMemo(() => {
    const segments: BookingSegment[] = []
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const lastDay = new Date(year, month + 1, 0).getDate()

    for (const vehicle of vehicles) {
      for (const booking of bookings) {
        // Match booking to vehicle with strict priority:
        // 1. Match by Vehicle ID (most accurate)
        // 2. Match by Plate (Strict but robust)
        // 3. Match by Name (Fallback)

        let isMatch = false
        // Check root vehicle_id first, then nested
        const bookingVehicleId = booking.vehicle_id || booking.booking_details?.vehicle?.id || booking.booking_details?.vehicle_id

        // Get plate from any possible source
        const rawBookingPlate = booking.vehicle_plate ||
          booking.booking_details?.vehicle?.plate ||
          booking.booking_details?.vehicle?.targa ||
          booking.booking_details?.targa

        const vehiclePlate = normalizePlate(vehicle.plate)
        const bookingPlate = normalizePlate(rawBookingPlate)

        if (bookingVehicleId && bookingVehicleId === vehicle.id) {
          isMatch = true
          console.log(`📍 [Calendar] Booking ${booking.id.substring(0, 8)} matched to ${vehicle.display_name} by vehicle_id`)
        } else if (bookingPlate && vehiclePlate) {
          // Both have plates - MUST match
          isMatch = vehiclePlate === bookingPlate
          if (isMatch) {
            console.log(`📍 [Calendar] Booking ${booking.id.substring(0, 8)} matched to ${vehicle.display_name} by plate: ${vehiclePlate}`)
          }
        } else {
          // One or both missing plate - Fallback to name match
          // This covers: 
          // 1. Booking has plate, Vehicle doesn't
          // 2. Vehicle has plate, Booking doesn't
          // 3. Neither has plate
          isMatch = booking.vehicle_name?.trim().toLowerCase() === vehicle.display_name?.trim().toLowerCase()
          if (isMatch) {
            console.log(`⚠️ [Calendar] Booking ${booking.id.substring(0, 8)} matched to ${vehicle.display_name} by NAME ONLY (plate missing)`)
          }
        }

        if (!isMatch) continue

        const pickupDate = new Date(booking.pickup_date)
        const dropoffDate = new Date(booking.dropoff_date)
        pickupDate.setHours(0, 0, 0, 0)
        dropoffDate.setHours(0, 0, 0, 0)

        const monthStart = new Date(year, month, 1)
        const monthEnd = new Date(year, month + 1, 0)
        monthStart.setHours(0, 0, 0, 0)
        monthEnd.setHours(23, 59, 59, 999)

        // Skip if booking doesn't overlap this month
        if (dropoffDate <= monthStart || pickupDate > monthEnd) continue

        // Calculate start/end days within month
        const startDay = pickupDate.getMonth() === month ? pickupDate.getDate() : 1
        const endDay = dropoffDate.getMonth() === month ? Math.min(dropoffDate.getDate() - 1, lastDay) : lastDay

        if (startDay <= endDay) {
          segments.push({
            bookingId: booking.id,
            vehicleId: vehicle.id,
            startDay,
            endDay,
            columnSpan: endDay - startDay + 1,
            booking
          })
        }
      }
    }

    return segments
  }, [vehicles, bookings, currentDate])





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

  // Get today's date for highlighting
  const today = new Date()
  const isCurrentMonth = today.getMonth() === currentDate.getMonth() &&
    today.getFullYear() === currentDate.getFullYear()
  const todayDay = isCurrentMonth ? today.getDate() : null

  // Filter vehicles for display - SHARED LOGIC
  const filteredVehicles = useMemo(() => {
    return vehicles.filter(vehicle => {
      if (!searchQuery) return true
      const query = searchQuery.toLowerCase()
      // Use same logic as before
      return bookings.some(booking => {
        const customerName = booking.customer_name || booking.booking_details?.customer?.fullName
        if (!customerName) return false

        const bookingVehicle = booking.vehicle_name?.trim().toLowerCase()
        const vehicleDisplay = vehicle.display_name?.trim().toLowerCase()

        const vehiclePlate = normalizePlate(vehicle.plate)
        const bookingPlate = normalizePlate(booking.vehicle_plate || booking.booking_details?.vehicle?.plate)

        if (vehiclePlate && bookingPlate && vehiclePlate === bookingPlate) {
          return customerName.toLowerCase().includes(query)
        }

        const vehicleMatches = bookingVehicle === vehicleDisplay ||
          (bookingVehicle && vehicleDisplay && (
            bookingVehicle.includes(vehicleDisplay) ||
            vehicleDisplay.includes(bookingVehicle)
          ))
        return vehicleMatches && customerName.toLowerCase().includes(query)
      })
    })
  }, [vehicles, bookings, searchQuery])

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
        <p className="text-theme-text-primary">Caricamento calendario...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div className="bg-gradient-to-br from-gray-900/95 to-black/95 backdrop-blur-xl rounded-2xl border border-white/10 p-4 lg:p-6 shadow-2xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-wrap">
            <h2 className="text-xl font-light text-theme-text-primary">Calendario Flotta</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-theme-text-muted">Questo Mese:</span>
              <span className="text-dr7-gold font-semibold text-sm">
                {bookings.filter(b => {
                  const pickupDate = new Date(b.pickup_date)
                  return pickupDate.getMonth() === currentDate.getMonth() &&
                    pickupDate.getFullYear() === currentDate.getFullYear()
                }).length} noleggi
              </span>
            </div>
            {canViewFinancials && !hideFinancials && userEmail !== 'dubai.rent7.0srl@gmail.com' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-theme-text-muted">Fatturato:</span>
                <span className="text-green-400 font-semibold text-sm">
                  <FinancialData type="total">
                    €{(bookings
                      .filter(b => {
                        const pickupDate = new Date(b.pickup_date)
                        return pickupDate.getMonth() === currentDate.getMonth() &&
                          pickupDate.getFullYear() === currentDate.getFullYear()
                      })
                      .reduce((sum, b) => sum + (b.price_total || 0), 0) / 100).toFixed(2)}
                  </FinancialData>
                </span>
              </div>
            )}
            {/* Legend */}
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-gradient-to-br from-green-500 to-green-600 shadow-lg shadow-green-500/50"></div>
                <span className="text-theme-text-secondary font-light">Disponibile</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg shadow-orange-500/50"></div>
                <span className="text-theme-text-secondary font-light">Non Disponibile</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-gradient-to-br from-red-500 to-red-600 shadow-lg shadow-red-500/50"></div>
                <span className="text-theme-text-secondary font-light">Noleggiato</span>
              </div>
            </div>
            {canViewFinancials && (
              <button
                onClick={() => setHideFinancials(!hideFinancials)}
                className={`px-4 py-2 rounded-full text-xs font-semibold transition-all duration-200 ${hideFinancials
                  ? 'bg-green-600/20 border border-green-500/30 text-green-400 hover:bg-green-600/30'
                  : 'bg-yellow-600/20 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-600/30'
                  }`}
              >
                {hideFinancials ? 'MOSTRA' : 'NASCONDI'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Search and Navigation Bar */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-2xl font-light text-theme-text-primary mb-3 capitalize">{monthName}</h3>
          <input
            type="text"
            placeholder="Cerca cliente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-4 py-2 bg-white/5 border border-white/10 rounded-full text-theme-text-primary placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 focus:border-dr7-gold/30 w-64 backdrop-blur-sm transition-all"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigateMonth('prev')}
            className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-theme-text-primary text-sm transition-all duration-200 hover:shadow-lg hover:shadow-white/20"
            aria-label="Mese precedente"
          >
            Prec
          </button>
          <button
            onClick={() => navigateMonth('next')}
            className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-theme-text-primary text-sm transition-all duration-200 hover:shadow-lg hover:shadow-white/20"
            aria-label="Mese successivo"
          >
            Succ
          </button>
        </div>
      </div>

      {/* Search Results - Show matching bookings */}
      {searchQuery && (
        <div className="bg-theme-bg-secondary rounded-lg p-4 border border-theme-border">
          <h3 className="text-lg font-bold text-theme-text-primary mb-3">
            Risultati ricerca: "{searchQuery}"
          </h3>
          {(() => {
            const matchingBookings = bookings.filter(booking => {
              const customerName = booking.customer_name || booking.booking_details?.customer?.fullName || ''
              return customerName && customerName.toLowerCase().includes(searchQuery.toLowerCase())
            })

            if (matchingBookings.length === 0) {
              return (
                <p className="text-theme-text-muted text-sm">Nessuna prenotazione trovata con questo nome cliente.</p>
              )
            }

            return (
              <div className="space-y-2">
                {matchingBookings.map(booking => (
                  <div
                    key={booking.id}
                    className="bg-theme-bg-tertiary p-3 rounded border border-theme-border hover:border-dr7-gold transition-colors"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-theme-text-primary font-semibold">
                          {booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A'}
                        </p>
                        <p className="text-theme-text-muted text-sm">
                          {booking.customer_email || booking.booking_details?.customer?.email || 'N/A'}
                        </p>
                        <p className="text-dr7-gold text-sm mt-1">
                          🚗 {booking.vehicle_name}
                          {booking.vehicle_plate && <span className="text-theme-text-muted"> ({booking.vehicle_plate})</span>}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-theme-text-secondary text-sm">
                          {booking.dropoff_date ? `Rientro: ${new Date(booking.dropoff_date).toLocaleDateString('it-IT')} ${new Date(booking.dropoff_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : 'Data rientro non valida'}
                        </p>
                        <span className={`inline-block px-2 py-1 rounded text-xs mt-1 ${booking.status === 'confirmed' ? 'bg-green-900 text-green-200' :
                          booking.status === 'pending' ? 'bg-yellow-900 text-yellow-200' :
                            'bg-gray-700 text-theme-text-secondary'
                          }`}>
                          {booking.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      )}

      {/* Month Grid */}
      {vehicles.length > 0 && (
        <div className="bg-theme-bg-secondary rounded-lg p-4 lg:p-6 overflow-x-auto">
          <h3 className="text-lg font-bold text-theme-text-primary mb-4 flex items-center gap-2">
            <span className="text-sm text-theme-text-muted">Tutti i Veicoli ({vehicles.length})</span>
          </h3>

          <div className="relative min-w-max">
            {/* Layer 1: Availability Grid (Base) */}
            {/* Layer 1: Availability Grid (Base) */}
            <table className="w-full border-collapse">
              <thead>
                <tr className="h-10">
                  <th className="sticky left-0 top-0 z-50 bg-theme-bg-secondary border border-theme-border/40 px-3 py-2 text-left text-theme-text-primary font-bold text-xs w-[200px] min-w-[200px] max-w-[200px] shadow-lg box-border">
                    Veicolo
                  </th>
                  <th className="sticky left-[200px] top-0 z-50 bg-theme-bg-secondary border border-theme-border/40 px-3 py-2 text-left text-theme-text-primary font-bold text-xs w-[100px] min-w-[100px] max-w-[100px] shadow-lg box-border">
                    Targa
                  </th>
                  {daysInMonth.map(day => {
                    const year = currentDate.getFullYear()
                    const month = currentDate.getMonth()
                    const dayDate = new Date(year, month, day)
                    const holiday = getHolidayForDate(dayDate)
                    const isSundayDay = isSunday(dayDate)

                    return (
                      <th
                        key={day}
                        className={`sticky top-0 z-30 border border-theme-border/40 px-1 py-1 text-center text-[10px] font-semibold w-[40px] min-w-[40px] max-w-[40px] relative group cursor-help box-border ${day === todayDay ? 'bg-dr7-gold/20 text-dr7-gold' :
                          holiday || isSundayDay ? 'bg-red-900/90 border-red-500/30 text-red-300' : // Solid bg to hide scroll
                            'text-theme-text-muted bg-theme-bg-secondary' // Solid bg to hide scroll
                          }`}
                      >
                        <div className="flex flex-col items-center justify-between h-full py-0.5">
                          <span className="text-[10px] leading-none mb-1">{day}</span>
                          {holiday ? (
                            <span className="text-[7px] leading-tight font-medium text-theme-text-primary uppercase tracking-tight absolute bottom-0.5 left-0 right-0 overflow-visible whitespace-nowrap z-10 px-0.5" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                              {holiday.label}
                            </span>
                          ) : isSundayDay && (
                            <div className="w-1.5 h-1.5 rounded-full bg-white mb-0.5 shadow-sm"></div>
                          )}
                        </div>

                        {(holiday || isSundayDay) && (
                          <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-theme-bg-secondary text-theme-text-primary text-[10px] rounded shadow-lg border border-theme-border whitespace-nowrap z-50 pointer-events-none">
                            {holiday ? holiday.name : 'Domenica'}
                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                          </div>
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.map((vehicle) => (
                  <tr key={vehicle.id} className="relative group/row hover:bg-white/5 transition-colors h-10">
                    <td className="sticky left-0 z-40 bg-theme-bg-secondary border border-theme-border/40 px-3 py-2 text-theme-text-primary font-semibold text-sm shadow-lg group-hover/row:bg-theme-bg-tertiary transition-colors w-[200px] min-w-[200px] max-w-[200px] box-border overflow-hidden">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate" title={vehicle.display_name}>{vehicle.display_name}</span>
                          {vehicle.category && (
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider whitespace-nowrap ${vehicle.category === 'exotic'
                              ? 'bg-purple-600 text-theme-text-primary shadow-purple-500/20 shadow-sm'
                              : vehicle.category === 'urban'
                                ? 'bg-cyan-600 text-theme-text-primary shadow-cyan-500/20 shadow-sm'
                                : 'bg-orange-600 text-theme-text-primary shadow-orange-500/20 shadow-sm'
                              }`}>
                              {vehicle.category}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="sticky left-[200px] z-40 bg-theme-bg-secondary border border-theme-border/40 px-3 py-2 text-theme-text-secondary text-xs font-mono shadow-lg group-hover/row:bg-theme-bg-tertiary transition-colors w-[100px] min-w-[100px] max-w-[100px] box-border overflow-hidden">
                      {vehicle.plate || '-'}
                    </td>
                    {daysInMonth.map(day => {
                      const status = getCellStatus(vehicle, day)

                      return (
                        <td
                          key={day}
                          onClick={() => {
                            if (status === 'available') {
                              // Open booking form for available days
                              const year = currentDate.getFullYear()
                              const month = currentDate.getMonth()
                              const selectedDate = new Date(year, month, day)
                              // Trigger the onNewBooking callback if provided
                              // This will open the booking form in the parent component
                              window.dispatchEvent(new CustomEvent('openBookingForm', {
                                detail: {
                                  vehicleName: vehicle.display_name,
                                  date: selectedDate
                                }
                              }))
                            } else if (status === 'unavailable') {
                              setSelectedUnavailability(vehicle)
                            }
                          }}
                          className={`border border-theme-border/30 h-10 w-[40px] min-w-[40px] max-w-[40px] transition-colors cursor-pointer box-border ${status === 'rented'
                            ? 'bg-red-500/15' // Red for booked
                            : status === 'unavailable'
                              ? 'bg-theme-bg-tertiary/60'
                              : 'bg-green-500/30 hover:bg-green-500/40' // Green for available
                            } ${day === todayDay ? 'ring-1 ring-inset ring-dr7-gold/50 bg-dr7-gold/5' : ''}`}
                        />
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Layer 2: Booking Bars Overlay */}
            <div className="absolute top-0 left-0 right-0 pointer-events-none" style={{ top: '40px' }}>
              {filteredVehicles.map((vehicle, index) => (
                <div
                  key={vehicle.id}
                  className="absolute h-10" // Matched row height
                  style={{
                    left: '300px',
                    right: 0,
                    top: `${index * 40}px` // CRITICAL FIX: Position vertically based on filtered index
                  }}
                >
                  {buildBookingSegments
                    .filter(seg => seg.vehicleId === vehicle.id)
                    .map(segment => {
                      const cellWidth = 40 // min-w-[40px]
                      const left = (segment.startDay - 1) * cellWidth
                      const width = segment.columnSpan * cellWidth

                      // Determine color based on booking type (matching DailyCalendarModal)
                      let colorClass = "border-red-600"
                      let gradientClass = "from-red-600/90 via-red-800/50 to-transparent"
                      let glowClass = "hover:shadow-red-600/40"
                      let textColorClass = "text-red-500"

                      if (segment.booking.type === 'check-out') {
                        textColorClass = "text-yellow-400"
                      } else if (segment.booking.type === 'lavaggio') {
                        colorClass = "border-blue-500"
                        gradientClass = "from-blue-500/70 via-blue-700/40 to-transparent"
                        glowClass = "hover:shadow-blue-500/30"
                        textColorClass = "text-blue-500"
                      } else if (segment.booking.type === 'meccanica') {
                        colorClass = "border-orange-500"
                        gradientClass = "from-orange-500/70 via-orange-700/40 to-transparent"
                        glowClass = "hover:shadow-orange-500/30"
                        textColorClass = "text-orange-500"
                      }

                      const getLabel = () => {
                        switch (segment.booking.type) {
                          case 'check-in': return 'USCITE'
                          case 'check-out': return 'RIENTRI'
                          case 'lavaggio': return 'LAVAGGIO'
                          case 'meccanica': return 'MECCANICA'
                          default: return null // Don't show label for regular rentals
                        }
                      }

                      const getTarga = (): string => {
                        return segment.booking.vehicle_plate ||
                          segment.booking.booking_details?.vehicle?.targa ||
                          segment.booking.booking_details?.vehicle?.plate ||
                          ''
                      }

                      const dropoffDate = new Date(segment.booking.dropoff_date)
                      const dropoffDay = dropoffDate.getDate()
                      const dropoffTime = dropoffDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })

                      // Build detailed tooltip with vehicle linkage info
                      const buildTooltip = () => {
                        const parts = [
                          `👤 ${segment.booking.customer_name}`,
                          `🚗 ${segment.booking.vehicle_name}`,
                          `🔖 Targa: ${getTarga() || 'N/A'}`
                        ]

                        // Add vehicle linkage details for debugging
                        if (segment.booking.vehicle_id) {
                          parts.push(`🔗 Vehicle ID: ${segment.booking.vehicle_id.substring(0, 8)}...`)
                        }

                        // Show how this booking was matched to this vehicle row
                        const matchMethod = segment.booking.vehicle_id === vehicle.id
                          ? '✅ Matched by ID'
                          : normalizePlate(segment.booking.vehicle_plate) === normalizePlate(vehicle.plate)
                            ? '✅ Matched by Plate'
                            : '⚠️ Matched by Name'
                        parts.push(matchMethod)

                        return parts.join('\n')
                      }

                      return (
                        <div
                          key={segment.bookingId}
                          className={`absolute pointer-events-auto bg-gradient-to-r ${gradientClass} border-l-2 ${colorClass} px-3 transition-all duration-200 hover:scale-[1.01] hover:shadow-lg ${glowClass} cursor-pointer z-20`}
                          style={{
                            left: `${left}px`,
                            width: `${width}px`,
                            top: '2px',
                            height: '36px' // Fill the cell height
                          }}
                          onClick={() => {
                            const pickup = new Date(segment.booking.pickup_date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
                            const dropoff = new Date(segment.booking.dropoff_date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
                            setSelectedCell({
                              vehicle: vehicle.display_name,
                              date: `${pickup} - ${dropoff}`,
                              bookings: [segment.booking]
                            })
                          }}
                          title={buildTooltip()}
                        >
                          {/* Match DailyCalendarModal layout */}
                          <div className="flex items-center gap-2 h-full">
                            {/* Label badge - only for special types */}
                            {getLabel() && (
                              <div className={`inline-block px-2 py-0.5 rounded-full bg-white/10 text-[10px] font-semibold uppercase tracking-wide ${textColorClass} whitespace-nowrap`}>
                                {getLabel()}
                              </div>
                            )}

                            {/* Customer name */}
                            <div className="text-theme-text-primary font-semibold text-sm truncate">
                              {segment.booking.customer_name || 'N/A'}
                            </div>

                            {/* Return date and time - always show */}
                            <div className="text-theme-text-primary/80 text-xs whitespace-nowrap">
                              {dropoffDay} {dropoffTime}
                            </div>

                          </div>
                        </div>
                      )
                    })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {
        vehicles.length === 0 && (
          <div className="bg-theme-bg-secondary rounded-lg p-8 text-center">
            <p className="text-theme-text-muted">Nessun veicolo trovato</p>
          </div>
        )
      }

      {/* Booking Details Modal */}
      {
        selectedCell && (
          <div
            className="fixed inset-0 bg-theme-bg-primary/60 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fadeIn"
            onClick={() => setSelectedCell(null)}
          >
            <div
              className="bg-gradient-to-br from-gray-900/95 to-black/95 backdrop-blur-xl rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-white/10 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-white/10">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-2xl font-light text-theme-text-primary mb-2">
                      {selectedCell.vehicle}
                    </h3>
                    <p className="text-theme-text-muted text-sm">{selectedCell.date}</p>
                  </div>
                  <button
                    onClick={() => setSelectedCell(null)}
                    className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center transition-all duration-200 hover:rotate-90 text-theme-text-primary text-xl"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-4">
                {selectedCell.bookings.map(booking => {
                  const alternativeVehicles = getAlternativeVehicles(booking.vehicle_name)
                  const hasAlternatives = alternativeVehicles.length > 1

                  return (
                    <div key={booking.id} className="bg-gradient-to-br from-red-500/20 to-red-600/10 backdrop-blur-sm rounded-lg p-5 border-l-2 border-red-500 border border-white/10 hover:scale-[1.01] transition-all duration-200">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <div className="text-theme-text-primary font-medium text-lg mb-1">
                            {booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A'}
                          </div>
                          <div className="text-theme-text-secondary text-sm">
                            {booking.customer_email || booking.booking_details?.customer?.email || 'N/A'}
                          </div>
                        </div>
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-red-400 border border-red-500/30">
                          {booking.status}
                        </span>
                      </div>

                      {/* Vehicle selection dropdown */}
                      {hasAlternatives && (
                        <div className="mb-4 p-3 bg-theme-bg-secondary/50 rounded-lg border border-theme-border">
                          <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                            Veicolo Assegnato (Targa)
                          </label>
                          <select
                            value={booking.vehicle_name}
                            onChange={(e) => changeBookingVehicle(booking.id, e.target.value)}
                            disabled={changingVehicle === booking.id}
                            className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-md text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold disabled:opacity-50"
                          >
                            {alternativeVehicles.map(vehicle => (
                              <option key={vehicle.id} value={vehicle.display_name}>
                                {vehicle.display_name} {vehicle.plate ? `(${vehicle.plate})` : '(Nessuna targa)'}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-gray-500 mt-1">
                            Cambia il veicolo assegnato per questa prenotazione
                          </p>
                        </div>
                      )}

                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-theme-text-muted">Ritiro:</span>
                          <span className="text-theme-text-primary font-medium">
                            {new Date(booking.pickup_date).toLocaleString('it-IT', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false
                            })}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-theme-text-muted">Riconsegna:</span>
                          <span className="text-theme-text-primary font-medium">
                            {new Date(booking.dropoff_date).toLocaleString('it-IT', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false
                            })}
                          </span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-theme-border">
                          <span className="text-theme-text-muted">Prezzo Totale:</span>
                          <span className="text-dr7-gold font-bold text-lg">
                            {userEmail === 'dubai.rent7.0srl@gmail.com' ? '***' : `€${(booking.price_total / 100).toFixed(2)}`}
                          </span>
                        </div>
                        {(() => {
                          const totalAmount = booking.price_total || 0
                          const paidAmount = booking.booking_details?.amount_paid || 0
                          const remaining = totalAmount - paidAmount

                          if (remaining > 0) {
                            return (
                              <div className="flex justify-between pt-2 border-t border-orange-500/30">
                                <span className="text-orange-400 font-medium">Da Saldare:</span>
                                <span className="text-orange-400 font-bold text-lg">
                                  {userEmail === 'dubai.rent7.0srl@gmail.com' ? '***' : `€${(remaining / 100).toFixed(2)}`}
                                </span>
                              </div>
                            )
                          }
                          return null
                        })()}
                      </div>

                      <div className="mt-3 text-xs text-gray-500">
                        ID: DR7-{booking.id.toUpperCase().slice(0, 8)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )
      }

      {/* Unavailability Details Modal */}
      {
        selectedUnavailability && (
          <div
            className="fixed inset-0 bg-theme-bg-primary/80 flex items-center justify-center z-50 p-4"
            onClick={() => setSelectedUnavailability(null)}
          >
            <div
              className="bg-theme-bg-secondary rounded-xl max-w-lg w-full border border-theme-border shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-theme-border">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-2xl font-bold text-theme-text-primary mb-2">
                      Dettagli Indisponibilità
                    </h3>
                  </div>
                  <button
                    onClick={() => setSelectedUnavailability(null)}
                    className="text-theme-text-muted hover:text-theme-text-primary transition-colors text-3xl leading-none"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-4">
                {/* Vehicle Name */}
                <div className="bg-theme-bg-tertiary/50 rounded-lg p-4">
                  <p className="text-sm text-theme-text-muted mb-1">Veicolo</p>
                  <p className="text-lg font-semibold text-theme-text-primary">
                    {selectedUnavailability.display_name}
                    {selectedUnavailability.plate && (
                      <span className="text-theme-text-muted font-normal text-sm ml-2">
                        ({selectedUnavailability.plate})
                      </span>
                    )}
                  </p>
                </div>

                {/* Reason */}
                <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
                  <p className="text-sm text-orange-400 mb-1">Motivo</p>
                  <p className="text-lg font-medium text-orange-300">
                    {selectedUnavailability.metadata?.unavailable_reason || 'Non disponibile'}
                  </p>
                </div>

                {/* Date Range */}
                {selectedUnavailability.metadata?.unavailable_from && selectedUnavailability.metadata?.unavailable_until && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-theme-bg-tertiary/50 rounded-lg p-4">
                      <p className="text-sm text-theme-text-muted mb-1">Dal</p>
                      <p className="text-theme-text-primary font-medium">
                        {new Date(selectedUnavailability.metadata.unavailable_from).toLocaleDateString('it-IT', {
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric'
                        })}
                      </p>
                      {selectedUnavailability.metadata?.unavailable_from_time && (
                        <p className="text-sm text-theme-text-muted mt-1">
                          {selectedUnavailability.metadata.unavailable_from_time}
                        </p>
                      )}
                    </div>

                    <div className="bg-theme-bg-tertiary/50 rounded-lg p-4">
                      <p className="text-sm text-theme-text-muted mb-1">Al</p>
                      <p className="text-theme-text-primary font-medium">
                        {new Date(selectedUnavailability.metadata.unavailable_until).toLocaleDateString('it-IT', {
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric'
                        })}
                      </p>
                      {selectedUnavailability.metadata?.unavailable_until_time && (
                        <p className="text-sm text-theme-text-muted mt-1">
                          {selectedUnavailability.metadata.unavailable_until_time}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Duration */}
                {selectedUnavailability.metadata?.unavailable_from && selectedUnavailability.metadata?.unavailable_until && (
                  <div className="bg-theme-bg-tertiary/50 rounded-lg p-4">
                    <p className="text-sm text-theme-text-muted mb-1">Durata</p>
                    <p className="text-theme-text-primary font-medium">
                      {(() => {
                        const from = new Date(selectedUnavailability.metadata.unavailable_from)
                        const until = new Date(selectedUnavailability.metadata.unavailable_until)
                        const days = Math.ceil((until.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1
                        return `${days} ${days === 1 ? 'giorno' : 'giorni'}`
                      })()}
                    </p>
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-theme-border">
                <button
                  onClick={() => setSelectedUnavailability(null)}
                  className="w-full bg-gray-700 hover:bg-gray-600 text-theme-text-primary px-4 py-3 rounded-lg transition-colors font-medium"
                >
                  Chiudi
                </button>
              </div>
            </div>
          </div>
        )
      }
    </div>
  )
}
