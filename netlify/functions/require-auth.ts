/**
 * Shared authentication middleware for Netlify functions.
 *
 * Validates requests using EITHER:
 *   1. Supabase JWT (Authorization: Bearer <jwt>) of a STAFF user (active row in
 *      `admins`, or the direzione failsafe) — a customer JWT gets 403
 *   2. Admin API token (Authorization: Bearer <ADMIN_API_TOKEN>) — for legacy/internal calls
 *
 * Usage:
 *   const { user, error } = await requireAuth(event)
 *   if (error) return error  // Returns a pre-formatted 401 response
 */
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { userIsStaff } from './utils/adminRoles'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const adminApiToken = process.env.ADMIN_API_TOKEN

interface AuthResult {
  user: { id: string; email?: string } | null
  error: { statusCode: number; headers: Record<string, string>; body: string } | null
}

// 05/10/2026 — ogni chiamata del gestionale rifaceva in fila due giri verso
// Supabase prima di cominciare il lavoro vero: verifica del token
// (/auth/v1/user) e riga `admins`. Un'istanza calda della function ora ricorda
// per 60 secondi i token GIA' verificati come staff. Solo gli esiti positivi:
// un token rifiutato si riverifica sempre. La copia non supera mai la scadenza
// del token stesso. Effetto collaterale accettato: un operatore archiviato
// adesso resta dentro al massimo 60 secondi su quell'istanza.
const STAFF_VERIFICATO_MS = 60_000
const staffVerificati = new Map<string, { user: { id: string; email?: string }; finoA: number }>()

function scadenzaToken(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8'))
    return typeof payload?.exp === 'number' ? payload.exp * 1000 : 0
  } catch {
    return 0
  }
}

export async function requireAuth(event: { headers: Record<string, string> }): Promise<AuthResult> {
  const origin = event.headers.origin || event.headers.Origin
  const headers = corsHeaders(origin)

  const authHeader = event.headers.authorization || event.headers.Authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      user: null,
      error: { statusCode: 401, headers, body: JSON.stringify({ error: 'Missing Authorization header' }) }
    }
  }

  const token = authHeader.replace('Bearer ', '')

  // Check admin API token first (fast path)
  if (adminApiToken && token === adminApiToken) {
    return { user: { id: 'admin', email: 'admin@dr7empire.com' }, error: null }
  }

  // Validate Supabase JWT
  const ricordato = staffVerificati.get(token)
  if (ricordato && ricordato.finoA > Date.now()) return { user: ricordato.user, error: null }
  if (ricordato) staffVerificati.delete(token)

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return {
        user: null,
        error: { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired token' }) }
      }
    }

    // 29/09/2026: un token valido NON basta. I clienti di dr7.app hanno un
    // token dello stesso progetto Supabase: senza questo controllo potevano
    // chiamare le 78 function del gestionale che usano requireAuth. Stessa
    // regola di dr7_is_staff() nel database.
    if (!(await userIsStaff(user.id, user.email))) {
      return {
        user: null,
        error: { statusCode: 403, headers, body: JSON.stringify({ error: 'Riservato agli operatori del gestionale' }) }
      }
    }

    const verificato = { id: user.id, email: user.email }
    const finoA = Math.min(Date.now() + STAFF_VERIFICATO_MS, scadenzaToken(token))
    if (finoA > Date.now()) {
      if (staffVerificati.size > 500) staffVerificati.clear()
      staffVerificati.set(token, { user: verificato, finoA })
    }
    return { user: verificato, error: null }
  } catch {
    return {
      user: null,
      error: { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication failed' }) }
    }
  }
}
