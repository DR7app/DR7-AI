import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { checkArubaStatus } from './aruba-utils'
import { decidiAggiornamento } from './utils/statoSdiAruba'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const { invoiceId } = JSON.parse(event.body || '{}')

        if (!invoiceId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invoice ID is required' }) }
        }

        // Fetch invoice
        const { data: invoice, error: fetchError } = await supabase
            .from('fatture')
            .select('*')
            .eq('id', invoiceId)
            .single()

        if (fetchError || !invoice) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Invoice not found' }) }
        }

        // Use Aruba's upload filename (with .p7m) for status lookup, fallback to xml_filename
        const lookupFilename = invoice.aruba_upload_filename || invoice.xml_filename
        if (!lookupFilename) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invoice has not been sent to Aruba yet (missing filename)' }) }
        }

        // Check status from Aruba API
        let remoteInvoice
        try {
            remoteInvoice = await checkArubaStatus(lookupFilename)
        } catch (apiError: any) {
            console.error('Aruba Status Check Error:', apiError)
            return {
                statusCode: 502,
                body: JSON.stringify({ error: 'Failed to check status with Aruba', details: apiError.message })
            }
        }

        // 07/11/2026: traduzione dello stato Aruba dalla tabella UNICA
        // (utils/statoSdiAruba.ts). Prima qui "mancata consegna" era
        // 'rejected' mentre il giro automatico la dava 'accepted', e uno
        // stato non riconosciuto riscriveva la fattura a 'sent' (anche una
        // accettata). Ora uno stato sconosciuto non tocca sdi_status.
        //
        // 01/10/2026: Aruba dice "Scartata" ma statusDescription e' vuota
        // (DR7-2026-2102, Saia 1908-1913). Il client Aruba del repo non sa
        // scaricare la notifica di scarto: si salva un motivo esplicito, con
        // la causa probabile se CF/P.IVA non passano il controllo.
        const esito = decidiAggiornamento(invoice, remoteInvoice)
        const sdiStatus = esito.a
        console.log('[SDI Status] Stato Aruba:', esito.statoAruba, '->', sdiStatus, 'Full response keys:', Object.keys(remoteInvoice))

        // Update DB
        await supabase
            .from('fatture')
            .update(esito.patch)
            .eq('id', invoiceId)

        // Log to history
        await supabase.from('invoice_status_logs').insert({
            invoice_id: invoiceId,
            status: sdiStatus,
            message: esito.motivo
                ? `Aruba Status: ${esito.statoAruba} - ${esito.motivo}`
                : `Aruba Status: ${esito.statoAruba}`,
            raw_response: remoteInvoice
        })

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                status: sdiStatus,
                stato_aruba: esito.statoAruba || null,
                motivo_scarto: esito.motivo || null,
                details: remoteInvoice
            })
        }

    } catch (error: any) {
        console.error('Error checking Aruba status:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        }
    }
}
