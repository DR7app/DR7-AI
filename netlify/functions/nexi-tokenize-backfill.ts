/**
 * One-shot backfill: walk every successful Nexi transaction, fetch card
 * details from Nexi's /operations endpoint, and write
 * (nexi_contract_id, nexi_card_masked_pan, ...) into the matching customer.
 *
 * Use to recover cards from before the callback's customer matching was
 * fixed (where the callback fired but couldn't find a customer due to
 * email casing or phone format mismatches).
 *
 * Body: { dryRun?: boolean, limit?: number }
 *   - dryRun=true (default): just reports what would be saved, no writes
 *   - dryRun=false: actually writes to customers_extended.metadata
 *
 * Skips transactions whose customer already has a saved nexi_contract_id.
 */
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { requireAuth } from './require-auth'
import { getCorsOrigin } from './cors-headers'
import { fetchNexiCardInfo } from './utils/nexiCardInfo'
import { lookupBin as lookupBinShared } from './utils/binLookup'
import { applyTokenizedCardUpdate, listCards } from './utils/nexiCards'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)
const NEXI_API_KEY = process.env.NEXI_API_KEY!
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'

async function fetchOperationByOrderId(orderId: string): Promise<any> {
    try {
        const r = await fetch(`${NEXI_BASE_URL}/orders/${orderId}/operations`, {
            headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': randomUUID() },
        })
        if (!r.ok) return null
        const data = await r.json()
        const ops = data?.operations || []
        return ops.find((o: any) => o.operationResult === 'EXECUTED' || o.operationResult === 'AUTHORIZED') || ops[0]
    } catch { return null }
}

// fetchOperationDetails removed — replaced by the shared fetchNexiCardInfo
// helper which retries and falls back to /orders/{orderId}/operations.

// Delegata a binLookup.ts (tabella locale + binlist.net fallback) per evitare
// che il 429 di binlist.net lasci nexi_card_type vuoto sul backfill.
async function lookupBin(bin: string): Promise<{ type: string; brand: string } | null> {
    const r = await lookupBinShared(bin)
    return r ? { type: r.type, brand: r.brand } : null
}

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    }
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{"error":"Method not allowed"}' }

    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    const { dryRun = true, limit = 500 } = JSON.parse(event.body || '{}')

    // 1. Pull every successful transaction that has no contract_id stored on the
    //    matching customer (we'd be re-doing work otherwise).
    const { data: txs } = await supabase
        .from('nexi_transactions')
        .select('id, order_id, contract_id, customer_email, booking_id, metadata, status')
        .in('status', ['completed', 'paid', 'authorized', 'captured', 'succeeded'])
        .order('created_at', { ascending: false })
        .limit(limit)

    if (!txs || txs.length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, scanned: 0, saved: 0, skipped: 0, results: [] }) }
    }

    const results: Array<{ orderId: string; email: string; status: string; detail?: string }> = []
    let saved = 0
    let skipped = 0
    let nexiNotFound = 0
    let customerNotFound = 0

    for (const tx of txs) {
        const orderId = tx.order_id
        const email = (tx.customer_email || '').trim()

        // Find customer — priority: id → phone → email. Phone is the
        // primary key in this dataset; the previous order put email first
        // and missed customers whose email wasn't on the booking row.
        let cust: { id: string; metadata: any } | null = null

        const matchByPhone = async (rawPhone: string | null | undefined): Promise<typeof cust> => {
            const digits = String(rawPhone || '').replace(/[^0-9]/g, '')
            if (digits.length < 10) return null
            const last10 = digits.slice(-10)
            const ilikeRes = await supabase
                .from('customers_extended')
                .select('id, metadata, telefono')
                .ilike('telefono', `%${last10}%`)
                .limit(1)
                .maybeSingle()
            if (ilikeRes.data) return { id: ilikeRes.data.id, metadata: ilikeRes.data.metadata }
            // Fallback: JS-compare digit-normalized telefono — handles phones
            // stored with spaces / dots / international format that ilike
            // can't substring-match.
            const { data: candidates } = await supabase
                .from('customers_extended')
                .select('id, metadata, telefono')
                .not('telefono', 'is', null)
                .order('updated_at', { ascending: false })
                .limit(5000)
            const hit = (candidates || []).find(row => {
                const stored = String(row.telefono || '').replace(/[^0-9]/g, '')
                return stored.endsWith(last10) || last10.endsWith(stored.slice(-10))
            })
            return hit ? { id: hit.id, metadata: hit.metadata } : null
        }

        if (tx.booking_id) {
            const { data: b } = await supabase
                .from('bookings')
                .select('booking_details, customer_email, customer_phone')
                .eq('id', tx.booking_id)
                .maybeSingle()
            const bd = b?.booking_details || {}
            const cId = bd.customer?.customerId || bd.customer?.id || bd.customer_id
            if (cId) {
                const { data: c } = await supabase.from('customers_extended').select('id, metadata').eq('id', cId).maybeSingle()
                if (c) cust = c
            }
            if (!cust && b?.customer_phone) {
                cust = await matchByPhone(b.customer_phone)
            }
            if (!cust && b?.customer_email) {
                const { data: c } = await supabase.from('customers_extended').select('id, metadata').ilike('email', b.customer_email).maybeSingle()
                if (c) cust = c
            }
        }
        if (!cust && email) {
            const { data: c } = await supabase.from('customers_extended').select('id, metadata').ilike('email', email).maybeSingle()
            if (c) cust = c
        }

        // No customer match isn't fatal — we still want the PAN to land on
        // the transaction row so the tokenized-cards UI surfaces it.
        // Below we fall through; the customers_extended write is gated on
        // `cust` later.

        // Skip only when the row already has BOTH a contract id AND a
        // masked pan AND brand+type. Previously we skipped as soon as the
        // PAN was saved, which left cards with empty nexi_card_type /
        // nexi_card_brand stuck without their financial type (cred/deb/
        // prepaid) and brand (Visa/MC). Direzione's complaint 2026-06-02:
        // "tante carte nel tab Nexi senza tipo". Now we re-fetch when
        // either type or brand is missing.
        const existingContract = cust?.metadata?.nexi_contract_id
        const txMeta = (tx.metadata || {}) as Record<string, unknown>
        const txAlreadyHasPan = typeof txMeta.nexi_card_masked_pan === 'string' && (txMeta.nexi_card_masked_pan as string).length > 0
        const custMeta = (cust?.metadata || {}) as Record<string, unknown>
        const custHasType = typeof custMeta.nexi_card_type === 'string' && (custMeta.nexi_card_type as string).length > 0
        const custHasBrand = typeof custMeta.nexi_card_brand === 'string' && (custMeta.nexi_card_brand as string).length > 0
        const txHasType = typeof txMeta.nexi_card_type === 'string' && (txMeta.nexi_card_type as string).length > 0
        const txHasBrand = typeof txMeta.nexi_card_brand === 'string' && (txMeta.nexi_card_brand as string).length > 0
        // Multi-card: non saltare se questa carta (tx.contract_id) NON è ancora
        // nell'array nexi_cards del cliente — va aggiunta anche se i campi flat
        // sono già pieni per un'ALTRA carta. (Caso Fofana: piu' carte usate, ma
        // solo l'ultima salvata sul profilo perche' prima si sovrascriveva.)
        const inArray = !cust || listCards(cust.metadata).some(c => c.contractId === tx.contract_id)
        const fullyPopulated = (!cust || (existingContract && custMeta.nexi_card_masked_pan && custHasType && custHasBrand))
            && txAlreadyHasPan && txHasType && txHasBrand && inArray
        if (fullyPopulated) {
            skipped++
            continue
        }

        // Fetch card data from Nexi via the robust helper (retries the
        // operation endpoint, then falls back to /orders/{orderId}/operations).
        const op = await fetchOperationByOrderId(orderId)
        const card = await fetchNexiCardInfo(NEXI_API_KEY, {
            operationId: op?.operationId,
            orderId,
        })
        if (!card) {
            nexiNotFound++
            results.push({ orderId, email, status: 'no_nexi_details' })
            continue
        }

        const maskedPan = card.maskedPan
        const circuit = card.circuit
        const cardType = card.cardType
        let binType = ''
        let binBrand = ''
        // 2026-06-04: stesso fix di nexi-payment-callback — usa il BIN
        // esposto da pickCardFields (non solo le prime 6 cifre del PAN
        // mascherato, che falliscono quando Nexi torna "**** **** **** 1234").
        const binForLookup = card.bin
            || (maskedPan && /^\d{6}/.test(maskedPan.trim()) ? maskedPan.trim().substring(0, 6) : '')
        if (binForLookup && binForLookup.length >= 4) {
            const bin = await lookupBin(binForLookup)
            if (bin) { binType = bin.type; binBrand = bin.brand }
        }

        const contractIdToSave = op?.additionalData?.contractId
            || op?.additionalData?.recurringContractId
            || tx.contract_id
            || orderId

        const metadataUpdate = {
            nexi_contract_id: contractIdToSave,
            nexi_contract_updated: new Date().toISOString(),
            nexi_card_masked_pan: maskedPan,
            nexi_card_circuit: circuit,
            nexi_card_type: cardType || binType,
            nexi_card_brand: binBrand || circuit,
            nexi_card_bin: binForLookup || '',
            nexi_card_updated: new Date().toISOString(),
        }

        if (dryRun) {
            results.push({ orderId, email, status: cust ? 'would_save' : 'would_save_tx_only', detail: `${maskedPan} (${circuit})` })
        } else {
            if (cust) {
                // UPSERT nell'array nexi_cards (NON sovrascrivere): aggiunge la
                // carta senza cambiare la predefinita. Cosi' recuperiamo TUTTE
                // le carte storiche del cliente, non solo l'ultima.
                await supabase
                    .from('customers_extended')
                    .update({ metadata: applyTokenizedCardUpdate(cust.metadata, metadataUpdate, { makeDefault: false }), updated_at: new Date().toISOString() })
                    .eq('id', cust.id)
            } else {
                // No matching customer: log it but still write to the
                // transaction so the admin can see the card in the UI.
                customerNotFound++
            }
            // Always stamp on nexi_transactions so the tokenized-cards UI
            // can surface the PAN even when customer matching fails.
            await supabase
                .from('nexi_transactions')
                .update({
                    metadata: { ...(tx.metadata || {}), ...metadataUpdate },
                    updated_at: new Date().toISOString(),
                })
                .eq('id', tx.id)
            saved++
            results.push({ orderId, email, status: cust ? 'saved' : 'saved_tx_only', detail: `${maskedPan} (${circuit})` })
        }
    }

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
            ok: true,
            mode: dryRun ? 'dry_run' : 'apply',
            scanned: txs.length,
            saved: dryRun ? 0 : saved,
            would_save: dryRun ? results.filter(r => r.status === 'would_save').length : 0,
            skipped,
            no_customer_match: customerNotFound,
            no_nexi_data: nexiNotFound,
            results: results.slice(0, 200),
        }),
    }
}
