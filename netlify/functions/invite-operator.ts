import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

interface InviteBody {
  email?: string
  nome?: string
  permissions?: string[]
}

const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers.origin || event.headers.Origin)

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) }

  // Auth: must be a valid Supabase user, AND that user must be direzione.
  const { error: authErr, user } = await requireAuth(event)
  if (authErr) return authErr

  const callerEmail = (user?.email || '').toLowerCase()
  if (!(await userHasRole(callerEmail, 'direzione'))) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Solo la direzione può invitare operatori.' }) }
  }

  let body: InviteBody = {}
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  const email = String(body.email || '').trim().toLowerCase()
  const nome = String(body.nome || '').trim()
  const permissions = Array.isArray(body.permissions)
    ? body.permissions.map(String).filter(Boolean)
    : []

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email non valida' }) }
  }
  if (!nome) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nome obbligatorio' }) }
  }
  if (permissions.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Almeno un permesso richiesto' }) }
  }

  // Refuse if an admin row already exists for this email — direzione should
  // edit the existing row instead of creating a duplicate.
  const { data: existing } = await supabase
    .from('admins')
    .select('id, email')
    .ilike('email', email)
    .maybeSingle()
  if (existing) {
    return {
      statusCode: 409,
      headers,
      body: JSON.stringify({ error: 'Esiste già un operatore con questa email.' }),
    }
  }

  // Send Supabase invite email — the link redirects back to /reset-password
  // which already handles type=recovery / type=magiclink hashes (we add
  // type=invite handling in that page in a separate change).
  const baseUrl = process.env.URL || 'https://admin.dr7empire.com'
  const redirectTo = `${baseUrl}/reset-password`

  const { data: inviteData, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { nome, invited_by: callerEmail },
  })

  if (inviteErr || !inviteData?.user) {
    console.error('[invite-operator] inviteUserByEmail failed', inviteErr)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: inviteErr?.message || 'Invio invito fallito' }),
    }
  }

  // Create the admins row linked to the new auth user. role='admin' is the
  // safe default; permissions[] is what direzione actually wants this person
  // to see. can_view_financials is derived from permissions for backwards
  // compat with code paths that still read that flag.
  const includesFinancial = ['fattura', 'nexi', 'unpaid', 'cauzioni'].some(
    t => permissions.includes(t) || permissions.includes('*'),
  )

  const { data: adminRow, error: insErr } = await supabase
    .from('admins')
    .insert({
      user_id: inviteData.user.id,
      email,
      nome,
      role: 'admin',
      permissions,
      can_view_financials: includesFinancial,
      stato: 'attivo',
    })
    .select('id')
    .single()

  if (insErr) {
    console.error('[invite-operator] admins insert failed', insErr)
    // Best-effort cleanup: remove the auth user we just created so the
    // operator can be re-invited cleanly after fixing the data issue.
    try { await supabase.auth.admin.deleteUser(inviteData.user.id) } catch (e) { console.error(e) }
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: insErr.message || 'Creazione operatore fallita' }),
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      adminId: adminRow.id,
      userId: inviteData.user.id,
      email,
    }),
  }
}

export { handler }
