/**
 * Bulk reconciler — pulls the FULL list of outgoing invoices from Aruba
 * (paginated) and updates our DB to match. Used when one-by-one polling
 * has fallen behind (e.g. after rate-limit incidents) and admin wants to
 * sync the whole truth in one shot.
 *
 * Unlike check-sdi-statuses (which polls only sending/sent), this endpoint
 * reconciles ALL fatture in our DB regardless of current sdi_status —
 * so a fattura that was scartata on Aruba but still labelled "sending"
 * (or "accepted") locally gets corrected.
 *
 * 07/11/2026: il bottone "Riconcilia con Aruba" non correggeva niente.
 *  - la lista Aruba arriva in `content` (pagina Spring), qui si leggevano
 *    solo `invoices` / `results` / `data`: zero righe, "Gia' allineato";
 *  - lo stato si leggeva in cima alla riga (`status`), Aruba lo mette in
 *    `invoices[0].status` (stessa forma di getByFilename);
 *  - la traduzione degli stati era una copia a parte.
 * Ora lettura e traduzione vengono da utils/statoSdiAruba.ts, e la risposta
 * dice quante righe Aruba ha davvero restituito e quante ne ha abbinate.
 * Le pagine di findByUsername partono da 1 (verificato sulle ricevute il
 * 01/09/2026): page=0 restituisce lo stesso blocco di page=1, quindi si
 * deduplica per nome file.
 *
 * Solo lettura verso Aruba: nessun reinvio, nessuna fattura nuova.
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { searchOutgoingInvoices } from './aruba-utils'
import { decidiAggiornamento, nomeFileAruba, righeListaAruba, type FatturaLocale } from './utils/statoSdiAruba'

const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
)

type RigaLocale = FatturaLocale & { xml_filename?: string | null; aruba_upload_filename?: string | null }

export const handler: Handler = async () => {
    const PAGE_SIZE = 100
    // Funzione sincrona (timeout Netlify): le pagine restano poche. Per
    // rileggere TUTTE le fatture una per una c'e' riallinea-sdi-aruba-background.
    const MAX_PAGES = 15
    const updates = new Map<string, { from: string | null; to: string | null; remoteStatus: string; patch: Record<string, unknown> }>()
    const unknown: { numero: string; remoteStatus: string }[] = []
    let pagesFetched = 0
    let totalRemote = 0
    let abbinate = 0
    let firstError: string | null = null
    const viste = new Set<string>()

    try {
        // Build filename → fattura row index from our DB (paginato: PostgREST
        // si ferma a 1000 righe per richiesta).
        const byFilename = new Map<string, RigaLocale>()
        for (let da = 0; ; da += 1000) {
            const { data: localRows, error: localErr } = await supabase
                .from('fatture')
                .select('id, numero_fattura, xml_filename, aruba_upload_filename, sdi_status, customer_tax_code, customer_vat, sdi_response')
                .or('xml_filename.not.is.null,aruba_upload_filename.not.is.null')
                .order('id', { ascending: true })
                .range(da, da + 999)
            if (localErr) throw new Error('DB load: ' + localErr.message)
            for (const r of (localRows || []) as RigaLocale[]) {
                // Una fattura riportata in bozza per il reinvio non e' piu'
                // quella del file vecchio: non la si tocca.
                if (!r.sdi_status || r.sdi_status === 'draft') continue
                if (r.aruba_upload_filename) byFilename.set(r.aruba_upload_filename, r)
                if (r.xml_filename) byFilename.set(r.xml_filename, r)
            }
            if (!localRows || localRows.length < 1000) break
        }

        // Walk Aruba pages until exhausted or cap reached. Si parte da 0: se
        // Aruba numera da 1, page=0 ripete il primo blocco e la deduplica per
        // nome file lo scarta; se numera da 0 non si perde la prima pagina.
        let pagineSenzaNovita = 0
        for (let page = 0; page < MAX_PAGES; page++) {
            const result = await searchOutgoingInvoices({ page, pageSize: PAGE_SIZE })
            pagesFetched++
            const list = righeListaAruba(result)
            if (!list.length) break
            let nuove = 0

            for (const inv of list) {
                const filename = nomeFileAruba(inv)
                if (!filename || viste.has(filename)) continue
                viste.add(filename)
                nuove++
                totalRemote++
                const local = byFilename.get(filename)
                if (!local) continue
                abbinate++
                const esito = decidiAggiornamento(local, inv)
                if (!esito.riconosciuto) {
                    if (unknown.length < 10) unknown.push({ numero: local.numero_fattura || '', remoteStatus: esito.statoAruba })
                    continue
                }
                if (esito.cambiaStato) {
                    updates.set(local.id, { from: esito.da, to: esito.a, remoteStatus: esito.statoAruba, patch: esito.patch })
                }
            }

            // If page returned fewer than PAGE_SIZE, we hit the end.
            if (list.length < PAGE_SIZE) break
            if (result?.last === true) break
            if (typeof result?.totalPages === 'number' && page >= result.totalPages) break
            // Aruba che ignora il numero di pagina rimanda sempre le stesse
            // righe: due pagine di fila senza niente di nuovo = fine.
            pagineSenzaNovita = nuove === 0 ? pagineSenzaNovita + 1 : 0
            if (pagineSenzaNovita >= 2) break
        }

        // Apply updates. La patch porta stato, stato Aruba testuale, motivo
        // dello scarto e il reset della notifica (solo per gli scarti).
        // A gruppi di 10 in parallelo: con 100+ cambi uno alla volta si
        // sforava il tempo della function.
        const voci = Array.from(updates.entries())
        for (let i = 0; i < voci.length; i += 10) {
            await Promise.all(voci.slice(i, i + 10).map(async ([id, t]) => {
                const { error } = await supabase.from('fatture').update(t.patch).eq('id', id)
                if (error) {
                    console.warn('[reconcile-sdi] update failed', id, error.message)
                    return
                }
                await supabase.from('invoice_status_logs').insert({
                    invoice_id: id,
                    status: t.to,
                    message: `Riconciliazione Aruba: ${t.remoteStatus} (era ${t.from})`,
                    raw_response: { stato_aruba: t.remoteStatus },
                })
            }))
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
            abbinate,
            updated: updates.size,
            transitions,
            unknown,
        }),
    }
}
