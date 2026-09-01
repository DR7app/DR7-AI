// System Control — INTEGRATION HEALTH: stato di ogni collegamento e azioni
// sicure (test, riconnessione, risincronizzazione, disattivazione).
//
// Le credenziali NON passano mai da qui: si verifica solo la loro PRESENZA e
// si contatta il servizio lato server. Nessun valore viene restituito al
// browser ne scritto nei log.
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'
import { registraAzione, prossimoTentativo, mascheraTesto } from './utils/systemControl'
import { diagnosticaIntegrazione } from './utils/systemControlDiagnosi'
import { INTEGRAZIONI, INTEGRAZIONE_BY_CHIAVE } from './utils/systemControlCatalog'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

interface EsitoTest { ok: boolean; messaggio: string; latenzaMs: number }

/** Prova davvero il collegamento. Non restituisce mai valori di credenziali. */
async function testaConnessione(chiave: string): Promise<EsitoTest> {
  const meta = INTEGRAZIONE_BY_CHIAVE[chiave]
  const t0 = Date.now()
  const durata = () => Date.now() - t0

  if (!meta) return { ok: false, messaggio: 'Integrazione sconosciuta.', latenzaMs: 0 }

  try {
    switch (meta.test) {
      case 'supabase': {
        const { error } = await supabase.from('admins').select('id', { head: true, count: 'exact' }).limit(1)
        return { ok: !error, messaggio: error ? mascheraTesto(error.message) : 'Il database risponde alle letture.', latenzaMs: durata() }
      }
      case 'auth': {
        const { error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 })
        return { ok: !error, messaggio: error ? mascheraTesto(error.message) : 'Il servizio di accesso risponde.', latenzaMs: durata() }
      }
      case 'storage': {
        const { data, error } = await supabase.storage.listBuckets()
        return { ok: !error, messaggio: error ? mascheraTesto(error.message) : `Archivio raggiungibile (${data?.length || 0} contenitori).`, latenzaMs: durata() }
      }
      case 'http': {
        // WhatsApp: la prova ufficiale di Green API e' getStateInstance.
        // L'URL contiene il token, quindi non viene MAI restituito ne loggato.
        if (chiave === 'green_api') {
          const id = process.env.GREEN_API_ID_INSTANCE
          const token = process.env.GREEN_API_TOKEN
          if (!id || !token) return { ok: false, messaggio: 'Credenziali WhatsApp non configurate.', latenzaMs: durata() }
          const res = await fetch(`https://api.green-api.com/waInstance${id}/getStateInstance/${token}`)
          const stato = res.ok ? ((await res.json()) as { stateInstance?: string })?.stateInstance : null
          return {
            ok: res.ok && stato === 'authorized',
            messaggio: res.ok ? `Stato dell istanza: ${stato || 'sconosciuto'}.` : `Il servizio ha risposto ${res.status}.`,
            latenzaMs: durata(),
          }
        }
        if (!meta.testUrl) return { ok: false, messaggio: 'Nessuna prova disponibile.', latenzaMs: durata() }
        const res = await fetch(meta.testUrl)
        return { ok: res.ok, messaggio: res.ok ? 'Il servizio risponde.' : `Il servizio ha risposto ${res.status}.`, latenzaMs: durata() }
      }
      case 'env': {
        const mancanti = meta.variabili.filter(v => !process.env[v])
        return {
          ok: mancanti.length === 0,
          messaggio: mancanti.length
            ? `Impostazioni mancanti: ${mancanti.join(', ')}.`
            : 'Credenziali presenti. Il servizio non espone una prova sicura: il primo utilizzo reale confermera il collegamento.',
          latenzaMs: durata(),
        }
      }
      default:
        return { ok: true, messaggio: 'Nessuna prova prevista per questo collegamento.', latenzaMs: durata() }
    }
  } catch (err) {
    return { ok: false, messaggio: mascheraTesto((err as Error)?.message || String(err)), latenzaMs: durata() }
  }
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

  // ── Dettaglio con diagnostica ────────────────────────────────────────────
  if (event.httpMethod === 'GET' && event.queryStringParameters?.chiave) {
    const chiave = event.queryStringParameters.chiave
    const meta = INTEGRAZIONE_BY_CHIAVE[chiave]
    if (!meta) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Integrazione sconosciuta' }) }
    const [{ data: riga }, diagnosi, { data: errori }, { data: operazioni }] = await Promise.all([
      supabase.from('sc_integrations').select('*').eq('chiave', chiave).maybeSingle(),
      diagnosticaIntegrazione(supabase, chiave),
      supabase.from('sc_error_groups').select('id, titolo, severita, occorrenze, ultima_comparsa, stato')
        .eq('integrazione', chiave).order('ultima_comparsa', { ascending: false }).limit(10),
      supabase.from('sc_operations').select('id, tipo, descrizione, stato, tentativi, ultimo_errore, prossimo_tentativo_at')
        .eq('integrazione', chiave).in('stato', ['in_coda', 'fallita', 'abbandonata']).limit(50),
    ])
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        integrazione: { ...meta, ...(riga || {}) },
        // Solo i NOMI delle impostazioni e se sono presenti: mai i valori.
        credenziali: meta.variabili.map(v => ({ nome: v, presente: !!process.env[v] })),
        diagnosi, errori: errori || [], operazioni: operazioni || [],
      }),
    }
  }

  // ── Elenco ───────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { data, error } = await supabase.from('sc_integrations').select('*')
    if (error && (error.code === '42P01' || error.code === 'PGRST205')) {
      return { statusCode: 200, headers, body: JSON.stringify({ migrazioneEseguita: false, integrazioni: [] }) }
    }
    const righe = (data || []) as Record<string, unknown>[]
    const perChiave = Object.fromEntries(righe.map(r => [String(r.chiave), r]))
    const { data: opsData } = await supabase.from('sc_operations')
      .select('integrazione, stato').in('stato', ['in_coda', 'fallita', 'abbandonata']).limit(1000)
    const ops = (opsData || []) as { integrazione: string | null }[]

    const integrazioni = INTEGRAZIONI.map(meta => ({
      ...meta,
      ...(perChiave[meta.chiave] || {}),
      etichetta: meta.etichetta,
      credenzialiMancanti: meta.variabili.filter(v => !process.env[v]).length,
      credenzialiTotali: meta.variabili.length,
      operazioniInSospeso: ops.filter(o => o.integrazione === meta.chiave).length,
    }))
    return { statusCode: 200, headers, body: JSON.stringify({ migrazioneEseguita: true, integrazioni }) }
  }

  // ── Azioni ───────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}') as { azione?: string; chiave?: string; motivo?: string }
    const { azione, chiave } = body
    if (!azione || !chiave) return { statusCode: 400, headers, body: JSON.stringify({ error: 'azione e chiave obbligatorie' }) }
    const meta = INTEGRAZIONE_BY_CHIAVE[chiave]
    if (!meta) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Integrazione sconosciuta' }) }

    const t0 = Date.now()
    const ora = new Date().toISOString()
    let messaggio = ''
    let ok = true
    let extra: Record<string, unknown> = {}

    switch (azione) {
      case 'testa_connessione': {
        const esito = await testaConnessione(chiave)
        ok = esito.ok
        messaggio = esito.messaggio
        await supabase.from('sc_integrations').upsert({
          chiave, etichetta: meta.etichetta, categoria: meta.categoria,
          ultimo_test_at: ora, ultimo_test_ok: esito.ok, ultimo_test_messaggio: esito.messaggio.slice(0, 500),
          stato: esito.ok ? 'collegato' : 'errore',
          latenza_media_ms: esito.latenzaMs,
          ...(esito.ok ? { fallimenti_consecutivi: 0, circuito: 'chiuso', circuito_fino_a: null, ultima_chiamata_ok_at: ora } : {}),
          updated_at: ora,
        }, { onConflict: 'chiave' })
        extra = { latenzaMs: esito.latenzaMs }
        break
      }
      case 'riconnetti':
      case 'rigenera_connessione': {
        // Azzera il blocco automatico e rilegge le credenziali, poi prova.
        await supabase.from('sc_integrations').upsert({
          chiave, etichetta: meta.etichetta, categoria: meta.categoria,
          circuito: 'chiuso', circuito_fino_a: null, fallimenti_consecutivi: 0,
          abilitata: true, stato: 'sincronizzazione', ultimo_errore: null, updated_at: ora,
        }, { onConflict: 'chiave' })
        const esito = await testaConnessione(chiave)
        ok = esito.ok
        messaggio = esito.ok
          ? `Collegamento ripristinato. ${esito.messaggio}`
          : `Riconnessione tentata ma il servizio non risponde ancora. ${esito.messaggio}`
        await supabase.from('sc_integrations').update({
          stato: esito.ok ? 'collegato' : 'errore',
          ultimo_test_at: ora, ultimo_test_ok: esito.ok, ultimo_test_messaggio: esito.messaggio.slice(0, 500),
          ...(esito.ok ? { ultima_chiamata_ok_at: ora } : {}),
          updated_at: ora,
        }).eq('chiave', chiave)
        break
      }
      case 'risincronizza': {
        // Rimette in coda SUBITO le operazioni ferme: nessun dato viene creato
        // da zero, si riprendono solo quelle gia' registrate come non riuscite.
        const { data, error } = await supabase.from('sc_operations')
          .update({ stato: 'in_coda', prossimo_tentativo_at: ora, tentativi: 0, updated_at: ora })
          .eq('integrazione', chiave).in('stato', ['fallita', 'abbandonata']).select('id')
        ok = !error
        messaggio = error ? error.message : `${data?.length || 0} operazioni rimesse in coda. Partono al prossimo ciclo di auto-riparazione.`
        await supabase.from('sc_integrations').update({ ultima_sync_at: ora, updated_at: ora }).eq('chiave', chiave)
        extra = { rimesseInCoda: data?.length || 0 }
        break
      }
      case 'disabilita_integrazione': {
        await supabase.from('sc_integrations').upsert({
          chiave, etichetta: meta.etichetta, categoria: meta.categoria,
          abilitata: false, stato: 'disabilitata', note: body.motivo || null, updated_at: ora,
        }, { onConflict: 'chiave' })
        messaggio = 'Integrazione disattivata. Le operazioni continuano ad accodarsi e non vanno perse: riattivandola riprendono.'
        break
      }
      case 'riattiva_integrazione': {
        await supabase.from('sc_integrations').upsert({
          chiave, etichetta: meta.etichetta, categoria: meta.categoria,
          abilitata: true, stato: 'sincronizzazione', circuito: 'chiuso', circuito_fino_a: null,
          fallimenti_consecutivi: 0, updated_at: ora,
        }, { onConflict: 'chiave' })
        const { data } = await supabase.from('sc_operations')
          .update({ stato: 'in_coda', prossimo_tentativo_at: prossimoTentativo(0), updated_at: ora })
          .eq('integrazione', chiave).eq('stato', 'fallita').select('id')
        messaggio = `Integrazione riattivata${data?.length ? `, ${data.length} operazioni rimesse in coda` : ''}.`
        break
      }
      case 'aggiorna_credenziali': {
        // Non si toccano valori da qui: si dice all'amministratore dove agire.
        const mancanti = meta.variabili.filter(v => !process.env[v])
        messaggio = meta.variabili.length
          ? `Le credenziali di ${meta.etichetta} si aggiornano nelle variabili d ambiente di Netlify: ${meta.variabili.join(', ')}.${mancanti.length ? ` Attualmente mancano: ${mancanti.join(', ')}.` : ' Risultano tutte presenti.'} Dopo il salvataggio serve un nuovo deploy, poi torna qui e premi Testa connessione.`
          : 'Questo collegamento non usa credenziali.'
        extra = { variabili: meta.variabili.map(v => ({ nome: v, presente: !!process.env[v] })) }
        break
      }
      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Azione non prevista: ${azione}` }) }
    }

    await registraAzione({
      azione, attoreEmail: email, bersaglioTipo: 'integrazione', bersaglioId: chiave,
      parametri: { motivo: body.motivo || null }, esito: ok ? 'ok' : 'errore',
      messaggio, durataMs: Date.now() - t0,
    })
    return { statusCode: 200, headers, body: JSON.stringify({ ok, messaggio, ...extra }) }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) }
}

export { handler }
