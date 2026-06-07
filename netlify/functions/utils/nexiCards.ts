/**
 * Multi-card storage for tokenized Nexi cards on customers_extended.metadata.
 *
 * Background: historically we stored ONE tokenized card per customer as flat
 * keys on metadata (nexi_contract_id, nexi_card_masked_pan, nexi_card_circuit,
 * nexi_card_type, nexi_card_type_source, nexi_card_type_set_at, nexi_card_brand,
 * nexi_card_bin, nexi_contract_updated). Every new tokenization OVERWROTE that
 * single card, so a customer who paid with a 2nd card lost the 1st.
 *
 * This util introduces metadata.nexi_cards: NexiCard[] WITHOUT losing any data:
 *  - The flat keys are KEPT and always mirror the DEFAULT (most-recently-used)
 *    card, so every existing reader (charge-mit, nuovo-addebito, wallet
 *    auto-recharge, resolve-card-types, list-tokenized-cards) keeps working.
 *  - On read, if the array is missing we lazily synthesize it from the flat
 *    keys (migrate-on-read) — nothing is mutated until a write happens.
 *  - On write (applyTokenizedCardUpdate) we seed the array from the flat keys
 *    if needed, then upsert the incoming card by contractId.
 */

export interface NexiCard {
    contractId: string
    maskedPan?: string
    circuit?: string
    cardType?: string
    cardTypeSource?: string
    cardTypeSetAt?: string
    brand?: string
    bin?: string
    addedAt?: string
    lastUsedAt?: string
    isDefault?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Meta = Record<string, any>

const FLAT = {
    contractId: 'nexi_contract_id',
    maskedPan: 'nexi_card_masked_pan',
    circuit: 'nexi_card_circuit',
    cardType: 'nexi_card_type',
    cardTypeSource: 'nexi_card_type_source',
    cardTypeSetAt: 'nexi_card_type_set_at',
    brand: 'nexi_card_brand',
    bin: 'nexi_card_bin',
    lastUsedAt: 'nexi_contract_updated',
} as const

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/** Build a NexiCard from the legacy flat keys (the single stored card). */
function cardFromFlat(meta: Meta): NexiCard | null {
    const contractId = isStr(meta?.[FLAT.contractId]) ? String(meta[FLAT.contractId]) : ''
    if (!contractId) return null
    return {
        contractId,
        maskedPan: meta[FLAT.maskedPan] || undefined,
        circuit: meta[FLAT.circuit] || undefined,
        cardType: meta[FLAT.cardType] || undefined,
        cardTypeSource: meta[FLAT.cardTypeSource] || undefined,
        cardTypeSetAt: meta[FLAT.cardTypeSetAt] || undefined,
        brand: meta[FLAT.brand] || undefined,
        bin: meta[FLAT.bin] || undefined,
        lastUsedAt: meta[FLAT.lastUsedAt] || undefined,
        isDefault: true,
    }
}

/** Read the cards array, migrating on the fly from flat keys when absent. */
export function listCards(meta: Meta | null | undefined): NexiCard[] {
    const m = meta || {}
    const arr = Array.isArray(m.nexi_cards) ? (m.nexi_cards as NexiCard[]) : []
    const cleaned = arr.filter(c => c && isStr(c.contractId))
    if (cleaned.length > 0) {
        // Guarantee exactly one default.
        if (!cleaned.some(c => c.isDefault)) cleaned[0] = { ...cleaned[0], isDefault: true }
        return cleaned
    }
    const flat = cardFromFlat(m)
    return flat ? [flat] : []
}

/** Return the default card (the one mirrored to the flat keys), or null. */
export function getDefaultCard(meta: Meta | null | undefined): NexiCard | null {
    const cards = listCards(meta)
    return cards.find(c => c.isDefault) || cards[0] || null
}

/** Mirror the default card's fields onto the flat keys (backward compat). */
function mirrorDefaultToFlat(meta: Meta, cards: NexiCard[]): Meta {
    const out: Meta = { ...meta, nexi_cards: cards }
    const def = cards.find(c => c.isDefault) || cards[0]
    if (!def) {
        // No cards left — clear the flat keys so the customer reads as "no card".
        for (const k of Object.values(FLAT)) delete out[k]
        return out
    }
    out[FLAT.contractId] = def.contractId
    out[FLAT.lastUsedAt] = def.lastUsedAt || def.addedAt || new Date(0).toISOString()
    // Only mirror the descriptive fields that the default card actually has,
    // leaving the key absent (rather than empty) when unknown.
    const map: Array<[keyof NexiCard, string]> = [
        ['maskedPan', FLAT.maskedPan], ['circuit', FLAT.circuit], ['cardType', FLAT.cardType],
        ['cardTypeSource', FLAT.cardTypeSource], ['cardTypeSetAt', FLAT.cardTypeSetAt],
        ['brand', FLAT.brand], ['bin', FLAT.bin],
    ]
    for (const [field, flatKey] of map) {
        const v = def[field]
        if (isStr(v)) out[flatKey] = v
        else delete out[flatKey]
    }
    return out
}

/**
 * Upsert a tokenized card into metadata from a legacy "flat update" object
 * (the shape the callbacks already build: { nexi_contract_id, nexi_card_* }).
 * The matching card is added/merged by contractId and (by default) promoted to
 * the default card. Returns NEW metadata; never mutates the input.
 *
 * If the update carries no contractId it is merged as-is (no card change), so
 * callers can use this unconditionally.
 */
export function applyTokenizedCardUpdate(
    meta: Meta | null | undefined,
    flatUpdate: Meta,
    opts: { makeDefault?: boolean } = {},
): Meta {
    const base = { ...(meta || {}) }
    const contractId = isStr(flatUpdate?.[FLAT.contractId]) ? String(flatUpdate[FLAT.contractId]) : ''
    if (!contractId) {
        // No card in this update — preserve legacy behaviour (plain merge).
        return { ...base, ...flatUpdate }
    }
    const makeDefault = opts.makeDefault !== false
    const now = new Date().toISOString()
    const incoming = cardFromFlat({ ...flatUpdate, [FLAT.contractId]: contractId }) as NexiCard
    incoming.lastUsedAt = flatUpdate[FLAT.lastUsedAt] || flatUpdate.nexi_card_updated || now

    const cards = listCards(base)
    const idx = cards.findIndex(c => c.contractId === contractId)
    let next: NexiCard[]
    if (idx >= 0) {
        // Merge: keep existing descriptive fields unless the update provides
        // a fresh (non-empty) value — so a contractId-only refresh never wipes
        // the masked PAN / type we already resolved.
        const prev = cards[idx]
        const merged: NexiCard = {
            ...prev,
            contractId,
            maskedPan: incoming.maskedPan || prev.maskedPan,
            circuit: incoming.circuit || prev.circuit,
            cardType: incoming.cardType || prev.cardType,
            cardTypeSource: incoming.cardTypeSource || prev.cardTypeSource,
            cardTypeSetAt: incoming.cardTypeSetAt || prev.cardTypeSetAt,
            brand: incoming.brand || prev.brand,
            bin: incoming.bin || prev.bin,
            lastUsedAt: incoming.lastUsedAt,
            addedAt: prev.addedAt || now,
        }
        next = cards.slice()
        next[idx] = merged
    } else {
        next = [...cards, { ...incoming, addedAt: now }]
    }
    if (makeDefault) next = next.map(c => ({ ...c, isDefault: c.contractId === contractId }))
    else if (!next.some(c => c.isDefault)) next = next.map((c, i) => ({ ...c, isDefault: i === 0 }))

    // Mirror default → flat, then layer any extra non-card keys from flatUpdate
    // (e.g. nexi_card_bin, nexi_card_updated) so nothing the caller sent is lost.
    const mirrored = mirrorDefaultToFlat(base, next)
    const extra: Meta = { ...flatUpdate }
    return { ...mirrored, ...extra, nexi_cards: next }
}

/** Patch descriptive fields of one card (by contractId) — e.g. card-type resolution. */
export function updateCardFields(meta: Meta | null | undefined, contractId: string, patch: Partial<NexiCard>): Meta {
    const base = { ...(meta || {}) }
    if (!isStr(contractId)) return base
    const cards = listCards(base)
    const idx = cards.findIndex(c => c.contractId === contractId)
    if (idx < 0) return base
    const next = cards.slice()
    next[idx] = { ...next[idx], ...patch, contractId }
    return mirrorDefaultToFlat(base, next)
}

/** Remove a card by contractId; reassign default to the most-recent remaining. */
export function removeCard(meta: Meta | null | undefined, contractId: string): Meta {
    const base = { ...(meta || {}) }
    if (!isStr(contractId)) return base
    let remaining = listCards(base).filter(c => c.contractId !== contractId)
    if (remaining.length > 0 && !remaining.some(c => c.isDefault)) {
        // Promote the most-recently-used remaining card to default.
        const sorted = [...remaining].sort((a, b) =>
            new Date(b.lastUsedAt || b.addedAt || 0).getTime() - new Date(a.lastUsedAt || a.addedAt || 0).getTime())
        const top = sorted[0]?.contractId
        remaining = remaining.map(c => ({ ...c, isDefault: c.contractId === top }))
    }
    return mirrorDefaultToFlat(base, remaining)
}

/** Set the default card (the one mirrored to flat) by contractId. */
export function setDefaultCard(meta: Meta | null | undefined, contractId: string): Meta {
    const base = { ...(meta || {}) }
    const cards = listCards(base)
    if (!cards.some(c => c.contractId === contractId)) return base
    const next = cards.map(c => ({ ...c, isDefault: c.contractId === contractId }))
    return mirrorDefaultToFlat(base, next)
}
