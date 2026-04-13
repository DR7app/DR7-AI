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

    const baseUrl = process.env.URL || 'https://admin.dr7empire.com'
    const authHeader = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.ADMIN_API_TOKEN}` }

    // Verify booking exists
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, vehicle_type, service_type, booking_details, payment_status')
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

    // 2. Generate fattura
    if (booking.payment_status === 'paid' || booking.payment_status === 'succeeded' || booking.payment_status === 'completed') {
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

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, contractGenerated, fatturaGenerated }),
    }
  } catch (err: any) {
    console.error('[post-booking-webhook] Error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
