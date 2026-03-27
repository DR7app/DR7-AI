import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

export const handler: Handler = async (event) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    }

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' }
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: 'Method Not Allowed' }
    }

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

        // Restore any buono sconto linked to this booking
        const { error: buonoError } = await supabase
            .from('referral_discount_codes')
            .update({ used: false, used_at: null, booking_id: null })
            .eq('booking_id', bookingId)
        if (buonoError) console.warn('[delete-booking] Buono restore warning:', buonoError.message)

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
