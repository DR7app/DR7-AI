/**
 * Penali e danni REALI di un cliente.
 *
 * Perche' esiste: il 04/09/2026 la scheda cliente e il Report Clienti davano
 * cifre gonfiate. Caso Luca Pilloni — pratica unica da 5.000 EUR (danno
 * paraurti 2.414,05 + fermo tecnico 2.585,95), Report Clienti mostrava
 * 15.171,90 di penali+danni. Tre cause, tutte qui dentro:
 *
 *  1. LE NOTE DI CREDITO CONTAVANO IN POSITIVO. generate-nota-di-credito
 *     copia la fattura originale con lo STESSO importo positivo e gli STESSI
 *     items: chi sommava tutte le righe di `fatture` contava due volte quello
 *     che invece si annulla. Qui si scartano la nota di credito E la fattura
 *     che annulla (related_invoice_id), oltre alle fatture 'cancelled'.
 *  2. L'INTERO IMPORTO DELLA FATTURA FINIVA IN UNA SOLA CATEGORIA. Una
 *     fattura mista (penale + danno) veniva classificata "danni" e sommata
 *     per intero: 5.000 di danni invece di 2.414,05. Qui si somma PER ITEM.
 *  3. STESSA PENALE CONTATA DUE VOLTE: una da booking_details, una dalla sua
 *     fattura. Qui si prende il maggiore tra le due fonti, come fa gia'
 *     monthly-report (Report Noleggio).
 *
 * Copia gemella lato server in netlify/functions/utils/addebitiCliente.ts
 * (build separate, niente import da src/). Se cambia una, cambia l'altra.
 */

export interface VoceAddebito {
  total?: number | string | null
  amount?: number | string | null
  quantity?: number | string | null
  discount?: number | string | null
  amountPaid?: number | string | null
  paymentStatus?: string | null
}

export interface RigaFatturaAddebito {
  id: string
  booking_id?: string | null
  importo_totale?: number | string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items?: any[] | null
  tipo_fattura?: string | null
  stato?: string | null
  related_invoice_id?: string | null
}

export interface Addebiti {
  penali: number
  danni: number
  eventiPenali: number
  eventiDanni: number
}

const TIPI_NOTA_DI_CREDITO = ['nota_di_credito', 'nota_credito', 'td04']

const num = (v: unknown): number => Number(v) || 0
const round2 = (n: number): number => Math.round(n * 100) / 100

/** Importo effettivo di una voce: listino meno lo sconto (vedi penaltyAmount.ts). */
export function importoVoce(v: VoceAddebito | null | undefined): number {
  if (!v) return 0
  const listino = num(v.total) || num(v.amount) * (num(v.quantity) || 1)
  return Math.max(0, listino - num(v.discount))
}

export function isNotaDiCredito(f: RigaFatturaAddebito): boolean {
  return TIPI_NOTA_DI_CREDITO.includes(String(f.tipo_fattura || '').trim().toLowerCase())
}

/**
 * Le fatture che NON rappresentano denaro: le note di credito e le fatture che
 * queste annullano, piu' le fatture gia' annullate.
 */
export function fattureDaIgnorare(fatture: RigaFatturaAddebito[]): Set<string> {
  const fuori = new Set<string>()
  for (const f of fatture) {
    if (String(f.stato || '').toLowerCase() === 'cancelled') fuori.add(f.id)
    if (!isNotaDiCredito(f)) continue
    fuori.add(f.id)
    if (f.related_invoice_id) fuori.add(f.related_invoice_id)
  }
  return fuori
}

/**
 * Penali e danni di UNA fattura, sommati per singolo item. La riga "Sconto"
 * (negativa, scritta da generate-penalty-invoice) si sottrae: prima dai penali,
 * poi dai danni — stesso ordine di monthly-report.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function addebitiFattura(items: any[] | null | undefined): { penali: number; danni: number; vociPenali: number; vociDanni: number } {
  let penali = 0, danni = 0, sconto = 0, vociPenali = 0, vociDanni = 0
  for (const i of (items || [])) {
    const desc = String(i?.description || '')
    const importo = num(i?.amountPaid ?? i?.total)
    if (/sconto|discount/i.test(desc)) { sconto += Math.abs(importo); continue }
    if (importo <= 0) continue
    if (/penal/i.test(desc)) { penali += importo; vociPenali++ }
    else if (/dann/i.test(desc)) { danni += importo; vociDanni++ }
  }
  if (sconto > 0) {
    const daPenali = Math.min(penali, sconto)
    penali -= daPenali
    danni = Math.max(0, danni - (sconto - daPenali))
  }
  return { penali: round2(penali), danni: round2(danni), vociPenali, vociDanni }
}

/** Somma delle voci di booking_details.penalties / booking_details.danni. */
export function addebitiDettagli(lista: unknown): { totale: number; eventi: number } {
  if (!Array.isArray(lista)) return { totale: 0, eventi: 0 }
  let totale = 0, eventi = 0
  for (const voce of lista) {
    const importo = importoVoce(voce as VoceAddebito)
    if (importo <= 0) continue
    totale += importo
    eventi++
  }
  return { totale: round2(totale), eventi }
}

/**
 * Penali e danni per prenotazione, da entrambe le fonti senza doppioni.
 * `bookings` serve solo per booking_details; `fatture` puo' contenere anche
 * righe di altre prenotazioni (si filtrano da sole tramite booking_id).
 */
export function penaliDanniPerPrenotazione(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bookings: { id: string; booking_details?: any }[],
  fatture: RigaFatturaAddebito[],
): Map<string, Addebiti> {
  const fuori = fattureDaIgnorare(fatture)
  const daFatture = new Map<string, Addebiti>()
  for (const f of fatture) {
    if (!f.booking_id || fuori.has(f.id)) continue
    const { penali, danni, vociPenali, vociDanni } = addebitiFattura(f.items)
    if (penali <= 0 && danni <= 0) continue
    const acc = daFatture.get(f.booking_id) || { penali: 0, danni: 0, eventiPenali: 0, eventiDanni: 0 }
    acc.penali += penali
    acc.danni += danni
    acc.eventiPenali += vociPenali
    acc.eventiDanni += vociDanni
    daFatture.set(f.booking_id, acc)
  }

  const out = new Map<string, Addebiti>()
  const idsPrenotazioni = new Set<string>([...bookings.map(b => b.id), ...daFatture.keys()])
  const dettagliPerId = new Map(bookings.map(b => [b.id, b.booking_details || {}]))

  for (const id of idsPrenotazioni) {
    const dettagli = dettagliPerId.get(id) || {}
    // booking_details.penalties e' in INGLESE, booking_details.danni in italiano.
    const pDett = addebitiDettagli(dettagli.penalties)
    const dDett = addebitiDettagli(dettagli.danni)
    const fatt = daFatture.get(id) || { penali: 0, danni: 0, eventiPenali: 0, eventiDanni: 0 }
    const penali = Math.max(pDett.totale, fatt.penali)
    const danni = Math.max(dDett.totale, fatt.danni)
    if (penali <= 0 && danni <= 0) continue
    out.set(id, {
      penali: round2(penali),
      danni: round2(danni),
      eventiPenali: penali > 0 ? Math.max(pDett.eventi, fatt.eventiPenali, 1) : 0,
      eventiDanni: danni > 0 ? Math.max(dDett.eventi, fatt.eventiDanni, 1) : 0,
    })
  }
  return out
}

/** Somma di piu' prenotazioni in un unico totale cliente. */
export function sommaAddebiti(valori: Iterable<Addebiti>): Addebiti {
  const tot: Addebiti = { penali: 0, danni: 0, eventiPenali: 0, eventiDanni: 0 }
  for (const v of valori) {
    tot.penali += v.penali
    tot.danni += v.danni
    tot.eventiPenali += v.eventiPenali
    tot.eventiDanni += v.eventiDanni
  }
  tot.penali = round2(tot.penali)
  tot.danni = round2(tot.danni)
  return tot
}
