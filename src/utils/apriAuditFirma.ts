import { authFetch } from './authFetch'

/**
 * Apre l'audit trail di firma (signature-audit, format=html) in una nuova
 * scheda. 25/09/2026: la funzione e' riservata allo staff e vuole il token,
 * che un semplice window.open(url) non manda. La scheda si apre subito (i
 * browser bloccano le finestre aperte dopo un'attesa) e riceve la pagina
 * appena arriva.
 */
export async function apriAuditFirma(chiave: { contractId?: string | null; requestId?: string | null }): Promise<void> {
  const qs = chiave.contractId
    ? `contractId=${encodeURIComponent(chiave.contractId)}`
    : `requestId=${encodeURIComponent(chiave.requestId || '')}`
  const scheda = window.open('', '_blank')
  if (scheda) scheda.document.write('<p style="font-family:system-ui;padding:24px">Caricamento audit trail...</p>')
  try {
    const res = await authFetch(`/.netlify/functions/signature-audit?${qs}&format=html`)
    const testo = await res.text()
    if (!res.ok) {
      let errore = 'Audit trail non disponibile'
      try { errore = JSON.parse(testo).error || errore } catch { /* testo semplice */ }
      throw new Error(errore)
    }
    const url = URL.createObjectURL(new Blob([testo], { type: 'text/html' }))
    if (scheda) scheda.location.href = url
    else window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (err) {
    if (scheda) scheda.close()
    throw err
  }
}
