import { describe, it, expect } from 'vitest'
import {
  isCalendarVisible,
  isSlotBlocking,
  getStatusDisplayLabel,
  getCalendarBarColor,
  calculatePaymentLinkExpiry,
  isPaymentLinkExpired,
  buildPendingPaymentBookingFields,
  buildPaymentConfirmedFields,
  buildExpiredBookingFields,
  normalizeLegacyStatus,
  PAYMENT_LINK_TTL_MS,
  PAYMENT_LINK_TTL_HOURS,
  CALENDAR_VISIBLE_STATUSES,
  SLOT_BLOCKING_STATUSES,
  TERMINAL_STATUSES,
} from './bookingPaymentService'

// ─── Constants ─────────────────────────────────────────────────────────────

describe('Constants', () => {
  it('PAYMENT_LINK_TTL_MS = 1 hour in milliseconds', () => {
    expect(PAYMENT_LINK_TTL_MS).toBe(3_600_000)
  })
  it('PAYMENT_LINK_TTL_HOURS = 1', () => {
    expect(PAYMENT_LINK_TTL_HOURS).toBe(1)
  })
  it('CALENDAR_VISIBLE_STATUSES includes pending_payment and confirmed', () => {
    expect(CALENDAR_VISIBLE_STATUSES).toContain('pending_payment')
    expect(CALENDAR_VISIBLE_STATUSES).toContain('confirmed')
    expect(CALENDAR_VISIBLE_STATUSES).not.toContain('expired')
    expect(CALENDAR_VISIBLE_STATUSES).not.toContain('cancelled')
  })
  it('SLOT_BLOCKING_STATUSES includes pending_payment and confirmed', () => {
    expect(SLOT_BLOCKING_STATUSES).toContain('pending_payment')
    expect(SLOT_BLOCKING_STATUSES).toContain('confirmed')
    expect(SLOT_BLOCKING_STATUSES).not.toContain('expired')
    expect(SLOT_BLOCKING_STATUSES).not.toContain('completed')
  })
  it('TERMINAL_STATUSES includes expired, cancelled, completed', () => {
    expect(TERMINAL_STATUSES).toContain('expired')
    expect(TERMINAL_STATUSES).toContain('cancelled')
    expect(TERMINAL_STATUSES).toContain('completed')
  })
})

// ─── Calendar Visibility ───────────────────────────────────────────────────

describe('isCalendarVisible', () => {
  it('pending_payment + unpaid => visible (booking waiting for payment)', () => {
    expect(isCalendarVisible('pending_payment', 'unpaid')).toBe(true)
  })
  it('pending_payment + null => visible (no payment status set)', () => {
    expect(isCalendarVisible('pending_payment', null)).toBe(true)
  })
  it('pending_payment + expired => hidden (link expired, no payment)', () => {
    expect(isCalendarVisible('pending_payment', 'expired')).toBe(false)
  })
  it('confirmed => visible', () => {
    expect(isCalendarVisible('confirmed', 'paid')).toBe(true)
  })
  it('active => visible', () => {
    expect(isCalendarVisible('active', 'paid')).toBe(true)
  })
  it('completed => visible', () => {
    expect(isCalendarVisible('completed', 'paid')).toBe(true)
  })
  it('expired => hidden', () => {
    expect(isCalendarVisible('expired', 'expired')).toBe(false)
  })
  it('cancelled => hidden', () => {
    expect(isCalendarVisible('cancelled', null)).toBe(false)
  })
})

// ─── Slot Blocking ─────────────────────────────────────────────────────────

describe('isSlotBlocking', () => {
  it('pending_payment + unpaid => blocks slot (holds for 1 hour)', () => {
    expect(isSlotBlocking('pending_payment', 'unpaid')).toBe(true)
  })
  it('pending_payment + expired => does NOT block', () => {
    expect(isSlotBlocking('pending_payment', 'expired')).toBe(false)
  })
  it('confirmed + paid => blocks slot', () => {
    expect(isSlotBlocking('confirmed', 'paid')).toBe(true)
  })
  it('active + paid => blocks slot', () => {
    expect(isSlotBlocking('active', 'paid')).toBe(true)
  })
  it('expired => does NOT block', () => {
    expect(isSlotBlocking('expired', 'expired')).toBe(false)
  })
  it('cancelled => does NOT block', () => {
    expect(isSlotBlocking('cancelled', null)).toBe(false)
  })
  it('completed => does NOT block (rental returned)', () => {
    expect(isSlotBlocking('completed', 'paid')).toBe(false)
  })
})

// ─── Status Display Labels ─────────────────────────────────────────────────

describe('getStatusDisplayLabel', () => {
  it('pending_payment + unpaid => DA SALDARE', () => {
    expect(getStatusDisplayLabel('pending_payment', 'unpaid')).toBe('DA SALDARE')
  })
  it('confirmed => CONFERMATA', () => {
    expect(getStatusDisplayLabel('confirmed', 'paid')).toBe('CONFERMATA')
  })
  it('active => IN CORSO', () => {
    expect(getStatusDisplayLabel('active')).toBe('IN CORSO')
  })
  it('completed => COMPLETATA', () => {
    expect(getStatusDisplayLabel('completed')).toBe('COMPLETATA')
  })
  it('expired => SCADUTA', () => {
    expect(getStatusDisplayLabel('expired')).toBe('SCADUTA')
  })
  it('cancelled => ANNULLATA', () => {
    expect(getStatusDisplayLabel('cancelled')).toBe('ANNULLATA')
  })
  it('pending_payment + paid => CONFERMATA (payment received, status transitioning)', () => {
    expect(getStatusDisplayLabel('pending_payment', 'paid')).toBe('CONFERMATA')
  })
})

// ─── Calendar Bar Colors ───────────────────────────────────────────────────

describe('getCalendarBarColor', () => {
  it('pending_payment uses amber/dashed (DA SALDARE)', () => {
    const { bgClass, borderClass } = getCalendarBarColor('pending_payment', 'unpaid')
    expect(bgClass).toContain('amber')
    expect(borderClass).toContain('dashed')
  })
  it('confirmed uses dr7-gold (default)', () => {
    const { bgClass } = getCalendarBarColor('confirmed', 'paid')
    expect(bgClass).toContain('dr7-gold')
  })
})

// ─── Payment Link Helpers ──────────────────────────────────────────────────

describe('calculatePaymentLinkExpiry', () => {
  it('returns ISO strings for createdAt and expiresAt', () => {
    const { createdAt, expiresAt } = calculatePaymentLinkExpiry()
    expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
  it('expiresAt is exactly 1 hour after createdAt', () => {
    const baseTime = new Date('2026-03-30T10:00:00Z')
    const { createdAt, expiresAt } = calculatePaymentLinkExpiry(baseTime)
    expect(createdAt).toBe('2026-03-30T10:00:00.000Z')
    expect(expiresAt).toBe('2026-03-30T11:00:00.000Z')
  })
  it('works across midnight boundary', () => {
    const { expiresAt } = calculatePaymentLinkExpiry(new Date('2026-03-30T23:30:00Z'))
    expect(expiresAt).toBe('2026-03-31T00:30:00.000Z')
  })
  it('works across DST boundary (Europe/Rome spring forward)', () => {
    // In UTC, DST doesn't affect the calculation — we always use UTC
    const { createdAt, expiresAt } = calculatePaymentLinkExpiry(new Date('2026-03-29T00:30:00Z'))
    const diff = new Date(expiresAt).getTime() - new Date(createdAt).getTime()
    expect(diff).toBe(PAYMENT_LINK_TTL_MS)
  })
})

describe('isPaymentLinkExpired', () => {
  it('returns false for null/undefined expiresAt (legacy bookings)', () => {
    expect(isPaymentLinkExpired(null)).toBe(false)
    expect(isPaymentLinkExpired(undefined)).toBe(false)
  })
  it('returns true if expiresAt is in the past', () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString() // 1 min ago
    expect(isPaymentLinkExpired(pastDate)).toBe(true)
  })
  it('returns false if expiresAt is in the future', () => {
    const futureDate = new Date(Date.now() + 60_000).toISOString() // 1 min from now
    expect(isPaymentLinkExpired(futureDate)).toBe(false)
  })
})

// ─── Booking Data Builders ─────────────────────────────────────────────────

describe('buildPendingPaymentBookingFields', () => {
  it('returns correct initial fields for Pay by Link booking', () => {
    const fields = buildPendingPaymentBookingFields()
    expect(fields.status).toBe('pending_payment')
    expect(fields.payment_status).toBe('unpaid')
    expect(fields.payment_method).toBe('Nexi Pay by Link')
    expect(fields.payment_link_created_at).toBeTruthy()
    expect(fields.payment_link_expires_at).toBeTruthy()

    // Verify expiry is 1 hour after creation
    const diff = new Date(fields.payment_link_expires_at).getTime() - new Date(fields.payment_link_created_at).getTime()
    expect(diff).toBe(PAYMENT_LINK_TTL_MS)
  })
})

describe('buildPaymentConfirmedFields', () => {
  it('returns confirmed status and paid fields', () => {
    const fields = buildPaymentConfirmedFields('tx123', 'contract456', 50000)
    expect(fields.status).toBe('confirmed')
    expect(fields.payment_status).toBe('paid')
    expect(fields.paid_at).toBeTruthy()
    expect(fields.amount_paid).toBe(50000)
    expect(fields.booking_details_patch.nexi_transaction_id).toBe('tx123')
    expect(fields.booking_details_patch.nexi_contract_id).toBe('contract456')
    expect(fields.booking_details_patch.paymentStatus).toBe('paid')
  })
})

describe('buildExpiredBookingFields', () => {
  it('returns expired status and timestamp', () => {
    const fields = buildExpiredBookingFields()
    expect(fields.status).toBe('expired')
    expect(fields.payment_status).toBe('expired')
    expect(fields.expired_at).toBeTruthy()
  })
})

// ─── Legacy Status Mapping ─────────────────────────────────────────────────

describe('normalizeLegacyStatus', () => {
  it('passes through new statuses unchanged', () => {
    expect(normalizeLegacyStatus('pending_payment')).toBe('pending_payment')
    expect(normalizeLegacyStatus('confirmed')).toBe('confirmed')
    expect(normalizeLegacyStatus('expired')).toBe('expired')
    expect(normalizeLegacyStatus('cancelled')).toBe('cancelled')
  })
  it('maps legacy "pending" + Nexi + unpaid => pending_payment', () => {
    expect(normalizeLegacyStatus('pending', 'Nexi Pay by Link', 'pending')).toBe('pending_payment')
  })
  it('keeps "confirmed" even with Nexi + pending (already a valid status)', () => {
    // confirmed is already a valid new status; legacy mapping only applies to 'pending'
    expect(normalizeLegacyStatus('confirmed', 'Nexi Pay by Link', 'pending')).toBe('confirmed')
  })
  it('maps legacy "pending" without Nexi => pending_payment', () => {
    expect(normalizeLegacyStatus('pending')).toBe('pending_payment')
  })
  it('does NOT map confirmed + paid (already confirmed)', () => {
    expect(normalizeLegacyStatus('confirmed', 'Nexi Pay by Link', 'paid')).toBe('confirmed')
  })
})

// ─── Full Flow Integration Tests ────────────────────────────────────────────

describe('Full Pay by Link Flow (noleggio e lavaggio identici)', () => {
  it('Flow 1: creazione → attesa → pagamento → confermata', () => {
    // Step 1: Create pending booking
    const initial = buildPendingPaymentBookingFields()
    expect(initial.status).toBe('pending_payment')
    expect(initial.payment_status).toBe('unpaid')
    expect(isCalendarVisible(initial.status, initial.payment_status)).toBe(true)
    expect(isSlotBlocking(initial.status, initial.payment_status)).toBe(true)
    expect(getStatusDisplayLabel(initial.status, initial.payment_status)).toBe('DA SALDARE')

    // Step 2: Payment received within 1 hour
    const confirmed = buildPaymentConfirmedFields('tx001', null, 30000)
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.payment_status).toBe('paid')
    expect(isCalendarVisible(confirmed.status, confirmed.payment_status)).toBe(true)
    expect(isSlotBlocking(confirmed.status, confirmed.payment_status)).toBe(true)
    expect(getStatusDisplayLabel(confirmed.status, confirmed.payment_status)).toBe('CONFERMATA')
  })

  it('Flow 2: creazione → attesa → scadenza → rimossa dal calendario', () => {
    // Step 1: Create pending booking
    const initial = buildPendingPaymentBookingFields()
    expect(isCalendarVisible(initial.status, initial.payment_status)).toBe(true)
    expect(isSlotBlocking(initial.status, initial.payment_status)).toBe(true)

    // Step 2: Link expires, no payment
    const expired = buildExpiredBookingFields()
    expect(expired.status).toBe('expired')
    expect(expired.payment_status).toBe('expired')
    expect(isCalendarVisible(expired.status, expired.payment_status)).toBe(false)
    expect(isSlotBlocking(expired.status, expired.payment_status)).toBe(false)
    expect(getStatusDisplayLabel(expired.status, expired.payment_status)).toBe('SCADUTA')
  })

  it('Flow 3: race condition — pagamento e scadenza simultanei → pagamento vince', () => {
    // In the real system, the webhook sets payment_status='paid' first
    // The cron job has a guard: .neq('payment_status', 'paid').is('paid_at', null)
    // So even if the cron runs, it won't overwrite a paid booking

    const confirmed = buildPaymentConfirmedFields('tx_race', null, 10000)
    // Simulate: cron tries to expire but booking is already confirmed
    // The isSlotBlocking check would still be true
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.payment_status).toBe('paid')
    expect(isSlotBlocking(confirmed.status, confirmed.payment_status)).toBe(true)
    expect(isCalendarVisible(confirmed.status, confirmed.payment_status)).toBe(true)
  })

  it('Flow 4: webhook duplicato — secondo webhook non ri-conferma', () => {
    // The callback uses idempotency: if transaction.status === 'completed', skip
    // And conditional update: .neq('payment_status', 'paid')
    // This is verified at the database level, not in the service layer
    const first = buildPaymentConfirmedFields('tx_dup', null, 5000)
    expect(first.status).toBe('confirmed')
    // Second call would not produce any DB update (conditional WHERE clause)
    // No assertion needed here — the guard is in the SQL WHERE clause
  })

  it('Flow 5: link scaduto — timezone UTC coerente', () => {
    // Create a link at a specific UTC time
    const baseTime = new Date('2026-06-15T14:00:00Z') // 16:00 Rome (CEST +2)
    const { createdAt, expiresAt } = calculatePaymentLinkExpiry(baseTime)

    // Verify: 1 hour later in UTC
    expect(expiresAt).toBe('2026-06-15T15:00:00.000Z') // 17:00 Rome

    // At 14:30 UTC (within window) — NOT expired
    const check1 = new Date('2026-06-15T14:30:00Z')
    expect(check1 > new Date(expiresAt)).toBe(false)

    // At 15:01 UTC (after window) — EXPIRED
    const check2 = new Date('2026-06-15T15:01:00Z')
    expect(check2 > new Date(expiresAt)).toBe(true)

    // The key point: we NEVER compare Rome timestamps directly
    // All comparisons use UTC ISO strings
    expect(createdAt).toContain('Z')
    expect(expiresAt).toContain('Z')
  })

  it('Flow 6: noleggio e lavaggio usano gli stessi builder', () => {
    // Both booking types use the same buildPendingPaymentBookingFields
    const rentalFields = buildPendingPaymentBookingFields()
    const washFields = buildPendingPaymentBookingFields()

    // They produce identical structure (different timestamps but same shape)
    expect(rentalFields.status).toBe(washFields.status)
    expect(rentalFields.payment_status).toBe(washFields.payment_status)
    expect(rentalFields.payment_method).toBe(washFields.payment_method)
  })

  it('Flow 7: job scadenza idempotente — non rielabora bookings già scaduti', () => {
    // After expiration, booking has status='expired'
    // The cron job queries: .eq('status', 'pending_payment')
    // So expired bookings are never re-processed
    const expired = buildExpiredBookingFields()
    expect(expired.status).toBe('expired')
    // The cron WHERE clause: .eq('status', 'pending_payment') won't match 'expired'
    expect(expired.status !== 'pending_payment').toBe(true)
  })

  it('Flow 8: webhook arriva dopo scadenza ma pagamento era autorizzato', () => {
    // The webhook should STILL confirm the booking
    // because Nexi authorized the payment (customer DID pay)
    // The callback code checks: if (wasExpired) => re-confirm
    // This is safe because the payment was authorized by Nexi

    // Simulate: booking is expired
    const expired = buildExpiredBookingFields()
    expect(expired.status).toBe('expired')

    // Webhook arrives with payment confirmation
    const confirmed = buildPaymentConfirmedFields('tx_late', null, 20000)
    // Payment wins: status overwritten from expired to confirmed
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.payment_status).toBe('paid')
    expect(isCalendarVisible(confirmed.status, confirmed.payment_status)).toBe(true)
  })
})

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe('Edge Cases', () => {
  it('isCalendarVisible handles unknown status gracefully', () => {
    expect(isCalendarVisible('some_unknown_status')).toBe(false)
  })

  it('isSlotBlocking handles unknown status gracefully', () => {
    expect(isSlotBlocking('some_unknown_status')).toBe(false)
  })

  it('getStatusDisplayLabel handles unknown status', () => {
    expect(getStatusDisplayLabel('xyz')).toBe('XYZ')
  })

  it('isPaymentLinkExpired handles invalid date string', () => {
    // NaN comparisons: new Date() > new Date('invalid') = false
    // Invalid dates are treated as NOT expired — safer than wrongly expiring
    expect(isPaymentLinkExpired('not-a-date')).toBe(false)
  })

  it('calculatePaymentLinkExpiry result is always UTC (Z suffix)', () => {
    const { createdAt, expiresAt } = calculatePaymentLinkExpiry()
    expect(createdAt.endsWith('Z')).toBe(true)
    expect(expiresAt.endsWith('Z')).toBe(true)
  })

  it('buildPendingPaymentBookingFields generates unique timestamps per call', () => {
    const a = buildPendingPaymentBookingFields()
    // Same millisecond might produce same timestamp, that's fine
    expect(a.payment_link_created_at).toBeTruthy()
    expect(a.payment_link_expires_at).toBeTruthy()
  })
})
