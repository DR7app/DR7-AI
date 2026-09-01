// DR7 A.I System Control — lato browser.
//
// Due cose: le chiamate agli endpoint del System Control e la segnalazione
// automatica degli errori che l'operatore incontra nel pannello.
import { authFetch } from './authFetch'

const BASE = '/.netlify/functions'

export type Severita = 'informativo' | 'basso' | 'medio' | 'alto' | 'critico'
export type StatoServizio = 'operativo' | 'degradato' | 'problema' | 'critico'

export interface Servizio {
  chiave: string
  etichetta: string
  stato: StatoServizio
  dettaglio: string
  latenzaMs?: number
}

export interface GruppoProblema {
  id: string
  titolo: string
  messaggio_tecnico: string | null
  causa_probabile: string | null
  severita: Severita
  categoria: string
  classe_risoluzione: 1 | 2 | 3
  modulo: string | null
  funzione: string | null
  integrazione: string | null
  business: string | null
  azioni_suggerite: string[]
  prima_comparsa: string
  ultima_comparsa: string
  occorrenze: number
  aziende_coinvolte: string[]
  utenti_coinvolti: string[]
  stato: 'aperto' | 'in_corso' | 'risolto' | 'ignorato'
  auto_tentativi: number
  auto_ultimo_esito: string | null
  risolto_at: string | null
  risolto_da: string | null
  risolto_come: string | null
  risolto_auto: boolean
  note: string | null
}

export interface Operazione {
  id: string
  tipo: string
  descrizione: string
  integrazione: string | null
  business: string | null
  entita_tipo: string | null
  entita_id: string | null
  stato: 'in_coda' | 'in_corso' | 'riuscita' | 'fallita' | 'abbandonata' | 'annullata'
  tentativi: number
  max_tentativi: number
  prossimo_tentativo_at: string
  ultimo_errore: string | null
  created_at: string
}

export interface IntegrazioneRiga {
  chiave: string
  etichetta: string
  categoria: string
  impatto: string
  stato?: string
  abilitata?: boolean
  circuito?: string
  circuito_fino_a?: string | null
  ultimo_test_at?: string | null
  ultimo_test_ok?: boolean | null
  ultimo_test_messaggio?: string | null
  ultima_sync_at?: string | null
  ultimo_errore?: string | null
  ultimo_errore_at?: string | null
  latenza_media_ms?: number
  fallimenti_consecutivi?: number
  credenzialiMancanti: number
  credenzialiTotali: number
  operazioniInSospeso: number
}

export interface Controllo { nome: string; esito: 'ok' | 'attenzione' | 'ko' | 'sconosciuto'; dettaglio: string }
export interface Diagnosi {
  controlli: Controllo[]
  conclusione: string
  azioneConsigliata: string
  azioni: string[]
  nessunaAzione: boolean
}

async function chiama<T>(percorso: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(`${BASE}/${percorso}`, init)
  const testo = await res.text()
  let dato: unknown
  try { dato = JSON.parse(testo) } catch { dato = { error: testo.slice(0, 200) } }
  if (!res.ok) throw new Error((dato as { error?: string })?.error || `Errore ${res.status}`)
  return dato as T
}

export const systemControl = {
  panoramica: () => chiama<Record<string, unknown>>('system-control-overview'),
  problemi: (q: Record<string, string> = {}) =>
    chiama<{ migrazioneEseguita: boolean; gruppi: GruppoProblema[] }>(`system-control-events?${new URLSearchParams(q)}`),
  problema: (id: string) =>
    chiama<{ gruppo: GruppoProblema; eventi: Record<string, unknown>[]; operazioni: Operazione[]; incidenti: Record<string, unknown>[]; diagnosi: Diagnosi | null; azioni: { chiave: string; etichetta: string; descrizione: string; conferma: boolean }[] }>(`system-control-events?id=${id}`),
  azioneProblema: (azione: string, gruppoId: string, nota?: string) =>
    chiama<{ ok: boolean; messaggio: string }>('system-control-events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ azione, gruppoId, nota }),
    }),
  integrazioni: () => chiama<{ migrazioneEseguita: boolean; integrazioni: IntegrazioneRiga[] }>('system-control-integrations'),
  integrazione: (chiave: string) =>
    chiama<{ integrazione: IntegrazioneRiga; credenziali: { nome: string; presente: boolean }[]; diagnosi: Diagnosi; errori: GruppoProblema[]; operazioni: Operazione[] }>(`system-control-integrations?chiave=${chiave}`),
  azioneIntegrazione: (azione: string, chiave: string, motivo?: string) =>
    chiama<{ ok: boolean; messaggio: string }>('system-control-integrations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ azione, chiave, motivo }),
    }),
  operazioni: (q: Record<string, string> = {}) =>
    chiama<{ migrazioneEseguita: boolean; operazioni: Operazione[] }>(`system-control-operations?${new URLSearchParams(q)}`),
  azioneOperazione: (azione: string, corpo: Record<string, unknown> = {}) =>
    chiama<{ ok: boolean; messaggio: string; saltata?: boolean }>('system-control-operations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ azione, ...corpo }),
    }),
  azioneSistema: (azione: string, corpo: Record<string, unknown> = {}) =>
    chiama<{ ok: boolean; messaggio: string }>('system-control-actions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ azione, ...corpo }),
    }),
  interruttori: () => chiama<{ migrazioneEseguita: boolean; funzioni: { chiave: string; etichetta: string; descrizione: string; critica: boolean }[]; flags: Record<string, unknown>[]; storico?: Record<string, unknown>[] }>('system-control-flags'),
  impostaInterruttore: (corpo: Record<string, unknown>) =>
    chiama<{ ok: boolean; messaggio: string; richiedeConferma?: boolean }>('system-control-flags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
    }),
  incidenti: () => chiama<{ migrazioneEseguita: boolean; incidenti: Record<string, unknown>[] }>('system-control-incidents'),
  creaIncidente: (gruppoId: string, passi?: string) =>
    chiama<{ ok: boolean; incidente: Record<string, unknown>; messaggio: string }>('system-control-incidents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gruppoId, passi }),
    }),
  chiudiIncidente: (id: string, note?: string) =>
    chiama<{ ok: boolean; messaggio: string }>('system-control-incidents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ azione: 'chiudi', id, note }),
    }),
  metriche: (giorni = 7) => chiama<Record<string, unknown>>(`system-control-metrics?giorni=${giorni}`),
  assistente: (gruppoId: string, domanda?: string) =>
    chiama<{ ok: boolean; analisi?: string; messaggio?: string }>('system-control-assistant', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gruppoId, domanda }),
    }),
}

// ── Segnalazione automatica degli errori del pannello ──────────────────────
// Non blocca mai l'interfaccia: se la segnalazione fallisce, si tace.
let ultimeSegnalazioni = new Map<string, number>()

export function segnalaErrore(input: {
  messaggio: string
  stack?: string
  modulo?: string
  funzione?: string
  categoria?: string
  integrazione?: string
  business?: string
  severita?: Severita
  contesto?: Record<string, unknown>
  status?: number
}): void {
  try {
    // Anti-tempesta: lo stesso errore non parte piu' di una volta al minuto.
    const chiave = `${input.modulo || ''}|${input.messaggio}`.slice(0, 200)
    const ultimo = ultimeSegnalazioni.get(chiave) || 0
    if (Date.now() - ultimo < 60_000) return
    ultimeSegnalazioni.set(chiave, Date.now())
    if (ultimeSegnalazioni.size > 200) ultimeSegnalazioni = new Map()

    void authFetch(`${BASE}/system-control-ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, contesto: { ...(input.contesto || {}), percorso: window.location.hash || window.location.pathname } }),
    }).catch(() => { /* silenzioso di proposito */ })
  } catch { /* silenzioso di proposito */ }
}

/** Aggancia gli errori non gestiti del pannello. Da chiamare una volta sola. */
export function avviaRilevazioneErrori(): void {
  if ((window as unknown as { __scAvviato?: boolean }).__scAvviato) return
  ;(window as unknown as { __scAvviato?: boolean }).__scAvviato = true

  window.addEventListener('error', e => {
    segnalaErrore({
      messaggio: e.message || 'Errore non gestito',
      stack: e.error?.stack,
      modulo: 'pannello',
      categoria: 'frontend',
      severita: 'alto',
      contesto: { file: e.filename, riga: e.lineno },
    })
  })

  window.addEventListener('unhandledrejection', e => {
    const motivo = e.reason
    segnalaErrore({
      messaggio: (motivo as Error)?.message || String(motivo).slice(0, 300),
      stack: (motivo as Error)?.stack,
      modulo: 'pannello',
      categoria: 'frontend',
      severita: 'medio',
    })
  })
}
