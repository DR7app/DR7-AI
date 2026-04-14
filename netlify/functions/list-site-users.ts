import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers.origin)

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: '{"error":"Method not allowed"}' }

  const { error: authErr } = await requireAuth(event)
  if (authErr) return authErr

  try {
    // Fetch all auth users with admin API
    const allUsers: any[] = []
    let page = 1
    const perPage = 1000

    while (true) {
      const { data: { users }, error } = await supabase.auth.admin.listUsers({
        page,
        perPage,
      })
      if (error) throw error
      if (!users || users.length === 0) break
      allUsers.push(...users.map(u => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        email_confirmed_at: u.email_confirmed_at,
        last_sign_in_at: u.last_sign_in_at,
      })))
      if (users.length < perPage) break
      page++
    }

    // Get credit balances
    const { data: balances } = await supabase
      .from('user_credit_balance')
      .select('user_id, balance')

    const balanceMap = new Map<string, number>()
    if (balances) {
      for (const b of balances) {
        balanceMap.set(b.user_id, b.balance)
      }
    }

    // Get customer names from customers_extended
    const { data: customers } = await supabase
      .from('customers_extended')
      .select('user_id, nome, cognome, telefono')
      .not('user_id', 'is', null)

    const custMap = new Map<string, any>()
    if (customers) {
      for (const c of customers) {
        if (c.user_id) custMap.set(c.user_id, c)
      }
    }

    const enriched = allUsers.map(u => ({
      ...u,
      balance: balanceMap.get(u.id) || 0,
      nome: custMap.get(u.id)?.nome || '',
      cognome: custMap.get(u.id)?.cognome || '',
      telefono: custMap.get(u.id)?.telefono || '',
    }))

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, users: enriched, total: enriched.length }),
    }
  } catch (err: any) {
    console.error('[list-site-users] Error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
