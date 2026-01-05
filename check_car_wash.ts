import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkCarWash() {
    // Get recent car wash bookings
    const { data, error } = await supabase
        .from('bookings')
        .select('id, service_type, vehicle_name, customer_name, appointment_date, appointment_time, pickup_date, dropoff_date, created_at')
        .eq('service_type', 'car_wash')
        .order('created_at', { ascending: false })
        .limit(5)

    if (error) {
        console.error('Error:', error)
        return
    }

    console.log('\n=== Recent car wash bookings ===')
    if (data.length === 0) {
        console.log('No car wash bookings found')
    } else {
        data.forEach((booking, i) => {
            console.log(`\n[${i + 1}] ${booking.vehicle_name}`)
            console.log(`  ID: ${booking.id}`)
            console.log(`  Customer: ${booking.customer_name}`)
            console.log(`  Appointment Date: ${booking.appointment_date}`)
            console.log(`  Appointment Time: ${booking.appointment_time}`)
            console.log(`  Pickup Date: ${booking.pickup_date}`)
            console.log(`  Dropoff Date: ${booking.dropoff_date}`)
            console.log(`  Created: ${booking.created_at}`)
        })
    }
}

checkCarWash()
