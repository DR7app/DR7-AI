const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkCustomerExtendedAgain() {
    const customerId = '44c9bac7-4fb2-4ec0-90a1-ecd5fbf758d8'

    console.log(`Checking customers_extended for ID: ${customerId}\n`)

    const { data, error, count } = await supabase
        .from('customers_extended')
        .select('*', { count: 'exact' })
        .eq('id', customerId)

    console.log('Query result:')
    console.log('  Error:', error)
    console.log('  Count:', count)
    console.log('  Data:', data)

    if (data && data.length > 0) {
        console.log('\n✅ FOUND! Here are the license fields:')
        const c = data[0]
        console.log('  categoria_patente:', c.categoria_patente)
        console.log('  ente_rilascio:', c.ente_rilascio)
        console.log('  data_rilascio:', c.data_rilascio)
        console.log('  data_scadenza:', c.data_scadenza)
    }
}

checkCustomerExtendedAgain()
