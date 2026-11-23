import { describe, it, expect } from 'vitest'
import { ritiriDelGiorno, isMessaggioSpazzatura } from './immondiziaCalendario'

describe('ritiriDelGiorno', () => {
  const regole = [
    { tipo_rifiuto: 'Carta', mode: 'monthly', day_of_week: null, pickup_date: '2026-11-30' },
    { tipo_rifiuto: 'Vetro', mode: 'weekly', day_of_week: 1, pickup_date: null },
    { tipo_rifiuto: 'Plastica', mode: 'biweekly', day_of_week: null, pickup_date: '2026-11-30' },
  ]
  it('ogni mese il 30, a partire dal 30/11', () => {
    expect(ritiriDelGiorno(regole, '2026-11-23').map(r => r.tipo_rifiuto)).toEqual(['Vetro'])
    expect(ritiriDelGiorno(regole, '2026-11-30').map(r => r.tipo_rifiuto)).toEqual(['Carta', 'Vetro', 'Plastica'])
    expect(ritiriDelGiorno(regole, '2026-12-30').map(r => r.tipo_rifiuto)).toEqual(['Carta'])
    expect(ritiriDelGiorno(regole, '2027-02-28').map(r => r.tipo_rifiuto)).toEqual(['Carta'])
    expect(ritiriDelGiorno(regole, '2026-12-14').map(r => r.tipo_rifiuto)).toEqual(['Vetro', 'Plastica'])
  })
  it('riconosce il messaggio del ritiro', () => {
    expect(isMessaggioSpazzatura({ label: 'Ritiro spazzatura', trigger_event: 'on_schedule' })).toBe(true)
    expect(isMessaggioSpazzatura({ label: 'Carta Prepagata Rifiutata', trigger_event: 'on_payment' })).toBe(false)
  })
})
