import { isContanti } from './paymentMethodMatchers'

/** Valore storico, scritto in duro fino al 19/09/2026. */
export const MAGGIORAZIONE_CONTANTI_DEFAULT = 20

type Automations = { contanti_surcharge_pct?: number | '' | null } | null | undefined

/**
 * Percentuale di maggiorazione sui pagamenti in contanti, da
 * Centralina Pro > Automazioni. Senza configurazione resta il 20% storico.
 */
export function percentualeContanti(automations: Automations): number {
  const v = automations?.contanti_surcharge_pct
  if (typeof v === 'number' && v >= 0 && v <= 100) return v
  return MAGGIORAZIONE_CONTANTI_DEFAULT
}

/**
 * Totale con la maggiorazione contanti applicata, quando il metodo di
 * pagamento e' contanti. Unica funzione: prenotazione, preventivo e
 * conversione preventivo -> prenotazione devono dare lo stesso numero.
 *
 * 19/09/2026 (direzione): il +20% viveva solo dentro ReservationsTab. Un
 * preventivo accettato in contanti nasceva senza maggiorazione, mentre la
 * stessa prenotazione creata a mano la prendeva: due prezzi per lo stesso
 * noleggio.
 */
export function totaleConContanti(
  subtotaleEur: number,
  paymentMethod: string | null | undefined,
  pct: number,
): number {
  if (!isContanti(paymentMethod) || !(pct > 0)) return subtotaleEur
  return Math.round(subtotaleEur * (1 + pct / 100) * 100) / 100
}
