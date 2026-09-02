import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { getAdminNotificationPhone } from './utils/notificationPhone'
import { conSystemControl } from './utils/systemControl'

/**
 * fatture-bozza-alert-cron — promemoria giornaliero WhatsApp sulle fatture
 * che NON sono partite verso SDI.
 *
 * Perche' esiste (28/08/2026): una fattura che resta in "Bozza" e' una
 * fattura non trasmessa. Finora il motivo del blocco (tipicamente anagrafica
 * cliente incompleta) restava scritto solo su `fatture.sdi_response` e
 * nessuno lo leggeva: la riga sembrava una bozza qualunque e ci restava.
 *
 * Ogni mattina elenca le bozze aperte con il motivo, cosi' si correggono e si
 * reinviano dal tab Fattura ("Invia a SDI le bozze").
 *
 * Note di credito e fatture annullate sono escluse. Se non c'e' niente in
 * bozza NON manda nulla: nessun messaggio a vuoto.
 *
 * Si puo' anche chiamare a mano (POST) per avere il quadro subito.
 */

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN

const MAX_RIGHE = 15

const fmtEUR = (n: number) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const NOTE_DI_CREDITO = ['nota_credito', 'nota_di_credito', 'TD04']

const handler: Handler = async () => {
    const { data: righe, error } = await supabase
        .from('fatture')
        .select('id, numero_fattura, customer_name, importo_totale, data_emissione, stato, tipo_fattura, sdi_status, sdi_response')
        .or('sdi_status.is.null,sdi_status.eq.draft')
        .order('data_emissione', { ascending: true })
        .limit(500)

    if (error) {
        console.error('[fatture-bozza-alert-cron] lettura fatture fallita:', error.message)
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    }

    const bozze = (righe || []).filter(f =>
        f.stato !== 'cancelled' && !NOTE_DI_CREDITO.includes(String(f.tipo_fattura || ''))
    )

    console.log('[fatture-bozza-alert-cron] bozze aperte:', bozze.length)

    if (bozze.length === 0) {
        return { statusCode: 200, body: JSON.stringify({ ok: true, bozze: 0, inviato: false }) }
    }

    const oggi = new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' })
    const totale = bozze.reduce((s, f) => s + Number(f.importo_totale || 0), 0)

    const lines: string[] = []
    lines.push(`*FATTURE NON INVIATE A SDI - ${oggi}*`)
    lines.push(`${bozze.length} fattura/e ferme in bozza per un totale di *EUR ${fmtEUR(totale)}*.`)
    lines.push('')

    for (const f of bozze.slice(0, MAX_RIGHE)) {
        const data = f.data_emissione ? new Date(f.data_emissione).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '-'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const motivo = String((f.sdi_response as any)?.auto_send_error || '').trim()
        lines.push(`- ${f.numero_fattura} - ${f.customer_name || 'cliente n/d'} - EUR ${fmtEUR(Number(f.importo_totale || 0))} (${data})`)
        if (motivo) lines.push(`  Motivo: ${motivo.slice(0, 160)}`)
    }
    if (bozze.length > MAX_RIGHE) {
        lines.push(`  ...e altre ${bozze.length - MAX_RIGHE}.`)
    }

    lines.push('')
    lines.push('Correggi l\'anagrafica indicata e premi "Invia a SDI le bozze" nel tab Fattura.')

    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
        console.warn('[fatture-bozza-alert-cron] Green API non configurata: nessun invio')
        return { statusCode: 200, body: JSON.stringify({ ok: true, bozze: bozze.length, inviato: false, motivo: 'green_api_mancante' }) }
    }

    try {
        const adminPhone = await getAdminNotificationPhone()
        await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: `${adminPhone}@c.us`, message: lines.join('\n') }),
        })
        return { statusCode: 200, body: JSON.stringify({ ok: true, bozze: bozze.length, inviato: true }) }
    } catch (e: any) {
        console.error('[fatture-bozza-alert-cron] invio WhatsApp fallito:', e?.message || e)
        return { statusCode: 200, body: JSON.stringify({ ok: true, bozze: bozze.length, inviato: false, errore: String(e?.message || e) }) }
    }
}

// Battito per il controllo orario del System Control: ogni giro lascia
// traccia, cosi' il pannello si accorge se questo automatismo si ferma.
const handlerSorvegliato = conSystemControl('fatture-bozza-alert-cron', handler, { cron: true })
export { handlerSorvegliato as handler }
