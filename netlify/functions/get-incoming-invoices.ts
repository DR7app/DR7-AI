import { Handler } from '@netlify/functions'
import { searchIncomingInvoices, getIncomingInvoice } from './aruba-utils'

// Tracked suppliers — filter incoming invoices to only these
const TRACKED_SUPPLIERS = [
  'sotgia gomme',
  'galprix',
  'b.k. luxury rent',
  'begaj kujtim',
  'dap autoricambi',
  'lobrano',
  'leasys italia',
  'linda corriga',
  'antonio corriga',
  'elena demontis',
  'antonio demuro',
  'artizzu rossana',
]

function matchesSupplier(senderName: string): boolean {
  if (!senderName) return false
  const lower = senderName.toLowerCase()
  return TRACKED_SUPPLIERS.some(s => lower.includes(s))
}

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
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
    let startDate: string | undefined
    let endDate: string | undefined

    if (month) {
      const [year, mo] = month.split('-')
      const daysInMonth = new Date(parseInt(year), parseInt(mo), 0).getDate()
      startDate = `01/${mo}/${year}`  // dd/MM/yyyy for Aruba
      endDate = `${String(daysInMonth).padStart(2, '0')}/${mo}/${year}`
    }

    // Fetch all incoming invoices for the period
    const result = await searchIncomingInvoices({
      startDate,
      endDate,
      page: 0,
      pageSize: 200
    })

    // Extract invoices array from Aruba response
    const allInvoices: any[] = result.invoices || result.content || []

    // Filter to tracked suppliers only
    const filtered = allInvoices.filter((inv: any) => {
      const sender = inv.senderDescription || inv.sender?.description || inv.cedentePrestatore?.denominazione || ''
      return matchesSupplier(sender)
    })

    // Parse and normalize each invoice
    const invoices = filtered.map((inv: any) => {
      const sender = inv.senderDescription || inv.sender?.description || inv.cedentePrestatore?.denominazione || 'Sconosciuto'
      const senderVat = inv.senderCountryCode && inv.senderId
        ? `${inv.senderCountryCode}${inv.senderId}`
        : inv.sender?.vatCode || inv.cedentePrestatore?.idFiscaleIVA || ''

      // Amount parsing — Aruba may store as cents or euros
      let amount = 0
      if (inv.importoTotale != null) amount = parseFloat(inv.importoTotale)
      else if (inv.totalAmount != null) amount = parseFloat(inv.totalAmount)
      else if (inv.amount != null) amount = parseFloat(inv.amount)

      // Date parsing — Aruba format varies
      let invoiceDate = inv.invoiceDate || inv.dataFattura || inv.date || ''
      // If dd/MM/yyyy, convert to YYYY-MM-DD
      if (invoiceDate && invoiceDate.includes('/')) {
        const parts = invoiceDate.split('/')
        if (parts.length === 3) invoiceDate = `${parts[2]}-${parts[1]}-${parts[0]}`
      }

      return {
        id: inv.id || inv.filename || inv.uploadFileName,
        filename: inv.filename || inv.uploadFileName,
        invoiceNumber: inv.invoiceNumber || inv.numeroFattura || inv.number || '',
        invoiceDate,
        sender,
        senderVat,
        amount,
        status: inv.status || inv.stato || 'ricevuta',
        receivedAt: inv.receivedDate || inv.createdAt || inv.dataRicezione || '',
      }
    })

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
