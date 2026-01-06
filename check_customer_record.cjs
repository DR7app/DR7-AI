const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkCustomerData() {
    console.log('🔍 CHECKING CUSTOMER DATA FOR SECOND DRIVER\n')
    console.log('='.repeat(80))

    // Check the customer record
    const customerId = '44c9bac7-4fb2-4ec0-90a1-ecd5fbf758d8'

    const { data: customer, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .single()

    if (error) {
        console.error('❌ Error fetching customer:', error)
    } else {
        console.log('📋 CUSTOMER RECORD (Jacopo Cerutti):')
        console.log(JSON.stringify(customer, null, 2))
    }

    // Also check customers_extended
    const { data: customerExt, error: extError } = await supabase
        .from('customers_extended')
        .select('*')
        .eq('id', customerId)
        .single()

    if (extError) {
        console.log('\n⚠️  No customers_extended record found')
    } else {
        console.log('\n📋 CUSTOMERS_EXTENDED RECORD:')
        console.log(JSON.stringify(customerExt, null, 2))
    }

    // Check ALL recent bookings to see if there's a newer one
    console.log('\n\n' + '='.repeat(80))
    console.log('📋 CHECKING ALL RECENT BOOKINGS WITH SECOND DRIVER')
    console.log('='.repeat(80))

    const { data: allBookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

    if (!bookingsError && allBookings) {
        const withSecondDriver = allBookings.filter(b =>
            b.booking_details?.second_driver?.name
        )

        console.log(`\nFound ${withSecondDriver.length} bookings with second driver:\n`)

        withSecondDriver.forEach((b, i) => {
            const sd = b.booking_details.second_driver
            console.log(`${i + 1}. Booking ID: ${b.id.substring(0, 8)}...`)
            console.log(`   Created: ${b.created_at}`)
            console.log(`   Second Driver: ${sd.name} ${sd.surname}`)
            console.log(`   Has Codice Fiscale: ${sd.codice_fiscale ? '✅ YES: ' + sd.codice_fiscale : '❌ NO (empty)'}`)
            console.log(`   Has Address: ${sd.indirizzo ? '✅ YES: ' + sd.indirizzo : '❌ NO (empty)'}`)
            console.log(`   Has City: ${sd.citta ? '✅ YES: ' + sd.citta : '❌ NO (empty)'}`)
            console.log('')
        })
    }
}

checkCustomerData().catch(console.error)
