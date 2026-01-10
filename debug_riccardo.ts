import { createClient } from '@supabase/supabase-js'

// Load from environment or use placeholders
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qrfvpjvqjxqvfmvbxbvf.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function debugRiccardoPilia() {
    console.log('🔍 Searching for Riccardo PILIA...\n')

    // 1. Search in customers_extended
    console.log('1️⃣ Searching customers_extended table:')
    const { data: customersExt, error: custError } = await supabase
        .from('customers_extended')
        .select('*')
        .or('nome.ilike.%riccardo%,cognome.ilike.%pilia%,email.ilike.%riccardo%,email.ilike.%pilia%')

    if (custError) {
        console.error('Error:', custError)
    } else {
        console.log(`Found ${customersExt?.length || 0} customers:`)
        customersExt?.forEach(c => {
            console.log(`  - ID: ${c.id}`)
            console.log(`    Name: ${c.nome} ${c.cognome}`)
            console.log(`    Email: ${c.email}`)
            console.log(`    Phone: ${c.telefono}`)
            console.log('')
        })
    }

    // 2. Search in bookings
    console.log('\n2️⃣ Searching bookings table:')
    const { data: bookings, error: bookError } = await supabase
        .from('bookings')
        .select('id, user_id, customer_name, customer_email, customer_phone, vehicle_name, pickup_date, status, booking_details')
        .or('customer_name.ilike.%riccardo%,customer_name.ilike.%pilia%,customer_email.ilike.%riccardo%,customer_email.ilike.%pilia%')
        .order('created_at', { ascending: false })
        .limit(5)

    if (bookError) {
        console.error('Error:', bookError)
    } else {
        console.log(`Found ${bookings?.length || 0} bookings:`)
        bookings?.forEach(b => {
            console.log(`  - Booking ID: ${b.id}`)
            console.log(`    User ID: ${b.user_id}`)
            console.log(`    Customer Name: ${b.customer_name}`)
            console.log(`    Customer Email: ${b.customer_email}`)
            console.log(`    Customer Phone: ${b.customer_phone}`)
            console.log(`    Vehicle: ${b.vehicle_name}`)
            console.log(`    Pickup: ${b.pickup_date}`)
            console.log(`    Status: ${b.status}`)
            console.log(`    booking_details.customer:`, b.booking_details?.customer)
            console.log('')
        })
    }

    // 3. Check auth.users
    console.log('\n3️⃣ Searching auth.users table:')
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers()

    if (authError) {
        console.error('Error:', authError)
    } else {
        const riccardoUsers = authUsers.users.filter(u =>
            u.email?.toLowerCase().includes('riccardo') ||
            u.email?.toLowerCase().includes('pilia') ||
            JSON.stringify(u.user_metadata).toLowerCase().includes('riccardo') ||
            JSON.stringify(u.user_metadata).toLowerCase().includes('pilia')
        )
        console.log(`Found ${riccardoUsers.length} auth users:`)
        riccardoUsers.forEach(u => {
            console.log(`  - ID: ${u.id}`)
            console.log(`    Email: ${u.email}`)
            console.log(`    Metadata:`, u.user_metadata)
            console.log('')
        })
    }

    // 4. Cross-reference: Find bookings and check if customer exists
    if (bookings && bookings.length > 0) {
        console.log('\n4️⃣ Cross-referencing booking user_ids with customers_extended:')
        for (const booking of bookings) {
            if (booking.user_id) {
                const { data: customer } = await supabase
                    .from('customers_extended')
                    .select('*')
                    .eq('id', booking.user_id)
                    .single()

                console.log(`  Booking ${booking.id.substring(0, 8)}... (user_id: ${booking.user_id.substring(0, 8)}...)`)
                if (customer) {
                    console.log(`    ✅ Customer FOUND in customers_extended: ${customer.nome} ${customer.cognome}`)
                } else {
                    console.log(`    ❌ Customer NOT FOUND in customers_extended`)
                    console.log(`    📋 Booking has: ${booking.customer_name} (${booking.customer_email})`)
                }
            }
        }
    }
}

debugRiccardoPilia().catch(console.error)
