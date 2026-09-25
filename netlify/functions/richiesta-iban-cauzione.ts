/**
 * Richiesta IBAN dal gestionale (tasto "Segna incassata" in CauzioniTab).
 * Body: { cauzioneId: string }. Logica e anti-doppio invio in
 * utils/richiestaIbanCauzione.ts, la stessa del link Nexi e del cron.
 */
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { getCorsOrigin } from './cors-headers'
import { inviaRichiestaIbanCauzione } from './utils/richiestaIbanCauzione'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    }
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{"error":"Method not allowed"}' }

    try {
        const { cauzioneId } = JSON.parse(event.body || '{}')
        if (!cauzioneId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing cauzioneId' }) }
        const esito = await inviaRichiestaIbanCauzione(supabase, String(cauzioneId))
        return { statusCode: 200, headers, body: JSON.stringify({ esito }) }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) }
    }
}
