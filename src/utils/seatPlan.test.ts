/**
 * Pianta sedili (servizi Prime Wash venduti a sedile).
 * Le sigle finiscono sulla prenotazione e su WhatsApp: devono restare
 * stabili e uguali a quelle scritte dal sito.
 */
import { describe, it, expect } from 'vitest'
import { SEAT_LAYOUT, ROW_Y, seatLabel, seatListLabel, normalizeSeats, isSeatPricedUnit, isSeatPricedService } from './seatPlan'

describe('seatPlan', () => {
  it('ha 7 sedili con sigle uniche: 5 standard + 2 di terza fila', () => {
    expect(SEAT_LAYOUT).toHaveLength(7)
    expect(new Set(SEAT_LAYOUT.map(s => s.id)).size).toBe(7)
    expect(SEAT_LAYOUT.filter(s => s.row === 3)).toHaveLength(2)
  })

  it('non fa uscire nessun sedile dal riquadro della pianta', () => {
    for (const s of SEAT_LAYOUT) {
      expect(s.x, s.id).toBeGreaterThan(10)
      expect(s.x, s.id).toBeLessThan(90)
      for (const modo of ['5', '7'] as const) {
        if (modo === '5' && s.row === 3) continue   // terza fila non mostrata
        const y = ROW_Y[modo][s.row]
        expect(y, `${s.id} a ${modo} posti`).toBeGreaterThan(10)
        expect(y, `${s.id} a ${modo} posti`).toBeLessThan(90)
      }
    }
  })

  it('riordina secondo la pianta e toglie duplicati e sigle inventate', () => {
    expect(normalizeSeats(['PD', 'AS', 'PD', 'XX'])).toEqual(['AS', 'PD'])
    expect(normalizeSeats('AS')).toEqual([])
    expect(normalizeSeats(null)).toEqual([])
  })

  it('scrive le etichette estese, e lascia com-e- una sigla sconosciuta', () => {
    expect(seatLabel('AS')).toBe('Guidatore')
    expect(seatLabel('ZZ')).toBe('ZZ')
    expect(seatListLabel(['PD', 'AS'])).toBe('Guidatore, Posteriore destro')
    expect(seatListLabel([])).toBe('')
  })

  it('riconosce il servizio a sedile dall-unita- di prezzo del catalogo', () => {
    expect(isSeatPricedUnit('a sedile')).toBe(true)
    expect(isSeatPricedUnit('per seat')).toBe(true)
    expect(isSeatPricedUnit('Sedili')).toBe(true)
    expect(isSeatPricedUnit('a persona')).toBe(false)
    expect(isSeatPricedUnit(undefined)).toBe(false)
  })

  it('riconosce il servizio a sedile anche dal nome (in catalogo l-unita- e- "Qta")', () => {
    // Regressione: con la sola unita' di prezzo la pianta non si apriva mai,
    // perche' PRIME SEAT CLEAN/PROTECT hanno price_unit "Qta".
    expect(isSeatPricedService('PRIME SEAT CLEAN', 'Qta')).toBe(true)
    expect(isSeatPricedService('PRIME SEAT PROTECT', null)).toBe(true)
    expect(isSeatPricedService('Lavaggio sedili', null)).toBe(true)
    expect(isSeatPricedService('Igienizzazione abitacolo', 'Qta')).toBe(false)
    expect(isSeatPricedService('Nano trattamento', 'a sedile')).toBe(true)
  })
})
