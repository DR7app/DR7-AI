import { Handler, schedule } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || '393457905205';

function formatWhatsAppMessage(cauzioni: any[]): string {
    let message = `⏰ *ALLARME SCADENZA CAUZIONE*\n\n`
    message += `Le seguenti cauzioni scadono OGGI (14° giorno lavorativo dalla restituzione veicolo):\n\n`

    cauzioni.forEach((c, i) => {
        const restituzione = c.data_restituzione_veicolo
            ? new Date(c.data_restituzione_veicolo + 'T00:00:00').toLocaleDateString('it-IT')
            : 'N/A'
        const scadenza = c.scadenza_cauzione
            ? new Date(c.scadenza_cauzione + 'T00:00:00').toLocaleDateString('it-IT')
            : 'N/A'

        message += `*${i + 1}. ${c.cliente_nome || 'N/A'}*\n`
        message += `   Veicolo: ${c.veicolo_nome || 'N/A'}\n`
        message += `   Importo: €${c.importo?.toFixed(2) || '0.00'}\n`
        message += `   Metodo: ${c.metodo || 'N/A'}\n`
        message += `   Restituzione: ${restituzione}\n`
        message += `   Scadenza: ${scadenza}\n\n`
    })

    message += `⚠️ *AZIONE RICHIESTA:* Procedere con la restituzione/sblocco delle cauzioni entro oggi.`

    return message
}

const scheduledHandler: Handler = async (event) => {
    console.log('[Deposit Expiration] Checking for deposit expirations...')

    if (!supabaseUrl || !supabaseServiceKey) {
        console.error('[Deposit Expiration] Missing Supabase credentials')
        return { statusCode: 500, body: JSON.stringify({ error: 'Missing Supabase config' }) }
    }

    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
        console.error('[Deposit Expiration] Missing Green API credentials')
        return { statusCode: 500, body: JSON.stringify({ error: 'Missing Green API config' }) }
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    })

    try {
        const today = new Date().toISOString().split('T')[0]

        // Query cauzioni expiring today that are still active
        const { data: expiringCauzioni, error } = await supabase
            .from('cauzioni')
            .select(`
                *,
                customers_extended!cauzioni_cliente_id_fkey (
                    nome,
                    cognome
                ),
                vehicles!cauzioni_veicolo_id_fkey (
                    name
                )
            `)
            .eq('scadenza_cauzione', today)
            .in('stato', ['Attiva', 'In scadenza'])

        if (error) {
            console.error('[Deposit Expiration] Error fetching cauzioni:', error)
            return {
                statusCode: 500,
                body: JSON.stringify({ error: error.message })
            }
        }

        if (!expiringCauzioni || expiringCauzioni.length === 0) {
            console.log('[Deposit Expiration] No deposits expiring today')
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'No deposits expiring today' })
            }
        }

        // Enrich data
        const enrichedCauzioni = expiringCauzioni.map(c => ({
            ...c,
            cliente_nome: c.customers_extended
                ? `${c.customers_extended.nome} ${c.customers_extended.cognome}`
                : 'Cliente sconosciuto',
            veicolo_nome: c.vehicles?.name || 'Veicolo sconosciuto'
        }))

        // Format WhatsApp message
        const message = formatWhatsAppMessage(enrichedCauzioni)

        // Send via Green API to admin notification phone
        const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`

        const response = await fetch(greenApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId: `${NOTIFICATION_PHONE}@c.us`,
                message: message
            })
        })

        const result = await response.json()

        if (!response.ok || result.error) {
            console.error('[Deposit Expiration] Green API error:', result)
            throw new Error(result.error || 'Green API error')
        }

        console.log(`[Deposit Expiration] WhatsApp alarm sent for ${expiringCauzioni.length} deposit(s)`)

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Expiration alarm sent via WhatsApp',
                count: expiringCauzioni.length,
                cauzioni: enrichedCauzioni.map(c => ({
                    id: c.id,
                    cliente: c.cliente_nome,
                    veicolo: c.veicolo_nome,
                    importo: c.importo,
                    scadenza: c.scadenza_cauzione
                }))
            })
        }

    } catch (error: any) {
        console.error('[Deposit Expiration] Fatal error:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        }
    }
}

// Run every day at 9:00 AM (Rome time = UTC+1, so 8:00 UTC)
export const handler = schedule('0 8 * * *', scheduledHandler)
