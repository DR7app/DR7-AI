/**
 * Simple script to inspect PDF form fields
 * Run with: npx tsx scripts/inspect-pdf-simple.js
 */

import { createClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'
import fs from 'fs'

// You can temporarily hardcode your keys here for this diagnostic script
const SUPABASE_URL = 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzM5MTg5MzAsImV4cCI6MjA0OTQ5NDkzMH0.Hy8yzWKEQqGhDnXlqLpGKnqfNOLjBqxNhZJGGCNYPNI' // anon key from your codebase

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function inspectPDF() {
    try {
        console.log('📥 Downloading PDF template...')

        const { data, error } = await supabase.storage
            .from('templates')
            .download('master_contract.pdf')

        if (error || !data) {
            console.error('❌ Download failed:', error?.message)

            // List files
            const { data: files } = await supabase.storage.from('templates').list()
            console.log('📁 Files in bucket:', files?.map(f => f.name))
            return
        }

        console.log('✅ Downloaded, loading PDF...')
        const bytes = await data.arrayBuffer()
        const pdf = await PDFDocument.load(bytes)

        console.log(`📄 Pages: ${pdf.getPageCount()}`)

        const form = pdf.getForm()
        const fields = form.getFields()

        console.log(`\n📋 FORM FIELDS: ${fields.length}\n`)
        console.log('='.repeat(80))

        if (fields.length === 0) {
            console.log('⚠️  NO FORM FIELDS FOUND!')
            console.log('This PDF does not have editable form fields.')
        } else {
            const fieldList = []

            fields.forEach((field, i) => {
                const name = field.getName()
                const type = field.constructor.name
                console.log(`${String(i + 1).padStart(3)}. "${name}" (${type})`)
                fieldList.push({ name, type })
            })

            // Save to file
            fs.writeFileSync(
                './pdf-fields.json',
                JSON.stringify(fieldList, null, 2)
            )

            console.log('='.repeat(80))
            console.log('✅ Saved to pdf-fields.json')
        }

    } catch (err) {
        console.error('❌ Error:', err.message)
    }
}

inspectPDF()
