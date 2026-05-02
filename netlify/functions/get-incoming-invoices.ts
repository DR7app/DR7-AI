import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { searchIncomingInvoices, getIncomingInvoice } from './aruba-utils'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

interface Fornitore {
  id: string
  nome: string
  piva: string | null
}

function normalizeVat(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/\D/g, '')
}

async function loadTrackedFornitori(): Promise<Fornitore[]> {
  const { data, error } = await supabase
    .from('fornitori')
    .select('id, nome, piva')
    .eq('attivo', true)
  if (error) {
    console.warn('[get-incoming-invoices] fornitori lookup failed:', error.message)
    return []
  }
  return (data || []) as Fornitore[]
}

function buildSupplierMatcher(fornitori: Fornitore[]) {
  const vatSet = new Set<string>()
  const nameNeedles: string[] = []
  for (const f of fornitori) {
    const v = normalizeVat(f.piva)
    if (v) vatSet.add(v)
    if (f.nome) nameNeedles.push(f.nome.toLowerCase().trim())
  }
  return (senderName: string, senderVat: string): { matches: boolean; fornitore_id?: string } => {
    const v = normalizeVat(senderVat)
    if (v && vatSet.has(v)) {
      const f = fornitori.find(x => normalizeVat(x.piva) === v)
      return { matches: true, fornitore_id: f?.id }
    }
    const lower = (senderName || '').toLowerCase()
    if (!lower) return { matches: false }
    const f = fornitori.find(x => x.nome && lower.includes(x.nome.toLowerCase().trim()))
    if (f) return { matches: true, fornitore_id: f.id }
    return { matches: false }
  }
}

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  try {
    const params = event.queryStringParameters || {}
    const action = params.action || 'list'

    // Download a single invoice PDF/XML
    if (action === 'download' && params.filename) {
      const invoice = await getIncomingInvoice(params.filename, true)
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true, invoice })
      }
    }

    // List incoming invoices for the selected month
    const month = params.month // YYYY-MM format
    const mode = params.mode || 'tracked' // 'tracked' (filter to fornitori) | 'all' (no filter)
    let startDate: string | undefined
    let endDate: string | undefined

    if (month) {
      const [year, mo] = month.split('-')
      const daysInMonth = new Date(parseInt(year), parseInt(mo), 0).getDate()
      // Aruba wants ISO 8601 with timezone: yyyy-MM-ddTHH:mm:ss.fffzzz
      // Compute Europe/Rome offset for the chosen month (CET +01:00 / CEST +02:00 during DST).
      const monthMid = new Date(Date.UTC(parseInt(year), parseInt(mo) - 1, 15, 12, 0, 0))
      const romeStr = monthMid.toLocaleString('en-US', { timeZone: 'Europe/Rome', hour12: false })
      const utcStr = monthMid.toLocaleString('en-US', { timeZone: 'UTC', hour12: false })
      const offsetHours = Math.round((new Date(romeStr).getTime() - new Date(utcStr).getTime()) / 3600000)
      const tz = `${offsetHours >= 0 ? '+' : '-'}${String(Math.abs(offsetHours)).padStart(2, '0')}:00`
      startDate = `${year}-${mo}-01T00:00:00.000${tz}`
      endDate = `${year}-${mo}-${String(daysInMonth).padStart(2, '0')}T23:59:59.999${tz}`
    }

    // Fetch all incoming invoices for the period — paginate through all pages
    const PAGE_SIZE = 100
    const MAX_PAGES = 50  // safety cap (5000 invoices)
    const allInvoices: any[] = []
    let page = 0
    let firstResultLogged = false

    while (page < MAX_PAGES) {
      const result = await searchIncomingInvoices({
        startDate,
        endDate,
        page,
        pageSize: PAGE_SIZE
      })

      const pageInvoices: any[] = result.invoices || result.content || result.data || []

      if (page === 0 && !firstResultLogged) {
        console.log('[Aruba] response top-level keys:', Object.keys(result || {}))
        if (pageInvoices.length > 0) {
          console.log('[Aruba] first invoice keys:', Object.keys(pageInvoices[0] || {}))
          console.log('[Aruba] first invoice raw:', JSON.stringify(pageInvoices[0]).substring(0, 2000))
        }
        console.log('[Aruba] page meta:', {
          totalElements: result.totalElements,
          totalPages: result.totalPages,
          number: result.number,
          size: result.size,
          last: result.last
        })
        firstResultLogged = true
      }

      console.log(`[Aruba] page ${page}: ${pageInvoices.length} invoices`)
      allInvoices.push(...pageInvoices)

      // Stop conditions: empty page, fewer than PAGE_SIZE returned, or last=true flag
      if (pageInvoices.length === 0) break
      if (pageInvoices.length < PAGE_SIZE) break
      if (result.last === true) break
      if (typeof result.totalPages === 'number' && page + 1 >= result.totalPages) break

      page++
    }

    console.log(`[Aruba] total invoices fetched: ${allInvoices.length} across ${page + 1} page(s)`)

    // Match against fornitori table (replaces previous hardcoded list)
    const fornitori = await loadTrackedFornitori()
    const supplierMatcher = buildSupplierMatcher(fornitori)

    // Parse and normalize each invoice (always — filtering happens after)
    const parsed = allInvoices.map((inv: any) => {
      const sender = inv.senderDescription || inv.sender?.description || inv.cedentePrestatore?.denominazione || 'Sconosciuto'
      const senderVat = inv.senderCountryCode && inv.senderId
        ? `${inv.senderCountryCode}${inv.senderId}`
        : inv.sender?.vatCode || inv.cedentePrestatore?.idFiscaleIVA || ''

      // Amount parsing — Aruba response varies (try every common name)
      const rawAmount =
        inv.importoTotaleDocumento ?? inv.importoTotale ?? inv.totalAmount ?? inv.totalDocument ??
        inv.documentTotal ?? inv.invoiceTotal ?? inv.totale ?? inv.totaleDocumento ??
        inv.amount ?? inv.total ?? inv.amountTotal ?? inv.amountDocument ??
        inv.datiGenerali?.importoTotaleDocumento ??
        inv.cedentePrestatore?.importoTotale ?? null
      const amount = rawAmount != null ? parseFloat(String(rawAmount).replace(',', '.')) : 0

      // Date parsing — Aruba format varies
      const rawDate =
        inv.documentDate || inv.invoiceDate || inv.dataFattura || inv.dataDocumento ||
        inv.dataEmissione || inv.date || inv.uploadDate || ''
      let invoiceDate = rawDate
      // If dd/MM/yyyy, convert to YYYY-MM-DD
      if (invoiceDate && invoiceDate.includes('/')) {
        const parts = invoiceDate.split('/')
        if (parts.length === 3) invoiceDate = `${parts[2]}-${parts[1]}-${parts[0]}`
      }
      // If full ISO (yyyy-MM-ddT...), keep just the date portion for display
      if (invoiceDate && invoiceDate.includes('T')) {
        invoiceDate = invoiceDate.split('T')[0]
      }

      const invoiceNumber =
        inv.documentNumber || inv.invoiceNumber || inv.numeroFattura || inv.numeroDocumento ||
        inv.numero || inv.number || ''

      const match = supplierMatcher(sender, senderVat)

      return {
        id: inv.id || inv.filename || inv.uploadFileName,
        filename: inv.filename || inv.uploadFileName,
        invoiceNumber,
        invoiceDate,
        sender,
        senderVat,
        amount: isNaN(amount) ? 0 : amount,
        status: inv.status || inv.stato || 'ricevuta',
        receivedAt: inv.receivedDate || inv.uploadDate || inv.createdAt || inv.dataRicezione || '',
        fornitore_id: match.fornitore_id || null,
        is_tracked: match.matches,
      }
    })

    const filteredByMode = mode === 'all' ? parsed : parsed.filter(i => i.is_tracked)

    // Enrich rows whose summary lacks amount/date/number by calling getByFilename
    // (the findByUsername summary doesn't include these fields). Done in batches
    // of CONCURRENCY to keep wall-clock reasonable.
    const CONCURRENCY = 5
    const needEnrich = filteredByMode.filter(i => i.filename && (!i.amount || !i.invoiceDate || !i.invoiceNumber))
    console.log(`[Aruba] enriching ${needEnrich.length} of ${filteredByMode.length} rows`)

    for (let i = 0; i < needEnrich.length; i += CONCURRENCY) {
      const batch = needEnrich.slice(i, i + CONCURRENCY)
      await Promise.all(batch.map(async (row) => {
        try {
          const detail = await getIncomingInvoice(row.filename, false)
          // Aruba detail may put fields at top level, in 'metadata', or inside parsed XML JSON
          const candidates = [detail, detail?.metadata, detail?.invoice, detail?.fattura].filter(Boolean)
          for (const src of candidates) {
            const amt = src.totalDocument ?? src.documentTotal ?? src.importoTotaleDocumento ??
                        src.importoTotale ?? src.totalAmount ?? src.totale ?? src.amount ?? src.total
            if (amt != null && row.amount === 0) {
              const parsedAmt = parseFloat(String(amt).replace(',', '.'))
              if (!isNaN(parsedAmt)) row.amount = parsedAmt
            }
            const dt = src.documentDate || src.invoiceDate || src.dataDocumento || src.dataEmissione || src.dataFattura
            if (dt && !row.invoiceDate) {
              let d = String(dt)
              if (d.includes('T')) d = d.split('T')[0]
              if (d.includes('/')) {
                const parts = d.split('/')
                if (parts.length === 3) d = `${parts[2]}-${parts[1]}-${parts[0]}`
              }
              row.invoiceDate = d
            }
            const num = src.documentNumber || src.invoiceNumber || src.numeroDocumento || src.numero || src.number
            if (num && !row.invoiceNumber) row.invoiceNumber = String(num)
          }
        } catch (e: any) {
          console.warn(`[Aruba] enrich failed for ${row.filename}:`, e?.message)
        }
      }))
    }

    const invoices = filteredByMode

    // Sort by date descending
    invoices.sort((a: any, b: any) => (b.invoiceDate || '').localeCompare(a.invoiceDate || ''))

    // Compute totals per supplier
    const supplierTotals: Record<string, { count: number; total: number }> = {}
    for (const inv of invoices) {
      const key = inv.sender
      if (!supplierTotals[key]) supplierTotals[key] = { count: 0, total: 0 }
      supplierTotals[key].count++
      supplierTotals[key].total += inv.amount
    }

    const grandTotal = invoices.reduce((sum: number, inv: any) => sum + inv.amount, 0)

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        invoices,
        supplierTotals,
        grandTotal,
        totalCount: invoices.length,
        period: month || 'all'
      })
    }
  } catch (error: any) {
    console.error('[get-incoming-invoices] Error:', error)
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ success: false, error: error.message })
    }
  }
}
