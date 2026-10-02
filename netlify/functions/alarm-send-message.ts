/**
 * Invio del messaggio collegato a un allarme, chiamato dal gestionale.
 *
 * L'allarme suona, l'operatore preme "Avvisa il cliente" oppure (riserva,
 * quando il motore sul server non batte) la scheda invia da se' il messaggio
 * scelto in Centralina Pro > Allarmi. La logica sta in
 * utils/messaggioAllarme.ts, condivisa con alarm-engine-cron.
 *
 * Input:  { alarmId, entityId, templateKey, eventId? }
 * Output: { sent: true, phone } oppure un motivo esplicito.
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'
import { getCorsOrigin } from './cors-headers'
import { inviaMessaggioAllarme } from './utils/messaggioAllarme'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    }
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: authErr } = await requireAuth(event as any)
    if (authErr) return authErr

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase non configurato' }) }
    }

    try {
        const { alarmId, entityId, templateKey, eventId } = JSON.parse(event.body || '{}')
        if (!entityId || !templateKey) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'entityId e templateKey sono obbligatori' }) }
        }

        const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
        })
        const esito = await inviaMessaggioAllarme(sb, { alarmId, entityId, templateKey, eventId })
        if (!esito.sent && esito.notFound) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: esito.message }) }
        }
        return { statusCode: 200, headers, body: JSON.stringify(esito) }
    } catch (err) {
        console.error('[alarm-send-message]', err)
        return { statusCode: 500, headers, body: JSON.stringify({ error: (err as Error).message }) }
    }
}
