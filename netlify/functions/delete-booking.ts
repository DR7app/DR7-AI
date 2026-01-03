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

        // 1. Cancel booking first (to safe-guard status checks)
        await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)

        // 2. Cascade delete related records
        // Delete related invoices (fatture)
        const { error: invoiceError } = await supabase.from('fatture').delete().eq('booking_id', bookingId)
        if (invoiceError) console.warn('[delete-booking] Invoice deletion warning:', invoiceError.message)

        // Delete related contracts
        const { error: contractError } = await supabase.from('contracts').delete().eq('booking_id', bookingId)
        if (contractError) console.warn('[delete-booking] Contract deletion warning:', contractError.message)

        // Delete related payments? (wallet_transactions might reference it)
        // If wallet_transactions references booking_id, we should delete those too? 
        // For now, let's stick to what we know failed. 

        // 3. Delete the booking
        const { error } = await supabase
            .from('bookings')
            .delete()
            .eq('id', bookingId)

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
