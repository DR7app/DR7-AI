/**
 * Monthly booking math — mirrors the logic in netlify/functions/monthly-report.ts
 * so any UI showing per-month rental totals (CalendarTab Fatturato, etc.) produces
 * the SAME numbers as Report Noleggio.
 *
 * Business rules:
 * - A rental occupies the pickup day but NOT the dropoff day (car returns that day).
 * - Bookings spanning months are prorated by calendar days.
 * - Same-day bookings (pickup === dropoff) count as 1 day.
 * - All date math uses UTC date components to dodge DST issues.
 */

export interface MonthlyBookingLike {
  pickup_date: string
  dropoff_date: string
  price_total?: number | string | null
  service_type?: string | null
  status?: string | null
  customer_email?: string | null
  customer_name?: string | null
  vehicle_plate?: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking_details?: Record<string, any> | null
}

const TEST_PLATES = new Set(['TEST000', 'TEST002'])
const REPORT_STATUSES = new Set([
  'confirmed', 'confermata', 'completed', 'completata',
  'in_corso', 'active', 'pending',
  'Confirmed', 'Completed', 'Active',
])

/** Total billable days for a booking — start day inclusive, dropoff day exclusive, min 1. */
export function computeBillableDays(startISO: string, endISO: string): number {
  const start = startISO.substring(0, 10)
  const end = endISO.substring(0, 10)
  const [sY, sM, sD] = start.split('-').map(Number)
  const [eY, eM, eD] = end.split('-').map(Number)
  const startMs = Date.UTC(sY, sM - 1, sD)
  const endMs = Date.UTC(eY, eM - 1, eD)
  const diffDays = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24))
  return Math.max(1, diffDays)
}

/** Number of days the booking occupies inside a given month (1-12). 0 if no overlap. */
export function getOccupiedDaysInMonth(
  startISO: string,
  endISO: string,
  year: number,
  monthNum: number,
  daysInMonth: number,
): number {
  const pickup = startISO.substring(0, 10)
  const dropoff = endISO.substring(0, 10)
  const [pY, pM, pD] = pickup.split('-').map(Number)
  const [dY, dM, dD] = dropoff.split('-').map(Number)

  let firstDay: number
  if (pY < year || (pY === year && pM < monthNum)) firstDay = 1
  else if (pY === year && pM === monthNum) firstDay = pD
  else return 0

  let lastDay: number
  if (dY > year || (dY === year && dM > monthNum)) {
    lastDay = daysInMonth
  } else if (dY === year && dM === monthNum) {
    lastDay = dD - 1
    if (lastDay < firstDay) {
      if (pY === year && pM === monthNum) lastDay = firstDay
      else return 0
    }
  } else {
    return 0
  }

  return lastDay - firstDay + 1
}

/** Prorated revenue (in EUR) for the portion of the booking that falls in the given month. */
export function prorateRevenueForMonth(
  booking: MonthlyBookingLike,
  year: number,
  monthNum: number,
  daysInMonth: number,
): number {
  if (!booking.pickup_date || !booking.dropoff_date) return 0
  const totalDays = computeBillableDays(booking.pickup_date, booking.dropoff_date)
  if (totalDays <= 0) return 0
  const overlap = getOccupiedDaysInMonth(
    booking.pickup_date, booking.dropoff_date, year, monthNum, daysInMonth,
  )
  if (overlap <= 0) return 0
  const raw = booking.price_total
  const cents = typeof raw === 'string' ? parseFloat(raw) : (raw || 0)
  const eur = cents / 100
  return (eur / totalDays) * overlap
}

/**
 * Same gate the report applies — keeps Calendar Fatturato in lockstep with Report Noleggio.
 * Excludes: cancelled/expired/annullata, non-rental service types, internal/automatic
 * bookings, the admin@dr7.app account, and TEST000/TEST002 plates.
 */
export function isReportableRentalBooking(b: MonthlyBookingLike): boolean {
  if (!b.pickup_date || !b.dropoff_date) return false

  const status = (b.status || '').trim()
  if (!REPORT_STATUSES.has(status)) return false

  const st = (b.service_type || '').trim().toLowerCase()
  if (st === 'car_wash' || st === 'mechanical_service' || st === 'mechanical') return false

  const details = b.booking_details || {}
  if (details.internal === true) return false
  if (details.createdBy === 'automatic_system') return false

  const plate = (b.vehicle_plate || '').replace(/\s+/g, '').toUpperCase()
  if (plate && TEST_PLATES.has(plate)) return false

  const adminName = (b.customer_name || '').toLowerCase().includes('admin dr7')
  const adminEmail = (b.customer_email || '').toLowerCase() === 'admin@dr7.app'
    || (details.customer?.email || '').toLowerCase() === 'admin@dr7.app'
  if (adminName || adminEmail) return false

  return true
}
