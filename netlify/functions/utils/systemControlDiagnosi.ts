// System Control — DIAGNOSTICA AUTOMATICA.
// Quando apri un problema o un'integrazione, il gestionale non si limita a
// mostrare l'errore: fa da solo i controlli collegati e restituisce una
// diagnosi in italiano piu' l'azione consigliata.
import type { SupabaseClient } from '@supabase/supabase-js'
import { INTEGRAZIONE_BY_CHIAVE, traduciErrore } from './systemControlCatalog'

export interface Controllo {
  nome: string
  esito: 'ok' | 'attenzione' | 'ko' | 'sconosciuto'
  dettaglio: string
}

export interface Diagnosi {
  controlli: Controllo[]
  conclusione: string
  azioneConsigliata: string
  azioni: string[]
  /** true quando non serve fare niente: il gestionale ritenta da solo. */
  nessunaAzione: boolean
}

/** Controlli su un'integrazione: credenziali, ultimo test, sync, coda, errori. */
export async function diagnosticaIntegrazione(sb: SupabaseClient, chiave: string): Promise<Diagnosi> {
  const meta = INTEGRAZIONE_BY_CHIAVE[chiave]
  const controlli: Controllo[] = []

  // 1. Le variabili d'ambiente ci sono? (solo presenza, mai il valore)
  if (meta?.variabili?.length) {
    const mancanti = meta.variabili.filter(v => !process.env[v])
    controlli.push({
      nome: 'Credenziali configurate',
      esito: mancanti.length ? 'ko' : 'ok',
      dettaglio: mancanti.length
        ? `Mancano ${mancanti.length} impostazioni su ${meta.variabili.length}: ${mancanti.join(', ')}.`
        : `Tutte le ${meta.variabili.length} impostazioni sono presenti.`,
    })
  }

  // 2. Stato salvato del collegamento
  const { data } = await sb.from('sc_integrations').select('*').eq('chiave', chiave).maybeSingle()
  const r = data as {
    stato?: string; abilitata?: boolean; circuito?: string; circuito_fino_a?: string | null
    ultimo_test_at?: string | null; ultimo_test_ok?: boolean | null; ultimo_test_messaggio?: string | null
    ultima_sync_at?: string | null; ultimo_errore?: string | null; ultimo_errore_at?: string | null
    fallimenti_consecutivi?: number; latenza_media_ms?: number; ultima_chiamata_ok_at?: string | null
  } | null

  controlli.push({
    nome: 'Stato del collegamento',
    esito: !r ? 'sconosciuto' : r.abilitata === false ? 'attenzione' : r.stato === 'collegato' ? 'ok' : 'ko',
    dettaglio: !r ? 'Mai contattato da quando il System Control e attivo.'
      : r.abilitata === false ? 'Disattivato a mano dal System Control.'
      : `Ultimo stato registrato: ${r.stato}.`,
  })

  controlli.push({
    nome: 'Ultima risposta ricevuta',
    esito: !r?.ultima_chiamata_ok_at ? 'sconosciuto'
      : Date.now() - new Date(r.ultima_chiamata_ok_at).getTime() < 24 * 3600_000 ? 'ok' : 'attenzione',
    dettaglio: r?.ultima_chiamata_ok_at
      ? `Ultima risposta valida il ${new Date(r.ultima_chiamata_ok_at).toLocaleString('it-IT')}.`
      : 'Nessuna risposta valida registrata.',
  })

  controlli.push({
    nome: 'Ultimo test manuale',
    esito: r?.ultimo_test_at ? (r.ultimo_test_ok ? 'ok' : 'ko') : 'sconosciuto',
    dettaglio: r?.ultimo_test_at
      ? `${new Date(r.ultimo_test_at).toLocaleString('it-IT')} — ${r.ultimo_test_ok ? 'riuscito' : 'fallito'}${r.ultimo_test_messaggio ? `: ${r.ultimo_test_messaggio}` : ''}.`
      : 'Mai testato da questa pagina.',
  })

  controlli.push({
    nome: 'Ultima sincronizzazione',
    esito: r?.ultima_sync_at ? 'ok' : 'sconosciuto',
    dettaglio: r?.ultima_sync_at ? new Date(r.ultima_sync_at).toLocaleString('it-IT') : 'Nessuna sincronizzazione registrata.',
  })

  controlli.push({
    nome: 'Interruttore automatico',
    esito: r?.circuito === 'aperto' ? 'ko' : r?.circuito === 'semiaperto' ? 'attenzione' : 'ok',
    dettaglio: r?.circuito === 'aperto'
      ? `Chiamate in pausa dopo ${r.fallimenti_consecutivi} errori di fila${r.circuito_fino_a ? `, fino alle ${new Date(r.circuito_fino_a).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : ''}. Le operazioni restano in coda, non si perdono.`
      : r?.circuito === 'semiaperto' ? 'In prova: la prossima chiamata decide se riaprire il collegamento.'
      : 'Chiuso: le chiamate passano normalmente.',
  })

  // 3. Operazioni in sospeso su questa integrazione
  const { data: opsData } = await sb.from('sc_operations')
    .select('id, stato').eq('integrazione', chiave).in('stato', ['in_coda', 'fallita', 'abbandonata']).limit(500)
  const ops = (opsData || []) as { stato: string }[]
  controlli.push({
    nome: 'Operazioni in sospeso',
    esito: ops.some(o => o.stato === 'abbandonata') ? 'ko' : ops.length ? 'attenzione' : 'ok',
    dettaglio: ops.length ? `${ops.length} in attesa, di cui ${ops.filter(o => o.stato === 'abbandonata').length} hanno smesso di ritentare.` : 'Nessuna operazione in sospeso.',
  })

  // 4. Errori recenti
  const da24h = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { data: gruppiData } = await sb.from('sc_error_groups')
    .select('titolo, occorrenze, ultima_comparsa, severita')
    .eq('integrazione', chiave).gte('ultima_comparsa', da24h).order('ultima_comparsa', { ascending: false }).limit(5)
  const gruppi = (gruppiData || []) as { titolo: string; occorrenze: number; severita: string }[]
  controlli.push({
    nome: 'Errori nelle ultime 24 ore',
    esito: gruppi.length ? (gruppi.some(g => ['alto', 'critico'].includes(g.severita)) ? 'ko' : 'attenzione') : 'ok',
    dettaglio: gruppi.length ? gruppi.map(g => `${g.titolo} (${g.occorrenze})`).join(' · ') : 'Nessuno.',
  })

  // ── Conclusione ──────────────────────────────────────────────────────────
  const etichetta = meta?.etichetta || chiave
  const credenzialiKo = controlli.find(c => c.nome === 'Credenziali configurate')?.esito === 'ko'
  const tradotto = r?.ultimo_errore ? traduciErrore(r.ultimo_errore, null) : null

  if (r?.abilitata === false) {
    return { controlli, conclusione: `${etichetta} e spento dal System Control: nessuna chiamata parte.`, azioneConsigliata: 'Riattiva quando vuoi riprendere.', azioni: ['riattiva_integrazione'], nessunaAzione: false }
  }
  if (credenzialiKo) {
    return { controlli, conclusione: `Probabile causa: mancano le impostazioni di ${etichetta}.`, azioneConsigliata: 'Aggiorna le credenziali nelle variabili d ambiente, poi testa la connessione.', azioni: ['aggiorna_credenziali', 'testa_connessione'], nessunaAzione: false }
  }
  if (tradotto && /credenziali|token/i.test(tradotto.titolo)) {
    return { controlli, conclusione: `Probabile causa: ${tradotto.causa.toLowerCase()}`, azioneConsigliata: `Riconnetti ${etichetta}.`, azioni: ['riconnetti', 'testa_connessione', 'aggiorna_credenziali'], nessunaAzione: false }
  }
  if (r?.circuito === 'aperto' || (tradotto && /non disponibile|non ha risposto/i.test(tradotto.titolo))) {
    return {
      controlli,
      conclusione: `${etichetta} risulta temporaneamente non disponibile.`,
      azioneConsigliata: 'Nessuna azione necessaria: il gestionale ritenta da solo e nessuna operazione va persa.',
      azioni: ['testa_connessione'], nessunaAzione: true,
    }
  }
  if (ops.some(o => o.stato === 'abbandonata')) {
    return { controlli, conclusione: `${etichetta} risponde, ma alcune operazioni hanno esaurito i ritentativi.`, azioneConsigliata: 'Risincronizza per rimetterle in coda.', azioni: ['risincronizza', 'testa_connessione'], nessunaAzione: false }
  }
  if (r?.stato === 'collegato') {
    return { controlli, conclusione: `${etichetta} funziona.`, azioneConsigliata: 'Nessuna azione necessaria.', azioni: ['testa_connessione'], nessunaAzione: true }
  }
  return { controlli, conclusione: `Non ci sono elementi per dire con certezza cosa blocca ${etichetta}.`, azioneConsigliata: 'Fai un test di connessione: e il modo piu rapido per capirlo.', azioni: ['testa_connessione', 'apri_incidente'], nessunaAzione: false }
}

/** Controlli su un gruppo di errori: frequenza, integrazione coinvolta, coda. */
export async function diagnosticaProblema(sb: SupabaseClient, gruppoId: string): Promise<Diagnosi | null> {
  const { data } = await sb.from('sc_error_groups').select('*').eq('id', gruppoId).maybeSingle()
  if (!data) return null
  const g = data as {
    titolo: string; messaggio_tecnico: string | null; causa_probabile: string | null
    severita: string; integrazione: string | null; classe_risoluzione: number
    occorrenze: number; prima_comparsa: string; ultima_comparsa: string
    azioni_suggerite: string[]; utenti_coinvolti: string[]; modulo: string | null
  }

  const controlli: Controllo[] = []
  const eta = Date.now() - new Date(g.ultima_comparsa).getTime()
  controlli.push({
    nome: 'Il problema e ancora presente?',
    esito: eta < 3600_000 ? 'ko' : eta < 24 * 3600_000 ? 'attenzione' : 'ok',
    dettaglio: eta < 3600_000 ? 'Si: si e ripresentato nell ultima ora.'
      : eta < 24 * 3600_000 ? 'Ultima comparsa nelle ultime 24 ore.'
      : `Ultima comparsa il ${new Date(g.ultima_comparsa).toLocaleString('it-IT')}: sembra rientrato.`,
  })

  const oreVita = Math.max(1, (Date.now() - new Date(g.prima_comparsa).getTime()) / 3600_000)
  const perOra = g.occorrenze / oreVita
  controlli.push({
    nome: 'Frequenza',
    esito: perOra > 20 ? 'ko' : perOra > 2 ? 'attenzione' : 'ok',
    dettaglio: `${g.occorrenze} volte in ${Math.round(oreVita)} ore (circa ${perOra.toFixed(1)} l ora).`,
  })

  controlli.push({
    nome: 'Utenti coinvolti',
    esito: (g.utenti_coinvolti || []).length > 3 ? 'ko' : (g.utenti_coinvolti || []).length ? 'attenzione' : 'ok',
    dettaglio: (g.utenti_coinvolti || []).length ? `${g.utenti_coinvolti.length}: ${g.utenti_coinvolti.slice(0, 5).join(', ')}.` : 'Nessun utente identificato: probabilmente un automatismo.',
  })

  let diagnosiIntegrazione: Diagnosi | null = null
  if (g.integrazione) {
    diagnosiIntegrazione = await diagnosticaIntegrazione(sb, g.integrazione)
    controlli.push(...diagnosiIntegrazione.controlli)
  }

  const { data: opsData } = await sb.from('sc_operations').select('id, stato').eq('gruppo_id', gruppoId).limit(200)
  const ops = (opsData || []) as { stato: string }[]
  if (ops.length) {
    controlli.push({
      nome: 'Operazioni bloccate da questo problema',
      esito: ops.some(o => o.stato === 'abbandonata') ? 'ko' : 'attenzione',
      dettaglio: `${ops.length} operazioni collegate, ${ops.filter(o => o.stato === 'riuscita').length} gia recuperate.`,
    })
  }

  if (diagnosiIntegrazione) {
    return { ...diagnosiIntegrazione, controlli }
  }
  if (g.classe_risoluzione === 3) {
    return {
      controlli,
      conclusione: g.causa_probabile || 'Il problema nasce dal codice o dalla struttura dei dati.',
      azioneConsigliata: 'Serve una modifica software: crea il rapporto tecnico e consegnalo allo sviluppatore.',
      azioni: ['apri_incidente', 'ignora'], nessunaAzione: false,
    }
  }
  if (g.classe_risoluzione === 1) {
    return {
      controlli,
      conclusione: g.causa_probabile || 'Problema temporaneo.',
      azioneConsigliata: 'Nessuna azione necessaria: il gestionale ritenta da solo.',
      azioni: (g.azioni_suggerite || []).slice(0, 3), nessunaAzione: true,
    }
  }
  return {
    controlli,
    conclusione: g.causa_probabile || 'Causa non determinata.',
    azioneConsigliata: 'Puoi risolverlo da qui con una delle azioni qui sotto.',
    azioni: (g.azioni_suggerite || []).length ? g.azioni_suggerite : ['riprova', 'apri_incidente'],
    nessunaAzione: false,
  }
}
