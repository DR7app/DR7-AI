// Operatori che, pur avendo permessi ampi, devono vedere SOLO i propri dati
// nei report/paghe (ore, produttivita', busta paga, straordinari) e mai quelli
// degli altri. Es. Salvatore (autista/direzione) + i lavaggisti.
// Unica fonte di verita': usata da OperatoriReportDashboardV2 (Report Orari) e
// PayrollPeriodoView (Buste Paga) per applicare lo stesso scope "solo mio".
export const REPORT_RESTRICTED_EMAILS = new Set<string>([
  'salvatore@dr7.app',
  'alessiocasula@dr7.app',
  'alekskiszka@dr7.app',
])

export function isReportRestrictedToOwn(email: string | null | undefined): boolean {
  return REPORT_RESTRICTED_EMAILS.has((email || '').toLowerCase())
}
