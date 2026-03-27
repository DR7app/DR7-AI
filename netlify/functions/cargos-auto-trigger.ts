import { Handler } from '@netlify/functions'
import { sendToCargos } from './cargos-auto-send'

/**
 * Endpoint called by trustera360.app after a contract is signed.
 * Triggers automatic CARGOS submission for the booking.
 */
export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    // Simple shared secret to prevent unauthorized calls
    const authHeader = event.headers['x-cargos-key'] || ''
    const expectedKey = process.env.CARGOS_TRIGGER_KEY || 'dr7-cargos-auto-2024'
    if (authHeader !== expectedKey) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) }
    }

    try {
        const { bookingId } = JSON.parse(event.body || '{}')

        if (!bookingId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'bookingId richiesto' }) }
        }

        console.log(`[cargos-auto-trigger] Triggered for booking ${bookingId}`)
        const result = await sendToCargos(bookingId)

        if (result.success) {
            console.log(`[cargos-auto-trigger] ✅ Booking ${bookingId} sent to CARGOS`)
        } else {
            console.warn(`[cargos-auto-trigger] ⚠️ CARGOS failed for ${bookingId}:`, result.error)
        }

        return {
            statusCode: 200,
            body: JSON.stringify(result)
        }
    } catch (error: any) {
        console.error('[cargos-auto-trigger] Error:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: error.message })
        }
    }
}
