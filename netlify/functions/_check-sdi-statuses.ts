/**
 * Shared SDI status polling logic.
 * Called from:
 *   - check-sdi-statuses-cron.ts (scheduled, every 30 min)
 *   - check-sdi-statuses.ts (HTTP, manual refresh from FatturaTab)
 *
 * Polls Aruba's getByFilename for every fattura with sdi_status in
 * ('sending','sent') and maps the remote status into our canonical one.
 * La tabella di traduzione e' UNA sola: utils/statoSdiAruba.ts
 * (consegnata / non consegnata -> accepted, scartata -> rejected,
 * errore elaborazione -> error, inviata / presa in carico -> sent).
 *
 * 07/11/2026: le fatture 'accepted' non venivano MAI piu' rilette, quindi
 * un'accettata sbagliata (114 scartate su Aruba, "Accettata" nel gestionale)
 * restava tale per sempre. I posti liberi di ogni giro ora riverificano le
 * accettate, la meno recentemente verificata per prima
 * (sdi_response.verificato_il). Nessuna colonna nuova: funziona subito.
 */
import { createClient } from '@supabase/supabase-js'
import { checkArubaStatus } from './aruba-utils'
import { decidiAggiornamento, type FatturaLocale } from './utils/statoSdiAruba'

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

export const COLONNE_VERIFICA_SDI =
    'id, xml_filename, aruba_upload_filename, sdi_status, numero_fattura, sdi_sent_at, customer_tax_code, customer_vat, sdi_response'

export type RigaVerificaSdi = FatturaLocale & {
    xml_filename?: string | null
    aruba_upload_filename?: string | null
}

/** Accettate da riverificare: prima le mai verificate, poi la verifica piu' vecchia. */
async function accettateDaRiverificare(quante: number): Promise<RigaVerificaSdi[]> {
    if (quante <= 0) return []
    const { data, error } = await supabase
        .from('fatture')
        .select(COLONNE_VERIFICA_SDI)
        .eq('sdi_status', 'accepted')
        .not('xml_filename', 'is', null)
        .order('sdi_response->>verificato_il', { ascending: true, nullsFirst: true })
        .order('sdi_sent_at', { ascending: false, nullsFirst: false })
        .limit(quante)
    if (error) {
        // La riverifica e' un di piu': se la query non passa, il giro
        // delle fatture in attesa resta quello di sempre.
        console.warn('[SDI Poll] riverifica accettate saltata:', error.message)
        return []
    }
    return (data || []) as RigaVerificaSdi[]
}

export interface EsitoVerifica {
    cambiato: boolean
    da: string | null
    a: string | null
    statoAruba: string
    riconosciuto: boolean
}

/**
 * Legge UNA fattura su Aruba (getByFilename, sola lettura) e allinea la riga.
 * Scrive sempre lo stato Aruba testuale e l'ora della verifica; cambia
 * sdi_status solo se Aruba dice altro. Mai reinvii, mai nuove fatture.
 */
export async function verificaFatturaSuAruba(invoice: RigaVerificaSdi): Promise<EsitoVerifica> {
    const lookupFilename = invoice.aruba_upload_filename || invoice.xml_filename || ''
    if (!lookupFilename) throw new Error('fattura mai caricata su Aruba (nome file mancante)')
    const remoteInvoice = await checkArubaStatus(lookupFilename)
    const esito = decidiAggiornamento(invoice, remoteInvoice)
    const { error: errUpd } = await supabase.from('fatture').update(esito.patch).eq('id', invoice.id)
    if (errUpd) throw new Error(`DB update: ${errUpd.message}`)
    if (esito.cambiaStato) {
        await supabase.from('invoice_status_logs').insert({
            invoice_id: invoice.id,
            status: esito.a,
            message: esito.motivo
                ? `Stato Aruba: ${esito.statoAruba} (era ${esito.da}) - ${esito.motivo}`
                : `Stato Aruba: ${esito.statoAruba} (era ${esito.da})`,
            raw_response: remoteInvoice,
        })
    }
    return { cambiato: esito.cambiaStato, da: esito.da, a: esito.a, statoAruba: esito.statoAruba, riconosciuto: esito.riconosciuto }
}

export async function pollAllPendingSdi(): Promise<PollResult> {
    const { data: pendingInvoices, error: fetchError } = await supabase
        .from('fatture')
        .select(COLONNE_VERIFICA_SDI)
        // Oldest sdi_sent_at first → we don't leave ancient sending invoices
        // perpetually behind newer ones each invocation.
        .in('sdi_status', ['sending', 'sent'])
        .not('xml_filename', 'is', null)
        .order('sdi_sent_at', { ascending: true, nullsFirst: true })
        .limit(MAX_PER_INVOCATION)

    if (fetchError) {
        throw new Error(`DB fetch error: ${fetchError.message}`)
    }
    const daControllare: RigaVerificaSdi[] = [...((pendingInvoices || []) as RigaVerificaSdi[])]
    daControllare.push(...await accettateDaRiverificare(MAX_PER_INVOCATION - daControllare.length))
    if (daControllare.length === 0) {
        return { success: true, checked: 0, updated: 0, errors: 0, transitions: [] }
    }

    let updated = 0
    let errors = 0
    let checked = 0
    const transitions: PollResult['transitions'] = []
    const errorSamples: NonNullable<PollResult['errorSamples']> = []
    const unknownStatuses: NonNullable<PollResult['unknownStatuses']> = []

    for (let i = 0; i < daControllare.length; i++) {
        const invoice = daControllare[i]
        if (i > 0) await sleep(ARUBA_THROTTLE_MS) // throttle between Aruba calls
        try {
            const esito = await verificaFatturaSuAruba(invoice)
            checked++
            if (!esito.riconosciuto && esito.statoAruba && unknownStatuses.length < 8) {
                unknownStatuses.push({ numero: invoice.numero_fattura || '', remoteStatus: esito.statoAruba })
            }
            if (esito.cambiato) {
                transitions.push({ id: invoice.id, numero: invoice.numero_fattura || '', from: esito.da || '', to: esito.a || '' })
                updated++
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`[SDI Poll] error on ${invoice.numero_fattura}:`, msg)
            errors++
            if (errorSamples.length < 10) {
                errorSamples.push({
                    numero: invoice.numero_fattura || '',
                    filename: invoice.aruba_upload_filename || invoice.xml_filename || '(missing)',
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
        checked,
        updated,
        errors,
        transitions,
        ...(errorSamples.length > 0 ? { errorSamples } : {}),
        ...(unknownStatuses.length > 0 ? { unknownStatuses } : {}),
    }
}
