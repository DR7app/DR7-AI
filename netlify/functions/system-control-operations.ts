// System Control — FAILED OPERATIONS: tutto cio' che doveva succedere e non e'
// successo, con la ripresa protetta dai doppioni.
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'
import { registraAzione } from './utils/systemControl'
import { eseguiRitentativo } from './utils/systemControlRetry'

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

  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {}
    let query = supabase.from('sc_operations').select('*').order('created_at', { ascending: false }).limit(Number(q.limit) || 200)
    if (q.stato && q.stato !== 'tutte') {
      // 'in_corso' resta visibile: se il processo e' morto, il worker la
      // passa ad 'abbandonata' dopo la scadenza, ma fino ad allora si vede.
      if (q.stato === 'aperte') query = query.in('stato', ['in_coda', 'in_corso', 'fallita', 'abbandonata'])
      else query = query.eq('stato', q.stato)
    }
    if (q.tipo && q.tipo !== 'tutti') query = query.eq('tipo', q.tipo)
    if (q.integrazione) query = query.eq('integrazione', q.integrazione)
    const { data, error } = await query
    if (error) {
      const mancante = error.code === '42P01' || error.code === 'PGRST205'
      return { statusCode: mancante ? 200 : 500, headers, body: JSON.stringify(mancante ? { migrazioneEseguita: false, operazioni: [] } : { error: error.message }) }
    }
    return { statusCode: 200, headers, body: JSON.stringify({ migrazioneEseguita: true, operazioni: data || [] }) }
  }

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}') as { azione?: string; id?: string; tipo?: string; integrazione?: string }
    const azione = body.azione

    if (azione === 'riprova') {
      if (!body.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id obbligatorio' }) }
      const esito = await eseguiRitentativo(supabase, body.id, { attoreEmail: email })
      return { statusCode: 200, headers, body: JSON.stringify(esito) }
    }

    if (azione === 'riprova_tutte') {
      // Non esegue subito decine di chiamate: le rimette in coda e le fa
      // gestire al ciclo di auto-riparazione, che rispetta i ritardi.
      // Il ciclo prende SOLO le operazioni automatiche: quelle marcate
      // manuali (fatture SDI, WhatsApp, riprese interrotte a meta') non
      // partono da sole per non rischiare doppioni, e vanno dette a parte
      // invece di promettere che partiranno.
      let rimetti = supabase.from('sc_operations')
        .update({ stato: 'in_coda', tentativi: 0, prossimo_tentativo_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .in('stato', ['fallita', 'abbandonata'])
        .eq('automatica', true)
      let contaManuali = supabase.from('sc_operations')
        .select('id')
        .in('stato', ['in_coda', 'fallita', 'abbandonata'])
        .eq('automatica', false)
      if (body.tipo) { rimetti = rimetti.eq('tipo', body.tipo); contaManuali = contaManuali.eq('tipo', body.tipo) }
      if (body.integrazione) { rimetti = rimetti.eq('integrazione', body.integrazione); contaManuali = contaManuali.eq('integrazione', body.integrazione) }
      const { data, error } = await rimetti.select('id')
      const { data: manualiData, error: manualiErr } = await contaManuali
      const rimesse = data?.length || 0
      const manuali = manualiData?.length || 0
      const errore = error?.message || manualiErr?.message
      const messaggio = errore ? errore : [
        rimesse
          ? `${rimesse} operazioni rimesse in coda: partono al prossimo ciclo automatico (entro 5 minuti).`
          : 'Nessuna operazione automatica da rimettere in coda.',
        manuali
          ? `${manuali} escluse perche a ripresa solo manuale (fatture, WhatsApp o riprese interrotte): vanno rilanciate una per una con Riprova dalla vista Operazioni ferme, dopo aver verificato che non siano gia partite.`
          : '',
      ].filter(Boolean).join(' ')
      await registraAzione({
        azione: 'riprova_tutte', attoreEmail: email, bersaglioTipo: 'operazioni',
        parametri: { tipo: body.tipo || null, integrazione: body.integrazione || null, rimesse, escluseManuali: manuali },
        esito: errore ? 'errore' : 'ok', messaggio,
      })
      if (errore) return { statusCode: 500, headers, body: JSON.stringify({ error: errore }) }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, messaggio, rimesse, escluseManuali: manuali }) }
    }

    if (azione === 'annulla_operazione') {
      if (!body.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id obbligatorio' }) }
      // Un'operazione gia' riuscita non si annulla: cambierebbe la storia.
      const { data, error } = await supabase.from('sc_operations')
        .update({ stato: 'annullata', risolta_at: new Date().toISOString(), risolta_da: email, updated_at: new Date().toISOString() })
        .eq('id', body.id).in('stato', ['in_coda', 'fallita', 'abbandonata']).select('id')
      await registraAzione({
        azione: 'annulla_operazione', attoreEmail: email, bersaglioTipo: 'operazione', bersaglioId: body.id,
        esito: error ? 'errore' : (data?.length ? 'ok' : 'rifiutata'),
        messaggio: error?.message || (data?.length ? 'Operazione annullata' : 'Operazione gia completata o in esecuzione: non annullabile'),
      })
      if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
      if (!data?.length) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, messaggio: 'Operazione gia completata o in esecuzione in questo momento: non si annulla.' }) }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, messaggio: 'Operazione annullata. Resta nello storico.' }) }
    }

    if (azione === 'riprova_piu_tardi') {
      if (!body.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id obbligatorio' }) }
      const fra15 = new Date(Date.now() + 15 * 60_000).toISOString()
      const { data, error } = await supabase.from('sc_operations')
        .update({ stato: 'in_coda', prossimo_tentativo_at: fra15, updated_at: new Date().toISOString() })
        .eq('id', body.id).in('stato', ['in_coda', 'fallita', 'abbandonata']).select('id, automatica')
      if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
      const riga = (data || [])[0] as { automatica?: boolean } | undefined
      if (!riga) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, messaggio: 'Operazione gia completata, annullata o in esecuzione: non rimandata.' }) }
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          ok: true,
          messaggio: riga.automatica === false
            ? 'Rimandata di 15 minuti. Attenzione: questa operazione non riparte da sola, va rilanciata con Riprova.'
            : 'Rimandata di 15 minuti: la riprende il ciclo automatico.',
        }),
      }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: `Azione non prevista: ${azione}` }) }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) }
}

export { handler }
