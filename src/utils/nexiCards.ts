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
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function listCardsFromMetadata(meta: any): NexiCardView[] {
    const m = meta || {}
    const arr = Array.isArray(m.nexi_cards) ? m.nexi_cards : []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cleaned: NexiCardView[] = arr
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
            isDefault: !!c.isDefault,
        }))
    if (cleaned.length > 0) {
        if (!cleaned.some(c => c.isDefault)) cleaned[0].isDefault = true
        return cleaned
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
