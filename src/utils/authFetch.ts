/**
 * Authenticated fetch wrapper that automatically attaches the Supabase JWT
 * to all requests to Netlify functions.
 *
 * Usage:
 *   import { authFetch } from '../utils/authFetch'
 *   const res = await authFetch('/.netlify/functions/delete-booking', { method: 'POST', body: ... })
 */
import { supabase } from '../supabaseClient'

export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  const headers = new Headers(init?.headers)
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return fetch(url, { ...init, headers })
}
