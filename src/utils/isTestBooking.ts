/**
 * Test vehicle / test booking detection.
 *
 * "TEST" vehicles exist in the fleet for internal QA. Any booking,
 * modification, cancellation, or payment-status change on a test
 * vehicle MUST NOT fire an OTP to direzione — the operator is
 * exercising the flow, not booking a real customer.
 *
 * Detection (mirrors `generate-invoice-from-booking.ts` server-side):
 *   - vehicle_name === 'test' (case-insensitive)
 *   - vehicle_plate starts with 'TEST' (case-insensitive)
 *   - vehicle.display_name === 'test' / matches the above
 */

export function isTestVehicle(
  vehicleName?: string | null,
  vehiclePlate?: string | null
): boolean {
  const n = (vehicleName || '').toString().trim().toLowerCase()
  const p = (vehiclePlate || '').toString().trim().toUpperCase()
  if (!n && !p) return false
  if (n === 'test') return true
  if (p.startsWith('TEST')) return true
  return false
}

/**
 * Test booking detection from a booking record. Reads every common
 * field where a vehicle name or plate might live (top-level + nested
 * booking_details).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isTestBooking(booking: any): boolean {
  if (!booking) return false
  const name =
    booking.vehicle_name ||
    booking.booking_details?.vehicle?.name ||
    booking.booking_details?.vehicle?.display_name ||
    null
  const plate =
    booking.vehicle_plate ||
    booking.booking_details?.vehicle_plate ||
    booking.booking_details?.vehicle?.plate ||
    null
  return isTestVehicle(name, plate)
}
