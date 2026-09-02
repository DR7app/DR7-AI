// =============================================================================
// sync-ipa-cron — wrapper schedulato mensile del sync rubrica IPA.
// La logica vive in sync-ipa.ts (runSync), invocabile anche a mano dalla UI.
// Cadenza: 1 del mese alle 03:00 UTC. Deve corrispondere a netlify.toml.
// =============================================================================
import { schedule } from '@netlify/functions'
import { runSync } from './sync-ipa'
import { conSystemControl } from './utils/systemControl'

export const handler = schedule('0 3 1 * *', conSystemControl('sync-ipa-cron', async () => {
    try {
        const result = await runSync()
        console.log('[sync-ipa-cron] done:', result)
    } catch (e) {
        console.error('[sync-ipa-cron] error:', e)
    }
    return { statusCode: 200, body: 'ok' }
}, { cron: true }))
