const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function findJacopoInCustomers() {
    // Search in customers table
    const { data, error } = await supabase
        .from('customers')
        .select('*')
        .or('full_name.ilike.%Jacopo%,full_name.ilike.%Cerutti%,email.ilike.%cerutti%')
        .limit(5)

    console.log('📋 Search in customers table:')
    if (error) {
        console.error('Error:', error)
    } else if (data && data.length > 0) {
        data.forEach((c, i) => {
            console.log(`\n${i + 1}. ID: ${c.id}`)
            console.log(`   Full Name: ${c.full_name}`)
            console.log(`   Email: ${c.email}`)
            console.log(`   Phone: ${c.phone}`)
            console.log(`   License: ${c.driver_license_number}`)
            console.log(`   All keys:`, Object.keys(c).join(', '))
        })
    } else {
        console.log('No results')
    }
}

findJacopoInCustomers()
