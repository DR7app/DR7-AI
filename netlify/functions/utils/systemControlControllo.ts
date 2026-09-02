// ═══════════════════════════════════════════════════════════════════════════
// DR7 A.I SYSTEM CONTROL — CONTROLLO ORARIO
//
// Ogni ora il gestionale si guarda allo specchio e scrive cosa non va, in
// italiano, dentro il System Control. Sei controlli, tutti in sola lettura:
//
//   1. Collegamenti  — prova davvero ogni servizio esterno.
//   2. Automatismi   — quali cron hanno smesso di girare.
//   3. Errori        — cosa e' comparso nell'ultima ora.
//   4. Operazioni    — cosa e' rimasto fermo in coda.
//   5. Database      — risponde, e in quanto tempo.
//   6. Funzioni      — quali stanno restituendo errori o sono lente.
//
// Niente qui dentro modifica dati, invia messaggi ai clienti o tocca il
// codice: apre problemi nel pannello e basta. Gli avvisi verso l'esterno
// restano compito del worker di auto-riparazione, che li raggruppa.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'
import {
  registraEvento, registraAzione, mascheraTesto, AMBIENTE, VERSIONE,
} from './systemControl'
import { testaConnessione } from './systemControlTest'
import {
  INTEGRAZIONI, CRON_SORVEGLIATI, tolleranzaMinuti,
} from './systemControlCatalog'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export interface VoceControllo {
  area: 'collegamenti' | 'automatismi' | 'errori' | 'operazioni' | 'database' | 'funzioni'
  esito: 'ok' | 'attenzione' | 'ko'
  titolo: string
  dettaglio: string
}

export interface EsitoControllo {
  eseguitoAt: string
  ambiente: string
  versione: string
  statoGenerale: 'operativo' | 'degradato' | 'problema' | 'critico'
  voci: VoceControllo[]
  problemiAperti: number
  durataMs: number
  riepilogo: string
}

const ora = () => new Date().toISOString()

// ── 1. Collegamenti ────────────────────────────────────────────────────────
/**
 * Prova ogni integrazione e aggiorna `sc_integrations`. Un collegamento che
 * non e' MAI stato configurato non e' un guasto: si segnala come "non
 * configurato" e non apre nessun problema. Guasto e' quando le credenziali
 * ci sono a meta', oppure quando il servizio risponde male.
 */
async function controllaCollegamenti(): Promise<{ voci: VoceControllo[]; problemi: number }> {
  const voci: VoceControllo[] = []
  let problemi = 0

  for (const meta of INTEGRAZIONI) {
    const configurabili = meta.variabili.length
    const presenti = meta.variabili.filter(v => !!process.env[v]).length
    const maiConfigurata = configurabili > 0 && presenti === 0

    if (maiConfigurata) {
      voci.push({
        area: 'collegamenti', esito: 'attenzione',
        titolo: `${meta.etichetta}: non configurato`,
        dettaglio: `Nessuna delle ${configurabili} impostazioni e' valorizzata. Se il servizio non si usa va bene cosi'.`,
      })
      await aggiornaIntegrazione(meta.chiave, {
        stato: 'non_collegato', ultimo_test_at: ora(), ultimo_test_ok: null,
        ultimo_test_messaggio: 'Mai configurato: nessuna credenziale presente.',
      })
      continue
    }

    const esito = await testaConnessione(meta.chiave)
    await aggiornaIntegrazione(meta.chiave, {
      stato: esito.ok ? 'collegato' : 'errore',
      ultimo_test_at: ora(),
      ultimo_test_ok: esito.ok,
      ultimo_test_messaggio: esito.messaggio.slice(0, 500),
      latenza_media_ms: esito.latenzaMs,
      ...(esito.ok
        ? { fallimenti_consecutivi: 0, ultima_chiamata_ok_at: ora() }
        : { ultimo_errore: esito.messaggio.slice(0, 500), ultimo_errore_at: ora() }),
    })

    if (esito.ok) {
      voci.push({
        area: 'collegamenti', esito: 'ok',
        titolo: meta.etichetta,
        dettaglio: `${esito.messaggio} (${esito.latenzaMs} ms)`,
      })
      continue
    }

    problemi++
    const parziale = configurabili > 0 && presenti < configurabili
    voci.push({
      area: 'collegamenti', esito: 'ko',
      titolo: `${meta.etichetta}: non risponde`,
      dettaglio: esito.messaggio,
    })
    await registraEvento({
      messaggio: `${meta.etichetta}: ${esito.messaggio}`,
      titolo: `Collegamento non funzionante: ${meta.etichetta}`,
      causa: parziale
        ? `Le impostazioni di ${meta.etichetta} sono incomplete: ${presenti} su ${configurabili}.`
        : `${meta.impatto}`,
      categoria: 'integrazione', integrazione: meta.chiave,
      modulo: 'controllo-orario', funzione: 'controllaCollegamenti',
      origine: 'cron',
      severita: meta.categoria === 'infrastruttura' ? 'critico' : 'alto',
      classe: 2,
      azioni: ['testa_connessione', 'aggiorna_credenziali'],
      contesto: { impatto: meta.impatto, credenzialiPresenti: presenti, credenzialiTotali: configurabili },
    })
  }

  return { voci, problemi }
}

async function aggiornaIntegrazione(chiave: string, campi: Record<string, unknown>): Promise<void> {
  try {
    await supabase.from('sc_integrations').update({ ...campi, updated_at: ora() }).eq('chiave', chiave)
  } catch { /* mai bloccante */ }
}

// ── 2. Automatismi pianificati ─────────────────────────────────────────────
/**
 * Un cron che non gira non produce nessun errore: e' proprio questo il caso
 * piu' pericoloso, perche' sembra che vada tutto bene. Si confronta l'ultimo
 * battito lasciato in `sc_metrics` con la cadenza dichiarata.
 */
async function controllaAutomatismi(): Promise<{ voci: VoceControllo[]; problemi: number }> {
  const voci: VoceControllo[] = []
  let problemi = 0

  const nomi = CRON_SORVEGLIATI.map(c => c.funzione)
  const { data } = await supabase.from('sc_metrics')
    .select('nome, ora').eq('tipo', 'job').in('nome', nomi)
    .order('ora', { ascending: false }).limit(1000)
  const ultimo = new Map<string, string>()
  for (const r of (data || []) as { nome: string; ora: string }[]) {
    if (!ultimo.has(r.nome)) ultimo.set(r.nome, r.ora)
  }

  for (const cron of CRON_SORVEGLIATI) {
    const battito = ultimo.get(cron.funzione)
    if (!battito) {
      // Nessun battito: puo' essere che la sorveglianza sia appena partita.
      // Non si apre un problema, si dice solo che non si sa ancora.
      voci.push({
        area: 'automatismi', esito: 'attenzione',
        titolo: `${cron.etichetta}: nessun giro registrato`,
        dettaglio: 'Il primo battito arrivera al prossimo giro dell automatismo.',
      })
      continue
    }
    // Il battito e' l'ora arrotondata: si aggiunge un'ora di margine perche'
    // un giro delle 10:59 resta scritto come le 10:00.
    const minutiFa = (Date.now() - new Date(battito).getTime()) / 60_000 - 60
    const tolleranza = tolleranzaMinuti(cron.ogniMinuti)
    if (minutiFa > tolleranza) {
      problemi++
      const oreFa = Math.round(minutiFa / 60)
      voci.push({
        area: 'automatismi', esito: 'ko',
        titolo: `${cron.etichetta}: fermo`,
        dettaglio: `Ultimo giro piu di ${oreFa > 1 ? `${oreFa} ore` : `${Math.round(minutiFa)} minuti`} fa, dovrebbe girare ogni ${descriviCadenza(cron.ogniMinuti)}.`,
      })
      await registraEvento({
        messaggio: `L automatismo ${cron.funzione} non gira da piu di ${Math.round(minutiFa)} minuti (cadenza attesa: ${descriviCadenza(cron.ogniMinuti)}).`,
        titolo: `Automatismo fermo: ${cron.etichetta}`,
        causa: cron.impatto,
        categoria: 'automatismo', modulo: 'controllo-orario', funzione: cron.funzione,
        origine: 'cron', severita: cron.ogniMinuti <= 60 ? 'critico' : 'alto', classe: 2,
        azioni: ['riavvia_job', 'apri_incidente'],
        contesto: { ultimoGiro: battito, cadenzaMinuti: cron.ogniMinuti, impatto: cron.impatto },
      })
    } else {
      voci.push({
        area: 'automatismi', esito: 'ok',
        titolo: cron.etichetta,
        dettaglio: `Ultimo giro registrato alle ${new Date(battito).toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour12: false })}.`,
      })
    }
  }

  return { voci, problemi }
}

function descriviCadenza(minuti: number): string {
  if (minuti < 60) return `${minuti} minuti`
  if (minuti < 1440) return `${Math.round(minuti / 60)} ore`
  if (minuti < 43200) return `${Math.round(minuti / 1440)} giorni`
  return 'mese'
}

// ── 3. Errori dell'ultima ora ──────────────────────────────────────────────
async function controllaErrori(): Promise<{ voci: VoceControllo[]; problemi: number }> {
  const daUnOra = new Date(Date.now() - 3600_000).toISOString()
  const { data } = await supabase.from('sc_error_groups')
    .select('id, titolo, severita, classe_risoluzione, occorrenze, prima_comparsa, ultima_comparsa, integrazione')
    .in('stato', ['aperto', 'in_corso']).gte('ultima_comparsa', daUnOra)
    .order('ultima_comparsa', { ascending: false }).limit(100)
  const gruppi = (data || []) as {
    id: string; titolo: string; severita: string; classe_risoluzione: number
    occorrenze: number; prima_comparsa: string
  }[]

  const nuovi = gruppi.filter(g => new Date(g.prima_comparsa).getTime() >= Date.now() - 3600_000)
  const ordineGravita = ['critico', 'alto', 'medio', 'basso', 'informativo']
  const gravi = gruppi.filter(g => g.severita === 'critico' || g.severita === 'alto')
    .sort((a, b) => ordineGravita.indexOf(a.severita) - ordineGravita.indexOf(b.severita))
  const daSviluppo = gruppi.filter(g => g.classe_risoluzione === 3)

  const voci: VoceControllo[] = [{
    area: 'errori',
    esito: gravi.length ? 'ko' : gruppi.length ? 'attenzione' : 'ok',
    titolo: gruppi.length ? `${gruppi.length} problemi attivi nell ultima ora` : 'Nessun errore nell ultima ora',
    dettaglio: gruppi.length
      ? `${nuovi.length} nuovi, ${gravi.length} gravi, ${daSviluppo.length} da passare allo sviluppatore.` +
        (gravi.length ? ` Il piu grave: ${gravi[0].titolo} (${gravi[0].occorrenze} volte).` : '')
      : 'Nessun errore registrato nell ultima ora.',
  }]

  return { voci, problemi: gravi.length }
}

// ── 4. Operazioni rimaste ferme ────────────────────────────────────────────
async function controllaOperazioni(): Promise<{ voci: VoceControllo[]; problemi: number }> {
  const { data } = await supabase.from('sc_operations')
    .select('id, tipo, stato, tentativi, created_at, integrazione')
    .in('stato', ['in_coda', 'fallita', 'abbandonata']).limit(1000)
  const ops = (data || []) as { stato: string; tipo: string; created_at: string }[]

  const abbandonate = ops.filter(o => o.stato === 'abbandonata')
  const vecchie = ops.filter(o => o.stato === 'in_coda' && Date.now() - new Date(o.created_at).getTime() > 6 * 3600_000)

  const voci: VoceControllo[] = [{
    area: 'operazioni',
    esito: abbandonate.length ? 'ko' : ops.length ? 'attenzione' : 'ok',
    titolo: ops.length ? `${ops.length} operazioni in sospeso` : 'Nessuna operazione in sospeso',
    dettaglio: ops.length
      ? `${abbandonate.length} hanno smesso di ritentare e aspettano una persona, ${vecchie.length} sono in coda da piu di sei ore.`
      : 'La coda e vuota.',
  }]

  if (abbandonate.length) {
    await registraEvento({
      messaggio: `${abbandonate.length} operazioni hanno esaurito i tentativi e restano ferme.`,
      titolo: 'Operazioni ferme che aspettano una persona',
      causa: 'Il gestionale ha ritentato e non ce l ha fatta: vanno guardate a mano dalla vista Operazioni ferme.',
      categoria: 'operazioni', modulo: 'controllo-orario', funzione: 'controllaOperazioni',
      origine: 'cron', severita: 'alto', classe: 2, azioni: ['riprova', 'annulla_operazione'],
      contesto: { abbandonate: abbandonate.length, inCodaDaOltreSeiOre: vecchie.length },
    })
  }

  return { voci, problemi: abbandonate.length ? 1 : 0 }
}

// ── 5. Database ────────────────────────────────────────────────────────────
async function controllaDatabase(): Promise<{ voci: VoceControllo[]; problemi: number }> {
  const t0 = Date.now()
  const { error } = await supabase.from('bookings').select('id', { head: true, count: 'exact' }).limit(1)
  const ms = Date.now() - t0

  if (error) {
    await registraEvento({
      messaggio: `Il database non risponde alle letture: ${mascheraTesto(error.message)}`,
      titolo: 'Database non raggiungibile',
      categoria: 'database', modulo: 'controllo-orario', funzione: 'controllaDatabase',
      origine: 'cron', severita: 'critico', classe: 3, azioni: ['apri_incidente'],
    })
    return {
      voci: [{ area: 'database', esito: 'ko', titolo: 'Database non raggiungibile', dettaglio: mascheraTesto(error.message) }],
      problemi: 1,
    }
  }

  return {
    voci: [{
      area: 'database',
      esito: ms > 2000 ? 'attenzione' : 'ok',
      titolo: ms > 2000 ? 'Database lento' : 'Database',
      dettaglio: `Risponde in ${ms} ms.`,
    }],
    problemi: 0,
  }
}

// ── 6. Funzioni che stanno sbagliando ──────────────────────────────────────
async function controllaFunzioni(): Promise<{ voci: VoceControllo[]; problemi: number }> {
  const daDueOre = new Date(Date.now() - 2 * 3600_000).toISOString()
  const { data } = await supabase.from('sc_metrics')
    .select('nome, tipo, chiamate, errori, durata_totale_ms, durata_max_ms')
    .in('tipo', ['funzione', 'job']).gte('ora', daDueOre).limit(1000)
  const righe = (data || []) as { nome: string; chiamate: number; errori: number; durata_totale_ms: number; durata_max_ms: number }[]

  const per = new Map<string, { chiamate: number; errori: number; ms: number; max: number }>()
  for (const r of righe) {
    const v = per.get(r.nome) || { chiamate: 0, errori: 0, ms: 0, max: 0 }
    v.chiamate += r.chiamate
    v.errori += r.errori
    v.ms += Number(r.durata_totale_ms)
    v.max = Math.max(v.max, r.durata_max_ms)
    per.set(r.nome, v)
  }

  const inErrore = [...per.entries()].filter(([, v]) => v.errori > 0).sort((a, b) => b[1].errori - a[1].errori)
  const lente = [...per.entries()].filter(([, v]) => v.chiamate > 0 && v.ms / v.chiamate > 5000).sort((a, b) => b[1].ms / b[1].chiamate - a[1].ms / a[1].chiamate)

  const voci: VoceControllo[] = []
  voci.push({
    area: 'funzioni',
    esito: inErrore.length ? 'ko' : 'ok',
    titolo: inErrore.length ? `${inErrore.length} funzioni stanno restituendo errori` : 'Nessuna funzione in errore',
    dettaglio: inErrore.length
      ? inErrore.slice(0, 5).map(([n, v]) => `${n}: ${v.errori} errori su ${v.chiamate}`).join(' · ')
      : 'Nelle ultime due ore nessuna funzione ha risposto con un errore.',
  })
  if (lente.length) {
    voci.push({
      area: 'funzioni', esito: 'attenzione',
      titolo: `${lente.length} funzioni lente`,
      dettaglio: lente.slice(0, 5).map(([n, v]) => `${n}: ${Math.round(v.ms / v.chiamate)} ms di media`).join(' · '),
    })
  }

  return { voci, problemi: inErrore.length ? 1 : 0 }
}

// ── Il controllo completo ──────────────────────────────────────────────────
export async function eseguiControlloOrario(opts: { attoreEmail?: string } = {}): Promise<EsitoControllo> {
  const t0 = Date.now()
  const voci: VoceControllo[] = []
  let problemi = 0

  for (const passo of [controllaDatabase, controllaCollegamenti, controllaAutomatismi, controllaOperazioni, controllaErrori, controllaFunzioni]) {
    try {
      const r = await passo()
      voci.push(...r.voci)
      problemi += r.problemi
    } catch (err) {
      voci.push({
        area: 'errori', esito: 'ko',
        titolo: `Controllo non riuscito: ${passo.name}`,
        dettaglio: mascheraTesto((err as Error)?.message || String(err)),
      })
      problemi++
    }
  }

  const ko = voci.filter(v => v.esito === 'ko').length
  const attenzioni = voci.filter(v => v.esito === 'attenzione').length
  const statoGenerale: EsitoControllo['statoGenerale'] =
    voci.some(v => v.esito === 'ko' && (v.area === 'database' || v.area === 'automatismi')) ? 'critico'
    : ko ? 'problema'
    : attenzioni ? 'degradato'
    : 'operativo'

  const riepilogo = ko
    ? `${ko} cose da sistemare, ${attenzioni} da tenere d occhio.`
    : attenzioni
      ? `Tutto in servizio, ${attenzioni} punti da tenere d occhio.`
      : 'Nessun problema rilevato: tutto in servizio.'

  const esito: EsitoControllo = {
    eseguitoAt: ora(),
    ambiente: AMBIENTE,
    versione: VERSIONE,
    statoGenerale,
    voci,
    problemiAperti: problemi,
    durataMs: Date.now() - t0,
    riepilogo,
  }

  await registraAzione({
    azione: 'controllo_orario',
    automatico: !opts.attoreEmail,
    attoreEmail: opts.attoreEmail || null,
    bersaglioTipo: 'sistema',
    parametri: {
      statoGenerale, problemiAperti: problemi,
      voci: voci.map(v => ({ area: v.area, esito: v.esito, titolo: v.titolo, dettaglio: v.dettaglio })),
    },
    esito: ko ? 'errore' : 'ok',
    messaggio: riepilogo,
    durataMs: esito.durataMs,
  })

  return esito
}
