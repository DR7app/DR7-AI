/**
 * Mittente delle email del gestionale (25/08/2026).
 *
 * Prima ogni funzione aveva il suo `RESEND_FROM || 'DR7 <noreply@dr7.app>'`:
 * per cambiare l'indirizzo da cui parte la posta bisognava toccare le
 * variabili Netlify, cioe' nessuno in azienda poteva farlo. Adesso l'indirizzo
 * si imposta in Centralina Pro > Gestione PEC & Email e vive in
 * `centralina_pro_config.config.notifications.email_from`.
 *
 * L'ordine e': configurazione → variabile d'ambiente → valore storico.
 * Cache in-process di 5 minuti: la stessa istanza serve piu' invii di fila e
 * non ha senso interrogare il database ogni volta.
 */
import { createClient } from '@supabase/supabase-js'

const FALLBACK = 'DR7 <noreply@dr7.app>'
const TTL_MS = 5 * 60 * 1000

let cached = ''
let cachedAt = 0

export async function getEmailFrom(fallback = FALLBACK): Promise<string> {
  const now = Date.now()
  if (cached && now - cachedAt < TTL_MS) return cached

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (url && key) {
    try {
      const supabase = createClient(url, key)
      const { data } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const from = ((data?.config as any)?.notifications?.email_from || '').toString().trim()
      if (from) {
        cached = from
        cachedAt = now
        return from
      }
    } catch (e) {
      console.warn('[emailFrom] config non leggibile, uso env:', e instanceof Error ? e.message : e)
    }
  }

  const fromEnv = (process.env.RESEND_FROM || '').trim()
  cached = fromEnv || fallback
  cachedAt = now
  return cached
}
