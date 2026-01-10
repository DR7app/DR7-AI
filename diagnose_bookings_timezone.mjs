// Comprehensive booking timezone diagnostic
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in environment')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function diagnoseBookings() {
    console.log('=== BOOKING TIMEZONE DIAGNOSTIC ===\n')

    const { data: bookings, error } = await supabase
        .from('bookings')
        .select('*')
        .gte('pickup_date', '2026-01-01')
        .lt('pickup_date', '2026-02-01')
        .in('status', ['confirmed', 'pending'])
        .order('pickup_date', { ascending: true })
        .limit(5)

    if (error) {
        console.error('Error:', error)
        return
    }

    console.log(`Found ${bookings?.length || 0} bookings in January 2026\n`)

    bookings?.forEach((booking, idx) => {
        console.log(`\n--- Booking ${idx + 1}: ${booking.customer_name} ---`)
        console.log(`Vehicle: ${booking.vehicle_name}`)

        // Raw DB values
        console.log(`\nRAW DB VALUES:`)
        console.log(`  pickup_date:  ${booking.pickup_date}`)
        console.log(`  dropoff_date: ${booking.dropoff_date}`)

        // Parse and show Rome timezone
        const pickupDate = new Date(booking.pickup_date)
        const dropoffDate = new Date(booking.dropoff_date)

        const romeFormatter = new Intl.DateTimeFormat('it-IT', {
            timeZone: 'Europe/Rome',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        })

        console.log(`\nROME TIMEZONE:`)
        console.log(`  Pickup:  ${romeFormatter.format(pickupDate)}`)
        console.log(`  Dropoff: ${romeFormatter.format(dropoffDate)}`)

        // Extract day components
        const pickupParts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Europe/Rome',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).formatToParts(pickupDate)

        const pickupDay = pickupParts.find(p => p.type === 'day')?.value
        const pickupMonth = pickupParts.find(p => p.type === 'month')?.value

        console.log(`\nEXPECTED CALENDAR POSITION:`)
        console.log(`  Should appear on day: ${pickupDay} of month ${pickupMonth}`)

        // Check for potential issues
        const pickupUTCDay = pickupDate.getUTCDate()
        const pickupRomeDay = parseInt(pickupDay || '0')

        if (pickupUTCDay !== pickupRomeDay) {
            console.log(`\n⚠️  WARNING: UTC day (${pickupUTCDay}) differs from Rome day (${pickupRomeDay})`)
            console.log(`   This booking WILL shift if not using proper timezone conversion!`)
        }
    })

    console.log('\n\n=== DIAGNOSTIC COMPLETE ===')
}

diagnoseBookings().catch(console.error)
