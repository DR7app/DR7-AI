/**
 * Vehicle Availability Engine
 * 
 * This module provides real-time availability checking for vehicles in the rental system.
 * All operations are performed in Europe/Rome timezone to ensure consistency.
 * 
 * CRITICAL RULES:
 * 1. All date/time operations use Europe/Rome timezone exclusively
 * 2. Vehicle matching is done ONLY by license plate (targa), never by model name
 * 3. Buffer rules (75 minutes = 30min gap + 45min wash) are strictly enforced
 * 4. Same-day returns are allowed only if valid pickup time exists after buffer
 * 5. Vehicle blocks (maintenance) are treated as hard unavailability
 */

import { createRomeDate, getRomeDateComponents } from './timezoneUtils'
import { logger } from '../utils/logger'
import { supabase } from '../supabaseClient'

// Configuration constants
//
// All 3 buffers below are hydrated once at module load from Centralina Pro
// (`centralina_pro_config.config.automations`). Operators change them in
// admin → Centralina Pro → Automazioni; takes effect after page refresh.
//
// 1) RENTAL_BUFFER_MINUTES: post-rental buffer (return → next pickup on
//    the SAME vehicle). Default 90 (include lavaggio automatico).
// 2) CROSS_VEHICLE_GAP_MINUTES: min gap between ANY two rental events
//    (pickup or return) on DIFFERENT vehicles — staff handover capacity.
//    Default 15.
// 3) PRE_PICKUP_CARWASH_BUFFER_MINUTES is read separately by ReservationsTab.
// 4) LATE_RETURN_GRACE_MINUTES is the cushion before pickup time on the
//    return day; if return is later than (pickup_time - grace), the
//    customer is billed for an extra day. Sito + admin.
let RENTAL_BUFFER_MINUTES = 90
let CROSS_VEHICLE_GAP_MINUTES = 15
let PRE_PICKUP_CARWASH_BUFFER_MINUTES = 90
let LATE_RETURN_GRACE_MINUTES = 90

;(async () => {
    try {
        const { data } = await supabase
            .from('centralina_pro_config')
            .select('config')
            .eq('id', 'main')
            .maybeSingle()
        const cfg = (data?.config ?? null) as Record<string, unknown> | null
        const automations = cfg?.automations as Record<string, unknown> | undefined
        if (automations) {
            const a = automations.rental_buffer_minutes
            if (typeof a === 'number' && a >= 0 && a <= 720) RENTAL_BUFFER_MINUTES = a
            const b = automations.cross_vehicle_gap_minutes
            if (typeof b === 'number' && b >= 0 && b <= 120) CROSS_VEHICLE_GAP_MINUTES = b
            const c = automations.pre_pickup_carwash_buffer_minutes
            if (typeof c === 'number' && c >= 0 && c <= 720) PRE_PICKUP_CARWASH_BUFFER_MINUTES = c
            const d = automations.late_return_grace_minutes
            if (typeof d === 'number' && d >= 0 && d <= 720) LATE_RETURN_GRACE_MINUTES = d
        }
    } catch (err) {
        // Keep defaults. Logged but non-blocking.
        logger.log('[vehicleAvailability] failed to load automations from Centralina Pro, using defaults:', err)
    }
})()

/** Read-only access for other modules. Reflect the latest hydrated values. */
export function getRentalBufferMinutes(): number { return RENTAL_BUFFER_MINUTES }
export function getCrossVehicleGapMinutes(): number { return CROSS_VEHICLE_GAP_MINUTES }
export function getPrePickupCarwashBufferMinutes(): number { return PRE_PICKUP_CARWASH_BUFFER_MINUTES }
export function getLateReturnGraceMinutes(): number { return LATE_RETURN_GRACE_MINUTES }
const BUSINESS_START_HOUR = 0  // Admin can book any time
const BUSINESS_END_HOUR = 24   // Admin can book any time
const TIME_SLOT_INTERVAL_MINUTES = 15

// Test plates: bookings on these vehicles are ignored everywhere availability is computed
// (same-vehicle slot blocking AND cross-vehicle handover gap).
const TEST_PLATES = new Set(['TEST000', 'TEST002'])

function isTestBooking(booking: Booking): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = booking.vehicle_plate || (booking as any).booking_details?.vehicle_plate
    if (!raw) return false
    return TEST_PLATES.has(raw.replace(/\s+/g, '').toUpperCase())
}

// Types
export interface Vehicle {
    id: string
    display_name: string
    plate: string | null
    targa?: string | null
    status: 'available' | 'rented' | 'maintenance' | 'retired'
    daily_rate: number
    category?: 'exotic' | 'urban' | 'aziendali'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: Record<string, any> | null
    created_at: string
    updated_at: string
}

export interface Booking {
    id: string
    vehicle_id?: string | null
    vehicle_plate?: string | null
    vehicle_name?: string
    customer_name?: string | null
    pickup_date: string
    dropoff_date: string
    status: string
    service_type?: string
    payment_method?: string | null
    payment_status?: string | null
}

export interface AvailabilityResult {
    available: boolean
    reason?: string
    earliestTime?: Date
}

/**
 * Normalize plate string for comparison (remove spaces, uppercase)
 */
function normalizePlate(plate: string | null | undefined): string {
    if (!plate) return ''
    return plate.replace(/\s+/g, '').toUpperCase()
}

/**
 * Match vehicle by license plate ONLY
 * Never falls back to model name matching
 */
export function matchVehicleByPlate(booking: Booking, vehicle: Vehicle): boolean {
    // First try vehicle_id (most reliable) - check both top-level and booking_details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bookingVehicleId = booking.vehicle_id || (booking as any).booking_details?.vehicle_id
    if (bookingVehicleId && bookingVehicleId === vehicle.id) {
        logger.log(`[matchVehicleByPlate] MATCH by vehicle_id: ${bookingVehicleId} === ${vehicle.id}`)
        return true
    }

    // Then try plate matching - check both top-level and booking_details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bookingPlate = normalizePlate(booking.vehicle_plate || (booking as any).booking_details?.vehicle_plate)
    const vehiclePlate = normalizePlate(vehicle.plate || vehicle.targa)

    if (bookingPlate && vehiclePlate && bookingPlate === vehiclePlate) {
        logger.log(`[matchVehicleByPlate] MATCH by plate: ${bookingPlate} === ${vehiclePlate}`)
        return true
    }

    // Debug: log when no match found
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (booking.vehicle_plate || (booking as any).booking_details?.vehicle_plate) {
        logger.log(`[matchVehicleByPlate] NO MATCH: booking plate=${bookingPlate}, vehicle plate=${vehiclePlate}, booking_id=${booking.id?.substring(0,8)}`)
    }

    // NO fallback to name matching - this is forbidden
    return false
}

/**
 * Check if a vehicle has a maintenance block for the given date range
 */
function isVehicleBlocked(
    vehicle: Vehicle,
    pickupDate: string,
    returnDate: string,
    pickupTime: string,
    returnTime: string
): boolean {
    if (!vehicle.metadata) return false

    const unavailableFrom = vehicle.metadata.unavailable_from
    const unavailableUntil = vehicle.metadata.unavailable_until
    const unavailableFromTime = vehicle.metadata.unavailable_from_time || '00:00'
    const unavailableUntilTime = vehicle.metadata.unavailable_until_time || '23:59'

    if (!unavailableFrom || !unavailableUntil) return false

    // Parse block period in Rome timezone
    const [fromHour, fromMin] = unavailableFromTime.split(':').map(Number)
    const [untilHour, untilMin] = unavailableUntilTime.split(':').map(Number)

    const blockFromComponents = getRomeDateComponents(unavailableFrom)
    const blockUntilComponents = getRomeDateComponents(unavailableUntil)

    const blockStart = createRomeDate(
        blockFromComponents.year,
        blockFromComponents.month,
        blockFromComponents.day,
        fromHour || 0,
        fromMin || 0
    )

    const blockEnd = createRomeDate(
        blockUntilComponents.year,
        blockUntilComponents.month,
        blockUntilComponents.day,
        untilHour || 23,
        untilMin || 59
    )

    // Parse requested period in Rome timezone
    const [pickupHour, pickupMin] = pickupTime.split(':').map(Number)
    const [returnHour, returnMin] = returnTime.split(':').map(Number)

    const pickupComponents = getRomeDateComponents(pickupDate)
    const returnComponents = getRomeDateComponents(returnDate)

    const requestStart = createRomeDate(
        pickupComponents.year,
        pickupComponents.month,
        pickupComponents.day,
        pickupHour,
        pickupMin
    )

    const requestEnd = createRomeDate(
        returnComponents.year,
        returnComponents.month,
        returnComponents.day,
        returnHour,
        returnMin
    )

    // Check for overlap: (requestStart < blockEnd) && (requestEnd > blockStart)
    return requestStart < blockEnd && requestEnd > blockStart
}

/**
 * Get the earliest valid pickup time for a vehicle on a specific date
 * considering existing bookings and buffer rules
 */
export function getEarliestValidPickupTime(
    vehicle: Vehicle,
    pickupDate: string,
    _returnDate: string,
    existingBookings: Booking[],
    excludeBookingId?: string
): Date | null {
    // Parse pickup date in Rome timezone
    const pickupComponents = getRomeDateComponents(pickupDate)

    // Start with business opening time
    let earliestTime = createRomeDate(
        pickupComponents.year,
        pickupComponents.month,
        pickupComponents.day,
        BUSINESS_START_HOUR,
        0
    )

    // Filter bookings for this vehicle
    const vehicleBookings = existingBookings.filter(booking => {
        if (excludeBookingId && booking.id === excludeBookingId) return false
        // Exclude cancelled and expired bookings — they don't block slots
        if (booking.status === 'cancelled' || booking.status === 'expired') return false
        // Exclude expired pending_payment bookings (payment link timed out)
        if (booking.status === 'pending_payment' && booking.payment_status === 'expired') return false
        // Test bookings (TEST000/TEST002) never block real availability
        if (isTestBooking(booking)) return false
        // Pending Nexi Pay by Link bookings BLOCK the slot for 1 hour while awaiting payment
        return matchVehicleByPlate(booking, vehicle)
    })

    // Find the latest conflicting booking that ends on or before the pickup date
    for (const booking of vehicleBookings) {
        const bookingEnd = new Date(booking.dropoff_date)
        const bookingEndComponents = getRomeDateComponents(booking.dropoff_date)

        // Check if booking ends on the same day as pickup or before
        const bookingEndDate = createRomeDate(
            bookingEndComponents.year,
            bookingEndComponents.month,
            bookingEndComponents.day,
            0,
            0
        )

        const pickupDateOnly = createRomeDate(
            pickupComponents.year,
            pickupComponents.month,
            pickupComponents.day,
            0,
            0
        )

        if (bookingEndDate.getTime() === pickupDateOnly.getTime()) {
            // Booking ends on the same day - add buffer
            // Tronca a precisione di minuto: il buffer e' definito in minuti,
            // ms/secondi nel dropoff stored non devono spostare l'earliest.
            const bufferMs = bookingEnd.getTime() + RENTAL_BUFFER_MINUTES * 60 * 1000
            const truncatedMs = Math.floor(bufferMs / 60000) * 60000
            const timeWithBuffer = new Date(truncatedMs)

            if (timeWithBuffer > earliestTime) {
                earliestTime = timeWithBuffer
            }
        } else if (bookingEnd > earliestTime) {
            // Booking extends into or past the pickup date
            // Tronca a precisione di minuto: il buffer e' definito in minuti,
            // ms/secondi nel dropoff stored non devono spostare l'earliest.
            const bufferMs = bookingEnd.getTime() + RENTAL_BUFFER_MINUTES * 60 * 1000
            const truncatedMs = Math.floor(bufferMs / 60000) * 60000
            const timeWithBuffer = new Date(truncatedMs)

            if (timeWithBuffer > earliestTime) {
                earliestTime = timeWithBuffer
            }
        }
    }

    // Check if earliest time is still within business hours
    const earliestComponents = getRomeDateComponents(earliestTime.toISOString())

    if (earliestComponents.hour >= BUSINESS_END_HOUR) {
        // Too late in the day - no valid pickup time
        return null
    }

    return earliestTime
}

/**
 * Check if a vehicle is available for a specific date/time range
 */
export function isVehicleAvailable(
    vehicle: Vehicle,
    pickupDate: string,
    returnDate: string,
    pickupTime: string,
    returnTime: string,
    existingBookings: Booking[],
    excludeBookingId?: string
): AvailabilityResult {
    const vehiclePlate = vehicle.plate || vehicle.targa || ''
    // Build a human-friendly vehicle label so OTP emails show what's being
    // overridden without the operator having to look it up. Also surface the
    // requested rental window so the recipient can verify the slot at a
    // glance.
    const vehicleLabel = vehicle.display_name
        ? `${vehicle.display_name}${vehiclePlate ? ` (${vehiclePlate})` : ''}`
        : vehiclePlate || 'Veicolo'
    const requestWindow = `dal ${pickupDate} ${pickupTime} al ${returnDate} ${returnTime}`
    const statusLabelIt: Record<string, string> = {
        retired: 'ritirato dal servizio',
        maintenance: 'in manutenzione',
        unavailable: 'non disponibile',
        rented: 'noleggiato',
    }

    // Check vehicle status
    if (vehicle.status === 'retired' || vehicle.status === 'maintenance') {
        const statusIt = statusLabelIt[vehicle.status] || vehicle.status
        return {
            available: false,
            reason: `Veicolo ${vehicleLabel} risulta ${statusIt}. Periodo richiesto: ${requestWindow}.`
        }
    }

    // Check for maintenance blocks
    if (isVehicleBlocked(vehicle, pickupDate, returnDate, pickupTime, returnTime)) {
        return {
            available: false,
            reason: `Veicolo ${vehicleLabel} bloccato per manutenzione nel periodo richiesto (${requestWindow}).`
        }
    }

    // Parse requested period in Rome timezone
    const [pickupHour, pickupMin] = pickupTime.split(':').map(Number)
    const [returnHour, returnMin] = returnTime.split(':').map(Number)

    const pickupComponents = getRomeDateComponents(pickupDate)
    const returnComponents = getRomeDateComponents(returnDate)

    const requestStart = createRomeDate(
        pickupComponents.year,
        pickupComponents.month,
        pickupComponents.day,
        pickupHour,
        pickupMin
    )

    const requestEnd = createRomeDate(
        returnComponents.year,
        returnComponents.month,
        returnComponents.day,
        returnHour,
        returnMin
    )


    // Check for booking conflicts
    // CRITICAL: Only check bookings that can be definitively matched to this specific vehicle
    logger.log(`[AVAILABILITY CHECK] Starting filter for vehicle ${vehicle.display_name}, excludeBookingId:`, excludeBookingId)
    logger.log(`[AVAILABILITY CHECK] Total bookings to check:`, existingBookings.length)

    const vehicleBookings = existingBookings.filter(booking => {
        // Skip the booking we're editing
        if (excludeBookingId && booking.id === excludeBookingId) {
            return false
        }

        // Skip cancelled and expired bookings
        if (booking.status === 'cancelled' || booking.status === 'expired') return false
        // Skip pending_payment bookings whose payment has expired (slot should be released)
        if (booking.status === 'pending_payment' && booking.payment_status === 'expired') return false
        // Test bookings (TEST000/TEST002) never block real availability
        if (isTestBooking(booking)) return false

        // CRITICAL: Skip linked car wash bookings when extending a rental
        // Car wash bookings are automatically created/updated, so they shouldn't block extensions
        if (excludeBookingId && booking.service_type === 'car_wash') {
            logger.log('[CAR WASH CHECK] Found car wash booking:', booking.id, 'customer:', booking.customer_name)
            // Find the booking being extended to check if this car wash is linked to it
            const editingBooking = existingBookings.find(b => b.id === excludeBookingId)
            logger.log('[CAR WASH CHECK] Editing booking:', editingBooking?.id, 'customer:', editingBooking?.customer_name)

            // Check if this car wash is for the same vehicle (by plate or vehicle_id only, NEVER by name)
            const bPlate = normalizePlate(booking.vehicle_plate)
            const ePlate = normalizePlate(editingBooking?.vehicle_plate)
            const sameVehicle = (bPlate && ePlate && bPlate === ePlate) ||
                (booking.vehicle_id && editingBooking?.vehicle_id && booking.vehicle_id === editingBooking.vehicle_id)

            if (editingBooking && sameVehicle) {
                // This car wash is for the same vehicle being extended, skip it
                return false
            }
        }

        // CRITICAL: Only include bookings that can be matched to this vehicle by plate
        // This prevents phantom conflicts from old bookings without vehicle_id/plate
        return matchVehicleByPlate(booking, vehicle)
    })

    logger.log(`[AVAILABILITY CHECK] After filtering: ${vehicleBookings.length} bookings to check for conflicts`)

    // Log ALL matched bookings for this vehicle to help debug
    if (vehicleBookings.length > 0) {
        logger.log(`[AVAILABILITY CHECK] Bookings matched to ${vehicle.display_name} (${vehiclePlate}):`)
        vehicleBookings.forEach((b, i) => {
            logger.log(`  ${i + 1}. ID: ${b.id?.substring(0, 8)} | ${new Date(b.pickup_date).toLocaleDateString('it-IT')} → ${new Date(b.dropoff_date).toLocaleDateString('it-IT')} | Customer: ${b.customer_name} | Status: ${b.status} | Plate: ${b.vehicle_plate || 'N/A'}`)
        })
    }

    // Check each matched booking for time conflicts
    for (const booking of vehicleBookings) {
        const bookingStart = new Date(booking.pickup_date)
        const bookingEnd = new Date(booking.dropoff_date)

        // Add buffer to booking end time
        const bookingEndWithBuffer = new Date(bookingEnd.getTime() + RENTAL_BUFFER_MINUTES * 60 * 1000)

        // Compara a precisione di MINUTO per evitare falsi conflitti quando
        // la dropoff stored in DB ha secondi (es. 15:00:30) e l'utente
        // sceglie un time slot a precisione minuto (16:30:00). La differenza
        // di 30s non e' un conflitto reale: il buffer e' espresso in minuti.
        const toMinute = (d: Date) => Math.floor(d.getTime() / 60000)
        const reqStartMin = toMinute(requestStart)
        const reqEndMin = toMinute(requestEnd)
        const bufferEndMin = toMinute(bookingEndWithBuffer)
        const bookingStartMin = toMinute(bookingStart)

        // Check for overlap: (requestStart < bookingEndWithBuffer) && (requestEnd > bookingStart)
        if (reqStartMin < bufferEndMin && reqEndMin > bookingStartMin) {
            const earliestTime = getEarliestValidPickupTime(vehicle, pickupDate, returnDate, existingBookings, excludeBookingId)
            // Conflicting booking — surface the customer + start/end so the
            // OTP recipient can verify the override without opening the calendar.
            const conflictingCustomer = booking.customer_name
                ? ` (cliente: ${booking.customer_name})`
                : ''
            const fmtDt = (d: Date) => d.toLocaleString('it-IT', {
                timeZone: 'Europe/Rome',
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
            })
            const fmtTime = (d: Date) => d.toLocaleString('it-IT', {
                timeZone: 'Europe/Rome',
                hour: '2-digit', minute: '2-digit',
            })
            const earliest = earliestTime
                ? fmtTime(earliestTime)
                : 'non disponibile in giornata'
            return {
                available: false,
                reason: `Veicolo ${vehicleLabel} prenotato${conflictingCustomer} dal ${fmtDt(bookingStart)} al ${fmtDt(bookingEnd)}. Periodo richiesto: ${requestWindow}. Prima disponibilità utile: ${earliest}.`,
                earliestTime: earliestTime || undefined
            }
        }
    }

    // Cross-vehicle handover gap: any pickup or return on a DIFFERENT rental
    // must be at least 15 minutes apart from our pickup and our return.
    // Same-car buffer above stays untouched (75 min).
    const crossGapMs = CROSS_VEHICLE_GAP_MINUTES * 60 * 1000
    logger.log(`[CROSS-GAP] Scanning ${existingBookings.length} bookings for cross-vehicle conflicts. My pickup=${requestStart.toISOString()}, my dropoff=${requestEnd.toISOString()}, target vehicle=${vehicle.display_name} (${vehiclePlate})`)
    for (const booking of existingBookings) {
        if (excludeBookingId && booking.id === excludeBookingId) continue
        if (booking.status === 'cancelled' || booking.status === 'annullata') continue
        if (booking.status === 'completed' || booking.status === 'completata') continue
        if (booking.status === 'expired') continue
        if (booking.status === 'pending_payment' && booking.payment_status === 'expired') continue
        // Test bookings (TEST000/TEST002) never block real availability
        if (isTestBooking(booking)) continue
        // Only rental bookings consume handover staff. Car wash / mechanical are appointments.
        if (booking.service_type && booking.service_type !== 'car_rental') continue
        // Same-vehicle conflicts are already covered above with the 75-min buffer.
        if (matchVehicleByPlate(booking, vehicle)) continue

        const otherPickup = new Date(booking.pickup_date).getTime()
        const otherDropoff = new Date(booking.dropoff_date).getTime()
        const myPickup = requestStart.getTime()
        const myDropoff = requestEnd.getTime()

        const pairs: Array<[string, number, string, number]> = [
            ['Ritiro', myPickup, 'ritiro', otherPickup],
            ['Ritiro', myPickup, 'riconsegna', otherDropoff],
            ['Riconsegna', myDropoff, 'ritiro', otherPickup],
            ['Riconsegna', myDropoff, 'riconsegna', otherDropoff],
        ]

        logger.log(`[CROSS-GAP] Other booking id=${booking.id?.substring(0,8)} plate=${booking.vehicle_plate} pickup=${new Date(otherPickup).toISOString()} dropoff=${new Date(otherDropoff).toISOString()}`)

        for (const [myLabel, myTime, otherLabel, otherTime] of pairs) {
            const diffMs = Math.abs(myTime - otherTime)
            const diffMin = diffMs / 60000
            logger.log(`[CROSS-GAP]   ${myLabel} vs ${otherLabel}: ${diffMin.toFixed(1)} min`)
            // Diff esattamente 0 = stesso slot (es. due ritiri programmati alle
            // 10:30): DR7 gestisce questi in batch nello stesso slot, NON e'
            // un conflitto. Il gap di 15 min serve solo per evitare che due
            // operazioni accadano A 1-14 minuti di distanza, dove lo staff
            // non riuscirebbe a coprirle entrambe.
            if (diffMs > 0 && diffMs < crossGapMs) {
                const otherTimeFmt = new Date(otherTime).toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
                const plateInfo = booking.vehicle_plate || booking.vehicle_name || 'altro veicolo'
                logger.log(`[CROSS-GAP] CONFLICT: ${myLabel} within ${CROSS_VEHICLE_GAP_MINUTES} min of ${otherLabel} (${diffMin.toFixed(1)} min), booking ${booking.id?.substring(0,8)}`)
                return {
                    available: false,
                    reason: `${myLabel} a meno di ${CROSS_VEHICLE_GAP_MINUTES} minuti dalla ${otherLabel} di ${plateInfo} (${otherTimeFmt}). Serve almeno ${CROSS_VEHICLE_GAP_MINUTES} minuti tra due operazioni su auto diverse.`
                }
            }
        }
    }

    return { available: true }
}

/**
 * Generate valid time slots for a vehicle on a specific date
 * Returns array of "HH:MM" strings representing valid pickup times
 */
export function generateValidTimeSlots(
    vehicle: Vehicle,
    pickupDate: string,
    returnDate: string,
    existingBookings: Booking[],
    excludeBookingId?: string
): string[] {
    const validSlots: string[] = []

    // Get earliest valid time
    const earliestTime = getEarliestValidPickupTime(vehicle, pickupDate, returnDate, existingBookings, excludeBookingId)

    if (!earliestTime) {
        // No valid time on this day
        return []
    }

    const earliestComponents = getRomeDateComponents(earliestTime.toISOString())

    // Round up to next 15-minute interval
    let startMinute = Math.ceil(earliestComponents.minute / TIME_SLOT_INTERVAL_MINUTES) * TIME_SLOT_INTERVAL_MINUTES
    let startHour = earliestComponents.hour

    if (startMinute >= 60) {
        startMinute = 0
        startHour += 1
    }

    // Generate slots from earliest time to business end
    for (let hour = startHour; hour < BUSINESS_END_HOUR; hour++) {
        const minuteStart = (hour === startHour) ? startMinute : 0

        for (let minute = minuteStart; minute < 60; minute += TIME_SLOT_INTERVAL_MINUTES) {
            const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`

            // Validate this specific time slot
            const result = isVehicleAvailable(
                vehicle,
                pickupDate,
                returnDate,
                timeStr,
                '23:59', // Use end of day for validation
                existingBookings,
                excludeBookingId
            )

            if (result.available) {
                validSlots.push(timeStr)
            }
        }
    }

    return validSlots
}

/**
 * Get all available vehicles for a specific date/time range
 */
export function getAvailableVehicles(
    allVehicles: Vehicle[],
    pickupDate: string,
    returnDate: string,
    pickupTime: string,
    returnTime: string,
    existingBookings: Booking[],
    excludeBookingId?: string
): Vehicle[] {
    if (!pickupDate || !returnDate) {
        // No dates selected - show all vehicles
        return allVehicles
    }

    return allVehicles.filter(vehicle => {
        const result = isVehicleAvailable(
            vehicle,
            pickupDate,
            returnDate,
            pickupTime,
            returnTime,
            existingBookings,
            excludeBookingId
        )

        return result.available
    })
}
