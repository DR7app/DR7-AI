import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || ''

const supabase = createClient(supabaseUrl, supabaseKey)

async function debugTimezoneData() {
    console.log('=== TIMEZONE DEBUG ANALYSIS ===\n')

    // Get sample bookings
    const { data: bookings, error } = await supabase
        .from('bookings')
        .select('*')
        .not('pickup_date', 'is', null)
        .in('status', ['confirmed', 'pending'])
        .gte('pickup_date', '2026-01-01')
        .order('pickup_date', { ascending: false })
        .limit(10)

    if (error) {
        console.error('Error fetching bookings:', error)
        return
    }

    console.log(`Found ${bookings?.length || 0} bookings\n`)

    bookings?.forEach((booking, idx) => {
        console.log(`\n--- Booking ${idx + 1}: ${booking.customer_name} ---`)
        console.log(`Vehicle: ${booking.vehicle_name}`)
        console.log(`Status: ${booking.status}`)
        console.log(`\nRAW DATABASE VALUES:`)
        console.log(`  pickup_date:  "${booking.pickup_date}"`)
        console.log(`  dropoff_date: "${booking.dropoff_date}"`)

        // Parse as the browser would
        const pickupBrowserParse = new Date(booking.pickup_date)
        const dropoffBrowserParse = new Date(booking.dropoff_date)

        console.log(`\nBROWSER PARSE (new Date()):`)
        console.log(`  pickup:  ${pickupBrowserParse.toISOString()} → Day ${pickupBrowserParse.getDate()}`)
        console.log(`  dropoff: ${dropoffBrowserParse.toISOString()} → Day ${dropoffBrowserParse.getDate()}`)

        // Parse with regex extraction (current parseLocalDate logic)
        const parseLocalDate = (dateString) => {
            if (!dateString) return new Date()
            const trimmed = dateString.trim()

            // ISO format with timezone offset
            const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}:\d{2}|Z)?$/)
            if (isoMatch) {
                return new Date(
                    parseInt(isoMatch[1]),      // year
                    parseInt(isoMatch[2]) - 1,  // month (0-indexed)
                    parseInt(isoMatch[3]),      // day
                    parseInt(isoMatch[4]),      // hour
                    parseInt(isoMatch[5]),      // minute
                    parseInt(isoMatch[6]),      // second
                    0
                )
            }

            return new Date(trimmed)
        }

        const pickupLocal = parseLocalDate(booking.pickup_date)
        const dropoffLocal = parseLocalDate(booking.dropoff_date)

        console.log(`\nCURRENT parseLocalDate() LOGIC:`)
        console.log(`  pickup:  ${pickupLocal.toISOString()} → Day ${pickupLocal.getDate()}`)
        console.log(`  dropoff: ${dropoffLocal.toISOString()} → Day ${dropoffLocal.getDate()}`)

        // Check for day shifts
        const browserPickupDay = pickupBrowserParse.getDate()
        const localPickupDay = pickupLocal.getDate()
        const dayShift = localPickupDay - browserPickupDay

        if (dayShift !== 0) {
            console.log(`\n⚠️  DAY SHIFT DETECTED: ${dayShift} days difference`)
        }

        // What it should be in Europe/Rome
        console.log(`\nEXPECTED (Europe/Rome):`)
        const romeFormatter = new Intl.DateTimeFormat('it-IT', {
            timeZone: 'Europe/Rome',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        })
        console.log(`  pickup:  ${romeFormatter.format(pickupBrowserParse)}`)
        console.log(`  dropoff: ${romeFormatter.format(dropoffBrowserParse)}`)
    })

    console.log('\n\n=== END DEBUG ===')
}

debugTimezoneData().catch(console.error)
