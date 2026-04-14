import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { logCardAttempt, notifyPrepaidBlocked } from './prepaid-card-guard'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const NEXI_API_KEY = process.env.NEXI_API_KEY!
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'

/**
 * XPay Build — Check card BIN and confirm/reject payment
 *
 * Called when the Nexi SDK reaches READY_FOR_PAYMENT state.
 * 1. GET /build/cardData → get BIN
 * 2. BIN lookup → classify prepaid/debit/credit
 * 3. If prepaid → BLOCK (don't confirm)
 * 4. If debit/credit → POST /build/confirm_payment
 */
export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{"error":"Method not allowed"}' }

  try {
    const { sessionId, orderId } = JSON.parse(event.body || '{}')

    if (!sessionId || !orderId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing sessionId or orderId' }) }
    }

    const correlationId = crypto.randomUUID()

    // 1. GET card data from Nexi Build
    console.log(`[nexi-check-card] Getting card data for session ${sessionId}`)
    const cardRes = await fetch(`${NEXI_BASE_URL}/build/cardData?sessionId=${sessionId}`, {
      headers: {
        'X-Api-Key': NEXI_API_KEY,
        'Correlation-Id': correlationId,
      },
    })

    if (!cardRes.ok) {
      const errText = await cardRes.text()
      console.error(`[nexi-check-card] cardData failed: ${cardRes.status} ${errText.substring(0, 200)}`)
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to get card data from Nexi' }) }
    }

    const cardData = await cardRes.json()
    console.log('[nexi-check-card] Card data:', JSON.stringify(cardData).substring(0, 300))

    const bin = cardData.bin || cardData.cardData?.bin || ''
    const circuit = cardData.circuit || cardData.cardData?.circuit || ''
    const maskedPan = cardData.maskedPan || cardData.cardData?.maskedPan || ''
    const expiryDate = cardData.expiryDate || cardData.cardData?.expiryDate || ''

    // 2. BIN lookup to classify card type
    let cardType = 'unknown'
    let binLookupRaw: any = null

    if (bin && bin.length >= 6) {
      try {
        const binRes = await fetch(`https://lookup.binlist.net/${bin.substring(0, 6)}`, {
          headers: { 'Accept-Version': '3' },
        })
        if (binRes.ok) {
          binLookupRaw = await binRes.json()
          cardType = (binLookupRaw.type || '').toLowerCase() // 'credit', 'debit', 'prepaid'
          console.log(`[nexi-check-card] BIN ${bin.substring(0, 6)} → ${cardType} (${binLookupRaw.scheme})`)
        } else {
          console.warn(`[nexi-check-card] BIN lookup failed: ${binRes.status}`)
        }
      } catch (e: any) {
        console.warn(`[nexi-check-card] BIN lookup error: ${e.message}`)
      }
    }

    // Also check Nexi's paymentInstrument info for keywords
    const paymentInstrument = (cardData.paymentInstrument || '').toLowerCase()
    if (cardType === 'unknown' && paymentInstrument.includes('prepaid')) {
      cardType = 'prepaid'
    }

    const isPrepaid = cardType === 'prepaid'

    // Find booking from transaction
    const { data: transaction } = await supabase
      .from('nexi_transactions')
      .select('id, booking_id, amount_cents, customer_email')
      .eq('order_id', orderId)
      .single()

    const bookingId = transaction?.booking_id || null

    // 3. Log the card check attempt
    await logCardAttempt({
      bookingId,
      customerId: null,
      customerName: null,
      customerEmail: transaction?.customer_email || null,
      cardCheck: {
        isPrepaid,
        cardType,
        cardCircuit: circuit,
        maskedPan,
        detectionMethod: binLookupRaw ? 'bin_lookup' : 'none',
        rawData: { bin, binLookupRaw, cardData, paymentInstrument },
      },
      amountCents: transaction?.amount_cents || 0,
      detectionPhase: 'pre_payment',
    })

    // 4. Decision
    if (isPrepaid) {
      console.log(`[nexi-check-card] BLOCKED prepaid card for order ${orderId}`)

      // Notify admin
      if (bookingId) {
        const { data: booking } = await supabase
          .from('bookings')
          .select('customer_name, customer_phone, vehicle_name')
          .eq('id', bookingId)
          .single()

        if (booking) {
          await notifyPrepaidBlocked({
            bookingId,
            customerName: booking.customer_name || 'Cliente',
            customerPhone: booking.customer_phone || '',
            vehicleName: booking.vehicle_name || '',
            maskedPan,
            circuit,
            amountCents: transaction?.amount_cents || 0,
          })
        }
      }

      // Update transaction
      await supabase.from('nexi_transactions').update({
        status: 'blocked_prepaid',
        metadata: {
          ...((await supabase.from('nexi_transactions').select('metadata').eq('order_id', orderId).single()).data?.metadata || {}),
          card_check: { bin, cardType, circuit, maskedPan, decision: 'blocked', timestamp: new Date().toISOString() },
        },
      }).eq('order_id', orderId)

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          allowed: false,
          reason: 'prepaid',
          cardType,
          message: 'Le carte prepagate non sono accettate. Utilizza una carta di credito o debito.',
        }),
      }
    }

    // 5. ALLOWED — confirm payment
    console.log(`[nexi-check-card] ALLOWED ${cardType} card for order ${orderId}, confirming...`)

    const confirmRes = await fetch(`${NEXI_BASE_URL}/build/confirm_payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': NEXI_API_KEY,
        'Correlation-Id': correlationId,
      },
      body: JSON.stringify({ sessionId }),
    })

    if (!confirmRes.ok) {
      const errText = await confirmRes.text()
      console.error(`[nexi-check-card] confirm_payment failed: ${confirmRes.status} ${errText.substring(0, 200)}`)
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Payment confirmation failed' }) }
    }

    const confirmData = await confirmRes.json()
    console.log('[nexi-check-card] Payment confirmed:', JSON.stringify(confirmData).substring(0, 300))

    // Update transaction with card info
    await supabase.from('nexi_transactions').update({
      metadata: {
        ...((await supabase.from('nexi_transactions').select('metadata').eq('order_id', orderId).single()).data?.metadata || {}),
        card_check: { bin, cardType, circuit, maskedPan, decision: 'allowed', timestamp: new Date().toISOString() },
      },
    }).eq('order_id', orderId)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        allowed: true,
        cardType,
        confirmed: true,
        message: 'Pagamento confermato.',
      }),
    }
  } catch (err: any) {
    console.error('[nexi-check-card] Error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
