import { describe, it, expect } from 'vitest'
import {
  idDichiarati, chiaviPrenotazione, idCliente, insiemeGadget, gadgetGiaInviatoA, raggruppaPerEmail,
  type ClienteIdentita,
} from './gadgetOmaggio'

const SCHEDA = '11111111-1111-4111-8111-111111111111'
const ACCOUNT = '22222222-2222-4222-8222-222222222222'
const ALTRA = '33333333-3333-4333-8333-333333333333'
const OMONIMO = '44444444-4444-4444-8444-444444444444'

const clienti: ClienteIdentita[] = [
  { id: SCHEDA, user_id: ACCOUNT, email: 'Nicola.Talli@Example.com' },
  { id: ALTRA, user_id: null, email: 'condivisa@example.com' },
  { id: OMONIMO, user_id: null, email: 'condivisa@example.com' },
]
const perEmail = raggruppaPerEmail(clienti)

describe('idDichiarati', () => {
  it('raccoglie user_id e gli id della scheda in booking_details, solo UUID', () => {
    expect(idDichiarati({ user_id: ACCOUNT, booking_details: { customer: { customerId: SCHEDA.toUpperCase() } } }).sort())
      .toEqual([SCHEDA, ACCOUNT].sort())
    expect(idDichiarati({ user_id: 'non-un-id', booking_details: { customer: { customerId: '' } } })).toEqual([])
  })
})

describe('chiaviPrenotazione', () => {
  it('con un id non usa mai email', () => {
    expect(chiaviPrenotazione({ user_id: SCHEDA, customer_email: 'x@y.it' })).toEqual(['id:' + SCHEDA])
  })
  it('senza id usa l\'email esatta in minuscolo', () => {
    expect(chiaviPrenotazione({ customer_email: ' A@B.it ' })).toEqual(['e:a@b.it'])
  })
  it('telefono e nome non identificano nessuno', () => {
    expect(chiaviPrenotazione({ booking_details: { customer: { phone: '3331234567', fullName: 'Nicola Talli' } } })).toEqual([])
  })
})

describe('idCliente', () => {
  it('scheda e account sono la stessa persona', () => {
    expect(idCliente([ACCOUNT], '', clienti, perEmail).sort()).toEqual([SCHEDA, ACCOUNT].sort())
  })
  it('email di una sola scheda identifica, email condivisa no', () => {
    expect(idCliente([], 'nicola.talli@example.com', clienti, perEmail).sort()).toEqual([SCHEDA, ACCOUNT].sort())
    expect(idCliente([], 'condivisa@example.com', clienti, perEmail)).toEqual([])
  })
})

describe('gadget unico per cliente tra noleggio e lavaggio (caso Nicola Talli)', () => {
  // Noleggio dal gestionale: bookings.user_id = id della scheda cliente.
  const noleggio = { user_id: SCHEDA, booking_details: { gadget_omaggio: { inviato_at: '2026-11-01T10:00:00Z' } } }
  const insieme = insiemeGadget([noleggio], clienti, perEmail)

  it('il lavaggio con customerId della stessa scheda risulta gia\' inviato', () => {
    expect(gadgetGiaInviatoA({ booking_details: { customer: { customerId: SCHEDA } } }, insieme)).toBe(true)
  })
  it('una prenotazione dal sito con l\'account del cliente risulta gia\' inviata', () => {
    expect(gadgetGiaInviatoA({ user_id: ACCOUNT, booking_details: {} }, insieme)).toBe(true)
  })
  it('senza id, l\'email univoca del cliente risulta gia\' inviata', () => {
    expect(gadgetGiaInviatoA({ customer_email: 'NICOLA.TALLI@example.com', booking_details: {} }, insieme)).toBe(true)
  })
  it('un altro cliente con lo stesso telefono non e\' bloccato', () => {
    expect(gadgetGiaInviatoA({ user_id: ALTRA, customer_phone: '3331234567', booking_details: {} }, insieme)).toBe(false)
  })
  it('vale anche al contrario: inviato dal lavaggio, il noleggio lo vede', () => {
    const lavaggio = { booking_details: { customer: { customerId: SCHEDA }, gadget_omaggio: { inviato_at: 'x' } } }
    const ins = insiemeGadget([lavaggio], clienti, perEmail)
    expect(gadgetGiaInviatoA({ user_id: SCHEDA, booking_details: {} }, ins)).toBe(true)
    expect(gadgetGiaInviatoA({ user_id: ACCOUNT, booking_details: {} }, ins)).toBe(true)
  })
  it('usa gli id registrati al momento dell\'invio', () => {
    const vecchia = { booking_details: { gadget_omaggio: { inviato_at: 'x', clienti: [ACCOUNT] } } }
    expect(insiemeGadget([vecchia], clienti, perEmail).has('id:' + SCHEDA)).toBe(true)
  })
  it('email condivisa da due schede non entra nell\'insieme', () => {
    const r = { customer_email: 'condivisa@example.com', booking_details: { gadget_omaggio: { inviato_at: 'x' } } }
    expect([...insiemeGadget([r], clienti, perEmail)]).toEqual([])
  })
  it('la prenotazione stessa con il gadget registrato resta inviata', () => {
    expect(gadgetGiaInviatoA({ booking_details: { gadget_omaggio: { inviato_at: 'x' } } }, new Set())).toBe(true)
  })
})
