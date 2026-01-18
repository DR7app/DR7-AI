import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function debugCustomerSearch() {
    console.log('🔍 Testing database connection and RLS policies...\n')

    // First, check if we're authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError) {
        console.log('❌ Not authenticated (expected for anon key):', authError.message)
    } else if (user) {
        console.log('✅ Authenticated as:', user.email)
    } else {
        console.log('ℹ️  Using anonymous access (anon key)')
    }

    console.log('\n📊 Checking customers_extended table...\n')

    // Try to fetch all customers without filters
    const { data: allCustomers, error: allError, count } = await supabase
        .from('customers_extended')
        .select('id, nome, cognome, email, telefono, tipo_cliente', { count: 'exact' })
        .limit(10)

    if (allError) {
        console.error('❌ Error fetching customers:', allError)
        console.error('   Code:', allError.code)
        console.error('   Message:', allError.message)
        console.error('   Details:', allError.details)
        console.error('   Hint:', allError.hint)
    } else {
        console.log('✅ Successfully fetched customers:', allCustomers?.length)
        console.log('   Total count:', count)
        if (allCustomers && allCustomers.length > 0) {
            console.log('\n   First 5 customers:')
            allCustomers.slice(0, 5).forEach((c, i) => {
                console.log(`   ${i + 1}. ${c.nome} ${c.cognome} (${c.email || 'no email'})`)
            })
        }
    }

    // Try searching for Luigi specifically
    console.log('\n🔍 Searching for "Luigi Cubeddu"...\n')

    const { data: luigiResults, error: luigiError } = await supabase
        .from('customers_extended')
        .select('*')
        .ilike('nome', '%luigi%')

    if (luigiError) {
        console.error('❌ Error searching for Luigi:', luigiError)
    } else {
        console.log('✅ Results for nome ILIKE "%luigi%":', luigiResults?.length)
        luigiResults?.forEach(c => {
            console.log(`   - ${c.nome} ${c.cognome} (ID: ${c.id})`)
        })
    }

    // Check the bookings table to see if we can access that
    console.log('\n📊 Checking bookings table for comparison...\n')

    const { data: bookings, error: bookingsError, count: bookingsCount } = await supabase
        .from('bookings')
        .select('id, customer_name, customer_email', { count: 'exact' })
        .limit(5)

    if (bookingsError) {
        console.error('❌ Error fetching bookings:', bookingsError)
    } else {
        console.log('✅ Successfully fetched bookings:', bookings?.length)
        console.log('   Total count:', bookingsCount)
    }
}

debugCustomerSearch().catch(console.error)
