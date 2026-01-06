const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkJacopoData() {
    const customerId = '44c9bac7-4fb2-4ec0-90a1-ecd5fbf758d8'

    // Try customers table
    const { data: custData, error: custError } = await supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .maybeSingle()

    console.log('📋 customers table:')
    if (custError) {
        console.error('Error:', custError)
    } else if (custData) {
        console.log(JSON.stringify(custData, null, 2))
    } else {
        console.log('No record found')
    }

    // Try customers_extended table
    const { data: extData, error: extError } = await supabase
        .from('customers_extended')
        .select('*')
        .eq('id', customerId)
        .maybeSingle()

    console.log('\n📋 customers_extended table:')
    if (extError) {
        console.error('Error:', extError)
    } else if (extData) {
        console.log(JSON.stringify(extData, null, 2))
    } else {
        console.log('No record found')
    }
}

checkJacopoData()
