/**
 * Accredito manuale del bonus di benvenuto da 10€ (26/08/2026).
 *
 * Fino al 26/08 il bonus veniva accreditato DOPO il salvataggio della scheda
 * cliente: se la scrittura della scheda falliva (bastava un campo rifiutato
 * dal database) la registrazione usciva in errore prima di arrivare al bonus.
 * Risultato: account creato, 10€ mai accreditati — 75 persone al 26/08.
 * Da qui l'elenco "Iscritti al Sito" li recupera senza aprire il database.
 *
 * Scrive denaro, quindi non basta essere autenticati: chi chiama dev'essere
 * un operatore presente in `admins` (la sola requireAuth accetterebbe anche il
 * token di un cliente del sito).
 *
 * L'accredito vero lo fa la RPC `grant_welcome_bonus(p_user_id)`, la stessa
 * usata dalla registrazione: e' idempotente (marca la riga con
 * reference_type = 'welcome_bonus'), quindi ripremere il pulsante non
 * accredita mai due volte.
 *
 * Body: { userIds: string[] }  -> massimo 500 per chiamata
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const MAX_PER_CHIAMATA = 500

const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const auth = await requireAuth(event as unknown as { headers: Record<string, string> })
  if (auth.error) return auth.error

  // Il token di servizio interno (ADMIN_API_TOKEN) passa con id 'admin'.
  if (auth.user?.id !== 'admin') {
    const { data: operatore } = await supabase
      .from('admins')
      .select('id')
      .eq('user_id', auth.user?.id)
      .maybeSingle()
    if (!operatore) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Riservato agli operatori del gestionale.' }) }
    }
  }

  try {
    const { userIds } = JSON.parse(event.body || '{}') as { userIds?: string[] }
    const ids = Array.from(new Set((userIds || []).map(v => String(v || '').trim()).filter(Boolean)))
    if (ids.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nessun iscritto indicato.' }) }
    }
    if (ids.length > MAX_PER_CHIAMATA) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Troppi iscritti in una sola volta (massimo ${MAX_PER_CHIAMATA}).` }) }
    }

    let accreditati = 0
    let gia = 0
    const errori: Array<{ user_id: string; errore: string }> = []

    // Uno alla volta: la RPC blocca la riga del saldo, e un errore su una
    // persona non deve impedire l'accredito alle altre.
    for (const id of ids) {
      const { data, error } = await supabase.rpc('grant_welcome_bonus', { p_user_id: id })
      const esito = Array.isArray(data) ? data[0] : data
      if (error || !esito?.success) {
        errori.push({ user_id: id, errore: error?.message || esito?.error_message || 'Accredito rifiutato' })
        continue
      }
      if (esito.already_granted) gia++
      else accreditati++
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, accreditati, gia_accreditati: gia, errori, euro: accreditati * 10 }),
    }
  } catch (e) {
    console.error('[grant-welcome-bonus]', e)
    return { statusCode: 500, headers, body: JSON.stringify({ error: e instanceof Error ? e.message : 'Errore accredito' }) }
  }
}

export { handler }
