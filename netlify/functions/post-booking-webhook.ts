import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { getCorsOrigin } from './cors-headers'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Webhook called by the website after a booking is created (credit wallet, etc.)
 * Generates contract + fattura + signing link without requiring admin auth.
 * Uses ADMIN_API_TOKEN for internal calls.
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
    const { bookingId } = JSON.parse(event.body || '{}')
    if (!bookingId) return { statusCode: 400, headers, body: '{"error":"Missing bookingId"}' }

    const baseUrl = process.env.URL || 'https://platform.dr7ai.com'
    const authHeader = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.ADMIN_API_TOKEN}` }

    // Verify booking exists
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, vehicle_type, service_type, booking_details, payment_status, payment_method')
      .eq('id', bookingId)
      .single()

    if (!booking) return { statusCode: 404, headers, body: '{"error":"Booking not found"}' }

    const isWashOrMech = booking.service_type === 'car_wash' || booking.service_type === 'mechanical_service' ||
      booking.vehicle_type === 'car_wash' || booking.booking_details?.type === 'car_wash'

    let contractGenerated = false
    let fatturaGenerated = false

    // 1. Generate contract (skip for car wash/mechanical)
    if (!isWashOrMech) {
      try {
        const res = await fetch(`${baseUrl}/.netlify/functions/generate-contract`, {
          method: 'POST', headers: authHeader,
          body: JSON.stringify({ bookingId }),
        })
        const data = await res.json()
        if (res.ok && data.success) {
          contractGenerated = true
          console.log(`[post-booking-webhook] Contract generated for ${bookingId}`)

          const { data: contractRow } = await supabase
            .from('contracts').select('id').eq('booking_id', bookingId).single()

          if (contractRow) {
            await fetch(`${baseUrl}/.netlify/functions/signature-init`, {
              method: 'POST', headers: authHeader,
              body: JSON.stringify({ contractId: contractRow.id, bookingId }),
            })
            console.log(`[post-booking-webhook] Signing link sent for ${bookingId}`)
          }
        } else {
          console.error(`[post-booking-webhook] Contract failed:`, data.error)
        }
      } catch (e: any) {
        console.error(`[post-booking-webhook] Contract error:`, e.message)
      }
    }

    // 2. Generate fattura (skip for credit wallet — fattura already generated at wallet purchase)
    const isCreditPayment = booking.payment_method === 'credit' || booking.payment_method === 'Credit Wallet'
    if (!isCreditPayment && (booking.payment_status === 'paid' || booking.payment_status === 'succeeded' || booking.payment_status === 'completed')) {
      try {
        const res = await fetch(`${baseUrl}/.netlify/functions/generate-invoice-from-booking`, {
          method: 'POST', headers: authHeader,
          body: JSON.stringify({ bookingId, includeIVA: true }),
        })
        if (res.ok) {
          fatturaGenerated = true
          console.log(`[post-booking-webhook] Fattura generated for ${bookingId}`)
        }
      } catch (e: any) {
        console.error(`[post-booking-webhook] Fattura error:`, e.message)
      }
    }

    // 3. DR7 Privilege — invia codice sconto subito dopo la conferma del
    //    pagamento, indipendentemente dal metodo (Credit Wallet, Contanti,
    //    POS, Bonifico, Nexi, ecc). Idempotente via dr7_privilege_sent_at.
    const isPaid = booking.payment_status === 'paid' || booking.payment_status === 'succeeded' || booking.payment_status === 'completed'
    if (isPaid) {
      try {
        // Re-fetch con i campi richiesti da sendDr7Privilege
        const { data: bookingFull } = await supabase
          .from('bookings')
          .select('id, service_type, customer_name, customer_phone, customer_email, vehicle_plate, booking_details, dr7_privilege_sent_at')
          .eq('id', bookingId)
          .maybeSingle()
        if (bookingFull) {
          const { sendDr7Privilege } = await import('./utils/dr7Privilege')
          const kind = isWashOrMech ? 'lavaggio' : 'noleggio'
          const result = await sendDr7Privilege(supabase, bookingFull as any, kind)
          if (result.sent) {
            console.log(`[post-booking-webhook] ✅ DR7 Privilege ${kind} sent: ${result.code}`)
          } else if (result.skipped) {
            console.log(`[post-booking-webhook] DR7 Privilege ${kind} skipped: ${result.skipped}`)
          } else if (result.error) {
            console.warn(`[post-booking-webhook] DR7 Privilege ${kind} failed: ${result.error}`)
          }
        }
      } catch (e: any) {
        console.error('[post-booking-webhook] ⚠️ DR7 Privilege error:', e.message)
      }
    }

    // 4. Messaggi di Sistema Pro — fire instant templates.
    //    Templates con offset alto (es. 24h prima del pickup) restano al cron.
    try {
      const { triggerSystemMessageEvent } = await import('./utils/triggerSystemMessageEvent')
      const r = await triggerSystemMessageEvent({ bookingId, event: 'on_booking' })
      if (r.sent || r.errors) {
        console.log(`[post-booking-webhook] system messages on_booking: sent=${r.sent} skipped=${r.skipped} errors=${r.errors}`)
      }

      // on_first_booking — solo se questa è la PRIMA booking del cliente.
      // Conta le bookings dello stesso customer_email (escludendo quella appena
      // creata): se 0, è la prima.
      try {
        const { data: bookingFull } = await supabase
          .from('bookings')
          .select('customer_email')
          .eq('id', bookingId)
          .maybeSingle()
        const email = bookingFull?.customer_email
        if (email) {
          const { count } = await supabase
            .from('bookings')
            .select('id', { count: 'exact', head: true })
            .eq('customer_email', email)
            .neq('id', bookingId)
          if ((count || 0) === 0) {
            const r1 = await triggerSystemMessageEvent({ bookingId, event: 'on_first_booking' })
            if (r1.sent || r1.errors) {
              console.log(`[post-booking-webhook] system messages on_first_booking: sent=${r1.sent} skipped=${r1.skipped} errors=${r1.errors}`)
            }
          }
        }
      } catch (e: any) {
        console.warn('[post-booking-webhook] on_first_booking check failed (non-blocking):', e.message)
      }

      if (isPaid) {
        const r2 = await triggerSystemMessageEvent({ bookingId, event: 'on_payment' })
        if (r2.sent || r2.errors) {
          console.log(`[post-booking-webhook] system messages on_payment: sent=${r2.sent} skipped=${r2.skipped} errors=${r2.errors}`)
        }
      }
    } catch (e: any) {
      console.error('[post-booking-webhook] system messages trigger failed:', e.message)
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, contractGenerated, fatturaGenerated }),
    }
  } catch (err: any) {
    console.error('[post-booking-webhook] Error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
