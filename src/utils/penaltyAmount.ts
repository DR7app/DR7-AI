// Importo EFFETTIVO (finale) di una voce penale/danno = quello che esce in
// FATTURA e che va SEMPRE mostrato nei report. DanniPenaliModal salva `discount`
// come differenza tra listino e "prezzo finale desiderato": il valore reale è
// listino − sconto. Usa SEMPRE questo helper quando aggreghi penali/danni in un
// report o KPI, cosi' non si ripete il bug del listino non scontato (es. 600
// invece di 450).
//
// NB: le funzioni Netlify (report-danni.ts, monthly-report.ts, dashboard-kpi.ts)
// hanno una copia inline della stessa formula (build separata, niente import da
// src/). Tenere le due allineate.
export interface PenaltyLike {
  total?: number | string | null
  amount?: number | string | null
  quantity?: number | string | null
  discount?: number | string | null
}

export function effectivePenaltyAmount(item: PenaltyLike | null | undefined): number {
  if (!item) return 0
  const gross = Number(item.total) || (Number(item.amount) || 0) * (Number(item.quantity) || 1)
  const discount = Number(item.discount) || 0
  return Math.max(0, gross - discount)
}
