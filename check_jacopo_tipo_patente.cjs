const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function findJacopoByName() {
    const { data, error } = await supabase
        .from('customers_extended')
        .select('*')
        .eq('nome', 'Jacopo')
        .eq('cognome', 'Cerutti')
        .maybeSingle()

    if (error) {
        console.error('Error:', error)
        return
    }

    if (!data) {
        console.log('❌ Not found')
        return
    }

    console.log('✅ FOUND Jacopo Cerutti!')
    console.log('\n📋 LICENSE TYPE FIELDS:')
    console.log('  tipo_patente:', data.tipo_patente || 'NULL')
    console.log('  patente:', data.patente || 'NULL')
    console.log('  categoria_patente:', data.categoria_patente || 'NULL (column may not exist)')

    console.log('\n📋 OTHER LICENSE FIELDS:')
    console.log('  numero_patente:', data.numero_patente)
    console.log('  emessa_da:', data.emessa_da)
    console.log('  data_rilascio_patente:', data.data_rilascio_patente)
    console.log('  scadenza_patente:', data.scadenza_patente)

    console.log('\n📝 ALL COLUMNS:')
    const cols = Object.keys(data).sort()
    const licenseRelated = cols.filter(c => c.includes('patente') || c.includes('license') || c.includes('categoria'))
    console.log('License-related columns:', licenseRelated.join(', '))
}

findJacopoByName()
