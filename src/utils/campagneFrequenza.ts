// 07/11/2026 (direzione): frequenza automatica degli invii massivi WhatsApp.
//
// Prima "Invia" nella Campagna Marketing mandava a tutti di fila dal browser e
// il bot WhatsApp (Green API) veniva bloccato. Adesso ogni invio massivo va in
// coda (marketing_campaign_recipients) e lo smaltisce il cron
// process-scheduled-campaigns-cron rispettando QUESTI limiti, uguali per
// tutte le campagne insieme:
//   - al massimo LIMITE_MESSAGGI_ORA messaggi in un'ora (finestra mobile);
//   - solo dalle FASCIA_ORA_DA alle FASCIA_ORA_A, ora di Roma (ora legale
//     compresa); quello che resta riparte da solo il giorno dopo alle 9.
//
// File condiviso: lo leggono la schermata (stima di fine invio) e le funzioni
// Netlify (send-whatsapp-campaign-chunk, process-scheduled-campaigns-cron).
// Per cambiare i limiti si cambia SOLO qui.

export const LIMITE_MESSAGGI_ORA = 50
export const FINESTRA_MINUTI = 60
export const FASCIA_ORA_DA = 9
export const FASCIA_ORA_A = 21
/** Ogni quanto gira il cron che smaltisce la coda (netlify.toml). */
export const CRON_OGNI_MINUTI = 2
/**
 * Invii al massimo per giro di cron: distribuisce i 50 dell'ora su tutta
 * l'ora (2 ogni 2 minuti) invece di spararli tutti nei primi minuti.
 */
export const INVII_PER_GIRO = Math.max(1, Math.ceil(LIMITE_MESSAGGI_ORA * CRON_OGNI_MINUTI / FINESTRA_MINUTI))
/** Una presa "sending" piu' vecchia di cosi' e' un invio interrotto a meta'. */
export const PRESA_SCADE_MINUTI = 15

const ROMA = 'Europe/Rome'

interface PartiRoma { anno: number; mese: number; giorno: number; ora: number; minuto: number }

export function partiRoma(d: Date): PartiRoma {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: ROMA, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]))
  return {
    anno: Number(p.year), mese: Number(p.month), giorno: Number(p.day),
    ora: p.hour === '24' ? 0 : Number(p.hour), minuto: Number(p.minute),
  }
}

/** Istante UTC di un'ora locale di Roma (gestisce ora solare/legale). */
export function romaLocaleAUtc(anno: number, mese: number, giorno: number, ora: number, minuto = 0): Date {
  const ipotesi = Date.UTC(anno, mese - 1, giorno, ora, minuto)
  const p = partiRoma(new Date(ipotesi))
  const comeUtc = Date.UTC(p.anno, p.mese - 1, p.giorno, p.ora, p.minuto)
  return new Date(ipotesi - (comeUtc - ipotesi))
}

export function inFasciaInvio(d: Date = new Date()): boolean {
  const { ora } = partiRoma(d)
  return ora >= FASCIA_ORA_DA && ora < FASCIA_ORA_A
}

/** Prossima apertura della fascia (le 9 di oggi o di domani, ora di Roma). */
export function prossimaApertura(d: Date): Date {
  const p = partiRoma(d)
  if (p.ora < FASCIA_ORA_DA) return romaLocaleAUtc(p.anno, p.mese, p.giorno, FASCIA_ORA_DA)
  const domani = new Date(Date.UTC(p.anno, p.mese - 1, p.giorno + 1))
  return romaLocaleAUtc(domani.getUTCFullYear(), domani.getUTCMonth() + 1, domani.getUTCDate(), FASCIA_ORA_DA)
}

/**
 * Stima di quando finira' l'invio di `rimanenti` messaggi: ritmo regolare di
 * LIMITE_MESSAGGI_ORA all'ora, solo dentro la fascia. E' una stima: errori,
 * numeri non validi e altre campagne in coda la spostano.
 */
export function stimaFineInvio(rimanenti: number, adesso: Date = new Date()): Date | null {
  if (!Number.isFinite(rimanenti) || rimanenti <= 0) return null
  const passoMs = (FINESTRA_MINUTI * 60_000) / LIMITE_MESSAGGI_ORA
  let t = adesso.getTime()
  let ultimo = t
  for (let i = 0; i < Math.ceil(rimanenti); i++) {
    if (!inFasciaInvio(new Date(t))) t = prossimaApertura(new Date(t)).getTime()
    ultimo = t
    t += passoMs
  }
  return new Date(ultimo)
}

/** "dd/mm/yyyy HH:mm" ora di Roma. */
export function formattaDataOraRoma(d: Date): string {
  return d.toLocaleString('it-IT', {
    timeZone: ROMA, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

// ── 09/11/2026 (direzione): "Tutti i clienti" di Messaggi Sistema Pro ──────
//
// Anche il broadcast "Tutti i clienti" passa dalla STESSA coda delle campagne
// (marketing_campaign_recipients): un solo numero WhatsApp, quindi un solo
// tetto di LIMITE_MESSAGGI_ORA l'ora per le due strade insieme. Ogni giro del
// broadcast e' una riga di marketing_campaigns con questa audience; il legame
// col template sta in audience_filters (nessuna colonna nuova da migrare).

/** marketing_campaigns.audience dei giri accodati da Messaggi Sistema Pro. */
export const AUDIENCE_MESSAGGI_SISTEMA = 'messaggi_sistema_pro'

/** Cosa c'e' in audience_filters di un giro di Messaggi Sistema Pro. */
export interface FiltriGiroMessaggiSistema {
  system_message_id: string
  message_key: string
  /** 'template' = testo del template (send-whatsapp-notification con messageKey); 'testo' = testo gia' composto in message_text. */
  modo: 'template' | 'testo'
  /** Chiave del giro (es. ricorrenza + giorno): serve a leggere i log. */
  chiave_giro?: string
  /** Variabili extra del finto "booking" passate al template (es. targa). */
  variabili?: Record<string, string>
  /** Etichetta del messaggio (log di send-whatsapp-notification). */
  etichetta?: string
}

export interface CampagnaInCoda {
  id: string
  created_at: string
  status: string | null
  total_recipients: number | null
  sent_count: number | null
  failed_count: number | null
  audience?: string | null
  audience_filters?: unknown
}

/** Il giro e' un broadcast di Messaggi Sistema Pro? Restituisce i suoi filtri. */
export function filtriGiroMessaggiSistema(c: { audience?: string | null; audience_filters?: unknown }): FiltriGiroMessaggiSistema | null {
  if (c.audience !== AUDIENCE_MESSAGGI_SISTEMA) return null
  const f = c.audience_filters as Partial<FiltriGiroMessaggiSistema> | null | undefined
  if (!f || typeof f !== 'object' || !f.system_message_id || !f.message_key) return null
  return {
    system_message_id: String(f.system_message_id),
    message_key: String(f.message_key),
    modo: f.modo === 'testo' ? 'testo' : 'template',
    chiave_giro: f.chiave_giro ? String(f.chiave_giro) : undefined,
    variabili: f.variabili && typeof f.variabili === 'object' ? f.variabili as Record<string, string> : undefined,
    etichetta: f.etichetta ? String(f.etichetta) : undefined,
  }
}

function rimanentiDi(c: CampagnaInCoda): number {
  return Math.max(0, (Number(c.total_recipients) || 0) - (Number(c.sent_count) || 0) - (Number(c.failed_count) || 0))
}

export interface RiepilogoCodaMessaggio {
  /** Destinatari del template ancora da inviare (giri in corso). */
  inCoda: number
  inviati: number
  falliti: number
  /** Messaggi di ALTRE campagne/broadcast che partono prima (coda condivisa). */
  davanti: number
  fineStimata: Date | null
}

/**
 * Stato in coda del broadcast di un template. `attive` = TUTTE le campagne
 * ancora in corso (pending/sending), di qualsiasi origine: la coda e' una sola
 * e il cron la smaltisce dalla piu' vecchia, quindi la fine stimata conta
 * anche quello che e' in coda prima.
 */
export function riepilogoCodaMessaggio(attive: CampagnaInCoda[], systemMessageId: string, adesso: Date = new Date()): RiepilogoCodaMessaggio {
  return riepilogoCoda(attive, c => filtriGiroMessaggiSistema(c)?.system_message_id === systemMessageId, adesso)
}

/** Come riepilogoCodaMessaggio, per i giri che soddisfano `delTemplate`. */
export function riepilogoCoda(attive: CampagnaInCoda[], delTemplate: (c: CampagnaInCoda) => boolean, adesso: Date = new Date()): RiepilogoCodaMessaggio {
  const inCorso = attive
    .filter(c => c.status === 'pending' || c.status === 'sending')
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  let ultimo = -1
  inCorso.forEach((c, i) => { if (delTemplate(c)) ultimo = i })
  let inCoda = 0, inviati = 0, falliti = 0, davanti = 0, cumulati = 0
  inCorso.forEach((c, i) => {
    if (i > ultimo) return
    const r = rimanentiDi(c)
    cumulati += r
    if (delTemplate(c)) {
      inCoda += r
      inviati += Number(c.sent_count) || 0
      falliti += Number(c.failed_count) || 0
    } else {
      davanti += r
    }
  })
  return { inCoda, inviati, falliti, davanti, fineStimata: inCoda > 0 ? stimaFineInvio(cumulati, adesso) : null }
}

// ── 09/11/2026 (direzione): modo "broadcast" delle promo automatiche ───────
//
// Promo Incassi (promo-incassi-cron, promo-incassi-run-now) e Maxi Promo Gap
// (maxi-promo-gap-cron) in modo "broadcast" mandavano a TUTTA la base clienti
// di fila, senza tetto, dallo stesso numero WhatsApp. Ora ogni giro e' una
// riga di marketing_campaigns con questa audience: stessa coda, stesso tetto
// di LIMITE_MESSAGGI_ORA l'ora insieme a campagne e Messaggi Sistema Pro,
// stessa fascia. Testo, variabili e lingua restano quelli di prima: la coda
// chiama send-whatsapp-notification con lo stesso templateKey e le stesse
// templateVars che il cron passava (salvate qui in audience_filters).

/** marketing_campaigns.audience dei giri accodati dalle promo automatiche. */
export const AUDIENCE_PROMO_AUTOMATICHE = 'promo_automatiche'

export type TipoPromoAutomatica = 'promo_incassi' | 'maxi_promo_gap'

export const ETICHETTA_PROMO: Record<TipoPromoAutomatica, string> = {
  promo_incassi: 'Promo Incassi',
  maxi_promo_gap: 'Maxi Promo Gap',
}

/** Cosa c'e' in audience_filters di un giro di una promo automatica. */
export interface FiltriGiroPromo {
  promo: TipoPromoAutomatica
  /** templateKey passato a send-whatsapp-notification (identico al cron). */
  template_key: string
  /** templateVars passate a send-whatsapp-notification (identiche al cron). */
  template_vars: Record<string, string>
  /** L'unita' della promo: veicolo + mese (incassi) o veicolo + firma del buco (gap). */
  chiave_unita: string
  /** Campi della riga di registro (sent_log) della promo, senza il destinatario. */
  registro: Record<string, string | number>
  /** Oltre questo istante la promo non vale piu': chi e' ancora in coda viene saltato. */
  scade_il?: string
  /** Es. il nome del veicolo. */
  etichetta?: string
}

/** Il giro e' di una promo automatica? Restituisce i suoi filtri. */
export function filtriGiroPromo(c: { audience?: string | null; audience_filters?: unknown }): FiltriGiroPromo | null {
  if (c.audience !== AUDIENCE_PROMO_AUTOMATICHE) return null
  const f = c.audience_filters as Partial<FiltriGiroPromo> | null | undefined
  if (!f || typeof f !== 'object') return null
  if (f.promo !== 'promo_incassi' && f.promo !== 'maxi_promo_gap') return null
  if (!f.template_key || !f.chiave_unita || !f.registro || typeof f.registro !== 'object') return null
  const vars: Record<string, string> = {}
  if (f.template_vars && typeof f.template_vars === 'object') {
    for (const [k, v] of Object.entries(f.template_vars)) vars[k] = String(v ?? '')
  }
  return {
    promo: f.promo,
    template_key: String(f.template_key),
    template_vars: vars,
    chiave_unita: String(f.chiave_unita),
    registro: f.registro as Record<string, string | number>,
    scade_il: f.scade_il ? String(f.scade_il) : undefined,
    etichetta: f.etichetta ? String(f.etichetta) : undefined,
  }
}

/** "YYYY-MM-DD" del giorno di Roma. */
export function giornoRoma(d: Date = new Date()): string {
  const p = partiRoma(d)
  return `${p.anno}-${String(p.mese).padStart(2, '0')}-${String(p.giorno).padStart(2, '0')}`
}

/** La promo del giro e' scaduta (es. il buco di calendario e' gia' passato)? */
export function promoScaduta(f: Pick<FiltriGiroPromo, 'scade_il'>, adesso: Date = new Date()): boolean {
  if (!f.scade_il) return false
  const t = new Date(f.scade_il).getTime()
  return Number.isFinite(t) && t <= adesso.getTime()
}

/** Stato in coda di tutti i giri di una promo automatica. */
export function riepilogoCodaPromo(attive: CampagnaInCoda[], promo: TipoPromoAutomatica, adesso: Date = new Date()): RiepilogoCodaMessaggio {
  return riepilogoCoda(attive, c => filtriGiroPromo(c)?.promo === promo, adesso)
}
