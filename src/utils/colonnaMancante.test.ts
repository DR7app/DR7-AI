import { describe, it, expect } from 'vitest'
import { isColonnaMancante } from './colonnaMancante'

// 01/10/2026: status_cliente non esiste in produzione; la lettura dei badge
// deve riconoscere l'errore "colonna mancante" e rileggere senza.
describe('isColonnaMancante', () => {
  it('riconosce 42703 di Postgres', () => {
    expect(isColonnaMancante({ code: '42703', message: 'column customers_extended.status_cliente does not exist' })).toBe(true)
  })
  it('riconosce PGRST204 dello schema cache', () => {
    expect(isColonnaMancante({ code: 'PGRST204', message: "Could not find the 'status_cliente' column" })).toBe(true)
  })
  it('non scambia altri errori per colonna mancante', () => {
    expect(isColonnaMancante({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isColonnaMancante(null)).toBe(false)
  })
})
