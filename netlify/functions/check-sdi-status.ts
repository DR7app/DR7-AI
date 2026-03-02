import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { checkArubaStatus } from './aruba-utils'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
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

        // Map Aruba status to our internal status
        // getByFilename may return invoice directly or inside invoices[] array
        let sdiStatus = 'sent' // Default
        const invoiceObj = remoteInvoice.invoices?.[0] || remoteInvoice
        const invoiceStatus = invoiceObj.status || invoiceObj.invoiceStatus || ''
        const remoteStatus = invoiceStatus.toLowerCase()
        console.log('[SDI Status] Remote status:', remoteStatus, 'Full response keys:', Object.keys(remoteInvoice))

        if (remoteStatus === 'consegnata') {
            sdiStatus = 'accepted'
        } else if (remoteStatus === 'scartata' || remoteStatus === 'mancata consegna') {
            sdiStatus = 'rejected'
        } else if (remoteStatus === 'errore elaborazione') {
            sdiStatus = 'error'
        } else if (remoteStatus === 'inviata') {
            sdiStatus = 'sent'
        }

        // Update DB
        await supabase
            .from('fatture')
            .update({
                sdi_status: sdiStatus,
                sdi_response: remoteInvoice
            })
            .eq('id', invoiceId)

        // Log to history
        await supabase.from('invoice_status_logs').insert({
            invoice_id: invoiceId,
            status: sdiStatus,
            message: `Aruba Status: ${remoteStatus}`,
            raw_response: remoteInvoice
        })

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                status: sdiStatus,
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
