const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function findJacopoAnywhere() {
    console.log('🔍 Searching for Jacopo Cerutti by codice fiscale...\n')

    // Search in customers_extended by codice fiscale
    const { data: extByCF, error: extError } = await supabase
        .from('customers_extended')
        .select('*')
        .eq('codice_fiscale', 'CRTJCP89S25E507Y')
        .limit(5)

    if (extByCF && extByCF.length > 0) {
        console.log('✅ FOUND in customers_extended by codice_fiscale!')
        extByCF.forEach((c, i) => {
            console.log(`\n${i + 1}. ID: ${c.id}`)
            console.log(`   Nome: ${c.nome} ${c.cognome}`)
            console.log(`   Data Nascita: ${c.data_nascita}`)
            console.log(`   Luogo Nascita: ${c.luogo_nascita}`)
            console.log(`   Provincia Nascita: ${c.provincia_nascita}`)
            console.log(`   Categoria Patente: ${c.categoria_patente}`)
            console.log(`   Numero Patente: ${c.numero_patente}`)
            console.log(`   Ente Rilascio: ${c.ente_rilascio}`)
            console.log(`   Data Rilascio: ${c.data_rilascio}`)
            console.log(`   Data Scadenza: ${c.data_scadenza}`)
        })
        return
    }

    console.log('❌ Not found in customers_extended by codice_fiscale')

    // Try searching by name parts
    const { data: extByName } = await supabase
        .from('customers_extended')
        .select('*')
        .or('nome.ilike.%Jacopo%,cognome.ilike.%Cerutti%')
        .limit(10)

    if (extByName && extByName.length > 0) {
        console.log('\n✅ FOUND in customers_extended by name!')
        extByName.forEach((c, i) => {
            console.log(`\n${i + 1}. ID: ${c.id}`)
            console.log(`   Nome: ${c.nome} ${c.cognome}`)
            console.log(`   Codice Fiscale: ${c.codice_fiscale}`)
            console.log(`   Data Nascita: ${c.data_nascita}`)
        })
    } else {
        console.log('❌ Not found in customers_extended by name either')
    }
}

findJacopoAnywhere()
