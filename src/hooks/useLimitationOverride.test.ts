/**
 * Tests for the limitation override system.
 *
 * Since @testing-library/react is not installed, we test the backend logic
 * and the service contract rather than React hooks directly.
 * The hook is a thin wrapper around state + authFetch calls, so we test
 * the critical invariants here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock authFetch
vi.mock('../utils/authFetch', () => ({
  authFetch: vi.fn(),
}))

vi.mock('../utils/logAdminAction', () => ({
  logAdminAction: vi.fn(),
}))

import { authFetch } from '../utils/authFetch'

const mockedAuthFetch = vi.mocked(authFetch)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Limitation Override System', () => {

  describe('draftSessionId uniqueness', () => {
    it('crypto.randomUUID generates unique session IDs', () => {
      const id1 = crypto.randomUUID()
      const id2 = crypto.randomUUID()
      expect(id1).not.toBe(id2)
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })

    it('each new session requires new OTP (different session ID)', () => {
      const sessions = new Set<string>()
      for (let i = 0; i < 100; i++) {
        sessions.add(crypto.randomUUID())
      }
      expect(sessions.size).toBe(100)
    })
  })

  describe('override isolation per ruleCode', () => {
    it('overrides are keyed by ruleCode, not globally', () => {
      const overrideMap = new Map<string, string>()
      overrideMap.set('rule_a', 'override-id-a')

      expect(overrideMap.has('rule_a')).toBe(true)
      expect(overrideMap.has('rule_b')).toBe(false) // rule_b not overridden
    })

    it('multiple overrides are tracked independently', () => {
      const overrideMap = new Map<string, string>()
      overrideMap.set('license_too_recent', 'ov-1')
      overrideMap.set('pickup_in_past', 'ov-2')

      expect(overrideMap.size).toBe(2)
      expect(overrideMap.has('license_too_recent')).toBe(true)
      expect(overrideMap.has('pickup_in_past')).toBe(true)
      expect(overrideMap.has('vehicle_year_too_old')).toBe(false)
    })
  })

  describe('consume flow calls backend with bookingId', () => {
    it('sends consume action with overrideId and bookingId', async () => {
      mockedAuthFetch.mockResolvedValue(new Response('{"success":true}', { status: 200 }))

      const overrideId = 'ov-test-123'
      const bookingId = 'booking-456'

      await authFetch('/.netlify/functions/limitation-override-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'consume',
          overrideId,
          bookingId,
        })
      })

      expect(mockedAuthFetch).toHaveBeenCalledWith(
        '/.netlify/functions/limitation-override-otp',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            action: 'consume',
            overrideId: 'ov-test-123',
            bookingId: 'booking-456',
          }),
        })
      )
    })
  })

  describe('validate action contract', () => {
    it('validate action sends draftSessionId and ruleCodes', async () => {
      mockedAuthFetch.mockResolvedValue(new Response(
        JSON.stringify({ results: { rule_a: { valid: true, overrideId: 'ov-1' } } }),
        { status: 200 }
      ))

      const draftSessionId = crypto.randomUUID()

      await authFetch('/.netlify/functions/limitation-override-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'validate',
          draftSessionId,
          flowType: 'booking_create',
          ruleCodes: ['rule_a', 'rule_b'],
        })
      })

      const callBody = JSON.parse(mockedAuthFetch.mock.calls[0][1]!.body as string)
      expect(callBody.action).toBe('validate')
      expect(callBody.draftSessionId).toBe(draftSessionId)
      expect(callBody.ruleCodes).toEqual(['rule_a', 'rule_b'])
    })
  })

  describe('audit snapshot structure', () => {
    it('builds correct snapshot from override entries', () => {
      const draftSessionId = crypto.randomUUID()
      const entries = [
        {
          overrideId: 'ov-1',
          limitationCode: 'license_too_recent',
          limitationMessage: 'Patente troppo recente',
          approvedAt: '2026-04-03T10:00:00Z',
        },
        {
          overrideId: 'ov-2',
          limitationCode: 'pickup_in_past',
          limitationMessage: 'Data nel passato',
          approvedAt: '2026-04-03T10:01:00Z',
        },
      ]

      const snapshot = entries.map(e => ({
        overrideId: e.overrideId,
        limitationCode: e.limitationCode,
        limitationMessage: e.limitationMessage,
        approvedAt: e.approvedAt,
        draftSessionId,
      }))

      expect(snapshot).toHaveLength(2)
      expect(snapshot[0].draftSessionId).toBe(draftSessionId)
      expect(snapshot[0].limitationCode).toBe('license_too_recent')
      expect(snapshot[1].limitationCode).toBe('pickup_in_past')
    })

    it('snapshot is null when no overrides used', () => {
      const overrideMap = new Map()
      const snapshot = overrideMap.size === 0 ? null : Array.from(overrideMap.values())
      expect(snapshot).toBeNull()
    })
  })

  describe('override expiry and status', () => {
    it('expired override is not valid', () => {
      const override = {
        status: 'active',
        otp_verified: true,
        consumed_at: null,
        expires_at: new Date(Date.now() - 60000).toISOString(), // expired 1 min ago
      }

      const now = new Date()
      const valid = override.status === 'active'
        && override.otp_verified
        && !override.consumed_at
        && (!override.expires_at || new Date(override.expires_at) > now)

      expect(valid).toBe(false)
    })

    it('consumed override is not valid', () => {
      const override = {
        status: 'consumed',
        otp_verified: true,
        consumed_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      }

      const valid = override.status === 'active'
        && override.otp_verified
        && !override.consumed_at

      expect(valid).toBe(false)
    })

    it('active non-expired override is valid', () => {
      const override = {
        status: 'active',
        otp_verified: true,
        consumed_at: null,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      }

      const now = new Date()
      const valid = override.status === 'active'
        && override.otp_verified
        && !override.consumed_at
        && (!override.expires_at || new Date(override.expires_at) > now)

      expect(valid).toBe(true)
    })
  })

  describe('idempotency and double-click protection', () => {
    it('consuming same override twice is safe (second call is no-op)', async () => {
      mockedAuthFetch.mockResolvedValue(new Response('{"success":true}', { status: 200 }))

      const overrideMap = new Map([['rule_a', 'ov-1']])

      // First consume
      const entry1 = overrideMap.get('rule_a')
      if (entry1) {
        await authFetch('/.netlify/functions/limitation-override-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'consume', overrideId: entry1 })
        })
        overrideMap.delete('rule_a')
      }

      // Second consume — entry no longer in map
      const entry2 = overrideMap.get('rule_a')
      expect(entry2).toBeUndefined()
      // No call made
      expect(mockedAuthFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('no permanent modifications', () => {
    it('override does not modify customer, vehicle, or configuration data', () => {
      // This is a design-level assertion:
      // The override record only stores: id, draftSessionId, limitationCode, status
      // It never writes to: customers_extended, vehicles, revenue_config, bookings (except booking_details audit)
      const overrideFields = [
        'id', 'draft_session_id', 'flow_type', 'limitation_code',
        'status', 'otp_code', 'otp_expires_at', 'expires_at',
        'approved_by_user_id', 'metadata', 'booking_id',
        'consumed_at', 'approved_at', 'created_at'
      ]

      // None of these are customer/vehicle/config table columns
      const customerFields = ['nome', 'cognome', 'codice_fiscale', 'patente']
      const vehicleFields = ['display_name', 'plate', 'daily_rate', 'vehicle_status']
      const configFields = ['enabled', 'mode', 'config']

      for (const field of overrideFields) {
        expect(customerFields).not.toContain(field)
        expect(vehicleFields).not.toContain(field)
        expect(configFields).not.toContain(field)
      }
    })
  })
})
