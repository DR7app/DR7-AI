import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

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

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  // Require authentication
  const { error: authErr } = await requireAuth(event)
  if (authErr) return authErr

  const params = event.queryStringParameters || {}
  const month = params.month // YYYY-MM

  if (!month) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required param: month (YYYY-MM)' }) }
  }

  const [yearStr, monthStr] = month.split('-')
  const year = parseInt(yearStr)
  const monthNum = parseInt(monthStr)

  if (!year || !monthNum || monthNum < 1 || monthNum > 12) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid month format. Use YYYY-MM' }) }
  }

  const daysInMonth = getDaysInMonth(year, monthNum)
  const monthStartISO = `${year}-${String(monthNum).padStart(2, '0')}-01`
  const monthEndISO = `${year}-${String(monthNum).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`

  // Previous month
  const prevDate = new Date(year, monthNum - 2, 1) // monthNum-1 is 0-based, -1 more for prev
  const prevYear = prevDate.getFullYear()
  const prevMonthNum = prevDate.getMonth() + 1
  const prevDaysInMonth = getDaysInMonth(prevYear, prevMonthNum)
  const prevMonthStartISO = `${prevYear}-${String(prevMonthNum).padStart(2, '0')}-01`
  const prevMonthEndISO = `${prevYear}-${String(prevMonthNum).padStart(2, '0')}-${String(prevDaysInMonth).padStart(2, '0')}`

  // Days elapsed in current month (for projections)
  const now = new Date()
  const nowYear = now.getFullYear()
  const nowMonth = now.getMonth() + 1
  let daysElapsed = daysInMonth
  if (nowYear === year && nowMonth === monthNum) {
    daysElapsed = now.getDate()
  }

  try {
    // Parallel data fetches
    const [
      vehiclesRes,
      currentBookingsRes,
      prevBookingsRes,
      customersRes,
      cauzioniRes,
      fattureRes
    ] = await Promise.all([
      // 1. All active vehicles
      supabase.from('vehicles').select('id, display_name, plate, status, daily_rate, category, metadata')
        .neq('status', 'retired'),
      // 2. Current month bookings — OVERLAP logic, matches Report Noleggio:
      // include any booking active during the month, even if it picked up
      // before. Test plate filter applied client-side after fetch.
      supabase.from('bookings')
        .select('id, vehicle_id, vehicle_name, vehicle_plate, pickup_date, dropoff_date, price_total, status, service_type, booking_details, payment_status, payment_method, customer_name, customer_email, appointment_date, created_at')
        .lte('pickup_date', monthEndISO + 'T23:59:59')
        .gte('dropoff_date', monthStartISO + 'T00:00:00')
        .neq('customer_email', 'admin@dr7.app'),
      // 3. Previous month bookings (same overlap logic)
      supabase.from('bookings')
        .select('id, vehicle_id, vehicle_plate, pickup_date, dropoff_date, price_total, status, service_type, booking_details, payment_status, customer_name, customer_email, appointment_date, created_at')
        .lte('pickup_date', prevMonthEndISO + 'T23:59:59')
        .gte('dropoff_date', prevMonthStartISO + 'T00:00:00')
        .neq('customer_email', 'admin@dr7.app'),
      // 4. Customers — only fetch this month + previous month for the new/returning
      // calculation; total count comes from a separate exact-count query below.
      // (PostgREST caps array selects at 1000 rows.)
      supabase.from('customers_extended')
        .select('id, created_at, nome, cognome')
        .gte('created_at', prevMonthStartISO + 'T00:00:00')
        .lte('created_at', monthEndISO + 'T23:59:59'),
      // 5. Cauzioni for current month
      supabase.from('cauzioni')
        .select('id, importo, stato, metodo, updated_at')
        .gte('updated_at', monthStartISO + 'T00:00:00')
        .lte('updated_at', monthEndISO + 'T23:59:59'),
      // 6. Fatture for cash flow
      supabase.from('fatture')
        .select('id, importo_totale, stato, data_emissione, booking_id')
        .gte('data_emissione', monthStartISO)
        .lte('data_emissione', monthEndISO)
    ])

    if (vehiclesRes.error) throw vehiclesRes.error
    if (currentBookingsRes.error) throw currentBookingsRes.error
    if (prevBookingsRes.error) throw prevBookingsRes.error

    // Exact total customer count (not capped at 1000 like array selects)
    const { count: totalCustomersCount } = await supabase
      .from('customers_extended')
      .select('id', { count: 'exact', head: true })

    const vehicles = vehiclesRes.data || []
    // Apply test-plate filter in JS so NULL plates (admin-created bookings,
    // preventivi-accept flow) aren't accidentally excluded by SQL NOT IN.
    const TEST_PLATES = new Set(['TEST000', 'TEST002'])
    const dropTest = (rows: any[]) => rows.filter(b => !TEST_PLATES.has((b.vehicle_plate || '').toUpperCase()))
    const allCurrentBookings = dropTest(currentBookingsRes.data || [])
    const allPrevBookings = dropTest(prevBookingsRes.data || [])
    const customers = customersRes.data || []
    const cauzioni = cauzioniRes.data || []
    const fatture = fattureRes.data || []

    // Also fetch bookings that started BEFORE this month but overlap (still active)
    const { data: overlapBookings } = await supabase
      .from('bookings')
      .select('id, vehicle_id, vehicle_plate, pickup_date, dropoff_date, price_total, status, service_type, booking_details, payment_status')
      .lt('pickup_date', monthStartISO + 'T00:00:00')
      .gte('dropoff_date', monthStartISO + 'T00:00:00')
      .in('status', ['confirmed', 'confermata', 'completed', 'completata', 'in_corso', 'active'])
      .not('vehicle_plate', 'in', '("TEST000","TEST002")')

    // Filter rental bookings helper
    const filterRentals = (bookings: any[]) => bookings.filter(b => {
      if (!b.pickup_date || !b.dropoff_date) return false
      const st = (b.service_type || '').trim().toLowerCase()
      if (st === 'car_wash' || st === 'mechanical_service' || st === 'mechanical') return false
      const details = b.booking_details || {}
      if (details.internal === true || details.createdBy === 'automatic_system') return false
      return true
    })

    const validStatuses = ['confirmed', 'confermata', 'completed', 'completata', 'in_corso', 'active', 'pending']

    const currentRentals = filterRentals(allCurrentBookings).filter(b => validStatuses.includes(b.status))
    const prevRentals = filterRentals(allPrevBookings).filter(b => validStatuses.includes(b.status))
    const overlapRentals = filterRentals(overlapBookings || [])

    // All rentals that were active in this month (started in month + overlap from before)
    const monthRentals = [...currentRentals, ...overlapRentals]

    // === 1. FATTURATO (Revenue) ===
    const calcRevenue = (bookings: any[]) => {
      let rental = 0, wash = 0, penalties = 0, danni = 0
      bookings.forEach(b => {
        const rawPrice = b.price_total
        const price = (typeof rawPrice === 'string' ? parseFloat(rawPrice) : (rawPrice || 0)) / 100
        const st = (b.service_type || '').trim().toLowerCase()
        if (st === 'car_wash') {
          wash += price
        } else {
          rental += price
        }
        const details = b.booking_details || {}
        if (Array.isArray(details.penalties)) {
          details.penalties.forEach((p: any) => {
            const paid = parseFloat(p.amountPaid || p.total || 0)
            if (paid > 0) penalties += paid
          })
        }
        if (Array.isArray(details.danni)) {
          details.danni.forEach((d: any) => {
            const paid = parseFloat(d.amountPaid || d.total || 0)
            if (paid > 0) danni += paid
          })
        }
      })
      return { rental, wash, penalties, danni, total: rental + wash + penalties + danni }
    }

    // Current month: all bookings starting this month (rentals + washes + everything)
    const currentAllValid = allCurrentBookings.filter(b => validStatuses.includes(b.status))
    const prevAllValid = allPrevBookings.filter(b => validStatuses.includes(b.status))

    const currentRevenue = calcRevenue(currentAllValid)
    const prevRevenue = calcRevenue(prevAllValid)

    // Cancelled bookings — money that WAS booked but won't be earned. The user
    // wants visibility on this so it doesn't look like the month is empty.
    const cancelledStatuses = ['cancelled', 'annullata']
    const currentCancelled = allCurrentBookings.filter(b => cancelledStatuses.includes(b.status))
    const cancelledRentals = currentCancelled.filter(b => {
      const st = (b.service_type || '').trim().toLowerCase()
      return st !== 'car_wash' && st !== 'mechanical_service' && st !== 'mechanical'
    })
    const cancelledRentalsTotal = cancelledRentals.reduce((s, b) => {
      const raw = b.price_total
      const val = (typeof raw === 'string' ? parseFloat(raw) : (raw || 0)) / 100
      return s + val
    }, 0)
    const cancelledRentalsCount = cancelledRentals.length

    // Car-wash totals (separate revenue stream — kept out of "rental fatturato"
    // but still part of the month's activity).
    const washBookings = currentAllValid.filter(b => (b.service_type || '').trim().toLowerCase() === 'car_wash')
    const washCount = washBookings.length
    const washTotal = washBookings.reduce((s, b) => {
      const raw = b.price_total
      const val = (typeof raw === 'string' ? parseFloat(raw) : (raw || 0)) / 100
      return s + val
    }, 0)

    // Incassato: bookings that are actually paid
    const paidStatuses = ['paid', 'completed', 'succeeded']
    const currentPaid = currentAllValid.filter(b => paidStatuses.includes(b.payment_status))
    const incassato = calcRevenue(currentPaid).total

    const revenueChangePercent = prevRevenue.total > 0
      ? Math.round(((currentRevenue.total - prevRevenue.total) / prevRevenue.total) * 100)
      : 0

    // === 2. OCCUPAZIONE FLOTTA (Fleet Utilization) ===
    const totalVehicles = vehicles.length

    // Count vehicles currently rented (have an active booking NOW)
    const nowISO = now.toISOString()
    const rentedNow = new Set<string>()
    const allActiveBookings = [...allCurrentBookings, ...(overlapBookings || [])]
    allActiveBookings.forEach(b => {
      if (!b.pickup_date || !b.dropoff_date) return
      if (!['confirmed', 'confermata', 'in_corso', 'active'].includes(b.status)) return
      const st = (b.service_type || '').trim().toLowerCase()
      if (st === 'car_wash' || st === 'mechanical_service' || st === 'mechanical') return
      if (b.pickup_date <= nowISO && b.dropoff_date >= nowISO) {
        if (b.vehicle_id) rentedNow.add(b.vehicle_id)
      }
    })

    const rentedNowCount = rentedNow.size
    const idleNowCount = totalVehicles - rentedNowCount
    const occupationRate = totalVehicles > 0 ? Math.round((rentedNowCount / totalVehicles) * 100) : 0

    // Monthly occupation rate (avg across month)
    const calcMonthlyOccupation = (rentals: any[], vehList: any[], mStart: string, mEnd: string, dim: number) => {
      if (vehList.length === 0) return 0
      const vehicleRentedDays: Record<string, Set<number>> = {}
      vehList.forEach(v => { vehicleRentedDays[v.id] = new Set() })

      rentals.forEach(b => {
        const vid = b.vehicle_id
        if (!vid || !vehicleRentedDays[vid]) return
        const pickup = b.pickup_date.substring(0, 10)
        const dropoff = b.dropoff_date.substring(0, 10)
        const [pY, pM, pD] = pickup.split('-').map(Number)
        const [dY, dM, dD] = dropoff.split('-').map(Number)
        const mY = parseInt(mStart.substring(0, 4))
        const mM = parseInt(mStart.substring(5, 7))

        let startDay: number
        if (pY < mY || (pY === mY && pM < mM)) startDay = 1
        else if (pY === mY && pM === mM) startDay = pD
        else return

        let endDay: number
        if (dY > mY || (dY === mY && dM > mM)) endDay = dim
        else if (dY === mY && dM === mM) {
          endDay = dD - 1
          if (endDay < startDay) {
            if (pY === mY && pM === mM) endDay = startDay
            else return
          }
        } else return

        for (let d = startDay; d <= endDay; d++) {
          vehicleRentedDays[vid].add(d)
        }
      })

      let totalDays = 0
      Object.values(vehicleRentedDays).forEach(days => { totalDays += days.size })
      return Math.round((totalDays / (vehList.length * dim)) * 100)
    }

    const monthlyOccupationRate = calcMonthlyOccupation(monthRentals, vehicles, monthStartISO, monthEndISO, daysInMonth)

    // Previous month rate - fetch overlap bookings for prev month too
    const { data: prevOverlapBookings } = await supabase
      .from('bookings')
      .select('id, vehicle_id, vehicle_plate, pickup_date, dropoff_date, status, service_type, booking_details')
      .lt('pickup_date', prevMonthStartISO + 'T00:00:00')
      .gte('dropoff_date', prevMonthStartISO + 'T00:00:00')
      .in('status', ['confirmed', 'confermata', 'completed', 'completata', 'in_corso', 'active'])

    const prevMonthRentals = [...prevRentals, ...filterRentals(prevOverlapBookings || [])]
    const prevMonthlyOccupationRate = calcMonthlyOccupation(prevMonthRentals, vehicles, prevMonthStartISO, prevMonthEndISO, prevDaysInMonth)

    const fleetChangePercent = prevMonthlyOccupationRate > 0
      ? monthlyOccupationRate - prevMonthlyOccupationRate
      : 0

    // Vehicles idle > 10 days
    const vehicleLastBookingEnd: Record<string, string> = {}
    allActiveBookings.forEach(b => {
      if (!b.vehicle_id || !b.dropoff_date) return
      const st = (b.service_type || '').trim().toLowerCase()
      if (st === 'car_wash' || st === 'mechanical_service') return
      if (!vehicleLastBookingEnd[b.vehicle_id] || b.dropoff_date > vehicleLastBookingEnd[b.vehicle_id]) {
        vehicleLastBookingEnd[b.vehicle_id] = b.dropoff_date
      }
    })

    const vehiclesIdleLong: Array<{ name: string; plate: string; idleDays: number }> = []
    vehicles.forEach(v => {
      const lastEnd = vehicleLastBookingEnd[v.id]
      if (!lastEnd) {
        // No bookings at all - count as idle since start of month
        vehiclesIdleLong.push({ name: v.display_name, plate: v.plate || '-', idleDays: daysElapsed })
      } else {
        const endDate = new Date(lastEnd)
        const diffMs = now.getTime() - endDate.getTime()
        const idleDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
        if (idleDays > 10) {
          vehiclesIdleLong.push({ name: v.display_name, plate: v.plate || '-', idleDays })
        }
      }
    })
    vehiclesIdleLong.sort((a, b) => b.idleDays - a.idleDays)

    // === 3. RICAVO MEDIO PER VEICOLO (Revenue per Vehicle) ===
    const vehicleRevenues: Array<{ id: string; name: string; plate: string; revenue: number; rentedDays: number }> = []

    vehicles.forEach(vehicle => {
      const vPlate = (vehicle.plate || '').replace(/\s/g, '').toUpperCase()
      let vRevenue = 0
      let vRentedDays = 0

      monthRentals.forEach(b => {
        const bPlate = (b.vehicle_plate || '').replace(/\s/g, '').toUpperCase()
        const detailsPlate = (b.booking_details?.vehicle_plate || b.booking_details?.plate || '').replace(/\s/g, '').toUpperCase()
        const matched = (vPlate && (bPlate === vPlate || detailsPlate === vPlate)) ||
          (b.vehicle_id === vehicle.id && !bPlate && !detailsPlate)
        if (!matched) return

        const rawPrice = b.price_total
        const bookingRevenue = (typeof rawPrice === 'string' ? parseFloat(rawPrice) : (rawPrice || 0)) / 100
        const totalDays = computeBillableDays(b.pickup_date, b.dropoff_date)

        // Prorate to this month
        const pickup = b.pickup_date.substring(0, 10)
        const dropoff = b.dropoff_date.substring(0, 10)
        const pD = parseInt(pickup.substring(8, 10))
        const dD = parseInt(dropoff.substring(8, 10))
        const pM = parseInt(pickup.substring(5, 7))
        const dM = parseInt(dropoff.substring(5, 7))
        const pY = parseInt(pickup.substring(0, 4))
        const dY = parseInt(dropoff.substring(0, 4))

        let startDay = (pY < year || (pY === year && pM < monthNum)) ? 1 : pD
        let endDay: number
        if (dY > year || (dY === year && dM > monthNum)) endDay = daysInMonth
        else {
          endDay = dD - 1
          if (endDay < startDay) {
            if (pY === year && pM === monthNum) endDay = startDay
            else return
          }
        }
        const overlapDays = endDay - startDay + 1
        vRevenue += (bookingRevenue / totalDays) * overlapDays
        vRentedDays += overlapDays
      })

      vehicleRevenues.push({
        id: vehicle.id,
        name: vehicle.display_name,
        plate: vehicle.plate || '-',
        revenue: vRevenue,
        rentedDays: vRentedDays
      })
    })

    // Average revenue per day across fleet (only count vehicles that were rented)
    const totalFleetRevenue = vehicleRevenues.reduce((s, v) => s + v.revenue, 0)
    const totalFleetRentedDays = vehicleRevenues.reduce((s, v) => s + v.rentedDays, 0)
    const avgPerDay = totalFleetRentedDays > 0 ? totalFleetRevenue / totalFleetRentedDays : 0

    // Same for prev month
    let prevTotalRevenue = 0, prevTotalRentedDays = 0
    vehicles.forEach(vehicle => {
      const vPlate = (vehicle.plate || '').replace(/\s/g, '').toUpperCase()
      prevMonthRentals.forEach(b => {
        const bPlate = (b.vehicle_plate || '').replace(/\s/g, '').toUpperCase()
        const detailsPlate = (b.booking_details?.vehicle_plate || b.booking_details?.plate || '').replace(/\s/g, '').toUpperCase()
        const matched = (vPlate && (bPlate === vPlate || detailsPlate === vPlate)) ||
          (b.vehicle_id === vehicle.id && !bPlate && !detailsPlate)
        if (!matched) return
        const rawPrice = b.price_total
        const rev = (typeof rawPrice === 'string' ? parseFloat(rawPrice) : (rawPrice || 0)) / 100
        const days = computeBillableDays(b.pickup_date, b.dropoff_date)
        prevTotalRevenue += rev
        prevTotalRentedDays += days
      })
    })
    const prevAvgPerDay = prevTotalRentedDays > 0 ? prevTotalRevenue / prevTotalRentedDays : 0
    const avgPerDayChange = prevAvgPerDay > 0
      ? Math.round(((avgPerDay - prevAvgPerDay) / prevAvgPerDay) * 100)
      : 0

    // Top 3 and under-performers
    const vehiclePerDay = vehicleRevenues
      .filter(v => v.rentedDays > 0)
      .map(v => ({ name: v.name, plate: v.plate, perDay: Math.round((v.revenue / v.rentedDays) * 100) / 100, revenue: v.revenue }))
      .sort((a, b) => b.perDay - a.perDay)

    const topPerformers = vehiclePerDay.slice(0, 3).map(v => ({
      name: v.name, plate: v.plate, perDay: v.perDay, changePercent: 0
    }))
    const underPerformers = vehiclePerDay.filter(v => v.perDay < avgPerDay).map(v => ({
      name: v.name, plate: v.plate, perDay: v.perDay
    }))

    // === 4. PRENOTAZIONI (Bookings) ===
    const currentAllBookings = allCurrentBookings.filter(b => {
      const st = (b.service_type || '').trim().toLowerCase()
      return st !== 'car_wash' && st !== 'mechanical_service' && st !== 'mechanical'
    })
    const prevAllBookingsFiltered = allPrevBookings.filter(b => {
      const st = (b.service_type || '').trim().toLowerCase()
      return st !== 'car_wash' && st !== 'mechanical_service' && st !== 'mechanical'
    })

    const totalBookings = currentAllBookings.length
    const prevTotalBookings = prevAllBookingsFiltered.length
    const bookingsChangePercent = prevTotalBookings > 0
      ? Math.round(((totalBookings - prevTotalBookings) / prevTotalBookings) * 100)
      : 0

    const confirmedBookings = currentAllBookings.filter(b =>
      ['confirmed', 'confermata', 'completed', 'completata', 'in_corso', 'active'].includes(b.status)
    ).length
    const pendingBookings = currentAllBookings.filter(b => b.status === 'pending').length
    const cancelledBookings = currentAllBookings.filter(b =>
      ['cancelled', 'annullata'].includes(b.status)
    ).length
    const conversionRate = (confirmedBookings + cancelledBookings) > 0
      ? Math.round((confirmedBookings / (confirmedBookings + cancelledBookings)) * 100)
      : 100

    // === 5. CLIENTI (Customers) ===
    // New customers: created_at in this month
    const newThisMonth = customers.filter(c => {
      if (!c.created_at) return false
      const d = c.created_at.substring(0, 7) // YYYY-MM
      return d === month
    }).length

    const prevMonthStr = `${prevYear}-${String(prevMonthNum).padStart(2, '0')}`
    const prevNewCount = customers.filter(c => {
      if (!c.created_at) return false
      return c.created_at.substring(0, 7) === prevMonthStr
    }).length

    // Active customers: had a booking this month
    const activeEmails = new Set<string>()
    allCurrentBookings.forEach(b => {
      if (b.customer_email) activeEmails.add(b.customer_email.toLowerCase())
    })

    const customersChangePercent = prevNewCount > 0
      ? Math.round(((newThisMonth - prevNewCount) / prevNewCount) * 100)
      : 0

    // === 6. DANNI / RISCHI ===
    let danniAmount = 0, danniCount = 0, prevDanniAmount = 0
    let insolutiAmount = 0, insolutiCount = 0

    currentAllValid.forEach(b => {
      const details = b.booking_details || {}
      if (Array.isArray(details.danni)) {
        details.danni.forEach((d: any) => {
          danniCount++
          const total = parseFloat(d.total || 0)
          danniAmount += total
          const paid = parseFloat(d.amountPaid || 0)
          if (paid < total) {
            insolutiAmount += (total - paid)
            insolutiCount++
          }
        })
      }
      if (Array.isArray(details.penalties)) {
        details.penalties.forEach((p: any) => {
          const total = parseFloat(p.total || 0)
          const paid = parseFloat(p.amountPaid || 0)
          if (paid < total) {
            insolutiAmount += (total - paid)
            insolutiCount++
          }
        })
      }
    })

    prevAllValid.forEach(b => {
      const details = b.booking_details || {}
      if (Array.isArray(details.danni)) {
        details.danni.forEach((d: any) => {
          prevDanniAmount += parseFloat(d.total || 0)
        })
      }
    })

    const danniChangePercent = prevDanniAmount > 0
      ? Math.round(((danniAmount - prevDanniAmount) / prevDanniAmount) * 100)
      : 0

    // === 7. PAGAMENTI / CASH FLOW ===
    const incassatoTotal = incassato
    // Da incassare: unpaid bookings this month
    const unpaidBookings = currentAllValid.filter(b => !paidStatuses.includes(b.payment_status))
    let daIncassare = 0
    unpaidBookings.forEach(b => {
      const rawPrice = b.price_total
      daIncassare += (typeof rawPrice === 'string' ? parseFloat(rawPrice) : (rawPrice || 0)) / 100
    })
    daIncassare += insolutiAmount // Add unpaid danni/penalties

    // Scaduti: from fatture with overdue status
    let insolutiScaduti = 0
    fatture.forEach((f: any) => {
      if (f.stato === 'non_pagata' || f.stato === 'scaduta') {
        insolutiScaduti += parseFloat(f.importo_totale || 0)
      }
    })

    // Build response
    const response = {
      period: { month, daysInMonth, daysElapsed },

      revenue: {
        currentMonth: Math.round(currentRevenue.total * 100) / 100,
        previousMonth: Math.round(prevRevenue.total * 100) / 100,
        changePercent: revenueChangePercent,
        incassato: Math.round(incassato * 100) / 100,
        incassatoPercent: currentRevenue.total > 0 ? Math.round((incassato / currentRevenue.total) * 100) : 0,
        // Visibility on what's intentionally NOT in fatturato
        cancelledRentalsTotal: Math.round(cancelledRentalsTotal * 100) / 100,
        cancelledRentalsCount,
        washTotal: Math.round(washTotal * 100) / 100,
        washCount,
        bySource: {
          rental: Math.round(currentRevenue.rental * 100) / 100,
          wash: Math.round(currentRevenue.wash * 100) / 100,
          penalties: Math.round(currentRevenue.penalties * 100) / 100,
          danni: Math.round(currentRevenue.danni * 100) / 100
        }
      },

      fleet: {
        totalVehicles,
        rentedNow: rentedNowCount,
        idleNow: idleNowCount,
        occupationRate: monthlyOccupationRate,
        previousRate: prevMonthlyOccupationRate,
        changePercent: fleetChangePercent,
        vehiclesIdleLong: vehiclesIdleLong.slice(0, 10)
      },

      revenuePerVehicle: {
        avgPerDay: Math.round(avgPerDay * 100) / 100,
        previousAvgPerDay: Math.round(prevAvgPerDay * 100) / 100,
        changePercent: avgPerDayChange,
        topPerformers,
        underPerformers: underPerformers.slice(0, 5)
      },

      bookings: {
        total: totalBookings,
        previousTotal: prevTotalBookings,
        changePercent: bookingsChangePercent,
        confirmed: confirmedBookings,
        pending: pendingBookings,
        cancelled: cancelledBookings,
        conversionRate
      },

      customers: {
        newThisMonth,
        activeThisMonth: activeEmails.size,
        previousNewCount: prevNewCount,
        changePercent: customersChangePercent,
        totalCustomers: totalCustomersCount ?? customers.length
      },

      damages: {
        danniAmount: Math.round(danniAmount * 100) / 100,
        previousDanniAmount: Math.round(prevDanniAmount * 100) / 100,
        changePercent: danniChangePercent,
        danniCount,
        insoluti: Math.round(insolutiAmount * 100) / 100,
        insolutiCount
      },

      cashFlow: {
        incassato: Math.round(incassatoTotal * 100) / 100,
        daIncassare: Math.round(daIncassare * 100) / 100,
        insolutiScaduti: Math.round(insolutiScaduti * 100) / 100
      }
    }

    // ============================================================
    // EXTENDED KPI SECTIONS — each in its own try/catch so a single
    // failing query never blanks the dashboard. Run in parallel.
    // ============================================================
    const sevenDaysFromNowISO = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const thirtyDaysFromNowISO = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const thirtyDaysAgoISO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // Helper: settle and extract or fall back
    const safe = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn()
      } catch (e) {
        console.error(`[dashboard-kpi] ${label} failed:`, (e as Error).message)
        return fallback
      }
    }

    const [
      primeWashSection,
      cauzioniSection,
      recensioniSection,
      walletSection,
      referralSection,
      dr7ClubSection,
      speseSection,
      fornitoriCashFlowSection,
    ] = await Promise.all([
      // -------- PRIME WASH (lavaggi + meccanica from bookings) --------
      safe('primeWash', async () => {
        const [curr, prev] = await Promise.all([
          supabase.from('bookings')
            .select('id, service_type, price_total, payment_status, appointment_date')
            .in('service_type', ['car_wash', 'mechanical'])
            .gte('appointment_date', monthStartISO)
            .lte('appointment_date', monthEndISO),
          supabase.from('bookings')
            .select('id, service_type, price_total, appointment_date')
            .in('service_type', ['car_wash', 'mechanical'])
            .gte('appointment_date', prevMonthStartISO)
            .lte('appointment_date', prevMonthEndISO),
        ])
        const cur = curr.data || []
        const prv = prev.data || []
        const lavaggi = cur.filter(b => b.service_type === 'car_wash').reduce((s, b) => s + (Number(b.price_total) || 0), 0)
        const meccanica = cur.filter(b => b.service_type === 'mechanical').reduce((s, b) => s + (Number(b.price_total) || 0), 0)
        const revenue = lavaggi + meccanica
        const revenuePrev = prv.reduce((s, b) => s + (Number(b.price_total) || 0), 0)
        const changePercent = revenuePrev > 0 ? Math.round(((revenue - revenuePrev) / revenuePrev) * 100) : 0
        const bookingsCount = cur.length
        const bookingsPrev = prv.length
        const avgTicket = bookingsCount > 0 ? revenue / bookingsCount : 0
        return {
          revenue: Math.round(revenue * 100) / 100,
          revenuePrev: Math.round(revenuePrev * 100) / 100,
          changePercent,
          bookingsCount,
          bookingsPrev,
          avgTicket: Math.round(avgTicket * 100) / 100,
          bySource: {
            lavaggi: Math.round(lavaggi * 100) / 100,
            meccanica: Math.round(meccanica * 100) / 100,
          },
        }
      }, { revenue: 0, revenuePrev: 0, changePercent: 0, bookingsCount: 0, bookingsPrev: 0, avgTicket: 0, bySource: { lavaggi: 0, meccanica: 0 } }),

      // -------- CAUZIONI (active + expiring + recovered) --------
      safe('cauzioni', async () => {
        const [active, expiring, recovered] = await Promise.all([
          supabase.from('cauzioni').select('id, importo, stato', { count: 'exact' }).eq('stato', 'attiva'),
          supabase.from('cauzioni').select('id, importo, expires_at').eq('stato', 'attiva').lte('expires_at', sevenDaysFromNowISO),
          supabase.from('cauzioni').select('id, importo, updated_at').eq('stato', 'rilasciata').gte('updated_at', thirtyDaysAgoISO),
        ])
        const activeRows = active.data || []
        const activeOutstanding = activeRows.reduce((s, c) => s + (Number(c.importo) || 0), 0)
        const expiringRows = expiring.data || []
        const expiringNext7Days = expiringRows.reduce((s, c) => s + (Number(c.importo) || 0), 0)
        const recoveredRows = recovered.data || []
        const recoveredLast30Days = recoveredRows.reduce((s, c) => s + (Number(c.importo) || 0), 0)
        return {
          activeOutstanding: Math.round(activeOutstanding * 100) / 100,
          activeCount: active.count ?? activeRows.length,
          expiringNext7Days: Math.round(expiringNext7Days * 100) / 100,
          expiringNext7Count: expiringRows.length,
          recoveredLast30Days: Math.round(recoveredLast30Days * 100) / 100,
          recoveredLast30Count: recoveredRows.length,
        }
      }, { activeOutstanding: 0, activeCount: 0, expiringNext7Days: 0, expiringNext7Count: 0, recoveredLast30Days: 0, recoveredLast30Count: 0 }),

      // -------- RECENSIONI --------
      safe('recensioni', async () => {
        // Prefer review_candidates with rating filled. Adjust if your real
        // schema differs — this falls back to safe defaults on error.
        const { data, error } = await supabase
          .from('review_candidates')
          .select('rating, status, created_at, replied_at')
          .gte('created_at', monthStartISO + 'T00:00:00')
          .lte('created_at', monthEndISO + 'T23:59:59')
        if (error) throw error
        const rows = (data || []).filter(r => r.rating != null)
        const receivedThisMonth = rows.length
        const avgRating = receivedThisMonth > 0
          ? rows.reduce((s, r) => s + Number(r.rating), 0) / receivedThisMonth
          : 0
        const replied = rows.filter(r => r.replied_at).length
        const responseRate = receivedThisMonth > 0 ? Math.round((replied / receivedThisMonth) * 100) : 0
        const negative = rows.filter(r => Number(r.rating) <= 2).length
        const negativePercent = receivedThisMonth > 0 ? Math.round((negative / receivedThisMonth) * 100) : 0
        return {
          avgRating: Math.round(avgRating * 10) / 10,
          receivedThisMonth,
          responseRate,
          negativePercent,
          negativeCount: negative,
        }
      }, { avgRating: 0, receivedThisMonth: 0, responseRate: 0, negativePercent: 0, negativeCount: 0 }),

      // -------- CUSTOMER WALLET --------
      safe('wallet', async () => {
        // Total liability = sum of all positive balances
        const [balances, topups, redemptions] = await Promise.all([
          supabase.from('user_credit_balance').select('balance'),
          supabase.from('credit_transactions')
            .select('amount, type, created_at')
            .eq('type', 'topup')
            .gte('created_at', monthStartISO + 'T00:00:00')
            .lte('created_at', monthEndISO + 'T23:59:59'),
          supabase.from('credit_transactions')
            .select('amount, type, created_at')
            .eq('type', 'spend')
            .gte('created_at', monthStartISO + 'T00:00:00')
            .lte('created_at', monthEndISO + 'T23:59:59'),
        ])
        const totalLiability = (balances.data || []).reduce((s, w) => s + Math.max(0, Number(w.balance) || 0), 0)
        const topupsAmount = (topups.data || []).reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0)
        const redemptionsAmount = (redemptions.data || []).reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0)
        return {
          totalLiability: Math.round(totalLiability * 100) / 100,
          topupsThisMonth: Math.round(topupsAmount * 100) / 100,
          redemptionsThisMonth: Math.round(redemptionsAmount * 100) / 100,
          netFlow: Math.round((topupsAmount - redemptionsAmount) * 100) / 100,
        }
      }, { totalLiability: 0, topupsThisMonth: 0, redemptionsThisMonth: 0, netFlow: 0 }),

      // -------- REFERRAL --------
      safe('referral', async () => {
        const [participants, bonuses, conversions] = await Promise.all([
          supabase.from('referral_participants').select('user_id, status', { count: 'exact', head: true }).eq('status', 'active'),
          supabase.from('referral_bonuses')
            .select('amount, status')
            .eq('status', 'pending'),
          supabase.from('referral_bonuses')
            .select('amount, created_at')
            .gte('created_at', monthStartISO + 'T00:00:00')
            .lte('created_at', monthEndISO + 'T23:59:59'),
        ])
        const activeReferrers = participants.count ?? 0
        const payoutsOwed = (bonuses.data || []).reduce((s, b) => s + (Number(b.amount) || 0), 0)
        const conversionsThisMonth = (conversions.data || []).length
        return {
          activeReferrers,
          conversionsThisMonth,
          payoutsOwed: Math.round(payoutsOwed * 100) / 100,
        }
      }, { activeReferrers: 0, conversionsThisMonth: 0, payoutsOwed: 0 }),

      // -------- DR7 CLUB --------
      safe('dr7Club', async () => {
        const { data, error } = await supabase
          .from('dr7_club_subscriptions')
          .select('user_id, plan, status, expires_at, amount')
          .eq('status', 'active')
        if (error) throw error
        const rows = data || []
        const activeMembers = rows.length
        // MRR: sum of monthly equivalent. If amount is yearly (most common at €39/anno),
        // divide by 12. If a row has a `plan` like 'monthly', use amount directly.
        const mrr = rows.reduce((s, r) => {
          const amt = Number(r.amount) || 0
          const monthly = (r.plan && /month|mens/i.test(r.plan)) ? amt : amt / 12
          return s + monthly
        }, 0)
        const expiringNext30Days = rows.filter(r => r.expires_at && r.expires_at <= thirtyDaysFromNowISO).length
        return {
          activeMembers,
          mrr: Math.round(mrr * 100) / 100,
          expiringNext30Days,
        }
      }, { activeMembers: 0, mrr: 0, expiringNext30Days: 0 }),

      // -------- SPESE (passive invoices, ALL suppliers) --------
      // Reuses the existing get-incoming-invoices function via internal call.
      safe('spese', async () => {
        // Build absolute origin for internal call
        const origin = event.headers['x-forwarded-proto'] && event.headers.host
          ? `${event.headers['x-forwarded-proto']}://${event.headers.host}`
          : process.env.URL || ''
        const [currMonthRes, prevMonthRes] = await Promise.all([
          fetch(`${origin}/.netlify/functions/get-incoming-invoices?month=${month}&mode=all`).then(r => r.json()).catch(() => null),
          fetch(`${origin}/.netlify/functions/get-incoming-invoices?month=${prevYear}-${String(prevMonthNum).padStart(2, '0')}&mode=all`).then(r => r.json()).catch(() => null),
        ])
        const totalThisMonth = Number(currMonthRes?.grandTotal) || 0
        const totalPrevMonth = Number(prevMonthRes?.grandTotal) || 0
        const changePercent = totalPrevMonth > 0
          ? Math.round(((totalThisMonth - totalPrevMonth) / totalPrevMonth) * 100)
          : 0
        // bySupplier — full list, sorted by total desc
        const supplierTotals = currMonthRes?.supplierTotals || {}
        const bySupplier = Object.entries(supplierTotals)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map(([name, agg]: [string, any]) => ({ name, count: agg.count, total: Math.round(agg.total * 100) / 100 }))
          .sort((a, b) => b.total - a.total)
        return {
          totalThisMonth: Math.round(totalThisMonth * 100) / 100,
          totalPrevMonth: Math.round(totalPrevMonth * 100) / 100,
          changePercent,
          bySupplier,
          supplierCount: bySupplier.length,
          invoiceCount: Number(currMonthRes?.totalCount) || 0,
        }
      }, { totalThisMonth: 0, totalPrevMonth: 0, changePercent: 0, bySupplier: [], supplierCount: 0, invoiceCount: 0 }),

      // -------- FORNITORI CASH-FLOW (manual Fornitori module — source of truth) --------
      // Operator manually marks documents as paid via the Fornitori UI; this block
      // reflects what was ACTUALLY PAID (data_pagamento), not just invoiced. The
      // headline KPI cards (Costi, Margine, Utile Netto) use these figures.
      safe('fornitoriCashFlow', async () => {
        const todayISO = new Date().toISOString().slice(0, 10)
        const [paidCurrRes, paidPrevRes, outstandingRes, overdueRes, alertsRes, fornitoriRes] = await Promise.all([
          // 1. Paid this month — cash-flow figure
          supabase.from('fornitore_documents')
            .select('id, importo_totale, fornitore_id, data_pagamento')
            .gte('data_pagamento', monthStartISO)
            .lte('data_pagamento', monthEndISO + 'T23:59:59'),
          // 2. Paid previous month — for MoM
          supabase.from('fornitore_documents')
            .select('id, importo_totale')
            .gte('data_pagamento', prevMonthStartISO)
            .lte('data_pagamento', prevMonthEndISO + 'T23:59:59'),
          // 3. Outstanding (not paid yet, regardless of period)
          supabase.from('fornitore_documents')
            .select('id, importo_totale, data_scadenza, fornitore_id, stato')
            .not('stato', 'in', '(pagato,archiviato,bloccato)')
            .in('tipo', ['fattura']),
          // 4. Overdue (scadenza past + not paid)
          supabase.from('fornitore_documents')
            .select('id, importo_totale, data_scadenza, fornitore_id')
            .not('stato', 'in', '(pagato,archiviato,bloccato)')
            .lt('data_scadenza', todayISO)
            .in('tipo', ['fattura']),
          // 5. Open alerts
          supabase.from('fornitore_alerts')
            .select('id, severity', { count: 'exact', head: false })
            .eq('status', 'open'),
          // 6. Active fornitori (for nome / categoria lookup)
          supabase.from('fornitori')
            .select('id, nome, categoria_merce')
            .eq('attivo', true),
        ])

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const paidCurr: any[] = paidCurrRes.data || []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const paidPrev: any[] = paidPrevRes.data || []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const outstanding: any[] = outstandingRes.data || []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const overdue: any[] = overdueRes.data || []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fornitori: any[] = fornitoriRes.data || []

        const fornitoreIndex = new Map<string, { nome: string; categoria_merce: string | null }>()
        fornitori.forEach(f => fornitoreIndex.set(f.id, { nome: f.nome, categoria_merce: f.categoria_merce }))

        const pagatoMese = paidCurr.reduce((s, d) => s + (Number(d.importo_totale) || 0), 0)
        const pagatoMesePrev = paidPrev.reduce((s, d) => s + (Number(d.importo_totale) || 0), 0)
        const changePercent = pagatoMesePrev > 0
          ? Math.round(((pagatoMese - pagatoMesePrev) / pagatoMesePrev) * 100)
          : 0
        const daPagare = outstanding.reduce((s, d) => s + (Number(d.importo_totale) || 0), 0)
        const scaduto = overdue.reduce((s, d) => s + (Number(d.importo_totale) || 0), 0)

        // Top suppliers paid this month
        const supplierAgg = new Map<string, { nome: string; total: number; count: number }>()
        for (const d of paidCurr) {
          const f = fornitoreIndex.get(d.fornitore_id)
          const nome = f?.nome || 'Sconosciuto'
          const cur = supplierAgg.get(d.fornitore_id) || { nome, total: 0, count: 0 }
          cur.total += Number(d.importo_totale) || 0
          cur.count += 1
          supplierAgg.set(d.fornitore_id, cur)
        }
        const bySupplier = Array.from(supplierAgg.values())
          .map(s => ({ nome: s.nome, total: Math.round(s.total * 100) / 100, count: s.count }))
          .sort((a, b) => b.total - a.total)

        // Spend per category (paid this month)
        const categoriaAgg = new Map<string, number>()
        for (const d of paidCurr) {
          const f = fornitoreIndex.get(d.fornitore_id)
          const cat = f?.categoria_merce || 'altro'
          categoriaAgg.set(cat, (categoriaAgg.get(cat) || 0) + (Number(d.importo_totale) || 0))
        }
        const byCategoria = Array.from(categoriaAgg.entries())
          .map(([categoria, total]) => ({ categoria, total: Math.round(total * 100) / 100 }))
          .sort((a, b) => b.total - a.total)

        return {
          pagatoMese: Math.round(pagatoMese * 100) / 100,
          pagatoMesePrev: Math.round(pagatoMesePrev * 100) / 100,
          changePercent,
          daPagare: Math.round(daPagare * 100) / 100,
          daPagareCount: outstanding.length,
          scaduto: Math.round(scaduto * 100) / 100,
          scadutoCount: overdue.length,
          invoicePaidCount: paidCurr.length,
          activeFornitoriCount: fornitori.length,
          bySupplier,
          byCategoria,
          alertsOpen: alertsRes.count ?? 0,
        }
      }, {
        pagatoMese: 0, pagatoMesePrev: 0, changePercent: 0,
        daPagare: 0, daPagareCount: 0, scaduto: 0, scadutoCount: 0,
        invoicePaidCount: 0, activeFornitoriCount: 0,
        bySupplier: [] as Array<{ nome: string; total: number; count: number }>,
        byCategoria: [] as Array<{ categoria: string; total: number }>,
        alertsOpen: 0,
      }),
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fullResponse: any = {
      ...response,
      primeWash: primeWashSection,
      cauzioni: cauzioniSection,
      recensioni: recensioniSection,
      wallet: walletSection,
      referral: referralSection,
      dr7Club: dr7ClubSection,
      spese: speseSection,
      fornitoriCashFlow: fornitoriCashFlowSection,
    }

    return {
      statusCode: 200,
      body: JSON.stringify(fullResponse)
    }
  } catch (error: any) {
    console.error('Dashboard KPI error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    }
  }
}
