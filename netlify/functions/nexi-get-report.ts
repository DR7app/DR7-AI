import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Use POST' }

  // Check nexi_transactions for report row
  const { data, error } = await supabase
    .from('nexi_transactions')
    .select('order_id, metadata, created_at')
    .like('order_id', 'REPORT_%')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Report non trovato. Il job potrebbe essere ancora in esecuzione.', dbError: error?.message }) }
  }

  return { statusCode: 200, headers, body: JSON.stringify(data.metadata, null, 2) }
}
