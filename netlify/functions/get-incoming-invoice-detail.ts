import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { getIncomingInvoice } from './aruba-utils'

/**
 * Per-row detail fetch — UI calls this for each visible incoming invoice
 * to populate amount/date/number. Splitting it off the listing endpoint keeps
 * the listing fast and avoids Netlify's 10s timeout when there are many rows.
 */
export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  const filename = event.queryStringParameters?.filename
  if (!filename) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'filename required' }) }
  }

  try {
    const detail = await getIncomingInvoice(filename, false)

    let amount: number | null = null
    let invoiceDate = ''
    let invoiceNumber = ''

    const candidates = [detail, detail?.metadata, detail?.invoice, detail?.fattura].filter(Boolean)
    for (const src of candidates) {
      const amt = src.totalDocument ?? src.documentTotal ?? src.importoTotaleDocumento ??
                  src.importoTotale ?? src.totalAmount ?? src.totale ?? src.amount ?? src.total
      if (amt != null && amount == null) {
        const parsed = parseFloat(String(amt).replace(',', '.'))
        if (!isNaN(parsed)) amount = parsed
      }
      const dt = src.documentDate || src.invoiceDate || src.dataDocumento || src.dataEmissione || src.dataFattura
      if (dt && !invoiceDate) {
        let d = String(dt)
        if (d.includes('T')) d = d.split('T')[0]
        if (d.includes('/')) {
          const parts = d.split('/')
          if (parts.length === 3) d = `${parts[2]}-${parts[1]}-${parts[0]}`
        }
        invoiceDate = d
      }
      const num = src.documentNumber || src.invoiceNumber || src.numeroDocumento || src.numero || src.number
      if (num && !invoiceNumber) invoiceNumber = String(num)
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        filename,
        amount,
        invoiceDate,
        invoiceNumber,
      })
    }
  } catch (err: any) {
    const msg = err?.message || String(err)
    const isRate = msg.includes('429')
    return {
      statusCode: isRate ? 429 : 500, headers,
      body: JSON.stringify({ success: false, error: msg, rate_limited: isRate })
    }
  }
}
