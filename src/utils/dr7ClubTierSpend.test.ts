import { describe, it, expect } from 'vitest'
import { computeAnnualSpend, TIER_SPEND_OVERRIDES, DUPLICATE_PURCHASE_IDS } from './dr7ClubTierSpend'

const RUNCHINA = '3b896d05-3d65-4819-a46a-ea9894343935'
const OGGI = new Date('2026-09-01T10:00:00Z')
const ieri = new Date('2026-08-31T10:00:00Z').toISOString()
const tredicIMesiFa = new Date('2025-08-01T10:00:00Z').toISOString()

const ricarica = (over: Record<string, unknown> = {}) => ({
  id: 'r1', recharge_amount: 1000, payment_status: 'succeeded', created_at: ieri, ...over,
})

const prenotazione = (over: Record<string, unknown> = {}) => ({
  price_total: 61010, payment_method: 'carta', payment_status: 'paid',
  status: 'completed', created_at: ieri, ...over,
})

describe('computeAnnualSpend', () => {
  it('somma prenotazioni a denaro nuovo e ricariche pagate', () => {
    const r = computeAnnualSpend([prenotazione()], [ricarica()], null, OGGI)
    expect(r.bookingSpend).toBe(610.10)
    expect(r.rechargeSpend).toBe(1000)
    expect(r.annualSpend).toBe(1610.10)
  })

  it('conta bonifico e contanti: sono denaro nuovo come la carta', () => {
    const r = computeAnnualSpend(
      [prenotazione({ payment_method: 'bonifico' }), prenotazione({ payment_method: 'contanti' })],
      [], null, OGGI
    )
    expect(r.bookingSpend).toBe(1220.20)
  })

  it('esclude le prenotazioni pagate dal wallet o con gift card', () => {
    const r = computeAnnualSpend(
      [prenotazione({ payment_method: 'credit' }), prenotazione({ payment_method: 'gift_card' })],
      [], null, OGGI
    )
    expect(r.bookingSpend).toBe(0)
  })

  it('esclude annullate, non pagate e fuori dai 12 mesi', () => {
    const r = computeAnnualSpend([
      prenotazione({ status: 'cancelled' }),
      prenotazione({ payment_status: 'pending' }),
      prenotazione({ created_at: tredicIMesiFa }),
    ], [], null, OGGI)
    expect(r.bookingSpend).toBe(0)
  })

  it('esclude le ricariche doppie (colonna a DB e lista statica)', () => {
    const doppione = [...DUPLICATE_PURCHASE_IDS][0]
    const r = computeAnnualSpend([], [
      ricarica(),
      ricarica({ id: 'r2', excluded_from_tier: true }),
      ricarica({ id: doppione, recharge_amount: 2000 }),
    ], null, OGGI)
    expect(r.rechargeSpend).toBe(1000)
    expect(r.rechargeCount).toBe(1)
  })

  it('override grandfathered: PAVIMENTO, non gabbia — la cifra avanza', () => {
    const congelato = TIER_SPEND_OVERRIDES[RUNCHINA]
    // Spesa reale sotto il pavimento: si mostra il pavimento.
    const sotto = computeAnnualSpend([], [ricarica({ recharge_amount: 500 })], RUNCHINA, OGGI)
    expect(sotto.annualSpend).toBe(congelato)
    expect(sotto.floorApplied).toBe(true)
    // Spesa reale sopra: si mostra quella vera (era il bug: restava inchiodata).
    const sopra = computeAnnualSpend([], [ricarica({ recharge_amount: 15000 })], RUNCHINA, OGGI)
    expect(sopra.annualSpend).toBe(15000)
    expect(sopra.floorApplied).toBe(false)
  })
})
