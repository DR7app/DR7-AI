/**
 * Authenticated fetch wrapper that automatically attaches the Supabase JWT
 * to all requests to Netlify functions.
 *
 * Usage:
 *   import { authFetch } from '../utils/authFetch'
 *   const res = await authFetch('/.netlify/functions/delete-booking', { method: 'POST', body: ... })
 */
import { supabase } from '../supabaseClient'

/**
 * Anagrafica clienti: una lettura per volta, non una per tab (02/09/2026).
 *
 * `list-customers` e' la risposta piu' pesante del gestionale (1,2 MB con le
 * colonne ridotte, 5 MB intera) e la chiedono in tanti: Prenotazioni,
 * Preventivi, Lavaggi, Nexi, Credit Wallet, Campagna Marketing, LeadPicker.
 * Girando fra le tab la stessa lista veniva riscaricata ogni volta.
 *
 * Qui la risposta viene tenuta un minuto per variante di `fields`, e le
 * chiamate che partono insieme condividono la stessa lettura. Ogni chiamante
 * riceve una Response nuova, quindi nessuno va toccato. Chi crea o modifica
 * un cliente chiama `svuotaCacheClienti()`.
 */
const CACHE_MS = 60_000
type VoceCache = { quando: number; attesa: Promise<{ stato: number; testo: string }> }
const cacheClienti = new Map<string, VoceCache>()

export function svuotaCacheClienti() {
  cacheClienti.clear()
}

function chiaveCache(url: string): string | null {
  if (!url.includes('/.netlify/functions/list-customers')) return null
  const q = url.split('?')[1] || ''
  return `list-customers?${q}`
}

export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  const headers = new Headers(init?.headers)
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  // Qualsiasi scrittura che tocchi un cliente butta la cache: un cliente
  // appena creato deve comparire subito nella ricerca, non fra un minuto.
  if ((init?.method || 'GET').toUpperCase() !== 'GET' && /client|customer/i.test(url)) {
    svuotaCacheClienti()
  }

  // Solo le letture semplici passano dalla cache: una POST non e' una lettura.
  const metodo = (init?.method || 'GET').toUpperCase()
  const chiave = metodo === 'GET' ? chiaveCache(url) : null
  if (chiave) {
    const inCache = cacheClienti.get(chiave)
    const attesa = inCache && Date.now() - inCache.quando < CACHE_MS
      ? inCache.attesa
      : (() => {
        const p = fetch(url, { ...init, headers }).then(async r => ({ stato: r.status, testo: await r.text() }))
        cacheClienti.set(chiave, { quando: Date.now(), attesa: p })
        // Un errore non resta in cache per un minuto.
        p.catch(() => cacheClienti.delete(chiave))
        return p
      })()
    try {
      const { stato, testo } = await attesa
      // Una risposta di errore non va tenuta: il prossimo tentativo deve
      // ripartire davvero.
      if (stato >= 400) cacheClienti.delete(chiave)
      return new Response(testo, { status: stato, headers: { 'Content-Type': 'application/json' } })
    } catch (err) {
      cacheClienti.delete(chiave)
      throw err
    }
  }

  return fetch(url, { ...init, headers })
}
