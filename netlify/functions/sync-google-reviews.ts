// "Sincronizza ora" da Sito > Recensioni: stessa sincronizzazione del cron
// (le funzioni pianificate non si possono chiamare via URL in produzione).
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'
import { sincronizzaRecensioni } from './utils/recensioniGoogle'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers.origin || event.headers.Origin)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) }

  const { error: authErr, user } = await requireAuth(event)
  if (authErr) return authErr
  const email = (user?.email || '').toLowerCase()
  const puo = await userHasRole(email, 'sito-direzione')
    || await userHasRole(email, 'direzione')
    || await userHasRole(email, 'developer')
  if (!puo) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Solo chi gestisce il sito.' }) }

  const esito = await sincronizzaRecensioni(supabase)
  return { statusCode: 200, headers, body: JSON.stringify(esito) }
}

export { handler }
