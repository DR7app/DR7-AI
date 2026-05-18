/**
 * GBP — POST /gbp-seed-cache
 *
 * Scrive manualmente in app_secrets.gbp_location_name i valori di
 * accountName / locationName, cosi\' /gbp-list-reviews (e /gbp-report)
 * saltano per sempre la chiamata accounts.list a Google
 * (mybusinessaccountmanagement.googleapis.com) che ha quota 1 req/min
 * e va in 429 / RESOURCE_EXHAUSTED a vista.
 *
 * Body: { accountName: "accounts/12345..." , locationName?: "locations/..." }
 * Se locationName e\' omesso e una location e\' gia\' cachata, la
 * preserviamo. Se entrambi sono passati, sovrascrive entrambi.
 *
 * Trovare l'accountName: la via piu\' rapida e\' aprire
 *   https://business.google.com/u/0/locations
 * mentre sei loggato col Google connesso. La devtools del browser
 * mostra chiamate a `mybusinessaccountmanagement.googleapis.com/v1/accounts/<NUMBER>`:
 * l'accountName e\' "accounts/<NUMBER>".
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
}

function isValidAccount(v: string): boolean {
    return /^accounts\/\d+$/.test(v)
}
function isValidLocation(v: string): boolean {
    return /^locations\/\d+$/.test(v) || /^accounts\/\d+\/locations\/\d+$/.test(v)
}

export const handler: Handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' }
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseKey) {
        return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Supabase env missing' }) }
    }

    let body: { accountName?: string; locationName?: string } = {}
    try { body = JSON.parse(event.body || '{}') } catch {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'JSON body invalido' }) }
    }

    const accountName = String(body.accountName || '').trim()
    const locationName = body.locationName ? String(body.locationName).trim() : null

    if (!accountName || !isValidAccount(accountName)) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'accountName mancante o invalido. Atteso formato "accounts/<numero>".' }) }
    }
    if (locationName && !isValidLocation(locationName)) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'locationName invalido. Atteso "locations/<numero>" o "accounts/<numero>/locations/<numero>".' }) }
    }

    const sb = createClient(supabaseUrl, supabaseKey)

    // Carica eventuale value esistente per preservare campi (es. title) che non passiamo.
    let existing: { name?: string; title?: string; account?: string; discovered_at?: string } = {}
    try {
        const { data } = await sb.from('app_secrets').select('value').eq('key', 'gbp_location_name').maybeSingle()
        existing = (data?.value as typeof existing) || {}
    } catch { /* fall through */ }

    const value = {
        name: locationName || existing.name || null,
        title: existing.title || 'manual',
        account: accountName,
        discovered_at: new Date().toISOString(),
        seeded_via: 'gbp-seed-cache',
    }

    if (!value.name) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Nessuna location cachata e locationName non passato. Passa locationName insieme ad accountName la prima volta.' }) }
    }

    try {
        const { error } = await sb.from('app_secrets').upsert({
            key: 'gbp_location_name',
            value,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'key' })
        if (error) throw error
    } catch (e) {
        return { statusCode: 500, headers: cors, body: JSON.stringify({ error: `Upsert fallito: ${e instanceof Error ? e.message : String(e)}` }) }
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, cached: value }) }
}
