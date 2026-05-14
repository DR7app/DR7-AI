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
  /** Permessi da assegnare se la riga admins viene creata da zero.
   *  Default: ['rilevazione-orari']. Usa ['*'] per accesso completo,
   *  oppure passa una lista di tab keys (vedi PERMISSION_SECTIONS).
   *  Se la riga admins esiste gia', `replacePermissions=true` la sovrascrive. */
  permissions?: string[]
  replacePermissions?: boolean
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
  const isDirezione = await userHasRole(callerEmail, 'direzione')
  const isDeveloper = await userHasRole(callerEmail, 'developer')
  if (!isDirezione && !isDeveloper) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Solo direzione o developer possono modificare le password.' }) }
  }

  let body: Body = {}
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  const email = String(body.email || '').trim().toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  const requestedPermissions = Array.isArray(body.permissions)
    ? body.permissions.map(String).filter(Boolean)
    : null
  const replacePermissions = !!body.replacePermissions

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email non valida' }) }
  }
  if (!password || password.length < 8) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'La password deve avere almeno 8 caratteri' }) }
  }

  // Cerca l'utente auth — Supabase non espone getUserByEmail, quindi
  // paginiamo listUsers fino a trovarlo (o esaurire). 1000 utenti / pagina
  // tipicamente basta in una richiesta sola, ma per sicurezza scorriamo
  // fino a 10 pagine (10k utenti) prima di considerarlo "non trovato".
  let existing: { id: string; email?: string | null } | undefined
  for (let page = 1; page <= 10; page++) {
    const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (listErr) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: listErr.message }) }
    }
    existing = list.users.find(u => (u.email || '').toLowerCase() === email)
    if (existing) break
    if (!list.users || list.users.length < 1000) break
  }

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
      user_metadata: { created_by: callerEmail },
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

  // Garantisco che esista una riga in admins per questo utente, altrimenti
  // l'app admin rifiuta il login (gli endpoint front-end query admins via
  // .single() e tornano 406 senza riga → utente bloccato sul login).
  // Permission di default minimal: rilevazione-orari. La direzione puo'
  // ampliare i permessi dall'UI Operatori.
  let adminsRowCreated = false
  try {
    const { data: existingAdmin } = await supabase
      .from('admins')
      .select('id')
      .or(`user_id.eq.${userId},email.ilike.${email}`)
      .maybeSingle()
    const initialPermissions = requestedPermissions && requestedPermissions.length > 0
      ? requestedPermissions
      : ['rilevazione-orari']
    const includesFinancial = ['fattura', 'nexi', 'unpaid', 'cauzioni'].some(t => initialPermissions.includes(t) || initialPermissions.includes('*'))
    if (!existingAdmin) {
      // Prendo nome dall'eventuale riga operatori_persone, fallback alla email.
      const { data: opRow } = await supabase
        .from('operatori_persone')
        .select('nome, cognome')
        .ilike('email', email)
        .maybeSingle()
      const fullName = opRow
        ? `${opRow.nome || ''} ${opRow.cognome || ''}`.trim() || email.split('@')[0]
        : email.split('@')[0]
      const { error: insErr } = await supabase
        .from('admins')
        .insert({
          user_id: userId,
          email,
          nome: fullName,
          role: 'admin',
          permissions: initialPermissions,
          can_view_financials: includesFinancial,
          stato: 'attivo',
        })
      if (insErr) {
        console.warn('[set-operator-password] admins insert failed (non-blocking)', insErr)
      } else {
        adminsRowCreated = true
      }
    } else if (!(existingAdmin as { id: string }).id) {
      // riga rotta — niente da fare
    } else {
      // Riga gia' presente: aggiorno user_id se mancante. Se il caller
      // ha chiesto replacePermissions, sovrascrivo anche i permessi
      // (utile per "Pieno accesso" o per estendere/restringere da UI).
      const updatePayload: Record<string, unknown> = { user_id: userId, stato: 'attivo' }
      if (replacePermissions && requestedPermissions && requestedPermissions.length > 0) {
        updatePayload.permissions = requestedPermissions
        updatePayload.can_view_financials = includesFinancial
      }
      await supabase
        .from('admins')
        .update(updatePayload)
        .eq('id', (existingAdmin as { id: string }).id)
    }
  } catch (e) {
    console.warn('[set-operator-password] admins upsert failed (non-blocking)', e)
  }

  // Verifica esplicita: rileggi l'utente per confermare che email_confirmed_at
  // sia stato impostato. Alcuni progetti Supabase con "Confirm email" attivo
  // ignorano il flag email_confirm via updateUserById se l'utente era stato
  // creato come unconfirmed in passato — in quel caso forziamo una seconda
  // update per garantire la verifica.
  let emailConfirmed = false
  try {
    const { data: check } = await supabase.auth.admin.getUserById(userId)
    if (check?.user?.email_confirmed_at) {
      emailConfirmed = true
    } else {
      // Forza la conferma con una update dedicata.
      await supabase.auth.admin.updateUserById(userId, { email_confirm: true })
      const { data: check2 } = await supabase.auth.admin.getUserById(userId)
      emailConfirmed = !!check2?.user?.email_confirmed_at
    }
  } catch (e) {
    console.warn('[set-operator-password] email_confirm verify failed', e)
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, userId, created, emailConfirmed, adminsRowCreated }),
  }
}

export { handler }
