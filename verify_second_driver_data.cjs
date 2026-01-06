const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

// Hardcoded values since .env is not loading properly
const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function verifySecondDriverData() {
    console.log('🔍 VERIFYING SECOND DRIVER DATA IN DATABASE\n')
    console.log('='.repeat(80))

    // Fetch the most recent bookings
    const { data: bookings, error } = await supabase
        .from('bookings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20)

    if (error) {
        console.error('❌ Error fetching bookings:', error)
        return
    }

    if (!bookings || bookings.length === 0) {
        console.log('⚠️  No bookings found.')
        return
    }

    // Find bookings with second driver
    const bookingsWithSecondDriver = bookings.filter(b =>
        b.booking_details &&
        b.booking_details.second_driver &&
        (b.booking_details.second_driver.name || b.booking_details.second_driver.nome)
    )

    if (bookingsWithSecondDriver.length === 0) {
        console.log('⚠️  No bookings found with second driver data in the last 20 bookings.')
        console.log('\n📋 Showing last 5 bookings to help debug:')
        bookings.slice(0, 5).forEach((b, i) => {
            console.log(`\n${i + 1}. Booking ID: ${b.id}`)
            console.log(`   Customer: ${b.customer_name}`)
            console.log(`   Vehicle: ${b.vehicle_name}`)
            console.log(`   Created: ${b.created_at}`)
            console.log(`   Has second_driver in booking_details: ${b.booking_details?.second_driver ? 'YES' : 'NO'}`)
            if (b.booking_details?.second_driver) {
                console.log(`   Second driver keys:`, Object.keys(b.booking_details.second_driver))
            }
        })
        return
    }

    console.log(`✅ Found ${bookingsWithSecondDriver.length} booking(s) with second driver data\n`)

    // Analyze the most recent one
    const booking = bookingsWithSecondDriver[0]
    const sd = booking.booking_details.second_driver

    console.log('📄 MOST RECENT BOOKING WITH SECOND DRIVER')
    console.log('='.repeat(80))
    console.log(`Booking ID: ${booking.id}`)
    console.log(`Customer: ${booking.customer_name}`)
    console.log(`Vehicle: ${booking.vehicle_name}`)
    console.log(`Created: ${booking.created_at}`)
    console.log(`\n🔑 SECOND DRIVER OBJECT KEYS:`)
    console.log(Object.keys(sd).join(', '))

    console.log(`\n📊 SECOND DRIVER FIELD ANALYSIS:`)
    console.log('='.repeat(80))

    const fields = [
        { label: 'Name', keys: ['name', 'nome'] },
        { label: 'Surname', keys: ['surname', 'cognome'] },
        { label: 'Codice Fiscale', keys: ['codice_fiscale', 'tax_code'] },
        { label: 'Sesso', keys: ['sesso', 'gender'] },
        { label: 'Indirizzo', keys: ['indirizzo', 'address'] },
        { label: 'CAP', keys: ['cap', 'zip_code'] },
        { label: 'Città', keys: ['citta', 'city'] },
        { label: 'Provincia', keys: ['provincia', 'province'] },
        { label: 'Birth Date', keys: ['birth_date', 'data_nascita'] },
        { label: 'Birth Place', keys: ['birth_place', 'luogo_nascita', 'birth_city'] },
        { label: 'Birth Provincia', keys: ['birth_provincia', 'provincia_nascita'] },
        { label: 'Phone', keys: ['phone', 'telefono'] },
        { label: 'Email', keys: ['email'] },
        { label: 'License Number', keys: ['license_number', 'patente'] },
        { label: 'License Type', keys: ['license_type', 'tipo_patente'] },
        { label: 'License Expiry', keys: ['license_expiry', 'license_expiry_date', 'scadenza_patente'] },
    ]

    fields.forEach(field => {
        const value = field.keys.map(k => sd[k]).find(v => v !== undefined && v !== null && v !== '')
        const foundKey = field.keys.find(k => sd[k] !== undefined && sd[k] !== null && sd[k] !== '')
        const status = value ? '✅' : '❌'
        console.log(`${status} ${field.label.padEnd(20)} = ${value || 'EMPTY'} ${foundKey ? `(key: ${foundKey})` : ''}`)
    })

    console.log('\n📝 FULL SECOND DRIVER OBJECT:')
    console.log('='.repeat(80))
    console.log(JSON.stringify(sd, null, 2))

    console.log('\n🎯 CONTRACT GENERATION MAPPING TEST:')
    console.log('='.repeat(80))
    console.log('Testing what values would be sent to the PDF...\n')

    const mappingTests = {
        'SecondDriverName': (sd?.name && sd?.surname) ? `${sd.name} ${sd.surname}` : 'EMPTY',
        'SecondDriverTaxCode': sd?.tax_code || sd?.codice_fiscale || 'EMPTY',
        'SecondDriverCity': sd?.city || sd?.citta || 'EMPTY',
        'SecondDriverAddress': sd?.address || sd?.indirizzo || 'EMPTY',
        'SecondDriverProvince': sd?.province || sd?.provincia || 'EMPTY',
        'SecondDriverZipCode': sd?.zip_code || sd?.cap || 'EMPTY',
        'SecondDriverSex': sd?.gender || sd?.sesso || 'EMPTY',
        'SecondDriverPhone': sd?.phone || 'EMPTY',
        'SecondDriverEmail': sd?.email || 'EMPTY',
    }

    Object.entries(mappingTests).forEach(([key, value]) => {
        const status = value !== 'EMPTY' ? '✅' : '❌'
        console.log(`${status} ${key.padEnd(30)} → "${value}"`)
    })

    console.log('\n' + '='.repeat(80))
    console.log('💡 RECOMMENDATIONS:')
    console.log('='.repeat(80))

    const emptyFields = Object.entries(mappingTests).filter(([k, v]) => v === 'EMPTY')
    if (emptyFields.length > 0) {
        console.log('⚠️  The following fields are EMPTY in the database:')
        emptyFields.forEach(([key]) => console.log(`   - ${key}`))
        console.log('\n   This means the data was NOT saved when the booking was created.')
        console.log('   You need to re-enter the second driver information and save again.')
    } else {
        console.log('✅ All second driver fields have data!')
        console.log('   If the contract is still empty, the issue is with PDF field names.')
        console.log('   Please check that your PDF fields match the keys shown above.')
    }
}

verifySecondDriverData().catch(console.error)
