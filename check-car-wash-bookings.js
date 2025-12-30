// Quick script to check car wash bookings in the database
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkCarWashBookings() {
    console.log('Checking car wash bookings...\n')

    // Check all car wash bookings
    const { data: allBookings, error: allError } = await supabase
        .from('bookings')
        .select('*')
        .eq('service_type', 'car_wash')
        .order('created_at', { ascending: false })
        .limit(10)

    if (allError) {
        console.error('Error fetching all car wash bookings:', allError)
    } else {
        console.log(`Total car wash bookings (last 10):`, allBookings?.length || 0)
        if (allBookings && allBookings.length > 0) {
            console.log('\nRecent bookings:')
            allBookings.forEach((booking, i) => {
                console.log(`\n${i + 1}. Booking ID: ${booking.id}`)
                console.log(`   Customer: ${booking.customer_name}`)
                console.log(`   Email: ${booking.customer_email}`)
                console.log(`   Phone: ${booking.customer_phone}`)
                console.log(`   Service: ${booking.service_name}`)
                console.log(`   Date: ${booking.appointment_date}`)
                console.log(`   Time: ${booking.appointment_time}`)
                console.log(`   Status: ${booking.status}`)
                console.log(`   Payment: ${booking.payment_status}`)
                console.log(`   Created: ${booking.created_at}`)
            })
        }
    }

    // Check today's bookings
    const today = new Date().toISOString().split('T')[0]
    const { data: todayBookings, error: todayError } = await supabase
        .from('bookings')
        .eq('service_type', 'car_wash')
        .gte('appointment_date', today)
        .order('appointment_date', { ascending: true })

    if (todayError) {
        console.error('\nError fetching today\'s bookings:', todayError)
    } else {
        console.log(`\n\nToday's and future car wash bookings:`, todayBookings?.length || 0)
        if (todayBookings && todayBookings.length > 0) {
            todayBookings.forEach((booking, i) => {
                console.log(`\n${i + 1}. ${booking.customer_name} - ${booking.service_name}`)
                console.log(`   ${booking.appointment_date} at ${booking.appointment_time}`)
                console.log(`   Status: ${booking.status}, Payment: ${booking.payment_status}`)
            })
        }
    }

    // Check for bookings without service_type
    const { data: noTypeBookings, error: noTypeError } = await supabase
        .from('bookings')
        .select('*')
        .is('service_type', null)
        .order('created_at', { ascending: false })
        .limit(5)

    if (noTypeError) {
        console.error('\nError fetching bookings without service_type:', noTypeError)
    } else {
        console.log(`\n\nBookings without service_type (last 5):`, noTypeBookings?.length || 0)
        if (noTypeBookings && noTypeBookings.length > 0) {
            noTypeBookings.forEach((booking, i) => {
                console.log(`\n${i + 1}. Booking ID: ${booking.id}`)
                console.log(`   Customer: ${booking.customer_name}`)
                console.log(`   Service Name: ${booking.service_name}`)
                console.log(`   Created: ${booking.created_at}`)
            })
        }
    }
}

checkCarWashBookings().catch(console.error)
