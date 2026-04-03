import { supabase } from '../supabaseClient'

/**
 * SCHEDULING RULES ENFORCEMENT
 * 
 * This module enforces non-negotiable scheduling rules for three event types:
 * - DEPARTURE (pickup_date): When a customer picks up a vehicle
 * - RETURN (dropoff_date): When a customer returns a vehicle  
 * - WASH (car wash bookings): When a vehicle undergoes washing (lavaggio)
 * 
 * RULES:
 * 1. Same-time events are FORBIDDEN
 *    - RETURN + RETURN → forbidden
 *    - DEPARTURE + DEPARTURE → forbidden
 *    - RETURN + DEPARTURE → forbidden
 *    - Minimum 15-minute gap required between these events
 * 
 * 2. RETURN and WASH
 *    - RETURN + WASH at same time → forbidden
 *    - Minimum 30-minute gap ALWAYS required, regardless of order
 * 
 * 3. DEPARTURE and WASH
 *    - DEPARTURE + WASH at same time → forbidden
 *    - Minimum 15-minute gap required, regardless of order
 * 
 * 4. RETURN and WASH must NEVER be simultaneous
 *    - No exceptions
 *    - Always separated by mandatory gaps
 */

export type EventType = 'RETURN' | 'DEPARTURE' | 'WASH'

export interface SchedulingEvent {
    id?: string
    type: EventType
    dateTime: Date
    vehicleId?: string
    vehicleName?: string
    vehiclePlate?: string
    durationMinutes?: number
}

export interface ValidationError {
    code: string
    message: string
    conflictingEvent?: SchedulingEvent
    requiredGapMinutes?: number
}

export interface ValidationResult {
    isValid: boolean
    errors: ValidationError[]
    suggestedSlots?: Date[]
}

/**
 * Get the required gap in minutes between two event types
 */
export function getRequiredGap(eventType1: EventType, eventType2: EventType): number {
    // RETURN ↔ WASH: 30 minutes (always, regardless of order)
    if ((eventType1 === 'RETURN' && eventType2 === 'WASH') ||
        (eventType1 === 'WASH' && eventType2 === 'RETURN')) {
        return 30
    }

    // DEPARTURE ↔ WASH: 15 minutes (regardless of order)
    if ((eventType1 === 'DEPARTURE' && eventType2 === 'WASH') ||
        (eventType1 === 'WASH' && eventType2 === 'DEPARTURE')) {
        return 15
    }

    // RETURN ↔ DEPARTURE: 15 minutes
    if ((eventType1 === 'RETURN' && eventType2 === 'DEPARTURE') ||
        (eventType1 === 'DEPARTURE' && eventType2 === 'RETURN')) {
        return 15
    }

    // RETURN ↔ RETURN: 15 minutes
    if (eventType1 === 'RETURN' && eventType2 === 'RETURN') {
        return 15
    }

    // DEPARTURE ↔ DEPARTURE: 15 minutes
    if (eventType1 === 'DEPARTURE' && eventType2 === 'DEPARTURE') {
        return 15
    }

    // Default: 15 minutes for any other combination
    return 15
}

/**
 * Check if two events violate the minimum gap requirement
 * Returns true if there is a violation (events are too close)
 */
export function checkGapViolation(
    event1: SchedulingEvent,
    event2: SchedulingEvent
): boolean {
    const requiredGapMs = getRequiredGap(event1.type, event2.type) * 60 * 1000

    const time1 = event1.dateTime.getTime()
    const time2 = event2.dateTime.getTime()

    // Calculate the actual gap between events
    const actualGapMs = Math.abs(time2 - time1)

    // Violation if actual gap is less than required gap
    return actualGapMs < requiredGapMs
}

/**
 * Check if two events are at exactly the same time
 */
export function isSameTime(date1: Date, date2: Date): boolean {
    return date1.getTime() === date2.getTime()
}

/**
 * Fetch all DEPARTURE events (pickups) for a given date range
 */
async function fetchDepartureEvents(
    startDate: Date,
    endDate: Date,
    excludeBookingId?: string
): Promise<SchedulingEvent[]> {
    const { data: bookings, error } = await supabase
        .from('bookings')
        .select('id, pickup_date, vehicle_id, vehicle_name, vehicle_plate')
        .neq('status', 'cancelled')
        .gte('pickup_date', startDate.toISOString())
        .lte('pickup_date', endDate.toISOString())
        .neq('service_type', 'car_wash')
        .neq('service_type', 'mechanical_service')

    if (error) {
        console.error('Error fetching departure events:', error)
        return []
    }

    return (bookings || [])
        .filter(b => !excludeBookingId || b.id !== excludeBookingId)
        .map(b => ({
            id: b.id,
            type: 'DEPARTURE' as EventType,
            dateTime: new Date(b.pickup_date),
            vehicleId: b.vehicle_id || undefined,
            vehicleName: b.vehicle_name,
            vehiclePlate: b.vehicle_plate || undefined
        }))
}

/**
 * Fetch all RETURN events (dropoffs) for a given date range
 */
async function fetchReturnEvents(
    startDate: Date,
    endDate: Date,
    excludeBookingId?: string
): Promise<SchedulingEvent[]> {
    const { data: bookings, error } = await supabase
        .from('bookings')
        .select('id, dropoff_date, vehicle_id, vehicle_name, vehicle_plate')
        .neq('status', 'cancelled')
        .gte('dropoff_date', startDate.toISOString())
        .lte('dropoff_date', endDate.toISOString())
        .neq('service_type', 'car_wash')
        .neq('service_type', 'mechanical_service')

    if (error) {
        console.error('Error fetching return events:', error)
        return []
    }

    return (bookings || [])
        .filter(b => !excludeBookingId || b.id !== excludeBookingId)
        .map(b => ({
            id: b.id,
            type: 'RETURN' as EventType,
            dateTime: new Date(b.dropoff_date),
            vehicleId: b.vehicle_id || undefined,
            vehicleName: b.vehicle_name,
            vehiclePlate: b.vehicle_plate || undefined
        }))
}

/**
 * Fetch all WASH events for a given date range
 */
async function fetchWashEvents(
    startDate: Date,
    endDate: Date,
    excludeBookingId?: string
): Promise<SchedulingEvent[]> {
    const { data: bookings, error } = await supabase
        .from('bookings')
        .select('id, appointment_date, appointment_time, pickup_date, dropoff_date, vehicle_name, vehicle_plate, service_name, customer_name, booking_details')
        .eq('service_type', 'car_wash')
        .neq('status', 'cancelled')
        .gte('appointment_date', startDate.toISOString().split('T')[0])
        .lte('appointment_date', endDate.toISOString().split('T')[0])

    if (error) {
        console.error('Error fetching wash events:', error)
        return []
    }

    return (bookings || [])
        .filter(b => {
            if (excludeBookingId && b.id === excludeBookingId) return false
            // Exclude "Lavaggio Rientro" — internal return washes don't block external car wash slots
            if (b.customer_name === 'Lavaggio Rientro' || b.booking_details?.auto_created) return false
            return true
        })
        .map(b => {
            // Use pickup_date if available, otherwise construct from appointment_date + appointment_time
            let washDateTime: Date
            if (b.pickup_date) {
                washDateTime = new Date(b.pickup_date)
            } else if (b.appointment_date && b.appointment_time) {
                const dateStr = b.appointment_date.split('T')[0]
                washDateTime = new Date(`${dateStr}T${b.appointment_time}:00`)
            } else {
                washDateTime = new Date(b.appointment_date)
            }

            // Prefer totalDuration from booking_details, fallback to name-based lookup
            const durationMinutes = b.booking_details?.totalDuration || getWashDuration(b.service_name)

            return {
                id: b.id,
                type: 'WASH' as EventType,
                dateTime: washDateTime,
                vehicleName: b.vehicle_name,
                vehiclePlate: b.vehicle_plate || undefined,
                durationMinutes
            }
        })
}

/**
 * Get wash duration in minutes based on service name
 */
function getWashDuration(serviceName: string): number {
    const durations: Record<string, number> = {
        'Lavaggio Completo': 45,
        'Lavaggio Esterno': 30,
        'Lavaggio Interno': 30,
        'Lavaggio Premium': 90,
        'Lavaggio DR7 Luxury': 150,
        // New services added Jan 2026
        'Lavaggio Scooter': 15,
        'Lavaggio Solo Esterno': 15,
        'Lavaggio Solo Interno': 30
    }
    return durations[serviceName] || 45
}

/**
 * Fetch all events (DEPARTURE, RETURN, WASH) for a given date range
 */
async function fetchAllEvents(
    startDate: Date,
    endDate: Date,
    excludeBookingId?: string
): Promise<SchedulingEvent[]> {
    const [departures, returns, washes] = await Promise.all([
        fetchDepartureEvents(startDate, endDate, excludeBookingId),
        fetchReturnEvents(startDate, endDate, excludeBookingId),
        fetchWashEvents(startDate, endDate, excludeBookingId)
    ])

    return [...departures, ...returns, ...washes]
}

/**
 * Validate a scheduling event against all existing events
 * 
 * @param event - The event to validate
 * @param excludeBookingId - Optional booking ID to exclude (for editing existing bookings)
 * @returns ValidationResult with errors and suggested slots if invalid
 */
export async function validateScheduling(
    event: SchedulingEvent,
    excludeBookingId?: string
): Promise<ValidationResult> {
    const errors: ValidationError[] = []

    // Fetch events in a reasonable time window (±12 hours from the event)
    const startDate = new Date(event.dateTime.getTime() - 12 * 60 * 60 * 1000)
    const endDate = new Date(event.dateTime.getTime() + 12 * 60 * 60 * 1000)

    const existingEvents = await fetchAllEvents(startDate, endDate, excludeBookingId)

    // Check against each existing event
    for (const existingEvent of existingEvents) {
        // Skip if different vehicle (events on different vehicles don't conflict)
        // Check vehicleId first
        if (event.vehicleId && existingEvent.vehicleId &&
            event.vehicleId !== existingEvent.vehicleId) {
            continue
        }

        // Car wash events without vehicleId should only conflict with other WASH events,
        // not with rental DEPARTURE/RETURN events for unrelated vehicles
        const isWashWithoutVehicle = (e: SchedulingEvent) =>
            e.type === 'WASH' && !e.vehicleId

        if (isWashWithoutVehicle(event) && existingEvent.type !== 'WASH') {
            continue
        }
        if (isWashWithoutVehicle(existingEvent) && event.type !== 'WASH') {
            continue
        }


        // If vehicleId is not available, try matching by license plate (targa)
        // This is the most reliable way to match vehicles for car wash events
        if ((!event.vehicleId || !existingEvent.vehicleId) &&
            event.vehiclePlate && existingEvent.vehiclePlate) {
            // Normalize plates for comparison (remove spaces, uppercase)
            const normalizePlate = (plate: string) =>
                plate.trim().toUpperCase().replace(/\s+/g, '')

            const eventPlate = normalizePlate(event.vehiclePlate)
            const existingPlate = normalizePlate(existingEvent.vehiclePlate)

            // Skip if different vehicles (by plate)
            if (eventPlate !== existingPlate) {
                continue
            }
        }

        // If neither vehicleId nor plate available, try matching by vehicle name
        // This handles edge cases where plate might not be set
        if ((!event.vehicleId || !existingEvent.vehicleId) &&
            !event.vehiclePlate && !existingEvent.vehiclePlate &&
            event.vehicleName && existingEvent.vehicleName) {
            // Normalize vehicle names for comparison (trim, lowercase, remove extra spaces)
            const normalizeVehicleName = (name: string) =>
                name.trim().toLowerCase().replace(/\s+/g, ' ')

            const eventVehicle = normalizeVehicleName(event.vehicleName)
            const existingVehicle = normalizeVehicleName(existingEvent.vehicleName)

            // Skip if different vehicles (by name)
            if (eventVehicle !== existingVehicle) {
                continue
            }
        }


        // Check for same-time violation
        if (isSameTime(event.dateTime, existingEvent.dateTime)) {
            errors.push({
                code: 'SAME_TIME_FORBIDDEN',
                message: `${event.type} and ${existingEvent.type} cannot occur at the same time. ` +
                    `Conflicting event: ${existingEvent.vehicleName || 'Unknown vehicle'} at ` +
                    `${existingEvent.dateTime.toLocaleString('it-IT')}`,
                conflictingEvent: existingEvent,
                requiredGapMinutes: getRequiredGap(event.type, existingEvent.type)
            })
            continue
        }

        // Check for gap violation
        if (checkGapViolation(event, existingEvent)) {
            const requiredGap = getRequiredGap(event.type, existingEvent.type)
            errors.push({
                code: 'INSUFFICIENT_GAP',
                message: `Minimum ${requiredGap}-minute gap required between ${event.type} and ${existingEvent.type}. ` +
                    `Conflicting event: ${existingEvent.vehicleName || 'Unknown vehicle'} at ` +
                    `${existingEvent.dateTime.toLocaleString('it-IT', {
                        hour: '2-digit',
                        minute: '2-digit',
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                    })}`,
                conflictingEvent: existingEvent,
                requiredGapMinutes: requiredGap
            })
        }
    }

    // If there are errors, find suggested slots
    let suggestedSlots: Date[] | undefined
    if (errors.length > 0) {
        suggestedSlots = await findNextAvailableSlots(event, excludeBookingId, 5)
    }

    return {
        isValid: errors.length === 0,
        errors,
        suggestedSlots
    }
}

/**
 * Find the next available time slots for an event
 * 
 * @param event - The event to find slots for
 * @param excludeBookingId - Optional booking ID to exclude
 * @param maxResults - Maximum number of suggested slots to return
 * @returns Array of suggested Date objects
 */
export async function findNextAvailableSlots(
    event: SchedulingEvent,
    excludeBookingId?: string,
    maxResults: number = 5
): Promise<Date[]> {
    const suggestedSlots: Date[] = []
    const incrementMinutes = 15 // Check every 15 minutes

    // Start from the original event time
    let candidateTime = new Date(event.dateTime)

    // Search for up to 24 hours
    const maxSearchTime = new Date(event.dateTime.getTime() + 24 * 60 * 60 * 1000)

    while (suggestedSlots.length < maxResults && candidateTime < maxSearchTime) {
        // Move to next 15-minute increment
        candidateTime = new Date(candidateTime.getTime() + incrementMinutes * 60 * 1000)

        // Create a candidate event
        const candidateEvent: SchedulingEvent = {
            ...event,
            dateTime: candidateTime
        }

        // Validate this candidate
        const result = await validateScheduling(candidateEvent, excludeBookingId)

        if (result.isValid) {
            suggestedSlots.push(new Date(candidateTime))
        }
    }

    return suggestedSlots
}

/**
 * Validate a rental booking (both DEPARTURE and RETURN events)
 * 
 * @param pickupDate - The pickup (DEPARTURE) date/time
 * @param dropoffDate - The dropoff (RETURN) date/time
 * @param vehicleId - The vehicle ID
 * @param vehicleName - The vehicle name
 * @param vehiclePlate - The vehicle license plate (targa)
 * @param excludeBookingId - Optional booking ID to exclude (for editing)
 * @returns ValidationResult with combined errors from both events
 */
export async function validateRentalBooking(
    pickupDate: Date,
    dropoffDate: Date,
    vehicleId: string,
    vehicleName: string,
    vehiclePlate: string | undefined,
    excludeBookingId?: string
): Promise<ValidationResult> {
    // Validate DEPARTURE (pickup)
    const departureEvent: SchedulingEvent = {
        type: 'DEPARTURE',
        dateTime: pickupDate,
        vehicleId,
        vehicleName,
        vehiclePlate
    }

    const departureResult = await validateScheduling(departureEvent, excludeBookingId)

    // Validate RETURN (dropoff)
    const returnEvent: SchedulingEvent = {
        type: 'RETURN',
        dateTime: dropoffDate,
        vehicleId,
        vehicleName,
        vehiclePlate
    }

    const returnResult = await validateScheduling(returnEvent, excludeBookingId)

    // Combine errors
    const allErrors = [...departureResult.errors, ...returnResult.errors]

    // If there are errors, suggest slots for the first conflicting event
    let suggestedSlots: Date[] | undefined
    if (allErrors.length > 0) {
        // Prioritize fixing the pickup time if it has errors
        if (departureResult.errors.length > 0) {
            suggestedSlots = departureResult.suggestedSlots
        } else {
            suggestedSlots = returnResult.suggestedSlots
        }
    }

    return {
        isValid: allErrors.length === 0,
        errors: allErrors,
        suggestedSlots
    }
}

/**
 * Calculate the automatic wash time after a return
 * Enforces the mandatory 30-minute gap
 * 
 * @param returnDate - The return (dropoff) date/time
 * @returns Date object for the wash appointment (return time + 30 minutes)
 */
export function calculateAutomaticWashTime(returnDate: Date): Date {
    // Add 30 minutes to the return time
    return new Date(returnDate.getTime() + 30 * 60 * 1000)
}

/**
 * Validate and find the best time for automatic wash creation
 * 
 * @param returnDate - The return (dropoff) date/time
 * @param vehicleName - The vehicle name
 * @param excludeBookingId - Optional booking ID to exclude
 * @returns Object with washTime and validation result
 */
export async function validateAutomaticWash(
    returnDate: Date,
    vehicleName: string,
    excludeBookingId?: string
): Promise<{ washTime: Date; validation: ValidationResult }> {
    // Calculate initial wash time (30 minutes after return)
    const initialWashTime = calculateAutomaticWashTime(returnDate)

    const washEvent: SchedulingEvent = {
        type: 'WASH',
        dateTime: initialWashTime,
        vehicleName,
        durationMinutes: 45 // Default to "Lavaggio Completo"
    }

    // Validate this time
    const validation = await validateScheduling(washEvent, excludeBookingId)

    // If valid, return the initial time
    if (validation.isValid) {
        return { washTime: initialWashTime, validation }
    }

    // If not valid, find the next available slot
    const suggestedSlots = await findNextAvailableSlots(washEvent, excludeBookingId, 1)

    if (suggestedSlots.length > 0) {
        return {
            washTime: suggestedSlots[0],
            validation: {
                isValid: true,
                errors: [],
                suggestedSlots
            }
        }
    }

    // If no slot found, return the validation error
    return { washTime: initialWashTime, validation }
}
