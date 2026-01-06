
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseServiceKey) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function debugLatestBooking() {
    console.log('Fetching latest booking with second driver data...')

    // Fetch the most recent booking that has a second driver in booking_details
    const { data: bookings, error } = await supabase
        .from('bookings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

    if (error) {
        console.error('Error fetching bookings:', error)
        return
    }

    if (!bookings || bookings.length === 0) {
        console.log('No bookings found.')
        return
    }

    // Filter for one with second driver data
    const bookingWithDriver = bookings.find(b =>
        b.booking_details &&
        b.booking_details.second_driver &&
        (b.booking_details.second_driver.name || b.booking_details.second_driver.nome)
    )

    if (!bookingWithDriver) {
        console.log('No recent bookings found with second driver data.')
        console.log('Checked the last 50 bookings.')
        return
    }

    console.log(`FOUND BOOKING ID: ${bookingWithDriver.id}`)
    console.log('--- BOOKING DETAILS (Raw JSON) ---')
    console.log(JSON.stringify(bookingWithDriver.booking_details, null, 2))

    console.log('--- SECOND DRIVER DATA ANALYSIS ---')
    const sd = bookingWithDriver.booking_details.second_driver
    console.log('Keys present in second_driver object:', Object.keys(sd))
    console.log('Name check:', sd.name || sd.nome || 'MISSING')
    console.log('Surname check:', sd.surname || sd.cognome || 'MISSING')
    console.log('Tax Code check:', sd.tax_code || sd.codice_fiscale || 'MISSING')
    console.log('City check:', sd.city || sd.citta || 'MISSING')
    console.log('License check:', sd.license_number || sd.patente || 'MISSING')
}

debugLatestBooking()
