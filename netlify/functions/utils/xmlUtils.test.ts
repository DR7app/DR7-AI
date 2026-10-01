import { describe, it, expect } from 'vitest'
import { generateFatturaXML, controllaIdentificativoCliente } from '../xml-utils'

const base = {
  numero_fattura: 'DR7-2026-9999',
  data_emissione: '2026-10-01',
  customer_name: 'Cliente Prova',
  customer_address: 'Via Roma 12, 09100 Cagliari (CA)',
  items: [{ description: 'Noleggio', unit_price: 100, quantity: 1, vat_rate: 22 }],
  subtotal: 100,
  vat_amount: 22,
  importo_totale: 122,
}

describe('generateFatturaXML: identificativo cliente controllato prima dell\'invio', () => {
  it('blocca il CF di DR7-2026-2102 con un motivo in italiano', () => {
    expect(() => generateFatturaXML({ ...base, customer_tax_code: 'LRASFN01E25Z138I' }))
      .toThrow(/Fattura non inviata allo SDI: Codice fiscale "LRASFN01E25Z138I" non valido.*sarebbe J/)
  })

  it('blocca il CF delle fatture Saia', () => {
    expect(() => generateFatturaXML({ ...base, customer_tax_code: 'SIAVLR91E18B354A' })).toThrow(/sarebbe G/)
  })

  it('genera l\'XML con un CF valido', () => {
    const xml = generateFatturaXML({ ...base, customer_tax_code: 'LRASFN01E25Z138J' })
    expect(xml).toContain('<CodiceFiscale>LRASFN01E25Z138J</CodiceFiscale>')
  })

  it('con la P.IVA presente controlla lei, che e\' quella trasmessa', () => {
    expect(() => generateFatturaXML({ ...base, customer_vat: '12345678901' })).toThrow(/Partita IVA "12345678901" non valida/)
    const xml = generateFatturaXML({ ...base, customer_vat: '12345678903', customer_tax_code: 'XXXXXXXXXXXXXXXX' })
    expect(xml).toContain('<IdCodice>12345678903</IdCodice>')
  })

  it('blocca la fattura intestata a DR7 stessa (errore SDI 00471)', () => {
    expect(() => controllaIdentificativoCliente('04104640927', 'SIAVLR91E18B354G')).toThrow(/00471/)
  })

  it('non duplica il civico gia\' scritto nella via (DR7-2026-2102)', () => {
    const xml = generateFatturaXML({
      ...base,
      customer_tax_code: 'LRASFN01E25Z138J',
      customer_address: 'Via Dante Alighieri, N. 56 56, 09121 Cagliari (CA)',
    })
    expect(xml).toContain('<Indirizzo>Via Dante Alighieri, N. 56</Indirizzo>')
  })
})
