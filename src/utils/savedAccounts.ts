/**
 * Account salvati sul dispositivo (24/08/2026).
 *
 * "Aggiungi Account" deve fare quello che dice: tenere piu' account e passare
 * dall'uno all'altro senza ridigitare la password ogni volta. Prima portava
 * semplicemente alla tab Operatori — cioe' a creare un operatore nuovo, che e'
 * un'altra cosa.
 *
 * ATTENZIONE. Qui si conserva il refresh token di ogni account salvato, sullo
 * stesso `localStorage` dove Supabase tiene gia' quello della sessione attiva.
 * Vale quindi la stessa regola: si salvano solo account su un computer di cui
 * ci si fida. "Rimuovi" cancella il token dal dispositivo.
 */

const KEY = 'dr7_admin_accounts'

export interface SavedAccount {
  email: string
  accessToken: string
  refreshToken: string
  savedAt: string
}

function read(): SavedAccount[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.filter((a: SavedAccount) => a?.email && a?.refreshToken) : []
  } catch {
    return []
  }
}

function write(list: SavedAccount[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch { /* storage pieno o disabilitato: si continua senza */ }
}

/** Tutti gli account salvati, il piu' recente per primo. */
export function listSavedAccounts(): SavedAccount[] {
  return read().sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''))
}

/** Salva (o aggiorna) un account. Un solo record per email. */
export function saveAccount(session: { access_token?: string; refresh_token?: string; user?: { email?: string | null } | null } | null): void {
  const email = session?.user?.email?.toLowerCase()
  if (!email || !session?.refresh_token || !session?.access_token) return
  const list = read().filter(a => a.email !== email)
  list.push({
    email,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    savedAt: new Date().toISOString(),
  })
  write(list)
}

export function removeSavedAccount(email: string): void {
  write(read().filter(a => a.email !== email.toLowerCase()))
}
