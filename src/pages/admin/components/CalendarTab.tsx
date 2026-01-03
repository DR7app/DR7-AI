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
  vehicle_name: string
  vehicle_plate?: string
  pickup_date: string
  dropoff_date: string
  status: string
  customer_name: string
  customer_email: string
  price_total: number
  booking_details?: any
}

type CellStatus = 'available' | 'rented' | 'unavailable'

interface CellBookingInfo {
  booking: Booking | null
  isStart: boolean
  isMiddle: boolean
  isEnd: boolean
}

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

      if (vehiclesError) throw vehiclesError

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
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('id, vehicle_name, vehicle_plate, pickup_date, dropoff_date, status, customer_name, customer_email, price_total, service_type, booking_details')
        .not('pickup_date', 'is', null) // Fetch all bookings with a pickup date (Rentals)
        .neq('status', 'cancelled')
        .order('pickup_date', { ascending: true })

      if (bookingsError) throw bookingsError

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
      // PRIORITY 1: Match by plate if both have plates
      if (booking.vehicle_plate && vehicle.plate) {
        if (vehicle.plate === booking.vehicle_plate) {
          const pickupDate = new Date(booking.pickup_date)
          const dropoffDate = new Date(booking.dropoff_date)
          pickupDate.setHours(0, 0, 0, 0)
          dropoffDate.setHours(0, 0, 0, 0)
          return checkDate >= pickupDate && checkDate < dropoffDate
        }
        return false
      }

      // PRIORITY 2: Match by name (fallback for legacy bookings)
      const bookingVehicle = booking.vehicle_name?.trim().toLowerCase()
      const vehicleDisplay = vehicle.display_name?.trim().toLowerCase()
      const exactMatch = bookingVehicle === vehicleDisplay

      if (!exactMatch) return false

      const pickupDate = new Date(booking.pickup_date)
      const dropoffDate = new Date(booking.dropoff_date)
      pickupDate.setHours(0, 0, 0, 0)
      dropoffDate.setHours(0, 0, 0, 0)

      return checkDate >= pickupDate && checkDate < dropoffDate
    })

    return vehicleBookings.length > 0 ? 'rented' : 'available'
  }

  // Get booking info for a cell including span position
  const getCellBookingInfo = (vehicle: Vehicle, day: number): CellBookingInfo => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const checkDate = new Date(year, month, day)
    checkDate.setHours(0, 0, 0, 0)

    const booking = bookings.find(b => {
      // Match by plate or name
      const matchesByPlate = b.vehicle_plate && vehicle.plate && vehicle.plate === b.vehicle_plate
      const matchesByName = b.vehicle_name?.trim().toLowerCase() === vehicle.display_name?.trim().toLowerCase()

      if (!matchesByPlate && !matchesByName) return false

      const pickupDate = new Date(b.pickup_date)
      const dropoffDate = new Date(b.dropoff_date)
      pickupDate.setHours(0, 0, 0, 0)
      dropoffDate.setHours(0, 0, 0, 0)

      return checkDate >= pickupDate && checkDate < dropoffDate
    })

    if (!booking) {
      return { booking: null, isStart: false, isMiddle: false, isEnd: false }
    }

    const pickupDate = new Date(booking.pickup_date)
    const dropoffDate = new Date(booking.dropoff_date)
    pickupDate.setHours(0, 0, 0, 0)
    dropoffDate.setHours(0, 0, 0, 0)

    const prevDay = new Date(year, month, day - 1)
    const nextDay = new Date(year, month, day + 1)
    prevDay.setHours(0, 0, 0, 0)
    nextDay.setHours(0, 0, 0, 0)

    const isStart = checkDate.getTime() === pickupDate.getTime()
    const isEnd = nextDay.getTime() === dropoffDate.getTime()
    const isMiddle = !isStart && !isEnd

    return { booking, isStart, isMiddle, isEnd }
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

  // Get today's date for highlighting
  const today = new Date()
  const isCurrentMonth = today.getMonth() === currentDate.getMonth() &&
    today.getFullYear() === currentDate.getFullYear()
  const todayDay = isCurrentMonth ? today.getDate() : null

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
        <p className="text-white">Caricamento calendario...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div className="bg-gradient-to-br from-gray-900/95 to-black/95 backdrop-blur-xl rounded-2xl border border-white/10 p-4 lg:p-6 shadow-2xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-wrap">
            <h2 className="text-xl font-light text-white">Calendario Flotta</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Questo Mese:</span>
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
                <span className="text-xs text-gray-400">Fatturato:</span>
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
                <span className="text-gray-300 font-light">Disponibile</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg shadow-orange-500/50"></div>
                <span className="text-gray-300 font-light">Non Disponibile</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-gradient-to-br from-red-500 to-red-600 shadow-lg shadow-red-500/50"></div>
                <span className="text-gray-300 font-light">Noleggiato</span>
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
          <h3 className="text-2xl font-light text-white mb-3 capitalize">{monthName}</h3>
          <input
            type="text"
            placeholder="Cerca cliente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-4 py-2 bg-white/5 border border-white/10 rounded-full text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 focus:border-dr7-gold/30 w-64 backdrop-blur-sm transition-all"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigateMonth('prev')}
            className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm transition-all duration-200 hover:shadow-lg hover:shadow-white/20"
            aria-label="Mese precedente"
          >
            Prec
          </button>
          <button
            onClick={() => navigateMonth('next')}
            className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm transition-all duration-200 hover:shadow-lg hover:shadow-white/20"
            aria-label="Mese successivo"
          >
            Succ
          </button>
        </div>
      </div>

      {/* Search Results - Show matching bookings */}
      {searchQuery && (
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
          <h3 className="text-lg font-bold text-white mb-3">
            Risultati ricerca: "{searchQuery}"
          </h3>
          {(() => {
            const matchingBookings = bookings.filter(booking => {
              const customerName = booking.customer_name || booking.booking_details?.customer?.fullName || ''
              return customerName && customerName.toLowerCase().includes(searchQuery.toLowerCase())
            })

            if (matchingBookings.length === 0) {
              return (
                <p className="text-gray-400 text-sm">Nessuna prenotazione trovata con questo nome cliente.</p>
              )
            }

            return (
              <div className="space-y-2">
                {matchingBookings.map(booking => (
                  <div
                    key={booking.id}
                    className="bg-gray-800 p-3 rounded border border-gray-700 hover:border-dr7-gold transition-colors"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-white font-semibold">
                          {booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A'}
                        </p>
                        <p className="text-gray-400 text-sm">
                          {booking.customer_email || booking.booking_details?.customer?.email || 'N/A'}
                        </p>
                        <p className="text-dr7-gold text-sm mt-1">
                          🚗 {booking.vehicle_name}
                          {booking.vehicle_plate && <span className="text-gray-400"> ({booking.vehicle_plate})</span>}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-gray-300 text-sm">
                          {booking.pickup_date ? `${new Date(booking.pickup_date).toLocaleDateString('it-IT')} → ${new Date(booking.dropoff_date).toLocaleDateString('it-IT')}` : 'Date non valide'}
                        </p>
                        <span className={`inline-block px-2 py-1 rounded text-xs mt-1 ${booking.status === 'confirmed' ? 'bg-green-900 text-green-200' :
                          booking.status === 'pending' ? 'bg-yellow-900 text-yellow-200' :
                            'bg-gray-700 text-gray-300'
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
        <div className="bg-gray-900 rounded-lg p-4 lg:p-6 overflow-x-auto">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span className="text-sm text-gray-400">Tutti i Veicoli ({vehicles.length})</span>
          </h3>

          <div className="min-w-max">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-900 border border-gray-700/40 px-2 py-1 text-left text-white font-bold text-xs min-w-[140px]">
                    Veicolo
                  </th>
                  <th className="sticky left-[140px] z-10 bg-gray-900 border border-gray-700/40 px-2 py-1 text-left text-white font-bold text-xs min-w-[90px]">
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
                        className={`border border-gray-700/40 px-1 py-1 text-center text-[10px] font-semibold min-w-[50px] relative group cursor-help ${day === todayDay ? 'bg-dr7-gold/20 text-dr7-gold' :
                          holiday || isSundayDay ? 'bg-red-900/20 border-red-500/30 text-red-400' :
                            'text-gray-400'
                          }`}
                      >
                        <div className="flex flex-col items-center justify-between h-full py-0.5">
                          <span className="text-[10px] leading-none mb-1">{day}</span>
                          {holiday ? (
                            <span className="text-[7px] leading-tight font-medium text-white uppercase tracking-tight absolute bottom-0.5 left-0 right-0 overflow-visible whitespace-nowrap z-10 px-0.5" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                              {holiday.label}
                            </span>
                          ) : isSundayDay && (
                            <div className="w-1.5 h-1.5 rounded-full bg-white mb-0.5 shadow-sm"></div>
                          )}
                        </div>

                        {(holiday || isSundayDay) && (
                          <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-900 text-white text-[10px] rounded shadow-lg border border-gray-700 whitespace-nowrap z-50 pointer-events-none">
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
                {vehicles.filter(vehicle => {
                  if (!searchQuery) return true
                  const query = searchQuery.toLowerCase()
                  return bookings.some(booking => {
                    const customerName = booking.customer_name || booking.booking_details?.customer?.fullName
                    if (!customerName) return false

                    const bookingVehicle = booking.vehicle_name?.trim().toLowerCase()
                    const vehicleDisplay = vehicle.display_name?.trim().toLowerCase()
                    if (vehicle.plate && booking.vehicle_plate && vehicle.plate === booking.vehicle_plate) {
                      return customerName.toLowerCase().includes(query)
                    }

                    const vehicleMatches = bookingVehicle === vehicleDisplay ||
                      (bookingVehicle && vehicleDisplay && (
                        bookingVehicle.includes(vehicleDisplay) ||
                        vehicleDisplay.includes(bookingVehicle)
                      ))
                    return vehicleMatches && customerName.toLowerCase().includes(query)
                  })
                }).map((vehicle) => (
                  <tr key={vehicle.id}>
                    <td className="sticky left-0 z-10 bg-gray-900 border border-gray-700/40 px-2 py-1 text-white font-semibold text-sm">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate">{vehicle.display_name}</span>
                          {vehicle.category && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap ${vehicle.category === 'exotic'
                              ? 'bg-purple-900 text-purple-200'
                              : vehicle.category === 'urban'
                                ? 'bg-cyan-900 text-cyan-200'
                                : 'bg-orange-900 text-orange-200'
                              }`}>
                              {vehicle.category}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="sticky left-[140px] z-10 bg-gray-900 border border-gray-700/40 px-2 py-1 text-gray-300 text-sm font-mono">
                      {vehicle.plate || '-'}
                    </td>
                    {daysInMonth.map(day => {
                      const status = getCellStatus(vehicle, day)
                      const cellInfo = getCellBookingInfo(vehicle, day)

                      // Determine border radius based on position
                      const getBorderRadius = () => {
                        if (!cellInfo.booking) return ''
                        if (cellInfo.isStart && cellInfo.isEnd) return 'rounded-lg'
                        if (cellInfo.isStart) return 'rounded-l-lg'
                        if (cellInfo.isEnd) return 'rounded-r-lg'
                        return ''
                      }

                      return (
                        <td
                          key={day}
                          onClick={() => {
                            if (cellInfo.booking) {
                              setSelectedCell({
                                vehicle: vehicle.display_name,
                                date: `${day}/${currentDate.getMonth() + 1}/${currentDate.getFullYear()}`,
                                bookings: [cellInfo.booking]
                              })
                            } else if (status === 'unavailable') {
                              setSelectedUnavailability(vehicle)
                            }
                          }}
                          className={`relative border border-gray-700/40 min-w-[50px] h-10 transition-all cursor-pointer ${getBorderRadius()} ${status === 'rented'
                              ? 'bg-green-500/90 hover:bg-green-500 shadow-sm'
                              : status === 'unavailable'
                                ? 'bg-orange-500/70 hover:bg-orange-500/80'
                                : 'bg-green-500/5 hover:bg-green-500/10'
                            } ${day === todayDay ? 'ring-2 ring-inset ring-dr7-gold' : ''}`}
                        >
                          {/* Show customer name + dates on start cell */}
                          {cellInfo.isStart && cellInfo.booking && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center px-2 py-1">
                              <span className="text-white text-xs font-bold truncate w-full text-center leading-tight">
                                {cellInfo.booking.customer_name?.split(' ')[0] || 'N/A'}
                              </span>
                              <span className="text-white/70 text-[9px] truncate w-full text-center leading-tight mt-0.5">
                                {new Date(cellInfo.booking.pickup_date).getDate()} → {new Date(cellInfo.booking.dropoff_date).getDate()}
                              </span>
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {
        vehicles.length === 0 && (
          <div className="bg-gray-900 rounded-lg p-8 text-center">
            <p className="text-gray-400">Nessun veicolo trovato</p>
          </div>
        )
      }

      {/* Booking Details Modal */}
      {
        selectedCell && (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fadeIn"
            onClick={() => setSelectedCell(null)}
          >
            <div
              className="bg-gradient-to-br from-gray-900/95 to-black/95 backdrop-blur-xl rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-white/10 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-white/10">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-2xl font-light text-white mb-2">
                      {selectedCell.vehicle}
                    </h3>
                    <p className="text-gray-400 text-sm">{selectedCell.date}</p>
                  </div>
                  <button
                    onClick={() => setSelectedCell(null)}
                    className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center transition-all duration-200 hover:rotate-90 text-white text-xl"
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
                          <div className="text-white font-medium text-lg mb-1">
                            {booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A'}
                          </div>
                          <div className="text-gray-300 text-sm">
                            {booking.customer_email || booking.booking_details?.customer?.email || 'N/A'}
                          </div>
                        </div>
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-red-400 border border-red-500/30">
                          {booking.status}
                        </span>
                      </div>

                      {/* Vehicle selection dropdown */}
                      {hasAlternatives && (
                        <div className="mb-4 p-3 bg-gray-900/50 rounded-lg border border-gray-700">
                          <label className="block text-sm font-medium text-gray-300 mb-2">
                            Veicolo Assegnato (Targa)
                          </label>
                          <select
                            value={booking.vehicle_name}
                            onChange={(e) => changeBookingVehicle(booking.id, e.target.value)}
                            disabled={changingVehicle === booking.id}
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white text-sm focus:outline-none focus:border-dr7-gold disabled:opacity-50"
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
                          <span className="text-gray-400">Ritiro:</span>
                          <span className="text-white font-medium">
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
                          <span className="text-gray-400">Riconsegna:</span>
                          <span className="text-white font-medium">
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
                        <div className="flex justify-between pt-2 border-t border-gray-700">
                          <span className="text-gray-400">Prezzo Totale:</span>
                          <span className="text-dr7-gold font-bold text-lg">
                            {userEmail === 'dubai.rent7.0srl@gmail.com' ? '***' : `€${(booking.price_total / 100).toFixed(2)}`}
                          </span>
                        </div>
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
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
            onClick={() => setSelectedUnavailability(null)}
          >
            <div
              className="bg-gray-900 rounded-xl max-w-lg w-full border border-gray-700 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-gray-800">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-2xl font-bold text-white mb-2">
                      Dettagli Indisponibilità
                    </h3>
                  </div>
                  <button
                    onClick={() => setSelectedUnavailability(null)}
                    className="text-gray-400 hover:text-white transition-colors text-3xl leading-none"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-4">
                {/* Vehicle Name */}
                <div className="bg-gray-800/50 rounded-lg p-4">
                  <p className="text-sm text-gray-400 mb-1">Veicolo</p>
                  <p className="text-lg font-semibold text-white">
                    {selectedUnavailability.display_name}
                    {selectedUnavailability.plate && (
                      <span className="text-gray-400 font-normal text-sm ml-2">
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
                    <div className="bg-gray-800/50 rounded-lg p-4">
                      <p className="text-sm text-gray-400 mb-1">Dal</p>
                      <p className="text-white font-medium">
                        {new Date(selectedUnavailability.metadata.unavailable_from).toLocaleDateString('it-IT', {
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric'
                        })}
                      </p>
                      {selectedUnavailability.metadata?.unavailable_from_time && (
                        <p className="text-sm text-gray-400 mt-1">
                          {selectedUnavailability.metadata.unavailable_from_time}
                        </p>
                      )}
                    </div>

                    <div className="bg-gray-800/50 rounded-lg p-4">
                      <p className="text-sm text-gray-400 mb-1">Al</p>
                      <p className="text-white font-medium">
                        {new Date(selectedUnavailability.metadata.unavailable_until).toLocaleDateString('it-IT', {
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric'
                        })}
                      </p>
                      {selectedUnavailability.metadata?.unavailable_until_time && (
                        <p className="text-sm text-gray-400 mt-1">
                          {selectedUnavailability.metadata.unavailable_until_time}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Duration */}
                {selectedUnavailability.metadata?.unavailable_from && selectedUnavailability.metadata?.unavailable_until && (
                  <div className="bg-gray-800/50 rounded-lg p-4">
                    <p className="text-sm text-gray-400 mb-1">Durata</p>
                    <p className="text-white font-medium">
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

              <div className="p-6 border-t border-gray-800">
                <button
                  onClick={() => setSelectedUnavailability(null)}
                  className="w-full bg-gray-700 hover:bg-gray-600 text-white px-4 py-3 rounded-lg transition-colors font-medium"
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
