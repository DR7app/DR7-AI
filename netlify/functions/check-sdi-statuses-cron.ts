import { Handler, schedule } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { checkArubaStatus } from './aruba-utils'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * Scheduled function: checks SDI status for all pending invoices via Aruba API.
 * Runs every 2 hours.
 */
const statusCheckHandler: Handler = async () => {
    console.log('[SDI Cron] Starting scheduled SDI status check...')

    try {
        // Fetch all invoices awaiting SDI response
        const { data: pendingInvoices, error: fetchError } = await supabase
            .from('fatture')
            .select('id, xml_filename, aruba_upload_filename, sdi_status, numero_fattura')
            .in('sdi_status', ['sending', 'sent'])
            .not('xml_filename', 'is', null)

        if (fetchError) {
            console.error('[SDI Cron] DB fetch error:', fetchError.message)
            return { statusCode: 500, body: JSON.stringify({ error: fetchError.message }) }
        }

        if (!pendingInvoices || pendingInvoices.length === 0) {
            console.log('[SDI Cron] No pending invoices to check.')
            return { statusCode: 200, body: JSON.stringify({ message: 'No pending invoices', checked: 0 }) }
        }

        console.log(`[SDI Cron] Found ${pendingInvoices.length} invoices to check.`)

        let updated = 0
        let errors = 0

        for (const invoice of pendingInvoices) {
            try {
                const lookupFilename = invoice.aruba_upload_filename || invoice.xml_filename
                const remoteInvoice = await checkArubaStatus(lookupFilename)

                // Map Aruba status to internal status
                // getByFilename may return invoice directly or inside invoices[] array
                const invoiceObj = remoteInvoice.invoices?.[0] || remoteInvoice
                const invoiceStatus = invoiceObj.status || invoiceObj.invoiceStatus || ''
                const remoteStatus = invoiceStatus.toLowerCase()

                let sdiStatus = invoice.sdi_status // Keep current if unknown
                if (remoteStatus === 'consegnata') {
                    sdiStatus = 'accepted'
                } else if (remoteStatus === 'scartata' || remoteStatus === 'mancata consegna') {
                    sdiStatus = 'rejected'
                } else if (remoteStatus === 'errore elaborazione') {
                    sdiStatus = 'error'
                } else if (remoteStatus === 'inviata') {
                    sdiStatus = 'sent'
                }

                // Only update if status actually changed
                if (sdiStatus !== invoice.sdi_status) {
                    await supabase
                        .from('fatture')
                        .update({ sdi_status: sdiStatus, sdi_response: remoteInvoice })
                        .eq('id', invoice.id)

                    await supabase.from('invoice_status_logs').insert({
                        invoice_id: invoice.id,
                        status: sdiStatus,
                        message: `Cron update: ${remoteStatus}`,
                        raw_response: remoteInvoice
                    })

                    console.log(`[SDI Cron] ${invoice.numero_fattura}: ${invoice.sdi_status} -> ${sdiStatus}`)
                    updated++
                }
            } catch (err: any) {
                console.error(`[SDI Cron] Error checking ${invoice.numero_fattura}:`, err.message)
                errors++
            }
        }

        console.log(`[SDI Cron] Done. Checked: ${pendingInvoices.length}, Updated: ${updated}, Errors: ${errors}`)

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                checked: pendingInvoices.length,
                updated,
                errors
            })
        }
    } catch (error: any) {
        console.error('[SDI Cron] Fatal error:', error.message)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        }
    }
}

// Run every 2 hours
export const handler = schedule('0 */2 * * *', statusCheckHandler)
