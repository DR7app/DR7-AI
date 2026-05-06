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

// Aruba rate-limits aggressively (HTTP 429 "Troppe richieste"). Empirical
// data from production triggers:
//   - 30 req @ 200ms = 27/30 errored out (429)
//   - 30 req @ 0ms   = 165/180 errored out (429)
// Aruba's bucket appears to refresh ~1 req/sec. Using 1200ms throttle
// + 7 per invocation = ~8.4s, fits within 10s Netlify timeout AND stays
// within Aruba's tolerance. Multiple invocations (cron 30min + auto-refresh
// every 60s from FatturaTab) catch up the backlog. With 180 stuck:
// 180/7 = ~26 cycles; at 1 cycle/min from FatturaTab, ~26 minutes to clear.
const ARUBA_THROTTLE_MS = 1200
const MAX_PER_INVOCATION = 7

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function pollAllPendingSdi(): Promise<PollResult> {
    const { data: pendingInvoices, error: fetchError } = await supabase
        .from('fatture')
        .select('id, xml_filename, aruba_upload_filename, sdi_status, numero_fattura, sdi_sent_at')
        // Oldest sdi_sent_at first → we don't leave ancient sending invoices
        // perpetually behind newer ones each invocation.
        .in('sdi_status', ['sending', 'sent'])
        .not('xml_filename', 'is', null)
        .order('sdi_sent_at', { ascending: true, nullsFirst: true })
        .limit(MAX_PER_INVOCATION)

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

    for (let i = 0; i < pendingInvoices.length; i++) {
        const invoice = pendingInvoices[i]
        if (i > 0) await sleep(ARUBA_THROTTLE_MS) // throttle between Aruba calls
        const lookupFilename = invoice.aruba_upload_filename || invoice.xml_filename
        try {
            const remoteInvoice = await checkArubaStatus(lookupFilename)
            const invoiceObj = remoteInvoice.invoices?.[0] || remoteInvoice
            const invoiceStatus = invoiceObj.status || invoiceObj.invoiceStatus || ''
            const remoteStatus = invoiceStatus.toLowerCase().trim()

            // Aruba/SDI canonical statuses (it_IT). Mapping per fiscal
            // semantics — what counts as "valid invoice on file":
            //   accepted = SDI accepted it (regardless of recipient PEC delivery)
            //   rejected = SDI scartata for content errors → NEED resend
            //   error    = pipeline error
            //   sent     = still in flight (SDI hasn't responded yet)
            //
            // Important: "mancata consegna" / "non consegnata" mean SDI
            // accepted the invoice but couldn't deliver to recipient PEC —
            // fiscally this is FINE (invoice is on file at AdE), so map to
            // accepted, NOT rejected. Previous code treated these as rejected,
            // confusing admins into resending perfectly valid fatture.
            let sdiStatus = invoice.sdi_status
            if (
                remoteStatus === 'consegnata' ||
                remoteStatus === 'consegnato' ||
                remoteStatus === 'mancata consegna' ||
                remoteStatus === 'mancata_consegna' ||
                remoteStatus === 'non consegnata' ||
                remoteStatus === 'non_consegnata' ||
                remoteStatus === 'non consegnato'
            ) {
                sdiStatus = 'accepted'
            } else if (
                remoteStatus === 'scartata' ||
                remoteStatus === 'rifiutata'
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
                // When transitioning INTO a state that needs admin attention,
                // reset the "seen" flag so the dashboard badge/notification
                // re-appears even if admin had previously dismissed an older
                // rejection on the same fattura.
                const needsAttention = sdiStatus === 'rejected' || sdiStatus === 'scartata' || sdiStatus === 'error'
                const update: Record<string, unknown> = {
                    sdi_status: sdiStatus,
                    sdi_response: remoteInvoice,
                }
                if (needsAttention) update.sdi_notification_seen = false
                await supabase
                    .from('fatture')
                    .update(update)
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
            // If Aruba is rate-limiting, stop the loop early — banging more
            // requests against a bucket that just rejected us only deepens
            // the cooldown. Next invocation (cron / auto-refresh) retries.
            if (msg.includes('429')) {
                console.warn('[SDI Poll] Aruba rate-limited (429); aborting batch early')
                break
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
