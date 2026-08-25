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
 * Body: { mittente: string, password: string }  (password vuota = cancella)
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { getCorsOrigin } from './cors-headers'
import { requireAuth } from './require-auth'

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
    const { mittente, password } = JSON.parse(event.body || '{}') as { mittente?: string; password?: string }
    const addr = String(mittente || '').trim().toLowerCase()
    if (!/\S+@\S+\.\S+/.test(addr)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Indirizzo PEC non valido' }) }
    }
    const key = `pec_password:${addr}`
    const value = String(password ?? '')

    if (!value.trim()) {
      await supabase.from('service_secrets').delete().eq('key', key)
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, rimossa: true }) }
    }

    // upsert: una sola riga per casella.
    const { error } = await supabase
      .from('service_secrets')
      .upsert({ key, value }, { onConflict: 'key' })
    if (error) throw error

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, key }) }
  } catch (e) {
    console.error('[save-pec-password]', e)
    return { statusCode: 500, headers, body: JSON.stringify({ error: e instanceof Error ? e.message : 'Errore salvataggio' }) }
  }
}

export { handler }
