// Debug script to check booking and customer data for contract generation
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseKey) {
    console.error('❌ Missing VITE_SUPABASE_ANON_KEY environment variable')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function debugContractData() {
    console.log('🔍 Fetching recent booking...\n')

    // Get the most recent booking
    const { data: bookings, error: bookingError } = await supabase
        .from('bookings')
        .select('*')
        .not('pickup_date', 'is', null)
        .neq('service_type', 'car_wash')
        .neq('service_type', 'mechanical_service')
        .order('created_at', { ascending: false })
        .limit(1)

    if (bookingError) {
        console.error('❌ Error fetching booking:', bookingError)
        return
    }

    if (!bookings || bookings.length === 0) {
        console.log('❌ No bookings found')
        return
    }

    const booking = bookings[0]
    console.log('📋 BOOKING DATA:')
    console.log('  ID:', booking.id)
    console.log('  Customer Name:', booking.customer_name)
    console.log('  Customer Email:', booking.customer_email)
    console.log('  Customer Phone:', booking.customer_phone)
    console.log('  User ID:', booking.user_id)
    console.log('  Vehicle:', booking.vehicle_name)
    console.log('  Pickup:', booking.pickup_date)
    console.log('  Dropoff:', booking.dropoff_date)
    console.log('\n📦 BOOKING DETAILS:')
    console.log(JSON.stringify(booking.booking_details, null, 2))

    // Try to find customer
    const customerId = booking.user_id || booking.booking_details?.customer?.customerId
    console.log('\n🔍 Looking for customer with ID:', customerId)

    if (customerId) {
        const { data: customer, error: customerError } = await supabase
            .from('customers_extended')
            .select('*')
            .eq('id', customerId)
            .single()

        if (customerError) {
            console.log('❌ Error fetching customer by ID:', customerError.message)
        } else if (customer) {
            console.log('\n✅ CUSTOMER FOUND BY ID:')
            console.log(JSON.stringify(customer, null, 2))
        } else {
            console.log('❌ No customer found by ID')
        }
    }

    // Try by email
    if (booking.customer_email) {
        console.log('\n🔍 Looking for customer by email:', booking.customer_email)

        const { data: customer, error: customerError } = await supabase
            .from('customers_extended')
            .select('*')
            .eq('email', booking.customer_email)
            .single()

        if (customerError) {
            console.log('❌ Error fetching customer by email:', customerError.message)
        } else if (customer) {
            console.log('\n✅ CUSTOMER FOUND BY EMAIL:')
            console.log(JSON.stringify(customer, null, 2))
        } else {
            console.log('❌ No customer found by email in customers_extended')

            // Try basic customers table
            const { data: basicCustomer, error: basicError } = await supabase
                .from('customers')
                .select('*')
                .eq('email', booking.customer_email)
                .single()

            if (basicError) {
                console.log('❌ Error fetching from basic customers:', basicError.message)
            } else if (basicCustomer) {
                console.log('\n✅ CUSTOMER FOUND IN BASIC CUSTOMERS TABLE:')
                console.log(JSON.stringify(basicCustomer, null, 2))
            } else {
                console.log('❌ No customer found in basic customers table either')
            }
        }
    }

    // List all customers_extended to see what's there
    console.log('\n📊 CHECKING CUSTOMERS_EXTENDED TABLE:')
    const { data: allCustomers, error: allError } = await supabase
        .from('customers_extended')
        .select('id, email, nome, cognome, denominazione, tipo_cliente')
        .limit(5)

    if (allError) {
        console.log('❌ Error fetching customers_extended:', allError.message)
    } else {
        console.log(`Found ${allCustomers?.length || 0} customers in customers_extended (showing first 5):`)
        allCustomers?.forEach(c => {
            console.log(`  - ${c.tipo_cliente}: ${c.nome || c.denominazione} (${c.email}) [ID: ${c.id}]`)
        })
    }
}

debugContractData().catch(console.error)
