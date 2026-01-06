const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function findJacopo() {
    // Search by name in customers_extended
    const { data: byName, error: nameError } = await supabase
        .from('customers_extended')
        .select('*')
        .or('nome.ilike.%Jacopo%,cognome.ilike.%Cerutti%')
        .limit(5)

    console.log('📋 Search by name in customers_extended:')
    if (nameError) {
        console.error('Error:', nameError)
    } else if (byName && byName.length > 0) {
        byName.forEach((c, i) => {
            console.log(`\n${i + 1}. ID: ${c.id}`)
            console.log(`   Nome: ${c.nome} ${c.cognome}`)
            console.log(`   Email: ${c.email}`)
            console.log(`   Codice Fiscale: ${c.codice_fiscale}`)
            console.log(`   Birth Date: ${c.data_nascita}`)
            console.log(`   Birth Place: ${c.luogo_nascita}`)
            console.log(`   License: ${c.numero_patente}`)
            console.log(`   License Type: ${c.categoria_patente}`)
            console.log(`   License Issued By: ${c.ente_rilascio}`)
            console.log(`   License Issue Date: ${c.data_rilascio}`)
            console.log(`   License Expiry: ${c.data_scadenza}`)
        })
    } else {
        console.log('No results')
    }
}

findJacopo()
