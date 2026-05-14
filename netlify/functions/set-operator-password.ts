import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

interface Body {
  email?: string
  password?: string
}

/**
 * Reset / set the password of an operator's auth account.
 * Lookup: by email (case-insensitive). If the auth user doesn't exist
 * (operator was created without a linked auth account), the function
 * creates it with email_confirm: true so they can log in immediately.
 *
 * Caller must hold the 'direzione' role.
 */
const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers.origin || event.headers.Origin)

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) }

  const { error: authErr, user } = await requireAuth(event)
  if (authErr) return authErr

  const callerEmail = (user?.email || '').toLowerCase()
  if (!(await userHasRole(callerEmail, 'direzione'))) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Solo la direzione può modificare le password.' }) }
  }

  let body: Body = {}
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  const email = String(body.email || '').trim().toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email non valida' }) }
  }
  if (!password || password.length < 8) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'La password deve avere almeno 8 caratteri' }) }
  }

  // Cerca l'utente auth tramite listUsers (Supabase non espone getUserByEmail).
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (listErr) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: listErr.message }) }
  }
  const existing = list.users.find(u => (u.email || '').toLowerCase() === email)

  let userId: string
  let created = false
  if (existing) {
    const { error: upErr } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    })
    if (upErr) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: upErr.message }) }
    }
    userId = existing.id
  } else {
    const { data: newU, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { reset_by: callerEmail },
    })
    if (createErr || !newU?.user) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: createErr?.message || 'Creazione utente fallita' }) }
    }
    userId = newU.user.id
    created = true
  }

  // Best-effort: collega user_id su operatori_persone se la riga esiste e non e' gia' collegata.
  try {
    await supabase
      .from('operatori_persone')
      .update({ user_id: userId })
      .ilike('email', email)
      .is('user_id', null)
  } catch (e) {
    console.warn('[set-operator-password] linking operatori_persone failed (non-blocking)', e)
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, userId, created }),
  }
}

export { handler }
