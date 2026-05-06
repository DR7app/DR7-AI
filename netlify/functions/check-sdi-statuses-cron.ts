import { Handler, schedule } from '@netlify/functions'
import { pollAllPendingSdi } from './_check-sdi-statuses'

/**
 * Scheduled SDI status check.
 * Polls Aruba for every fattura in sdi_status ('sending','sent') and
 * transitions them to accepted / rejected / error / sent.
 *
 * Schedule: every 30 min (was 2h — too slow, scartate alerts only landed
 * hours after Aruba flagged them).
 *
 * Same logic is exposed as HTTP at /.netlify/functions/check-sdi-statuses
 * so FatturaTab can refresh on mount + on user click without waiting.
 */
const statusCheckHandler: Handler = async () => {
    console.log('[SDI Cron] Starting scheduled SDI status check...')
    try {
        const result = await pollAllPendingSdi()
        console.log('[SDI Cron] Done.', result)
        return { statusCode: 200, body: JSON.stringify(result) }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[SDI Cron] Fatal error:', msg)
        return { statusCode: 500, body: JSON.stringify({ error: msg }) }
    }
}

export const handler = schedule('*/30 * * * *', statusCheckHandler)
