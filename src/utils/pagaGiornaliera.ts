/**
 * 21/10/2026 — Compenso a GIORNATA (paga giornaliera).
 *
 * Il contratto operatore ha stipendio (mensile/settimanale), paga oraria e,
 * dal 21/10/2026, la sua casella: paga_giornaliera_eur = tariffa di UNA
 * giornata. Se e' impostata, la paga si calcola a giornate e ha la precedenza
 * su stipendio e paga oraria. (Prima versione dello stesso giorno: la tariffa
 * stava in stipendio_mensile_eur con stipendio_frequenza = 'giornaliera';
 * resta letta per compatibilita'.)
 *
 * Paga del periodo = giornate timbrate NEL PERIODO scelto x tariffa.
 *
 * Regola direzione: giornata timbrata (entrata E uscita) = giornata pagata
 * INTERA, anche se corta. Niente decurtazione per ore a recuperare; gli
 * straordinari, se attivi nel contratto, si aggiungono come per gli altri.
 *
 * Fonte unica per Calcola Paga (scheda operatore), Buste Paga e Costi
 * personale del Report Operatori: i tre schermi devono dare lo stesso numero.
 */

export type FrequenzaStipendio = 'mensile' | 'settimanale' | 'giornaliera'

/** Frequenza dello STIPENDIO: la paga giornaliera ha la sua casella. */
export const OPZIONI_FREQUENZA: { value: FrequenzaStipendio; label: string }[] = [
  { value: 'mensile', label: 'Mensile' },
  { value: 'settimanale', label: 'Settimanale' },
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
export function tariffaGiornaliera(contratto: { paga_giornaliera_eur?: number | string | null; stipendio_frequenza?: string | null; stipendio_mensile_eur?: number | string | null } | null | undefined): number {
  if (!contratto) return 0
  const dedicata = Number(contratto.paga_giornaliera_eur || 0)
  if (dedicata > 0) return dedicata
  if (contratto.stipendio_frequenza !== 'giornaliera') return 0
  const t = Number(contratto.stipendio_mensile_eur || 0)
  return t > 0 ? t : 0
}

/**
 * La colonna paga_giornaliera_eur esiste solo dopo la migrazione
 * 20261021_operatore_contratto_paga_giornaliera. Prima, scriverla rompe il
 * salvataggio di TUTTO il contratto: si manda solo se ha un valore o se la
 * riga letta ce l'aveva gia'.
 */
export function campoPagaGiornaliera(valore: number | null | undefined, rigaLetta: object | null | undefined): { paga_giornaliera_eur?: number | null } {
  const presente = !!rigaLetta && 'paga_giornaliera_eur' in rigaLetta
  if (valore != null || presente) return { paga_giornaliera_eur: valore ?? null }
  return {}
}

/** Giornate pagate: quelle con minuti lavorati (entrata e uscita timbrate). */
export function contaGiornatePagate(minutiPerGiorno: Iterable<number>): number {
  let n = 0
  for (const m of minutiPerGiorno) if (m > 0) n++
  return n
}
