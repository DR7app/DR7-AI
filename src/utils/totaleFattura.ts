/**
 * Totale di una fattura ricalcolato dalle RIGHE, con la stessa formula che
 * l'XML manda allo SDI (`netlify/functions/xml-utils.ts`: imponibile + imposta
 * per ogni aliquota). Se le due cifre non coincidono, quella giusta e' questa:
 * e' l'importo che il cliente ha davvero ricevuto.
 *
 * 19/09/2026: due fatture comparivano a 0,00 EUR nella tab Fattura pur essendo
 * partite con gli importi corretti. La tab (e il PDF) leggono la colonna
 * `importo_totale`; l'XML per lo SDI invece RICALCOLA sempre dalle righe. Con
 * la colonna a 0 o vuota il documento era giusto e la lista sbagliata.
 */

export type RigaFattura = {
  unit_price?: number | null
  quantity?: number | null
  vat_rate?: number | null
  total?: number | null
}

/** Le righe arrivano dal DB come array JSON o, su righe vecchie, come stringa. */
export function righeFattura(items: unknown): RigaFattura[] {
  if (Array.isArray(items)) return items as RigaFattura[]
  if (typeof items === 'string') {
    try {
      const parsed = JSON.parse(items)
      return Array.isArray(parsed) ? parsed as RigaFattura[] : []
    } catch { return [] }
  }
  return []
}

/** Somma delle righe, IVA inclusa. Arrotondata ai centesimi come nell'XML. */
export function totaleDaRighe(items: unknown): number {
  const righe = righeFattura(items)
  if (righe.length === 0) return 0
  let totale = 0
  for (const r of righe) {
    const prezzo = Number(r.unit_price) || 0
    const qta = Number(r.quantity)
    const imponibile = prezzo * (Number.isFinite(qta) && qta !== 0 ? qta : 1)
    const aliquota = Number(r.vat_rate) || 0
    totale += imponibile + imponibile * (aliquota / 100)
  }
  return Math.round(totale * 100) / 100
}
