import { supabase } from '../supabaseClient'

/**
 * Check if two time ranges overlap
 */
export function checkTimeOverlap(
    start1: string,
    duration1Minutes: number,
    start2: string,
    duration2Minutes: number
): boolean {
    // Parse time strings (HH:MM format)
    const [h1, m1] = start1.split(':').map(Number)
    const [h2, m2] = start2.split(':').map(Number)

    const start1Minutes = h1 * 60 + m1
    const end1Minutes = start1Minutes + duration1Minutes
    const start2Minutes = h2 * 60 + m2
    const end2Minutes = start2Minutes + duration2Minutes

    // Check if ranges overlap
    return start1Minutes < end2Minutes && end1Minutes > start2Minutes
}

/**
 * Get duration in minutes for a service
 * Prefers totalDuration from booking_details when available
 */
export function getBookingDuration(serviceName: string, serviceType: 'car_wash' | 'mechanical_service', bookingDetails?: any): number {
    // Prefer stored totalDuration from booking time (always in sync with catalog)
    if (bookingDetails?.totalDuration && bookingDetails.totalDuration > 0) {
        return bookingDetails.totalDuration
    }

    if (serviceType === 'car_wash') {
        // Fallback: hardcoded durations for legacy bookings without totalDuration
        const carWashServices = [
            { name: 'Lavaggio Completo', durationMinutes: 45 },
            { name: 'Lavaggio Esterno', durationMinutes: 30 },
            { name: 'Lavaggio Interno', durationMinutes: 30 },
            { name: 'Lavaggio Premium', durationMinutes: 90 },
            { name: 'Lavaggio DR7 Luxury', durationMinutes: 150 }
        ]
        const service = carWashServices.find(s => s.name === serviceName)
        return service?.durationMinutes || 60 // Default 1 hour
    } else {
        // Mechanical services default to 1 hour
        return 60
    }
}

/**
 * Fetch all conflicting bookings (both car_wash and mechanical_service) for a given date
 */
export async function fetchConflictingBookings(date: string, excludeBookingId?: string) {
    const { data: bookings, error } = await supabase
        .from('bookings')
        .select('id, service_type, service_name, appointment_date, appointment_time, customer_name, booking_details')
        .in('service_type', ['car_wash', 'mechanical_service'])
        .neq('status', 'cancelled')
        .gte('appointment_date', date)
        .lte('appointment_date', `${date}T23:59:59`)

    if (error) {
        console.error('Error fetching conflicting bookings:', error)
        return []
    }

    // Filter out the current booking if editing
    return excludeBookingId
        ? bookings.filter(b => b.id !== excludeBookingId)
        : bookings
}

/**
 * Fetch rental events (pickups and dropoffs) for a given date
 * Used to prevent conflicts for the check-in/check-out person
 */
export async function fetchRentalEvents(date: string, excludeBookingId?: string) {
    // 1. Fetch pickups on this date
    const { data: pickups, error: pickupError } = await supabase
        .from('bookings')
        .select('id, pickup_date, customer_name, vehicle_name')
        .gte('pickup_date', `${date}T00:00:00`)
        .lte('pickup_date', `${date}T23:59:59`)
        .neq('status', 'cancelled')

    // 2. Fetch dropoffs on this date
    const { data: dropoffs, error: dropoffError } = await supabase
        .from('bookings')
        .select('id, dropoff_date, customer_name, vehicle_name')
        .gte('dropoff_date', `${date}T00:00:00`)
        .lte('dropoff_date', `${date}T23:59:59`)
        .neq('status', 'cancelled')

    if (pickupError || dropoffError) {
        console.error('Error fetching rental events:', pickupError || dropoffError)
        return []
    }

    const events = [
        ...(pickups?.map(p => ({ ...p, type: 'pickup', time: new Date(p.pickup_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }) })) || []),
        ...(dropoffs?.map(d => ({ ...d, type: 'dropoff', time: new Date(d.dropoff_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }) })) || [])
    ]

    return excludeBookingId
        ? events.filter(e => e.id !== excludeBookingId)
        : events
}

/**
 * Filter time slots to only show available ones
 */
export function filterAvailableTimeSlots(
    allTimeSlots: string[],
    existingBookings: any[],
    newBookingDuration: number
): string[] {
    return allTimeSlots.filter(timeSlot => {
        // Check if this time slot conflicts with any existing booking
        for (const booking of existingBookings) {
            const bookingTime = booking.appointment_time || '00:00'
            const bookingDuration = getBookingDuration(
                booking.service_name,
                booking.service_type,
                booking.booking_details
            )

            if (checkTimeOverlap(timeSlot, newBookingDuration, bookingTime, bookingDuration)) {
                return false // This slot is not available
            }
        }
        return true // This slot is available
    })
}

/**
 * Filter rental time slots (15 min intervals)
 * Ensures 15 min gap for check-in/check-out person
 */
export function filterRentalTimeSlots(
    allTimeSlots: string[],
    rentalEvents: any[]
): string[] {
    // Rental operations take 15 minutes
    // If there is an event at 10:00, the 10:00 slot is taken.
    // The previous slot (09:45) is free (ends at 10:00).
    // The next slot (10:15) is free (starts at 10:15).

    return allTimeSlots.filter(timeSlot => {
        // Check if this time slot matches any existing event time
        // Since both slots and events are on 15-min grid, exact match is enough
        const isTaken = rentalEvents.some(event => {
            // Compare times (HH:MM)
            // Note: Be careful with timezone variations if Date parsing differs
            // Assuming event.time is formatted reliably as HH:MM
            return event.time === timeSlot
        })

        return !isTaken
    })
}

/**
 * Find next available time slots after a conflict
 * Returns up to 5 next available slots
 */
export function findNextAvailableSlots(
    allTimeSlots: string[],
    existingBookings: any[],
    newBookingDuration: number,
    maxResults: number = 5
): string[] {
    const availableSlots = filterAvailableTimeSlots(allTimeSlots, existingBookings, newBookingDuration)
    return availableSlots.slice(0, maxResults)
}

/**
 * Find next available rental slots
 */
export function findNextRentalSlots(
    allTimeSlots: string[],
    rentalEvents: any[],
    maxResults: number = 3
): string[] {
    const availableSlots = filterRentalTimeSlots(allTimeSlots, rentalEvents)
    return availableSlots.slice(0, maxResults)
}

/**
 * Format time slot with end time for display
 */
export function formatTimeSlotWithDuration(startTime: string, durationMinutes: number): string {
    const [hours, minutes] = startTime.split(':').map(Number)
    const endMinutes = hours * 60 + minutes + durationMinutes
    const endHours = Math.floor(endMinutes / 60)
    const endMins = endMinutes % 60

    return `${startTime} - ${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}`
}
