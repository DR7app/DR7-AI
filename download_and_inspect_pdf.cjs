const { createClient } = require('@supabase/supabase-js')
const { PDFDocument } = require('pdf-lib')
const fs = require('fs')
require('dotenv').config()

const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function downloadAndInspectPDF() {
    console.log('📥 Downloading master_contract.pdf from Supabase storage...\n')

    // Download the PDF from Supabase storage
    const { data, error } = await supabase.storage
        .from('templates')
        .download('master_contract.pdf')

    if (error) {
        console.error('❌ Error downloading PDF:', error)
        return
    }

    console.log('✅ PDF downloaded successfully!\n')

    // Convert blob to buffer
    const arrayBuffer = await data.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Save locally for inspection
    fs.writeFileSync('downloaded_master_contract.pdf', buffer)
    console.log('💾 Saved to: downloaded_master_contract.pdf\n')

    // Load and inspect with pdf-lib
    try {
        const pdfDoc = await PDFDocument.load(arrayBuffer)
        const form = pdfDoc.getForm()
        const fields = form.getFields()

        console.log('='.repeat(80))
        console.log(`📋 TOTAL FORM FIELDS FOUND: ${fields.length}`)
        console.log('='.repeat(80))

        if (fields.length === 0) {
            console.log('\n⚠️  No form fields found in the PDF!')
            return
        }

        // Categorize fields
        const secondDriverFields = []
        const firstDriverFields = []
        const otherFields = []

        fields.forEach(field => {
            const name = field.getName()
            const lowerName = name.toLowerCase()

            if (lowerName.includes('second') ||
                lowerName.includes('2') ||
                (lowerName.includes('guidatore') && lowerName.includes('secondo')) ||
                lowerName.includes('driver2')) {
                secondDriverFields.push(name)
            } else if (lowerName.includes('driver') ||
                lowerName.includes('guidatore') ||
                lowerName.includes('cliente') ||
                lowerName.includes('customer')) {
                firstDriverFields.push(name)
            } else {
                otherFields.push(name)
            }
        })

        console.log('\n🎯 SECOND DRIVER FIELDS (' + secondDriverFields.length + '):')
        console.log('='.repeat(80))
        if (secondDriverFields.length > 0) {
            secondDriverFields.forEach(name => console.log(`  ✓ ${name}`))
        } else {
            console.log('  ⚠️  No second driver fields found!')
        }

        console.log('\n👤 FIRST DRIVER/CUSTOMER FIELDS (' + firstDriverFields.length + '):')
        console.log('='.repeat(80))
        firstDriverFields.slice(0, 15).forEach(name => console.log(`  • ${name}`))
        if (firstDriverFields.length > 15) {
            console.log(`  ... and ${firstDriverFields.length - 15} more`)
        }

        console.log('\n📄 OTHER FIELDS (' + otherFields.length + '):')
        console.log('='.repeat(80))
        otherFields.slice(0, 20).forEach(name => console.log(`  • ${name}`))
        if (otherFields.length > 20) {
            console.log(`  ... and ${otherFields.length - 20} more`)
        }

        console.log('\n' + '='.repeat(80))
        console.log('💡 ALL FIELD NAMES (for copy-paste):')
        console.log('='.repeat(80))
        fields.forEach(f => console.log(f.getName()))

    } catch (error) {
        console.error('❌ Error parsing PDF:', error)
    }
}

downloadAndInspectPDF().catch(console.error)
