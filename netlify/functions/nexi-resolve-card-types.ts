/**
 * Automatic card-type resolver for the Nexi tokenized-cards list.
 *
 * Direzione's ask: the credit / debit / prepaid type must be resolved
 * AUTOMATICALLY ("find it back from Nexi"), not picked by hand from the
 * inline dropdown. This endpoint does exactly that and persists the result
 * so subsequent loads are instant.
 *
 * For every tokenized card whose type is still unknown (and was NOT set
 * manually) it resolves the type in this order:
 *   1. BIN from the stored masked PAN — many Nexi PANs expose the first 6
 *      digits (e.g. "552854******6022"). lookupBin() classifies it from the
 *      local Italian issuer table (instant) or binlist.net (throttled).
 *   2. If the masked PAN hides the BIN, fetch it back from Nexi:
 *      fetchNexiCardInfo(orderId = contract_id) walks the order's operations
 *      and returns the BIN / circuit / (sometimes) cardType. We then either
 *      use Nexi's cardType directly or BIN-classify it.
 *
 * Writes nexi_card_type (+ circuit / brand / masked_pan when newly found)
 * into BOTH customers_extended.metadata AND nexi_transactions.metadata,
 * tagged nexi_card_type_source: 'auto'. Manual overrides ('manual') are
 * never touched.
 *
 * POST /.netlify/functions/nexi-resolve-card-types
 *   { "limit"?: number, "contractId"?: string }
 *   → { resolved: number, scanned: number, results: [...] }
 */

import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'
import { getCorsOrigin } from './cors-headers'
import { lookupBin } from './utils/binLookup'
import { fetchNexiCardInfo } from './utils/nexiCardInfo'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const NEXI_API_KEY = process.env.NEXI_API_KEY

// Hard cap on how many cards trigger a live Nexi/binlist round-trip per
// invocation, so the function stays well under the Netlify timeout. Local
// BIN classification (instant) is NOT capped — only network lookups are.
const MAX_NETWORK_LOOKUPS = 20

interface Candidate {
    contractId: string
    maskedPan: string
    circuit: string
    cardType: string
    cardTypeSource: string
    cardBrand: string
}

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

    let body: { limit?: number; contractId?: string } = {}
    try { body = JSON.parse(event.body || '{}') } catch { /* defaults */ }
    const limit = Math.max(1, Math.min(200, Number(body.limit) || 80))
    const onlyContractId = String(body.contractId || '').trim()

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const nowIso = new Date().toISOString()

    // ── Gather candidate cards from BOTH sources, keyed by contract_id. ──
    const byContract = new Map<string, Candidate>()

    const { data: customers } = await supabase
        .from('customers_extended')
        .select('metadata')
        .not('metadata->nexi_contract_id', 'is', null)
        .order('updated_at', { ascending: false })

    for (const c of (customers || []) as Record<string, unknown>[]) {
        const meta = (c.metadata || {}) as Record<string, unknown>
        const cid = String(meta.nexi_contract_id || '')
        if (!cid) continue
        if (onlyContractId && cid !== onlyContractId) continue
        if (!byContract.has(cid)) {
            byContract.set(cid, {
                contractId: cid,
                maskedPan: String(meta.nexi_card_masked_pan || ''),
                circuit: String(meta.nexi_card_circuit || ''),
                cardType: String(meta.nexi_card_type || ''),
                cardTypeSource: String(meta.nexi_card_type_source || ''),
                cardBrand: String(meta.nexi_card_brand || ''),
            })
        }
    }

    const { data: txs } = await supabase
        .from('nexi_transactions')
        .select('contract_id, metadata')
        .not('contract_id', 'is', null)
        .order('created_at', { ascending: false })

    for (const t of (txs || []) as Record<string, unknown>[]) {
        const cid = String(t.contract_id || '')
        if (!cid) continue
        if (onlyContractId && cid !== onlyContractId) continue
        const meta = (t.metadata || {}) as Record<string, unknown>
        const existing = byContract.get(cid)
        if (existing) {
            // Fill blanks from tx metadata (customers_extended row wins otherwise).
            if (!existing.maskedPan) existing.maskedPan = String(meta.masked_pan || meta.nexi_card_masked_pan || meta.payment_instrument || '')
            if (!existing.circuit) existing.circuit = String(meta.circuit || meta.nexi_card_circuit || meta.payment_circuit || '')
            if (!existing.cardType) {
                existing.cardType = String(meta.card_type || meta.nexi_card_type || '')
                existing.cardTypeSource = String(meta.nexi_card_type_source || existing.cardTypeSource)
            }
        } else {
            byContract.set(cid, {
                contractId: cid,
                maskedPan: String(meta.masked_pan || meta.nexi_card_masked_pan || meta.payment_instrument || ''),
                circuit: String(meta.circuit || meta.nexi_card_circuit || meta.payment_circuit || ''),
                cardType: String(meta.card_type || meta.nexi_card_type || ''),
                cardTypeSource: String(meta.nexi_card_type_source || ''),
                cardBrand: String(meta.card_brand || meta.nexi_card_brand || ''),
            })
        }
    }

    // Only the ones still unknown — and never override a manual choice.
    const unresolved = Array.from(byContract.values())
        .filter(c => !c.cardType && c.cardTypeSource !== 'manual')
        .slice(0, limit)

    const results: Array<{ contractId: string; cardType: string; brand: string; method: string }> = []
    let networkLookups = 0

    for (const card of unresolved) {
        let resolvedType = ''
        let resolvedBrand = card.cardBrand || ''
        let resolvedPan = card.maskedPan
        let resolvedCircuit = card.circuit
        let method = ''

        // 1. Classify from the masked PAN's BIN if it exposes leading digits.
        const panDigits = (card.maskedPan || '').trim()
        const hasVisibleBin = /^\d{6}/.test(panDigits)
        if (hasVisibleBin) {
            // Local table is instant; binlist fallback is throttled+cached.
            const isNetwork = networkLookups < MAX_NETWORK_LOOKUPS
            if (isNetwork) networkLookups++
            const bin = await lookupBin(panDigits.substring(0, 6))
            if (bin?.type) { resolvedType = bin.type; method = 'masked_pan_bin' }
            if (bin?.brand && !resolvedBrand) resolvedBrand = bin.brand
        }

        // 2. Fall back to Nexi: walk the order operations to recover the BIN /
        //    circuit / cardType, then BIN-classify if Nexi didn't give a type.
        if (!resolvedType && NEXI_API_KEY && networkLookups < MAX_NETWORK_LOOKUPS) {
            networkLookups++
            try {
                const info = await fetchNexiCardInfo(NEXI_API_KEY, { orderId: card.contractId })
                if (info) {
                    if (info.maskedPan && !resolvedPan) resolvedPan = info.maskedPan
                    if (info.circuit && !resolvedCircuit) resolvedCircuit = info.circuit
                    const nexiType = String(info.cardType || '').toLowerCase()
                    if (['credit', 'debit', 'prepaid'].includes(nexiType)) {
                        resolvedType = nexiType
                        method = 'nexi_cardtype'
                    } else if (info.bin) {
                        const bin = await lookupBin(info.bin)
                        if (bin?.type) { resolvedType = bin.type; method = 'nexi_bin' }
                        if (bin?.brand && !resolvedBrand) resolvedBrand = bin.brand
                    }
                }
            } catch (err) {
                console.warn('[nexi-resolve-card-types] Nexi fetch failed for', card.contractId, err)
            }
        }

        if (!resolvedType && !resolvedBrand && resolvedPan === card.maskedPan && resolvedCircuit === card.circuit) {
            // Nothing new learned — skip the write.
            continue
        }

        // ── Persist to both tables (only fields we actually learned). ──
        const patch: Record<string, unknown> = {}
        if (resolvedType) {
            patch.nexi_card_type = resolvedType
            patch.nexi_card_type_source = 'auto'
            patch.nexi_card_type_set_at = nowIso
        }
        if (resolvedBrand && !card.cardBrand) patch.nexi_card_brand = resolvedBrand
        if (resolvedPan && !card.maskedPan) patch.nexi_card_masked_pan = resolvedPan
        if (resolvedCircuit && !card.circuit) patch.nexi_card_circuit = resolvedCircuit

        if (Object.keys(patch).length === 0) continue

        // When a row already carries a MANUAL type, never overwrite the type
        // fields — only fill in the non-type extras (brand / pan / circuit).
        const TYPE_KEYS = ['nexi_card_type', 'nexi_card_type_source', 'nexi_card_type_set_at']
        const patchWithoutType = Object.fromEntries(
            Object.entries(patch).filter(([k]) => !TYPE_KEYS.includes(k))
        )

        const applyPatch = async (table: 'customers_extended' | 'nexi_transactions', id: string, meta: Record<string, unknown>) => {
            const usePatch = (meta.nexi_card_type_source === 'manual' && patch.nexi_card_type)
                ? patchWithoutType
                : patch
            if (Object.keys(usePatch).length === 0) return
            await supabase.from(table).update({ metadata: { ...meta, ...usePatch }, updated_at: nowIso }).eq('id', id)
        }

        const { data: custRows } = await supabase
            .from('customers_extended')
            .select('id, metadata')
            .eq('metadata->>nexi_contract_id', card.contractId)
        for (const r of (custRows || [])) {
            await applyPatch('customers_extended', String(r.id), (r.metadata || {}) as Record<string, unknown>)
        }

        const { data: txRows } = await supabase
            .from('nexi_transactions')
            .select('id, metadata')
            .eq('contract_id', card.contractId)
        for (const r of (txRows || [])) {
            await applyPatch('nexi_transactions', String(r.id), (r.metadata || {}) as Record<string, unknown>)
        }

        if (resolvedType) results.push({ contractId: card.contractId, cardType: resolvedType, brand: resolvedBrand, method })
    }

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
            scanned: unresolved.length,
            resolved: results.length,
            networkLookups,
            results,
        }),
    }
}

export { handler }
