import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

// One-shot endpoint to store GA4 service-account credentials in Supabase
// (table app_secrets). We use Supabase instead of Netlify Blobs because:
//   1. AWS Lambda's 4KB env-var cap doesn't allow the ~1.7KB private key
//      alongside DR7's existing 40+ env vars.
//   2. Netlify Blobs auto-config doesn't kick in for v1 lambda-style
//      functions in this project (returns "environment not configured").
//
// Bootstrap mode: first write requires no auth (so we can populate the
// secret without having ADMIN_API_TOKEN handy on the client side).
// Subsequent writes (rotation) require Bearer ADMIN_API_TOKEN.
//
// Body: { "privateKey": "-----BEGIN PRIVATE KEY-----\n...", "clientEmail": "..." }

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

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

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase env mancante' }) }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Bootstrap auth: allow first write, require token afterwards.
  const { data: existing } = await supabase
    .from('app_secrets')
    .select('key')
    .eq('key', 'ga4_creds')
    .maybeSingle()

  const alreadySet = !!existing

  if (alreadySet) {
    const adminToken = process.env.ADMIN_API_TOKEN
    if (!adminToken) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'ADMIN_API_TOKEN non configurato (richiesto per sovrascrivere creds esistenti)' }) }
    }
    const authHeader = event.headers.authorization || event.headers.Authorization || ''
    const provided = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (provided !== adminToken) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized — credenziali GA4 già impostate; serve Bearer ADMIN_API_TOKEN per sovrascrivere' }) }
    }
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
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'privateKey non sembra una chiave PEM' }) }
  }

  const value = {
    privateKey: body.privateKey.replace(/\\n/g, '\n'),
    clientEmail: body.clientEmail || null,
  }

  const { error } = await supabase
    .from('app_secrets')
    .upsert({ key: 'ga4_creds', value, updated_at: new Date().toISOString() }, { onConflict: 'key' })

  if (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: error.message,
        hint: error.code === '42P01' ? 'Crea la tabella app_secrets in Supabase: create table public.app_secrets (key text primary key, value jsonb not null, updated_at timestamptz default now()); alter table public.app_secrets enable row level security;' : undefined,
      }),
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, message: 'Credenziali GA4 salvate in Supabase app_secrets', clientEmail: value.clientEmail }),
  }
}

export { handler }
