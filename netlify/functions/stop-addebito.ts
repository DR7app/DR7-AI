import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' }
    }

    try {
        const { addebitoId } = JSON.parse(event.body || '{}')
        if (!addebitoId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing addebitoId' }) }
        }

        const { data, error } = await supabase
            .from('pending_addebiti')
            .update({ status: 'stopped', recurring: false })
            .eq('id', addebitoId)
            .select('id, status')

        if (error) {
            console.error('[stop-addebito] Error:', error)
            return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
        }

        console.log(`[stop-addebito] Stopped addebito ${addebitoId}:`, data)
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, updated: data }) }
    } catch (err: any) {
        console.error('[stop-addebito] Error:', err)
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
    }
}

export { handler }
