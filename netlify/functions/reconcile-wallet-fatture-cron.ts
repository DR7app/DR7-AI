import { Handler, schedule } from '@netlify/functions'
import { reconcileWalletFatture, reconcileBookingFatture } from './_reconcile-wallet-fatture'

/**
 * BACKSTOP schedulato — garantisce la fattura per OGNI ricarica Credit Wallet
 * E per OGNI prenotazione pagata dal sito.
 *
 * La generazione fattura nella callback Nexi (nexi-callback.js ->
 * generate-invoice-from-booking, rami wallet_purchase e booking) e'
 * non-bloccante: se PDF/WhatsApp/SDI o la chiamata falliscono in modo
 * transitorio, l'incasso resta registrato ma SENZA fattura e senza alert
 * (caso Massimo Runchina €1000).
 *
 * Ogni 15 min questa cron ripesca ricariche e prenotazioni pagate degli ultimi
 * 14 giorni e (se manca la fattura) rigenera in modo IDEMPOTENTE: la fattura
 * arriva SEMPRE, anche se il tentativo inline fallisce. Logica condivisa in
 * _reconcile-wallet-fatture (anche endpoint run-now HTTP).
 */
const reconcileHandler: Handler = async () => {
  console.log('[Fatture Cron] start')
  try {
    const wallet = await reconcileWalletFatture()
    const booking = await reconcileBookingFatture()
    const result = { wallet, booking }
    console.log('[Fatture Cron] done', JSON.stringify(result))
    return { statusCode: 200, body: JSON.stringify(result) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Fatture Cron] fatal', msg)
    return { statusCode: 500, body: JSON.stringify({ error: msg }) }
  }
}

export const handler = schedule('*/15 * * * *', reconcileHandler)
