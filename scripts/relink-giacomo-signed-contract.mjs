#!/usr/bin/env node
// One-shot: relink Giacomo Orru' signed PDF to contracts.signed_pdf_url
//
// Run:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/relink-giacomo-signed-contract.mjs
//
// What it does:
//   1. Reads /Users/opheliegiraud/Downloads/DR71589_firmato.pdf
//   2. Uploads to bucket 'contracts' at signed/DR71666_5bdcf5f4_firmato_<ts>.pdf
//   3. Updates contracts row 347aad16-62cf-41e7-a03b-15035472e28c
//      → signed_pdf_url = <public url>, status = 'signed'

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PDF_PATH = '/Users/opheliegiraud/Downloads/DR71589_firmato.pdf'
const CONTRACT_ID = '347aad16-62cf-41e7-a03b-15035472e28c'
const BOOKING_ID = '5bdcf5f4-7fd7-46ed-bd2f-ee4a46d3b987'

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

const pdfBytes = readFileSync(PDF_PATH)
console.log(`Read ${pdfBytes.length} bytes from ${PDF_PATH}`)

const ts = Date.now()
const objectPath = `signed/DR71666_${BOOKING_ID.slice(0, 8)}_firmato_${ts}.pdf`

const { error: upErr } = await supabase.storage
  .from('contracts')
  .upload(objectPath, pdfBytes, {
    contentType: 'application/pdf',
    upsert: false,
  })

if (upErr) {
  console.error('Upload failed:', upErr)
  process.exit(1)
}
console.log(`Uploaded to contracts/${objectPath}`)

const { data: { publicUrl } } = supabase.storage.from('contracts').getPublicUrl(objectPath)
console.log(`Public URL: ${publicUrl}`)

const { error: updErr } = await supabase
  .from('contracts')
  .update({ signed_pdf_url: publicUrl, status: 'signed', updated_at: new Date().toISOString() })
  .eq('id', CONTRACT_ID)

if (updErr) {
  console.error('DB update failed:', updErr)
  process.exit(1)
}

console.log(`Done. Contract ${CONTRACT_ID} now has signed_pdf_url = ${publicUrl}`)
