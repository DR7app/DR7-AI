// System Control — esecuzione di un ritentativo.
//
// Regole anti-doppione (fatture, pagamenti, contratti, prenotazioni):
//  1. Un'operazione gia' 'riuscita' non viene MAI rieseguita.
//  2. Si passa a 'in_corso' con una scrittura condizionata: se due processi
//     ci provano insieme, solo uno vince e l'altro si ferma. Il valore di
//     `updated_at` scritto in quel momento e' il gettone della presa in
//     carico: solo chi lo possiede chiude l'operazione.
//  3. Si chiama solo un endpoint della whitelist, mai un URL arbitrario, e
//     mai se l'integrazione o la funzione sono spente dal System Control.
//  4. La chiave di idempotenza viaggia nel corpo e nell'header, cosi' anche
//     l'endpoint chiamato puo' riconoscere il doppione.
//  5. HTTP 200 non basta: se la risposta dice `success:false` o `skipped`,
//     l'operazione NON e' riuscita.
//  6. La chiamata ha un tempo massimo. Un'operazione rimasta 'in_corso' oltre
//     PRESA_IN_CARICO_SCADE_MIN la raccoglie `recuperaOperazioniBloccate`,
//     che NON la rilancia: non si sa se l'invio e' partito, decide una persona.
import type { SupabaseClient } from '@supabase/supabase-js'
import { ENDPOINT_RETRY_CONSENTITI, FUNZIONE_PER_INTEGRAZIONE, PRESA_IN_CARICO_SCADE_MIN } from './systemControlCatalog'
import { prossimoTentativo, mascheraTesto, registraAzione, statoFunzione } from './systemControl'

export interface EsitoRitentativo {
  ok: boolean
  messaggio: string
  saltata?: boolean
}

// Sotto il limite di 26 secondi delle funzioni Netlify sincrone.
const TEMPO_MASSIMO_MS = 25_000

type EsitoRisposta =
  | { tipo: 'riuscita' }
  | { tipo: 'sospesa'; motivo: string }
  | { tipo: 'ignorata'; motivo: string }
  | { tipo: 'fallita'; motivo: string }

/** Legge il corpo della risposta: HTTP 2xx con `success:false` non e' un successo. */
export function interpretaRisposta(status: number, testo: string): EsitoRisposta {
  let corpo: Record<string, unknown> | null = null
  try {
    const j = JSON.parse(testo)
    if (j && typeof j === 'object' && !Array.isArray(j)) corpo = j as Record<string, unknown>
  } catch { /* corpo non JSON: conta solo lo status */ }
  const motivo = String(corpo?.reason ?? corpo?.error ?? corpo?.message ?? '').slice(0, 300)
  if (status < 200 || status >= 300) return { tipo: 'fallita', motivo: `HTTP ${status}${motivo ? ` — ${motivo}` : ''}` }
  // Interruttore spento (reason '<chiave>_off'): l'operazione aspetta, non si annulla.
  if (corpo?.skipped === true && /_off$/.test(String(corpo?.reason || ''))) {
    return { tipo: 'sospesa', motivo: String(corpo?.message ?? corpo?.error ?? corpo?.reason) }
  }
  if (corpo?.skipped === true) return { tipo: 'ignorata', motivo: motivo || 'nessun motivo indicato' }
  if (corpo?.success === false || corpo?.ok === false) return { tipo: 'fallita', motivo: motivo || 'risposta success:false' }
  return { tipo: 'riuscita' }
}

/** Perche' questa operazione non puo' partire adesso (null = puo' partire). */
async function bloccoIntegrazione(
  sb: SupabaseClient,
  op: { integrazione: string | null; business: string | null },
  automatico: boolean,
): Promise<string | null> {
  if (!op.integrazione) return null
  const { data } = await sb.from('sc_integrations')
    .select('abilitata, circuito, circuito_fino_a').eq('chiave', op.integrazione).maybeSingle()
  const r = data as { abilitata?: boolean; circuito?: string; circuito_fino_a?: string | null } | null
  if (r?.abilitata === false) {
    return `Integrazione ${op.integrazione} disattivata dal System Control: riattivala prima di riprendere l operazione.`
  }
  // Il blocco automatico per troppi errori ferma solo il worker: una persona
  // che preme Riprova sta proprio verificando se il servizio e' tornato.
  if (automatico && r?.circuito === 'aperto' && r.circuito_fino_a && new Date(r.circuito_fino_a).getTime() > Date.now()) {
    return 'Troppi errori di fila: le riprese automatiche sono in pausa.'
  }
  const funzione = FUNZIONE_PER_INTEGRAZIONE[op.integrazione]
  if (funzione) {
    const stato = await statoFunzione(funzione, op.business || '*')
    if (!stato.attiva || stato.manutenzione) {
      return `La funzione «${funzione}» e ${stato.manutenzione ? 'in manutenzione' : 'spenta'} dal System Control: nessun invio finche non viene riattivata.`
    }
  }
  return null
}

export async function eseguiRitentativo(
  sb: SupabaseClient,
  operazioneId: string,
  opts: { attoreEmail?: string | null; automatico?: boolean } = {}
): Promise<EsitoRitentativo> {
  const { data } = await sb.from('sc_operations').select('*').eq('id', operazioneId).maybeSingle()
  if (!data) return { ok: false, messaggio: 'Operazione non trovata.' }
  const op = data as {
    id: string; tipo: string; stato: string; endpoint: string | null; payload: Record<string, unknown>
    chiave_idempotenza: string; tentativi: number; max_tentativi: number; descrizione: string
    integrazione: string | null; business: string | null
  }

  if (op.stato === 'riuscita') {
    return { ok: true, saltata: true, messaggio: 'Operazione gia completata: nessun nuovo invio (protezione anti-doppione).' }
  }
  if (op.stato === 'in_corso') {
    return { ok: false, saltata: true, messaggio: 'Operazione gia in esecuzione in questo momento.' }
  }
  if (!op.endpoint) {
    return { ok: false, messaggio: 'Questa operazione non ha un punto di ripresa automatico: va ripresa dalla sua schermata.' }
  }
  if (!ENDPOINT_RETRY_CONSENTITI.has(op.endpoint)) {
    return { ok: false, messaggio: `Ripresa non consentita: ${op.endpoint} non e fra gli endpoint autorizzati.` }
  }

  const blocco = await bloccoIntegrazione(sb, op, !!opts.automatico)
  if (blocco) return { ok: false, saltata: true, messaggio: blocco }

  // Presa in carico condizionata: vince chi arriva primo. `gettone` e' il
  // valore di updated_at che solo questo processo conosce.
  const gettone = new Date().toISOString()
  const { data: preso } = await sb.from('sc_operations')
    .update({ stato: 'in_corso', updated_at: gettone })
    .eq('id', op.id).in('stato', ['in_coda', 'fallita', 'abbandonata'])
    .select('id')
  if (!preso || !preso.length) {
    return { ok: false, saltata: true, messaggio: 'Un altro processo ha gia preso in carico questa operazione.' }
  }

  // Chiusura riservata al proprietario del gettone. Se l'endpoint chiamato ha
  // gia' chiuso l'operazione (chiudiOperazione), questa scrittura non tocca nulla.
  const chiudi = (campi: Record<string, unknown>) => sb.from('sc_operations')
    .update({ ...campi, updated_at: new Date().toISOString() })
    .eq('id', op.id).eq('stato', 'in_corso').eq('updated_at', gettone)

  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || ''
  const url = `${base}/.netlify/functions/${op.endpoint}`
  const tentativi = (op.tentativi || 0) + 1
  const esaurita = tentativi >= (op.max_tentativi || 5)
  const t0 = Date.now()
  const fallimento = async (motivo: string, status?: number): Promise<EsitoRitentativo> => {
    await chiudi({
      stato: esaurita ? 'abbandonata' : 'in_coda',
      tentativi,
      ultimo_errore: mascheraTesto(motivo).slice(0, 1500),
      ultimo_errore_at: new Date().toISOString(),
      prossimo_tentativo_at: prossimoTentativo(tentativi),
    })
    await registraAzione({
      azione: 'riprova', attoreEmail: opts.attoreEmail || null, automatico: !!opts.automatico,
      bersaglioTipo: 'operazione', bersaglioId: op.id, esito: 'errore',
      messaggio: `Ripresa fallita: ${motivo}`, durataMs: Date.now() - t0,
    })
    return {
      ok: false,
      messaggio: esaurita
        ? `Non riuscita dopo ${tentativi} tentativi: il gestionale smette di insistere e aspetta te.`
        : `Non riuscita${status ? ` (${status})` : ''}: ${mascheraTesto(motivo).slice(0, 200)}. Prossimo tentativo piu tardi.`,
    }
  }

  let status = 0
  let testo = ''
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': op.chiave_idempotenza,
        ...(process.env.ADMIN_API_TOKEN ? { Authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` } : {}),
      },
      body: JSON.stringify({ ...(op.payload || {}), idempotencyKey: op.chiave_idempotenza, systemControlRetry: true }),
      signal: AbortSignal.timeout(TEMPO_MASSIMO_MS),
    })
    status = res.status
    testo = (await res.text()).slice(0, 800)
  } catch (err) {
    const e = err as Error
    const motivo = e?.name === 'TimeoutError' || e?.name === 'AbortError'
      ? `Nessuna risposta entro ${TEMPO_MASSIMO_MS / 1000} secondi`
      : (e?.message || String(err))
    return fallimento(motivo)
  }

  const esito = interpretaRisposta(status, testo)
  if (esito.tipo === 'fallita') return fallimento(esito.motivo, status)

  if (esito.tipo === 'sospesa') {
    // Funzione spenta dal System Control: si torna in coda senza consumare
    // un tentativo. Ripartira' quando l'interruttore viene riacceso.
    await chiudi({
      stato: 'in_coda',
      ultimo_errore: `In attesa: ${esito.motivo}`.slice(0, 1500),
      ultimo_errore_at: new Date().toISOString(),
      prossimo_tentativo_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    })
    return { ok: false, saltata: true, messaggio: `Non eseguita: ${esito.motivo} L operazione resta in coda.` }
  }

  if (esito.tipo === 'ignorata') {
    // L'endpoint ha scelto di NON eseguire (es. veicolo di test): non e' un
    // invio fatto e non ha senso ritentare. Si annulla, con il motivo.
    await chiudi({
      stato: 'annullata', tentativi,
      risolta_at: new Date().toISOString(),
      risolta_da: opts.automatico ? 'auto-riparazione' : (opts.attoreEmail || 'System Control'),
      ultimo_errore: `Non eseguita dall endpoint: ${esito.motivo}`.slice(0, 1500),
    })
    await registraAzione({
      azione: 'riprova', attoreEmail: opts.attoreEmail || null, automatico: !!opts.automatico,
      bersaglioTipo: 'operazione', bersaglioId: op.id, business: op.business || undefined,
      esito: 'rifiutata', messaggio: `L endpoint non ha eseguito: ${esito.motivo}`, durataMs: Date.now() - t0,
    })
    return { ok: false, messaggio: `Nessun invio: l endpoint ha scelto di non eseguire (${esito.motivo}). Operazione annullata, resta nello storico.` }
  }

  await chiudi({
    stato: 'riuscita', tentativi,
    risolta_at: new Date().toISOString(),
    risolta_da: opts.automatico ? 'auto-riparazione' : (opts.attoreEmail || 'System Control'),
    ultimo_errore: null,
  })
  await registraAzione({
    azione: 'riprova', attoreEmail: opts.attoreEmail || null, automatico: !!opts.automatico,
    bersaglioTipo: 'operazione', bersaglioId: op.id, business: op.business || undefined,
    parametri: { tipo: op.tipo, tentativo: tentativi }, esito: 'ok',
    messaggio: `Ripresa riuscita: ${op.descrizione}`, durataMs: Date.now() - t0,
  })
  return { ok: true, messaggio: `Operazione completata: ${op.descrizione}.` }
}

/** Soglia oltre la quale una presa in carico e' considerata orfana. */
export function scadenzaPresaInCarico(): string {
  return new Date(Date.now() - PRESA_IN_CARICO_SCADE_MIN * 60_000).toISOString()
}

/**
 * Operazioni rimaste 'in_corso' oltre la scadenza: il processo che le aveva
 * prese non c'e' piu'. NON si rilanciano da sole (l'invio potrebbe essere
 * partito prima dell'interruzione): passano ad 'abbandonata' con la
 * spiegazione, cosi' tornano visibili e una persona verifica prima di
 * premere Riprova.
 */
export async function recuperaOperazioniBloccate(sb: SupabaseClient): Promise<number> {
  const ora = new Date().toISOString()
  const { data, error } = await sb.from('sc_operations')
    .update({
      stato: 'abbandonata',
      // Da qui in poi solo una persona la rilancia: ne' il worker ne'
      // "Riprova tutte" devono rifare alla cieca un invio forse gia' partito.
      automatica: false,
      ultimo_errore: `Interrotta durante l esecuzione (nessun esito dopo ${PRESA_IN_CARICO_SCADE_MIN} minuti). Verifica se l invio e partito prima di premere Riprova.`,
      ultimo_errore_at: ora,
      updated_at: ora,
    })
    .eq('stato', 'in_corso').lt('updated_at', scadenzaPresaInCarico())
    .select('id')
  if (error) throw new Error(`Recupero operazioni bloccate non riuscito: ${error.message}`)
  return data?.length || 0
}
