/**
 * nexi-reconcile-preauth — riallinea le pre-autorizzazioni allo stato REALE su Nexi.
 *
 * Perche' esiste (2026-08-27): il callback non scriveva mai su nexi_transactions,
 * quindi una riga creata come 'pending_preauth' restava tale anche quando la carta
 * veniva RIFIUTATA. Nel tab Nexi appariva "Pre-autorizzato" su pagamenti falliti.
 * Questa funzione interroga Nexi ordine per ordine e corregge il DB.
 *
 * POST body:
 *   { "dryRun": true }            -> default: mostra cosa cambierebbe, non scrive
 *   { "dryRun": false }           -> applica le correzioni
 *   { "orderId": "..." }          -> un solo ordine
 *   { "limit": 200 }              -> quante righe esaminare (default 200)
 */
import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

// Sempre NEXI_API_KEY: NEXI_API_KEY_EXPLICIT restituisce 401.
const NEXI_API_KEY = process.env.NEXI_API_KEY!
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'
const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Stati "in sospeso" che vanno riverificati contro Nexi.
// 'failed' incluso dal 27/08/2026: il callback leggeva un campo inesistente
// (orderStatus.lastOperation) e marcava RIFIUTATE pre-autorizzazioni riuscite.
// Vanno riverificate contro Nexi per rimettere a posto le cauzioni.
const STATI_DA_VERIFICARE = ['pending_preauth', 'preauth_held', 'preauth_pending_link', 'failed']

type Esito = {
    order_id: string
    cliente: string | null
    importo: string
    stato_db: string
    stato_reale: string
    azione: 'nessuna' | 'corretto' | 'da_correggere' | 'errore'
    dettaglio?: string
}

async function statoRealeSuNexi(orderId: string) {
    const res = await fetch(`${NEXI_BASE_URL}/orders/${orderId}`, {
        headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': crypto.randomUUID() }
    })
    if (res.status === 404) return { nuovoStato: null as string | null, motivo: 'ordine sconosciuto su Nexi', operationId: null as string | null }
    if (!res.ok) throw new Error(`Nexi HTTP ${res.status}`)

    const d = await res.json()
    const os = d.orderStatus || {}
    const ops: any[] = d.operations || []
    const autorizzato = parseInt(os.authorizedAmount || '0')
    const incassato = parseInt(os.capturedAmount || '0')
    const rimborsato = parseInt(os.refundedAmount || '0')
    const opAuth = ops.find(o => o.operationType === 'AUTHORIZATION' && o.operationResult === 'AUTHORIZED')
    const operationId = opAuth?.operationId || ops[0]?.operationId || null

    if (incassato > 0) return { nuovoStato: 'preauth_captured', motivo: `incassati €${(incassato / 100).toFixed(2)}`, operationId }
    if (rimborsato > 0 || ops.some(o => ['VOID', 'CANCEL', 'REFUND'].includes(o.operationType))) {
        return { nuovoStato: 'preauth_voided', motivo: 'fondi rilasciati', operationId }
    }
    if (autorizzato > 0 && opAuth) return { nuovoStato: 'preauth_held', motivo: `bloccati €${(autorizzato / 100).toFixed(2)}`, operationId }
    if (ops.some(o => o.operationResult === 'DECLINED')) return { nuovoStato: 'failed', motivo: 'RIFIUTATA da Nexi', operationId }
    if (ops.length === 0) return { nuovoStato: null, motivo: 'nessun tentativo di pagamento', operationId: null }
    return { nuovoStato: 'failed', motivo: `nessuna autorizzazione valida (${os.lastOperationType || 'n/d'})`, operationId }
}

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    }
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) }

    const { dryRun = true, orderId = null, limit = 200 } = JSON.parse(event.body || '{}')

    let query = supabase
        .from('nexi_transactions')
        .select('id, order_id, status, amount_cents, customer_email, metadata')
        .not('order_id', 'like', 'REPORT_%')
        .order('created_at', { ascending: false })
        .limit(Math.min(Number(limit) || 200, 1000))

    query = orderId ? query.eq('order_id', orderId) : query.in('status', STATI_DA_VERIFICARE)

    const { data: righe, error } = await query
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }

    const esiti: Esito[] = []

    for (const riga of righe || []) {
        const base = {
            order_id: riga.order_id,
            cliente: riga.customer_email,
            importo: `€${((riga.amount_cents || 0) / 100).toFixed(2)}`,
            stato_db: riga.status,
        }
        try {
            const { nuovoStato, motivo, operationId } = await statoRealeSuNexi(riga.order_id)

            if (!nuovoStato || nuovoStato === riga.status) {
                esiti.push({ ...base, stato_reale: nuovoStato || riga.status, azione: 'nessuna', dettaglio: motivo })
                continue
            }

            if (dryRun) {
                esiti.push({ ...base, stato_reale: nuovoStato, azione: 'da_correggere', dettaglio: motivo })
                continue
            }

            await supabase.from('nexi_transactions').update({
                status: nuovoStato,
                metadata: {
                    ...(riga.metadata || {}),
                    riconciliato_il: new Date().toISOString(),
                    riconciliato_da: 'nexi-reconcile-preauth',
                    stato_precedente: riga.status,
                    motivo_riconciliazione: motivo,
                }
            }).eq('id', riga.id)

            // Riallinea anche la cauzione collegata: se non c'e' autorizzazione
            // valida, i riferimenti Nexi vanno tolti o il badge resta "Pre-autorizzata".
            const cauzioneId = (riga.metadata as any)?.cauzione_id || null
            if (cauzioneId) {
                if (nuovoStato === 'failed') {
                    await supabase.from('cauzioni').update({
                        nexi_transaction_id: null,
                        nexi_operation_id: null,
                        note: `Preautorizzazione RIFIUTATA (riconciliata con Nexi il ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}) - ${motivo}`,
                        updated_at: new Date().toISOString()
                    }).eq('id', cauzioneId)
                } else if (nuovoStato === 'preauth_held' && operationId) {
                    await supabase.from('cauzioni').update({
                        nexi_transaction_id: operationId,
                        nexi_operation_id: operationId,
                        stato: 'Attiva',
                        metodo: 'preautorizzazione',
                        note: `Preautorizzazione completata (fondi bloccati) - OpId: ${operationId} - ${motivo} - riconciliata con Nexi il ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`,
                        updated_at: new Date().toISOString()
                    }).eq('id', cauzioneId)
                }
            }

            esiti.push({ ...base, stato_reale: nuovoStato, azione: 'corretto', dettaglio: motivo })
        } catch (e: any) {
            esiti.push({ ...base, stato_reale: 'n/d', azione: 'errore', dettaglio: e.message })
        }
    }

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
            dryRun,
            esaminate: esiti.length,
            riepilogo: {
                rifiutate_marcate_preautorizzate: esiti.filter(e => e.stato_reale === 'failed' && e.azione !== 'nessuna').length,
                corrette: esiti.filter(e => e.azione === 'corretto').length,
                da_correggere: esiti.filter(e => e.azione === 'da_correggere').length,
                gia_allineate: esiti.filter(e => e.azione === 'nessuna').length,
                errori: esiti.filter(e => e.azione === 'errore').length,
            },
            esiti,
        }, null, 2)
    }
}
