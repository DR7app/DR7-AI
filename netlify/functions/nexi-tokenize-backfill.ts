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

async function fetchOperationDetails(operationId: string): Promise<any> {
    try {
        const r = await fetch(`${NEXI_BASE_URL}/operations/${operationId}`, {
            headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': randomUUID() },
        })
        if (!r.ok) return null
        return await r.json()
    } catch { return null }
}

async function lookupBin(bin: string): Promise<{ type: string; brand: string } | null> {
    try {
        const r = await fetch(`https://lookup.binlist.net/${bin}`, { headers: { 'Accept-Version': '3' } })
        if (!r.ok) return null
        const d = await r.json()
        return { type: (d.type || '').toLowerCase(), brand: (d.scheme || '').toLowerCase() }
    } catch { return null }
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

        // Find customer (id from booking, then email, then phone)
        let cust: { id: string; metadata: any } | null = null

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
            if (!cust && b?.customer_email) {
                const { data: c } = await supabase.from('customers_extended').select('id, metadata').ilike('email', b.customer_email).maybeSingle()
                if (c) cust = c
            }
            if (!cust && b?.customer_phone) {
                const last10 = String(b.customer_phone).replace(/[^0-9]/g, '').slice(-10)
                if (last10.length === 10) {
                    const { data: c } = await supabase.from('customers_extended').select('id, metadata').ilike('telefono', `%${last10}%`).limit(1).maybeSingle()
                    if (c) cust = c
                }
            }
        }
        if (!cust && email) {
            const { data: c } = await supabase.from('customers_extended').select('id, metadata').ilike('email', email).maybeSingle()
            if (c) cust = c
        }

        if (!cust) {
            customerNotFound++
            results.push({ orderId, email, status: 'no_customer_match' })
            continue
        }

        // Skip if already has the same contract
        const existingContract = cust.metadata?.nexi_contract_id
        if (existingContract === orderId || (existingContract && cust.metadata?.nexi_card_masked_pan)) {
            skipped++
            continue
        }

        // Fetch card data from Nexi
        const op = await fetchOperationByOrderId(orderId)
        if (!op?.operationId) {
            nexiNotFound++
            results.push({ orderId, email, status: 'no_nexi_op' })
            continue
        }
        const details = await fetchOperationDetails(op.operationId)
        if (!details) {
            nexiNotFound++
            results.push({ orderId, email, status: 'no_nexi_details' })
            continue
        }

        const maskedPan = details?.paymentMethod?.maskedPan || details?.maskedPan || ''
        const circuit = details?.paymentMethod?.circuit || details?.paymentCircuit || ''
        const cardType = details?.paymentMethod?.cardType || ''
        let binType = ''
        let binBrand = ''
        if (maskedPan && maskedPan.length >= 6) {
            const bin = await lookupBin(maskedPan.substring(0, 6))
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
            nexi_card_updated: new Date().toISOString(),
        }

        if (dryRun) {
            results.push({ orderId, email, status: 'would_save', detail: `${maskedPan} (${circuit})` })
        } else {
            await supabase
                .from('customers_extended')
                .update({ metadata: { ...(cust.metadata || {}), ...metadataUpdate }, updated_at: new Date().toISOString() })
                .eq('id', cust.id)
            saved++
            results.push({ orderId, email, status: 'saved', detail: `${maskedPan} (${circuit})` })
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
