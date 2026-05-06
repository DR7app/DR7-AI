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
    errorSamples?: { numero: string; filename: string; error: string }[]
    unknownStatuses?: { numero: string; remoteStatus: string }[]
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
    const errorSamples: NonNullable<PollResult['errorSamples']> = []
    const unknownStatuses: NonNullable<PollResult['unknownStatuses']> = []

    for (const invoice of pendingInvoices) {
        const lookupFilename = invoice.aruba_upload_filename || invoice.xml_filename
        try {
            const remoteInvoice = await checkArubaStatus(lookupFilename)
            const invoiceObj = remoteInvoice.invoices?.[0] || remoteInvoice
            const invoiceStatus = invoiceObj.status || invoiceObj.invoiceStatus || ''
            const remoteStatus = invoiceStatus.toLowerCase().trim()

            // Aruba canonical statuses (it_IT). Mapping covers all cases
            // observed plus the aliases SDI uses pre-Aruba parsing.
            //   - in_elaborazione / inviata / spedita     -> sent
            //   - consegnata / consegnato                 -> accepted
            //   - scartata / mancata consegna             -> rejected
            //   - errore elaborazione / errore_consegna   -> error
            // Anything else is captured in unknownStatuses so we can map it
            // explicitly instead of leaving fatture stuck on "Invio…".
            let sdiStatus = invoice.sdi_status
            if (remoteStatus === 'consegnata' || remoteStatus === 'consegnato') {
                sdiStatus = 'accepted'
            } else if (
                remoteStatus === 'scartata' ||
                remoteStatus === 'rifiutata' ||
                remoteStatus === 'mancata consegna' ||
                remoteStatus === 'mancata_consegna'
            ) {
                sdiStatus = 'rejected'
            } else if (
                remoteStatus === 'errore elaborazione' ||
                remoteStatus === 'errore_consegna' ||
                remoteStatus === 'errore'
            ) {
                sdiStatus = 'error'
            } else if (
                remoteStatus === 'inviata' ||
                remoteStatus === 'spedita' ||
                remoteStatus === 'in_elaborazione' ||
                remoteStatus === 'in elaborazione' ||
                remoteStatus === 'ricevuta' ||
                remoteStatus === 'in_consegna'
            ) {
                sdiStatus = 'sent'
            } else if (remoteStatus) {
                if (unknownStatuses.length < 8) {
                    unknownStatuses.push({ numero: invoice.numero_fattura, remoteStatus })
                }
            }

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
            if (errorSamples.length < 10) {
                errorSamples.push({
                    numero: invoice.numero_fattura,
                    filename: lookupFilename || '(missing)',
                    error: msg.slice(0, 200),
                })
            }
        }
    }

    return {
        success: true,
        checked: pendingInvoices.length,
        updated,
        errors,
        transitions,
        ...(errorSamples.length > 0 ? { errorSamples } : {}),
        ...(unknownStatuses.length > 0 ? { unknownStatuses } : {}),
    }
}
