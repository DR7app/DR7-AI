import { Handler } from '@netlify/functions'
import { reconcileWalletFatture } from './_reconcile-wallet-fatture'

/**
 * Esecuzione MANUALE immediata della riconciliazione fatture ricariche wallet
 * (stessa logica della cron reconcile-wallet-fatture-cron, ma su richiesta).
 * Idempotente: rigenera/backfilla solo le ricariche pagate senza fattura/PDF.
 */
const handler: Handler = async () => {
  try {
    const result = await reconcileWalletFatture()
    return { statusCode: 200, body: JSON.stringify(result) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { statusCode: 500, body: JSON.stringify({ error: msg }) }
  }
}

export { handler }
