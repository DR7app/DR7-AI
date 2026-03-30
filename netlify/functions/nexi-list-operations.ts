import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'

const NEXI_API_KEY = process.env.NEXI_API_KEY!
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'

const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }

    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }

    const { orderId } = JSON.parse(event.body || '{}')
    if (!orderId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'orderId required' }) }

    try {
        const res = await fetch(`${NEXI_BASE_URL}/orders/${orderId}/operations`, {
            headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': `list-${Date.now()}` }
        })
        const data = await res.json()
        return { statusCode: res.status, headers, body: JSON.stringify(data) }
    } catch (err: any) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
    }
}

export { handler }
