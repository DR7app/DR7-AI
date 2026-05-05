import { Handler } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

// One-shot endpoint to load the GA4 service-account private key into
// Netlify Blobs. Bypasses the 4KB Lambda env-var cap that prevents
// putting the ~1.7KB private key in regular env vars alongside the
// rest of DR7's existing secrets.
//
// Usage (from your machine, once):
//   curl -X POST https://admin.dr7empire.com/.netlify/functions/ga-setup-key \
//     -H "Authorization: Bearer $ADMIN_API_TOKEN" \
//     -H "Content-Type: application/json" \
//     -d "$(jq -Rs '{privateKey: .}' < private-key.txt)"
//
// Or send the JSON service-account file directly:
//   curl -X POST https://admin.dr7empire.com/.netlify/functions/ga-setup-key \
//     -H "Authorization: Bearer $ADMIN_API_TOKEN" \
//     -H "Content-Type: application/json" \
//     -d "$(cat dr7-reviews-XXXXX.json | jq -c '{privateKey: .private_key, clientEmail: .client_email}')"
//
// Stored under store="ga4", key="creds" as JSON {privateKey, clientEmail}.
// Idempotent — overwrites on each call.

const handler: Handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  // Auth — require ADMIN_API_TOKEN bearer
  const adminToken = process.env.ADMIN_API_TOKEN
  if (!adminToken) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ADMIN_API_TOKEN non configurato sul server' }) }
  }
  const authHeader = event.headers.authorization || event.headers.Authorization || ''
  const provided = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (provided !== adminToken) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) }
  }

  let body: { privateKey?: string; clientEmail?: string } = {}
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Body non è JSON valido' }) }
  }

  if (!body.privateKey || typeof body.privateKey !== 'string') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'privateKey mancante nel body' }) }
  }
  if (!body.privateKey.includes('BEGIN PRIVATE KEY')) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'privateKey non sembra una chiave PEM (manca BEGIN PRIVATE KEY)' }) }
  }

  try {
    const store = getStore('ga4')
    await store.setJSON('creds', {
      privateKey: body.privateKey.replace(/\\n/g, '\n'),
      clientEmail: body.clientEmail || null,
      updatedAt: new Date().toISOString(),
    })
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        message: 'Credenziali GA4 salvate in Netlify Blobs',
        clientEmail: body.clientEmail || null,
      }),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[ga-setup-key]', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err?.message || String(err) }) }
  }
}

export { handler }
