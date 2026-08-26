/**
 * Password della casella PEC mittente (25/08/2026).
 *
 * La PEC mittente si sceglie in Centralina Pro, ma ogni casella ha la sua
 * password: cambiare indirizzo senza credenziali significa continuare ad
 * autenticarsi sulla casella vecchia — ed e' esattamente il motivo per cui
 * "ho messo la nuova PEC e non funziona".
 *
 * La password NON puo' stare in `centralina_pro_config`: quella riga la legge
 * qualunque utente autenticato. Va in `service_secrets`, leggibile solo con la
 * service-role key (stessa regola del token targa). Da qui si scrive soltanto:
 * il valore non torna mai indietro al browser.
 *
 * Body:
 *   { mittente, password }              -> salva (password vuota = cancella)
 *   { action: 'status', mittente }      -> dice SE la password c'e' (mai quale)
 *   { action: 'test', mittente, password? } -> login vero sul server PEC
 *
 * 26/08/2026 — Il campo password si svuota dopo il salvataggio (il valore non
 * torna mai al browser) e questo faceva sembrare che non avesse salvato nulla.
 * `status` serve proprio a quello: dire "password registrata" senza mostrarla.
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { getCorsOrigin } from './cors-headers'
import { requireAuth } from './require-auth'
import nodemailer from 'nodemailer'
import { pecHostFor, pecProviderFor, PEC_PORT } from './utils/pecServer'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers?.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const auth = await requireAuth(event as unknown as { headers: Record<string, string> })
  if (auth.error) return auth.error

  try {
    const { mittente, password, action, host: hostOverride, port: portOverride } = JSON.parse(event.body || '{}') as { mittente?: string; password?: string; action?: string; host?: string; port?: number }
    const addr = String(mittente || '').trim().toLowerCase()
    if (!/\S+@\S+\.\S+/.test(addr)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Indirizzo PEC non valido' }) }
    }
    const key = `pec_password:${addr}`
    const value = String(password ?? '')

    // ── Stato: la password c'e' o no? Il valore non esce mai da qui. ────────
    if (action === 'status') {
      const { data: row } = await supabase.from('service_secrets').select('*').eq('key', key).maybeSingle()
      const r = row as Record<string, unknown> | null
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          registrata: !!r,
          aggiornata_il: (r?.updated_at as string) || (r?.created_at as string) || null,
          server: (hostOverride || '').trim() || pecHostFor(addr),
          server_dedotto: pecHostFor(addr),
          porta: Number(portOverride) > 0 ? Number(portOverride) : PEC_PORT,
          provider: pecProviderFor(addr),
        }),
      }
    }

    // ── Prova di connessione: login vero, stesso server dell'invio multe. ───
    if (action === 'test') {
      let pass = value.trim()
      if (!pass) {
        const { data: row } = await supabase.from('service_secrets').select('value').eq('key', key).maybeSingle()
        pass = String((row as { value?: string } | null)?.value || '').trim()
      }
      if (!pass) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: `Nessuna password registrata per ${addr}.` }) }
      }
      // Stesso server dell'invio vero: quello configurato, altrimenti dedotto.
      const host = (hostOverride || '').trim() || pecHostFor(addr)
      const port = Number(portOverride) > 0 ? Number(portOverride) : PEC_PORT
      try {
        const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: addr, pass } })
        await transporter.verify()
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, server: host, porta: port, provider: pecProviderFor(addr) }) }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: false,
            server: host,
            porta: port,
            provider: pecProviderFor(addr),
            error: /auth|login|535|password/i.test(msg)
              ? `Casella o password rifiutate da ${host}:${port}. ${msg}`
              : `Il server ${host}:${port} non risponde come previsto. ${msg}`,
          }),
        }
      }
    }

    if (!value.trim()) {
      await supabase.from('service_secrets').delete().eq('key', key)
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, rimossa: true }) }
    }

    // Aggiorna-o-inserisci fatto a mano: `service_secrets` e' stata creata
    // direttamente su Supabase e non e' detto che `key` abbia un indice unico,
    // quindi un upsert con onConflict potrebbe essere rifiutato dal database.
    const { data: esistente } = await supabase
      .from('service_secrets')
      .select('key')
      .eq('key', key)
      .maybeSingle()

    if (esistente) {
      const { error } = await supabase.from('service_secrets').update({ value }).eq('key', key)
      if (error) throw error
    } else {
      const { error } = await supabase.from('service_secrets').insert({ key, value })
      if (error) throw error
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, key }) }
  } catch (e) {
    console.error('[save-pec-password]', e)
    return { statusCode: 500, headers, body: JSON.stringify({ error: e instanceof Error ? e.message : 'Errore salvataggio' }) }
  }
}

export { handler }
