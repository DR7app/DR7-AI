import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'

const NEXI_API_KEY = process.env.NEXI_API_KEY!
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'

function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })
}

const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }

    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }

    const { orderId, mode } = JSON.parse(event.body || '{}')

    // Mode 'search': search all operations to find by orderId
    if (mode === 'search' && orderId) {
        try {
            // Search operations from the last 30 days
            const fromTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
            const toTime = new Date().toISOString()
            const url = `${NEXI_BASE_URL}/operations?fromTime=${encodeURIComponent(fromTime)}&toTime=${encodeURIComponent(toTime)}&maxRecords=500`
            const res = await fetch(url, {
                headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': uuid() }
            })
            const text = await res.text()
            let data: any
            try { data = JSON.parse(text) } catch { return { statusCode: 502, headers, body: JSON.stringify({ error: text.substring(0, 300) }) } }
            // Filter operations matching this orderId
            const ops = (data.operations || []).filter((op: any) => op.orderId === orderId)
            return { statusCode: 200, headers, body: JSON.stringify({ operations: ops, total: data.operations?.length || 0 }) }
        } catch (err: any) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
        }
    }

    if (!orderId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'orderId required' }) }

    try {
        const res = await fetch(`${NEXI_BASE_URL}/orders/${orderId}`, {
            headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': uuid() }
        })
        const text = await res.text()
        let data
        try { data = JSON.parse(text) } catch { data = { raw: text.substring(0, 500), status: res.status } }
        return { statusCode: 200, headers, body: JSON.stringify(data) }
    } catch (err: any) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
    }
}

export { handler }
