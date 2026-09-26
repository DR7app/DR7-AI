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
import { registraAzione, prossimoTentativo } from './utils/systemControl'
import { diagnosticaIntegrazione } from './utils/systemControlDiagnosi'
import { INTEGRAZIONI, INTEGRAZIONE_BY_CHIAVE, provaReale } from './utils/systemControlCatalog'
import { testaConnessione } from './utils/systemControlTest'

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
        .eq('integrazione', chiave).in('stato', ['in_coda', 'in_corso', 'fallita', 'abbandonata']).limit(50),
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
    // Lettura fallita: meglio un errore visibile che quindici collegamenti
    // mostrati come "mai testati" o, peggio, come a posto.
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: `Stato dei collegamenti non leggibile: ${error.message}` }) }
    const righe = (data || []) as Record<string, unknown>[]
    const perChiave = Object.fromEntries(righe.map(r => [String(r.chiave), r]))
    const { data: opsData } = await supabase.from('sc_operations')
      .select('integrazione, stato').in('stato', ['in_coda', 'in_corso', 'fallita', 'abbandonata']).limit(1000)
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

    // Ogni scrittura viene controllata: se il database rifiuta, l'azione e'
    // fallita e va detto, anche nell'audit. Mai un "fatto" non fatto.
    const scritturaFallita = (err: { message?: string } | null, righe: unknown[] | null, cosa: string): string | null => {
      if (err) return `${cosa}: salvataggio rifiutato dal database (${err.message || 'errore'}).`
      if (!righe || !righe.length) return `${cosa}: nessuna riga aggiornata.`
      return null
    }

    switch (azione) {
      case 'testa_connessione': {
        const esito = await testaConnessione(chiave)
        const { data: righe, error } = await supabase.from('sc_integrations').upsert({
          chiave, etichetta: meta.etichetta, categoria: meta.categoria,
          ultimo_test_at: ora, ultimo_test_ok: esito.ok, ultimo_test_messaggio: esito.messaggio.slice(0, 500),
          stato: esito.ok ? 'collegato' : 'errore',
          latenza_media_ms: esito.latenzaMs,
          ...(esito.ok ? { fallimenti_consecutivi: 0, circuito: 'chiuso', circuito_fino_a: null, ...(provaReale(chiave) ? { ultima_chiamata_ok_at: ora } : {}) } : {}),
          updated_at: ora,
        }, { onConflict: 'chiave' }).select('chiave')
        const ko = scritturaFallita(error, righe, 'Esito del test non salvato')
        ok = esito.ok && !ko
        messaggio = ko ? `${esito.messaggio} ${ko}` : esito.messaggio
        extra = { latenzaMs: esito.latenzaMs }
        break
      }
      case 'riconnetti':
      case 'rigenera_connessione': {
        // Azzera il blocco automatico e rilegge le credenziali, poi prova.
        const { data: righe1, error: e1 } = await supabase.from('sc_integrations').upsert({
          chiave, etichetta: meta.etichetta, categoria: meta.categoria,
          circuito: 'chiuso', circuito_fino_a: null, fallimenti_consecutivi: 0,
          abilitata: true, stato: 'sincronizzazione', ultimo_errore: null, updated_at: ora,
        }, { onConflict: 'chiave' }).select('chiave')
        const ko1 = scritturaFallita(e1, righe1, 'Azzeramento del collegamento non salvato')
        if (ko1) { ok = false; messaggio = ko1; break }
        const esito = await testaConnessione(chiave)
        const { data: righe2, error: e2 } = await supabase.from('sc_integrations').update({
          stato: esito.ok ? 'collegato' : 'errore',
          ultimo_test_at: ora, ultimo_test_ok: esito.ok, ultimo_test_messaggio: esito.messaggio.slice(0, 500),
          ...(esito.ok && provaReale(chiave) ? { ultima_chiamata_ok_at: ora } : {}),
          updated_at: ora,
        }).eq('chiave', chiave).select('chiave')
        const ko2 = scritturaFallita(e2, righe2, 'Esito della riconnessione non salvato')
        ok = esito.ok && !ko2
        messaggio = (esito.ok
          ? `Collegamento ripristinato. ${esito.messaggio}`
          : `Riconnessione tentata ma il servizio non risponde ancora. ${esito.messaggio}`) + (ko2 ? ` ${ko2}` : '')
        break
      }
      case 'risincronizza': {
        // Rimette in coda SUBITO le operazioni ferme a ripresa automatica:
        // nessun dato viene creato da zero. Quelle a ripresa solo manuale
        // (fatture, WhatsApp, riprese interrotte) restano ferme e si dicono.
        const { data, error } = await supabase.from('sc_operations')
          .update({ stato: 'in_coda', prossimo_tentativo_at: ora, tentativi: 0, updated_at: ora })
          .eq('integrazione', chiave).in('stato', ['fallita', 'abbandonata']).eq('automatica', true).select('id')
        const { data: manualiData } = await supabase.from('sc_operations')
          .select('id').eq('integrazione', chiave).in('stato', ['in_coda', 'fallita', 'abbandonata']).eq('automatica', false)
        const manuali = manualiData?.length || 0
        ok = !error
        if (error) { messaggio = `Operazioni non rimesse in coda: ${error.message}`; break }
        const { error: eSync } = await supabase.from('sc_integrations').update({ ultima_sync_at: ora, updated_at: ora }).eq('chiave', chiave)
        messaggio = [
          `${data?.length || 0} operazioni rimesse in coda: partono al prossimo ciclo di auto-riparazione.`,
          manuali ? `${manuali} a ripresa solo manuale restano ferme: rilanciale una per una con Riprova.` : '',
          eSync ? `Data di sincronizzazione non salvata (${eSync.message}).` : '',
        ].filter(Boolean).join(' ')
        extra = { rimesseInCoda: data?.length || 0, escluseManuali: manuali }
        break
      }
      case 'disabilita_integrazione': {
        const { data: righe, error } = await supabase.from('sc_integrations').upsert({
          chiave, etichetta: meta.etichetta, categoria: meta.categoria,
          abilitata: false, stato: 'disabilitata', note: body.motivo || null, updated_at: ora,
        }, { onConflict: 'chiave' }).select('chiave')
        const ko = scritturaFallita(error, righe, 'Integrazione NON disattivata')
        ok = !ko
        messaggio = ko || 'Integrazione disattivata: il System Control non la contatta piu, ne con le riprese automatiche ne con Riprova. Le operazioni restano in coda e riprendono alla riattivazione.'
        break
      }
      case 'riattiva_integrazione': {
        const { data: righe, error } = await supabase.from('sc_integrations').upsert({
          chiave, etichetta: meta.etichetta, categoria: meta.categoria,
          abilitata: true, stato: 'sincronizzazione', circuito: 'chiuso', circuito_fino_a: null,
          fallimenti_consecutivi: 0, updated_at: ora,
        }, { onConflict: 'chiave' }).select('chiave')
        const ko = scritturaFallita(error, righe, 'Integrazione NON riattivata')
        if (ko) { ok = false; messaggio = ko; break }
        const { data, error: eOps } = await supabase.from('sc_operations')
          .update({ stato: 'in_coda', prossimo_tentativo_at: prossimoTentativo(0), updated_at: ora })
          .eq('integrazione', chiave).eq('stato', 'fallita').eq('automatica', true).select('id')
        messaggio = `Integrazione riattivata${data?.length ? `, ${data.length} operazioni rimesse in coda` : ''}.` +
          (eOps ? ` Operazioni in sospeso non rimesse in coda: ${eOps.message}.` : '')
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
