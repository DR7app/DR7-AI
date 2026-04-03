/**
 * nexi-verify-captures — Paginated verification
 * Call with {"page": 0} then {"page": 1} etc. (10 per page)
 * Or {"page": "all"} to get stored full report.
 */
import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const NEXI_API_KEY = process.env.NEXI_API_KEY!
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'
const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const PAGE_SIZE = 8

async function verifyOne(tx: any) {
  const orderId = tx.order_id
  const amt = tx.amount_cents
  try {
    const res = await fetch(`${NEXI_BASE_URL}/orders/${orderId}`, {
      headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': crypto.randomUUID() }
    })
    if (!res.ok) {
      return { orderId, status: res.status === 404 ? 'LINK_SCADUTO' : 'ANOMALIA', importo_atteso: amt, detail: `Nexi ${res.status}`, cliente: tx.customer_email }
    }
    const d = await res.json()
    const os = d.orderStatus || {}
    const ops = d.operations || []
    const auth = parseInt(os.authorizedAmount || '0')
    const cap = parseInt(os.capturedAmount || '0')
    const ref = parseInt(os.refundedAmount || '0')
    const lastOp = os.lastOperationType || ''
    const mainOp = ops.find((o: any) => o.operationType === 'CAPTURE') || ops.find((o: any) => o.operationType === 'AUTHORIZATION') || ops[0]
    const opId = mainOp?.operationId || null
    const card = mainOp?.paymentInstrumentInfo || mainOp?.additionalData?.maskedPan || null
    const authCode = mainOp?.additionalData?.authorizationCode || null
    const name = mainOp?.customerInfo?.cardHolderName || os.order?.customerInfo?.cardHolderName || tx.customer_email
    const desc = os.order?.description || tx.description

    if (cap > 0 && cap >= amt) return { orderId, operationId: opId, status: 'INCASSATO', importo: `€${(cap/100).toFixed(2)}`, auth_eur: `€${(auth/100).toFixed(2)}`, cliente: name, descrizione: desc, carta: card, authCode }
    if (cap > 0 && cap < amt) return { orderId, operationId: opId, status: 'ANOMALIA', detail: `Parziale: incassato €${(cap/100).toFixed(2)} su €${(amt/100).toFixed(2)}`, cliente: name, descrizione: desc }
    if (ops.find((o: any) => o.operationResult === 'DECLINED')) return { orderId, operationId: opId, status: 'DECLINED', importo_atteso: `€${(amt/100).toFixed(2)}`, cliente: name, descrizione: desc }
    if (auth > 0 && cap === 0) {
      const voided = ops.find((o: any) => o.operationType === 'VOID' || o.operationType === 'REFUND')
      if (voided) return { orderId, operationId: opId, status: 'RILASCIATO', importo: `€${(auth/100).toFixed(2)}`, cliente: name, descrizione: desc }
      return { orderId, operationId: opId, status: 'AUTORIZZATO_NON_INCASSATO', importo: `€${(auth/100).toFixed(2)}`, cliente: name, descrizione: desc, carta: card, authCode, detail: 'Fondi bloccati — da incassare o rilasciare' }
    }
    if (ops.length === 0) return { orderId, status: 'LINK_SCADUTO', importo_atteso: `€${(amt/100).toFixed(2)}`, cliente: name, descrizione: desc }
    return { orderId, operationId: opId, status: 'NON_INCASSATO', importo_atteso: `€${(amt/100).toFixed(2)}`, lastOp, cliente: name, descrizione: desc }
  } catch (e: any) {
    return { orderId, status: 'ANOMALIA', importo_atteso: amt, detail: e.message, cliente: tx.customer_email }
  }
}

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'POST only' }

  const { page = 0 } = JSON.parse(event.body || '{}')

  // Get total count first
  const { count } = await supabase.from('nexi_transactions').select('id', { count: 'exact', head: true }).not('order_id', 'like', 'REPORT_%')
  const totalTx = count || 0
  const totalPages = Math.ceil(totalTx / PAGE_SIZE)

  // Fetch page
  const from = page * PAGE_SIZE
  const { data: txs, error } = await supabase
    .from('nexi_transactions')
    .select('*')
    .not('order_id', 'like', 'REPORT_%')
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1)

  if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }

  // Verify each (parallel within page)
  const results = await Promise.all((txs || []).map(verifyOne))

  // Summary for this page
  const incassati = results.filter(r => r.status === 'INCASSATO')
  const nonIncassati = results.filter(r => r.status === 'AUTORIZZATO_NON_INCASSATO')

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      page,
      totalPages,
      totalTransactions: totalTx,
      resultsInPage: results.length,
      results,
      pageSummary: {
        incassati: incassati.length,
        autorizzati_non_incassati: nonIncassati.length,
        declined: results.filter(r => r.status === 'DECLINED').length,
        link_scaduti: results.filter(r => r.status === 'LINK_SCADUTO').length,
        anomalie: results.filter(r => r.status === 'ANOMALIA').length,
        rilasciati: results.filter(r => r.status === 'RILASCIATO').length,
        non_incassati: results.filter(r => r.status === 'NON_INCASSATO').length,
      }
    }, null, 2)
  }
}
