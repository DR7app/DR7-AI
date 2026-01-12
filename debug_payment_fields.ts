import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co'
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key'

const supabase = createClient(supabaseUrl, supabaseKey)

async function debugPaymentFields() {
    console.log('🔍 Debugging payment fields in bookings...\n')

    const { data: bookings, error } = await supabase
        .from('bookings')
        .select('*')
        .neq('status', 'cancelled')
        .or('service_type.is.null,service_type.not.in.(car_wash,mechanical_service,mechanical)')
        .order('created_at', { ascending: false })
        .limit(20)

    if (error) {
        console.error('❌ Error:', error)
        return
    }

    console.log(`Found ${bookings?.length || 0} bookings\n`)

    bookings?.forEach((booking, index) => {
        console.log(`\n${'='.repeat(80)}`)
        console.log(`Booking ${index + 1}: ${booking.id}`)
        console.log(`Customer: ${booking.customer_name}`)
        console.log(`Date: ${booking.pickup_date}`)
        console.log(`Status: ${booking.status}`)
        console.log(`-`.repeat(80))

        // Check all possible payment field locations
        const priceTotal = booking.price_total
        const amountPaid1 = booking.amount_paid
        const amountPaid2 = booking.booking_details?.amount_paid
        const amountPaid3 = booking.booking_details?.amountPaid
        const paymentStatus = booking.payment_status

        console.log(`💰 Payment Fields:`)
        console.log(`  price_total: ${priceTotal} (${typeof priceTotal})`)
        console.log(`  amount_paid (root): ${amountPaid1} (${typeof amountPaid1})`)
        console.log(`  booking_details.amount_paid: ${amountPaid2} (${typeof amountPaid2})`)
        console.log(`  booking_details.amountPaid: ${amountPaid3} (${typeof amountPaid3})`)
        console.log(`  payment_status: ${paymentStatus}`)

        // Show what our current logic would pick
        const detectedPaid = amountPaid1 || amountPaid2 || amountPaid3 || 0
        console.log(`\n✅ Detected paid amount: ${detectedPaid}`)

        // Show booking_details structure if it exists
        if (booking.booking_details) {
            console.log(`\n📦 booking_details keys:`, Object.keys(booking.booking_details))
            console.log(`Full booking_details:`, JSON.stringify(booking.booking_details, null, 2))
        } else {
            console.log(`\n📦 booking_details: null/undefined`)
        }
    })

    console.log(`\n${'='.repeat(80)}\n`)
}

debugPaymentFields().catch(console.error)
