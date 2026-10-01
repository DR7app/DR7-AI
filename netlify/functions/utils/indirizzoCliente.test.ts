import { describe, it, expect } from 'vitest'
import { viaConCivico, togliCivicoDoppio, componiIndirizzo } from './indirizzoCliente'

describe('civico doppio (DR7-2026-2102: "Via Dante Alighieri, N. 56 56")', () => {
  it('non riaccoda il civico gia\' presente in coda alla via', () => {
    expect(viaConCivico('Via Dante Alighieri, N. 56', '56')).toBe('Via Dante Alighieri, N. 56')
    expect(viaConCivico('Via Roma 12', '12')).toBe('Via Roma 12')
    expect(viaConCivico('Via Roma, 12/A', '12/a')).toBe('Via Roma, 12/A')
    expect(viaConCivico('Via Roma n° 7', 'n. 7')).toBe('Via Roma n° 7')
  })

  it('accoda il civico quando manca', () => {
    expect(viaConCivico('Via Roma', '12')).toBe('Via Roma 12')
    expect(viaConCivico('Via 4 Novembre', '4')).toBe('Via 4 Novembre 4')
    expect(viaConCivico('Via 156', '56')).toBe('Via 156 56')
    expect(viaConCivico('Via Roma', '')).toBe('Via Roma')
  })

  it('componiIndirizzo usa la stessa regola', () => {
    expect(componiIndirizzo({ via: 'Via Dante Alighieri, N. 56', civico: '56', cap: '09121', citta: 'Cagliari', provincia: 'ca' }))
      .toBe('Via Dante Alighieri, N. 56, 09121 Cagliari (CA)')
  })

  it('ripulisce gli indirizzi gia\' salvati col numero ripetuto, senza toccare gli altri', () => {
    expect(togliCivicoDoppio('Via Dante Alighieri, N. 56 56')).toBe('Via Dante Alighieri, N. 56')
    expect(togliCivicoDoppio('Via Roma 12, 12')).toBe('Via Roma 12')
    expect(togliCivicoDoppio('Via 156 56')).toBe('Via 156 56')
    expect(togliCivicoDoppio('Via Roma 12')).toBe('Via Roma 12')
  })
})
