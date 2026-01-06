const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkJacopoData() {
    const customerId = '44c9bac7-4fb2-4ec0-90a1-ecd5fbf758d8'

    const { data, error } = await supabase
        .from('customers_extended')
        .select('*')
        .eq('id', customerId)
        .single()

    if (error) {
        console.error('Error:', error)
        return
    }

    console.log('📋 Jacopo Cerutti - customers_extended record:\n')
    console.log('Birth Date (data_nascita):', data.data_nascita || 'MISSING')
    console.log('Birth Place (luogo_nascita):', data.luogo_nascita || 'MISSING')
    console.log('Birth Province (provincia_nascita):', data.provincia_nascita || 'MISSING')
    console.log('License Type (categoria_patente):', data.categoria_patente || 'MISSING')
    console.log('License Number (numero_patente):', data.numero_patente || 'MISSING')
    console.log('License Issued By (ente_rilascio):', data.ente_rilascio || 'MISSING')
    console.log('License Issue Date (data_rilascio):', data.data_rilascio || 'MISSING')
    console.log('License Expiry (data_scadenza):', data.data_scadenza || 'MISSING')

    console.log('\n📝 All keys in record:')
    console.log(Object.keys(data).sort().join(', '))
}

checkJacopoData()
