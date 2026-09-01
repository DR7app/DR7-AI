import { describe, it, expect } from 'vitest'
import { separaDuplicati, normalizzaNumero } from './fattureDuplicate'
import type { FornitoreDocument } from './types'

function doc(p: Partial<FornitoreDocument>): FornitoreDocument {
    return {
        id: p.id || crypto.randomUUID(),
        fornitore_id: 'f1',
        tipo: 'fattura',
        numero_documento: '1',
        data_documento: '2026-03-10',
        data_scadenza: null,
        periodo_anno: 2026,
        periodo_mese: 3,
        importo_imponibile: null,
        importo_iva: null,
        importo_totale: 100,
        fattura_collegata_id: null,
        file_url: null,
        file_name: null,
        file_hash: null,
        aruba_filename: null,
        stato: 'caricato',
        metodo_pagamento: null,
        data_pagamento: null,
        note: null,
        created_at: '2026-03-11T10:00:00Z',
        updated_at: '2026-03-11T10:00:00Z',
        ...p,
    }
}

describe('normalizzaNumero', () => {
    it('ignora separatori e zeri iniziali', () => {
        expect(normalizzaNumero('0001/26')).toBe(normalizzaNumero('1-26'))
        expect(normalizzaNumero('FPR 12/2026')).toBe('fpr122026')
    })
})

describe('separaDuplicati', () => {
    it('tiene una sola riga per stesso filename Aruba', () => {
        const a = doc({ id: 'a', numero_documento: '1/26', aruba_filename: 'IT123_0001.xml' })
        const b = doc({ id: 'b', numero_documento: '0001/26', aruba_filename: 'IT123_0001.xml' })
        const r = separaDuplicati([a, b])
        expect(r.unici).toHaveLength(1)
        expect(r.duplicati.map(d => d.id)).toEqual(['b'])
    })

    it('riconosce lo stesso numero scritto in modo diverso', () => {
        const a = doc({ id: 'a', numero_documento: '1/26' })
        const b = doc({ id: 'b', numero_documento: '0001-26' })
        const r = separaDuplicati([a, b])
        expect(r.unici).toHaveLength(1)
    })

    it('tiene la riga pagata anche se e piu recente', () => {
        const a = doc({ id: 'a', aruba_filename: 'x.xml', created_at: '2026-03-01T00:00:00Z' })
        const b = doc({ id: 'b', aruba_filename: 'x.xml', created_at: '2026-04-01T00:00:00Z', stato: 'pagato', data_pagamento: '2026-04-02' })
        const r = separaDuplicati([a, b])
        expect(r.unici.map(d => d.id)).toEqual(['b'])
        expect(r.duplicati.map(d => d.id)).toEqual(['a'])
    })

    it('fonde i gruppi quando una riga fa da ponte', () => {
        const a = doc({ id: 'a', numero_documento: '5/26' })
        const b = doc({ id: 'b', numero_documento: '5/26', aruba_filename: 'y.xml' })
        const c = doc({ id: 'c', numero_documento: '05/2026', aruba_filename: 'y.xml' })
        const r = separaDuplicati([a, b, c])
        expect(r.unici).toHaveLength(1)
        expect(r.duplicati).toHaveLength(2)
    })

    it('non tocca fatture diverse', () => {
        const a = doc({ id: 'a', numero_documento: '1/26' })
        const b = doc({ id: 'b', numero_documento: '2/26' })
        const c = doc({ id: 'c', numero_documento: '1/26', data_documento: '2026-04-10' })
        const r = separaDuplicati([a, b, c])
        expect(r.unici).toHaveLength(3)
        expect(r.duplicati).toHaveLength(0)
    })
})
