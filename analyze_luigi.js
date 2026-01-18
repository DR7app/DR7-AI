import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function analyzeCustomerLoadingIssue() {
    console.log('🔍 Analyzing why Luigi Cubeddu appears in Clienti but not Prenotazioni...\n')

    // Get Luigi's booking data
    const { data: luigiBookings } = await supabase
        .from('bookings')
        .select('*')
        .ilike('customer_name', '%luigi%cubeddu%')
        .limit(1)

    if (!luigiBookings || luigiBookings.length === 0) {
        console.log('❌ Luigi not found in bookings')
        return
    }

    const luigi = luigiBookings[0]
    console.log('📋 Luigi Cubeddu booking data:')
    console.log('   customer_name:', luigi.customer_name)
    console.log('   customer_email:', luigi.customer_email)
    console.log('   customer_phone:', luigi.customer_phone)
    console.log('   user_id:', luigi.user_id)
    console.log('   booking_details:', JSON.stringify(luigi.booking_details, null, 2))

    // Check if user_id is valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const hasValidUserId = luigi.user_id && uuidRegex.test(luigi.user_id)

    console.log('\n🔍 Analysis:')
    console.log('   Has valid UUID user_id?', hasValidUserId)

    if (!hasValidUserId) {
        console.log('\n⚠️  PROBLEM IDENTIFIED:')
        console.log('   Luigi has user_id:', luigi.user_id)
        console.log('   ReservationsTab SKIPS bookings without valid UUID (lines 1004-1012)')
        console.log('   It expects these customers to come from customers_extended')
        console.log('   But Luigi is NOT in customers_extended!')
        console.log('\n💡 SOLUTION:')
        console.log('   Option 1: Create Luigi in customers_extended table')
        console.log('   Option 2: Modify ReservationsTab to NOT skip null user_id bookings')
    }

    // Check if email/phone exists in customers_extended
    if (luigi.customer_email) {
        const { data: emailMatch } = await supabase
            .from('customers_extended')
            .select('id, nome, cognome, email')
            .eq('email', luigi.customer_email)

        console.log('\n📧 Email match in customers_extended:', emailMatch?.length || 0)
    }

    if (luigi.customer_phone) {
        const { data: phoneMatch } = await supabase
            .from('customers_extended')
            .select('id, nome, cognome, telefono')
            .eq('telefono', luigi.customer_phone)

        console.log('📱 Phone match in customers_extended:', phoneMatch?.length || 0)
    }
}

analyzeCustomerLoadingIssue().catch(console.error)
