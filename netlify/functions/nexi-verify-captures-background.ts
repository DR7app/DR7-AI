/**
 * nexi-verify-captures (Background Function — 15 min timeout)
 *
 * Scans ALL nexi_transactions, verifies each against Nexi API,
 * and stores the full report in Supabase `admin_reports` table.
 */

import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const NEXI_API_KEY = process.env.NEXI_API_KEY!
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'
const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

interface VerificationResult {
  orderId: string
  operationId: string | null
  expectedAmountCents: number
  status: 'INCASSATO' | 'NON_INCASSATO' | 'ANOMALIA' | 'AUTORIZZATO_NON_INCASSATO' | 'DECLINED' | 'LINK_SCADUTO'
  detail: string
  capturedAmount?: number
  authorizedAmount?: number
  operationType?: string
  operationResult?: string
  customerName?: string
  customerEmail?: string
  description?: string
  cardInfo?: string
  authCode?: string
  createdAt?: string
  nexiRawStatus?: any
}

async function verifyTransaction(tx: any): Promise<VerificationResult> {
  const orderId = tx.order_id
  const expectedAmount = tx.amount_cents

  try {
    const orderRes = await fetch(`${NEXI_BASE_URL}/orders/${orderId}`, {
      headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': crypto.randomUUID() }
    })

    if (!orderRes.ok) {
      const errText = await orderRes.text()
      // 404 = link never used / expired
      if (orderRes.status === 404) {
        return {
          orderId, operationId: null, expectedAmountCents: expectedAmount,
          status: 'LINK_SCADUTO',
          detail: `Link mai utilizzato o scaduto (Nexi 404)`,
          customerName: tx.customer_email, createdAt: tx.created_at,
        }
      }
      return {
        orderId, operationId: null, expectedAmountCents: expectedAmount,
        status: 'ANOMALIA',
        detail: `Nexi API error ${orderRes.status}: ${errText.substring(0, 200)}`,
        customerName: tx.customer_email, createdAt: tx.created_at,
      }
    }

    const orderData = await orderRes.json()
    const orderStatus = orderData.orderStatus || {}
    const operations = orderData.operations || []
    const orderInfo = orderStatus.order || {}

    const authorizedAmount = parseInt(orderStatus.authorizedAmount || '0')
    const capturedAmount = parseInt(orderStatus.capturedAmount || '0')
    const refundedAmount = parseInt(orderStatus.refundedAmount || '0')
    const lastOpType = orderStatus.lastOperationType || ''

    // Find operations by type
    const captureOp = operations.find((op: any) => op.operationType === 'CAPTURE' && op.operationResult === 'EXECUTED')
    const authOp = operations.find((op: any) => op.operationType === 'AUTHORIZATION')
    const declinedOp = operations.find((op: any) => op.operationResult === 'DECLINED')
    const voidOp = operations.find((op: any) => op.operationType === 'VOID' || op.operationType === 'REFUND')
    const mainOp = captureOp || authOp || operations[0]

    const operationId = mainOp?.operationId || null
    const cardInfo = mainOp?.paymentInstrumentInfo || mainOp?.additionalData?.maskedPan || null
    const authCode = mainOp?.additionalData?.authorizationCode || mainOp?.paymentEndToEndId || null
    const custName = mainOp?.customerInfo?.cardHolderName || orderInfo.customerInfo?.cardHolderName || tx.customer_email
    const custEmail = mainOp?.customerInfo?.cardHolderEmail || orderInfo.customerInfo?.cardHolderEmail || tx.customer_email

    const base = {
      orderId, operationId, expectedAmountCents: expectedAmount,
      authorizedAmount, capturedAmount,
      customerName: custName, customerEmail: custEmail,
      description: orderInfo.description || tx.description,
      cardInfo, authCode, createdAt: tx.created_at,
      nexiRawStatus: { authorizedAmount, capturedAmount, refundedAmount, lastOpType, operationCount: operations.length },
    }

    // CAPTURED
    if (capturedAmount > 0 && capturedAmount >= expectedAmount) {
      return { ...base, status: 'INCASSATO', operationType: 'CAPTURE', operationResult: 'EXECUTED',
        detail: `Capture OK. Autorizzato: €${(authorizedAmount/100).toFixed(2)}, Incassato: €${(capturedAmount/100).toFixed(2)}` }
    }

    // PARTIAL CAPTURE
    if (capturedAmount > 0 && capturedAmount < expectedAmount) {
      return { ...base, status: 'ANOMALIA', operationType: lastOpType, operationResult: mainOp?.operationResult,
        detail: `Capture PARZIALE. Atteso: €${(expectedAmount/100).toFixed(2)}, Incassato: €${(capturedAmount/100).toFixed(2)}, Mancante: €${((expectedAmount-capturedAmount)/100).toFixed(2)}` }
    }

    // DECLINED
    if (declinedOp) {
      return { ...base, status: 'DECLINED', operationType: 'AUTHORIZATION', operationResult: 'DECLINED',
        detail: `Pagamento RIFIUTATO dalla banca. Autorizzato: €0` }
    }

    // AUTHORIZED but NOT captured (preauth held, money blocked on card)
    if (authorizedAmount > 0 && capturedAmount === 0) {
      const isVoided = !!voidOp
      if (isVoided) {
        return { ...base, status: 'NON_INCASSATO', operationType: voidOp.operationType, operationResult: voidOp.operationResult,
          detail: `Preauth RILASCIATA/ANNULLATA. Autorizzato: €${(authorizedAmount/100).toFixed(2)}, Tipo: ${voidOp.operationType}` }
      }
      return { ...base, status: 'AUTORIZZATO_NON_INCASSATO', operationType: 'AUTHORIZATION', operationResult: 'AUTHORIZED',
        detail: `Fondi BLOCCATI ma NON incassati. Autorizzato: €${(authorizedAmount/100).toFixed(2)} — Da incassare o rilasciare` }
    }

    // No operations at all — link never used
    if (operations.length === 0) {
      return { ...base, status: 'LINK_SCADUTO',
        detail: `Nessuna operazione Nexi trovata — link mai utilizzato` }
    }

    // Fallback
    return { ...base, status: 'NON_INCASSATO', operationType: lastOpType, operationResult: mainOp?.operationResult,
      detail: `Stato non chiaro. LastOp: ${lastOpType}, Auth: €${(authorizedAmount/100).toFixed(2)}, Captured: €${(capturedAmount/100).toFixed(2)}` }

  } catch (err: any) {
    return {
      orderId, operationId: null, expectedAmountCents: expectedAmount,
      status: 'ANOMALIA', detail: `Errore: ${err.message}`,
      customerName: tx.customer_email, createdAt: tx.created_at,
    }
  }
}

export const handler: Handler = async (event) => {
  // Background function — no CORS needed, just return 202 immediately
  // The actual work runs in the background

  try {
    console.log('[nexi-verify] Starting full verification...')

    // Fetch ALL transactions (exclude report rows)
    const { data: transactions, error } = await supabase
      .from('nexi_transactions')
      .select('*')
      .not('order_id', 'like', 'REPORT_%')
      .order('created_at', { ascending: false })

    if (error) throw error

    const total = transactions?.length || 0
    console.log(`[nexi-verify] Found ${total} transactions to verify`)

    const results: VerificationResult[] = []

    // Process in batches of 5 (parallel) with 300ms between batches
    const batchSize = 5
    for (let i = 0; i < total; i += batchSize) {
      const batch = (transactions || []).slice(i, i + batchSize)
      const batchResults = await Promise.all(batch.map(tx => verifyTransaction(tx)))
      results.push(...batchResults)
      console.log(`[nexi-verify] Processed ${Math.min(i + batchSize, total)}/${total}`)
      if (i + batchSize < total) await new Promise(r => setTimeout(r, 300))
    }

    // Build report
    const incassati = results.filter(r => r.status === 'INCASSATO')
    const nonIncassati = results.filter(r => r.status === 'NON_INCASSATO')
    const autorizzatiNonIncassati = results.filter(r => r.status === 'AUTORIZZATO_NON_INCASSATO')
    const declined = results.filter(r => r.status === 'DECLINED')
    const scaduti = results.filter(r => r.status === 'LINK_SCADUTO')
    const anomalie = results.filter(r => r.status === 'ANOMALIA')

    const totaleIncassato = incassati.reduce((sum, r) => sum + (r.capturedAmount || 0), 0)
    const totaleAutorizzatoNonIncassato = autorizzatiNonIncassati.reduce((sum, r) => sum + (r.authorizedAmount || 0), 0)

    const report = {
      report_type: 'nexi_capture_verification',
      report_generated_at: new Date().toISOString(),
      riepilogo: {
        totale_operazioni: results.length,
        incassate: incassati.length,
        autorizzate_non_incassate: autorizzatiNonIncassati.length,
        non_incassate: nonIncassati.length,
        declined: declined.length,
        link_scaduti: scaduti.length,
        anomalie: anomalie.length,
        totale_incassato_eur: `€${(totaleIncassato / 100).toFixed(2)}`,
        totale_autorizzato_non_incassato_eur: `€${(totaleAutorizzatoNonIncassato / 100).toFixed(2)}`,
      },
      incassati: incassati.map(r => ({ orderId: r.orderId, operationId: r.operationId, importo: `€${(r.capturedAmount! / 100).toFixed(2)}`, cliente: r.customerName, descrizione: r.description, carta: r.cardInfo, authCode: r.authCode })),
      autorizzati_non_incassati: autorizzatiNonIncassati.map(r => ({ orderId: r.orderId, operationId: r.operationId, importo: `€${(r.authorizedAmount! / 100).toFixed(2)}`, cliente: r.customerName, descrizione: r.description, carta: r.cardInfo, authCode: r.authCode, dettaglio: r.detail })),
      declined: declined.map(r => ({ orderId: r.orderId, importo_atteso: `€${(r.expectedAmountCents / 100).toFixed(2)}`, cliente: r.customerName, descrizione: r.description })),
      anomalie: anomalie.map(r => ({ orderId: r.orderId, importo_atteso: `€${(r.expectedAmountCents / 100).toFixed(2)}`, cliente: r.customerName, dettaglio: r.detail })),
      link_scaduti: scaduti.map(r => ({ orderId: r.orderId, importo_atteso: `€${(r.expectedAmountCents / 100).toFixed(2)}`, cliente: r.customerName, descrizione: r.description })),
      non_incassati: nonIncassati.map(r => ({ orderId: r.orderId, importo_atteso: `€${(r.expectedAmountCents / 100).toFixed(2)}`, cliente: r.customerName, dettaglio: r.detail })),
      dettaglio_completo: results,
    }

    // Store report in nexi_transactions as a special row
    // First delete any old report rows
    await supabase.from('nexi_transactions').delete().like('order_id', 'REPORT_%')

    const { error: insertErr } = await supabase.from('nexi_transactions').insert({
      order_id: `REPORT_${Date.now()}`,
      amount_cents: 0,
      status: 'report',
      customer_email: 'system',
      description: 'Nexi Capture Verification Report',
      metadata: report,
    })

    if (insertErr) {
      console.error('[nexi-verify] Failed to save report:', insertErr.message)
    } else {
      console.log('[nexi-verify] Report saved to nexi_transactions')
    }

    console.log(`[nexi-verify] DONE. ${incassati.length} incassati, ${autorizzatiNonIncassati.length} autorizzati non incassati, ${anomalie.length} anomalie`)

    return { statusCode: 200, body: JSON.stringify(report, null, 2) }

  } catch (err: any) {
    console.error('[nexi-verify] Fatal error:', err)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
