import { Handler } from '@netlify/functions'
import { requireAuth } from './require-auth'

/**
 * EMTN proxy — server-side wrapper around https://emtn.netlify.app/api/v1.
 *
 * Why a proxy:
 *  - EMTN_API_KEY MUST stay server-side (never reach the browser).
 *  - The browser sends a thin payload + path, we attach the bearer token
 *    and forward to EMTN. The response is relayed verbatim.
 *  - File uploads (events/:id/documents) go through here too, kept as
 *    multipart by re-streaming the original body.
 *
 * Auth: requires a logged-in admin (Supabase JWT via requireAuth) so
 * random anons can't ride this proxy as their personal EMTN client.
 *
 * Endpoint shape: POST /.netlify/functions/emtn-proxy
 *   body: { path: 'checkout/assess' | 'positive-history' | 'events' | ...,
 *           method?: 'GET'|'POST'|...,
 *           json?: any  // for JSON bodies
 *         }
 *   For multipart upload, pass a different content-type and the raw
 *   multipart body — the proxy detects multipart and forwards as-is.
 */

const EMTN_BASE = process.env.EMTN_API_BASE || 'https://emtn.netlify.app/api/v1'
const EMTN_API_KEY = process.env.EMTN_API_KEY

export const handler: Handler = async (event) => {
    const cors = {
        'Access-Control-Allow-Origin': event.headers.origin || '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    // Only logged-in admins may call EMTN. Otherwise an attacker who
    // knows our domain could turn this into a free EMTN client.
    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    if (!EMTN_API_KEY) {
        return {
            statusCode: 500,
            headers: { ...cors, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'EMTN_API_KEY non configurato sul server' }),
        }
    }

    const contentType = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase()
    const isMultipart = contentType.includes('multipart/form-data')

    let path: string
    let method = 'POST'
    let upstreamBody: string | Buffer | undefined
    const upstreamHeaders: Record<string, string> = {
        Authorization: `Bearer ${EMTN_API_KEY}`,
    }

    if (isMultipart) {
        // Multipart goes via query params for routing metadata — body is the raw upload.
        path = String(event.queryStringParameters?.path || '')
        method = String(event.queryStringParameters?.method || 'POST')
        upstreamBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : (event.body || '')
        upstreamHeaders['Content-Type'] = event.headers['content-type'] || event.headers['Content-Type'] || 'multipart/form-data'
    } else {
        try {
            const parsed = JSON.parse(event.body || '{}')
            path = String(parsed.path || '')
            method = String(parsed.method || 'POST').toUpperCase()
            if (parsed.json !== undefined) {
                upstreamBody = JSON.stringify(parsed.json)
                upstreamHeaders['Content-Type'] = 'application/json'
            }
        } catch {
            return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON body' }) }
        }
    }

    if (!path || path.includes('..')) {
        return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid path' }) }
    }

    const url = `${EMTN_BASE.replace(/\/$/, '')}/${path.replace(/^\//, '')}`

    try {
        const upstream = await fetch(url, {
            method,
            headers: upstreamHeaders,
            body: ['GET', 'HEAD'].includes(method) ? undefined : upstreamBody,
        })
        const text = await upstream.text()
        return {
            statusCode: upstream.status,
            headers: {
                ...cors,
                'Content-Type': upstream.headers.get('content-type') || 'application/json',
            },
            body: text,
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
            statusCode: 502,
            headers: { ...cors, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'EMTN upstream unreachable', detail: msg }),
        }
    }
}
