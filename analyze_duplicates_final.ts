import { createClient } from '@supabase/supabase-js'

// Hardcoded for this analysis script
const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
// You'll need to provide the anon key - check your .env.local or Supabase dashboard
const supabaseAnonKey = process.argv[2] || ''

if (!supabaseAnonKey) {
    console.error('❌ Please provide the Supabase anon key as an argument')
    console.error('Usage: npx tsx analyze_duplicates_final.ts YOUR_ANON_KEY')
    console.error('\nOr check your Supabase dashboard for the anon key')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function analyzeDuplicates() {
    console.log('🔍 Analyzing duplicate customers...\n')

    // Fetch all customers
    const { data: customers, error } = await supabase
        .from('customers_extended')
        .select('id, email, telefono, nome, cognome, ragione_sociale, source, codice_fiscale, indirizzo, data_nascita')

    if (error) {
        console.error('❌ Error fetching customers:', error)
        return
    }

    console.log(`📊 Total customers in database: ${customers?.length}\n`)

    // Analyze duplicates by email
    console.log('='.repeat(80))
    console.log('DUPLICATES BY EMAIL')
    console.log('='.repeat(80) + '\n')

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

    const emailDuplicates = Array.from(emailMap.entries())
        .filter(([_, custs]) => custs.length > 1)
        .sort((a, b) => b[1].length - a[1].length)

    console.log(`Found ${emailDuplicates.length} duplicate emails\n`)

    let totalDuplicateRecords = 0
    emailDuplicates.slice(0, 20).forEach(([email, custs], index) => {
        totalDuplicateRecords += custs.length - 1 // -1 because we keep one

        console.log(`${index + 1}. Email: ${email}`)
        console.log(`   Duplicates: ${custs.length} records`)

        custs.forEach((c, i) => {
            const name = c.nome && c.cognome ? `${c.nome} ${c.cognome}` : c.ragione_sociale || 'Unknown'
            const hasData = [
                c.codice_fiscale ? 'CF' : null,
                c.indirizzo ? 'Addr' : null,
                c.data_nascita ? 'DOB' : null,
                c.telefono ? 'Phone' : null
            ].filter(Boolean).join(', ')

            console.log(`   ${i + 1}) ${name} | Source: ${c.source || 'unknown'} | Has: ${hasData || 'minimal data'}`)
            console.log(`      ID: ${c.id}`)
        })
        console.log('')
    })

    // Analyze duplicates by phone
    console.log('\n' + '='.repeat(80))
    console.log('DUPLICATES BY PHONE')
    console.log('='.repeat(80) + '\n')

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

    const phoneDuplicates = Array.from(phoneMap.entries())
        .filter(([_, custs]) => custs.length > 1)
        .sort((a, b) => b[1].length - a[1].length)

    console.log(`Found ${phoneDuplicates.length} duplicate phone numbers\n`)

    phoneDuplicates.slice(0, 20).forEach(([phone, custs], index) => {
        console.log(`${index + 1}. Phone: ${phone}`)
        console.log(`   Duplicates: ${custs.length} records`)

        custs.forEach((c, i) => {
            const name = c.nome && c.cognome ? `${c.nome} ${c.cognome}` : c.ragione_sociale || 'Unknown'
            const email = c.email || 'no email'
            const hasData = [
                c.codice_fiscale ? 'CF' : null,
                c.indirizzo ? 'Addr' : null,
                c.data_nascita ? 'DOB' : null
            ].filter(Boolean).join(', ')

            console.log(`   ${i + 1}) ${name} | ${email} | Source: ${c.source || 'unknown'} | Has: ${hasData || 'minimal data'}`)
            console.log(`      ID: ${c.id}`)
        })
        console.log('')
    })

    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('SUMMARY')
    console.log('='.repeat(80))
    console.log(`Total customers: ${customers?.length}`)
    console.log(`Duplicate emails: ${emailDuplicates.length}`)
    console.log(`Duplicate phones: ${phoneDuplicates.length}`)
    console.log(`Estimated duplicate records to merge: ~${totalDuplicateRecords}`)
    console.log('')
}

analyzeDuplicates()
    .then(() => {
        console.log('✅ Analysis complete!')
        process.exit(0)
    })
    .catch(err => {
        console.error('❌ Fatal error:', err)
        process.exit(1)
    })
