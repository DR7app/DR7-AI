// System Control — PROBLEMI: elenco raggruppato, dettaglio con diagnostica
// automatica, storico. Le uniche scritture sono di stato (risolto, riaperto,
// ignorato, nota): non si cancella mai un errore.
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'
import { registraAzione } from './utils/systemControl'
import { diagnosticaProblema } from './utils/systemControlDiagnosi'
import { AZIONI_SICURE } from './utils/systemControlCatalog'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers.origin || event.headers.Origin)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }

  const { error: authErr, user } = await requireAuth(event)
  if (authErr) return authErr
  const email = (user?.email || '').toLowerCase()
  if (!(await userHasRole(email, 'direzione')) && !(await userHasRole(email, 'developer'))) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Solo direzione o developer.' }) }
  }

  // ── Dettaglio di un problema, con diagnostica automatica ─────────────────
  if (event.httpMethod === 'GET' && event.queryStringParameters?.id) {
    const id = event.queryStringParameters.id
    const { data: gruppo, error } = await supabase.from('sc_error_groups').select('*').eq('id', id).maybeSingle()
    if (error || !gruppo) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Problema non trovato' }) }

    const [{ data: eventi }, { data: operazioni }, diagnosi] = await Promise.all([
      supabase.from('sc_error_events').select('*').eq('gruppo_id', id).order('occorso_at', { ascending: false }).limit(20),
      supabase.from('sc_operations').select('id, tipo, descrizione, stato, tentativi, ultimo_errore, created_at').eq('gruppo_id', id).limit(50),
      diagnosticaProblema(supabase, id),
    ])
    const { data: incidenti } = await supabase.from('sc_incidents').select('id, numero, stato, created_at').eq('gruppo_id', id).limit(10)

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        gruppo, eventi: eventi || [], operazioni: operazioni || [], incidenti: incidenti || [],
        diagnosi,
        azioni: AZIONI_SICURE.filter(a => (diagnosi?.azioni || []).includes(a.chiave)),
      }),
    }
  }

  // ── Elenco ───────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {}
    let query = supabase.from('sc_error_groups').select('*').order('ultima_comparsa', { ascending: false }).limit(Number(q.limit) || 100)
    if (q.stato && q.stato !== 'tutti') {
      if (q.stato === 'aperti') query = query.in('stato', ['aperto', 'in_corso'])
      else query = query.eq('stato', q.stato)
    }
    if (q.severita && q.severita !== 'tutte') query = query.eq('severita', q.severita)
    if (q.categoria && q.categoria !== 'tutte') query = query.eq('categoria', q.categoria)
    if (q.integrazione) query = query.eq('integrazione', q.integrazione)
    if (q.classe) query = query.eq('classe_risoluzione', Number(q.classe))
    if (q.cerca) query = query.or(`titolo.ilike.%${q.cerca}%,messaggio_tecnico.ilike.%${q.cerca}%`)

    const { data, error } = await query
    if (error) {
      const mancante = error.code === '42P01' || error.code === 'PGRST205'
      return { statusCode: mancante ? 200 : 500, headers, body: JSON.stringify(mancante ? { migrazioneEseguita: false, gruppi: [] } : { error: error.message }) }
    }
    return { statusCode: 200, headers, body: JSON.stringify({ migrazioneEseguita: true, gruppi: data || [] }) }
  }

  // ── Cambio di stato ──────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}') as { azione?: string; gruppoId?: string; nota?: string }
    const { azione, gruppoId } = body
    if (!azione || !gruppoId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'azione e gruppoId obbligatori' }) }

    const patch: Record<string, unknown> = {}
    let messaggio = ''
    switch (azione) {
      case 'segna_risolto':
        Object.assign(patch, { stato: 'risolto', risolto_at: new Date().toISOString(), risolto_da: email, risolto_auto: false, risolto_come: body.nota || 'Chiuso a mano dal System Control' })
        messaggio = 'Problema segnato come risolto. Resta nello storico.'
        break
      case 'riapri':
        Object.assign(patch, { stato: 'aperto', risolto_at: null, risolto_da: null })
        messaggio = 'Problema riaperto.'
        break
      case 'ignora':
        Object.assign(patch, { stato: 'ignorato', note: body.nota || null })
        messaggio = 'Problema ignorato: non compare piu fra gli aperti, ma non e cancellato.'
        break
      case 'nota':
        Object.assign(patch, { note: (body.nota || '').slice(0, 2000) })
        messaggio = 'Nota salvata.'
        break
      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Azione non prevista: ${azione}` }) }
    }

    const { error } = await supabase.from('sc_error_groups').update(patch).eq('id', gruppoId)
    await registraAzione({
      azione, attoreEmail: email, bersaglioTipo: 'problema', bersaglioId: gruppoId,
      parametri: { nota: body.nota || null }, esito: error ? 'errore' : 'ok', messaggio: error?.message || messaggio,
    })
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, messaggio }) }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) }
}

export { handler }
