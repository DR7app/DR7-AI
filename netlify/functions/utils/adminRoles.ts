// Server-side mirror of src/hooks/useAdminRole.ts hasRole(). Netlify
// functions check role tags by reading admins.permissions[] with an
// email-keyed failsafe so valerio/ilenia/ophe can never be locked out.
import { createClient } from '@supabase/supabase-js'

export type AdminRoleTag =
  | 'direzione'
  | 'developer'
  | 'payment-manager'
  | 'stipendio-editor'
  | 'sito-direzione'
  | 'preventivi-admin'

// Same map as src/hooks/useAdminRole.ts ROLE_FAILSAFE — keep in sync when
// either side changes. Recovery floor: edit requires a deploy.
const ROLE_FAILSAFE: Record<string, ReadonlySet<AdminRoleTag>> = {
  'valerio@dr7.app': new Set(['direzione', 'payment-manager', 'stipendio-editor', 'sito-direzione', 'preventivi-admin']),
  'ilenia@dr7.app':  new Set(['direzione', 'payment-manager', 'stipendio-editor', 'sito-direzione', 'preventivi-admin']),
  'ophe@dr7.app':    new Set(['developer', 'sito-direzione']),
}

let cachedClient: ReturnType<typeof createClient> | null = null
function getClient() {
  if (cachedClient) return cachedClient
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env missing for adminRoles helper')
  cachedClient = createClient(url, key)
  return cachedClient
}

/**
 * Returns true if the authenticated user has the given role tag.
 * - Failsafe map wins first (valerio/ilenia/ophe can never lose their roles).
 * - Falls through to admins.permissions[] containing `role:<tag>`.
 * - Empty/missing email → false.
 */
export async function userHasRole(userEmail: string | null | undefined, role: AdminRoleTag): Promise<boolean> {
  const email = (userEmail || '').toLowerCase()
  if (!email) return false
  if (ROLE_FAILSAFE[email]?.has(role)) return true
  try {
    const { data } = await getClient()
      .from('admins')
      .select('permissions')
      .eq('email', email)
      .maybeSingle()
    const perms = Array.isArray((data as { permissions?: unknown } | null)?.permissions)
      ? (data as { permissions: unknown[] }).permissions.map(String)
      : []
    return perms.includes(`role:${role}`)
  } catch (e) {
    console.warn('[adminRoles] permissions lookup failed for', email, e)
    return false
  }
}
