import { describe, it, expect, vi } from 'vitest'

// vehicleAvailability.ts imports supabaseClient at module load, which throws
// when VITE_SUPABASE_URL is missing in the test env. Mock it so the import
// chain succeeds — the unit tests below pass bookings explicitly and don't
// hit the network.
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  },
}))

import { isVehicleAvailable } from './vehicleAvailability'

// Minimal mock types matching the function's interface
const mockVehicle = (overrides = {}) => ({
  id: 'v1',
  plate: 'AA000BB',
  targa: 'AA000BB',
  display_name: 'Fiat 500',
  vehicle_type: 'car',
  is_available: true,
  status: 'active',
  ...overrides,
})

const mockBooking = (overrides = {}) => ({
  id: 'b1',
  vehicle_id: 'v1',
  vehicle_name: 'Fiat 500',
  vehicle_plate: 'AA000BB',
  pickup_date: '2026-04-01',
  dropoff_date: '2026-04-03',
  status: 'confirmed',
  payment_status: 'paid',
  payment_method: 'Nexi Pay by Link',
  service_type: 'car',
  customer_name: 'Test',
  ...overrides,
})

describe('isVehicleAvailable — slot blocking', () => {
  const vehicle = mockVehicle()
  // Request dates that overlap with the booking (April 1-3)
  const pickupDate = '2026-04-02'
  const dropoffDate = '2026-04-02'
  const pickupTime = '10:00'
  const returnTime = '18:00'

  it('blocks slot for confirmed/paid booking', () => {
    const bookings = [mockBooking({ status: 'confirmed', payment_status: 'paid' })]
    const result = isVehicleAvailable(vehicle as any, pickupDate, dropoffDate, pickupTime, returnTime, bookings as any)
    expect(result.available).toBe(false)
  })

  it('blocks slot for pending_payment/unpaid booking (payment in progress)', () => {
    const bookings = [mockBooking({ status: 'pending_payment', payment_status: 'unpaid' })]
    const result = isVehicleAvailable(vehicle as any, pickupDate, dropoffDate, pickupTime, returnTime, bookings as any)
    expect(result.available).toBe(false)
  })

  it('does NOT block slot for cancelled booking', () => {
    const bookings = [mockBooking({ status: 'cancelled', payment_status: 'unpaid' })]
    const result = isVehicleAvailable(vehicle as any, pickupDate, dropoffDate, pickupTime, returnTime, bookings as any)
    expect(result.available).toBe(true)
  })

  it('does NOT block slot for expired booking', () => {
    const bookings = [mockBooking({ status: 'expired', payment_status: 'expired' })]
    const result = isVehicleAvailable(vehicle as any, pickupDate, dropoffDate, pickupTime, returnTime, bookings as any)
    expect(result.available).toBe(true)
  })

  it('does NOT block slot for pending_payment with expired payment (payment link expired)', () => {
    const bookings = [mockBooking({ status: 'pending_payment', payment_status: 'expired' })]
    const result = isVehicleAvailable(vehicle as any, pickupDate, dropoffDate, pickupTime, returnTime, bookings as any)
    expect(result.available).toBe(true)
  })

  it('allows booking when dates do not overlap', () => {
    const bookings = [mockBooking({
      pickup_date: '2026-04-10',
      dropoff_date: '2026-04-12',
    })]
    const result = isVehicleAvailable(vehicle as any, pickupDate, dropoffDate, pickupTime, returnTime, bookings as any)
    expect(result.available).toBe(true)
  })

  it('allows slot when excludeBookingId matches the only blocking booking', () => {
    const bookings = [mockBooking({ id: 'b-edit' })]
    const result = isVehicleAvailable(vehicle as any, pickupDate, dropoffDate, pickupTime, returnTime, bookings as any, 'b-edit')
    expect(result.available).toBe(true)
  })

  it('does not block for different vehicle', () => {
    const bookings = [mockBooking({ vehicle_id: 'v2', vehicle_plate: 'ZZ999YY' })]
    const result = isVehicleAvailable(vehicle as any, pickupDate, dropoffDate, pickupTime, returnTime, bookings as any)
    expect(result.available).toBe(true)
  })
})

// 21/10/2026: GLE con "Segna rientrata" alle 18:31 e un noleggio a luglio 2027
// (fine 12:30). La "prima disponibilita'" diceva 14:00 (= luglio 2027 + 90 min).
describe('prima disponibilita: solo chi occupa il mezzo quel giorno', () => {
  const rientrata = mockBooking({
    id: 'madau', customer_name: 'Madau',
    pickup_date: '2026-10-21T10:30:00.000Z', dropoff_date: '2026-10-21T16:31:00.000Z',
  })
  const futura = mockBooking({
    id: 'serra', customer_name: 'Serra',
    pickup_date: '2027-07-10T12:00:00.000Z', dropoff_date: '2027-07-12T10:30:00.000Z',
  })

  it('un noleggio di mesi dopo non sposta la prima disponibilita', () => {
    const esito = isVehicleAvailable(mockVehicle(), '2026-10-21', '2026-10-22', '17:00', '10:00', [rientrata, futura] as any)
    expect(esito.available).toBe(false)
    expect(esito.reason).toContain('Prima disponibilità utile: 20:01')
  })

  it('libero dal giorno dopo il rientro', () => {
    const esito = isVehicleAvailable(mockVehicle(), '2026-10-22', '2026-10-23', '10:00', '10:00', [rientrata, futura] as any)
    expect(esito.available).toBe(true)
  })
})
