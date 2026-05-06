/**
 * Shared SDI status polling logic.
 * Called from:
 *   - check-sdi-statuses-cron.ts (scheduled, every 30 min)
 *   - check-sdi-statuses.ts (HTTP, manual refresh from FatturaTab)
 *
 * Polls Aruba's getByFilename for every fattura with sdi_status in
 * ('sending','sent') and maps the remote status into our canonical:
 *   consegnata           -> accepted
 *   scartata / mancata   -> rejected
 *   errore elaborazione  -> error
 *   inviata              -> sent
 */
import { createClient } from '@supabase/supabase-js'
import { checkArubaStatus } from './aruba-utils'

const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
)

export interface PollResult {
    success: boolean
    checked: number
    updated: number
    errors: number
    transitions: { id: string; numero: string; from: string; to: string }[]
}

export async function pollAllPendingSdi(): Promise<PollResult> {
    const { data: pendingInvoices, error: fetchError } = await supabase
        .from('fatture')
        .select('id, xml_filename, aruba_upload_filename, sdi_status, numero_fattura')
        .in('sdi_status', ['sending', 'sent'])
        .not('xml_filename', 'is', null)

    if (fetchError) {
        throw new Error(`DB fetch error: ${fetchError.message}`)
    }
    if (!pendingInvoices || pendingInvoices.length === 0) {
        return { success: true, checked: 0, updated: 0, errors: 0, transitions: [] }
    }

    let updated = 0
    let errors = 0
    const transitions: PollResult['transitions'] = []

    for (const invoice of pendingInvoices) {
        try {
            const lookupFilename = invoice.aruba_upload_filename || invoice.xml_filename
            const remoteInvoice = await checkArubaStatus(lookupFilename)
            const invoiceObj = remoteInvoice.invoices?.[0] || remoteInvoice
            const invoiceStatus = invoiceObj.status || invoiceObj.invoiceStatus || ''
            const remoteStatus = invoiceStatus.toLowerCase()

            let sdiStatus = invoice.sdi_status
            if (remoteStatus === 'consegnata') sdiStatus = 'accepted'
            else if (remoteStatus === 'scartata' || remoteStatus === 'mancata consegna') sdiStatus = 'rejected'
            else if (remoteStatus === 'errore elaborazione') sdiStatus = 'error'
            else if (remoteStatus === 'inviata') sdiStatus = 'sent'

            if (sdiStatus !== invoice.sdi_status) {
                await supabase
                    .from('fatture')
                    .update({ sdi_status: sdiStatus, sdi_response: remoteInvoice })
                    .eq('id', invoice.id)
                await supabase.from('invoice_status_logs').insert({
                    invoice_id: invoice.id,
                    status: sdiStatus,
                    message: `Status poll: ${remoteStatus}`,
                    raw_response: remoteInvoice,
                })
                transitions.push({ id: invoice.id, numero: invoice.numero_fattura, from: invoice.sdi_status || '', to: sdiStatus || '' })
                updated++
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`[SDI Poll] error on ${invoice.numero_fattura}:`, msg)
            errors++
        }
    }

    return { success: true, checked: pendingInvoices.length, updated, errors, transitions }
}
