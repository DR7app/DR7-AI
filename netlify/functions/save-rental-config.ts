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

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Supabase config' }) }
  }

  try {
    const { config, email, section } = JSON.parse(event.body || '{}')
    if (!config) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing config' }) }

    console.log('[save-rental-config] Saving config, email:', email, 'section:', section)

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Check if row exists — use maybeSingle() to avoid error on empty table
    const { data: existing, error: selectErr } = await supabase
      .from('rental_extras_config')
      .select('id')
      .limit(1)
      .maybeSingle()

    if (selectErr) {
      console.error('[save-rental-config] Select error:', selectErr)
      // Don't throw — try insert as fallback
    }

    console.log('[save-rental-config] Existing row:', existing?.id || 'NONE')

    if (!existing) {
      // No row — INSERT
      console.log('[save-rental-config] Inserting new config row')
      const { error: insertErr } = await supabase
        .from('rental_extras_config')
        .insert({
          config,
          updated_at: new Date().toISOString(),
          updated_by: email || 'admin',
        })
      if (insertErr) {
        console.error('[save-rental-config] Insert error:', insertErr)
        throw new Error(`Insert failed: ${insertErr.message}`)
      }
      console.log('[save-rental-config] Insert OK')
    } else {
      // Row exists — UPDATE
      console.log('[save-rental-config] Updating row:', existing.id)
      const { error: updateErr } = await supabase
        .from('rental_extras_config')
        .update({
          config,
          updated_at: new Date().toISOString(),
          updated_by: email || 'admin',
        })
        .eq('id', existing.id)
      if (updateErr) {
        console.error('[save-rental-config] Update error:', updateErr)
        throw new Error(`Update failed: ${updateErr.message}`)
      }
      console.log('[save-rental-config] Update OK')
    }

    // Audit log (non-blocking)
    try {
      await supabase.from('config_audit_log').insert({
        changed_by: email || 'admin',
        section: section || 'centralina',
        created_at: new Date().toISOString(),
      })
    } catch { /* ignore audit errors */ }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  } catch (err: any) {
    console.error('[save-rental-config] FATAL:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Errore salvataggio' }) }
  }
}

export { handler }
