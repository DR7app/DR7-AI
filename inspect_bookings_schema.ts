
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Missing env vars')
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function inspect() {
    const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .limit(1)

    if (error) {
        console.error('Error:', error)
    } else {
        if (data && data.length > 0) {
            console.log('Bookings Table Columns:', Object.keys(data[0]))
        } else {
            console.log('Bookings table is empty')
        }
    }
}

inspect()
