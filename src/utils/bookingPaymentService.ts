/**
 * bookingPaymentService.ts
 *
 * SINGLE SOURCE OF TRUTH for the Pay by Link booking lifecycle.
 * Applies identically to rentals (booking_type = 'rental') and car washes (booking_type = 'car_wash').
 *
 * === BOOKING STATUS STATE MACHINE ===
 *
 *   pending_payment  ──(payment received)──►  confirmed
 *        │                                        │
 *        │(link expired, no payment)               │(rental completed)
 *        ▼                                        ▼
 *     expired                                  completed
 *
 * === PAYMENT STATUS ===
 *   unpaid  ──(payment received)──►  paid
 *      │
 *      │(link expired)
 *      ▼
 *   expired
 *
 * === CALENDAR VISIBILITY RULE ===
 *   SHOW:  pending_payment (if not expired) + confirmed + active + completed
 *   HIDE:  expired + cancelled
 *
 * === SLOT BLOCKING RULE ===
 *   BLOCK: pending_payment (if not expired) + confirmed + active
 *   FREE:  expired + cancelled + completed
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Payment link validity window in milliseconds (1 hour) */
export const PAYMENT_LINK_TTL_MS = 60 * 60 * 1000

/** Payment link validity window in hours (for Nexi API) */
export const PAYMENT_LINK_TTL_HOURS = 1

// ─── Booking Status ─────────────────────────────────────────────────────────

export type BookingStatus = 'pending_payment' | 'confirmed' | 'active' | 'completed' | 'expired' | 'cancelled'
export type PaymentStatus = 'unpaid' | 'paid' | 'expired' | 'failed'

/** Statuses that appear on the calendar */
export const CALENDAR_VISIBLE_STATUSES: BookingStatus[] = ['pending_payment', 'confirmed', 'active', 'completed']

/** Statuses that block a vehicle slot */
export const SLOT_BLOCKING_STATUSES: BookingStatus[] = ['pending_payment', 'confirmed', 'active']

/** Statuses considered terminal (no further transitions) */
export const TERMINAL_STATUSES: BookingStatus[] = ['expired', 'cancelled', 'completed']

// ─── Status Transition Helpers ──────────────────────────────────────────────

/**
 * Determines if a booking should be visible on the calendar.
 * This is the ONLY function that should decide calendar visibility.
 */
export function isCalendarVisible(status: string, paymentStatus?: string | null): boolean {
  // Expired and cancelled are always hidden
  if (status === 'expired' || status === 'cancelled') return false
  // pending_payment bookings with expired payment are hidden
  if (status === 'pending_payment' && paymentStatus === 'expired') return false
  // Everything else is visible
  return CALENDAR_VISIBLE_STATUSES.includes(status as BookingStatus)
}

/**
 * Determines if a booking should block a vehicle slot (prevent double-booking).
 * This is the ONLY function that should decide slot blocking.
 */
export function isSlotBlocking(status: string, paymentStatus?: string | null): boolean {
  if (status === 'expired' || status === 'cancelled') return false
  if (status === 'pending_payment' && paymentStatus === 'expired') return false
  return SLOT_BLOCKING_STATUSES.includes(status as BookingStatus)
}

/**
 * Returns the display label for a booking status (Italian).
 */
export function getStatusDisplayLabel(status: string, paymentStatus?: string | null): string {
  if (status === 'pending_payment') return paymentStatus === 'paid' ? 'CONFERMATA' : 'DA SALDARE'
  if (status === 'confirmed') return 'CONFERMATA'
  if (status === 'active') return 'IN CORSO'
  if (status === 'completed') return 'COMPLETATA'
  if (status === 'expired') return 'SCADUTA'
  if (status === 'cancelled') return 'ANNULLATA'
  // Fallback for legacy statuses
  if (status === 'pending') return 'IN ATTESA'
  return status.toUpperCase()
}

/**
 * Determines the calendar bar color class for a booking.
 */
export function getCalendarBarColor(status: string, paymentStatus?: string | null): { bgClass: string; borderClass: string } {
  if (status === 'pending_payment' && paymentStatus !== 'paid') {
    return { bgClass: 'bg-amber-500/70', borderClass: 'border-amber-400/50 border-dashed' }
  }
  // Default: confirmed/active/completed
  return { bgClass: 'bg-dr7-gold', borderClass: 'border-dr7-gold/30' }
}

// ─── Payment Link Helpers ───────────────────────────────────────────────────

/**
 * Calculates payment link expiration timestamp.
 * Always returns UTC ISO string.
 */
export function calculatePaymentLinkExpiry(createdAt?: Date): { createdAt: string; expiresAt: string } {
  const now = createdAt || new Date()
  const expires = new Date(now.getTime() + PAYMENT_LINK_TTL_MS)
  return {
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString()
  }
}

/**
 * Checks if a payment link has expired.
 * Uses UTC comparison only — no timezone mixing.
 */
export function isPaymentLinkExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false // No expiry set = not expired (legacy bookings)
  return new Date() > new Date(expiresAt)
}

// ─── Booking Data Builders ──────────────────────────────────────────────────

/**
 * Builds the initial booking fields for a Pay by Link booking.
 * Used by BOTH ReservationsTab (rentals) and CarWashBookingsTab (washes).
 */
export function buildPendingPaymentBookingFields() {
  const { createdAt, expiresAt } = calculatePaymentLinkExpiry()
  return {
    status: 'pending_payment' as const,
    payment_status: 'unpaid' as const,
    payment_method: 'Nexi Pay by Link' as const,
    payment_link_created_at: createdAt,
    payment_link_expires_at: expiresAt,
  }
}

/**
 * Builds the update fields when a payment link URL is received from Nexi.
 */
export function buildPaymentLinkUpdateFields(paymentUrl: string, orderId: string) {
  return {
    payment_link_url: paymentUrl,
    booking_details_patch: {
      nexi_payment_link: paymentUrl,
      nexi_order_id: orderId,
    }
  }
}

/**
 * Builds the update fields when a payment is confirmed via Nexi callback.
 * This is the ONLY way a booking transitions from pending_payment to confirmed.
 */
export function buildPaymentConfirmedFields(transactionId: string, contractId: string | null, amountCents: number) {
  return {
    status: 'confirmed' as const,
    payment_status: 'paid' as const,
    paid_at: new Date().toISOString(),
    amount_paid: amountCents,
    booking_details_patch: {
      nexi_transaction_id: transactionId,
      nexi_contract_id: contractId,
      nexi_paid_at: new Date().toISOString(),
      paymentStatus: 'paid',
    }
  }
}

/**
 * Builds the update fields when a booking expires (link not paid within 1h).
 * This is the ONLY way a booking transitions from pending_payment to expired.
 */
export function buildExpiredBookingFields() {
  return {
    status: 'expired' as const,
    payment_status: 'expired' as const,
    expired_at: new Date().toISOString(),
  }
}

// ─── Legacy Status Mapping ──────────────────────────────────────────────────

/**
 * Maps legacy booking statuses to the new system.
 * Used for backward compatibility during transition.
 */
export function normalizeLegacyStatus(status: string, paymentMethod?: string | null, paymentStatus?: string | null): BookingStatus {
  // Already using new statuses
  if (['pending_payment', 'confirmed', 'active', 'completed', 'expired', 'cancelled'].includes(status)) {
    return status as BookingStatus
  }
  // Legacy mapping: 'pending' was used for unpaid Nexi bookings
  if (status === 'pending') return 'pending_payment'
  return status as BookingStatus
}
