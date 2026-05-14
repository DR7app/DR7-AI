import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

interface Body {
  operatoreId?: string
  email?: string
  /** Conferma esplicita dell'operatore richiesta — il client deve passare
   *  questa stringa per evitare che una chiamata accidentale faccia il
   *  delete. Lato UI: doppio confirm con typed name. */
  confirm?: string
}

/**
 * Hard delete di un operatore: rimuove TUTTI i dati collegati.
 * - timesheet_entries (storico orari)
 * - operatore_contratto (contratti)
 * - operatori_persone (anagrafica)
 * - admins (permessi + accesso admin)
 * - auth.users (account login)
 *
 * Caller: direzione only. Operazione irreversibile.
 */
const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers.origin || event.headers.Origin)

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) }

  const { error: authErr, user } = await requireAuth(event)
  if (authErr) return authErr

  const callerEmail = (user?.email || '').toLowerCase()
  if (!(await userHasRole(callerEmail, 'direzione'))) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Solo la direzione può eliminare operatori.' }) }
  }

  let body: Body = {}
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  const operatoreId = String(body.operatoreId || '').trim()
  const email = String(body.email || '').trim().toLowerCase()
  const confirm = String(body.confirm || '')
  if (!operatoreId && !email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'operatoreId o email obbligatorio' }) }
  }
  if (confirm !== 'DELETE_FOREVER') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Conferma mancante' }) }
  }
  if (email && email === callerEmail) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Non puoi eliminare il tuo stesso account.' }) }
  }

  // Risolvi tutti gli identificatori (operatoreId, email, user_id) per fare il
  // delete cross-tabella anche quando il caller passa solo uno dei tre.
  let resolvedOpId: string | null = operatoreId || null
  let resolvedEmail: string | null = email || null
  let resolvedUserId: string | null = null

  if (resolvedOpId) {
    const { data: opRow } = await supabase
      .from('operatori_persone')
      .select('id, email, user_id')
      .eq('id', resolvedOpId)
      .maybeSingle()
    if (opRow) {
      resolvedEmail = resolvedEmail || (opRow.email as string | null)?.toLowerCase() || null
      resolvedUserId = (opRow.user_id as string | null) || null
    }
  }
  if (!resolvedOpId && resolvedEmail) {
    const { data: opRow } = await supabase
      .from('operatori_persone')
      .select('id, user_id')
      .ilike('email', resolvedEmail)
      .maybeSingle()
    if (opRow) {
      resolvedOpId = opRow.id as string
      resolvedUserId = resolvedUserId || (opRow.user_id as string | null) || null
    }
  }

  // Auth user lookup via email (se non ancora trovato).
  if (!resolvedUserId && resolvedEmail) {
    const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    const found = list?.users.find(u => (u.email || '').toLowerCase() === resolvedEmail)
    if (found) resolvedUserId = found.id
  }

  if (resolvedEmail === callerEmail.toLowerCase()) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Non puoi eliminare il tuo stesso account.' }) }
  }

  const deleted: Record<string, number | string> = {}
  const errors: string[] = []

  // 1) timesheet_entries
  if (resolvedOpId) {
    const { error, count } = await supabase
      .from('timesheet_entries')
      .delete({ count: 'exact' })
      .eq('operatore_id', resolvedOpId)
    if (error) errors.push(`timesheet_entries: ${error.message}`)
    else deleted.timesheet_entries = count ?? 0
  }

  // 2) operatore_contratto
  if (resolvedOpId) {
    const { error, count } = await supabase
      .from('operatore_contratto')
      .delete({ count: 'exact' })
      .eq('operatore_id', resolvedOpId)
    if (error) errors.push(`operatore_contratto: ${error.message}`)
    else deleted.operatore_contratto = count ?? 0
  }

  // 3) operatori_persone
  if (resolvedOpId) {
    const { error, count } = await supabase
      .from('operatori_persone')
      .delete({ count: 'exact' })
      .eq('id', resolvedOpId)
    if (error) errors.push(`operatori_persone: ${error.message}`)
    else deleted.operatori_persone = count ?? 0
  }

  // 4) admins (per email o per user_id)
  if (resolvedEmail) {
    const { error, count } = await supabase
      .from('admins')
      .delete({ count: 'exact' })
      .ilike('email', resolvedEmail)
    if (error) errors.push(`admins(email): ${error.message}`)
    else deleted.admins_by_email = count ?? 0
  }
  if (resolvedUserId) {
    const { error, count } = await supabase
      .from('admins')
      .delete({ count: 'exact' })
      .eq('user_id', resolvedUserId)
    if (error) errors.push(`admins(user_id): ${error.message}`)
    else deleted.admins_by_user_id = count ?? 0
  }

  // 5) auth.users
  if (resolvedUserId) {
    const { error } = await supabase.auth.admin.deleteUser(resolvedUserId)
    if (error) errors.push(`auth.users: ${error.message}`)
    else deleted.auth_user = resolvedUserId
  }

  if (errors.length > 0) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Eliminazione parziale', details: errors, deleted }),
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, deleted, email: resolvedEmail }),
  }
}

export { handler }
