// Recensioni Google: ogni tre ore copia le recensioni vere in
// google_reviews_cache, da cui le legge il sito (26/09/2026). Tutta la logica
// e' in utils/recensioniGoogle.ts, condivisa con sync-google-reviews (il
// pulsante "Sincronizza ora" del gestionale).
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { conSystemControl } from './utils/systemControl'
import { sincronizzaRecensioni } from './utils/recensioniGoogle'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const handler: Handler = async () => {
  const esito = await sincronizzaRecensioni(supabase)
  if (!esito.ok) console.error('[sync-google-reviews-cron]', esito.errore)
  else console.log(`[sync-google-reviews-cron] fonte ${esito.source}, ${esito.nuove} nuove`)
  // 500 se nessuna fonte ha risposto: il System Control apre il problema.
  return { statusCode: esito.ok ? 200 : 500, body: JSON.stringify(esito) }
}

// Battito per il controllo orario del System Control: ogni giro lascia
// traccia, cosi' il pannello si accorge se questo automatismo si ferma.
const handlerSorvegliato = conSystemControl('sync-google-reviews-cron', handler, { cron: true })
export { handlerSorvegliato as handler }
