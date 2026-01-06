const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU'

const supabase = createClient(supabaseUrl, anonKey)

async function getTableSchema() {
    const { data, error } = await supabase
        .from('customers_extended')
        .select('*')
        .limit(1)

    if (error) {
        console.error('Error:', error)
        return
    }

    if (data && data.length > 0) {
        console.log('📋 ACTUAL COLUMNS in customers_extended table:\n')
        const columns = Object.keys(data[0]).sort()
        columns.forEach(col => console.log(`  - ${col}`))

        console.log('\n🔍 License-related columns:')
        const licenseColumns = columns.filter(c =>
            c.includes('license') ||
            c.includes('patente') ||
            c.includes('rilascio') ||
            c.includes('scadenza') ||
            c.includes('driver')
        )
        licenseColumns.forEach(col => {
            console.log(`  ✓ ${col}: ${data[0][col] || '(empty)'}`)
        })
    } else {
        console.log('No data found')
    }
}

getTableSchema()
