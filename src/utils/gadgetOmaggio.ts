// 26/10/2026 (direzione): bottone "Gadget" sulle prenotazioni di ogni servizio.
// Il WhatsApp "gadget in omaggio" parte UNA volta per PERSONA, come la richiesta
// di recensione: se il cliente torna per un lavaggio o un altro noleggio, non
// riparte. Stessa identita' di netlify/functions/utils/giaRecensito.ts:
// telefono (ultime 9 cifre) o email, mai su valori vuoti.

export const chiaveTelefono = (v: string | null | undefined): string => {
  const cifre = String(v || '').replace(/\D/g, '').replace(/^0+/, '')
  // Ultime 9 cifre: 39 3331234567 e 3331234567 sono lo stesso numero.
  return cifre.length >= 8 ? cifre.slice(-9) : ''
}

export const chiaveEmail = (v: string | null | undefined): string => {
  const e = String(v || '').trim().toLowerCase()
  return e.includes('@') ? e : ''
}

/** Chiavi di una persona ("t:" telefono, "e:" email); vuoto = non riconoscibile. */
export function chiaviPersona(...valori: Array<string | null | undefined>): string[] {
  const chiavi = new Set<string>()
  for (const v of valori) {
    const t = chiaveTelefono(v)
    if (t && !String(v).includes('@')) chiavi.add('t:' + t)
    const e = chiaveEmail(v)
    if (e) chiavi.add('e:' + e)
  }
  return [...chiavi]
}

/** Registrazione dell'invio salvata in booking_details.gadget_omaggio. */
export interface GadgetInviato {
  inviato_at: string
  telefono?: string | null
  email?: string | null
  operatore?: string | null
}
