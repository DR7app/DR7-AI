
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in environment variables.')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function inspectBookings() {
    console.log('Fetching last 20 bookings...')
    const { data, error } = await supabase
        .from('bookings')
        .select('id, created_at, service_type, service_name, vehicle_name, status')
        .order('created_at', { ascending: false })
        .limit(20)

    if (error) {
        console.error('Error fetching bookings:', error)
        return
    }

    console.log(`Found ${data.length} bookings.`)
    data.forEach(b => {
        console.log(`ID: ${b.id}, Type: ${b.service_type}, Name: ${b.service_name}, Vehicle: ${b.vehicle_name}, Status: ${b.status}`)
    })
}

inspectBookings()
