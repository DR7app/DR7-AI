import type { Handler } from '@netlify/functions'
import { conSystemControl } from './utils/systemControl'

/**
 * Wrapper schedulato per il sync notturno. Il lavoro vero lo fa la
 * background function `fornitori-fatture-sync-background.ts`, che ha
 * timeout di 15 minuti — il cron qui dentro ha solo 30s e non basta
 * a sincronizzare tutti i fornitori.
 *
 * Schedule: ogni notte alle 03:00 Rome (definita in netlify.toml).
 */
const handler: Handler = async () => {
    const baseUrl = process.env.URL || 'https://platform.dr7ai.com'
    try {
        // Fire-and-forget: il background function risponde 202 subito.
        await fetch(`${baseUrl}/.netlify/functions/fornitori-fatture-sync-background`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trigger: 'cron' }),
        })
    } catch (err) {
        console.warn('[fornitori-fatture-sync-cron] trigger failed:', err)
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, dispatched: true }) }
}

// Battito per il controllo orario del System Control: ogni giro lascia
// traccia, cosi' il pannello si accorge se questo automatismo si ferma.
const handlerSorvegliato = conSystemControl('fornitori-fatture-sync-cron', handler, { cron: true })
export { handlerSorvegliato as handler }
