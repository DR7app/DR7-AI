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
        const res = await fetch(`${NEXI_BASE_URL}/orders/${orderId}`, {
            headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16) }) }
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
