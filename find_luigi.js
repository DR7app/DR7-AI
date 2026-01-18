import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function findLuigiCubeddu() {
    console.log('🔍 Searching for Luigi Cubeddu in all tables...\n')

    // First, authenticate to bypass RLS
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: 'admin@dr7.app', // You may need to provide actual credentials
        password: 'your_password_here'
    })

    if (authError) {
        console.log('⚠️  Not authenticated, using anon key (may have limited access)')
    }

    // Search in customers_extended
    console.log('📊 Searching customers_extended...')
    const { data: extendedResults, error: extendedError } = await supabase
        .from('customers_extended')
        .select('id, nome, cognome, email, telefono, tipo_cliente, created_at')
        .or('nome.ilike.%luigi%,cognome.ilike.%cubeddu%')

    if (extendedError) {
        console.error('❌ Error:', extendedError.message)
    } else {
        console.log(`✅ Found ${extendedResults?.length || 0} matches in customers_extended`)
        extendedResults?.forEach(c => {
            console.log(`   - ${c.nome} ${c.cognome} (${c.email || 'no email'}) - ID: ${c.id}`)
        })
    }

    // Search in bookings
    console.log('\n📊 Searching bookings table...')
    const { data: bookingsResults, error: bookingsError } = await supabase
        .from('bookings')
        .select('id, customer_name, customer_email, customer_phone, user_id')
        .ilike('customer_name', '%luigi%cubeddu%')

    if (bookingsError) {
        console.error('❌ Error:', bookingsError.message)
    } else {
        console.log(`✅ Found ${bookingsResults?.length || 0} matches in bookings`)
        bookingsResults?.forEach(b => {
            console.log(`   - ${b.customer_name} (${b.customer_email || 'no email'}) - user_id: ${b.user_id}`)
        })
    }

    // Count total customers
    console.log('\n📊 Total customer counts...')
    const { count: extendedCount } = await supabase
        .from('customers_extended')
        .select('*', { count: 'exact', head: true })

    const { count: bookingsCount } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })

    console.log(`   customers_extended: ${extendedCount || 0}`)
    console.log(`   bookings: ${bookingsCount || 0}`)
}

findLuigiCubeddu().catch(console.error)
