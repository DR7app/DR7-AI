/**
 * 14/10/2026 — quanto di una penale/danno e' gia' stato fatturato.
 *
 * Prima una penale si fatturava solo quando era pagata per intero. Ora si puo'
 * fatturare prima del pagamento (es. fattura da mandare all'avvocato del
 * cliente) o solo una parte (fattura parziale). Ogni fattura emessa su una voce
 * resta scritta sulla voce stessa in booking_details:
 *
 *   importoFatturato: somma in € (prezzo finale, IVA inclusa) gia' fatturata
 *   fattureEmesse:    [{ id, numero, importo }] in ordine di emissione
 *
 * Chi fattura al saldo deve fatturare SOLO `daFatturare(voce)`, mai di nuovo
 * il totale: altrimenti la stessa penale finisce su due fatture.
 *
 * Quando la voce viene pagata, il trigger `trg_fatture_voci_pagate` segna
 * "pagata" le fatture collegate, nell'ordine in cui sono state emesse.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Voce = any

const arrotonda = (n: number) => Math.round(n * 100) / 100

/** Prezzo finale della voce: listino meno lo sconto ("Prezzo finale desiderato"). */
export function nettoVoce(voce: Voce): number {
  const totale = Number(voce?.total) || (Number(voce?.amount) || 0) * (Number(voce?.quantity) || 1)
  return Math.max(0, arrotonda(totale - (Number(voce?.discount) || 0)))
}

export function giaFatturato(voce: Voce): number {
  return Math.max(0, Number(voce?.importoFatturato) || 0)
}

/** Quanto resta ancora da mettere in fattura per questa voce. */
export function daFatturare(voce: Voce): number {
  return Math.max(0, arrotonda(nettoVoce(voce) - giaFatturato(voce)))
}
