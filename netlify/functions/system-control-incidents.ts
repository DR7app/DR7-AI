// System Control — CATEGORIA 3: quando il problema richiede una modifica al
// software, il gestionale non tenta niente di pericoloso. Prepara il rapporto
// tecnico completo, pronto da consegnare allo sviluppatore.
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'
import { registraAzione, AMBIENTE, VERSIONE, mascheraTesto } from './utils/systemControl'
import { diagnosticaProblema } from './utils/systemControlDiagnosi'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function prossimoNumero(): Promise<string> {
  const anno = new Date().getFullYear()
  const { count } = await supabase.from('sc_incidents')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', `${anno}-01-01`)
  return `INC-${anno}-${String((count || 0) + 1).padStart(4, '0')}`
}

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
    if (event.queryStringParameters?.id) {
      const { data } = await supabase.from('sc_incidents').select('*').eq('id', event.queryStringParameters.id).maybeSingle()
      if (!data) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Rapporto non trovato' }) }
      return { statusCode: 200, headers, body: JSON.stringify({ incidente: data }) }
    }
    const { data, error } = await supabase.from('sc_incidents').select('*').order('created_at', { ascending: false }).limit(100)
    if (error && (error.code === '42P01' || error.code === 'PGRST205')) {
      return { statusCode: 200, headers, body: JSON.stringify({ migrazioneEseguita: false, incidenti: [] }) }
    }
    return { statusCode: 200, headers, body: JSON.stringify({ migrazioneEseguita: true, incidenti: data || [] }) }
  }

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}') as { azione?: string; gruppoId?: string; id?: string; passi?: string; note?: string }

    if (body.azione === 'chiudi' && body.id) {
      const { error } = await supabase.from('sc_incidents')
        .update({ stato: 'chiuso', chiuso_at: new Date().toISOString(), chiuso_da: email, note: body.note || null })
        .eq('id', body.id)
      await registraAzione({ azione: 'chiudi_incidente', attoreEmail: email, bersaglioTipo: 'incidente', bersaglioId: body.id, esito: error ? 'errore' : 'ok' })
      if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, messaggio: 'Rapporto chiuso.' }) }
    }

    // ── Crea il rapporto da un problema ────────────────────────────────────
    if (!body.gruppoId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'gruppoId obbligatorio' }) }

    const { data: gruppoData } = await supabase.from('sc_error_groups').select('*').eq('id', body.gruppoId).maybeSingle()
    if (!gruppoData) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Problema non trovato' }) }
    const g = gruppoData as Record<string, unknown> & {
      titolo: string; messaggio_tecnico: string | null; causa_probabile: string | null
      severita: string; categoria: string; modulo: string | null; funzione: string | null
      integrazione: string | null; business: string | null; occorrenze: number
      prima_comparsa: string; ultima_comparsa: string; utenti_coinvolti: string[]; aziende_coinvolte: string[]
    }

    const { data: eventiData } = await supabase.from('sc_error_events')
      .select('*').eq('gruppo_id', body.gruppoId).order('occorso_at', { ascending: false }).limit(10)
    const eventi = (eventiData || []) as { occorso_at: string; messaggio_tecnico: string | null; stack: string | null; contesto: Record<string, unknown>; request_id: string | null; correlation_id: string | null; utente_email: string | null; ambiente: string | null; versione: string | null; origine: string }[]
    const ultimo = eventi[0]

    const { data: release } = await supabase.from('sc_releases').select('*').order('rilasciato_at', { ascending: false }).limit(1)
    const rel = release?.[0] as { versione?: string; commit_sha?: string; rilasciato_at?: string } | undefined
    const diagnosi = await diagnosticaProblema(supabase, body.gruppoId)

    const dataIt = (s?: string | null) => s ? new Date(s).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) : 'n/d'

    const corpo = [
      `# ${g.titolo}`,
      '',
      `**Gravita:** ${g.severita.toUpperCase()}`,
      `**Data e ora prima comparsa:** ${dataIt(g.prima_comparsa)}`,
      `**Ultima comparsa:** ${dataIt(g.ultima_comparsa)}`,
      `**Ambiente:** ${ultimo?.ambiente || AMBIENTE}`,
      `**Versione software:** ${ultimo?.versione || VERSIONE}`,
      `**Modulo interessato:** ${g.modulo || 'non determinato'}${g.funzione ? ` (${g.funzione})` : ''}`,
      `**Integrazione:** ${g.integrazione || 'nessuna'}`,
      `**Azienda / business:** ${g.business || (g.aziende_coinvolte || []).join(', ') || 'non determinata'}`,
      `**Frequenza:** ${g.occorrenze} occorrenze`,
      `**Utenti interessati:** ${(g.utenti_coinvolti || []).length}${(g.utenti_coinvolti || []).length ? ` (${g.utenti_coinvolti.slice(0, 10).join(', ')})` : ''}`,
      `**Request ID:** ${ultimo?.request_id || 'n/d'}`,
      `**Correlation ID:** ${ultimo?.correlation_id || 'n/d'}`,
      `**Ultimo rilascio potenzialmente correlato:** ${rel ? `${rel.versione}${rel.commit_sha ? ` (${rel.commit_sha})` : ''} del ${dataIt(rel.rilasciato_at)}` : 'nessun rilascio registrato'}`,
      '',
      '## Cosa succede, in parole semplici',
      g.causa_probabile || 'Causa non determinata automaticamente.',
      '',
      '## Passaggi che producono l errore',
      body.passi || (ultimo?.contesto && Object.keys(ultimo.contesto).length
        ? `Non forniti dall amministratore. Contesto dell ultima occorrenza:\n\n\`\`\`json\n${JSON.stringify(ultimo.contesto, null, 2)}\n\`\`\``
        : 'Non forniti.'),
      '',
      '## Messaggio di errore tecnico',
      '```',
      mascheraTesto(g.messaggio_tecnico || 'n/d'),
      '```',
      ...(ultimo?.stack ? ['', '## Stack trace (sanificato)', '```', ultimo.stack, '```'] : []),
      '',
      '## Controlli automatici gia eseguiti',
      ...(diagnosi?.controlli || []).map(c => `- **${c.nome}:** [${c.esito}] ${c.dettaglio}`),
      '',
      `**Conclusione del System Control:** ${diagnosi?.conclusione || 'n/d'}`,
      '',
      '## Ultime occorrenze',
      ...eventi.slice(0, 5).map(e => `- ${dataIt(e.occorso_at)} — ${e.origine}${e.utente_email ? ` — ${e.utente_email}` : ''} — ${mascheraTesto(e.messaggio_tecnico || '').slice(0, 200)}`),
      '',
      '---',
      '_Rapporto generato dal DR7 A.I System Control. Nessuna credenziale e inclusa: i valori sensibili sono sostituiti da [nascosto]._',
    ].join('\n')

    let numero = await prossimoNumero()
    let inserito = await supabase.from('sc_incidents').insert({
      numero, titolo: g.titolo, gravita: g.severita, gruppo_id: body.gruppoId,
      ambiente: ultimo?.ambiente || AMBIENTE, versione: ultimo?.versione || VERSIONE,
      modulo: g.modulo, integrazione: g.integrazione, business: g.business,
      passi: body.passi || null,
      messaggio_errore: mascheraTesto(g.messaggio_tecnico || ''),
      stack: ultimo?.stack || null,
      request_id: ultimo?.request_id || null, correlation_id: ultimo?.correlation_id || null,
      log_pertinenti: eventi.slice(0, 5).map(e => ({ quando: e.occorso_at, origine: e.origine, messaggio: e.messaggio_tecnico })),
      frequenza: g.occorrenze, utenti_interessati: (g.utenti_coinvolti || []).length,
      ultimo_deploy: rel?.versione || null, ultimo_deploy_at: rel?.rilasciato_at || null,
      corpo_markdown: corpo, creato_da: email,
    }).select('*').single()

    // Due rapporti creati nello stesso istante: si riprova con il numero dopo.
    if (inserito.error && /duplicate|unique/i.test(inserito.error.message)) {
      numero = `${numero}-${Date.now().toString().slice(-4)}`
      inserito = await supabase.from('sc_incidents').insert({
        numero, titolo: g.titolo, gravita: g.severita, gruppo_id: body.gruppoId,
        ambiente: AMBIENTE, versione: VERSIONE, corpo_markdown: corpo, creato_da: email,
        frequenza: g.occorrenze,
      }).select('*').single()
    }

    await registraAzione({
      azione: 'apri_incidente', attoreEmail: email, bersaglioTipo: 'problema', bersaglioId: body.gruppoId,
      esito: inserito.error ? 'errore' : 'ok', messaggio: inserito.error?.message || `Rapporto ${numero} creato`,
    })
    if (inserito.error) return { statusCode: 500, headers, body: JSON.stringify({ error: inserito.error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, incidente: inserito.data, messaggio: `Rapporto tecnico ${numero} creato.` }) }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) }
}

export { handler }
