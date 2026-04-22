/**
 * Shared helper to compute a single vehicle's monthly revenue.
 *
 * Mirrors the logic of netlify/functions/monthly-report.ts so the Centralina
 * "Obiettivo Mensile per Veicolo" coefficient activates against the *same*
 * number shown in the Report. Any drift here breaks the admin's mental model.
 *
 * Keep-in-sync checklist: booking status filter, service_type exclusion,
 * internal/automatic exclusion, matching by plate/id/name, proration over
 * overlap days, penali/danni from booking_details + fatture.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface VehicleRef {
  id: string
  plate?: string | null
  display_name?: string | null
}

export interface VehicleMonthlyRevenue {
  rentalRevenue: number
  penaltyRevenue: number
  danniRevenue: number
  totalRevenue: number
  bookingsCount: number
}

/**
 * Business rule: start day inclusive, checkout (end) day exclusive.
 * Same-day bookings count as 1 day. UTC to avoid DST issues.
 */
export function computeBillableDays(startDateStr: string, endDateStr: string): number {
  const start = startDateStr.substring(0, 10)
  const end = endDateStr.substring(0, 10)
  const [sY, sM, sD] = start.split('-').map(Number)
  const [eY, eM, eD] = end.split('-').map(Number)
  const startMs = Date.UTC(sY, sM - 1, sD)
  const endMs = Date.UTC(eY, eM - 1, eD)
  const diffDays = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24))
  return Math.max(1, diffDays)
}

/**
 * Compute the rental/penalty/danni revenue attributable to `vehicle` in the
 * given calendar month (1-12). Bookings that span multiple months are
 * pro-rated by the number of days overlapping the target month, same as the
 * Report.
 */
export async function computeVehicleMonthlyRevenue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  vehicle: VehicleRef,
  year: number,
  monthNum: number
): Promise<VehicleMonthlyRevenue> {
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate()
  const monthStartISO = `${year}-${String(monthNum).padStart(2, '0')}-01`
  const monthEndISO = `${year}-${String(monthNum).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
  const monthStartDateISO = new Date(Date.UTC(year, monthNum - 1, 1)).toISOString()
  const monthEndDateISO = new Date(Date.UTC(year, monthNum, 0, 23, 59, 59)).toISOString()

  const vPlate = (vehicle.plate || '').replace(/\s/g, '').toUpperCase()
  const vName = (vehicle.display_name || '').trim().toLowerCase()

  // Fetch bookings matching this vehicle with a permissive OR — we then JS-filter
  // the same way the Report does. Scoped to rental statuses (exclude admin test).
  const orClauses: string[] = [`vehicle_id.eq.${vehicle.id}`]
  if (vPlate && vPlate.length >= 4) orClauses.push(`vehicle_plate.eq.${vPlate}`)
  if (vehicle.display_name) orClauses.push(`vehicle_name.eq.${vehicle.display_name}`)

  const { data: allBookings } = await supabase
    .from('bookings')
    .select('id, vehicle_id, vehicle_name, vehicle_plate, pickup_date, dropoff_date, price_total, status, service_type, booking_details, customer_name, customer_email')
    .in('status', ['confirmed', 'confermata', 'completed', 'completata', 'in_corso', 'active', 'pending', 'Confirmed', 'Completed', 'Active'])
    .or(orClauses.join(','))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rentalBookings = ((allBookings || []) as any[]).filter(b => {
    // Exclude admin/test bookings
    const bookingEmail = (b.booking_details?.customer?.email || '').toLowerCase()
    if (bookingEmail === 'admin@dr7.app') return false
    const custEmail = (b.customer_email || '').toLowerCase()
    if (custEmail === 'admin@dr7.app') return false

    // Must have pickup + dropoff
    if (!b.pickup_date || !b.dropoff_date) return false

    // Exclude service-type bookings
    const st = (b.service_type || '').trim().toLowerCase()
    if (st === 'car_wash' || st === 'mechanical_service' || st === 'mechanical') return false

    // Exclude internal/automatic bookings
    const details = b.booking_details || {}
    if (details.internal === true) return false
    if (details.createdBy === 'automatic_system') return false

    // Must overlap with month
    const pickupDate = b.pickup_date.substring(0, 10)
    const dropoffDate = b.dropoff_date.substring(0, 10)
    if (pickupDate > monthEndISO || dropoffDate < monthStartISO) return false

    // Match to this vehicle (plate > vehicle_id > name)
    const bPlate = (b.vehicle_plate || '').replace(/\s/g, '').toUpperCase()
    const detailsPlate = (b.booking_details?.vehicle_plate || b.booking_details?.plate || '').replace(/\s/g, '').toUpperCase()

    if (vPlate && vPlate.length >= 4) {
      if (bPlate === vPlate) return true
      if (detailsPlate === vPlate) return true
    }
    if (b.vehicle_id === vehicle.id) return true
    if (b.booking_details?.vehicle_id === vehicle.id) return true
    if (!b.vehicle_id && !bPlate && !detailsPlate && b.vehicle_name) {
      if (vName && b.vehicle_name.trim().toLowerCase() === vName) return true
    }
    return false
  })

  // Fetch penalty/danni fatture for this month, scoped to these bookings
  const bookingIds = rentalBookings.map(b => b.id)
  const fatturePenaltyMap = new Map<string, number>()
  const fattureDanniMap = new Map<string, number>()
  if (bookingIds.length > 0) {
    const { data: fatture } = await supabase
      .from('fatture')
      .select('id, booking_id, importo_totale, items')
      .in('booking_id', bookingIds)
      .gte('data_emissione', monthStartDateISO)
      .lte('data_emissione', monthEndDateISO)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;((fatture || []) as any[]).forEach(f => {
      if (!f.booking_id) return
      const items = f.items || []
      const hasPenalty = items.some((i: { description?: string }) => /penal/i.test(i.description || ''))
      const hasDanni = items.some((i: { description?: string }) => /dann/i.test(i.description || ''))
      const amount = parseFloat(f.importo_totale || 0)
      if (hasPenalty) fatturePenaltyMap.set(f.booking_id, (fatturePenaltyMap.get(f.booking_id) || 0) + amount)
      if (hasDanni) fattureDanniMap.set(f.booking_id, (fattureDanniMap.get(f.booking_id) || 0) + amount)
    })
  }

  // Sum revenue
  let rentalRevenue = 0
  let penaltyRevenue = 0
  let danniRevenue = 0

  rentalBookings.forEach(booking => {
    const pickupDateRaw = booking.pickup_date
    const dropoffDateRaw = booking.dropoff_date
    const pickupDate = pickupDateRaw.substring(0, 10)
    const dropoffDate = dropoffDateRaw.substring(0, 10)
    const pYear = parseInt(pickupDate.substring(0, 4))
    const pMonth = parseInt(pickupDate.substring(5, 7))
    const pDay = parseInt(pickupDate.substring(8, 10))
    const dYear = parseInt(dropoffDate.substring(0, 4))
    const dMonth = parseInt(dropoffDate.substring(5, 7))
    const dDay = parseInt(dropoffDate.substring(8, 10))

    // First occupied day in target month
    let startDay: number
    if (pYear < year || (pYear === year && pMonth < monthNum)) {
      startDay = 1
    } else if (pYear === year && pMonth === monthNum) {
      startDay = pDay
    } else {
      return
    }

    // Last occupied day in target month (checkout day excluded)
    let endDay: number
    if (dYear > year || (dYear === year && dMonth > monthNum)) {
      endDay = daysInMonth
    } else if (dYear === year && dMonth === monthNum) {
      endDay = dDay - 1
      if (endDay < startDay) {
        if (pYear === year && pMonth === monthNum) {
          endDay = startDay
        } else {
          return
        }
      }
    } else {
      return
    }

    const overlapDays = endDay - startDay + 1
    const totalBookingDays = computeBillableDays(pickupDateRaw, dropoffDateRaw)
    const rawPrice = booking.price_total
    const bookingRevenue = (typeof rawPrice === 'string' ? parseFloat(rawPrice) : (rawPrice || 0)) / 100
    rentalRevenue += (bookingRevenue / totalBookingDays) * overlapDays

    // Penali/danni from booking_details (amounts in EUR, paid only)
    const details = booking.booking_details || {}
    let bookingPenaltyFromDetails = 0
    let bookingDanniFromDetails = 0
    if (Array.isArray(details.danni)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      details.danni.forEach((d: any) => {
        const paid = parseFloat(d.amountPaid || d.total || 0)
        if (paid > 0) bookingDanniFromDetails += paid
      })
    }
    if (Array.isArray(details.penalties)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      details.penalties.forEach((p: any) => {
        const paid = parseFloat(p.amountPaid || p.total || 0)
        if (paid > 0) bookingPenaltyFromDetails += paid
      })
    }

    // Penali/danni from fatture — take the higher of the two (avoid double-count)
    const bookingPenaltyFromFatture = fatturePenaltyMap.get(booking.id) || 0
    const bookingDanniFromFatture = fattureDanniMap.get(booking.id) || 0
    penaltyRevenue += Math.max(bookingPenaltyFromDetails, bookingPenaltyFromFatture)
    danniRevenue += Math.max(bookingDanniFromDetails, bookingDanniFromFatture)
  })

  rentalRevenue = Math.round(rentalRevenue * 100) / 100
  penaltyRevenue = Math.round(penaltyRevenue * 100) / 100
  danniRevenue = Math.round(danniRevenue * 100) / 100

  return {
    rentalRevenue,
    penaltyRevenue,
    danniRevenue,
    totalRevenue: Math.round((rentalRevenue + penaltyRevenue + danniRevenue) * 100) / 100,
    bookingsCount: rentalBookings.length,
  }
}
