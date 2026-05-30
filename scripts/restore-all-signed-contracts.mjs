#!/usr/bin/env node
// BULK: restore signed_pdf_url on every contract row where the signed PDF
// still exists in Supabase Storage but the DB link was wiped.
//
// Run:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/restore-all-signed-contracts.mjs
//
// What it does:
//   1. Lists every file in bucket 'contracts' folder 'signed/'
//      (signed PDFs are named "<docIdentifier>_firmato_<timestamp>.pdf"
//      where docIdentifier = contract_number like "DR71589" or "CNT-XXX")
//   2. For each file, parses the contract_number from the filename
//   3. Looks up the contract row by contract_number
//   4. If contract.signed_pdf_url IS NULL, updates it to the file's public URL
//   5. Prints a summary (restored / already-linked / no-match / errors)
//
// Safe to re-run: only touches rows where signed_pdf_url IS NULL.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

console.log('1. Listing files in contracts/signed/ ...')

// List can paginate — gather everything.
const allFiles = []
let offset = 0
const BATCH = 100
while (true) {
  const { data, error } = await supabase.storage
    .from('contracts')
    .list('signed', { limit: BATCH, offset, sortBy: { column: 'created_at', order: 'desc' } })
  if (error) {
    console.error('List error:', error)
    process.exit(1)
  }
  if (!data || data.length === 0) break
  allFiles.push(...data)
  if (data.length < BATCH) break
  offset += BATCH
}

console.log(`   Found ${allFiles.length} files in signed/`)

// Parse contract_number from filename: "<docId>_firmato_<ts>.pdf"
function parseContractNumber(filename) {
  // Strip trailing "_firmato_<digits>.pdf" or "_firmato_completo.pdf"
  const m = filename.match(/^(.+?)_firmato(?:_.*)?\.pdf$/)
  return m ? m[1] : null
}

// Group files by contract_number, keep the most recent per contract
const fileByContract = new Map()
for (const f of allFiles) {
  const contractNumber = parseContractNumber(f.name)
  if (!contractNumber) continue
  const existing = fileByContract.get(contractNumber)
  // f.created_at is ISO; keep the most recent
  if (!existing || new Date(f.created_at) > new Date(existing.created_at)) {
    fileByContract.set(contractNumber, f)
  }
}

console.log(`2. Parsed ${fileByContract.size} distinct contract_numbers from filenames`)

// For each parsed contract, look up the row and decide
let restored = 0
let alreadyLinked = 0
let noMatch = 0
const errors = []
const restoredList = []

for (const [contractNumber, file] of fileByContract.entries()) {
  const { data: rows, error: selErr } = await supabase
    .from('contracts')
    .select('id, contract_number, signed_pdf_url, booking_id, customer_name')
    .eq('contract_number', contractNumber)
  if (selErr) { errors.push({ contractNumber, step: 'select', error: selErr.message }); continue }
  if (!rows || rows.length === 0) { noMatch++; continue }

  const row = rows[0]
  if (row.signed_pdf_url) { alreadyLinked++; continue }

  const objectPath = `signed/${file.name}`
  const { data: { publicUrl } } = supabase.storage.from('contracts').getPublicUrl(objectPath)

  const { error: updErr } = await supabase
    .from('contracts')
    .update({ signed_pdf_url: publicUrl, updated_at: new Date().toISOString() })
    .eq('id', row.id)
  if (updErr) { errors.push({ contractNumber, step: 'update', error: updErr.message }); continue }

  restored++
  restoredList.push({ contractNumber, customer: row.customer_name, file: file.name })
}

console.log('')
console.log('=== SUMMARY ===')
console.log(`Restored:        ${restored}`)
console.log(`Already linked:  ${alreadyLinked}`)
console.log(`No DB match:     ${noMatch}`)
console.log(`Errors:          ${errors.length}`)
if (restored > 0) {
  console.log('')
  console.log('Restored contracts:')
  for (const r of restoredList) {
    console.log(`  ${r.contractNumber}  ${r.customer || '(no name)'}  <- ${r.file}`)
  }
}
if (errors.length > 0) {
  console.log('')
  console.log('Errors:')
  for (const e of errors) console.log(`  ${e.contractNumber}: [${e.step}] ${e.error}`)
}
