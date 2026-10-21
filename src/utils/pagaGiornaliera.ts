/**
 * 21/10/2026 — Compenso a GIORNATA (paga giornaliera).
 *
 * Il contratto operatore ha gia' stipendio (mensile/settimanale) e paga oraria.
 * Con stipendio_frequenza = 'giornaliera' l'importo in stipendio_mensile_eur
 * (nome storico della colonna) e' la tariffa di UNA giornata.
 *
 * Regola direzione: giornata timbrata (entrata E uscita) = giornata pagata
 * INTERA, anche se corta. Niente decurtazione per ore a recuperare; gli
 * straordinari, se attivi nel contratto, si aggiungono come per gli altri.
 *
 * Fonte unica per Calcola Paga (scheda operatore), Buste Paga e Costi
 * personale del Report Operatori: i tre schermi devono dare lo stesso numero.
 */

export type FrequenzaStipendio = 'mensile' | 'settimanale' | 'giornaliera'

export const OPZIONI_FREQUENZA: { value: FrequenzaStipendio; label: string }[] = [
  { value: 'mensile', label: 'Mensile' },
  { value: 'settimanale', label: 'Settimanale' },
  { value: 'giornaliera', label: 'Giornaliera' },
]

export function normalizzaFrequenza(v: unknown): FrequenzaStipendio {
  return v === 'settimanale' || v === 'giornaliera' ? v : 'mensile'
}

/** "/mese", "/sett.", "/giorno" — per etichette e importi. */
export function suffissoFrequenza(v: unknown): string {
  const f = normalizzaFrequenza(v)
  return f === 'giornaliera' ? '/giorno' : f === 'settimanale' ? '/sett.' : '/mese'
}

/** Tariffa di una giornata, 0 se il contratto non e' a giornata. */
export function tariffaGiornaliera(contratto: { stipendio_frequenza?: string | null; stipendio_mensile_eur?: number | string | null } | null | undefined): number {
  if (!contratto || contratto.stipendio_frequenza !== 'giornaliera') return 0
  const t = Number(contratto.stipendio_mensile_eur || 0)
  return t > 0 ? t : 0
}

/** Giornate pagate: quelle con minuti lavorati (entrata e uscita timbrate). */
export function contaGiornatePagate(minutiPerGiorno: Iterable<number>): number {
  let n = 0
  for (const m of minutiPerGiorno) if (m > 0) n++
  return n
}
