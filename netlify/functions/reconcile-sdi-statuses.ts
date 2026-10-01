/**
 * Bulk reconciler — pulls the FULL list of outgoing invoices from Aruba
 * (paginated) and updates our DB to match. Used when one-by-one polling
 * has fallen behind (e.g. after rate-limit incidents) and admin wants to
 * sync the whole truth in one shot.
 *
 * Unlike check-sdi-statuses (which polls only sending/sent), this endpoint
 * reconciles ALL fatture in our DB regardless of current sdi_status —
 * so a fattura that was scartata on Aruba but still labelled "sending"
 * locally gets corrected.
 *
 * Throttle: paginates 100 per page; ~3-4 Aruba calls cover ~300 fatture.
 * Aruba rate-limit handled by the helper's exponential backoff.
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { searchOutgoingInvoices } from './aruba-utils'
import { motivoScarto } from './utils/motivoScartoSdi'

const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
)

interface ArubaOutgoing {
    filename?: string
    invoiceFilename?: string
    status?: string
    invoiceStatus?: string
    docNumber?: string
    invoiceNumber?: string
    statusDescription?: string
    invoices?: { status?: string; statusDescription?: string }[]
}

function mapStatus(remote: string): 'accepted' | 'rejected' | 'error' | 'sent' | null {
    const s = (remote || '').toLowerCase().trim()
    if (
        s === 'consegnata' || s === 'consegnato' ||
        s === 'mancata consegna' || s === 'mancata_consegna' ||
        s === 'non consegnata' || s === 'non_consegnata' || s === 'non consegnato'
    ) return 'accepted'
    if (s === 'scartata' || s === 'rifiutata') return 'rejected'
    if (s === 'errore elaborazione' || s === 'errore_consegna' || s === 'errore') return 'error'
    if (
        s === 'inviata' || s === 'spedita' ||
        s === 'in_elaborazione' || s === 'in elaborazione' ||
        s === 'ricevuta' || s === 'in_consegna'
    ) return 'sent'
    return null
}

export const handler: Handler = async () => {
    const PAGE_SIZE = 100
    const MAX_PAGES = 10 // 1000 fatture cap per invocazione
    const updates = new Map<string, { from: string | null; to: string; remoteStatus: string; motivo?: string | null }>()
    const unknown: { numero: string; remoteStatus: string }[] = []
    let pagesFetched = 0
    let totalRemote = 0
    let firstError: string | null = null

    try {
        // Build filename → fattura row index from our DB.
        const { data: localRows, error: localErr } = await supabase
            .from('fatture')
            .select('id, numero_fattura, xml_filename, aruba_upload_filename, sdi_status, customer_tax_code, customer_vat')
            .or('xml_filename.not.is.null,aruba_upload_filename.not.is.null')
        if (localErr) throw new Error('DB load: ' + localErr.message)
        const byFilename = new Map<string, { id: string; numero_fattura: string; sdi_status: string | null; customer_tax_code?: string | null; customer_vat?: string | null }>()
        for (const r of localRows || []) {
            if (r.aruba_upload_filename) byFilename.set(r.aruba_upload_filename, r)
            if (r.xml_filename) byFilename.set(r.xml_filename, r)
        }

        // Walk Aruba pages until exhausted or cap reached.
        for (let page = 0; page < MAX_PAGES; page++) {
            const result = await searchOutgoingInvoices({ page, pageSize: PAGE_SIZE })
            pagesFetched++
            const list: ArubaOutgoing[] = result?.invoices || result?.results || result?.data || []
            if (!list.length) break
            totalRemote += list.length

            for (const inv of list) {
                const filename = inv.filename || inv.invoiceFilename || ''
                if (!filename) continue
                const local = byFilename.get(filename)
                if (!local) continue
                const remoteStatus = (inv.status || inv.invoiceStatus || '').toLowerCase().trim()
                const mapped = mapStatus(remoteStatus)
                if (!mapped) {
                    if (unknown.length < 10) unknown.push({ numero: local.numero_fattura, remoteStatus })
                    continue
                }
                if (mapped !== local.sdi_status) {
                    // 01/10/2026: per gli scarti si porta dietro il motivo (la
                    // descrizione Aruba, o il segnaposto se e' vuota).
                    const motivo = mapped === 'rejected'
                        ? motivoScarto({
                            status: remoteStatus,
                            statusDescription: inv.invoices?.[0]?.statusDescription || inv.statusDescription || '',
                        }, local)
                        : null
                    updates.set(local.id, { from: local.sdi_status, to: mapped, remoteStatus, motivo })
                }
            }

            // If page returned fewer than PAGE_SIZE, we hit the end.
            if (list.length < PAGE_SIZE) break
        }

        // Apply updates in batches, resetting sdi_notification_seen for any
        // new transition into rejected/error so the dashboard badge fires.
        for (const [id, { to, motivo }] of updates) {
            const update: Record<string, unknown> = { sdi_status: to }
            // Notifica solo per scarti SDI veri, non per errori pipeline.
            if (to === 'rejected') update.sdi_notification_seen = false
            // 01/10/2026: motivo dello scarto aggiunto a sdi_response senza
            // perdere quello che c'era (id Aruba, filename, ...).
            if (to === 'rejected' && motivo) {
                const { data: riga } = await supabase.from('fatture').select('sdi_response').eq('id', id).maybeSingle()
                const precedente = riga?.sdi_response && typeof riga.sdi_response === 'object' ? riga.sdi_response : {}
                update.sdi_response = { ...precedente, motivo_scarto: motivo }
            }
            const { error } = await supabase.from('fatture').update(update).eq('id', id)
            if (error) console.warn('[reconcile-sdi] update failed', id, error.message)
        }
    } catch (err: unknown) {
        firstError = err instanceof Error ? err.message : String(err)
        console.error('[reconcile-sdi] fatal:', firstError)
    }

    const transitions = Array.from(updates.entries()).slice(0, 25).map(([id, t]) => ({
        id, from: t.from, to: t.to, remoteStatus: t.remoteStatus,
    }))

    return {
        statusCode: firstError ? 500 : 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            success: !firstError,
            error: firstError,
            pagesFetched,
            totalRemote,
            updated: updates.size,
            transitions,
            unknown,
        }),
    }
}
