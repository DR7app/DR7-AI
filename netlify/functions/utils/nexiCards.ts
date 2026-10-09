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
    /**
     * 09/10/2026: altri contratti Nexi della STESSA carta (stesso BIN e stesse
     * ultime 4 cifre). Ogni link di pagamento crea un contratto nuovo anche se
     * il cliente usa la stessa carta: prima ognuno diventava una carta a se'
     * (Michele Concas: 5 voci, 2 carte vere). Il contractId principale e' il
     * piu' vecchio, gia' provato; gli altri restano qui per non perderli.
     */
    altContractIds?: string[]
    /**
     * 09/10/2026: contratto senza token su Nexi (pagamenti dal 01/09 al
     * 09/10 senza blocco recurrence, o fallback senza tokenizzazione). Un
     * addebito su questo contratto fallisce: nel raggruppamento non diventa
     * mai il principale se la carta ne ha uno buono.
     */
    nonAddebitabile?: boolean
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
    nonAddebitabile: 'nexi_card_non_addebitabile',
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
        ...(meta[FLAT.nonAddebitabile] === true ? { nonAddebitabile: true } : {}),
        isDefault: true,
    }
}

/**
 * Chiave "stessa carta": prime 6 + ultime 4 cifre del PAN mascherato.
 * Vuota quando il BIN non e' visibile (`***5262`): sole 4 cifre non bastano,
 * due carte diverse possono finire con le stesse.
 */
export function chiaveCarta(maskedPan: string | undefined): string {
    const pan = String(maskedPan || '').replace(/\s/g, '')
    const m = pan.match(/^(\d{6})[*xX•]+(\d{4})$/)
    return m ? `${m[1]}-${m[2]}` : ''
}

const tempo = (c: NexiCard) => new Date(c.addedAt || c.lastUsedAt || 0).getTime()

/**
 * Unisce le voci con la stessa carta. Resta il contratto piu' vecchio; gli
 * altri vanno in altContractIds. La carta e' predefinita se lo era una delle
 * voci unite.
 */
export function raggruppaCarte(cards: NexiCard[]): NexiCard[] {
    // Prima i contratti con token vero, poi dal piu' vecchio: il principale e'
    // quello che un addebito puo' davvero usare.
    const ordineAddedAt = [...cards].sort((a, b) =>
        Number(!!a.nonAddebitabile) - Number(!!b.nonAddebitabile) || tempo(a) - tempo(b))
    const perChiave = new Map<string, NexiCard>()
    const assorbite = new Set<NexiCard>()
    for (const c of ordineAddedAt) {
        const k = chiaveCarta(c.maskedPan)
        if (!k) continue
        const g = perChiave.get(k)
        if (!g) { perChiave.set(k, c); continue }
        assorbite.add(c)
        const unita: NexiCard = {
            ...g,
            circuit: g.circuit || c.circuit,
            cardType: g.cardType || c.cardType,
            cardTypeSource: g.cardTypeSource || c.cardTypeSource,
            cardTypeSetAt: g.cardTypeSetAt || c.cardTypeSetAt,
            brand: g.brand || c.brand,
            bin: g.bin || c.bin,
            lastUsedAt: [g.lastUsedAt, c.lastUsedAt].filter(isStr).sort().pop() || g.lastUsedAt,
            isDefault: !!(g.isDefault || c.isDefault),
            altContractIds: Array.from(new Set([...(g.altContractIds || []), c.contractId, ...(c.altContractIds || [])]))
                .filter(id => id !== g.contractId),
        }
        perChiave.set(k, unita)
    }
    const principali = new Map(Array.from(perChiave.values()).map(c => [c.contractId, c]))
    return cards
        .filter(c => !assorbite.has(c))
        .map(c => principali.get(c.contractId) || c)
}

/** Indice della carta che possiede questo contratto (principale o unito). */
function indiceContratto(cards: NexiCard[], contractId: string): number {
    return cards.findIndex(c => c.contractId === contractId || (c.altContractIds || []).includes(contractId))
}

/** Read the cards array, migrating on the fly from flat keys when absent. */
export function listCards(meta: Meta | null | undefined): NexiCard[] {
    const m = meta || {}
    const arr = Array.isArray(m.nexi_cards) ? (m.nexi_cards as NexiCard[]) : []
    const cleaned = raggruppaCarte(arr.filter(c => c && isStr(c.contractId)))
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
    if (def.nonAddebitabile) out[FLAT.nonAddebitabile] = true
    else delete out[FLAT.nonAddebitabile]
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
    const idx = indiceContratto(cards, contractId)
    let next: NexiCard[]
    if (idx >= 0) {
        // Merge: keep existing descriptive fields unless the update provides
        // a fresh (non-empty) value — so a contractId-only refresh never wipes
        // the masked PAN / type we already resolved.
        const prev = cards[idx]
        const merged: NexiCard = {
            ...prev,
            maskedPan: incoming.maskedPan || prev.maskedPan,
            circuit: incoming.circuit || prev.circuit,
            cardType: incoming.cardType || prev.cardType,
            cardTypeSource: incoming.cardTypeSource || prev.cardTypeSource,
            cardTypeSetAt: incoming.cardTypeSetAt || prev.cardTypeSetAt,
            brand: incoming.brand || prev.brand,
            bin: incoming.bin || prev.bin,
            nonAddebitabile: incoming.nonAddebitabile || prev.nonAddebitabile || undefined,
            lastUsedAt: incoming.lastUsedAt,
            addedAt: prev.addedAt || now,
        }
        next = cards.slice()
        next[idx] = merged
    } else {
        next = [...cards, { ...incoming, addedAt: now }]
    }
    // Stessa carta gia' salvata con un altro contratto: diventa una voce sola.
    next = raggruppaCarte(next)
    if (makeDefault) {
        const def = indiceContratto(next, contractId)
        next = next.map((c, i) => ({ ...c, isDefault: i === def }))
    }
    else if (!next.some(c => c.isDefault)) next = next.map((c, i) => ({ ...c, isDefault: i === 0 }))

    // Mirror the DEFAULT card → flat keys. We deliberately do NOT re-spread
    // flatUpdate on top: when this upsert is NOT for the default card (e.g. a
    // backfill adding a 2nd card), spreading its possibly-empty flat fields
    // would clobber the REAL default's flat PAN/type. The flat keys come solely
    // from mirrorDefaultToFlat (driven by whichever card is default).
    return mirrorDefaultToFlat(base, next)
}

/** Patch descriptive fields of one card (by contractId) — e.g. card-type resolution. */
export function updateCardFields(meta: Meta | null | undefined, contractId: string, patch: Partial<NexiCard>): Meta {
    const base = { ...(meta || {}) }
    if (!isStr(contractId)) return base
    const cards = listCards(base)
    const idx = indiceContratto(cards, contractId)
    if (idx < 0) return base
    const next = cards.slice()
    next[idx] = { ...next[idx], ...patch, contractId: next[idx].contractId }
    return mirrorDefaultToFlat(base, raggruppaCarte(next))
}

/** Remove a card by contractId; reassign default to the most-recent remaining. */
export function removeCard(meta: Meta | null | undefined, contractId: string): Meta {
    const base = { ...(meta || {}) }
    if (!isStr(contractId)) return base
    // Il contratto principale toglie la carta intera; uno unito toglie solo se stesso.
    let remaining = listCards(base)
        .filter(c => c.contractId !== contractId)
        .map(c => (c.altContractIds || []).includes(contractId)
            ? { ...c, altContractIds: (c.altContractIds || []).filter(id => id !== contractId) }
            : c)
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
    const idx = indiceContratto(cards, contractId)
    if (idx < 0) return base
    const next = cards.map((c, i) => ({ ...c, isDefault: i === idx }))
    return mirrorDefaultToFlat(base, next)
}
