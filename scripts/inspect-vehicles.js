
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.log('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function inspectSchema() {
    console.log('Inspecting vehicles table...')

    // Try to insert a dummy record to see structure or just select one
    const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .limit(1)

    if (error) {
        console.error('Error selecting:', error)
        return
    }

    if (data && data.length > 0) {
        console.log('Columns found in first record:', Object.keys(data[0]))
        console.log('Sample record:', data[0])
    } else {
        console.log('No records found to inspect columns directly. Trying RPC or just guessing.')
    }
}

inspectSchema()
