/**
 * Returns the unified list of Nexi tokenized cards for the admin Nexi tab.
 *
 * Lives in a Netlify function (service-role) instead of being queried
 * directly from the client because RLS on `customers_extended` and
 * `nexi_transactions` was hiding rows from admins without read policies
 * for those tables — different operators saw different counts (e.g. 64
 * vs 27) for the same data. Going through the service role bypasses RLS
 * so every authenticated admin sees the same number.
 */

import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'
import { getCorsOrigin } from './cors-headers'
import { listCards } from './utils/nexiCards'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

interface CardPayment {
    order_id: string
    amount_cents: number
    status: string
    description: string
    paid_at: string
}

interface TokenizedCard {
    id: string
    full_name: string
    email: string
    phone: string
    contract_id: string
    masked_pan: string
    circuit: string
    card_type: string
    card_brand: string
    updated_at: string
    is_default: boolean
    paid_total_cents: number
    paid_count: number
    payments: CardPayment[]
}

const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json',
    }

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    if (!supabaseUrl || !supabaseServiceKey) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Supabase config' }) }
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    try {
        // Source 1 — customers_extended whose metadata holds a Nexi contract id.
        const { data: customers } = await supabase
            .from('customers_extended')
            .select('id, nome, cognome, email, telefono, metadata, updated_at')
            .not('metadata->nexi_contract_id', 'is', null)
            .order('updated_at', { ascending: false })

        // One row PER tokenized card. listCards() reads metadata.nexi_cards and,
        // for customers still on the legacy single-card shape, synthesizes one
        // card from the flat keys (migrate-on-read) — so old data shows too.
        const cards: TokenizedCard[] = (customers || []).flatMap((c: Record<string, unknown>) => {
            const meta = (c.metadata || {}) as Record<string, unknown>
            const fullName = [c.nome, c.cognome].filter(Boolean).join(' ') || ''
            return listCards(meta).map(card => ({
                id: `${String(c.id || '')}:${card.contractId}`,
                full_name: fullName,
                email: String(c.email || ''),
                phone: String(c.telefono || ''),
                contract_id: card.contractId,
                masked_pan: String(card.maskedPan || ''),
                circuit: String(card.circuit || ''),
                card_type: String(card.cardType || ''),
                card_brand: String(card.brand || ''),
                updated_at: String(card.lastUsedAt || card.addedAt || c.updated_at || ''),
                is_default: !!card.isDefault,
                paid_total_cents: 0,
                paid_count: 0,
                payments: [],
            }))
        })

        // Source 2 — nexi_transactions with a non-null contract_id and a
        // success status. We use this both to surface contracts that don't
        // have a customers_extended row AND to attach the payment history
        // to every card (Source 1 too). amount_cents/description/status come
        // from here.
        const knownContractIds = new Set(cards.map(c => c.contract_id).filter(Boolean))
        const { data: txs } = await supabase
            .from('nexi_transactions')
            .select('id, order_id, contract_id, customer_email, booking_id, amount_cents, status, description, metadata, created_at, updated_at, booking:bookings(customer_name, customer_phone)')
            .not('contract_id', 'is', null)
            .in('status', ['completed', 'paid', 'authorized', 'captured', 'succeeded'])
            .order('created_at', { ascending: false })

        for (const tx of (txs || []) as Record<string, unknown>[]) {
            const cid = String(tx.contract_id || '')
            if (!cid) continue
            const meta = (tx.metadata || {}) as Record<string, unknown>
            const booking = (tx.booking || {}) as Record<string, unknown>

            // Either attach this transaction to an existing card (Source 1)
            // or, if no Source 1 card exists for this contract_id, create a
            // new card row from the transaction itself.
            if (!knownContractIds.has(cid)) {
                knownContractIds.add(cid)
                cards.push({
                    id: `tx:${tx.id}`,
                    full_name: String(meta.customer_name || booking.customer_name || String(tx.customer_email || '').split('@')[0] || 'Cliente'),
                    email: String(tx.customer_email || ''),
                    phone: String(booking.customer_phone || ''),
                    contract_id: cid,
                    masked_pan: String(meta.masked_pan || meta.nexi_card_masked_pan || meta.payment_instrument || ''),
                    circuit: String(meta.circuit || meta.nexi_card_circuit || meta.payment_circuit || ''),
                    card_type: String(meta.card_type || meta.nexi_card_type || ''),
                    card_brand: String(meta.card_brand || meta.nexi_card_brand || ''),
                    updated_at: String(tx.updated_at || ''),
                    is_default: false,
                    paid_total_cents: 0,
                    paid_count: 0,
                    payments: [],
                })
            }
        }

        // Build a contract_id -> [transactions] map and attach to every card.
        // Sums amount_cents (Nexi stores cents), exposes the per-payment
        // breakdown so the UI can render an in-card history.
        const txByContract = new Map<string, CardPayment[]>()
        for (const tx of (txs || []) as Record<string, unknown>[]) {
            const cid = String(tx.contract_id || '')
            if (!cid) continue
            const list = txByContract.get(cid) || []
            list.push({
                order_id: String((tx as { order_id?: string }).order_id || ''),
                amount_cents: Number(tx.amount_cents || 0),
                status: String(tx.status || ''),
                description: String(tx.description || ''),
                paid_at: String(tx.created_at || tx.updated_at || ''),
            })
            txByContract.set(cid, list)
        }
        for (const card of cards) {
            const list = txByContract.get(card.contract_id) || []
            card.payments = list
            card.paid_count = list.length
            card.paid_total_cents = list.reduce((sum, p) => sum + (Number.isFinite(p.amount_cents) ? p.amount_cents : 0), 0)
        }

        // Sort the merged list so the most recently tokenized card is at the
        // top, regardless of which source it came from. Without this Source 1
        // (customers_extended) cards always appeared above Source 2
        // (nexi_transactions) cards, even when the latter were more recent.
        cards.sort((a, b) => {
            const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0
            const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0
            return tb - ta
        })

        return { statusCode: 200, headers, body: JSON.stringify({ cards }) }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[nexi-list-tokenized-cards] Error:', msg)
        return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) }
    }
}

export { handler }
