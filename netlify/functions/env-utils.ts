/**
 * Shared environment variable validation for Netlify functions.
 * Use getRequiredEnv() instead of process.env.VAR! to fail fast with clear errors.
 */

export function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export function getSupabaseConfig() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_URL environment variable')
  }
  if (!serviceKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable')
  }

  return { url, serviceKey }
}
