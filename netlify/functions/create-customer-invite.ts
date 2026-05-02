import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { getCorsOrigin } from './cors-headers'
import { requireAuth } from './require-auth'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * Generates a one-time customer registration token.
 * - Admin-only (require auth).
 * - Default validity: 7 days.
 * - Token is a 32-byte random URL-safe string.
 */
const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' }

    const { error: authErr, user } = await requireAuth(event)
    if (authErr) return authErr

    try {
        const { note, expirationDays = 7 } = JSON.parse(event.body || '{}')

        // Generate URL-safe token (32 bytes → 43 chars base64url)
        const bytes = crypto.getRandomValues(new Uint8Array(32))
        const token = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + Math.max(1, Math.min(30, Number(expirationDays) || 7)))

        const adminName = (user?.user_metadata as Record<string, string> | undefined)?.full_name
            || user?.email
            || null

        const { data: inviteRow, error: insErr } = await supabase
            .from('customer_invites')
            .insert({
                token,
                created_by: user?.id || null,
                created_by_name: adminName,
                note: note ? String(note).slice(0, 500) : null,
                expires_at: expiresAt.toISOString(),
            })
            .select()
            .single()

        if (insErr) throw insErr

        const baseUrl = process.env.URL || 'https://admin.dr7empire.com'
        const url = `${baseUrl}/registrazione-cliente/${token}`

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                token,
                url,
                expiresAt: expiresAt.toISOString(),
                inviteId: inviteRow.id,
            }),
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[create-customer-invite] error', err)
        return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) }
    }
}

export { handler }
