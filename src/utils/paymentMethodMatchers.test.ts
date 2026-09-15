import { describe, it, expect } from 'vitest'
import { isCreditWallet, isWalletOrGift, isNexiPayByLink, isCartaPunti } from './paymentMethodMatchers'

/**
 * isCreditWallet decide se una prenotazione preleva denaro dal saldo del
 * cliente. Un falso positivo su "Carta di Credito" o "Gift Card" svuoterebbe
 * un wallet vero per un pagamento che col wallet non c'entra: le etichette
 * qui sotto sono quelle che la Centralina Pro puo' davvero produrre.
 *
 * La stessa tabella vale per la funzione SQL `dr7_metodo_e_credit_wallet`
 * (migrazione 20260915000000), provata da `npm run wallet:verifica`.
 */
describe('isCreditWallet', () => {
  it('riconosce tutte le scritture del Credit Wallet', () => {
    for (const m of ['Credit Wallet', 'credit_wallet', 'CREDIT WALLET', 'Wallet', 'wallet',
                     'credit', 'Credito', 'Wallet DR7', 'credito-wallet']) {
      expect(isCreditWallet(m), m).toBe(true)
    }
  })

  it('non confonde le carte col credito del wallet', () => {
    for (const m of ['Carta di Credito', 'carta di credito', 'Carta Punti', 'Carta',
                     'Credit Card', 'Contanti', 'Bonifico', 'Nexi - Pay by Link',
                     'Satispay', '', null, undefined]) {
      expect(isCreditWallet(m), String(m)).toBe(false)
    }
  })

  it('lascia fuori la gift card: e un codice sconto, non il saldo del cliente', () => {
    for (const m of ['Gift Card', 'gift_card', 'giftcard', 'Gift Card DR7']) {
      expect(isCreditWallet(m), m).toBe(false)
      // isWalletOrGift invece la comprende: serve a saltare la fattura, non ad addebitare.
      expect(isWalletOrGift(m), m).toBe(true)
    }
  })

  it('non tocca gli altri matcher', () => {
    expect(isNexiPayByLink('Nexi - Pay by Link')).toBe(true)
    expect(isCreditWallet('Nexi - Pay by Link')).toBe(false)
    expect(isCartaPunti('Carta Punti')).toBe(true)
    expect(isCreditWallet('Carta Punti')).toBe(false)
  })
})
