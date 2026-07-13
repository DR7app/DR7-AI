// 2026-07-13: Promemoria serale ritiro immondizia. Ogni sera controlla i
// ritiri di DOMANI (regole settimanali sul giorno + date specifiche) e manda
// un WhatsApp al numero admin/direzione con l'elenco dei rifiuti da esporre.
import { schedule } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const GIORNI = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']

const cronHandler = async () => {
    // "Domani" in Europe/Rome.
    const now = new Date()
    const romeNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Rome' }))
    const tomorrow = new Date(romeNow)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowDow = tomorrow.getDay()            // 0=Dom..6=Sab
    const y = tomorrow.getFullYear()
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0')
    const d = String(tomorrow.getDate()).padStart(2, '0')
    const tomorrowDate = `${y}-${m}-${d}`

    const { data: rules, error } = await supabase
        .from('immondizia_calendario')
        .select('tipo_rifiuto, mode, day_of_week, pickup_date, note')
        .eq('active', true)
        .eq('reminder_enabled', true)
    if (error) { console.error('[immondizia-reminder] fetch error', error.message); return { statusCode: 500, body: error.message } }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tomorrows = (rules || []).filter((r: any) =>
        (r.mode === 'weekly' && r.day_of_week === tomorrowDow) ||
        (r.mode === 'date' && r.pickup_date === tomorrowDate)
    )
    if (tomorrows.length === 0) {
        console.log(`[immondizia-reminder] nessun ritiro per domani (${tomorrowDate})`)
        return { statusCode: 200, body: JSON.stringify({ ok: true, tomorrow: tomorrowDate, count: 0 }) }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tipi = tomorrows.map((r: any) => r.tipo_rifiuto + (r.note ? ` (${r.note})` : ''))
    const dataLabel = `${GIORNI[tomorrowDow]} ${d}/${m}/${y}`
    const message = `*Promemoria Immondizia — DR7*\n\nDomani ${dataLabel} ritiro:\n${tipi.map((t: string) => `• ${t}`).join('\n')}\n\nEsporre i contenitori entro l'orario previsto.`

    const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
    const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN
    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
        console.warn('[immondizia-reminder] Green API non configurata')
        return { statusCode: 200, body: JSON.stringify({ ok: true, sent: false, reason: 'no_green_api' }) }
    }
    let phone = ''
    try {
        const { getAdminNotificationPhone } = await import('./utils/notificationPhone')
        phone = (await getAdminNotificationPhone()).toString().replace(/\D/g, '')
    } catch (e: any) {
        console.error('[immondizia-reminder] admin phone error', e?.message)
    }
    if (!phone) { console.warn('[immondizia-reminder] nessun numero admin'); return { statusCode: 200, body: JSON.stringify({ ok: true, sent: false, reason: 'no_admin_phone' }) } }

    try {
        const url = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: `${phone}@c.us`, message }),
        })
        const res = await resp.json().catch(() => ({}))
        console.log(`[immondizia-reminder] inviato per ${tomorrowDate}: ${tipi.join(', ')} — idMessage=${(res as any)?.idMessage}`)
        return { statusCode: 200, body: JSON.stringify({ ok: true, tomorrow: tomorrowDate, tipi, sent: true }) }
    } catch (e: any) {
        console.error('[immondizia-reminder] invio fallito', e?.message)
        return { statusCode: 500, body: String(e?.message) }
    }
}

// Ogni sera alle 18:00 UTC (~19/20 Rome): promemoria per i ritiri di domani.
export const handler = schedule('0 18 * * *', cronHandler)
