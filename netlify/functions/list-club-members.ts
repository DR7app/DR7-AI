import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'
import { getCorsOrigin } from './cors-headers'

const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  // No auth required — read-only endpoint for admin badge display

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing config' }) }
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: subs, error } = await supabase
      .from('dr7_club_subscriptions')
      .select('user_id, plan, status, expires_at')
      .eq('status', 'active')

    if (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    }

    // Enrich with emails from customers_extended
    const userIds = (subs || []).map(s => s.user_id)
    let emailMap = new Map<string, string>()
    if (userIds.length > 0) {
      const { data: custs } = await supabase
        .from('customers_extended')
        .select('user_id, email')
        .in('user_id', userIds)
      if (custs) {
        custs.forEach((c: { user_id: string; email: string }) => {
          if (c.email) emailMap.set(c.user_id, c.email.toLowerCase())
        })
      }
    }

    const members = (subs || []).map(s => ({
      ...s,
      email: emailMap.get(s.user_id) || null,
    }))

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ members }),
    }
  } catch (err: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}

export { handler }
