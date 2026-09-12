/**
 * nexi-preauth-allinea-cauzioni — la cauzione segue la verita' del tab Nexi.
 *
 * PERCHE' ESISTE (12/09/2026, caso "Cauzione Mercedes GLE 63 AMG - Roberto
 * Portas", order C03108f05mty85boa, €1.000).
 * Su Nexi i fondi erano regolarmente BLOCCATI e la riga del tab Nexi diceva
 * 'preauth_held', ma la cauzione era rimasta "Da incassare". Due buchi:
 *
 *  1. `nexi-preauth-callback` cerca la cauzione SOLO per `nexi_order_id`. Ogni
 *     nuovo link sovrascrive quel campo: se il cliente paga un link creato
 *     prima dell'ultimo, la ricerca non trova niente, il callback la tratta
 *     come pre-auth "standalone" e aggiorna solo `nexi_transactions`.
 *  2. `nexi-reconcile-preauth` tocca la cauzione solo quando CAMBIA lo stato
 *     della transazione. Se la transazione e' gia' 'preauth_held' non fa
 *     nulla, quindi non recupera mai una cauzione rimasta indietro.
 *
 * COSA FA. Per ogni riga di `nexi_transactions` legata a una cauzione
 * (`metadata.cauzione_id`) chiede a Nexi lo stato REALE dell'ordine e, se e
 * solo se i fondi risultano bloccati, porta la cauzione a
 * stato='Attiva' + metodo='preautorizzazione' + operationId: esattamente cio'
 * che scriverebbe il callback. Il badge diventa "Pre-autorizzata".
 *
 * COSA NON FA, di proposito:
 *  - non crea, non rinnova e non tocca nessun link di pagamento;
 *  - non incassa, non sblocca, non scrive `data_incasso`;
 *  - non declassa mai niente: puo' solo promuovere una cauzione rimasta
 *    indietro. Un esito incerto o una chiamata Nexi fallita = nessuna
 *    scrittura (fail-closed, vedi nexi-preauth-callback);
 *  - non manda messaggi al cliente: l'invio resta del callback, cosi' questa
 *    rete di sicurezza non puo' generare un WhatsApp a sorpresa;
 *  - non tocca una cauzione gia' chiusa (Incassata, Bloccata, Sbloccata,
 *    Restituita, Danno): quei soldi hanno gia' avuto una destinazione.
 *
 * Invocazione manuale:
 *   POST { "dryRun": true }            -> mostra cosa cambierebbe (default a mano)
 *   POST { "dryRun": false }           -> applica
 *   POST { "orderId": "C03108f05..." } -> un solo ordine
 *   POST { "cauzioneId": "..." }       -> una sola cauzione
 * con header Authorization contenente le ultime 12 cifre della service key.
 * Il giro schedulato (netlify.toml) applica sempre.
 */
import { getCorsOrigin } from './cors-headers'
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { fetchNexiOrderOutcome } from './utils/nexiOrderStatus'
import { conSystemControl } from './utils/systemControl'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
// Sempre NEXI_API_KEY: NEXI_API_KEY_EXPLICIT restituisce 401 sull'API XPay.
const NEXI_API_KEY = process.env.NEXI_API_KEY!

/**
 * Stati della transazione che possono nascondere una cauzione rimasta
 * indietro. 'preauth_held' e' il caso Portas (transazione giusta, cauzione no);
 * gli altri coprono le notifiche mai arrivate o arrivate storte. In tutti i
 * casi la promozione avviene solo se Nexi conferma i fondi bloccati.
 */
const STATI_DA_CONTROLLARE = [
    'pending_preauth',
    'preauth_pending_link',
    'preauth_held',
    'expired',
    'failed',
]

/** Stati cauzione terminali: i soldi hanno gia' avuto una destinazione. */
const STATI_CAUZIONE_CHIUSI = ['Incassata', 'Bloccata', 'Sbloccata', 'Restituita', 'Danno']

/** Quanto indietro guardare. Una pre-auth vive 7-30 giorni, 30 copre tutto. */
const GIORNI_INDIETRO = 30
/** Righe per giro: ogni riga e' una GET su Nexi, il cron ha 30s. */
const MAX_RIGHE = 40

type Esito = {
    order_id: string
    cauzione_id: string
    cliente: string | null
    importo: string
    stato_tx: string
    stato_nexi: string
    azione: 'allineata' | 'da_allineare' | 'gia_ok' | 'saltata' | 'errore'
    dettaglio?: string
}

const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    }
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }

    let body: Record<string, unknown> = {}
    try { body = JSON.parse(event.body || '{}') } catch { body = {} }

    // Il giro schedulato di Netlify arriva con `next_run` nel body: applica.
    // Qualsiasi altra chiamata e' manuale e va autenticata, con dryRun di
    // default per non far scrivere niente per sbaglio.
    const schedulato = typeof body.next_run === 'string'
    let dryRun = true
    if (schedulato) {
        dryRun = false
    } else {
        const auth = event.headers.authorization || event.headers.Authorization || ''
        if (!SERVICE_KEY || !auth.includes(SERVICE_KEY.slice(-12))) {
            return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) }
        }
        dryRun = body.dryRun !== false
    }

    const orderId = typeof body.orderId === 'string' ? body.orderId : null
    const cauzioneId = typeof body.cauzioneId === 'string' ? body.cauzioneId : null

    let query = supabase
        .from('nexi_transactions')
        .select('id, order_id, status, amount_cents, customer_email, metadata, created_at')
        .not('order_id', 'like', 'REPORT_%')
        .order('created_at', { ascending: false })
        .limit(MAX_RIGHE)

    if (orderId) {
        query = query.eq('order_id', orderId)
    } else if (cauzioneId) {
        query = query.filter('metadata->>cauzione_id', 'eq', cauzioneId)
    } else {
        query = query
            .in('status', STATI_DA_CONTROLLARE)
            .not('metadata->>cauzione_id', 'is', null)
            .gte('created_at', new Date(Date.now() - GIORNI_INDIETRO * 86400000).toISOString())
    }

    const { data: righe, error } = await query
    if (error) {
        console.error('[nexi-preauth-allinea-cauzioni] Query fallita:', error)
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    }

    const esiti: Esito[] = []

    for (const riga of righe || []) {
        const meta = (riga.metadata || {}) as Record<string, unknown>
        const idCauzione = (meta.cauzione_id as string) || null
        const base = {
            order_id: riga.order_id,
            cauzione_id: idCauzione || '-',
            cliente: riga.customer_email,
            importo: `EUR ${((riga.amount_cents || 0) / 100).toFixed(2)}`,
            stato_tx: riga.status,
        }
        if (!idCauzione) {
            // Pre-auth standalone (tab Nexi / tab Clienti): nessuna cauzione dietro.
            esiti.push({ ...base, stato_nexi: '-', azione: 'saltata', dettaglio: 'pre-auth senza cauzione' })
            continue
        }

        try {
            // Esito REALE, chiesto a Nexi. Unica fonte di verita'.
            const v = await fetchNexiOrderOutcome(riga.order_id, NEXI_API_KEY, 'nexi-preauth-allinea-cauzioni')
            if (!v) {
                esiti.push({ ...base, stato_nexi: 'n/d', azione: 'errore', dettaglio: 'Nexi non raggiungibile, nessuna scrittura' })
                continue
            }

            // Fondi BLOCCATI e non ancora toccati: l'unico caso che promuove.
            const fondiBloccati = v.operationResult === 'AUTHORIZED'
                && v.authorizedAmount > 0
                && v.capturedAmount === 0
                && v.refundedAmount === 0
                && !!v.operationId

            if (!fondiBloccati) {
                esiti.push({
                    ...base,
                    stato_nexi: v.operationResult,
                    azione: 'saltata',
                    dettaglio: `nessun fondo bloccato (autorizzati ${v.authorizedAmount}, incassati ${v.capturedAmount}, rimborsati ${v.refundedAmount})`,
                })
                continue
            }

            // L'importo autorizzato deve essere quello chiesto da QUESTO link.
            // Un'autorizzazione parziale non e' la garanzia che ci si aspetta:
            // meglio lasciarla a mano che dichiararla buona.
            if (riga.amount_cents && v.authorizedAmount !== riga.amount_cents) {
                esiti.push({
                    ...base,
                    stato_nexi: v.operationResult,
                    azione: 'saltata',
                    dettaglio: `importo diverso: autorizzati ${v.authorizedAmount} invece di ${riga.amount_cents}`,
                })
                continue
            }

            const { data: cauzione, error: errCauzione } = await supabase
                .from('cauzioni')
                .select('id, stato, metodo, nexi_transaction_id, nexi_operation_id, nexi_order_id')
                .eq('id', idCauzione)
                .maybeSingle()

            if (errCauzione || !cauzione) {
                esiti.push({ ...base, stato_nexi: v.operationResult, azione: 'saltata', dettaglio: 'cauzione non trovata' })
                continue
            }

            if (STATI_CAUZIONE_CHIUSI.includes(String(cauzione.stato))) {
                esiti.push({ ...base, stato_nexi: v.operationResult, azione: 'saltata', dettaglio: `cauzione gia' ${cauzione.stato}` })
                continue
            }

            const giaAllineata = String(cauzione.nexi_transaction_id || '') === String(v.operationId)
                && cauzione.metodo === 'preautorizzazione'
                && cauzione.stato === 'Attiva'
            if (giaAllineata) {
                esiti.push({ ...base, stato_nexi: v.operationResult, azione: 'gia_ok', dettaglio: 'cauzione gia\' pre-autorizzata' })
                continue
            }

            if (dryRun) {
                esiti.push({
                    ...base,
                    stato_nexi: v.operationResult,
                    azione: 'da_allineare',
                    dettaglio: `cauzione ${cauzione.stato}/${cauzione.metodo || 'n/d'} -> Attiva/preautorizzazione (op ${v.operationId})`,
                })
                continue
            }

            const importoStr = (v.authorizedAmount / 100).toFixed(2)
            const aggiornamento: Record<string, unknown> = {
                stato: 'Attiva',
                metodo: 'preautorizzazione',
                nexi_transaction_id: v.operationId,
                nexi_operation_id: v.operationId,
                note: `Preautorizzazione completata (fondi bloccati) - OpId: ${v.operationId} - Importo: EUR ${importoStr}`
                    + ` - allineata con Nexi il ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`,
                updated_at: new Date().toISOString(),
            }
            if (v.contractId) aggiornamento.nexi_contract_id = v.contractId
            // Il cliente ha pagato QUESTO link: se la cauzione puntava a un
            // link piu' recente, il riferimento va rimesso su quello vero,
            // altrimenti SBLOCCA e INCASSA lavorerebbero sull'ordine sbagliato.
            if (cauzione.nexi_order_id !== riga.order_id) aggiornamento.nexi_order_id = riga.order_id

            const { error: errUpdate } = await supabase.from('cauzioni').update(aggiornamento).eq('id', idCauzione)
            if (errUpdate) {
                esiti.push({ ...base, stato_nexi: v.operationResult, azione: 'errore', dettaglio: errUpdate.message })
                continue
            }

            // La riga del tab Nexi segue lo stesso esito (di solito e' gia'
            // 'preauth_held': si scrive solo quando serve).
            if (riga.status !== 'preauth_held') {
                await supabase.from('nexi_transactions').update({
                    status: 'preauth_held',
                    metadata: {
                        ...meta,
                        operation_result: v.operationResult,
                        operation_id: v.operationId,
                        allineato_il: new Date().toISOString(),
                        allineato_da: 'nexi-preauth-allinea-cauzioni',
                        stato_precedente: riga.status,
                    },
                }).eq('id', riga.id)
            }

            esiti.push({
                ...base,
                stato_nexi: v.operationResult,
                azione: 'allineata',
                dettaglio: `cauzione ${cauzione.stato}/${cauzione.metodo || 'n/d'} -> Attiva/preautorizzazione (EUR ${importoStr})`,
            })
            console.log(`[nexi-preauth-allinea-cauzioni] Cauzione ${idCauzione} allineata su order ${riga.order_id} (op ${v.operationId})`)
        } catch (e: unknown) {
            esiti.push({ ...base, stato_nexi: 'n/d', azione: 'errore', dettaglio: e instanceof Error ? e.message : String(e) })
        }
    }

    const riepilogo = {
        esaminate: esiti.length,
        allineate: esiti.filter(e => e.azione === 'allineata').length,
        da_allineare: esiti.filter(e => e.azione === 'da_allineare').length,
        gia_ok: esiti.filter(e => e.azione === 'gia_ok').length,
        saltate: esiti.filter(e => e.azione === 'saltata').length,
        errori: esiti.filter(e => e.azione === 'errore').length,
    }
    if (riepilogo.allineate > 0 || riepilogo.errori > 0) {
        console.log('[nexi-preauth-allinea-cauzioni]', JSON.stringify(riepilogo))
    }

    return { statusCode: 200, headers, body: JSON.stringify({ dryRun, ...riepilogo, esiti }, null, 2) }
}

// Battito per il System Control: se questa rete di sicurezza si ferma, si vede.
const handlerSorvegliato = conSystemControl('nexi-preauth-allinea-cauzioni', handler, { cron: true })
export { handlerSorvegliato as handler }
