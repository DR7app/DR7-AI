// Server-side mirror of src/hooks/useAdminRole.ts hasRole(). Netlify
// functions check role tags by reading admins.permissions[] with an
// email-keyed failsafe so valerio/ilenia/ophe can never be locked out.
import { createClient } from '@supabase/supabase-js'

export type AdminRoleTag =
  | 'direzione'
  | 'bypass-otp'
  | 'developer'
  | 'payment-manager'
  | 'stipendio-editor'
  | 'sito-direzione'
  | 'preventivi-admin'

// Same map as src/hooks/useAdminRole.ts ROLE_FAILSAFE — keep in sync when
// either side changes. Recovery floor: edit requires a deploy.
const ROLE_FAILSAFE: Record<string, ReadonlySet<AdminRoleTag>> = {
  'valerio@dr7.app':   new Set(['direzione', 'payment-manager', 'stipendio-editor', 'sito-direzione', 'preventivi-admin']),
  'ilenia@dr7.app':    new Set(['direzione', 'payment-manager', 'stipendio-editor', 'sito-direzione', 'preventivi-admin']),
  'ophe@dr7.app':      new Set(['developer', 'sito-direzione']),
  // Salvatore promosso a direzione il 2026-05-18 (allineato a src/hooks/useAdminRole.ts).
  // Prima aveva solo sito-direzione → list-operators ritornava 403 e il
  // Report Operatori era vuoto. KEEP IN SYNC con src/hooks/useAdminRole.ts.
  'salvatore@dr7.app': new Set(['payment-manager', 'stipendio-editor', 'sito-direzione', 'preventivi-admin']),
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
 * - An archived operator (admins.archived_at set) has NO role, even if the
 *   old tags are still on the row: archiving keeps the row for history, so
 *   the tags alone are not proof of current access. Same rule as
 *   useAdminRole on the client and the RLS helpers in the database.
 * - Empty/missing email → false.
 */
export async function userHasRole(userEmail: string | null | undefined, role: AdminRoleTag): Promise<boolean> {
  const email = (userEmail || '').toLowerCase()
  if (!email) return false
  if (ROLE_FAILSAFE[email]?.has(role)) return true
  try {
    let { data, error } = await getClient()
      .from('admins')
      .select('permissions, archived_at')
      .eq('email', email)
      .maybeSingle()
    // Database without the archive migration: fall back to the old select
    // instead of locking every operator out.
    if (error && /archived_at/.test(error.message || '')) {
      ({ data, error } = await getClient()
        .from('admins')
        .select('permissions')
        .eq('email', email)
        .maybeSingle())
    }
    if (error) throw error
    const riga = data as { permissions?: unknown; archived_at?: string | null } | null
    if (!riga || riga.archived_at) return false
    const perms = Array.isArray(riga.permissions) ? riga.permissions.map(String) : []
    return perms.includes(`role:${role}`)
  } catch (e) {
    console.warn('[adminRoles] permissions lookup failed for', email, e)
    return false
  }
}
