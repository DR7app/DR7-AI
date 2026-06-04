/**
 * Manual override for a tokenized card's type (credit/debit/prepaid/unknown).
 *
 * Why this exists: Nexi's XPay API doesn't return `cardType` for tokenized
 * payments — their merchant dashboard shows it because they classify by BIN
 * internally, but the API only exposes circuit (VISA/MC/etc), not whether it
 * is credit or debit. BIN lookup via binlist.net is heavily rate-limited and
 * misses many European issuers. This endpoint lets direzione force the type
 * manually on a card the auto-detection couldn't classify.
 *
 * POST /.netlify/functions/nexi-set-card-type
 *   { "contractId": "P...", "cardType": "credit" | "debit" | "prepaid" | "unknown" }
 *
 * Writes the override into BOTH customers_extended.metadata.nexi_card_type
 * AND nexi_transactions.metadata.nexi_card_type for every row keyed by the
 * given contract_id, plus a `nexi_card_type_source: 'manual'` flag so the UI
 * can show that it was set by hand.
 */

import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'
import { getCorsOrigin } from './cors-headers'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    }

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    if (!supabaseUrl || !supabaseServiceKey) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Supabase config' }) }
    }

    let body: { contractId?: string; cardType?: string } = {}
    try {
        body = JSON.parse(event.body || '{}')
    } catch {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }
    }

    const contractId = String(body.contractId || '').trim()
    const cardTypeRaw = String(body.cardType || '').trim().toLowerCase()
    if (!contractId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'contractId required' }) }

    // Accept 'unknown' / '' to clear the override.
    const allowed = ['credit', 'debit', 'prepaid', 'unknown', '']
    if (!allowed.includes(cardTypeRaw)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: `cardType must be one of: ${allowed.filter(Boolean).join(', ')}` }) }
    }
    const cardType = cardTypeRaw === 'unknown' ? '' : cardTypeRaw

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const nowIso = new Date().toISOString()

    let customerRows = 0
    let txRows = 0

    // ── Customers extended: update every row whose metadata.nexi_contract_id matches.
    const { data: customers } = await supabase
        .from('customers_extended')
        .select('id, metadata')
        .eq('metadata->>nexi_contract_id', contractId)

    if (customers && customers.length > 0) {
        for (const c of customers) {
            const meta = (c.metadata || {}) as Record<string, unknown>
            const nextMeta = {
                ...meta,
                nexi_card_type: cardType,
                nexi_card_type_source: cardType ? 'manual' : '',
                nexi_card_type_set_at: cardType ? nowIso : '',
            }
            await supabase
                .from('customers_extended')
                .update({ metadata: nextMeta, updated_at: nowIso })
                .eq('id', c.id)
            customerRows++
        }
    }

    // ── Nexi transactions: same override propagated so the UI list endpoint
    //    (which also reads tx metadata as a fallback) picks it up immediately.
    const { data: txs } = await supabase
        .from('nexi_transactions')
        .select('id, metadata')
        .eq('contract_id', contractId)

    if (txs && txs.length > 0) {
        for (const t of txs) {
            const meta = (t.metadata || {}) as Record<string, unknown>
            const nextMeta = {
                ...meta,
                nexi_card_type: cardType,
                nexi_card_type_source: cardType ? 'manual' : '',
                nexi_card_type_set_at: cardType ? nowIso : '',
            }
            await supabase
                .from('nexi_transactions')
                .update({ metadata: nextMeta, updated_at: nowIso })
                .eq('id', t.id)
            txRows++
        }
    }

    if (customerRows === 0 && txRows === 0) {
        return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: `No customer or transaction found for contractId=${contractId}` }),
        }
    }

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, contractId, cardType: cardType || null, updatedCustomers: customerRows, updatedTransactions: txRows }),
    }
}

export { handler }
