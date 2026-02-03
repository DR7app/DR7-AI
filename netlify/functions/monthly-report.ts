import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

// Count calendar days a booking overlaps with a given month
function countOverlapDays(
  start: Date,
  end: Date,
  monthStart: Date,
  monthEnd: Date
): number {
  const overlapStart = start > monthStart ? start : monthStart
  const overlapEnd = end < monthEnd ? end : monthEnd
  if (overlapStart > overlapEnd) return 0
  const diffMs = overlapEnd.getTime() - overlapStart.getTime()
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1
}

// Build a set of day numbers (1..N) from a date range overlapping the month
function getDaySet(
  start: Date,
  end: Date,
  monthStart: Date,
  monthEnd: Date,
  daysInMonth: number
): Set<number> {
  const days = new Set<number>()
  const overlapStart = start > monthStart ? start : monthStart
  const overlapEnd = end < monthEnd ? end : monthEnd
  if (overlapStart > overlapEnd) return days
  const cursor = new Date(overlapStart)
  while (cursor <= overlapEnd) {
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
  const reportType = params.type // 'vehicles' or 'washes'
  const month = params.month // YYYY-MM format

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
  const monthStart = new Date(year, monthNum - 1, 1)
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

  // Fetch all rental bookings that overlap with this month
  // Rental bookings: service_type is null or not 'car_wash'/'mechanical_service'
  const { data: rentalBookings, error: bookingsError } = await supabase
    .from('bookings')
    .select('id, vehicle_id, vehicle_name, vehicle_plate, pickup_date, dropoff_date, price_total, status, service_type')
    .or(`service_type.is.null,and(service_type.neq.car_wash,service_type.neq.mechanical_service)`)
    .lte('pickup_date', monthEndISO + 'T23:59:59')
    .gte('dropoff_date', monthStartISO + 'T00:00:00')
    .in('status', ['confirmed', 'confermata', 'completed', 'in_corso'])

  if (bookingsError) throw bookingsError

  // Build vehicle report
  const vehicleReports = (vehicles || []).map(vehicle => {
    // Find bookings for this vehicle (match by vehicle_id or plate)
    const vehicleBookings = (rentalBookings || []).filter(b =>
      b.vehicle_id === vehicle.id ||
      (vehicle.plate && b.vehicle_plate && b.vehicle_plate.replace(/\s/g, '').toUpperCase() === vehicle.plate.replace(/\s/g, '').toUpperCase())
    )

    // Calculate rented days (union of all booking day ranges)
    const rentedDays = new Set<number>()
    let rentalRevenue = 0

    vehicleBookings.forEach(booking => {
      const start = new Date(booking.pickup_date)
      const end = new Date(booking.dropoff_date)
      const days = getDaySet(start, end, monthStart, monthEnd, daysInMonth)
      days.forEach(d => rentedDays.add(d))
      // Revenue: proportional to overlap days
      const totalBookingDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
      const overlapDays = days.size
      const bookingRevenue = (booking.price_total || 0) / 100 // Convert from cents
      rentalRevenue += (bookingRevenue / totalBookingDays) * overlapDays
    })

    // Calculate maintenance days from vehicle metadata (unavailability)
    const maintenanceDays = new Set<number>()
    const meta = vehicle.metadata || {}
    if (meta.unavailable_from && meta.unavailable_until) {
      const unavailStart = new Date(meta.unavailable_from)
      const unavailEnd = new Date(meta.unavailable_until)
      const days = getDaySet(unavailStart, unavailEnd, monthStart, monthEnd, daysInMonth)
      days.forEach(d => maintenanceDays.add(d))
    }

    // Also check if vehicle status is 'maintenance' (current snapshot)
    if (vehicle.status === 'maintenance') {
      // Mark remaining days of month as maintenance
      const today = new Date()
      if (today >= monthStart && today <= monthEnd) {
        for (let d = today.getDate(); d <= daysInMonth; d++) {
          maintenanceDays.add(d)
        }
      }
    }

    // Apply priority: MAINTENANCE > RENTAL > IDLE
    // Remove rental days that overlap with maintenance
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
      rentalRevenue: Math.round(rentalRevenue * 100) / 100
    }
  })

  // Sort by utilization rate descending
  vehicleReports.sort((a, b) => b.utilizationRate - a.utilizationRate)

  return {
    statusCode: 200,
    body: JSON.stringify({
      month,
      daysInMonth,
      vehicleCount: vehicleReports.length,
      totalRentalRevenue: Math.round(vehicleReports.reduce((sum, v) => sum + v.rentalRevenue, 0) * 100) / 100,
      avgUtilizationRate: Math.round((vehicleReports.reduce((sum, v) => sum + v.utilizationRate, 0) / Math.max(1, vehicleReports.length)) * 100) / 100,
      vehicles: vehicleReports
    })
  }
}

async function generateWashReport(
  monthStartISO: string,
  monthEndISO: string,
  month: string,
  daysInMonth: number
) {
  // Fetch all car wash bookings for the month
  const { data: washBookings, error: washError } = await supabase
    .from('bookings')
    .select('id, service_name, price_total, status, payment_status, booking_details, vehicle_name, appointment_date')
    .eq('service_type', 'car_wash')
    .gte('appointment_date', monthStartISO + 'T00:00:00')
    .lte('appointment_date', monthEndISO + 'T23:59:59')
    .in('status', ['confirmed', 'confermata', 'completed', 'in_corso'])

  if (washError) throw washError

  // Filter: ONLY billable client washes
  const billableWashes = (washBookings || []).filter(booking => {
    const details = booking.booking_details || {}

    // Exclude if internal flag is set
    if (details.internal === true) return false

    // Exclude if created by automatic system
    if (details.createdBy === 'automatic_system') return false

    // Exclude if price is 0
    if (!booking.price_total || booking.price_total === 0) return false

    // Exclude if vehicle_name starts with 'INTERNO'
    if (booking.vehicle_name && booking.vehicle_name.toUpperCase().startsWith('INTERNO')) return false

    // Exclude if source/notes contain internal keywords
    const source = (details.source || '').toLowerCase()
    const notes = (details.notes || '').toLowerCase()
    const combined = source + ' ' + notes
    const excludeKeywords = ['reintegration', 'reint', 'internal', 'reconditioning', 'automatico', 'auto-wash']
    if (excludeKeywords.some(kw => combined.includes(kw))) return false

    return true
  })

  // Aggregate by service/wash type
  const byType: Record<string, { count: number; revenue: number }> = {}

  billableWashes.forEach(wash => {
    // Use service_name or extract from cart items
    let serviceName = wash.service_name || 'Altro'
    const details = wash.booking_details || {}

    // If cart items exist, aggregate each item
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
