import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://qrfvpjvqjxqvfmvbxbvf.supabase.co'
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.argv[2]

if (!SUPABASE_KEY) {
    console.error('❌ Please provide Supabase key as argument or VITE_SUPABASE_ANON_KEY env var')
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function fixRiccardoPilia() {
    const customerId = '4eba7599-5cd0-44dc-a93b-ff7b6384baf7'

    console.log('🔍 Step 1: Checking if Riccardo PILIA exists in customers_extended...')
    const { data: existing, error: checkError } = await supabase
        .from('customers_extended')
        .select('*')
        .eq('id', customerId)
        .single()

    if (checkError && checkError.code !== 'PGRST116') {
        console.error('❌ Error checking customer:', checkError)
        return
    }

    if (existing) {
        console.log('✅ Customer already exists:')
        console.log(`   Name: ${existing.nome} ${existing.cognome}`)
        console.log(`   Email: ${existing.email}`)
        console.log(`   Phone: ${existing.telefono}`)
        return
    }

    console.log('❌ Customer NOT found in customers_extended')
    console.log('\n📝 Step 2: Creating customer record...')

    const { data: newCustomer, error: insertError } = await supabase
        .from('customers_extended')
        .insert({
            id: customerId,
            tipo_cliente: 'persona_fisica',
            nome: 'RICCARDO',
            cognome: 'PILIA',
            email: 'r.p.system.srl@gmail.com',
            telefono: '+39 351 577 6809',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .select()
        .single()

    if (insertError) {
        console.error('❌ Error creating customer:', insertError)
        return
    }

    console.log('✅ Customer created successfully!')
    console.log(`   ID: ${newCustomer.id}`)
    console.log(`   Name: ${newCustomer.nome} ${newCustomer.cognome}`)
    console.log(`   Email: ${newCustomer.email}`)
    console.log(`   Phone: ${newCustomer.telefono}`)

    console.log('\n🎉 Fix complete! Riccardo PILIA should now appear in the customer selector.')
}

fixRiccardoPilia().catch(console.error)
