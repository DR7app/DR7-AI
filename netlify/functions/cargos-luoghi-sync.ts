// CARGOS — ricarica la tabella ufficiale dei luoghi (Tabella 1,
// V_COMUNI_STATI) in cargos_luoghi / cargos_luoghi_nomi.
//
// Si lancia dal gestionale (direzione / developer) e gira da sola una volta al
// mese (cargos-luoghi-sync-cron). Aggiunge e aggiorna, non cancella mai: un
// comune soppresso resta, con la sua data di fine, perche' e' ancora il luogo
// di nascita giusto per chi e' nato prima.
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'
import { getToken, callCargosApi } from './cargos-api'
import { leggiTabellaLuoghi, nomiDiRicerca } from './utils/luoghiCargos'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function sincronizzaLuoghiCargos(): Promise<{ ok: boolean; luoghi?: number; nomi?: number; errore?: string }> {
  const t = await getToken()
  if (t.error || !t.token) return { ok: false, errore: `CARGOS non risponde: ${t.error || 'token mancante'}` }
  const r = await callCargosApi('GET', 'api/Tabella?TabellaIdentificativo=1', t.token)
  const file = r.data?.file
  if (r.error || !file) return { ok: false, errore: `Tabella luoghi non ricevuta: ${r.error || 'file vuoto'}` }

  const righe = leggiTabellaLuoghi(Buffer.from(String(file), 'base64').toString('latin1'))
  // Una tabella troppo corta e' un errore di CARGOS, non l'Italia che perde comuni.
  if (righe.length < 10000) return { ok: false, errore: `Tabella luoghi incompleta (${righe.length} righe): niente modificato.` }

  const ora = new Date().toISOString()
  for (let i = 0; i < righe.length; i += 1000) {
    const { error } = await supabase.from('cargos_luoghi')
      .upsert(righe.slice(i, i + 1000).map(x => ({ ...x, aggiornato_at: ora })), { onConflict: 'codice' })
    if (error) return { ok: false, errore: `Salvataggio luoghi non riuscito: ${error.message}` }
  }
  const nomi = righe.flatMap(x => nomiDiRicerca(x.nome).map(nome_norm => ({ nome_norm, codice: x.codice })))
  for (let i = 0; i < nomi.length; i += 2000) {
    const { error } = await supabase.from('cargos_luoghi_nomi')
      .upsert(nomi.slice(i, i + 2000), { onConflict: 'nome_norm,codice', ignoreDuplicates: true })
    if (error) return { ok: false, errore: `Salvataggio nomi non riuscito: ${error.message}` }
  }
  return { ok: true, luoghi: righe.length, nomi: nomi.length }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' }
  const { error: authErr, user } = await requireAuth(event)
  if (authErr) return authErr
  const email = (user?.email || '').toLowerCase()
  if (!(await userHasRole(email, 'direzione')) && !(await userHasRole(email, 'developer'))) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Solo direzione o developer.' }) }
  }
  const esito = await sincronizzaLuoghiCargos()
  return { statusCode: esito.ok ? 200 : 502, body: JSON.stringify(esito) }
}
