const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
// Try with service role key if available
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU'

const supabase = createClient(supabaseUrl, serviceKey || anonKey)

async function listAllCustomers() {
    console.log('Using key type:', serviceKey ? 'SERVICE_ROLE' : 'ANON')
    console.log('\n📋 Listing ALL customers in customers_extended (limit 10):\n')

    const { data, error, count } = await supabase
        .from('customers_extended')
        .select('id, nome, cognome, codice_fiscale, categoria_patente', { count: 'exact' })
        .limit(10)

    if (error) {
        console.error('Error:', error)
        return
    }

    console.log(`Total count: ${count}`)
    console.log('\nFirst 10 customers:')
    data?.forEach((c, i) => {
        console.log(`${i + 1}. ${c.nome} ${c.cognome} (${c.codice_fiscale}) - ID: ${c.id.substring(0, 8)}...`)
        console.log(`   Has categoria_patente: ${c.categoria_patente ? 'YES' : 'NO'}`)
    })
}

listAllCustomers()
