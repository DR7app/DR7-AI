import { Handler, schedule } from '@netlify/functions'
import { reconcileWalletFatture } from './_reconcile-wallet-fatture'

/**
 * BACKSTOP schedulato — garantisce la fattura per OGNI ricarica Credit Wallet.
 *
 * La generazione fattura nella callback Nexi (nexi-callback.js ->
 * generate-invoice-from-booking, ramo wallet_purchase) e' non-bloccante: se
 * PDF/WhatsApp/SDI o la chiamata falliscono in modo transitorio, la ricarica
 * resta 'succeeded' ma SENZA fattura e senza alert (caso Massimo Runchina €1000).
 *
 * Questa cron, ogni 15 min, richiama reconcileWalletFatture() che ripesca le
 * ricariche pagate degli ultimi 14 giorni e (se manca fattura o PDF) rigenera
 * in modo IDEMPOTENTE: la fattura arriva SEMPRE, anche se il tentativo inline
 * fallisce. Logica condivisa in _reconcile-wallet-fatture (anche run-now HTTP).
 */
const reconcileHandler: Handler = async () => {
  console.log('[Wallet Fattura Cron] start')
  try {
    const result = await reconcileWalletFatture()
    console.log('[Wallet Fattura Cron] done', JSON.stringify(result))
    return { statusCode: 200, body: JSON.stringify(result) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Wallet Fattura Cron] fatal', msg)
    return { statusCode: 500, body: JSON.stringify({ error: msg }) }
  }
}

export const handler = schedule('*/15 * * * *', reconcileHandler)
