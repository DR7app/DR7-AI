import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials in .env file')
    console.error('Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function findDuplicatesByEmail() {
    console.log('🔍 Finding duplicate customers by email...\n')

    const { data, error } = await supabase.rpc('find_duplicates_by_email')

    if (error) {
        console.error('Error:', error)
        // Fallback: run query directly
        const query = `
      SELECT 
        email,
        COUNT(*) as duplicate_count,
        STRING_AGG(id::text, ', ') as customer_ids,
        STRING_AGG(COALESCE(nome || ' ' || cognome, ragione_sociale, 'Unknown'), ' | ') as names,
        STRING_AGG(COALESCE(source, 'unknown'), ' | ') as sources
      FROM customers_extended
      WHERE email IS NOT NULL AND email != ''
      GROUP BY email
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC
      LIMIT 50
    `

        const { data: directData, error: directError } = await supabase.rpc('exec_sql', { query })

        if (directError) {
            console.error('Direct query error:', directError)
            return
        }

        console.log('Results:', directData)
    } else {
        console.log('Results:', data)
    }
}

async function findDuplicatesByPhone() {
    console.log('\n🔍 Finding duplicate customers by phone...\n')

    const query = `
    SELECT 
      telefono,
      COUNT(*) as duplicate_count,
      STRING_AGG(id::text, ', ') as customer_ids,
      STRING_AGG(COALESCE(nome || ' ' || cognome, ragione_sociale, 'Unknown'), ' | ') as names,
      STRING_AGG(COALESCE(email, 'no email'), ' | ') as emails
    FROM customers_extended
    WHERE telefono IS NOT NULL AND telefono != ''
    GROUP BY telefono
    HAVING COUNT(*) > 1
    ORDER BY duplicate_count DESC
    LIMIT 50
  `

    // Since we can't execute arbitrary SQL easily, let's fetch all customers and analyze in JS
    const { data: customers, error } = await supabase
        .from('customers_extended')
        .select('id, email, telefono, nome, cognome, ragione_sociale, source')

    if (error) {
        console.error('Error fetching customers:', error)
        return
    }

    // Group by phone
    const phoneMap = new Map<string, any[]>()
    customers?.forEach(c => {
        if (c.telefono && c.telefono.trim()) {
            const phone = c.telefono.trim()
            if (!phoneMap.has(phone)) {
                phoneMap.set(phone, [])
            }
            phoneMap.get(phone)!.push(c)
        }
    })

    // Find duplicates
    const duplicates = Array.from(phoneMap.entries())
        .filter(([_, customers]) => customers.length > 1)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 50)

    console.log(`Found ${duplicates.length} duplicate phone numbers\n`)

    duplicates.forEach(([phone, custs]) => {
        const names = custs.map(c => c.nome && c.cognome ? `${c.nome} ${c.cognome}` : c.ragione_sociale || 'Unknown').join(' | ')
        const emails = custs.map(c => c.email || 'no email').join(' | ')
        const ids = custs.map(c => c.id).join(', ')

        console.log(`Phone: ${phone}`)
        console.log(`  Count: ${custs.length}`)
        console.log(`  Names: ${names}`)
        console.log(`  Emails: ${emails}`)
        console.log(`  IDs: ${ids}`)
        console.log('')
    })
}

async function findDuplicatesByEmailJS() {
    console.log('🔍 Finding duplicate customers by email (JavaScript analysis)...\n')

    const { data: customers, error } = await supabase
        .from('customers_extended')
        .select('id, email, telefono, nome, cognome, ragione_sociale, source')

    if (error) {
        console.error('Error fetching customers:', error)
        return
    }

    // Group by email
    const emailMap = new Map<string, any[]>()
    customers?.forEach(c => {
        if (c.email && c.email.trim()) {
            const email = c.email.trim().toLowerCase()
            if (!emailMap.has(email)) {
                emailMap.set(email, [])
            }
            emailMap.get(email)!.push(c)
        }
    })

    // Find duplicates
    const duplicates = Array.from(emailMap.entries())
        .filter(([_, customers]) => customers.length > 1)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 50)

    console.log(`Found ${duplicates.length} duplicate emails\n`)

    duplicates.forEach(([email, custs]) => {
        const names = custs.map(c => c.nome && c.cognome ? `${c.nome} ${c.cognome}` : c.ragione_sociale || 'Unknown').join(' | ')
        const sources = custs.map(c => c.source || 'unknown').join(' | ')
        const ids = custs.map(c => c.id).join(', ')

        console.log(`Email: ${email}`)
        console.log(`  Count: ${custs.length}`)
        console.log(`  Names: ${names}`)
        console.log(`  Sources: ${sources}`)
        console.log(`  IDs: ${ids}`)
        console.log('')
    })
}

// Run both analyses
findDuplicatesByEmailJS()
    .then(() => findDuplicatesByPhone())
    .then(() => {
        console.log('\n✅ Analysis complete!')
        process.exit(0)
    })
    .catch(err => {
        console.error('Fatal error:', err)
        process.exit(1)
    })
