import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'

const NEXI_API_KEY = process.env.NEXI_API_KEY!
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'

const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' }

  try {
    const { orderId } = JSON.parse(event.body || '{}')
    if (!orderId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'orderId required' }) }

    const correlationId = crypto.randomUUID()

    // 1. Try direct order lookup
    const orderUrl = `${NEXI_BASE_URL}/orders/${orderId}`
    const orderRes = await fetch(orderUrl, {
      headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': correlationId }
    })
    const orderData = orderRes.ok ? await orderRes.json() : null

    // 2. Search operations (last 30 days)
    const fromTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const toTime = new Date().toISOString()

    // Search AUTHORIZATION type
    const authUrl = `${NEXI_BASE_URL}/operations?fromTime=${encodeURIComponent(fromTime)}&toTime=${encodeURIComponent(toTime)}&maxRecords=500&operationType=AUTHORIZATION`
    const authRes = await fetch(authUrl, {
      headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': crypto.randomUUID() }
    })
    const authData = authRes.ok ? await authRes.json() : null
    const allOps = authData?.operations || []

    // Filter matching orderId
    const matchingOps = allOps.filter((op: any) => op.orderId === orderId)

    // Also search PRE_AUTHORIZATION type
    const preauthUrl = `${NEXI_BASE_URL}/operations?fromTime=${encodeURIComponent(fromTime)}&toTime=${encodeURIComponent(toTime)}&maxRecords=500&operationType=PRE_AUTHORIZATION`
    const preauthRes = await fetch(preauthUrl, {
      headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': crypto.randomUUID() }
    })
    const preauthData = preauthRes.ok ? await preauthRes.json() : null
    const preauthOps = (preauthData?.operations || []).filter((op: any) => op.orderId === orderId)

    // Combine all matches
    const allMatches = [...matchingOps, ...preauthOps]

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        orderId,
        orderLookup: orderData,
        matchingOperations: allMatches,
        totalAuthScanned: allOps.length,
        totalPreauthScanned: preauthData?.operations?.length || 0,
        summary: allMatches.map((op: any) => ({
          operationId: op.operationId,
          operationType: op.operationType,
          operationResult: op.operationResult,
          amount: op.operationAmount,
          authorizationCode: op.authorizationCode,
          orderId: op.orderId,
        }))
      }, null, 2)
    }
  } catch (err: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}

export { handler }
