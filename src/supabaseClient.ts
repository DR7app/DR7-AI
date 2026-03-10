import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_ANON_KEY environment variable')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Handle expired/invalid sessions — redirect to login
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') return
  // If we get an error during token refresh, sign out and redirect
})

// Intercept auth errors globally
const originalGetSession = supabase.auth.getSession.bind(supabase.auth)
supabase.auth.getSession = async () => {
  const result = await originalGetSession()
  if (result.error?.message?.includes('Refresh Token') || result.error?.message?.includes('Invalid Refresh Token')) {
    console.warn('Session expired — signing out')
    await supabase.auth.signOut()
    window.location.href = '/login'
  }
  return result
}
