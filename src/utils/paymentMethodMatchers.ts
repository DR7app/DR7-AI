/**
 * Robust matchers for payment-method strings.
 *
 * The payment-method dropdown is now driven by Centralina Pro > Fiscale,
 * so the LABEL the admin saves on a row is what ends up in
 * `booking.payment_method`. Different defaults / renames produce different
 * strings:
 *
 *   - "Nexi - Pay by Link"   (default from usePaymentMethods)
 *   - "Nexi Pay by Link"     (legacy, before centralization)
 *   - "Carta Punti"
 *   - "Carta Punti (richiede OTP)"
 *   - "Carta punti DR7" / "carta_punti" ...
 *
 * Strict `=== 'Nexi Pay by Link'` checks across the codebase silently fail
 * when the saved label differs by even a single character. These helpers
 * normalize (lowercase, strip punctuation) before substring-matching, so
 * renames in Centralina Pro never break business logic again.
 *
 * Incident 2026-05-13: a strict check skipped the entire carwash
 * pay-by-link send because the saved label was "Nexi - Pay by Link" but
 * the gate compared against "Nexi Pay by Link".
 */

function normalize(s: string | null | undefined): string {
  return (s || '').toString().toLowerCase().replace(/[\s\-_]+/g, ' ').trim()
}

export function isNexiPayByLink(paymentMethod: string | null | undefined): boolean {
  const n = normalize(paymentMethod)
  if (!n) return false
  // "nexi pay by link", "nexi paybylink", "pay by link nexi", "nexi link" — all accepted
  return n.includes('nexi') && (n.includes('pay by link') || n.includes('paybylink') || n.includes('link'))
}

export function isCartaPunti(paymentMethod: string | null | undefined): boolean {
  const n = normalize(paymentMethod)
  if (!n) return false
  if (n === 'carta punti' || n === 'cartapunti') return true
  return n.includes('carta') && (n.includes('punti') || n.includes('punt'))
}
