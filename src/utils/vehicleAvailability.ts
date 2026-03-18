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

// Configuration constants
const BUFFER_MINUTES = 75 // 30min gap + 45min wash
const BUSINESS_START_HOUR = 0  // Admin can book any time
const BUSINESS_END_HOUR = 24   // Admin can book any time
const TIME_SLOT_INTERVAL_MINUTES = 15

// Types
export interface Vehicle {
    id: string
    display_name: string
    plate: string | null
    targa?: string | null
    status: 'available' | 'rented' | 'maintenance' | 'retired'
    daily_rate: number
    category?: 'exotic' | 'urban' | 'aziendali'
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
    const bookingVehicleId = booking.vehicle_id || (booking as any).booking_details?.vehicle_id
    if (bookingVehicleId && bookingVehicleId === vehicle.id) {
        console.log(`[matchVehicleByPlate] MATCH by vehicle_id: ${bookingVehicleId} === ${vehicle.id}`)
        return true
    }

    // Then try plate matching - check both top-level and booking_details
    const bookingPlate = normalizePlate(booking.vehicle_plate || (booking as any).booking_details?.vehicle_plate)
    const vehiclePlate = normalizePlate(vehicle.plate || vehicle.targa)

    if (bookingPlate && vehiclePlate && bookingPlate === vehiclePlate) {
        console.log(`[matchVehicleByPlate] MATCH by plate: ${bookingPlate} === ${vehiclePlate}`)
        return true
    }

    // Debug: log when no match found
    if (booking.vehicle_plate || (booking as any).booking_details?.vehicle_plate) {
        console.log(`[matchVehicleByPlate] NO MATCH: booking plate=${bookingPlate}, vehicle plate=${vehiclePlate}, booking_id=${booking.id?.substring(0,8)}`)
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
        if (booking.status === 'cancelled') return false
        // Exclude pending Nexi Pay by Link bookings (awaiting payment)
        if (booking.payment_method === 'Nexi Pay by Link' && booking.payment_status === 'pending') return false
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
            const timeWithBuffer = new Date(bookingEnd.getTime() + BUFFER_MINUTES * 60 * 1000)

            if (timeWithBuffer > earliestTime) {
                earliestTime = timeWithBuffer
            }
        } else if (bookingEnd > earliestTime) {
            // Booking extends into or past the pickup date
            const timeWithBuffer = new Date(bookingEnd.getTime() + BUFFER_MINUTES * 60 * 1000)

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

    // Check vehicle status
    if (vehicle.status === 'retired' || vehicle.status === 'maintenance') {
        console.log(`[isVehicleAvailable] ❌ ${vehicle.display_name} (${vehiclePlate}) - STATUS: ${vehicle.status}`)
        return {
            available: false,
            reason: `Vehicle is marked as ${vehicle.status}`
        }
    }

    // Check for maintenance blocks
    if (isVehicleBlocked(vehicle, pickupDate, returnDate, pickupTime, returnTime)) {
        console.log(`[isVehicleAvailable] ❌ ${vehicle.display_name} (${vehiclePlate}) - MAINTENANCE BLOCK: ${vehicle.metadata?.unavailable_from} to ${vehicle.metadata?.unavailable_until}`)
        return {
            available: false,
            reason: 'Vehicle is blocked for maintenance during this period'
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
    console.log(`[AVAILABILITY CHECK] Starting filter for vehicle ${vehicle.display_name}, excludeBookingId:`, excludeBookingId)
    console.log(`[AVAILABILITY CHECK] Total bookings to check:`, existingBookings.length)

    const vehicleBookings = existingBookings.filter(booking => {
        // Skip the booking we're editing
        if (excludeBookingId && booking.id === excludeBookingId) {
            console.log('[AVAILABILITY CHECK] ⏭️ Skipping current booking being edited:', booking.id)
            return false
        }

        // Skip cancelled bookings
        if (booking.status === 'cancelled') return false
        // Skip pending Nexi Pay by Link bookings (awaiting payment)
        if (booking.payment_method === 'Nexi Pay by Link' && booking.payment_status === 'pending') return false

        // CRITICAL: Skip linked car wash bookings when extending a rental
        // Car wash bookings are automatically created/updated, so they shouldn't block extensions
        if (excludeBookingId && booking.service_type === 'car_wash') {
            console.log('[CAR WASH CHECK] Found car wash booking:', booking.id, 'customer:', booking.customer_name)
            // Find the booking being extended to check if this car wash is linked to it
            const editingBooking = existingBookings.find(b => b.id === excludeBookingId)
            console.log('[CAR WASH CHECK] Editing booking:', editingBooking?.id, 'customer:', editingBooking?.customer_name)

            // Check if this car wash is for the same vehicle (by plate or vehicle_id only, NEVER by name)
            const bPlate = normalizePlate(booking.vehicle_plate)
            const ePlate = normalizePlate(editingBooking?.vehicle_plate)
            const sameVehicle = (bPlate && ePlate && bPlate === ePlate) ||
                (booking.vehicle_id && editingBooking?.vehicle_id && booking.vehicle_id === editingBooking.vehicle_id)

            if (editingBooking && sameVehicle) {
                console.log('[CAR WASH CHECK] ✅ EXCLUDING car wash booking for same vehicle', booking.id)
                // This car wash is for the same vehicle being extended, skip it
                return false
            }
            console.log('[CAR WASH CHECK] ❌ NOT excluding car wash - different vehicle')
        }

        // CRITICAL: Only include bookings that can be matched to this vehicle by plate
        // This prevents phantom conflicts from old bookings without vehicle_id/plate
        return matchVehicleByPlate(booking, vehicle)
    })

    console.log(`[AVAILABILITY CHECK] After filtering: ${vehicleBookings.length} bookings to check for conflicts`)

    // Log ALL matched bookings for this vehicle to help debug
    if (vehicleBookings.length > 0) {
        console.log(`[AVAILABILITY CHECK] Bookings matched to ${vehicle.display_name} (${vehiclePlate}):`)
        vehicleBookings.forEach((b, i) => {
            console.log(`  ${i + 1}. ID: ${b.id?.substring(0, 8)} | ${new Date(b.pickup_date).toLocaleDateString('it-IT')} → ${new Date(b.dropoff_date).toLocaleDateString('it-IT')} | Customer: ${b.customer_name} | Status: ${b.status} | Plate: ${b.vehicle_plate || 'N/A'}`)
        })
    }

    // Check each matched booking for time conflicts
    for (const booking of vehicleBookings) {
        const bookingStart = new Date(booking.pickup_date)
        const bookingEnd = new Date(booking.dropoff_date)

        // Add buffer to booking end time
        const bookingEndWithBuffer = new Date(bookingEnd.getTime() + BUFFER_MINUTES * 60 * 1000)

        // Check for overlap: (requestStart < bookingEndWithBuffer) && (requestEnd > bookingStart)
        if (requestStart < bookingEndWithBuffer && requestEnd > bookingStart) {
            const earliestTime = getEarliestValidPickupTime(vehicle, pickupDate, returnDate, existingBookings, excludeBookingId)

            console.log(`[isVehicleAvailable] ❌ ${vehicle.display_name} (${vehiclePlate}) - BOOKING CONFLICT with booking ${booking.id?.substring(0,8)}:`, {
                bookingPeriod: `${bookingStart.toISOString()} → ${bookingEnd.toISOString()}`,
                requestedPeriod: `${requestStart.toISOString()} → ${requestEnd.toISOString()}`,
                customer: booking.customer_name,
                matchedBy: booking.vehicle_id === vehicle.id ? `vehicle_id: ${booking.vehicle_id}` :
                           `plate: ${booking.vehicle_plate || (booking as any).booking_details?.vehicle_plate}`,
                bookingStatus: booking.status,
                serviceType: booking.service_type || 'rental'
            })

            return {
                available: false,
                reason: `Vehicle is booked until ${bookingEnd.toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}. Earliest available: ${earliestTime ? earliestTime.toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }) : 'not today'}`,
                earliestTime: earliestTime || undefined
            }
        }
    }

    console.log(`[isVehicleAvailable] ✅ ${vehicle.display_name} (${vehiclePlate}) - AVAILABLE`)
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
