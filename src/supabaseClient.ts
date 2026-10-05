import { createClient } from '@supabase/supabase-js'
import { saveAccount } from './utils/savedAccounts'
import { proteggiOperatore } from './utils/oscura'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl) {
  throw new Error('Missing VITE_SUPABASE_URL environment variable')
}

if (!supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_ANON_KEY environment variable')
}

// La fetch va risolta a ogni chiamata, non al momento della creazione.
//
// supabase-js si tiene `fetch` cosi' com'e' quando il client nasce, e il client
// nasce durante gli import — cioe' PRIMA che main.tsx installi i suoi strati.
// Senza questo passaggio la modalita' Oscurare (src/utils/oscura.ts) non vedeva
// nemmeno una delle query a Supabase: si accendeva e non cambiava niente.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: (...argomenti: Parameters<typeof fetch>) => window.fetch(...argomenti),
  },
})

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
  // Modalita' Oscurare: l'email di chi e' collegato non va mascherata,
  // altrimenti i controlli di ruolo non lo riconoscono piu'.
  proteggiOperatore(session?.user?.email)
})

supabase.auth.getSession().then(({ data }) => proteggiOperatore(data.session?.user?.email))

// 05/10/2026 — getUser() in coda bloccava tutte le query.
//
// `supabase.auth.getUser()` prende il LUCCHETTO di auth-js e lo tiene per un
// intero giro di rete verso /auth/v1/user. Ogni query al database chiede lo
// stesso lucchetto per leggere il token, quindi resta ferma finche' getUser non
// torna. Il codice lo chiama in 28 punti: all'apertura di Prenotazioni sei
// chiamate una dopo l'altra = mezzo secondo prima che parta una sola lettura.
//
// Ora le chiamate contemporanee condividono la stessa risposta, e una risposta
// riuscita vale 60 secondi. La copia si butta a ogni cambio di sessione (login,
// cambio account, rinnovo token, utente aggiornato, uscita), quindi non si
// risponde mai con l'utente di prima. Con un jwt esplicito si va diretti.
{
  const getUserOriginale = supabase.auth.getUser.bind(supabase.auth)
  let inCorso: ReturnType<typeof getUserOriginale> | null = null
  let copia: { quando: number; esito: Awaited<ReturnType<typeof getUserOriginale>> } | null = null
  let generazione = 0
  const VALIDITA_MS = 60_000

  supabase.auth.onAuthStateChange((event) => {
    if (event === 'INITIAL_SESSION') return
    generazione++
    inCorso = null
    copia = null
  })

  supabase.auth.getUser = ((jwt?: string) => {
    if (jwt) return getUserOriginale(jwt)
    if (copia && Date.now() - copia.quando < VALIDITA_MS) return Promise.resolve(copia.esito)
    if (inCorso) return inCorso
    const gen = generazione
    const p = getUserOriginale().then(esito => {
      if (gen === generazione) {
        if (!esito.error && esito.data?.user) copia = { quando: Date.now(), esito }
        inCorso = null
      }
      return esito
    }, err => {
      if (gen === generazione) inCorso = null
      throw err
    })
    inCorso = p
    return p
  }) as typeof supabase.auth.getUser
}
