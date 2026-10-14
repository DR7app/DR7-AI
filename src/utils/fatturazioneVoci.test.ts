import { describe, it, expect } from 'vitest'
import { nettoVoce, giaFatturato, daFatturare } from './fatturazioneVoci'

describe('fatturazioneVoci', () => {
  it('prezzo finale = listino meno sconto', () => {
    expect(nettoVoce({ total: 1600, discount: 1050 })).toBe(550)
    expect(nettoVoce({ amount: 100, quantity: 3 })).toBe(300)
  })
  it('mai fatturata: si fattura tutto il prezzo finale', () => {
    expect(daFatturare({ total: 800 })).toBe(800)
    expect(giaFatturato({ total: 800 })).toBe(0)
  })
  it('fattura parziale gia emessa: resta solo il resto', () => {
    expect(daFatturare({ total: 1000, discount: 200, importoFatturato: 300 })).toBe(500)
  })
  it('gia fatturata per intero: niente da fatturare al saldo', () => {
    expect(daFatturare({ total: 800, importoFatturato: 800 })).toBe(0)
    expect(daFatturare({ total: 800, importoFatturato: 900 })).toBe(0)
  })
})
