import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

/**
 * Cron notturno — pre-sincronizza le fatture Aruba per TUTTI i fornitori
 * attivi, così quando l'admin apre un fornitore i dati sono già lì.
 *
 * Schedule: ogni notte alle 03:00 Rome (01:00 UTC estate / 02:00 UTC inverno).
 * Schedule registrato in netlify.toml.
 *
 * Per ogni fornitore chiama internamente sync-fornitore-invoices con months=12,
 * con un delay tra una chiamata e l'altra per non sovraccaricare l'API Aruba.
 */

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const handler: Handler = async () => {
    const baseUrl = process.env.URL || 'https://admin.dr7empire.com'
    const startedAt = Date.now()

    const { data: fornitori, error } = await supabase
        .from('fornitori')
        .select('id, nome')
        .eq('attivo', true)

    if (error) {
        console.error('[fornitori-fatture-sync-cron] query error', error)
        return { statusCode: 500, body: error.message }
    }

    let synced = 0
    let inserted = 0
    let failed = 0

    for (const f of fornitori || []) {
        try {
            const res = await fetch(`${baseUrl}/.netlify/functions/sync-fornitore-invoices`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fornitore_id: f.id, months: 12 }),
            })
            const json = await res.json().catch(() => ({}))
            if (res.ok && json.success) {
                synced++
                inserted += (json.inserted || 0)
            } else {
                failed++
                console.warn(`[fornitori-fatture-sync-cron] ${f.nome}: ${json.error || res.status}`)
            }
        } catch (err) {
            failed++
            console.warn(`[fornitori-fatture-sync-cron] ${f.nome} error:`, err)
        }
        // Throttle: 500ms tra una chiamata e l'altra per non sovraccaricare Aruba
        await new Promise(r => setTimeout(r, 500))
    }

    const durationSec = Math.round((Date.now() - startedAt) / 1000)
    const summary = { totale: (fornitori || []).length, synced, inserted, failed, durationSec }
    console.log('[fornitori-fatture-sync-cron]', summary)

    return { statusCode: 200, body: JSON.stringify({ ok: true, ...summary }) }
}

export { handler }
