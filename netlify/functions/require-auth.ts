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

    return { user: { id: user.id, email: user.email }, error: null }
  } catch {
    return {
      user: null,
      error: { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication failed' }) }
    }
  }
}
