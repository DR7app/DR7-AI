/**
 * Diagnostic endpoint: dump what Nexi's /operations and /orders/.../operations
 * actually return for a given orderId or operationId. Use to figure out why
 * a card row in the admin Carte Tokenizzate tab has no masked PAN —
 * either Nexi exposes it (and we have a saving bug) or it doesn't (wallet
 * payment, nothing to recover).
 *
 * GET /.netlify/functions/nexi-debug-operation?orderId=P3419c72bmowsfb49
 *   or ?operationId=109590602440061289
 *
 * Auth-gated. Returns the raw Nexi responses + the masked PAN we'd extract.
 */

import { Handler } from '@netlify/functions'
import { randomUUID } from 'crypto'
import { requireAuth } from './require-auth'
import { getCorsOrigin } from './cors-headers'

const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'
const NEXI_API_KEY = process.env.NEXI_API_KEY!

const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json',
    }
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }

    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    const orderId = event.queryStringParameters?.orderId
    const operationId = event.queryStringParameters?.operationId
    if (!orderId && !operationId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Provide orderId or operationId' }) }
    }

    const result: Record<string, unknown> = {}

    if (operationId) {
        try {
            const r = await fetch(`${NEXI_BASE_URL}/operations/${operationId}`, {
                headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': randomUUID() },
            })
            result.operation_status = r.status
            result.operation = r.ok ? await r.json() : null
        } catch (e: unknown) {
            result.operation_error = e instanceof Error ? e.message : String(e)
        }
    }

    if (orderId) {
        try {
            const r = await fetch(`${NEXI_BASE_URL}/orders/${orderId}/operations`, {
                headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': randomUUID() },
            })
            result.order_operations_status = r.status
            result.order_operations = r.ok ? await r.json() : null
        } catch (e: unknown) {
            result.order_operations_error = e instanceof Error ? e.message : String(e)
        }
    }

    return { statusCode: 200, headers, body: JSON.stringify(result, null, 2) }
}

export { handler }
