import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

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
        // Use dropoff time if available, otherwise use current time
        const dropoffDate = new Date(rentalBooking.dropoff_date)
        const now = new Date()

        // If dropoff is in the past, use current time; otherwise use dropoff time
        // UPDATE: User wants it "directly" when car comes back, so we use NOW always for the wash appointment
        const appointmentDateTime = now

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
                notes: 'Lavaggio automatico post-rientro',
                createdBy: 'automatic_system'
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
