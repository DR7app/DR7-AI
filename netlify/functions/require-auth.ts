/**
 * Shared authentication middleware for Netlify functions.
 *
 * Validates requests using EITHER:
 *   1. Supabase JWT (Authorization: Bearer <jwt>) — validated via supabase.auth.getUser()
 *   2. Admin API token (Authorization: Bearer <ADMIN_API_TOKEN>) — for legacy/internal calls
 *
 * Usage:
 *   const { user, error } = await requireAuth(event)
 *   if (error) return error  // Returns a pre-formatted 401 response
 */
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'

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

    return { user: { id: user.id, email: user.email }, error: null }
  } catch {
    return {
      user: null,
      error: { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication failed' }) }
    }
  }
}
