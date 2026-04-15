import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'
import { getCorsOrigin } from './cors-headers'

const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const { error: authErr } = await requireAuth(event)
  if (authErr) return authErr

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  try {
    const { config, email, section } = JSON.parse(event.body || '{}')
    if (!config) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing config' }) }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Get existing row
    const { data: existing } = await supabase
      .from('rental_extras_config')
      .select('id')
      .limit(1)
      .single()

    if (!existing) {
      const { error } = await supabase
        .from('rental_extras_config')
        .insert({ config, updated_at: new Date().toISOString(), updated_by: email || 'admin' })
      if (error) throw error
    } else {
      const { error } = await supabase
        .from('rental_extras_config')
        .update({ config, updated_at: new Date().toISOString(), updated_by: email || 'admin' })
        .eq('id', existing.id)
      if (error) throw error
    }

    // Audit log (non-blocking)
    try {
      await supabase.from('config_audit_log').insert({
        changed_by: email || 'admin',
        section: section || 'centralina',
        created_at: new Date().toISOString(),
      })
    } catch { /* ignore */ }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  } catch (err: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}

export { handler }
