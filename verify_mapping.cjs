const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function verifyMapping() {
    // Get the booking to find the actual customer_id being used
    const bookingId = 'c5629bb3-9f3e-46f7-9eff-737ee5b2ffd4'

    const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single()

    if (bookingError) {
        console.error('Error fetching booking:', bookingError)
        return
    }

    console.log('📋 BOOKING SECOND DRIVER DATA:')
    console.log('customer_id:', booking.booking_details?.second_driver?.customer_id)
    console.log('name:', booking.booking_details?.second_driver?.name)
    console.log('surname:', booking.booking_details?.second_driver?.surname)
    console.log('')

    const secondDriverId = booking.booking_details?.second_driver?.customer_id

    if (!secondDriverId) {
        console.log('⚠️  No customer_id found for second driver')
        return
    }

    // Try to fetch from customers_extended
    const { data: custExt, error: extError } = await supabase
        .from('customers_extended')
        .select('*')
        .eq('id', secondDriverId)
        .maybeSingle()

    console.log('📋 CUSTOMERS_EXTENDED LOOKUP:')
    if (extError) {
        console.error('Error:', extError)
    } else if (custExt) {
        console.log('✅ FOUND! Checking field mappings...\n')

        console.log('Birth Date:')
        console.log('  data_nascita:', custExt.data_nascita || 'MISSING')
        console.log('  Expected in contract: 1989-11-25')

        console.log('\nBirth Place:')
        console.log('  luogo_nascita:', custExt.luogo_nascita || 'MISSING')
        console.log('  Expected in contract: Lecco (CO)')

        console.log('\nBirth Province:')
        console.log('  provincia_nascita:', custExt.provincia_nascita || 'MISSING')
        console.log('  Expected in contract: CO')

        console.log('\nLicense Type:')
        console.log('  categoria_patente:', custExt.categoria_patente || 'MISSING')
        console.log('  Expected in contract: B')

        console.log('\nLicense Number:')
        console.log('  numero_patente:', custExt.numero_patente || 'MISSING')
        console.log('  Expected in contract: 38767')

        console.log('\nLicense Issued By:')
        console.log('  ente_rilascio:', custExt.ente_rilascio || 'MISSING')
        console.log('  Expected in contract: MIT-SMR')

        console.log('\nLicense Issue Date:')
        console.log('  data_rilascio:', custExt.data_rilascio || 'MISSING')
        console.log('  Expected in contract: 2008-01-11')

        console.log('\nLicense Expiry:')
        console.log('  data_scadenza:', custExt.data_scadenza || 'MISSING')
        console.log('  Expected in contract: 2029-11-25')

        console.log('\n📝 ALL FIELDS IN RECORD:')
        console.log(Object.keys(custExt).sort().join(', '))
    } else {
        console.log('❌ NOT FOUND in customers_extended')

        // Try customers table
        const { data: cust, error: custError } = await supabase
            .from('customers')
            .select('*')
            .eq('id', secondDriverId)
            .maybeSingle()

        console.log('\n📋 CUSTOMERS TABLE LOOKUP:')
        if (custError) {
            console.error('Error:', custError)
        } else if (cust) {
            console.log('✅ FOUND in customers table!')
            console.log('Fields:', Object.keys(cust).join(', '))
        } else {
            console.log('❌ NOT FOUND in customers table either')
        }
    }
}

verifyMapping()
