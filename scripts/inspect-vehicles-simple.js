
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

function getEnv(key) {
    const envFiles = ['.env.local', '.env']
    for (const file of envFiles) {
        if (fs.existsSync(file)) {
            const content = fs.readFileSync(file, 'utf8')
            const match = content.match(new RegExp(`^${key}=['"]?([^'"]+)['"]?`, 'm'))
            if (match) return match[1]
        }
    }
    return process.env[key]
}

const supabaseUrl = getEnv('VITE_SUPABASE_URL') || getEnv('SUPABASE_URL')
const supabaseKey = getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('SUPABASE_ANON_KEY')

if (!supabaseUrl || !supabaseKey) {
    console.log('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function inspectSchema() {
    console.log('Inspecting vehicles table...')

    const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .limit(1)

    if (error) {
        console.error('Error selecting:', error)
        return
    }

    if (data && data.length > 0) {
        console.log('Columns found:', Object.keys(data[0]))
    } else {
        // If no data, try to look for metadata via error or just guess. 
        // Or insert a dummy if possible? No, safer to just see if we can read.
        console.log('No records found. Unable to inspect columns via select.')
    }
}

inspectSchema()
