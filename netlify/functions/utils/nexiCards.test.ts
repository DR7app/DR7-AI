import { describe, it, expect } from 'vitest'
import { listCards, applyTokenizedCardUpdate, removeCard, setDefaultCard, updateCardFields, chiaveCarta } from './nexiCards'
import { listCardsFromMetadata } from '../../../src/utils/nexiCards'

// Scheda reale di Michele Concas al 09/10/2026: 5 voci, 2 carte vere.
const michele = () => ({
    nexi_contract_id: 'Pfefeb1admtisnkyq',
    nexi_cards: [
        { contractId: 'P716c7067mpsgk0ib', maskedPan: '531876******8374', addedAt: '2026-06-08T08:48:15.929Z', lastUsedAt: '2026-06-08T08:48:15.929Z', isDefault: false },
        { contractId: 'Pf118626fmpbfypil', maskedPan: '520942******5262', addedAt: '2026-06-08T08:48:22.146Z', lastUsedAt: '2026-06-08T08:48:22.146Z', isDefault: false },
        { contractId: 'Pca8f27f2mrizhdhk', maskedPan: '520942******5262', addedAt: '2026-07-13T08:54:23.134Z', lastUsedAt: '2026-07-13T08:54:23.035Z', isDefault: false },
        { contractId: 'Pe021d12cmsx7fhli', maskedPan: '520942******5262', addedAt: '2026-08-19T19:56:00.774Z', lastUsedAt: '2026-08-19T19:56:00.774Z', isDefault: false },
        { contractId: 'Pfefeb1admtisnkyq', maskedPan: '520942******5262', addedAt: '2026-09-01T15:02:15.221Z', lastUsedAt: '2026-09-01T15:02:15.104Z', isDefault: true },
    ],
})

describe('chiaveCarta', () => {
    it('serve BIN e ultime 4 cifre', () => {
        expect(chiaveCarta('520942******5262')).toBe('520942-5262')
        expect(chiaveCarta('***5262')).toBe('')
        expect(chiaveCarta('**** **** **** 5262')).toBe('')
        expect(chiaveCarta(undefined)).toBe('')
    })
})

describe('raggruppamento carte uguali', () => {
    it('Michele: 5 voci diventano 2 carte, resta il contratto piu vecchio', () => {
        const cards = listCards(michele())
        expect(cards).toHaveLength(2)
        const c5262 = cards.find(c => c.maskedPan === '520942******5262')!
        expect(c5262.contractId).toBe('Pf118626fmpbfypil')
        expect(c5262.altContractIds).toEqual(['Pca8f27f2mrizhdhk', 'Pe021d12cmsx7fhli', 'Pfefeb1admtisnkyq'])
        expect(c5262.isDefault).toBe(true)
        expect(c5262.lastUsedAt).toBe('2026-09-01T15:02:15.104Z')
        expect(cards.filter(c => c.isDefault)).toHaveLength(1)
    })

    it('la vista dello schermo raggruppa allo stesso modo', () => {
        const cards = listCardsFromMetadata(michele())
        expect(cards.map(c => c.contractId)).toEqual(['P716c7067mpsgk0ib', 'Pf118626fmpbfypil'])
        expect(cards.find(c => c.contractId === 'Pf118626fmpbfypil')!.isDefault).toBe(true)
    })

    it('un nuovo pagamento con la stessa carta non aggiunge una voce', () => {
        const meta = applyTokenizedCardUpdate(michele(), { nexi_contract_id: 'Pnuovo000000000001', nexi_card_masked_pan: '520942******5262' })
        expect(meta.nexi_cards).toHaveLength(2)
        expect(meta.nexi_contract_id).toBe('Pf118626fmpbfypil')
        const c = (meta.nexi_cards as Array<{ contractId: string; altContractIds?: string[] }>).find(x => x.contractId === 'Pf118626fmpbfypil')!
        expect(c.altContractIds).toContain('Pnuovo000000000001')
    })

    it('una carta diversa resta separata e diventa predefinita', () => {
        const meta = applyTokenizedCardUpdate(michele(), { nexi_contract_id: 'Paltra00000000001', nexi_card_masked_pan: '411111******1111' })
        expect(meta.nexi_cards).toHaveLength(3)
        expect(meta.nexi_contract_id).toBe('Paltra00000000001')
        expect(meta.nexi_card_masked_pan).toBe('411111******1111')
    })

    it('makeDefault false non cambia la predefinita', () => {
        const meta = applyTokenizedCardUpdate(michele(), { nexi_contract_id: 'Paltra00000000001', nexi_card_masked_pan: '411111******1111' }, { makeDefault: false })
        expect(meta.nexi_contract_id).toBe('Pf118626fmpbfypil')
    })

    it('stesse ultime 4 ma BIN diverso = carte diverse', () => {
        const cards = listCards({ nexi_cards: [
            { contractId: 'A', maskedPan: '520942******5262', addedAt: '2026-01-01' },
            { contractId: 'B', maskedPan: '411111******5262', addedAt: '2026-02-01' },
        ] })
        expect(cards).toHaveLength(2)
    })

    it('carte senza numero non vengono unite', () => {
        const cards = listCards({ nexi_cards: [
            { contractId: 'A', addedAt: '2026-01-01' },
            { contractId: 'B', addedAt: '2026-02-01' },
            { contractId: 'C', maskedPan: '***5262', addedAt: '2026-03-01' },
        ] })
        expect(cards).toHaveLength(3)
    })

    it('aggiornare un contratto unito tocca la sua carta', () => {
        const meta = applyTokenizedCardUpdate(michele(), { nexi_contract_id: 'Pe021d12cmsx7fhli', nexi_card_type: 'debit' })
        expect(meta.nexi_cards).toHaveLength(2)
        expect(meta.nexi_contract_id).toBe('Pf118626fmpbfypil')
        expect(meta.nexi_card_type).toBe('debit')
    })

    it('rimuovere la carta principale toglie la carta intera', () => {
        const meta = removeCard(michele(), 'Pf118626fmpbfypil')
        expect(meta.nexi_cards).toHaveLength(1)
        expect(meta.nexi_contract_id).toBe('P716c7067mpsgk0ib')
    })

    it('rimuovere un contratto unito lascia la carta', () => {
        const meta = removeCard(michele(), 'Pfefeb1admtisnkyq')
        const cards = meta.nexi_cards as Array<{ contractId: string; altContractIds?: string[] }>
        expect(cards).toHaveLength(2)
        expect(cards.find(c => c.contractId === 'Pf118626fmpbfypil')!.altContractIds).not.toContain('Pfefeb1admtisnkyq')
    })

    it('predefinita per contratto unito sceglie la sua carta', () => {
        const meta = setDefaultCard(michele(), 'Pca8f27f2mrizhdhk')
        expect(meta.nexi_contract_id).toBe('Pf118626fmpbfypil')
        const meta2 = setDefaultCard(michele(), 'P716c7067mpsgk0ib')
        expect(meta2.nexi_contract_id).toBe('P716c7067mpsgk0ib')
    })

    it('updateCardFields per contratto unito', () => {
        const meta = updateCardFields(michele(), 'Pe021d12cmsx7fhli', { cardType: 'credit' })
        const c = (meta.nexi_cards as Array<{ contractId: string; cardType?: string }>).find(x => x.contractId === 'Pf118626fmpbfypil')!
        expect(c.cardType).toBe('credit')
    })

    it('scheda vecchia con sole chiavi piatte funziona come prima', () => {
        const cards = listCards({ nexi_contract_id: 'X1', nexi_card_masked_pan: '520942******5262' })
        expect(cards).toEqual([expect.objectContaining({ contractId: 'X1', isDefault: true })])
    })

    it('un contratto senza token non diventa mai il principale', () => {
        const cards = listCards({ nexi_cards: [
            { contractId: 'FAUX0901', maskedPan: '520942******5262', addedAt: '2026-09-05', nonAddebitabile: true, isDefault: true },
            { contractId: 'VERO1010', maskedPan: '520942******5262', addedAt: '2026-10-10' },
        ] })
        expect(cards).toHaveLength(1)
        expect(cards[0].contractId).toBe('VERO1010')
        expect(cards[0].nonAddebitabile).toBeFalsy()
        expect(cards[0].altContractIds).toEqual(['FAUX0901'])
        expect(cards[0].isDefault).toBe(true)
    })

    it('il nuovo token buono sostituisce il principale senza token', () => {
        const meta = applyTokenizedCardUpdate(
            { nexi_cards: [{ contractId: 'FAUX0901', maskedPan: '520942******5262', addedAt: '2026-09-05', nonAddebitabile: true, isDefault: true }] },
            { nexi_contract_id: 'VERO1010', nexi_card_masked_pan: '520942******5262' })
        expect(meta.nexi_contract_id).toBe('VERO1010')
        expect(meta.nexi_card_non_addebitabile).toBeUndefined()
    })

    it('Michele: il contratto del 01/09 marcato non cambia il principale', () => {
        const m = michele()
        m.nexi_cards[4] = { ...m.nexi_cards[4], nonAddebitabile: true } as typeof m.nexi_cards[4]
        const c = listCards(m).find(x => x.maskedPan === '520942******5262')!
        expect(c.contractId).toBe('Pf118626fmpbfypil')
        expect(c.nonAddebitabile).toBeFalsy()
    })

    it('la vista dello schermo preferisce il token buono', () => {
        const cards = listCardsFromMetadata({ nexi_cards: [
            { contractId: 'FAUX0901', maskedPan: '520942******5262', addedAt: '2026-09-05', nonAddebitabile: true },
            { contractId: 'VERO1010', maskedPan: '520942******5262', addedAt: '2026-10-10' },
        ] })
        expect(cards.map(c => c.contractId)).toEqual(['VERO1010'])
    })
})
