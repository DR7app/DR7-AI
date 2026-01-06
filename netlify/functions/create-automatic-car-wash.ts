import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * Calculate the automatic wash time after a return
 * Enforces the mandatory 30-minute gap
 */
function calculateAutomaticWashTime(returnDate: Date): Date {
    // Add 30 minutes to the return time
    return new Date(returnDate.getTime() + 30 * 60 * 1000)
}

/**
 * Validate wash time against existing events
 * This is a simplified version for the backend - full validation is in schedulingRules.ts
 */
async function validateWashTime(washTime: Date, vehicleName: string): Promise<{ isValid: boolean; nextAvailable?: Date }> {
    // Fetch all events around this time (±2 hours)
    const startWindow = new Date(washTime.getTime() - 2 * 60 * 60 * 1000)
    const endWindow = new Date(washTime.getTime() + 2 * 60 * 60 * 1000)

    // Fetch DEPARTURE events (pickups)
    const { data: pickups } = await supabase
        .from('bookings')
        .select('pickup_date, vehicle_name')
        .neq('status', 'cancelled')
        .gte('pickup_date', startWindow.toISOString())
        .lte('pickup_date', endWindow.toISOString())
        .neq('service_type', 'car_wash')

    // Fetch RETURN events (dropoffs)
    const { data: dropoffs } = await supabase
        .from('bookings')
        .select('dropoff_date, vehicle_name')
        .neq('status', 'cancelled')
        .gte('dropoff_date', startWindow.toISOString())
        .lte('dropoff_date', endWindow.toISOString())
        .neq('service_type', 'car_wash')

    // Fetch WASH events
    const { data: washes } = await supabase
        .from('bookings')
        .select('pickup_date, appointment_date, appointment_time, vehicle_name')
        .eq('service_type', 'car_wash')
        .neq('status', 'cancelled')
        .gte('appointment_date', startWindow.toISOString().split('T')[0])
        .lte('appointment_date', endWindow.toISOString().split('T')[0])

    const washTimeMs = washTime.getTime()

    // Check DEPARTURE conflicts (15 min gap required)
    for (const pickup of pickups || []) {
        const pickupTimeMs = new Date(pickup.pickup_date).getTime()
        const gapMs = Math.abs(washTimeMs - pickupTimeMs)
        if (gapMs < 15 * 60 * 1000) {
            console.log(`⚠️ Wash conflicts with DEPARTURE at ${new Date(pickup.pickup_date).toISOString()}`)
            return { isValid: false }
        }
    }

    // Check RETURN conflicts (30 min gap required)
    for (const dropoff of dropoffs || []) {
        const dropoffTimeMs = new Date(dropoff.dropoff_date).getTime()
        const gapMs = Math.abs(washTimeMs - dropoffTimeMs)
        if (gapMs < 30 * 60 * 1000) {
            console.log(`⚠️ Wash conflicts with RETURN at ${new Date(dropoff.dropoff_date).toISOString()}`)
            return { isValid: false }
        }
    }

    // Check WASH conflicts (no same-time allowed)
    for (const wash of washes || []) {
        let washDateTime: Date
        if (wash.pickup_date) {
            washDateTime = new Date(wash.pickup_date)
        } else if (wash.appointment_date && wash.appointment_time) {
            const dateStr = wash.appointment_date.split('T')[0]
            washDateTime = new Date(`${dateStr}T${wash.appointment_time}:00`)
        } else {
            washDateTime = new Date(wash.appointment_date)
        }

        if (washDateTime.getTime() === washTimeMs) {
            console.log(`⚠️ Wash conflicts with another WASH at ${washDateTime.toISOString()}`)
            return { isValid: false }
        }
    }

    return { isValid: true }
}

/**
 * Find next available wash slot
 */
async function findNextAvailableWashSlot(startTime: Date, vehicleName: string, maxAttempts: number = 20): Promise<Date | null> {
    let candidateTime = new Date(startTime)

    for (let i = 0; i < maxAttempts; i++) {
        const validation = await validateWashTime(candidateTime, vehicleName)
        if (validation.isValid) {
            return candidateTime
        }
        // Move to next 15-minute slot
        candidateTime = new Date(candidateTime.getTime() + 15 * 60 * 1000)
    }

    return null
}

export const handler: Handler = async (event) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        }
    }

    try {
        const { bookingId } = JSON.parse(event.body || '{}')

        if (!bookingId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Booking ID is required' })
            }
        }

        // Fetch the rental booking details
        const { data: rentalBooking, error: fetchError } = await supabase
            .from('bookings')
            .select('*')
            .eq('id', bookingId)
            .single()

        if (fetchError || !rentalBooking) {
            console.error('Error fetching rental booking:', fetchError)
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Rental booking not found' })
            }
        }

        // Determine the car wash appointment time
        // SCHEDULING RULE: Wash must be scheduled 30 minutes after RETURN (dropoff)
        const dropoffDate = new Date(rentalBooking.dropoff_date)

        // Calculate initial wash time (dropoff + 30 minutes)
        const initialWashTime = calculateAutomaticWashTime(dropoffDate)

        console.log(`📅 Dropoff time: ${dropoffDate.toISOString()}`)
        console.log(`🧼 Initial wash time (dropoff + 30min): ${initialWashTime.toISOString()}`)

        // Validate this time against existing events
        const validation = await validateWashTime(initialWashTime, rentalBooking.vehicle_name)

        let appointmentDateTime: Date

        if (validation.isValid) {
            appointmentDateTime = initialWashTime
            console.log(`✅ Wash time is valid: ${appointmentDateTime.toISOString()}`)
        } else {
            // Find next available slot
            console.log(`⚠️ Initial wash time conflicts, finding next available slot...`)
            const nextAvailable = await findNextAvailableWashSlot(initialWashTime, rentalBooking.vehicle_name)

            if (!nextAvailable) {
                console.error('❌ No available wash slot found within reasonable timeframe')
                return {
                    statusCode: 409,
                    body: JSON.stringify({
                        error: 'Cannot schedule automatic wash',
                        details: 'No available time slot found due to scheduling conflicts. Please manually schedule the wash.',
                        dropoffTime: dropoffDate.toISOString(),
                        suggestedWashTime: initialWashTime.toISOString()
                    })
                }
            }

            appointmentDateTime = nextAvailable
            console.log(`✅ Found available slot: ${appointmentDateTime.toISOString()}`)
        }

        // Format appointment date and time
        const appointmentDate = appointmentDateTime.toISOString()
        const appointmentTime = appointmentDateTime.toLocaleTimeString('it-IT', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        })

        // Calculate end time (45 minutes later)
        const endDateTime = new Date(appointmentDateTime)
        endDateTime.setMinutes(endDateTime.getMinutes() + 45)
        const endDate = endDateTime.toISOString().split('T')[0]
        const endTime = endDateTime.toLocaleTimeString('it-IT', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        })

        // Create the internal car wash booking
        const carWashBooking = {
            service_type: 'car_wash',
            service_name: 'Lavaggio Completo',
            vehicle_name: `INTERNO - ${rentalBooking.vehicle_name}`,
            customer_name: `INTERNO - ${rentalBooking.vehicle_name}`,
            customer_email: null,
            customer_phone: null,
            guest_name: `INTERNO - ${rentalBooking.vehicle_name}`,
            guest_email: null,
            guest_phone: null,
            appointment_date: appointmentDate,
            appointment_time: appointmentTime,
            pickup_date: appointmentDate,
            dropoff_date: endDateTime.toISOString(), // Fixed: Use end time (appointment + 45 min)
            pickup_location: 'DR7 Empire - Car Wash Interno',
            dropoff_location: 'DR7 Empire - Car Wash Interno',
            price_total: 0, // Free internal booking
            currency: 'EUR',
            status: 'confirmed',
            payment_status: 'paid', // Mark as paid to avoid payment tracking
            booking_details: {
                internal: true,
                originalBookingId: bookingId,
                vehiclePlate: rentalBooking.vehicle_plate,
                notes: `Lavaggio automatico post-rientro. Scheduled ${appointmentDateTime > initialWashTime ? 'at next available slot due to conflicts' : 'at standard time (dropoff + 30min)'}`,
                createdBy: 'automatic_system',
                dropoffTime: dropoffDate.toISOString(),
                scheduledWashTime: appointmentDateTime.toISOString()
            }
        }

        console.log('📤 Creating automatic car wash booking:', carWashBooking)

        const { data: newCarWash, error: insertError } = await supabase
            .from('bookings')
            .insert([carWashBooking])
            .select()
            .single()

        if (insertError) {
            console.error('❌ Error creating car wash booking:', insertError)
            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: 'Failed to create car wash booking',
                    details: insertError.message
                })
            }
        }

        console.log('✅ Car wash booking created:', newCarWash.id)

        // Add to Google Calendar
        try {
            const calendarResponse = await fetch(`${process.env.URL}/.netlify/functions/create-calendar-event`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vehicleName: `🧼 INTERNO - ${rentalBooking.vehicle_name}`,
                    customerName: 'Lavaggio Interno',
                    customerEmail: null,
                    customerPhone: null,
                    pickupDate: appointmentDate.split('T')[0],
                    pickupTime: appointmentTime,
                    returnDate: endDate,
                    returnTime: endTime,
                    pickupLocation: 'DR7 Empire - Car Wash Interno',
                    returnLocation: 'DR7 Empire - Car Wash Interno',
                    totalPrice: 0,
                    bookingId: newCarWash.id
                })
            })

            if (calendarResponse.ok) {
                console.log('✅ Google Calendar event created')
            } else {
                console.warn('⚠️ Failed to create Google Calendar event')
            }
        } catch (calendarError) {
            console.error('⚠️ Google Calendar error:', calendarError)
            // Don't fail the whole operation if calendar fails
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                carWashBooking: newCarWash,
                message: 'Prenotazione lavaggio automatica creata con successo'
            })
        }
    } catch (error: any) {
        console.error('❌ Unexpected error:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                details: error.message
            })
        }
    }
}
