
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseServiceKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is required')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function main() {
    console.log('Checking recent customers in customers_extended...')

    const { data: customers, error } = await supabase
        .from('customers_extended')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(5)

    if (error) {
        console.error('Error fetching customers:', error)
        return
    }

    console.log(`Found ${customers.length} recent customers:`)
    customers.forEach(c => {
        console.log('------------------------------------------------')
        console.log(`ID: ${c.id}`)
        console.log(`Name: ${c.nome} ${c.cognome}`)
        console.log(`Email: ${c.email}`)
        console.log(`Phone: ${c.telefono}`)
        console.log(`Updated: ${c.updated_at}`)
        console.log(`Created: ${c.created_at}`)
        // Check for fields likely to be "missing" that we just added
        console.log(`Date of Birth: ${c.data_nascita}`)
        console.log(`License: ${c.patente}`)
        console.log(`Address: ${c.indirizzo}, ${c.citta_residenza}`)
    })
}

main()
