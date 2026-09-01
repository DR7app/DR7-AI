// System Control — ASSISTENTE DIAGNOSTICO.
//
// Riceve SOLO un riassunto gia' sanificato (nessuna credenziale, nessun dato
// personale del cliente) e risponde in italiano semplice: cosa sta succedendo,
// perche', cosa conviene fare.
//
// LIMITE INVALICABILE: l'assistente non ha accesso al database, non esegue
// azioni, non cancella niente. Restituisce testo e, al massimo, il nome di
// un'azione gia' prevista dal catalogo, che resti sempre da confermare a mano.
import type { Handler } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'
import { sanifica, registraAzione, mascheraTesto } from './utils/systemControl'
import { diagnosticaProblema } from './utils/systemControlDiagnosi'
import { AZIONI_SICURE } from './utils/systemControlCatalog'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const ISTRUZIONI = `Sei l'assistente diagnostico del DR7 A.I System Control, il centro tecnico di un gestionale aziendale.

Parli a un amministratore che NON e' un programmatore. Rispondi sempre in italiano, in modo concreto e breve.

Struttura la risposta cosi':
1. COSA STA SUCCEDENDO — due o tre frasi, senza gergo tecnico.
2. PERCHE' — la causa piu' probabile, e se non sei sicuro dillo chiaramente.
3. COSA FARE — massimo tre punti pratici. Se non serve fare niente perche' il sistema ritenta da solo, dillo.
4. SERVE UNO SVILUPPATORE? — si' o no, con una riga di motivazione.

Regole:
- Non inventare cause: se i dati non bastano, di' quali informazioni mancano.
- Non suggerire mai di cancellare dati, log o righe per "risolvere" un errore.
- Non suggerire modifiche al codice di produzione: se serve, di' solo che serve una modifica software.
- Le azioni che puoi consigliare sono solo quelle dell'elenco fornito.
- Non chiedere mai credenziali e non citarne il contenuto.`

const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers.origin || event.headers.Origin)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) }

  const { error: authErr, user } = await requireAuth(event)
  if (authErr) return authErr
  const email = (user?.email || '').toLowerCase()
  if (!(await userHasRole(email, 'direzione')) && !(await userHasRole(email, 'developer'))) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Solo direzione o developer.' }) }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        ok: false,
        messaggio: 'Assistente non configurato: manca ANTHROPIC_API_KEY. La diagnostica automatica del System Control funziona lo stesso, senza AI.',
      }),
    }
  }

  const body = JSON.parse(event.body || '{}') as { gruppoId?: string; domanda?: string }
  if (!body.gruppoId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'gruppoId obbligatorio' }) }

  const { data: gruppo } = await supabase.from('sc_error_groups').select('*').eq('id', body.gruppoId).maybeSingle()
  if (!gruppo) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Problema non trovato' }) }
  const g = gruppo as Record<string, unknown>

  const { data: eventi } = await supabase.from('sc_error_events')
    .select('occorso_at, messaggio_tecnico, origine, modulo, contesto')
    .eq('gruppo_id', body.gruppoId).order('occorso_at', { ascending: false }).limit(3)
  const diagnosi = await diagnosticaProblema(supabase, body.gruppoId)

  // Il riassunto passa dalla sanificazione come qualsiasi altra scrittura:
  // niente token, niente chiavi, niente dati di pagamento.
  const riassunto = sanifica({
    titolo: g.titolo,
    severita: g.severita,
    categoria: g.categoria,
    modulo: g.modulo,
    integrazione: g.integrazione,
    classe_risoluzione: g.classe_risoluzione,
    occorrenze: g.occorrenze,
    prima_comparsa: g.prima_comparsa,
    ultima_comparsa: g.ultima_comparsa,
    messaggio_tecnico: g.messaggio_tecnico,
    causa_ipotizzata: g.causa_probabile,
    controlli: diagnosi?.controlli || [],
    ultime_occorrenze: (eventi || []).map(e => ({
      quando: (e as { occorso_at: string }).occorso_at,
      origine: (e as { origine: string }).origine,
      messaggio: (e as { messaggio_tecnico: string | null }).messaggio_tecnico,
    })),
  })

  const azioni = AZIONI_SICURE.map(a => `${a.chiave}: ${a.etichetta} — ${a.descrizione}`).join('\n')

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const risposta = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1500,
      system: [{ type: 'text', text: ISTRUZIONI, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: [
            'Dati del problema (gia sanificati):',
            '```json',
            JSON.stringify(riassunto, null, 2),
            '```',
            '',
            'Azioni disponibili nel pannello:',
            azioni,
            '',
            body.domanda ? `Domanda dell amministratore: ${body.domanda}` : 'Spiega il problema e cosa conviene fare.',
          ].join('\n'),
        }],
      }],
    })

    const testo = risposta.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text).join('\n').trim()

    await registraAzione({
      azione: 'assistente_diagnostico', attoreEmail: email,
      bersaglioTipo: 'problema', bersaglioId: body.gruppoId,
      parametri: { domanda: body.domanda || null }, esito: 'ok',
      messaggio: 'Analisi AI richiesta (sola lettura, nessuna modifica eseguita)',
    })

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, analisi: testo }) }
  } catch (err) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ok: false, messaggio: `Assistente non raggiungibile: ${mascheraTesto((err as Error)?.message || 'errore')}` }),
    }
  }
}

export { handler }
