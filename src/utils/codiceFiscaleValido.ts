/**
 * codiceFiscaleValido — controllo formale di codice fiscale e partita IVA.
 *
 * 01/10/2026: le fatture DR7-2026-2102 (CF LRASFN01E25Z138I, il carattere di
 * controllo giusto e' J) e quelle di Saia (SIAVLR91E18B354A, giusto G) sono
 * partite verso Aruba e sono state SCARTATE dallo SDI: il server inviava
 * appena trovava un CF, senza mai verificarlo. Questo modulo e' senza
 * dipendenze apposta, cosi' lo importano sia il gestionale (src/) sia le
 * Netlify Functions (netlify/functions/xml-utils.ts) con la stessa regola.
 *
 * Regole:
 *  - CF persona fisica (16 caratteri): formato, mese, giorno e carattere di
 *    controllo. Omocodia ammessa: le cifre possono essere sostituite dalle
 *    lettere L M N P Q R S T U V nelle posizioni numeriche, e il carattere
 *    di controllo si calcola sul codice cosi' com'e' (lettere comprese).
 *  - CF numerico (11 cifre, societa'/enti) e partita IVA: stesso algoritmo
 *    di controllo (Luhn modificato dell'Agenzia delle Entrate).
 *
 * Il messaggio di errore e' in italiano e dice all'operatore cosa correggere:
 * finisce cosi' com'e' sotto il badge della fattura nel tab Fatture.
 */

// Valori dei caratteri in posizione DISPARI (1a, 3a, ... 15a) e PARI.
const DISPARI: Record<string, number> = {
  '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
}
const PARI: Record<string, number> = {
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9, K: 10, L: 11, M: 12,
  N: 13, O: 14, P: 15, Q: 16, R: 17, S: 18, T: 19, U: 20, V: 21, W: 22, X: 23, Y: 24, Z: 25,
}

// Omocodia: lettera che sostituisce la cifra (L=0, M=1, ... V=9).
const OMOCODIA = 'LMNPQRSTUV'
const MESI = 'ABCDEHLMPRST'

const FORMATO_CF = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/

// Forma piatta (non un'unione discriminata): le Netlify Functions girano
// senza strictNullChecks e li' il restringimento su `valido` non funziona.
// `motivo` e' sempre presente quando valido === false.
export type EsitoCodiceFiscale = {
  valido: boolean
  tipo: 'persona' | 'numerico' | null
  codice: string
  motivo?: string
  atteso?: string
}

export function normalizzaCodice(valore: string | null | undefined): string {
  return String(valore ?? '').toUpperCase().replace(/\s+/g, '')
}

/** Carattere di controllo atteso per i primi 15 caratteri di un CF. */
export function carattereControlloCF(primi15: string): string {
  const c = normalizzaCodice(primi15)
  let somma = 0
  for (let i = 0; i < 15; i++) {
    const ch = c[i]
    somma += (i % 2 === 0 ? DISPARI[ch] : PARI[ch]) ?? 0
  }
  return String.fromCharCode(65 + (somma % 26))
}

/** Riporta a cifre le posizioni numeriche di un CF omocodico. */
function deOmocodizza(cf: string): string {
  const posizioniNumeriche = [6, 7, 9, 10, 12, 13, 14]
  const lettere = cf.split('')
  for (const p of posizioniNumeriche) {
    const idx = OMOCODIA.indexOf(lettere[p])
    if (idx >= 0) lettere[p] = String(idx)
  }
  return lettere.join('')
}

/** Cifra di controllo (11a) di una partita IVA / CF numerico. */
function cifraControlloNumerico(primi10: string): number {
  let somma = 0
  for (let i = 0; i < 10; i++) {
    let n = Number(primi10[i])
    if (i % 2 === 1) {
      n *= 2
      if (n > 9) n -= 9
    }
    somma += n
  }
  return (10 - (somma % 10)) % 10
}

/** Partita IVA italiana (11 cifre, senza prefisso paese). */
export function validaPartitaIva(valore: string | null | undefined): EsitoCodiceFiscale {
  const codice = normalizzaCodice(valore)
  if (!/^\d{11}$/.test(codice)) {
    return {
      valido: false, tipo: 'numerico', codice,
      motivo: `Partita IVA "${codice || '(vuota)'}" non valida: deve essere di 11 cifre, senza prefisso IT.`,
    }
  }
  if (/^0{11}$/.test(codice)) {
    return { valido: false, tipo: 'numerico', codice, motivo: `Partita IVA "${codice}" non valida.` }
  }
  const attesa = cifraControlloNumerico(codice)
  if (Number(codice[10]) !== attesa) {
    return {
      valido: false, tipo: 'numerico', codice, atteso: String(attesa),
      motivo: `Partita IVA "${codice}" non valida: la cifra di controllo non torna (con le prime 10 cifre ` +
        `l'ultima sarebbe ${attesa}, non ${codice[10]}). Probabile errore di battitura: verifica il numero con il cliente.`,
    }
  }
  return { valido: true, tipo: 'numerico', codice }
}

/**
 * Codice fiscale: 16 caratteri (persona fisica, omocodia compresa) oppure
 * 11 cifre (societa', enti, associazioni).
 */
export function validaCodiceFiscale(valore: string | null | undefined): EsitoCodiceFiscale {
  const codice = normalizzaCodice(valore)

  if (/^\d{11}$/.test(codice)) {
    const esito = validaPartitaIva(codice)
    if (esito.valido) return esito
    return { ...esito, motivo: String(esito.motivo).replace(/^Partita IVA ("[^"]*") non valida/, 'Codice fiscale numerico $1 non valido') }
  }

  if (codice.length !== 16) {
    return {
      valido: false, tipo: null, codice,
      motivo: `Codice fiscale "${codice || '(vuoto)'}" non valido: deve avere 16 caratteri (persona) o 11 cifre (azienda), ne ha ${codice.length}.`,
    }
  }

  if (!FORMATO_CF.test(codice)) {
    return {
      valido: false, tipo: 'persona', codice,
      motivo: `Codice fiscale "${codice}" non valido: lettere e cifre non sono nelle posizioni previste. Ricontrollalo sul documento del cliente.`,
    }
  }

  const chiaro = deOmocodizza(codice)
  const giorno = Number(chiaro.substring(9, 11))
  if (!((giorno >= 1 && giorno <= 31) || (giorno >= 41 && giorno <= 71)) || MESI.indexOf(chiaro[8]) < 0) {
    return {
      valido: false, tipo: 'persona', codice,
      motivo: `Codice fiscale "${codice}" non valido: la data di nascita codificata non esiste. Ricontrollalo sul documento del cliente.`,
    }
  }

  const atteso = carattereControlloCF(codice.substring(0, 15))
  if (codice[15] !== atteso) {
    return {
      valido: false, tipo: 'persona', codice, atteso,
      motivo: `Codice fiscale "${codice}" non valido: il carattere di controllo non torna (con questi primi 15 caratteri ` +
        `l'ultimo sarebbe ${atteso}, non ${codice[15]}). L'errore puo' essere in uno qualsiasi dei 16 caratteri: ` +
        'verificalo sul documento del cliente, correggi l\'anagrafica e reinvia.',
    }
  }

  return { valido: true, tipo: 'persona', codice }
}
