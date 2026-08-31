/**
 * Lettura dei servizi di una prenotazione lavaggio.
 * Il caso che conta: una prenotazione arrivata dal sito con la chiave
 * vecchia (`cart_items`) deve mostrare lo stesso dettaglio di una creata
 * dal gestionale (`cartItems`).
 */
import { describe, it, expect } from 'vitest'
import { leggiServiziPrenotati } from './serviziPrenotati'

describe('leggiServiziPrenotati', () => {
  it('legge la chiave del gestionale', () => {
    const r = leggiServiziPrenotati({ cartItems: [{ serviceId: 'a', serviceName: 'PRIME WASH', price: 30, quantity: 1 }] })
    expect(r).toHaveLength(1)
    expect(r[0].serviceName).toBe('PRIME WASH')
  })

  it('legge anche le prenotazioni vecchie del sito', () => {
    const r = leggiServiziPrenotati({ cart_items: [{ serviceId: 'a', serviceName: 'PRIME WASH', price: 30, quantity: 1 }] })
    expect(r).toHaveLength(1)
    expect(r[0].serviceName).toBe('PRIME WASH')
  })

  it('tiene i sedili scelti e ci allinea la quantita', () => {
    const r = leggiServiziPrenotati({
      cart_items: [{ serviceId: 's', serviceName: 'PRIME SEAT CLEAN', price: 10, quantity: 1, seats: ['PD', 'AS'] }],
    })
    expect(r[0].seats).toEqual(['AS', 'PD'])   // ordine della pianta
    expect(r[0].quantity).toBe(2)              // la pianta comanda sulla quantita'
  })

  it('scarta le sigle inventate invece di mostrarle', () => {
    const r = leggiServiziPrenotati({ cartItems: [{ serviceId: 's', serviceName: 'X', price: 1, quantity: 1, seats: ['AS', 'ZZ'] }] })
    expect(r[0].seats).toEqual(['AS'])
  })

  it('niente carrello: nessun servizio, nessun crash', () => {
    expect(leggiServiziPrenotati(null)).toEqual([])
    expect(leggiServiziPrenotati({})).toEqual([])
    expect(leggiServiziPrenotati({ cartItems: 'rotto' })).toEqual([])
    expect(leggiServiziPrenotati({ cartItems: [null, 3] })).toEqual([])
  })
})
