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
  // Exclude the last day (dropoff day = return day, not a rental day)
  while (cursor < endDay) {
    days.add(cursor.getDate())
    cursor.setDate(cursor.getDate() + 1)
  }
  // If start == end (same-day booking), count at least 1 day
  if (days.size === 0) {
    days.add(overlapStart.getDate())
  }
  return days
}

/**
 * Compute billable days for a booking.
 * Business rule: start day inclusive, checkout (end) day exclusive.
 * Feb 6 → Feb 7 = 1 day. Same-day bookings (Feb 6 → Feb 6) = 1 day minimum.
 * Uses UTC to avoid DST issues.
 */
function computeBillableDays(startDateStr: string, endDateStr: string): number {
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
 * Returns occupied day-of-month numbers for a booking within a specific month.
 * Start day inclusive, checkout (end) day exclusive.
 * Returns empty set if no occupied days in the given month.
 *
 * Key fix: a booking from a prior month whose checkout falls on day 1 of this
 * month (e.g. Jan 31 → Feb 1) produces 0 occupied days in this month,
 * NOT 1. The checkout day is when the car is returned — it's available.
 */
function getOccupiedDaysInMonth(
  startDateStr: string,
  endDateStr: string,
  year: number,
  monthNum: number,
  daysInMonth: number
): Set<number> {
  const days = new Set<number>()
  const pickup = startDateStr.substring(0, 10)
  const dropoff = endDateStr.substring(0, 10)
  const [pY, pM, pD] = pickup.split('-').map(Number)
  const [dY, dM, dD] = dropoff.split('-').map(Number)

  // First occupied day in this month
  let firstDay: number
  if (pY < year || (pY === year && pM < monthNum)) {
    firstDay = 1 // booking started before this month
  } else if (pY === year && pM === monthNum) {
    firstDay = pD // booking starts in this month
  } else {
    return days // booking starts after this month
  }

  // Last occupied day in this month (checkout day excluded)
  let lastDay: number
  if (dY > year || (dY === year && dM > monthNum)) {
    lastDay = daysInMonth // booking extends past this month
  } else if (dY === year && dM === monthNum) {
    lastDay = dD - 1 // checkout in this month: exclude checkout day
    if (lastDay < firstDay) {
      if (pY === year && pM === monthNum) {
        // Same-day booking within this month: count 1 day
        lastDay = firstDay
      } else {
        // Booking from prior month, checkout early in this month: 0 days here
        return days
      }
    }
  } else {
    return days // booking ended before this month
  }

  for (let d = firstDay; d <= lastDay; d++) {
    days.add(d)
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
  const fromParam = params.from
  const toParam = params.to
  const debug = params.debug === 'true'

  // 2026-05-23: supportiamo entrambi i formati:
  // 1. month=YYYY-MM (legacy, intero mese)
  // 2. from=YYYY-MM-DD & to=YYYY-MM-DD (nuovo, range arbitrario per
  //    7gg / 30gg / anno / custom). Frontend nuovo manda from+to.
  if (!reportType || (!month && (!fromParam || !toParam))) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required params: type AND (month=YYYY-MM OR from+to=YYYY-MM-DD)' })
    }
  }

  let monthStart: Date
  let monthEnd: Date
  let monthStartISO: string
  let monthEndISO: string
  let daysInMonth: number  // actually "days in period" — variable name kept for diff size
  let year = 0
  let monthNum = 0

  if (fromParam && toParam) {
    // Range arbitrario
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromParam) || !/^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid from/to format. Use YYYY-MM-DD' }) }
    }
    monthStartISO = fromParam
    monthEndISO = toParam
    const [fy, fm, fd] = fromParam.split('-').map(Number)
    const [ty, tm, td] = toParam.split('-').map(Number)
    monthStart = new Date(fy, fm - 1, fd, 0, 0, 0)
    monthEnd = new Date(ty, tm - 1, td, 23, 59, 59)
    if (monthEnd < monthStart) {
      return { statusCode: 400, body: JSON.stringify({ error: 'to must be >= from' }) }
    }
    daysInMonth = Math.round((monthEnd.getTime() - monthStart.getTime()) / 86400000) + 1
    year = fy
    monthNum = fm
  } else {
    // Legacy: mese pieno
    const [yearStr, monthStr] = month!.split('-')
    year = parseInt(yearStr)
    monthNum = parseInt(monthStr)
    if (!year || !monthNum || monthNum < 1 || monthNum > 12) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid month format. Use YYYY-MM' }) }
    }
    daysInMonth = getDaysInMonth(year, monthNum)
    monthStart = new Date(year, monthNum - 1, 1, 0, 0, 0)
    monthEnd = new Date(year, monthNum - 1, daysInMonth, 23, 59, 59)
    monthStartISO = `${year}-${String(monthNum).padStart(2, '0')}-01`
    monthEndISO = `${year}-${String(monthNum).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
  }
  const periodLabel = fromParam && toParam ? `${monthStartISO}_${monthEndISO}` : month!

  try {
    if (reportType === 'vehicles') {
      return await generateVehicleReport(year, monthNum, daysInMonth, monthStart, monthEnd, monthStartISO, monthEndISO, periodLabel, debug)
    } else if (reportType === 'washes') {
      return await generateWashReport(monthStartISO, monthEndISO, periodLabel, daysInMonth)
    } else if (reportType === 'cauzioni') {
      return await generateCauzioniReport(monthStartISO, monthEndISO, periodLabel)
    } else if (reportType === 'diagnose') {
      const plate = params.plate?.toUpperCase().replace(/\s/g, '')
      return await runDiagnostics(plate, monthStartISO, monthEndISO, periodLabel)
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid report type. Use "vehicles", "washes", or "diagnose"' })
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
  month: string,
  debug: boolean
) {
  // Fetch ALL vehicles (including retired — they may have historical bookings)
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, display_name, plate, status, daily_rate, category, metadata')
    .order('display_name')

  if (vehiclesError) throw vehiclesError

  // Fetch ALL bookings that overlap with this month — we filter in JS for full control
  // Only fetch bookings with statuses that represent actual rentals (exclude admin@dr7.app)
  //
  // IMPORTANT (2026-05-20 bug fix): the previous `.not('vehicle_plate', 'in', ...)`
  // filter accidentally dropped every booking with vehicle_plate=NULL. In
  // PostgreSQL three-valued logic, `NULL NOT IN ('TEST000','TEST002')` returns
  // NULL (not TRUE), and PostgREST treats NULL as falsy → row excluded. That
  // wiped out all credit-wallet bookings (book_with_credits doesn't always
  // populate vehicle_plate at the top level). Move the TEST-plate exclusion
  // into the JS filter below so NULLs are kept.
  const { data: allBookings, error: bookingsError } = await supabase
    .from('bookings')
    .select('id, vehicle_id, vehicle_name, vehicle_plate, pickup_date, dropoff_date, price_total, status, service_type, booking_details, appointment_date, payment_status, payment_method, customer_name, customer_email, created_at, updated_at')
    .in('status', ['confirmed', 'confermata', 'completed', 'completata', 'in_corso', 'active', 'pending', 'Confirmed', 'Completed', 'Active'])
    .or('customer_email.is.null,customer_email.neq.admin@dr7.app')

  if (bookingsError) throw bookingsError

  // Fetch penalty/danni fatture for the month (to catch penalties not saved in booking_details)
  const { data: fatture } = await supabase
    .from('fatture')
    .select('id, booking_id, importo_totale, items, data_emissione, customer_name')
    .gte('data_emissione', monthStartISO)
    .lte('data_emissione', monthEndISO)

  // Build a map: booking_id -> array of penalty fatture
  const fatturePenaltyMap = new Map<string, any[]>()
  const fattureDanniMap = new Map<string, any[]>()
  ;(fatture || []).forEach(f => {
    if (!f.booking_id) return
    const items = f.items || []
    // Check if any item description contains penale/penalty or danno/danni
    const hasPenalty = items.some((i: any) => /penal/i.test(i.description || ''))
    const hasDanni = items.some((i: any) => /dann/i.test(i.description || ''))
    if (hasPenalty) {
      const arr = fatturePenaltyMap.get(f.booking_id) || []
      arr.push(f)
      fatturePenaltyMap.set(f.booking_id, arr)
    }
    if (hasDanni) {
      const arr = fattureDanniMap.get(f.booking_id) || []
      arr.push(f)
      fattureDanniMap.set(f.booking_id, arr)
    }
  })

  // STEP 1: Filter to ONLY real rental bookings
  const rentalBookings = (allBookings || []).filter(b => {
    // Exclude admin/test bookings
    const custEmail = (b.customer_name || '').toLowerCase()
    const bookingEmail = (b.booking_details?.customer?.email || '').toLowerCase()
    if (custEmail.includes('admin dr7') || bookingEmail === 'admin@dr7.app') return false

    // Exclude TEST-plate fixtures (moved from the supabase query because
    // .not('vehicle_plate','in',...) silently dropped NULL plates too).
    const bPlateRaw = (b.vehicle_plate || '').replace(/\s/g, '').toUpperCase()
    if (bPlateRaw === 'TEST000' || bPlateRaw === 'TEST002') return false

    // Must have pickup_date and dropoff_date (car wash uses appointment_date instead)
    if (!b.pickup_date || !b.dropoff_date) return false

    // Exclude any service-type bookings
    const st = (b.service_type || '').trim().toLowerCase()
    if (st === 'car_wash' || st === 'mechanical_service' || st === 'mechanical') return false

    // Exclude internal/automatic bookings
    const details = b.booking_details || {}
    if (details.internal === true) return false
    if (details.createdBy === 'automatic_system') return false

    // Must overlap with the report month
    const pickupDate = b.pickup_date.substring(0, 10)
    const dropoffDate = b.dropoff_date.substring(0, 10)
    if (pickupDate > monthEndISO || dropoffDate < monthStartISO) return false

    return true
  })

  // Build a set of all vehicle plates and IDs for quick lookup
  const vehiclePlateSet = new Set<string>()
  const vehicleIdSet = new Set<string>()
  const vehicleNameSet = new Set<string>();
  (vehicles || []).forEach(v => {
    vehicleIdSet.add(v.id)
    if (v.plate) vehiclePlateSet.add(v.plate.replace(/\s/g, '').toUpperCase())
    if (v.display_name) vehicleNameSet.add(v.display_name.trim().toLowerCase())
  })

  // Build vehicle report
  // Set of all valid vehicle ids so we can detect "orphan" bookings whose
  // vehicle_id no longer points to a row in the vehicles table — those need
  // to fall through to the name-based matcher instead of silently dropping.
  const validVehicleIds = new Set((vehicles || []).map(v => v.id))

  // Normalize text for name matching:
  // - lower case + trim
  // - collapse any whitespace run to a single space
  // - replace curly/typographic apostrophes (’ ` ʼ ′) with a straight one
  // Without this, bookings like "Porsche Cayenne Coupe’" (curly ’) never
  // matched the vehicle "Porsche Cayenne Coupe'" (straight ').
  const normName = (s: string | null | undefined): string => {
    return (s || '')
      .toLowerCase()
      .replace(/[‘’‛ʼ′`´]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
  }

  const vehicleReports = (vehicles || []).map(vehicle => {
    const vPlate = (vehicle.plate || '').replace(/\s/g, '').toUpperCase()
    const vName = normName(vehicle.display_name)

    // Match bookings by plate first, then by vehicle_id, then by name.
    // Important: the name fallback also runs when vehicle_id is set but
    // points to a vehicle that no longer exists in the vehicles table
    // (orphaned reference). Previously this case dropped the booking from
    // every vehicle report and admins saw wallet bookings disappear.
    const vehicleBookings = rentalBookings.filter(b => {
      const bPlate = (b.vehicle_plate || '').replace(/\s/g, '').toUpperCase()
      const detailsPlate = (b.booking_details?.vehicle_plate || b.booking_details?.plate || '').replace(/\s/g, '').toUpperCase()
      const bName = normName(b.vehicle_name)

      // 1. Match by plate (targa) — primary method
      if (vPlate && vPlate.length >= 4) {
        if (bPlate === vPlate) return true
        if (detailsPlate === vPlate) return true
      }

      // 2. Match by vehicle_id (top-level or inside booking_details)
      if (b.vehicle_id === vehicle.id) return true
      if (b.booking_details?.vehicle_id === vehicle.id) return true

      // 3. Match by vehicle_name. Two cases:
      //    a) booking has no vehicle_id and no plate at all (old shape)
      //    b) booking has a vehicle_id but that id no longer points to any
      //       row in vehicles (orphan / deleted vehicle) — without this the
      //       wallet booking would be filtered out completely.
      const detailsVehicleId = b.booking_details?.vehicle_id
      const bookingIdMissingOrOrphan =
        (!b.vehicle_id || !validVehicleIds.has(b.vehicle_id))
        && (!detailsVehicleId || !validVehicleIds.has(detailsVehicleId))
      const noPlateOnBooking = !bPlate && !detailsPlate
      if (bookingIdMissingOrOrphan && noPlateOnBooking && bName) {
        if (vName && bName === vName) return true
      }

      return false
    })

    // Calculate rented days
    // rentedDays Set tracks unique calendar days (for maintenance priority)
    // rentedDaysTotal sums each booking's days independently (a day with 2 bookings = 2 days)
    const rentedDays = new Set<number>()
    let rentedDaysTotal = 0
    let rentalRevenue = 0
    let penaltyRevenue = 0
    let danniRevenue = 0
    // 2026-05-24: Incassi anticipati — booking pagati nel periodo report
    // ma con rental in un mese FUTURO. Permettono all'admin di vedere il
    // cash-in reale del mese, separato dal fatturato attribuito alle date
    // di noleggio.
    let anticipatedRevenue = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anticipatedBookings: any[] = []
    const matchedBookingDetails: any[] = []
    const bookingDetailsList: any[] = []

    vehicleBookings.forEach(booking => {
      // Extract just the date part (YYYY-MM-DD)
      const pickupDateRaw = booking.pickup_date
      const dropoffDateRaw = booking.dropoff_date
      const pickupDate = pickupDateRaw.substring(0, 10)
      const dropoffDate = dropoffDateRaw.substring(0, 10)

      // Parse to numbers
      const pYear = parseInt(pickupDate.substring(0, 4))
      const pMonth = parseInt(pickupDate.substring(5, 7))
      const pDay = parseInt(pickupDate.substring(8, 10))

      const dYear = parseInt(dropoffDate.substring(0, 4))
      const dMonth = parseInt(dropoffDate.substring(5, 7))
      const dDay = parseInt(dropoffDate.substring(8, 10))

      // Debug log for specific vehicles
      if (debug || vPlate === 'GT006DG') {
        console.log(`[DEBUG] Vehicle ${vPlate}: booking ${booking.id}`)
        console.log(`  Raw pickup: "${pickupDateRaw}" -> "${pickupDate}" -> Y:${pYear} M:${pMonth} D:${pDay}`)
        console.log(`  Raw dropoff: "${dropoffDateRaw}" -> "${dropoffDate}" -> Y:${dYear} M:${dMonth} D:${dDay}`)
        console.log(`  Report month: ${year}-${monthNum}, daysInMonth: ${daysInMonth}`)
      }

      // Calculate which days of THIS month are covered
      // Month we're reporting on: year, monthNum (1-12)

      // Find start day in this month
      let startDay: number
      if (pYear < year || (pYear === year && pMonth < monthNum)) {
        // Pickup was before this month - starts on day 1
        startDay = 1
      } else if (pYear === year && pMonth === monthNum) {
        // Pickup is in this month
        startDay = pDay
      } else {
        // 2026-05-24: Pickup e' DOPO questo mese. La logica originale
        // confrontava pYear/pMonth vs year/monthNum del periodo. Per
        // range custom (es. 1mag → 31lug) monthNum = mese FROM = 5,
        // quindi una booking con pickup giugno (pMonth=6) entrava qui
        // erroneamente. Adesso usiamo monthEnd come confine assoluto:
        // anticipo SOLO se pickupDate > monthEnd reale del periodo.
        // 2026-05-24: ANTICIPO = pagato nel periodo + rental in mese FUTURO
        // rispetto alla fine del periodo. Esempio: report di MAGGIO + booking
        // pagata 23 mag con pickup 5 lug → anticipo. Booking pagata 23 mag
        // con pickup 30 mag → NON anticipo (e' un rental del mese).
        const pickupAbs = new Date(`${pickupDateRaw.slice(0, 10)}T00:00:00`)
        const isPickupAfterPeriod = pickupAbs > monthEnd
        if (!isPickupAfterPeriod) {
          // Pickup e' DENTRO il periodo o uguale al monthEnd — niente anticipo,
          // il booking verra' processato dai mesi successivi del loop.
          // Per il mese corrente, il booking dovrebbe essere gia' stato
          // processato dal ramo if precedente. Se finiamo qui significa
          // logica di fall-through inattesa — log e skip.
          if (debug || vPlate === 'GT006DG') {
            console.log(`  SKIPPED (no anticipo): pickup ${pickupDateRaw} dentro periodo [${monthStartISO} → ${monthEndISO}]`)
          }
          return
        }
        const isPaid = ['paid', 'completed', 'succeeded'].includes(String(booking.payment_status || '').toLowerCase())
        if (isPaid) {
          // Estraggo data pagamento: priorita' nexi_paid_at (esatta),
          // poi updated_at (admin "Segna Pagato" o callback Nexi), poi
          // created_at come ultimo fallback.
          const paidAtISO = (booking.booking_details?.nexi_paid_at as string | undefined)
            || (booking.updated_at as string | undefined)
            || (booking.created_at as string | undefined)
            || ''
          const paidAt = paidAtISO ? new Date(paidAtISO) : null
          // Anticipo VALIDO solo se: paid e' nel periodo report E pickup e' DOPO la fine del periodo.
          if (paidAt && paidAt >= monthStart && paidAt <= monthEnd) {
            const rawPriceAnt = booking.price_total
            const anticipoEur = (typeof rawPriceAnt === 'string' ? parseFloat(rawPriceAnt) : (rawPriceAnt || 0)) / 100
            anticipatedRevenue += anticipoEur
            anticipatedBookings.push({
              booking_id: booking.id,
              customer_name: booking.customer_name || booking.booking_details?.customer?.fullName || '-',
              targa: vPlate || (booking.vehicle_plate || '').replace(/\s/g, '').toUpperCase() || '-',
              pickup_date: pickupDateRaw,
              dropoff_date: dropoffDateRaw,
              total_price: anticipoEur,
              paid_at: paidAtISO,
              payment_method: booking.payment_method || '-',
            })
            if (debug || vPlate === 'GT006DG') {
              console.log(`  ANTICIPO: pagato ${paidAtISO} (periodo ${monthStartISO}→${monthEndISO}), pickup ${pickupDateRaw} (futuro), €${anticipoEur}`)
            }
          } else if (debug || vPlate === 'GT006DG') {
            console.log(`  SKIPPED (no anticipo): pickup futuro ma pagamento fuori periodo (paid ${paidAtISO})`)
          }
        } else if (debug || vPlate === 'GT006DG') {
          console.log(`  SKIPPED (no anticipo): pickup futuro + non pagato (status=${booking.payment_status})`)
        }
        return
      }

      // Find end day in this month
      // NOTE: Dropoff day is NOT counted - car is returned that day, so it's available
      let endDay: number
      if (dYear > year || (dYear === year && dMonth > monthNum)) {
        // Dropoff is after this month - car is rented until end of month
        endDay = daysInMonth
      } else if (dYear === year && dMonth === monthNum) {
        // Dropoff is in this month - don't count the dropoff day itself
        endDay = dDay - 1
        // Same-day booking in this month: count 1 day
        // Cross-month checkout (pickup was before this month): 0 days in this month
        if (endDay < startDay) {
          if (pYear === year && pMonth === monthNum) {
            endDay = startDay
          } else {
            if (debug || vPlate === 'GT006DG') {
              console.log(`  SKIPPED: cross-month checkout, no occupied days in ${year}-${monthNum}`)
            }
            return
          }
        }
      } else {
        // Dropoff was before this month - skip this booking
        if (debug || vPlate === 'GT006DG') {
          console.log(`  SKIPPED: dropoff (${dYear}-${dMonth}) is before report month (${year}-${monthNum})`)
        }
        return
      }

      if (debug || vPlate === 'GT006DG') {
        console.log(`  Calculated: startDay=${startDay}, endDay=${endDay}, adding days ${startDay}-${endDay}`)
      }

      // Add days to the set (for maintenance exclusion) and sum total
      const overlapDays = endDay - startDay + 1
      rentedDaysTotal += overlapDays
      for (let d = startDay; d <= endDay; d++) {
        rentedDays.add(d)
      }

      // Total booking days for revenue proration (shared function, UTC-safe)
      const totalBookingDays = computeBillableDays(pickupDateRaw, dropoffDateRaw)
      // price_total may be numeric or string (wallet RPC casts to numeric)
      const rawPrice = booking.price_total
      const bookingRevenue = (typeof rawPrice === 'string' ? parseFloat(rawPrice) : (rawPrice || 0)) / 100
      rentalRevenue += (bookingRevenue / totalBookingDays) * overlapDays

      // Customer name from top-level or booking_details
      const customerName = booking.customer_name
        || booking.booking_details?.customer?.fullName
        || booking.vehicle_name
        || '-'

      // Sum danni and penalties from booking_details (amounts in EUR)
      const details = booking.booking_details || {}
      let bookingPenaltyFromDetails = 0
      let bookingDanniFromDetails = 0
      if (Array.isArray(details.danni)) {
        details.danni.forEach((d: any) => {
          const paid = parseFloat(d.amountPaid || d.total || 0)
          if (paid > 0) bookingDanniFromDetails += paid
        })
      }
      if (Array.isArray(details.penalties)) {
        details.penalties.forEach((p: any) => {
          const paid = parseFloat(p.amountPaid || p.total || 0)
          if (paid > 0) bookingPenaltyFromDetails += paid
        })
      }

      // Also check fatture table for penalty/danni invoices not in booking_details
      const penaltyFatture = fatturePenaltyMap.get(booking.id) || []
      let bookingPenaltyFromFatture = 0
      penaltyFatture.forEach((f: any) => {
        bookingPenaltyFromFatture += parseFloat(f.importo_totale || 0)
      })
      // Use the higher of the two sources (avoid double-counting)
      const bookingPenaltyAmount = Math.max(bookingPenaltyFromDetails, bookingPenaltyFromFatture)
      penaltyRevenue += bookingPenaltyAmount

      const danniFatture = fattureDanniMap.get(booking.id) || []
      let bookingDanniFromFatture = 0
      danniFatture.forEach((f: any) => {
        bookingDanniFromFatture += parseFloat(f.importo_totale || 0)
      })
      const bookingDanniAmount = Math.max(bookingDanniFromDetails, bookingDanniFromFatture)
      danniRevenue += bookingDanniAmount

      // Per-booking detail (always included in output)
      // Note: declared AFTER penali/danni sums so each row carries its own
      // breakdown — surfaced in the UI Report Noleggio per-booking expansion.
      bookingDetailsList.push({
        booking_id: booking.id,
        customer_name: customerName,
        targa: vPlate || (booking.vehicle_plate || '').replace(/\s/g, '').toUpperCase() || '-',
        start_at: pickupDateRaw,
        end_at: dropoffDateRaw,
        billable_days: totalBookingDays,
        days_in_month: overlapDays,
        total_price: bookingRevenue,
        revenue_per_day: totalBookingDays > 0 ? Math.round((bookingRevenue / totalBookingDays) * 100) / 100 : 0,
        payment_status: booking.payment_status || '-',
        payment_method: booking.payment_method || '-',
        penalty_amount: Math.round(bookingPenaltyAmount * 100) / 100,
        danni_amount: Math.round(bookingDanniAmount * 100) / 100,
      })

      if (debug) {
        matchedBookingDetails.push({
          id: booking.id,
          vehicle_name: booking.vehicle_name,
          vehicle_plate: booking.vehicle_plate,
          vehicle_id: booking.vehicle_id,
          pickup_date_raw: pickupDateRaw,
          dropoff_date_raw: dropoffDateRaw,
          pickup_date_parsed: pickupDate,
          dropoff_date_parsed: dropoffDate,
          parsed: { pYear, pMonth, pDay, dYear, dMonth, dDay },
          calculated: { startDay, endDay },
          service_type: booking.service_type,
          status: booking.status,
          overlapDays,
          totalBookingDays
        })
      }
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

    // Apply priority: RENTAL > MAINTENANCE > IDLE
    // If a day has an active rental, it counts as rented even if maintenance is scheduled
    const finalRentedDays = new Set(rentedDays)
    const finalMaintenanceDays = new Set<number>()
    maintenanceDays.forEach(d => {
      if (!finalRentedDays.has(d)) {
        finalMaintenanceDays.add(d)
      }
    })

    const rentedCount = rentedDaysTotal
    const maintenanceCount = finalMaintenanceDays.size
    const uniqueRentedDays = finalRentedDays.size

    // 2026-05-23: utilizzo reale = rented / GIORNI TRASCORSI nel periodo
    // (non giorni TOTALI del periodo). Se siamo a meta' mese, denominatore
    // = giorni passati, non l'intero mese, cosi' un veicolo noleggiato
    // tutti i giorni elapsed = 100% anche se il mese non e' finito.
    // Per periodi interamente nel passato, elapsed = period totale.
    const todayMs = Date.now()
    const elapsedEndMs = Math.min(todayMs, monthEnd.getTime())
    const elapsedDaysRaw = elapsedEndMs >= monthStart.getTime()
      ? Math.round((elapsedEndMs - monthStart.getTime()) / 86400000) + 1
      : 0
    const elapsedDays = Math.max(1, Math.min(daysInMonth, elapsedDaysRaw))
    const idleCount = elapsedDays - uniqueRentedDays - maintenanceCount

    const report: any = {
      vehicleId: vehicle.id,
      label: vehicle.display_name,
      plate: vehicle.plate || '-',
      category: vehicle.category || '-',
      status: vehicle.status || 'available',
      rentedDays: rentedCount,
      maintenanceDays: maintenanceCount,
      idleDays: Math.max(0, idleCount),
      // utilizationRate ora basato su giorni trascorsi reali del periodo
      utilizationRate: Math.min(1, Math.round((uniqueRentedDays / elapsedDays) * 100) / 100),
      downtimeRate: Math.min(1, Math.round((maintenanceCount / elapsedDays) * 100) / 100),
      idleRate: Math.min(1, Math.round((Math.max(0, idleCount) / elapsedDays) * 100) / 100),
      elapsedDays,
      periodTotalDays: daysInMonth,
      bookingsCount: vehicleBookings.length,
      rentalRevenue: Math.round(rentalRevenue * 100) / 100,
      penaltyRevenue: Math.round(penaltyRevenue * 100) / 100,
      danniRevenue: Math.round(danniRevenue * 100) / 100,
      totalRevenue: Math.round((rentalRevenue + penaltyRevenue + danniRevenue) * 100) / 100,
      // 2026-05-24: incassi anticipati (booking pagati nel periodo ma rental in mese futuro)
      anticipatedRevenue: Math.round(anticipatedRevenue * 100) / 100,
      anticipatedBookings: anticipatedBookings,
      bookings: bookingDetailsList,
      _bookingIds: vehicleBookings.map(b => b.id)
    }

    if (debug) {
      report._matchedBookings = matchedBookingDetails
      report._rentedDaysArray = Array.from(finalRentedDays).sort((a, b) => a - b)
      report._rawRentedDays = Array.from(rentedDays).sort((a, b) => a - b)
    }

    // Debug log for specific vehicles
    if (vPlate === 'GT006DG') {
      console.log(`[DEBUG] Vehicle GT006DG final result:`)
      console.log(`  Bookings matched: ${vehicleBookings.length}`)
      console.log(`  Raw rented days: [${Array.from(rentedDays).sort((a, b) => a - b).join(', ')}]`)
      console.log(`  Final rented days (after maintenance): [${Array.from(finalRentedDays).sort((a, b) => a - b).join(', ')}]`)
      console.log(`  Rented count: ${rentedCount}`)
    }

    return report
  })

  // Sort by utilization rate descending
  vehicleReports.sort((a, b) => b.utilizationRate - a.utilizationRate)

  // Find unmatched bookings
  const allMatchedIds = new Set<string>()
  vehicleReports.forEach(vr => {
    vr._bookingIds?.forEach((id: string) => allMatchedIds.add(id))
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

  // Clean up debug fields from output (unless debug mode)
  const cleanReports = debug
    ? vehicleReports
    : vehicleReports.map(({ _bookingIds, _matchedBookings, ...rest }: any) => rest)

  return {
    statusCode: 200,
    body: JSON.stringify({
      month,
      daysInMonth,
      vehicleCount: cleanReports.length,
      totalBookingsFound: rentalBookings.length,
      unmatchedBookings: unmatchedBookings.length > 0 ? unmatchedBookings : undefined,
      totalRentalRevenue: Math.round(cleanReports.reduce((sum: number, v: any) => sum + v.rentalRevenue, 0) * 100) / 100,
      totalPenaltyRevenue: Math.round(cleanReports.reduce((sum: number, v: any) => sum + v.penaltyRevenue, 0) * 100) / 100,
      totalDanniRevenue: Math.round(cleanReports.reduce((sum: number, v: any) => sum + v.danniRevenue, 0) * 100) / 100,
      totalRevenue: Math.round(cleanReports.reduce((sum: number, v: any) => sum + v.totalRevenue, 0) * 100) / 100,
      // 2026-05-24: somma di tutti gli incassi anticipati del periodo,
      // tracciati a parte dal totalRevenue (che resta attribuito ai mesi
      // del rental). Visualizzato come voce separata nella UI.
      totalAnticipatedRevenue: Math.round(cleanReports.reduce((sum: number, v: any) => sum + (v.anticipatedRevenue || 0), 0) * 100) / 100,
      anticipatedBookingsCount: cleanReports.reduce((sum: number, v: any) => sum + (v.anticipatedBookings?.length || 0), 0),
      avgUtilizationRate: Math.round((cleanReports.reduce((sum: number, v: any) => sum + v.utilizationRate, 0) / Math.max(1, cleanReports.length)) * 100) / 100,
      vehicles: cleanReports
    })
  }
}

// Diagnostic function to understand data issues
async function runDiagnostics(plate: string | undefined, monthStartISO: string, monthEndISO: string, month: string) {
  const results: any = {
    month,
    diagnosticTime: new Date().toISOString(),
    plate: plate || 'ALL',
  }

  // 1. Get all vehicles and their plates
  const { data: vehicles, error: vErr } = await supabase
    .from('vehicles')
    .select('id, display_name, plate, status, category')
    .order('display_name')

  if (vErr) throw vErr

  results.vehiclesCount = vehicles?.length || 0
  results.vehiclesWithPlates = vehicles?.filter(v => v.plate).length || 0

  if (plate) {
    const matchedVehicle = vehicles?.find(v =>
      v.plate && v.plate.replace(/\s/g, '').toUpperCase() === plate
    )
    results.matchedVehicle = matchedVehicle || 'NOT FOUND'
  }

  // 2. Get ALL bookings (no filter) to see what's there
  const { data: allBookings, error: bErr } = await supabase
    .from('bookings')
    .select('id, vehicle_id, vehicle_name, vehicle_plate, pickup_date, dropoff_date, price_total, status, service_type, booking_details, appointment_date, created_at')
    .order('created_at', { ascending: false })
    .limit(500)

  if (bErr) throw bErr

  results.totalBookingsInDB = allBookings?.length || 0

  // 3. Analyze booking statuses
  const statusCounts: Record<string, number> = {}
  allBookings?.forEach(b => {
    const st = b.status || 'NULL'
    statusCounts[st] = (statusCounts[st] || 0) + 1
  })
  results.bookingStatusCounts = statusCounts

  // 4. Analyze service types
  const serviceTypeCounts: Record<string, number> = {}
  allBookings?.forEach(b => {
    const st = b.service_type || 'NULL/EMPTY'
    serviceTypeCounts[st] = (serviceTypeCounts[st] || 0) + 1
  })
  results.serviceTypeCounts = serviceTypeCounts

  // 5. Find bookings for the specific plate (if provided)
  if (plate) {
    // Match by plate or by vehicle_id (for bookings without plate)
    const matchedVehicleId = vehicles?.find(v =>
      v.plate && v.plate.replace(/\s/g, '').toUpperCase() === plate
    )?.id
    const plateBookings = allBookings?.filter(b => {
      const bPlate = (b.vehicle_plate || '').replace(/\s/g, '').toUpperCase()
      if (bPlate === plate) return true

      const detailsPlate = (b.booking_details?.vehicle_plate || b.booking_details?.plate || '').replace(/\s/g, '').toUpperCase()
      if (detailsPlate === plate) return true

      // Match by vehicle_id for bookings without plate stored
      if (matchedVehicleId && b.vehicle_id === matchedVehicleId && !bPlate && !detailsPlate) return true

      return false
    })

    results.bookingsForPlate = {
      count: plateBookings?.length || 0,
      bookings: plateBookings?.map(b => ({
        id: b.id,
        vehicle_id: b.vehicle_id,
        vehicle_name: b.vehicle_name,
        vehicle_plate: b.vehicle_plate,
        pickup_date: b.pickup_date,
        dropoff_date: b.dropoff_date,
        status: b.status,
        service_type: b.service_type,
        price_total: b.price_total,
        appointment_date: b.appointment_date,
        created_at: b.created_at,
        booking_details_plate: b.booking_details?.vehicle_plate || b.booking_details?.plate || null,
        booking_details_internal: b.booking_details?.internal,
        booking_details_createdBy: b.booking_details?.createdBy
      }))
    }

    // 5b. Find bookings that SHOULD match but might be filtered out
    const validStatuses = ['confirmed', 'confermata', 'completed', 'completata', 'in_corso', 'active', 'pending', 'Confirmed', 'Completed', 'Active']

    const filteredBookings = plateBookings?.filter(b => {
      // Must have pickup_date and dropoff_date
      if (!b.pickup_date || !b.dropoff_date) return false

      // Exclude car wash
      const st = (b.service_type || '').trim().toLowerCase()
      if (st === 'car_wash' || st === 'mechanical_service' || st === 'mechanical') return false

      // Exclude internal
      const details = b.booking_details || {}
      if (details.internal === true) return false
      if (details.createdBy === 'automatic_system') return false

      // Must have valid status
      if (!validStatuses.includes(b.status)) return false

      // Must overlap with month
      const pickupDate = b.pickup_date.substring(0, 10)
      const dropoffDate = b.dropoff_date.substring(0, 10)
      if (pickupDate > monthEndISO || dropoffDate < monthStartISO) return false

      return true
    })

    results.filteredBookingsForPlate = {
      count: filteredBookings?.length || 0,
      bookings: filteredBookings?.map(b => ({
        id: b.id,
        pickup_date: b.pickup_date,
        dropoff_date: b.dropoff_date,
        pickup_date_extracted: b.pickup_date?.substring(0, 10),
        dropoff_date_extracted: b.dropoff_date?.substring(0, 10),
        status: b.status,
        price_total: b.price_total
      }))
    }

    // 5c. Show why some bookings were filtered out
    const rejectedBookings = plateBookings?.filter(b => !filteredBookings?.includes(b))
    results.rejectedBookingsForPlate = {
      count: rejectedBookings?.length || 0,
      reasons: rejectedBookings?.map(b => {
        const reasons = []
        if (!b.pickup_date) reasons.push('NO_PICKUP_DATE')
        if (!b.dropoff_date) reasons.push('NO_DROPOFF_DATE')
        const st = (b.service_type || '').trim().toLowerCase()
        if (st === 'car_wash') reasons.push('IS_CAR_WASH')
        if (st === 'mechanical_service' || st === 'mechanical') reasons.push('IS_MECHANICAL')
        const details = b.booking_details || {}
        if (details.internal === true) reasons.push('IS_INTERNAL')
        if (details.createdBy === 'automatic_system') reasons.push('IS_AUTOMATIC')
        if (!validStatuses.includes(b.status)) reasons.push(`INVALID_STATUS:${b.status}`)
        if (b.pickup_date && b.dropoff_date) {
          const pickupDate = b.pickup_date.substring(0, 10)
          const dropoffDate = b.dropoff_date.substring(0, 10)
          if (pickupDate > monthEndISO) reasons.push(`PICKUP_AFTER_MONTH:${pickupDate}>${monthEndISO}`)
          if (dropoffDate < monthStartISO) reasons.push(`DROPOFF_BEFORE_MONTH:${dropoffDate}<${monthStartISO}`)
        }
        return {
          id: b.id,
          status: b.status,
          service_type: b.service_type,
          pickup_date: b.pickup_date,
          dropoff_date: b.dropoff_date,
          reasons
        }
      })
    }
  }

  // 6. Sample of bookings with dates to check format
  results.sampleBookingsWithDates = allBookings?.slice(0, 5).map(b => ({
    id: b.id,
    pickup_date_raw: b.pickup_date,
    dropoff_date_raw: b.dropoff_date,
    pickup_date_type: typeof b.pickup_date,
    dropoff_date_type: typeof b.dropoff_date,
  }))

  // 7. SIMULATE REPORT CALCULATION for this plate
  if (plate && results.filteredBookingsForPlate?.bookings) {
    const [yearStr, monthStr] = month.split('-')
    const year = parseInt(yearStr)
    const monthNum = parseInt(monthStr)
    const daysInMonth = new Date(year, monthNum, 0).getDate()

    const rentedDays = new Set<number>()
    const dayCalculations: any[] = []

    results.filteredBookingsForPlate.bookings.forEach((booking: any) => {
      const pickupDate = booking.pickup_date_extracted
      const dropoffDate = booking.dropoff_date_extracted

      // Use shared functions for consistency with actual report
      const occupiedDays = getOccupiedDaysInMonth(pickupDate, dropoffDate, year, monthNum, daysInMonth)
      const billableDays = computeBillableDays(pickupDate, dropoffDate)
      const daysAdded: number[] = Array.from(occupiedDays).sort((a, b) => a - b)
      daysAdded.forEach(d => rentedDays.add(d))

      dayCalculations.push({
        booking_id: booking.id,
        pickup: pickupDate,
        dropoff: dropoffDate,
        billable_days: billableDays,
        days_in_month: daysAdded.length,
        daysAdded: daysAdded.length > 0 ? `${daysAdded[0]}-${daysAdded[daysAdded.length - 1]}` : 'none',
        daysCount: daysAdded.length
      })
    })

    results.REPORT_SIMULATION = {
      reportMonth: `${year}-${monthNum}`,
      daysInMonth,
      bookingsProcessed: dayCalculations.length,
      calculations: dayCalculations,
      totalUniqueDays: rentedDays.size,
      rentedDaysArray: Array.from(rentedDays).sort((a, b) => a - b),
      utilizationRate: Math.round((rentedDays.size / daysInMonth) * 100)
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify(results, null, 2)
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
    .select('id, service_name, price_total, status, payment_status, booking_details, vehicle_name, vehicle_plate, appointment_date')
    .eq('service_type', 'car_wash')
    .gte('appointment_date', monthStartISO + 'T00:00:00')
    .lte('appointment_date', monthEndISO + 'T23:59:59')
    .in('status', ['confirmed', 'confermata', 'completed', 'in_corso'])
    // Test plate filter — must allow NULL plates (website-booked carwashes
    // don't set vehicle_plate). SQL NOT IN excludes NULL silently, so we
    // wrap with an OR clause that explicitly accepts IS NULL.
    .or('vehicle_plate.is.null,vehicle_plate.not.in.(TEST000,TEST002)')

  if (washError) throw washError

  // Separate external (billable) washes from internal rientro washes
  const isInternalWash = (booking: any): boolean => {
    const details = booking.booking_details || {}
    if (details.internal === true) return true
    if (details.createdBy === 'automatic_system') return true
    if (booking.vehicle_name && booking.vehicle_name.toUpperCase().startsWith('INTERNO')) return true
    const source = (details.source || '').toLowerCase()
    const notes = (details.notes || '').toLowerCase()
    const combined = source + ' ' + notes
    const rientroKeywords = ['reintegration', 'reint', 'internal', 'reconditioning', 'automatico', 'auto-wash', 'rientro']
    if (rientroKeywords.some(kw => combined.includes(kw))) return true
    return false
  }

  const billableWashes = (washBookings || []).filter(booking => {
    if (isInternalWash(booking)) return false
    if (!booking.price_total || booking.price_total === 0) return false
    return true
  })

  const internalWashes = (washBookings || []).filter(booking => isInternalWash(booking))

  // Billable washes by type
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

  // Internal rientro washes by vehicle
  const internalByVehicle: Record<string, { count: number }> = {}
  internalWashes.forEach(wash => {
    const vehicleName = wash.vehicle_name || wash.service_name || 'Sconosciuto'
    if (!internalByVehicle[vehicleName]) internalByVehicle[vehicleName] = { count: 0 }
    internalByVehicle[vehicleName].count += 1
  })

  const totalRevenue = Object.values(byType).reduce((sum, t) => sum + t.revenue, 0)
  const totalCount = Object.values(byType).reduce((sum, t) => sum + t.count, 0)
  const totalInternalCount = internalWashes.length

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
        .sort((a, b) => b.count - a.count),
      // Internal rientro washes section
      internalWashesCount: totalInternalCount,
      internalByVehicle: Object.entries(internalByVehicle)
        .map(([vehicle, data]) => ({
          vehicle,
          count: data.count
        }))
        .sort((a, b) => b.count - a.count)
    })
  }
}

async function generateCauzioniReport(
  monthStartISO: string,
  monthEndISO: string,
  month: string
) {
  // Fetch cauzioni that were processed (incassate/restituite/sbloccate/bloccate) in this month
  const { data: cauzioni, error } = await supabase
    .from('cauzioni')
    .select(`
      *,
      customers_extended!cliente_id(nome, cognome, denominazione, ragione_sociale, tipo_cliente),
      vehicles!veicolo_id(display_name, plate)
    `)
    .gte('updated_at', monthStartISO + 'T00:00:00')
    .lte('updated_at', monthEndISO + 'T23:59:59')
    .in('stato', ['Restituita', 'Sbloccata', 'Bloccata', 'Danno', 'Incassata'])
    .order('updated_at', { ascending: false })

  if (error) throw error

  const items = (cauzioni || []).map((c: any) => {
    let clienteName = 'Sconosciuto'
    if (c.customers_extended) {
      if (c.customers_extended.tipo_cliente === 'azienda' && (c.customers_extended.ragione_sociale || c.customers_extended.denominazione)) {
        clienteName = c.customers_extended.ragione_sociale || c.customers_extended.denominazione
      } else if (c.customers_extended.nome || c.customers_extended.cognome) {
        clienteName = `${c.customers_extended.nome || ''} ${c.customers_extended.cognome || ''}`.trim()
      }
    }

    return {
      id: c.id,
      cliente: clienteName,
      veicolo: c.vehicles?.display_name || 'N/A',
      targa: c.vehicles?.plate || 'N/A',
      importo: Number(c.importo),
      metodo: c.metodo,
      stato: c.stato,
      note: c.note,
      data_incasso: c.data_incasso,
      data_restituzione: c.data_restituzione,
      data_sblocco: c.data_sblocco,
      updated_at: c.updated_at
    }
  })

  // Summary by stato
  const byStato: Record<string, { count: number; totale: number }> = {}
  items.forEach(item => {
    if (!byStato[item.stato]) byStato[item.stato] = { count: 0, totale: 0 }
    byStato[item.stato].count++
    byStato[item.stato].totale += item.importo
  })

  const incassate = items.filter(i => i.stato === 'Bloccata' || i.stato === 'Incassata')
  const restituite = items.filter(i => i.stato === 'Restituita')
  const sbloccate = items.filter(i => i.stato === 'Sbloccata')
  const danni = items.filter(i => i.stato === 'Danno')

  const totaleIncassato = incassate.reduce((s, i) => s + i.importo, 0)
  const totaleRestituito = restituite.reduce((s, i) => s + i.importo, 0)
  const totaleSbloccato = sbloccate.reduce((s, i) => s + i.importo, 0)
  const totaleDanni = danni.reduce((s, i) => s + i.importo, 0)

  return {
    statusCode: 200,
    body: JSON.stringify({
      month,
      totaleCauzioni: items.length,
      totaleIncassato: Math.round(totaleIncassato * 100) / 100,
      totaleRestituito: Math.round(totaleRestituito * 100) / 100,
      totaleSbloccato: Math.round(totaleSbloccato * 100) / 100,
      totaleDanni: Math.round(totaleDanni * 100) / 100,
      byStato: Object.entries(byStato).map(([stato, data]) => ({
        stato,
        count: data.count,
        totale: Math.round(data.totale * 100) / 100
      })),
      cauzioni: items
    })
  }
}
