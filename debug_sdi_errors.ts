import { createClient } from '@supabase/supabase-js'

// Hardcoded for debugging
const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzI4MTU1MzUsImV4cCI6MjA0ODM5MTUzNX0.nPwPqmMhHcOVDYdGKOhYXKRHYqXYtPfVXCKOVOEDTbE' // anon key from your code

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkSDIErrors() {
    console.log('=== Checking SDI Errors ===\n')

    // Get invoices with errors or sent status
    const { data: invoices, error } = await supabase
        .from('fatture')
        .select('numero_fattura, customer_name, importo_totale, sdi_status, sdi_response, sdi_sent_at, created_at')
        .not('sdi_status', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10)

    if (error) {
        console.error('Error fetching invoices:', error)
        return
    }

    if (!invoices || invoices.length === 0) {
        console.log('No invoices with SDI status found.')
        return
    }

    console.log(`Found ${invoices.length} invoices with SDI status:\n`)

    invoices.forEach((invoice, index) => {
        console.log(`\n--- Invoice ${index + 1} ---`)
        console.log(`Number: ${invoice.numero_fattura}`)
        console.log(`Customer: ${invoice.customer_name}`)
        console.log(`Amount: €${invoice.importo_totale}`)
        console.log(`SDI Status: ${invoice.sdi_status}`)
        console.log(`Sent At: ${invoice.sdi_sent_at || 'Not sent'}`)
        console.log(`Created: ${new Date(invoice.created_at).toLocaleString()}`)

        if (invoice.sdi_response) {
            console.log('\n📋 SDI Response:')
            if (typeof invoice.sdi_response === 'string') {
                console.log(invoice.sdi_response)
            } else {
                console.log(JSON.stringify(invoice.sdi_response, null, 2))
            }
        }
        console.log('---')
    })
}

checkSDIErrors().catch(console.error)
