import { supabase } from '../supabaseClient'

export interface AvailabilityResult {
    available: boolean
    reason?: string
    conflictType?: 'booking' | 'mechanical' | 'unavailable'
    conflictDetails?: {
        startDate?: string
        endDate?: string
        customerName?: string
    }
}

/**
 * Check if a vehicle is available for a given date range
 * @param vehicleId - The vehicle's ID from the vehicles table
 * @param vehicleName - The vehicle's display name
 * @param fromDate - Start date in YYYY-MM-DD format
 * @param toDate - End date in YYYY-MM-DD format
 * @returns AvailabilityResult with availability status and reason if unavailable
 */
export async function checkVehicleAvailability(
    vehicleId: string,
    vehicleName: string,
    fromDate: string,
    toDate: string
): Promise<AvailabilityResult> {
    try {
        // 1. Check for overlapping car rental bookings
        const { data: rentalBookings, error: rentalError } = await supabase
            .from('bookings')
            .select('*')
            .eq('vehicle_name', vehicleName)
            .or(`and(pickup_date.lte.${toDate},return_date.gte.${fromDate})`)
            .neq('status', 'cancelled')

        if (rentalError) throw rentalError

        if (rentalBookings && rentalBookings.length > 0) {
            const booking = rentalBookings[0]
            return {
                available: false,
                reason: `Noleggiato da ${booking.customer_name || 'cliente'}`,
                conflictType: 'booking',
                conflictDetails: {
                    startDate: booking.pickup_date,
                    endDate: booking.return_date,
                    customerName: booking.customer_name
                }
            }
        }

        // 2. Check for overlapping reservations
        const { data: reservations, error: reservationError } = await supabase
            .from('reservations')
            .select('*')
            .eq('vehicle_id', vehicleId)
            .or(`and(pickup_date.lte.${toDate},return_date.gte.${fromDate})`)
            .neq('status', 'cancelled')

        if (reservationError) throw reservationError

        if (reservations && reservations.length > 0) {
            const reservation = reservations[0]
            return {
                available: false,
                reason: 'Prenotato',
                conflictType: 'booking',
                conflictDetails: {
                    startDate: reservation.pickup_date,
                    endDate: reservation.return_date,
                    customerName: reservation.customer_name
                }
            }
        }

        // 3. Check vehicle metadata for unavailable periods
        const { data: vehicle, error: vehicleError } = await supabase
            .from('vehicles')
            .select('metadata, status')
            .eq('id', vehicleId)
            .single()

        if (vehicleError) throw vehicleError

        if (vehicle && vehicle.metadata) {
            const metadata = vehicle.metadata as any
            const unavailableFrom = metadata.unavailable_from
            const unavailableUntil = metadata.unavailable_until

            if (unavailableFrom && unavailableUntil) {
                // Check if the requested date range overlaps with the unavailable period
                if (fromDate <= unavailableUntil && toDate >= unavailableFrom) {
                    const reason = metadata.unavailable_reason || 'Non disponibile'
                    return {
                        available: false,
                        reason: reason,
                        conflictType: 'unavailable',
                        conflictDetails: {
                            startDate: unavailableFrom,
                            endDate: unavailableUntil
                        }
                    }
                }
            }
        }

        // If no conflicts found, vehicle is available
        return {
            available: true
        }
    } catch (error) {
        console.error('Error checking vehicle availability:', error)
        // On error, return unavailable to be safe
        return {
            available: false,
            reason: 'Errore nel controllo disponibilità'
        }
    }
}

/**
 * Check availability for multiple vehicles at once
 * @param vehicles - Array of vehicles with id and display_name
 * @param fromDate - Start date in YYYY-MM-DD format
 * @param toDate - End date in YYYY-MM-DD format
 * @returns Map of vehicle IDs to their availability results
 */
export async function checkMultipleVehiclesAvailability(
    vehicles: Array<{ id: string; display_name: string }>,
    fromDate: string,
    toDate: string
): Promise<Map<string, AvailabilityResult>> {
    const results = new Map<string, AvailabilityResult>()

    // Check all vehicles in parallel
    await Promise.all(
        vehicles.map(async (vehicle) => {
            const result = await checkVehicleAvailability(
                vehicle.id,
                vehicle.display_name,
                fromDate,
                toDate
            )
            results.set(vehicle.id, result)
        })
    )

    return results
}
