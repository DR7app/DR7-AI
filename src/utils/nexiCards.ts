/**
 * Frontend reader for the multi-card storage on customers_extended.metadata.
 * Mirrors netlify/functions/utils/nexiCards.ts (listCards): reads
 * metadata.nexi_cards and, for customers still on the legacy single-card
 * shape, synthesizes one card from the flat keys (migrate-on-read).
 *
 * Display/selection only — never written from the client.
 */

export interface NexiCardView {
    contractId: string
    maskedPan?: string
    circuit?: string
    cardType?: string
    brand?: string
    lastUsedAt?: string
    isDefault?: boolean
    altContractIds?: string[]
    nonAddebitabile?: boolean
}

// Stessa regola di netlify/functions/utils/nexiCards.ts (raggruppaCarte):
// una carta = stesse prime 6 e ultime 4 cifre; resta il contratto piu' vecchio.
function chiaveCarta(maskedPan: string | undefined): string {
    const m = String(maskedPan || '').replace(/\s/g, '').match(/^(\d{6})[*xX•]+(\d{4})$/)
    return m ? `${m[1]}-${m[2]}` : ''
}

function raggruppa(cards: Array<NexiCardView & { addedAt?: string }>): NexiCardView[] {
    const tempo = (c: { addedAt?: string; lastUsedAt?: string }) => new Date(c.addedAt || c.lastUsedAt || 0).getTime()
    const perChiave = new Map<string, NexiCardView>()
    const assorbite = new Set<NexiCardView>()
    for (const c of [...cards].sort((a, b) => Number(!!a.nonAddebitabile) - Number(!!b.nonAddebitabile) || tempo(a) - tempo(b))) {
        const k = chiaveCarta(c.maskedPan)
        if (!k) continue
        const g = perChiave.get(k)
        if (!g) { perChiave.set(k, c); continue }
        assorbite.add(c)
        perChiave.set(k, {
            ...g,
            cardType: g.cardType || c.cardType,
            brand: g.brand || c.brand,
            circuit: g.circuit || c.circuit,
            lastUsedAt: [g.lastUsedAt, c.lastUsedAt].filter(Boolean).sort().pop() as string | undefined,
            isDefault: !!(g.isDefault || c.isDefault),
            altContractIds: Array.from(new Set([...(g.altContractIds || []), c.contractId, ...(c.altContractIds || [])]))
                .filter(id => id !== g.contractId),
        })
    }
    const principali = new Map(Array.from(perChiave.values()).map(c => [c.contractId, c]))
    return cards.filter(c => !assorbite.has(c)).map(({ addedAt: _a, ...c }) => principali.get(c.contractId) || c)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function listCardsFromMetadata(meta: any): NexiCardView[] {
    const m = meta || {}
    const arr = Array.isArray(m.nexi_cards) ? m.nexi_cards : []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cleaned: Array<NexiCardView & { addedAt?: string }> = arr
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((c: any) => c && typeof c.contractId === 'string' && c.contractId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => ({
            contractId: String(c.contractId),
            maskedPan: c.maskedPan || undefined,
            circuit: c.circuit || undefined,
            cardType: c.cardType || undefined,
            brand: c.brand || undefined,
            lastUsedAt: c.lastUsedAt || c.addedAt || undefined,
            addedAt: c.addedAt || undefined,
            isDefault: !!c.isDefault,
            altContractIds: Array.isArray(c.altContractIds) ? c.altContractIds : undefined,
            nonAddebitabile: c.nonAddebitabile === true || undefined,
        }))
    if (cleaned.length > 0) {
        const raggruppate = raggruppa(cleaned)
        if (!raggruppate.some(c => c.isDefault)) raggruppate[0].isDefault = true
        return raggruppate
    }
    const cid = m.nexi_contract_id
    if (typeof cid === 'string' && cid) {
        return [{
            contractId: cid,
            maskedPan: m.nexi_card_masked_pan || undefined,
            circuit: m.nexi_card_circuit || undefined,
            cardType: m.nexi_card_type || undefined,
            brand: m.nexi_card_brand || undefined,
            lastUsedAt: m.nexi_contract_updated || undefined,
            isDefault: true,
        }]
    }
    return []
}
