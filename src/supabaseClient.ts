import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl) {
  throw new Error('Missing VITE_SUPABASE_URL environment variable')
}

if (!supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_ANON_KEY environment variable')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Handle expired/invalid sessions — redirect to login
supabase.auth.onAuthStateChange(async (event) => {
  if (event === 'SIGNED_OUT') return
  if (event === 'TOKEN_REFRESHED') return

  // Check for invalid refresh tokens on any auth event
  const { error } = await supabase.auth.getSession()
  if (error?.message?.includes('Refresh Token') || error?.message?.includes('Invalid Refresh Token')) {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }
})
