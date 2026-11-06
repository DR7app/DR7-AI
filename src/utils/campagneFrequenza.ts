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
