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
  /** Optional initial password. Quando presente l'account viene creato
   *  con email confermata e password impostata: l'operatore puo\' fare
   *  login immediatamente, senza email di invito. */
  password?: string
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
  const password = typeof body.password === 'string' ? body.password : ''
  const permissions = Array.isArray(body.permissions)
    ? body.permissions.map(String).filter(Boolean)
    : []

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email non valida' }) }
  }
  if (!nome) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nome obbligatorio' }) }
  }
  if (password && password.length < 8) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'La password deve avere almeno 8 caratteri' }) }
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

  // Two flows:
  //  - password presente → createUser con email gia' confermata, l'operatore
  //    fa login immediatamente con la password fornita e potra' cambiarla
  //    dal proprio profilo (/reset-password classico).
  //  - password assente → inviteUserByEmail, l'operatore riceve un'email
  //    con un link per impostare la sua password (flusso storico).
  const baseUrl = process.env.URL || 'https://admin.dr7empire.com'
  const redirectTo = `${baseUrl}/reset-password`

  let newUserId: string
  let inviteSent = false
  if (password) {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome, invited_by: callerEmail },
    })
    if (createErr || !created?.user) {
      console.error('[invite-operator] createUser failed', createErr)
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: createErr?.message || 'Creazione utente fallita' }),
      }
    }
    newUserId = created.user.id
  } else {
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
    newUserId = inviteData.user.id
    inviteSent = true
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
      user_id: newUserId,
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
    try { await supabase.auth.admin.deleteUser(newUserId) } catch (e) { console.error(e) }
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
      userId: newUserId,
      email,
      inviteSent,
      passwordSet: !!password,
    }),
  }
}

export { handler }
