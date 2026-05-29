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
