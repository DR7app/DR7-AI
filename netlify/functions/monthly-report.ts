import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

// Build a set of day numbers (1..N) from a date range overlapping the month
function getDaySet(
  start: Date,
  end: Date,
  monthStart: Date,
  monthEnd: Date
): Set<number> {
  const days = new Set<number>()
  const overlapStart = start > monthStart ? start : monthStart
  const overlapEnd = end < monthEnd ? end : monthEnd
  if (overlapStart > overlapEnd) return days
  const cursor = new Date(overlapStart)
  cursor.setHours(0, 0, 0, 0)
  const endDay = new Date(overlapEnd)
  endDay.setHours(0, 0, 0, 0)
  while (cursor <= endDay) {
    days.add(cursor.getDate())
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  const params = event.queryStringParameters || {}
  const reportType = params.type
  const month = params.month

  if (!reportType || !month) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required params: type and month (YYYY-MM)' })
    }
  }

  const [yearStr, monthStr] = month.split('-')
  const year = parseInt(yearStr)
  const monthNum = parseInt(monthStr)

  if (!year || !monthNum || monthNum < 1 || monthNum > 12) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid month format. Use YYYY-MM' })
    }
  }

  const daysInMonth = getDaysInMonth(year, monthNum)
  const monthStart = new Date(year, monthNum - 1, 1, 0, 0, 0)
  const monthEnd = new Date(year, monthNum - 1, daysInMonth, 23, 59, 59)
  const monthStartISO = `${year}-${String(monthNum).padStart(2, '0')}-01`
  const monthEndISO = `${year}-${String(monthNum).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`

  try {
    if (reportType === 'vehicles') {
      return await generateVehicleReport(year, monthNum, daysInMonth, monthStart, monthEnd, monthStartISO, monthEndISO, month)
    } else if (reportType === 'washes') {
      return await generateWashReport(monthStartISO, monthEndISO, month, daysInMonth)
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid report type. Use "vehicles" or "washes"' })
      }
    }
  } catch (error: any) {
    console.error('Monthly report error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    }
  }
}

async function generateVehicleReport(
  year: number,
  monthNum: number,
  daysInMonth: number,
  monthStart: Date,
  monthEnd: Date,
  monthStartISO: string,
  monthEndISO: string,
  month: string
) {
  // Fetch all vehicles (excluding retired)
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, display_name, plate, status, daily_rate, category, metadata')
    .neq('status', 'retired')
    .order('display_name')

  if (vehiclesError) throw vehiclesError

  // Fetch bookings that overlap with this month
  // Only confirmed/active/completed rentals (not pending, not cancelled)
  const { data: allBookings, error: bookingsError } = await supabase
    .from('bookings')
    .select('id, vehicle_id, vehicle_name, vehicle_plate, pickup_date, dropoff_date, price_total, status, service_type, booking_details')
    .lte('pickup_date', monthEndISO + 'T23:59:59')
    .gte('dropoff_date', monthStartISO + 'T00:00:00')
    .in('status', ['confirmed', 'confermata', 'completed', 'in_corso', 'active'])

  if (bookingsError) throw bookingsError

  // Filter to ONLY rental bookings — strictly exclude car_wash and mechanical_service
  const rentalBookings = (allBookings || []).filter(b => {
    const st = (b.service_type || '').trim().toLowerCase()
    // Only include if service_type is empty/null (rental) or explicitly not a service booking
    if (st === 'car_wash' || st === 'mechanical_service' || st === 'mechanical') return false
    // Also exclude if it looks like a car wash booking (pickup_location contains Car Wash)
    const details = b.booking_details || {}
    if (details.internal === true) return false
    if (details.createdBy === 'automatic_system') return false
    return true
  })

  // Build vehicle report
  const vehicleReports = (vehicles || []).map(vehicle => {
    const vPlate = (vehicle.plate || '').replace(/\s/g, '').toUpperCase()

    // Find bookings for this vehicle — strict matching only (ID and plate, no fuzzy name)
    const vehicleBookings = rentalBookings.filter(b => {
      // Match by vehicle_id (primary, most reliable)
      if (b.vehicle_id && b.vehicle_id === vehicle.id) return true
      // Match by booking_details.vehicle_id
      if (b.booking_details?.vehicle_id && b.booking_details.vehicle_id === vehicle.id) return true
      // Match by exact plate (reliable)
      if (vPlate && vPlate.length >= 4 && b.vehicle_plate) {
        const bPlate = b.vehicle_plate.replace(/\s/g, '').toUpperCase()
        if (bPlate === vPlate) return true
      }
      return false
    })

    // Calculate rented days (union of all booking day ranges)
    const rentedDays = new Set<number>()
    let rentalRevenue = 0

    vehicleBookings.forEach(booking => {
      const start = new Date(booking.pickup_date)
      const end = new Date(booking.dropoff_date)
      const days = getDaySet(start, end, monthStart, monthEnd)
      days.forEach(d => rentedDays.add(d))
      // Revenue: proportional to overlap days
      const bookingStart = new Date(booking.pickup_date)
      const bookingEnd = new Date(booking.dropoff_date)
      bookingStart.setHours(0, 0, 0, 0)
      bookingEnd.setHours(0, 0, 0, 0)
      const totalBookingDays = Math.max(1, Math.round((bookingEnd.getTime() - bookingStart.getTime()) / (1000 * 60 * 60 * 24)) + 1)
      const overlapDays = days.size
      const bookingRevenue = (booking.price_total || 0) / 100
      rentalRevenue += (bookingRevenue / totalBookingDays) * overlapDays
    })

    // Calculate maintenance days from vehicle metadata (unavailability)
    const maintenanceDays = new Set<number>()
    const meta = vehicle.metadata || {}
    if (meta.unavailable_from && meta.unavailable_until) {
      const unavailStart = new Date(meta.unavailable_from)
      const unavailEnd = new Date(meta.unavailable_until)
      const days = getDaySet(unavailStart, unavailEnd, monthStart, monthEnd)
      days.forEach(d => maintenanceDays.add(d))
    }

    // Apply priority: MAINTENANCE > RENTAL > IDLE
    const finalMaintenanceDays = new Set(maintenanceDays)
    const finalRentedDays = new Set<number>()
    rentedDays.forEach(d => {
      if (!finalMaintenanceDays.has(d)) {
        finalRentedDays.add(d)
      }
    })

    const rentedCount = finalRentedDays.size
    const maintenanceCount = finalMaintenanceDays.size
    const idleCount = daysInMonth - rentedCount - maintenanceCount

    return {
      vehicleId: vehicle.id,
      label: vehicle.display_name,
      plate: vehicle.plate || '-',
      category: vehicle.category || '-',
      rentedDays: rentedCount,
      maintenanceDays: maintenanceCount,
      idleDays: Math.max(0, idleCount),
      utilizationRate: Math.round((rentedCount / daysInMonth) * 100) / 100,
      downtimeRate: Math.round((maintenanceCount / daysInMonth) * 100) / 100,
      idleRate: Math.round((Math.max(0, idleCount) / daysInMonth) * 100) / 100,
      bookingsCount: vehicleBookings.length,
      rentalRevenue: Math.round(rentalRevenue * 100) / 100,
      // Debug: show which bookings matched
      _bookingIds: vehicleBookings.map(b => b.id)
    }
  })

  // Sort by utilization rate descending
  vehicleReports.sort((a, b) => b.utilizationRate - a.utilizationRate)

  // Find unmatched bookings
  const allMatchedIds = new Set<string>()
  vehicleReports.forEach(vr => {
    (vr as any)._bookingIds?.forEach((id: string) => allMatchedIds.add(id))
  })
  const unmatchedBookings = rentalBookings
    .filter(b => !allMatchedIds.has(b.id))
    .map(b => ({
      id: b.id,
      vehicle_name: b.vehicle_name,
      vehicle_plate: b.vehicle_plate,
      vehicle_id: b.vehicle_id,
      pickup_date: b.pickup_date,
      dropoff_date: b.dropoff_date,
      service_type: b.service_type,
      status: b.status
    }))

  // Clean up debug fields from output
  const cleanReports = vehicleReports.map(({ _bookingIds, ...rest }: any) => rest)

  return {
    statusCode: 200,
    body: JSON.stringify({
      month,
      daysInMonth,
      vehicleCount: cleanReports.length,
      totalBookingsFound: rentalBookings.length,
      unmatchedBookings: unmatchedBookings.length > 0 ? unmatchedBookings : undefined,
      totalRentalRevenue: Math.round(cleanReports.reduce((sum: number, v: any) => sum + v.rentalRevenue, 0) * 100) / 100,
      avgUtilizationRate: Math.round((cleanReports.reduce((sum: number, v: any) => sum + v.utilizationRate, 0) / Math.max(1, cleanReports.length)) * 100) / 100,
      vehicles: cleanReports
    })
  }
}

async function generateWashReport(
  monthStartISO: string,
  monthEndISO: string,
  month: string,
  daysInMonth: number
) {
  const { data: washBookings, error: washError } = await supabase
    .from('bookings')
    .select('id, service_name, price_total, status, payment_status, booking_details, vehicle_name, appointment_date')
    .eq('service_type', 'car_wash')
    .gte('appointment_date', monthStartISO + 'T00:00:00')
    .lte('appointment_date', monthEndISO + 'T23:59:59')
    .in('status', ['confirmed', 'confermata', 'completed', 'in_corso'])

  if (washError) throw washError

  const billableWashes = (washBookings || []).filter(booking => {
    const details = booking.booking_details || {}
    if (details.internal === true) return false
    if (details.createdBy === 'automatic_system') return false
    if (!booking.price_total || booking.price_total === 0) return false
    if (booking.vehicle_name && booking.vehicle_name.toUpperCase().startsWith('INTERNO')) return false
    const source = (details.source || '').toLowerCase()
    const notes = (details.notes || '').toLowerCase()
    const combined = source + ' ' + notes
    const excludeKeywords = ['reintegration', 'reint', 'internal', 'reconditioning', 'automatico', 'auto-wash']
    if (excludeKeywords.some(kw => combined.includes(kw))) return false
    return true
  })

  const byType: Record<string, { count: number; revenue: number }> = {}

  billableWashes.forEach(wash => {
    let serviceName = wash.service_name || 'Altro'
    const details = wash.booking_details || {}
    if (details.cartItems && Array.isArray(details.cartItems) && details.cartItems.length > 0) {
      details.cartItems.forEach((item: any) => {
        const name = item.serviceName || serviceName
        if (!byType[name]) byType[name] = { count: 0, revenue: 0 }
        byType[name].count += (item.quantity || 1)
        byType[name].revenue += ((item.price || 0) * (item.quantity || 1))
      })
    } else {
      if (!byType[serviceName]) byType[serviceName] = { count: 0, revenue: 0 }
      byType[serviceName].count += 1
      byType[serviceName].revenue += (wash.price_total || 0) / 100
    }
  })

  const totalRevenue = Object.values(byType).reduce((sum, t) => sum + t.revenue, 0)
  const totalCount = Object.values(byType).reduce((sum, t) => sum + t.count, 0)

  return {
    statusCode: 200,
    body: JSON.stringify({
      month,
      daysInMonth,
      billableWashesCount: totalCount,
      washRevenue: Math.round(totalRevenue * 100) / 100,
      avgWashesPerDay: Math.round((totalCount / daysInMonth) * 100) / 100,
      byType: Object.entries(byType)
        .map(([type, data]) => ({
          type,
          count: data.count,
          revenue: Math.round(data.revenue * 100) / 100
        }))
        .sort((a, b) => b.count - a.count)
    })
  }
}
