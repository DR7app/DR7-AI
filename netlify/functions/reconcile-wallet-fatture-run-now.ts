import { Handler } from '@netlify/functions'
import { reconcileWalletFatture, reconcileBookingFatture } from './_reconcile-wallet-fatture'

/**
 * Esecuzione MANUALE immediata della riconciliazione fatture (ricariche wallet
 * + prenotazioni pagate). Stessa logica della cron, ma su richiesta.
 * Idempotente: rigenera/backfilla solo gli incassi senza fattura.
 */
const handler: Handler = async () => {
  try {
    const wallet = await reconcileWalletFatture()
    const booking = await reconcileBookingFatture()
    return { statusCode: 200, body: JSON.stringify({ wallet, booking }) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { statusCode: 500, body: JSON.stringify({ error: msg }) }
  }
}

export { handler }
