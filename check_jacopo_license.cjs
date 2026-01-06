const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function findJacopoWithLicenseData() {
    console.log('🔍 Searching for Jacopo by codice fiscale: CRTJCP89S25E507Y\n')

    const { data, error } = await supabase
        .from('customers_extended')
        .select('*')
        .eq('codice_fiscale', 'CRTJCP89S25E507Y')
        .maybeSingle()

    if (error) {
        console.error('Error:', error)
        return
    }

    if (!data) {
        console.log('❌ Customer not found')
        return
    }

    console.log('✅ FOUND! Customer ID:', data.id)
    console.log('\n📋 LICENSE FIELDS IN DATABASE:')
    console.log('  tipo_patente:', data.tipo_patente || 'NULL/EMPTY')
    console.log('  numero_patente:', data.numero_patente || 'NULL/EMPTY')
    console.log('  emessa_da:', data.emessa_da || 'NULL/EMPTY')
    console.log('  data_rilascio_patente:', data.data_rilascio_patente || 'NULL/EMPTY')
    console.log('  scadenza_patente:', data.scadenza_patente || 'NULL/EMPTY')

    console.log('\n📋 OTHER FIELDS:')
    console.log('  nome:', data.nome)
    console.log('  cognome:', data.cognome)
    console.log('  data_nascita:', data.data_nascita)
    console.log('  luogo_nascita:', data.luogo_nascita)

    console.log('\n📝 ALL COLUMN NAMES:')
    console.log(Object.keys(data).sort().join(', '))
}

findJacopoWithLicenseData()
