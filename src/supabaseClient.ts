import { createClient } from '@supabase/supabase-js'
import { saveAccount } from './utils/savedAccounts'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl) {
  throw new Error('Missing VITE_SUPABASE_URL environment variable')
}

if (!supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_ANON_KEY environment variable')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// 25/08/2026 — account salvati e token che scadono.
//
// Supabase RUOTA il refresh token a ogni rinnovo (circa ogni ora, e a ogni
// ritorno sulla scheda): quello vecchio muore. L'elenco "Aggiungi Account"
// teneva la copia fatta al momento del login, quindi dopo il primo rinnovo
// conteneva un token gia' bruciato: al cambio account Supabase rispondeva
// "Invalid Refresh Token" e l'utente finiva fuori dal gestionale.
//
// Qui l'elenco viene riallineato ogni volta che il token cambia davvero, cosi'
// l'account salvato resta utilizzabile finche' non si fa Esci.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
    if (session) saveAccount(session)
  }
})
