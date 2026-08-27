/**
 * Totali del Report Noleggio, in un posto solo.
 *
 * 2026-08-27 (richiesta direzione): il Dashboard mostrava un Noleggio Terra
 * piu' basso del Report Terra. Due cause:
 *   1. leggeva solo `totalRevenue`, buttando via anticipato e da saldare —
 *      cioe' proprio le due voci che compongono il "Totale Complessivo";
 *   2. non applicava le correzioni manuali (`report_overrides`), che il Report
 *      applica PRIMA di sommare i totali.
 *
 * Questo modulo e' la matematica di quei totali, senza React e senza Supabase:
 * lo usano sia `ReportsTab.tsx` (browser) sia `dashboard-kpi.ts` (Netlify), cosi'
 * i due schermi non possono piu' divergere. Se la regola cambia, cambia qui.
 */

/** Campi correggibili sulla riga-prenotazione dentro un veicolo. */
export const BOOKING_EDIT_FIELD_KEYS = ['total_price', 'penalty_amount', 'danni_amount', 'da_saldare'] as const

/** Gli override gia' indicizzati (stessa forma di `loadReportOverrides`). */
export interface OverrideIndex {
  removed: Set<string>
  /** chiave `${row_key}::${field}` -> valore */
  edits: Map<string, number>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  added: Array<{ id: string; row: any; note: string | null }>
  notesByRow: Map<string, string>
}

export const EMPTY_OVERRIDES: OverrideIndex = {
  removed: new Set(),
  edits: new Map(),
  added: [],
  notesByRow: new Map(),
}

/**
 * Chiave di periodo degli override: il MESE della data di inizio.
 * La direzione ragiona per mese ("il report di agosto"), e i preset relativi
 * ("ultimi 30 giorni") cambiano intervallo ogni giorno — vedi il commento
 * esteso in ReportsTab.handleSaveRowEdit.
 */
export function periodKeyOf(from: string | null | undefined): string {
  return String(from || '').slice(0, 7) || 'all'
}

/**
 * Quota del mese di una prenotazione: il backend prorata il noleggio sui giorni
 * che cadono nel periodo, non sul `total_price` intero.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function quotaMese(b: any): number {
  const tot = Number(b?.total_price) || 0
  const gg = Number(b?.billable_days) || 0
  if (gg <= 0) return tot
  return (tot / gg) * Math.min(Number(b?.days_in_month) || 0, gg)
}

const round2 = (n: number) => Math.round(n * 100) / 100

export interface VehicleReportTotals {
  totalRentalRevenue: number
  totalPenaltyRevenue: number
  totalDanniRevenue: number
  totalDaSaldare: number
  totalAnticipatedRevenue: number
  /** Noleggio + penali + danni, come la card "Ricavo TOTALE" al netto dell'anticipato. */
  totalRevenue: number
  /** Card "Ricavo TOTALE" del Report: incassato + anticipato. */
  ricavoTotale: number
  /** Card "Totale Complessivo" del Report: incassato + anticipato + da saldare. */
  totaleComplessivo: number
}

/**
 * Applica gli override alle righe-veicolo e risomma i totali.
 *
 * Le correzioni per CLIENTE si applicano come DELTA e non come ricalcolo: i
 * totali del veicolo arrivano dal backend con formule loro (prorata sui giorni
 * del mese), quindi risommare le righe darebbe numeri diversi da oggi anche
 * senza nessuna correzione. Sommando la sola differenza introdotta, un report
 * senza correzioni resta identico e una correzione si propaga fino ai KPI.
 */
export function adjustVehicleReport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  baseVehicles: any[],
  ov: OverrideIndex,
  periodKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { vehicles: any[]; totals: VehicleReportTotals } {
  // 1. rimozioni + correzioni sulla riga-veicolo + righe aggiunte a mano
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adjusted: any[] = []
  for (const v of baseVehicles) {
    const key = `${periodKey}|${v.vehicleId}`
    if (ov.removed.has(key)) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const copy: any = { ...v }
    for (const [k, val] of ov.edits) {
      const sep = k.indexOf('::')
      if (sep < 0) continue
      if (k.slice(0, sep) === key) copy[k.slice(sep + 2)] = val
    }
    copy._overrideNote = ov.notesByRow.get(key) || null
    adjusted.push(copy)
  }
  for (const a of ov.added) {
    adjusted.push({ ...a.row, _overrideNote: a.note, _isManual: true, _manualId: a.id })
  }

  // 2. correzioni per CLIENTE, applicate come delta sul veicolo
  adjusted = adjusted.map((v) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base = Array.isArray(v.bookings) ? (v.bookings as any[]) : []
    if (base.length === 0) return v
    let dRental = 0, dPen = 0, dDan = 0, dSaldo = 0
    const bookings = base.map((b) => {
      const bKey = `${periodKey}|b|${b.booking_id}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const copy: any = { ...b }
      let touched = false
      for (const f of BOOKING_EDIT_FIELD_KEYS) {
        const e = ov.edits.get(`${bKey}::${f}`)
        if (e != null) { copy[f] = e; touched = true }
      }
      if (!touched) return b
      dRental += quotaMese(copy) - quotaMese(b)
      dPen += (Number(copy.penalty_amount) || 0) - (Number(b.penalty_amount) || 0)
      dDan += (Number(copy.danni_amount) || 0) - (Number(b.danni_amount) || 0)
      dSaldo += (Number(copy.da_saldare) || 0) - (Number(b.da_saldare) || 0)
      copy._overrideNote = ov.notesByRow.get(bKey) || null
      copy._edited = true
      return copy
    })
    // Una correzione fatta a mano sul veicolo vince su quella per cliente: se
    // la direzione ha scritto il totale del veicolo, non glielo si sposta
    // sotto i piedi.
    const fissato = (campo: string) => ov.edits.has(`${periodKey}|${v.vehicleId}::${campo}`)
    return {
      ...v,
      bookings,
      rentalRevenue: fissato('rentalRevenue') ? v.rentalRevenue : (Number(v.rentalRevenue) || 0) + dRental,
      penaltyRevenue: fissato('penaltyRevenue') ? v.penaltyRevenue : (Number(v.penaltyRevenue) || 0) + dPen,
      danniRevenue: fissato('danniRevenue') ? v.danniRevenue : (Number(v.danniRevenue) || 0) + dDan,
      daSaldareRevenue: fissato('daSaldareRevenue') ? v.daSaldareRevenue : (Number(v.daSaldareRevenue) || 0) + dSaldo,
    }
  })

  // 3. totalRevenue di riga = noleggio + penali + danni, salvo sovrascrittura diretta
  adjusted = adjusted.map((v) => {
    const totOverridden = ov.edits.has(`${periodKey}|${v.vehicleId}::totalRevenue`)
    const totalRevenue = totOverridden
      ? Number(v.totalRevenue) || 0
      : (Number(v.rentalRevenue) || 0) + (Number(v.penaltyRevenue) || 0) + (Number(v.danniRevenue) || 0)
    return { ...v, totalRevenue }
  })

  // Le righe aggiunte a mano valgono solo per il periodo in cui sono nate.
  adjusted = adjusted.filter((v) => !v._isManual || v.period === periodKey)

  const somma = (campo: string) => round2(adjusted.reduce((t: number, v) => t + (Number(v[campo]) || 0), 0))
  const totalRevenue = somma('totalRevenue')
  const totalAnticipatedRevenue = somma('anticipatedRevenue')
  const totalDaSaldare = somma('daSaldareRevenue')

  return {
    vehicles: adjusted,
    totals: {
      totalRentalRevenue: somma('rentalRevenue'),
      totalPenaltyRevenue: somma('penaltyRevenue'),
      totalDanniRevenue: somma('danniRevenue'),
      totalDaSaldare,
      totalAnticipatedRevenue,
      totalRevenue,
      ricavoTotale: round2(totalRevenue + totalAnticipatedRevenue),
      totaleComplessivo: round2(totalRevenue + totalAnticipatedRevenue + totalDaSaldare),
    },
  }
}

/**
 * Stessa cosa per il Report Lavaggi: le voci per tipo servizio si correggono,
 * i totali si risommano sulle righe corrette.
 */
export function adjustWashReport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  baseTypes: any[],
  ov: OverrideIndex,
  periodKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { byType: any[]; washRevenue: number; billableWashesCount: number } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = []
  for (const t of baseTypes) {
    const key = `${periodKey}|${t.type}`
    if (ov.removed.has(key)) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const copy: any = { ...t }
    for (const [k, val] of ov.edits) {
      const sep = k.indexOf('::')
      if (sep < 0) continue
      if (k.slice(0, sep) === key) copy[k.slice(sep + 2)] = val
    }
    copy._overrideNote = ov.notesByRow.get(key) || null
    out.push(copy)
  }
  for (const a of ov.added) {
    out.push({ ...a.row, _overrideNote: a.note, _isManual: true, _manualId: a.id })
  }
  const filtered = out.filter((t) => !t._isManual || t.period === periodKey)
  return {
    byType: filtered,
    washRevenue: round2(filtered.reduce((s, t) => s + (Number(t.revenue) || 0), 0)),
    billableWashesCount: filtered.reduce((s, t) => s + (Number(t.count) || 0), 0),
  }
}

/** Scope degli override per business: uno per business, altrimenti Mare finisce in Terra. */
export function overrideScopeFor(business: string): string {
  return business === 'rental' ? 'noleggio' : `noleggio_${business}`
}
