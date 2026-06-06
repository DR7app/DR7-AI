import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { nexiCallWithRecurrenceFallback } from './utils/nexiTokenizationFallback'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const NEXI_API_KEY = process.env.NEXI_API_KEY!
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'

/**
 * XPay Build — Create payment session (replaces Pay-by-Link for booking payments)
 *
 * Returns a URL to our own payment page that embeds the Nexi card form.
 * This allows us to check the card BIN BEFORE confirming payment,
 * blocking prepaid cards.
 */
export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{"error":"Method not allowed"}' }

  try {
    const {
      bookingId,
      amount,
      customerEmail,
      customerName,
      description,
      expirationHours = 1,
      paymentPurpose = 'booking',
    } = JSON.parse(event.body || '{}')

    if (!NEXI_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'NEXI_API_KEY not configured' }) }
    }
    if (!amount || amount <= 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid amount' }) }
    }

    // Generate order ID
    const ts = Date.now().toString(36)
    const orderId = bookingId
      ? `B${bookingId.slice(0, 8)}${ts}`.slice(0, 18)
      : `B${ts}${Math.floor(Math.random() * 1000)}`.slice(0, 18)

    const amountCents = Math.round(amount * 100)

    // Expiration timestamps
    const sentAt = new Date()
    const expiresAt = new Date(sentAt.getTime() + expirationHours * 60 * 60 * 1000)

    // Website payment page URL
    const websiteBase = 'https://dr7.app'
    const adminBase = process.env.URL || 'https://platform.dr7ai.com'

    // Create XPay Build session
    const buildUrl = `${NEXI_BASE_URL}/orders/build`
    const correlationId = crypto.randomUUID()

    const payload = {
      order: {
        orderId,
        amount: amountCents.toString(),
        currency: 'EUR',
        description: description || 'Pagamento DR7',
        customerInfo: {
          cardHolderEmail: customerEmail || '',
          cardHolderName: customerName || '',
        },
      },
      paymentSession: {
        actionType: 'PAY',
        amount: amountCents.toString(),
        language: 'ita',
        resultUrl: `${websiteBase}/payment-success?order=${orderId}`,
        cancelUrl: `${websiteBase}/payment-cancelled?order=${orderId}`,
        notificationUrl: `${adminBase}/.netlify/functions/nexi-payment-callback`,
        recurrence: {
          action: 'CONTRACT_CREATION',
          contractId: orderId,
          contractType: 'MIT_UNSCHEDULED',
        },
      },
    }

    console.log('[nexi-build] Creating session:', JSON.stringify(payload))

    const { response, responseText, usedFallback } = await nexiCallWithRecurrenceFallback({
      url: buildUrl,
      apiKey: NEXI_API_KEY,
      correlationId,
      payload,
      logTag: 'nexi-build',
    })

    console.log('[nexi-build] Response:', response.status, responseText.substring(0, 500), 'fallback:', usedFallback)

    let responseData: any
    try {
      responseData = JSON.parse(responseText)
    } catch {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: `Nexi API error (${response.status}): ${responseText.substring(0, 200)}` }),
      }
    }

    if (!response.ok) {
      console.error('[nexi-build] Nexi error:', responseData)
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: responseData.errors?.[0]?.description || 'Failed to create build session' }),
      }
    }

    const sessionId = responseData.sessionId
    const securityToken = responseData.securityToken
    if (!sessionId) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'No sessionId in Nexi response' }) }
    }

    // Build payment page URL
    const paymentUrl = `${websiteBase}/pay?sessionId=${sessionId}&securityToken=${securityToken}&orderId=${orderId}`

    console.log('[nexi-build] Session created:', { orderId, sessionId, paymentUrl })

    // Store in nexi_transactions
    const { error: dbError } = await supabase
      .from('nexi_transactions')
      .insert({
        order_id: orderId,
        booking_id: bookingId || null,
        amount_cents: amountCents,
        status: 'pending',
        payment_link: paymentUrl,
        description: description || 'Pagamento DR7',
        customer_email: customerEmail || null,
        contract_id: orderId.slice(0, 18),
        metadata: {
          type: 'xpay_build',
          session_id: sessionId,
          security_token: securityToken,
          payment_purpose: paymentPurpose,
          customer_name: customerName,
          tokenization_requested: !usedFallback,
          tokenization_fallback_used: usedFallback,
          payment_link_sent_at: sentAt.toISOString(),
          payment_link_expires_at: expiresAt.toISOString(),
          nexi_response: responseData,
        },
        created_at: sentAt.toISOString(),
      })

    if (dbError) console.error('[nexi-build] DB error:', dbError)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        paymentUrl,
        paymentLink: paymentUrl,
        orderId,
        sessionId,
        securityToken,
        amount,
        sentAt: sentAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      }),
    }
  } catch (err: any) {
    console.error('[nexi-build] Error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
