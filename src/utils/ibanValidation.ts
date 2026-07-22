// =============================================================================
// Validazione IBAN — FASE 2 della specifica "Scadenza cauzione".
// Usata sia dalla scheda Cauzioni (blocco validazione salvataggio) sia dal cron
// (scelta variante A/B). Nessuna dipendenza esterna: MOD-97 fatto a mano.
// =============================================================================

// Lunghezza IBAN attesa per paese (i piu' comuni per DR7 + fallback).
const IBAN_LENGTHS: Record<string, number> = {
  IT: 27, SM: 27, FR: 27, MC: 27, DE: 22, ES: 24, CH: 21,
  GB: 22, PT: 25, NL: 18, BE: 16, AT: 20, LU: 20, IE: 22,
  FI: 18, GR: 27, PL: 28, SE: 24, DK: 18, NO: 15, MT: 31,
}

export interface IbanCheck {
  valid: boolean
  normalized: string            // senza spazi, maiuscolo
  country: string | null
  needsBic: boolean             // true se IBAN non italiano
  warning?: string              // paese non in tabella
  error?: string                // motivo del blocco salvataggio
}

/** Rimuove spazi e porta in maiuscolo (da fare prima di ogni controllo/salvataggio). */
export function normalizeIban(raw: string): string {
  return (raw || '').replace(/\s+/g, '').toUpperCase()
}

/** MOD-97 standard IBAN: sposta i primi 4 char in fondo, lettere->numeri, resto == 1. */
function mod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const code = ch >= 'A' && ch <= 'Z' ? (ch.charCodeAt(0) - 55).toString() : ch
    for (const d of code) {
      remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97
    }
  }
  return remainder
}

/** Valida un IBAN secondo le regole della spec (ordine: normalizza, forma, lunghezza, MOD-97). */
export function validateIban(raw: string): IbanCheck {
  const normalized = normalizeIban(raw)
  if (!normalized) return { valid: false, normalized, country: null, needsBic: false, error: 'IBAN mancante' }

  // Primi 2 lettere (paese), 3-4 cifre (check digit)
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(normalized)) {
    return { valid: false, normalized, country: null, needsBic: false, error: 'IBAN non valido — controlla i caratteri' }
  }
  const country = normalized.slice(0, 2)
  const needsBic = country !== 'IT'
  const expected = IBAN_LENGTHS[country]

  if (expected == null) {
    // Paese non in tabella: accetta 15–34 caratteri con avviso giallo.
    if (normalized.length < 15 || normalized.length > 34) {
      return { valid: false, normalized, country, needsBic, error: 'Lunghezza IBAN non valida' }
    }
    if (mod97(normalized) !== 1) {
      return { valid: false, normalized, country, needsBic, error: 'IBAN non valido — controlla i caratteri' }
    }
    return { valid: true, normalized, country, needsBic, warning: 'Paese non verificato' }
  }

  if (normalized.length !== expected) {
    return { valid: false, normalized, country, needsBic, error: `Lunghezza IBAN errata per ${country} (attesi ${expected} caratteri)` }
  }
  if (mod97(normalized) !== 1) {
    return { valid: false, normalized, country, needsBic, error: 'IBAN non valido — controlla i caratteri' }
  }
  return { valid: true, normalized, country, needsBic }
}

/** Formattazione a gruppi di 4 per la scheda (nel DB resta senza spazi). */
export function formatIbanGroups(raw: string): string {
  return normalizeIban(raw).replace(/(.{4})/g, '$1 ').trim()
}

/**
 * Maschera per liste/tabelle: mostra il paese + le ultime 4 cifre, il resto •.
 * Es. IT60X0542811101000000123456 -> "IT•• •••• •••• •••• •••• •••• 3456".
 */
export function maskIban(raw: string): string {
  const n = normalizeIban(raw)
  if (!n) return ''
  if (n.length <= 6) return n
  const last4 = n.slice(-4)
  const country = n.slice(0, 2)
  const hiddenLen = n.length - 2 - 4
  const hidden = '•'.repeat(Math.max(0, hiddenLen))
  return formatIbanGroups(country + hidden + last4)
}
