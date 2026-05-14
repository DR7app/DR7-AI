import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * Lista TUTTI gli operatori (operatori_persone) bypassando RLS via
 * service role. Accessibile solo a direzione/developer — usato come
 * fallback quando la query lato client torna parziale per via di
 * policy RLS.
 */
const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers.origin || event.headers.Origin)

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) }
  }

  const { error: authErr, user } = await requireAuth(event)
  if (authErr) return authErr

  const callerEmail = (user?.email || '').toLowerCase()
  const isDirezione = await userHasRole(callerEmail, 'direzione')
  const isDeveloper = await userHasRole(callerEmail, 'developer')
  if (!isDirezione && !isDeveloper) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Solo direzione o developer.' }) }
  }

  // Includi inattivi (attivo=false) cosi' la direzione li vede tutti e
  // puo' decidere se riattivare/eliminare.
  const includeInactive = String(event.queryStringParameters?.includeInactive || '') === '1'

  let query = supabase
    .from('operatori_persone')
    .select('id, user_id, nome, cognome, email, ruolo, ore_target_giornaliere, avatar_url, attivo')
    .order('nome', { ascending: true })

  if (!includeInactive) {
    query = query.eq('attivo', true)
  }

  const { data, error } = await query
  if (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ operatori: data || [] }),
  }
}

export { handler }
