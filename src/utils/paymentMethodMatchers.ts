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

/**
 * Pagamenti che NON producono mai una fattura: Credit Wallet, credito, gift
 * card. L'IVA e' gia' stata assolta al momento della ricarica del wallet, per
 * cui l'utilizzo non si fattura una seconda volta.
 *
 * 2026-08-17: stessa lista di varianti gia' usata lato server in
 * generate-invoice-from-booking.ts, portata qui perche' anche la UI deve
 * saperlo — chiedeva i dati di fatturazione (CF, indirizzo, citta', CAP) su
 * prenotazioni che una fattura non l'avranno mai.
 */
export function isWalletOrGift(paymentMethod: string | null | undefined): boolean {
  const n = normalize(paymentMethod)
  if (!n) return false
  return n === 'credit' || n.includes('wallet') || n.includes('gift')
}

/**
 * Pagamento fatto col CREDIT WALLET del cliente, cioe' col saldo di
 * `user_credit_balance`. E' la condizione che fa scattare l'addebito
 * automatico sul wallet (trigger `trg_dr7_wallet_sync_prenotazione`,
 * migrazione 20260915000000): la stessa regola e' scritta in SQL nella
 * funzione `dr7_metodo_e_credit_wallet` — se cambia una, cambia anche l'altra.
 *
 * Differenza voluta rispetto a isWalletOrGift: la GIFT CARD resta fuori. In
 * DR7 e' un codice sconto (DiscountCodeGeneratorModal, code_type 'gift_card'),
 * non credito del wallet: addebitarla al saldo prenderebbe soldi veri.
 *
 * L'ordine dei controlli conta: "Carta di Credito" contiene "credito" ma e'
 * una carta, e deve uscire prima che si guardi quella parola.
 */
export function isCreditWallet(paymentMethod: string | null | undefined): boolean {
  const n = normalize(paymentMethod)
  if (!n) return false
  if (n.includes('gift')) return false
  if (n.includes('wallet')) return true
  if (n.includes('carta') || n.includes('card')) return false
  return n.includes('credit') || n.includes('credito') || n.includes('crediti')
}

export function isCartaPunti(paymentMethod: string | null | undefined): boolean {
  const n = normalize(paymentMethod)
  if (!n) return false
  if (n === 'carta punti' || n === 'cartapunti') return true
  return n.includes('carta') && (n.includes('punti') || n.includes('punt'))
}
