import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'

export const handler: Handler = async (event) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json'
    }

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' }
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: 'Method Not Allowed' }
    }

    const { user: authUser, error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    try {
        const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        // Check env vars inside handler to return proper error instead of 502 crash
        if (!supabaseUrl || !supabaseServiceKey) {
            console.error('[delete-booking] Missing environment variables:', {
                hasUrl: !!supabaseUrl,
                hasKey: !!supabaseServiceKey
            })
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'Configuration Error: Missing backend environment variables. Check Netlify settings.'
                })
            }
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        const { bookingId } = JSON.parse(event.body || '{}')

        if (!bookingId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing bookingId' }) }
        }

        console.log(`[delete-booking] Attempting to delete booking: ${bookingId}`)

        // Soft delete: mark as cancelled (preserves booking, contracts, fatture)
        const { error } = await supabase
            .from('bookings')
            .update({ status: 'cancelled' })
            .eq('id', bookingId)

        // Cancel any active signature_requests for this booking so the
        // 30-min reminder cron stops chasing the customer with "Firma il
        // contratto" messages for a rental that no longer exists.
        const { error: sigErr } = await supabase
            .from('signature_requests')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('booking_id', bookingId)
            .in('status', ['pending', 'otp_sent', 'otp_verified'])
        if (sigErr) {
            console.warn('[delete-booking] Signature request cleanup warning:', sigErr.message)
        } else {
            console.log(`[delete-booking] Cancelled pending signature requests for booking ${bookingId}`)
        }

        // Restore any buono sconto linked to this booking
        const { error: buonoError } = await supabase
            .from('referral_discount_codes')
            .update({ used: false, used_at: null, booking_id: null })
            .eq('booking_id', bookingId)
        if (buonoError) console.warn('[delete-booking] Buono restore warning:', buonoError.message)

        // Drop ALL cauzioni linked to this booking. Deleting a booking is
        // a destructive admin action; the associated cauzione must follow
        // (otherwise it dangles in the Cauzioni tab pointing at a deleted
        // rental). Matches the unconditional-delete pattern already used
        // by CarWashBookingsTab and MechanicalBookingTab. Deleted rows
        // are logged so the admin can recover the values from the
        // function logs if needed.
        const { data: deletedCauzioni, error: cauzErr } = await supabase
            .from('cauzioni')
            .delete()
            .eq('riferimento_contratto_id', bookingId)
            .select('id, stato, importo, data_incasso')
        if (cauzErr) {
            console.warn('[delete-booking] Cauzioni cleanup warning:', cauzErr.message)
        } else if (deletedCauzioni && deletedCauzioni.length > 0) {
            console.log(`[delete-booking] Removed ${deletedCauzioni.length} cauzione(i) linked to booking ${bookingId}:`, deletedCauzioni.map(c => `${c.id} (${c.stato}, EUR ${c.importo})`).join(', '))
        }

        if (error) {
            console.error('[delete-booking] Supabase error:', error)
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: `Database error: ${error.message}` })
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ message: 'Booking deleted successfully' })
        }
    } catch (error: any) {
        console.error('[delete-booking] Server error:', error)
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: `Server error: ${error.message}` })
        }
    }
}
