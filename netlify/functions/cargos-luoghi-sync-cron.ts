// CARGOS — tabella luoghi sempre aggiornata. Il cron gira spesso ma ricarica
// solo se la tabella e' vuota o piu' vecchia di 25 giorni: al primo deploy si
// riempie da sola, poi si rinfresca una volta al mese.
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { conSystemControl } from './utils/systemControl'
import { sincronizzaLuoghiCargos } from './cargos-luoghi-sync'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const RICARICA_OGNI_GIORNI = 25

const handler: Handler = async () => {
  const { data, error } = await supabase.from('cargos_luoghi')
    .select('aggiornato_at').order('aggiornato_at', { ascending: false }).limit(1)
  if (error) return { statusCode: 500, body: JSON.stringify({ errore: `Lettura tabella luoghi: ${error.message}` }) }
  const ultima = (data?.[0] as { aggiornato_at?: string } | undefined)?.aggiornato_at
  if (ultima && Date.now() - new Date(ultima).getTime() < RICARICA_OGNI_GIORNI * 86_400_000) {
    return { statusCode: 200, body: JSON.stringify({ saltato: true, ultimaRicarica: ultima }) }
  }
  const esito = await sincronizzaLuoghiCargos()
  return { statusCode: esito.ok ? 200 : 500, body: JSON.stringify(esito) }
}

const handlerSorvegliato = conSystemControl('cargos-luoghi-sync-cron', handler, { cron: true })
export { handlerSorvegliato as handler }
