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

/**
 * Indirizzo puro da un mittente scritto come "Nome <a@b.it>".
 * Restituisce stringa vuota se non c'e' niente di riconoscibile.
 */
export function estraiIndirizzoEmail(mittente: string): string {
  const dentroParentesi = /<([^<>]+)>/.exec(mittente || '')
  const grezzo = (dentroParentesi ? dentroParentesi[1] : mittente || '').trim()
  return /\S+@\S+\.\S+/.test(grezzo) ? grezzo : ''
}

/** Dominio di un indirizzo, minuscolo. '' se non c'e'. */
export function dominioEmail(indirizzoOMittente: string): string {
  const addr = estraiIndirizzoEmail(indirizzoOMittente) || (indirizzoOMittente || '')
  const dom = addr.split('@')[1] || ''
  return dom.trim().toLowerCase()
}

/**
 * Decide il mittente per un invio SMTP.
 *
 * L'SMTP autenticato (GoDaddy/secureserver) rifiuta un `From` di un dominio
 * diverso dalla casella con cui ci si e' autenticati: mettendo in Centralina
 * un indirizzo di un altro dominio, TUTTE le email SMTP smetterebbero di
 * partire. Qui l'indirizzo configurato si usa solo se e' dello stesso dominio
 * dell'account SMTP; altrimenti si tiene quello storico e si logga il perche'.
 *
 * Funzione pura per poterla testare: riceve i valori, non li va a leggere.
 */
export function scegliMittenteSmtp(configurato: string, smtpUser: string, fallback: string): string {
  const cfg = (configurato || '').trim()
  if (!cfg) return fallback
  if (!estraiIndirizzoEmail(cfg)) return fallback
  const domSmtp = dominioEmail(smtpUser || '')
  if (!domSmtp) return cfg
  const domCfg = dominioEmail(cfg)
  if (domCfg && domCfg !== domSmtp) {
    console.warn(
      `[emailFrom] mittente configurato (${domCfg}) diverso dal dominio SMTP (${domSmtp}): ` +
      `l'SMTP lo rifiuterebbe, uso "${fallback}".`
    )
    return fallback
  }
  return cfg
}

/** Come getEmailFrom, ma per gli invii che passano dall'SMTP autenticato. */
export async function getEmailFromSmtp(fallback = FALLBACK): Promise<string> {
  const configurato = await getEmailFrom(fallback)
  return scegliMittenteSmtp(configurato, process.env.SMTP_USER || '', fallback)
}

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
