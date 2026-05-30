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
    // Fetch with the actual XML file (no PDF, smaller payload)
    const detail = await getIncomingInvoice(filename, false)

    let amount: number | null = null
    let invoiceDate = ''
    let invoiceNumber = ''

    // First try Aruba's parsed JSON fields (cheap if present)
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

    // Fallback — parse the XML directly. FatturaPA always has these fields under DatiGeneraliDocumento.
    const fileBase64: string | undefined = detail?.file || detail?.xml || detail?.fileBytes || detail?.invoiceFile
    if (fileBase64 && (amount == null || !invoiceDate || !invoiceNumber)) {
      try {
        const xml = Buffer.from(fileBase64, 'base64').toString('utf-8')
        // Strip namespace prefixes for simpler regex (e.g., p:ImportoTotaleDocumento → ImportoTotaleDocumento)
        const flat = xml.replace(/<\/?[a-zA-Z0-9_-]+:/g, m => m.replace(/[a-zA-Z0-9_-]+:/, ''))
        if (amount == null) {
          const m = flat.match(/<ImportoTotaleDocumento>\s*([0-9.,-]+)\s*<\/ImportoTotaleDocumento>/i)
          if (m) {
            const parsed = parseFloat(m[1].replace(',', '.'))
            if (!isNaN(parsed)) amount = parsed
          }
        }
        if (!invoiceDate) {
          // 2026-05-30 BUG FIX: la data del documento sta DENTRO
          // <DatiGeneraliDocumento>. Il vecchio match prendeva il PRIMO <Data>
          // del file, che per alcuni fornitori (es. Exotica) è un altro tag
          // (trasmissione / scadenza pagamento / riferimento termini) → data
          // vuota. Ora cerchiamo prima il <Data> dentro DatiGeneraliDocumento,
          // poi (fallback) il primo <Data> con formato data valido yyyy-MM-dd.
          const blockMatch = flat.match(/<DatiGeneraliDocumento>([\s\S]*?)<\/DatiGeneraliDocumento>/i)
          const scope = blockMatch ? blockMatch[1] : flat
          let m = scope.match(/<Data>\s*(\d{4}-\d{2}-\d{2}[0-9T:.+\-]*)\s*<\/Data>/)
          if (!m) {
            // fallback: primo <Data> con formato data ISO ovunque nel file
            m = flat.match(/<Data>\s*(\d{4}-\d{2}-\d{2}[0-9T:.+\-]*)\s*<\/Data>/)
          }
          if (m) {
            let d = m[1]
            if (d.includes('T')) d = d.split('T')[0]
            invoiceDate = d
          }
        }
        if (!invoiceNumber) {
          // Stesso ragionamento della data: il <Numero> del documento sta in
          // DatiGeneraliDocumento. Preferiamo quello scoped, poi fallback globale.
          const blockMatch = flat.match(/<DatiGeneraliDocumento>([\s\S]*?)<\/DatiGeneraliDocumento>/i)
          const scope = blockMatch ? blockMatch[1] : flat
          let m = scope.match(/<Numero>\s*([^<]+?)\s*<\/Numero>/)
          if (!m) m = flat.match(/<Numero>\s*([^<]+?)\s*<\/Numero>/)
          if (m) invoiceNumber = m[1].trim()
        }
      } catch (xerr: any) {
        console.warn('[get-incoming-invoice-detail] XML parse failed:', xerr?.message)
      }
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        filename,
        amount,
        invoiceDate,
        invoiceNumber,
        had_xml: !!fileBase64,
        detail_keys: Object.keys(detail || {}),
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
