/**
 * Robust card-info fetcher for Nexi tokenized payments.
 *
 * Why this exists:
 *   `/operations/{operationId}` sometimes returns the operation without a
 *   populated `paymentMethod.maskedPan` — in particular right after the
 *   callback fires (Nexi's eventual consistency) and for some payment
 *   instruments. The original callback called `/operations/{id}` once and
 *   silently dropped the PAN when it came back empty, so cards like
 *   Alessio Manzali's MC ended up in `nexi_transactions` with `contract_id`
 *   but no `nexi_card_masked_pan` ever stored — admin saw a card row in
 *   the UI without the masked number badge.
 *
 * Strategy:
 *   1. Retry `/operations/{operationId}` up to 3 times with backoff.
 *   2. Fall back to `/orders/{orderId}/operations`, which lists every
 *      operation on the order — for tokenized payments at least one of
 *      them carries the `paymentMethod` block.
 *   3. Final attempt: scan the order's `additionalData` for `maskedPan`.
 *
 * Returns null only when truly nothing is available (wallet payments
 * that never expose a PAN, e.g. Apple Pay / Google Pay tokens).
 */

import { randomUUID } from 'crypto'

const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'

export interface NexiCardInfo {
    maskedPan: string
    circuit: string
    cardType: string
    /**
     * 2026-06-04: BIN (first 6 digits) extracted from any field Nexi exposes.
     * Used by the callback to feed lookupBin(): the previous
     * `maskedPan.substring(0,6)` heuristic failed for tokenized PANs that
     * return as `**** **** **** 1234` (no BIN visible), leaving the card
     * "Sconosciuto" in the admin UI.
     */
    bin: string
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function pickCardFields(source: unknown): NexiCardInfo | null {
    if (!source || typeof source !== 'object') return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = source as any
    const maskedPan: string =
        s.paymentMethod?.maskedPan
        || s.maskedPan
        || s.additionalData?.maskedPan
        || s.paymentInstrument?.maskedPan
        || s.paymentInstrumentInfo
        || ''
    if (!maskedPan) return null
    const circuit: string =
        s.paymentMethod?.circuit
        || s.paymentCircuit
        || s.paymentInstrument?.circuit
        || s.additionalData?.cardCircuit
        || s.additionalData?.paymentCircuit
        || ''
    // 2026-06-04: prima cercavamo solo `paymentMethod.cardType` / `cardType`.
    // Nexi varia la struttura tra endpoint diversi (/operations, /orders/X,
    // /build/cardData), quindi ora controlliamo TUTTI i path noti. Senza
    // questo le carte tokenizzate finivano con cardType='' nel DB e la UI
    // mostrava "Sconosciuto" anche quando Nexi ha l'info su prepaid/debit/credit.
    const cardType: string =
        s.paymentMethod?.cardType
        || s.paymentMethod?.type
        || s.paymentInstrument?.cardType
        || s.paymentInstrument?.type
        || s.additionalData?.cardType
        || s.cardType
        || ''
    // BIN (first 6 digits). Lookup priority: any explicit `bin` field >
    // `cardBin` aliases > leading digits of the masked PAN (only when they
    // actually start with digits — `**** *` returns empty after digit-only
    // sanitisation).
    const explicitBin: string =
        s.paymentMethod?.bin
        || s.paymentMethod?.cardBin
        || s.paymentInstrument?.bin
        || s.bin
        || s.additionalData?.bin
        || s.additionalData?.cardBin
        || ''
    const panDigits = (maskedPan.match(/\d+/g) || []).join('')
    const binFromPan = panDigits.length >= 6 && /^\d{6}/.test(maskedPan.trim()) ? maskedPan.trim().substring(0, 6) : ''
    const bin = (explicitBin || binFromPan).replace(/\D/g, '').substring(0, 6)
    return { maskedPan, circuit, cardType, bin }
}

async function fetchOperationOnce(operationId: string, apiKey: string): Promise<unknown | null> {
    try {
        const res = await fetch(`${NEXI_BASE_URL}/operations/${operationId}`, {
            headers: { 'X-Api-Key': apiKey, 'Correlation-Id': randomUUID() },
        })
        if (!res.ok) return null
        return await res.json()
    } catch {
        return null
    }
}

async function fetchOrderOperations(orderId: string, apiKey: string): Promise<unknown[]> {
    try {
        const res = await fetch(`${NEXI_BASE_URL}/orders/${orderId}/operations`, {
            headers: { 'X-Api-Key': apiKey, 'Correlation-Id': randomUUID() },
        })
        if (!res.ok) return []
        const data = await res.json()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ops = (data as any)?.operations
        return Array.isArray(ops) ? ops : []
    } catch {
        return []
    }
}

/**
 * Returns the masked PAN / circuit / cardType for a tokenized Nexi payment.
 * Null when the payment instrument never exposes a PAN (rare — wallet flows).
 */
export async function fetchNexiCardInfo(
    apiKey: string,
    args: { operationId?: string | null; orderId?: string | null },
): Promise<NexiCardInfo | null> {
    const { operationId, orderId } = args

    // 1. Retry the operation endpoint a few times — Nexi sometimes lags by
    //    a couple of seconds after the callback fires.
    if (operationId) {
        for (const delayMs of [0, 800, 2500]) {
            if (delayMs > 0) await sleep(delayMs)
            const op = await fetchOperationOnce(operationId, apiKey)
            const card = pickCardFields(op)
            if (card) return card
        }
    }

    // 2. Fallback: walk every operation on the order. Pay-by-link orders
    //    typically have an AUTHORIZATION operation that carries the
    //    paymentMethod block even when the EXECUTED row doesn't.
    if (orderId) {
        const ops = await fetchOrderOperations(orderId, apiKey)
        for (const op of ops) {
            const card = pickCardFields(op)
            if (card) return card
        }
    }

    return null
}
