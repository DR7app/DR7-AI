import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { getCorsOrigin } from './cors-headers'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * Public endpoint — validates a customer-invite token.
 * Returns { valid, expired, used, revoked, expiresAt } so the public
 * registration page can decide what to render.
 *
 * Does NOT authenticate the caller — the invite token itself is the
 * authentication.
 */
const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json',
    }

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: 'Method Not Allowed' }

    try {
        const token = event.queryStringParameters?.token || ''
        if (!token || token.length < 16) {
            return { statusCode: 400, headers, body: JSON.stringify({ valid: false, reason: 'token_missing' }) }
        }

        const { data: row } = await supabase
            .from('customer_invites')
            .select('id, expires_at, used_at, revoked_at, customer_id')
            .eq('token', token)
            .maybeSingle()

        if (!row) {
            return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: 'not_found' }) }
        }

        const now = new Date()
        const expired = new Date(row.expires_at) < now
        const used = !!row.used_at
        const revoked = !!row.revoked_at

        const valid = !expired && !used && !revoked

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                valid,
                expired,
                used,
                revoked,
                expiresAt: row.expires_at,
                customerId: row.customer_id,
            }),
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { statusCode: 500, headers, body: JSON.stringify({ valid: false, error: msg }) }
    }
}

export { handler }
