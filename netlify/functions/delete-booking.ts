
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    // Only allow POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' }
    }

    try {
        const { bookingId } = JSON.parse(event.body || '{}')

        if (!bookingId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing bookingId' }) }
        }

        console.log(`[delete-booking] Deleting booking ${bookingId}`)

        // Delete from database using service role (bypasses RLS)
        const { error } = await supabase
            .from('bookings')
            .delete()
            .eq('id', bookingId)

        if (error) {
            console.error('[delete-booking] Database deletion failed:', error)
            return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
        }

        console.log(`[delete-booking] Successfully deleted booking ${bookingId}`)

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true })
        }
    } catch (error: any) {
        console.error('[delete-booking] Unexpected error:', error)
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    }
}
