/**
 * HTTP endpoint to manually refresh SDI statuses NOW for all pending fatture.
 * Used by FatturaTab on mount + on user "Aggiorna stati SDI" click.
 *
 * The same polling logic also runs on a cron — see check-sdi-statuses-cron.ts.
 */
import type { Handler } from '@netlify/functions'
import { pollAllPendingSdi } from './_check-sdi-statuses'

export const handler: Handler = async () => {
    try {
        const result = await pollAllPendingSdi()
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result),
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: msg }),
        }
    }
}
