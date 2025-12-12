/**
 * Script to inspect PDF form fields in the contract template
 * This will help us identify the exact field names to use in generate-contract.ts
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'
import fs from 'fs'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseServiceKey) {
    console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function inspectPDFFields() {
    try {
        console.log('📥 Downloading PDF template from Supabase...')

        const { data: templateData, error: templateError } = await supabase.storage
            .from('templates')
            .download('master_contract.pdf')

        if (templateError || !templateData) {
            console.error('❌ Failed to download template:', templateError)

            // List available files
            const { data: fileList } = await supabase.storage.from('templates').list()
            console.log('📁 Available files in templates bucket:', fileList?.map(f => f.name).join(', '))
            return
        }

        console.log('✅ Template downloaded successfully')
        console.log('📄 Loading PDF...')

        const templateBytes = await templateData.arrayBuffer()
        const pdfDoc = await PDFDocument.load(templateBytes)

        console.log('✅ PDF loaded successfully')
        console.log(`📊 Total pages: ${pdfDoc.getPageCount()}`)

        const form = pdfDoc.getForm()
        const fields = form.getFields()

        console.log(`\n📋 Total form fields found: ${fields.length}\n`)

        if (fields.length === 0) {
            console.log('⚠️  No form fields found in this PDF!')
            console.log('This PDF might not have editable form fields.')
            console.log('You may need to create a PDF with form fields using Adobe Acrobat or similar tools.')
        } else {
            console.log('='.repeat(80))
            console.log('FORM FIELD NAMES (copy these for your dataMap in generate-contract.ts)')
            console.log('='.repeat(80))

            const fieldData = []

            fields.forEach((field, index) => {
                const name = field.getName()
                const type = field.constructor.name

                fieldData.push({ index: index + 1, name, type })

                console.log(`${(index + 1).toString().padStart(3, ' ')}. ${name}`)
                console.log(`     Type: ${type}`)
                console.log('')
            })

            // Save to JSON file for easy reference
            const outputPath = './pdf-field-names.json'
            fs.writeFileSync(outputPath, JSON.stringify(fieldData, null, 2))
            console.log('='.repeat(80))
            console.log(`✅ Field names also saved to: ${outputPath}`)
            console.log('='.repeat(80))

            // Generate sample dataMap code
            console.log('\n📝 SAMPLE CODE FOR generate-contract.ts:\n')
            console.log('const dataMap = {')
            fieldData.slice(0, 10).forEach(field => {
                console.log(`    '${field.name}': '', // ${field.type}`)
            })
            if (fieldData.length > 10) {
                console.log(`    // ... ${fieldData.length - 10} more fields`)
            }
            console.log('}')
        }

    } catch (error) {
        console.error('❌ Error:', error.message)
        console.error(error)
    }
}

inspectPDFFields()
