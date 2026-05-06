import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { authFetch } from '../utils/authFetch'
import { logAdminAction } from '../utils/logAdminAction'
import { ensureOtpConfigLoaded, isOtpRequired } from '../utils/otpConfigCache'

interface LimitationState {
  isOpen: boolean
  limitationCode: string
  limitationMessage: string
  actionContext: string
}

interface OverrideEntry {
  overrideId: string
  limitationCode: string
  limitationMessage: string
  approvedAt: string
  notes?: string
}

/**
 * Hook to manage limitation override flow with session-scoped draftSessionId.
 *
 * Each form open (new booking or edit) gets a unique draftSessionId.
 * Overrides are only valid for that specific session — a new session requires new OTP.
 *
 * Usage:
 *   const override = useLimitationOverride()
 *
 *   // Generate new session when form opens:
 *   override.newSession('booking_create')
 *
 *   // In validation:
 *   if (licenseAge < 2 && !override.hasOverride('license_too_recent')) {
 *     override.requestOverride('license_too_recent', 'Patente rilasciata da meno di 2 anni')
 *     return // stop flow
 *   }
 *
 *   // After booking succeeds:
 *   await override.consumeAllOverrides(bookingId)
 */
export function useLimitationOverride() {
  const [limitationState, setLimitationState] = useState<LimitationState>({
    isOpen: false,
    limitationCode: '',
    limitationMessage: '',
    actionContext: '',
  })

  // Session identity
  const draftSessionIdRef = useRef<string>(crypto.randomUUID())
  const flowTypeRef = useRef<string>('booking_create')

  // Map of limitationCode -> OverrideEntry (approved but not yet consumed)
  const overrideMap = useRef<Map<string, OverrideEntry>>(new Map())

  // Expose a simple Set for checking (triggers re-render on change)
  const [overrideCodes, setOverrideCodes] = useState<Set<string>>(new Set())

  // Computed list for display badges
  const activeOverrides = useMemo(() => {
    return Array.from(overrideMap.current.values())
  }, [overrideCodes]) // eslint-disable-line react-hooks/exhaustive-deps

  const draftSessionId = draftSessionIdRef.current
  const flowType = flowTypeRef.current

  /** Generate a new session (call when form opens or resets) */
  const newSession = useCallback((ft: 'booking_create' | 'booking_edit' | 'preventivo_create' | 'preventivo_edit' = 'booking_create') => {
    draftSessionIdRef.current = crypto.randomUUID()
    flowTypeRef.current = ft
    overrideMap.current.clear()
    setOverrideCodes(new Set())
  }, [])

  // Pre-warm OTP config cache once when this hook mounts.
  useEffect(() => { ensureOtpConfigLoaded() }, [])

  const requestOverride = useCallback((code: string, message: string, context?: string) => {
    // If this OTP gate has been disabled in Gestione OTP, auto-approve
    // synthetically without opening the modal. Audit log still records
    // the bypass with a `_bypass` overrideId so the action is traceable.
    if (!isOtpRequired(code)) {
      const bypassId = `bypass_${code}_${Date.now()}`
      overrideMap.current.set(code, {
        overrideId: bypassId,
        limitationCode: code,
        limitationMessage: message,
        approvedAt: new Date().toISOString(),
      })
      setOverrideCodes(new Set(overrideMap.current.keys()))
      logAdminAction('limitation_override_bypassed', 'limitation', bypassId, {
        limitation_code: code,
        limitation_message: message,
        action_context: context || `${code}_${Date.now()}`,
        draft_session_id: draftSessionIdRef.current,
        flow_type: flowTypeRef.current,
        reason: 'is_required=false in system_otp_overrides',
      })
      return
    }
    setLimitationState({
      isOpen: true,
      limitationCode: code,
      limitationMessage: message,
      actionContext: context || `${code}_${Date.now()}`,
    })
  }, [])

  const handleOverrideApproved = useCallback((overrideId: string, notes?: string) => {
    const code = limitationState.limitationCode
    overrideMap.current.set(code, {
      overrideId,
      limitationCode: code,
      limitationMessage: limitationState.limitationMessage,
      approvedAt: new Date().toISOString(),
      notes,
    })
    setOverrideCodes(new Set(overrideMap.current.keys()))

    // Audit log
    logAdminAction('limitation_override_approved', 'limitation', overrideId, {
      limitation_code: code,
      limitation_message: limitationState.limitationMessage,
      action_context: limitationState.actionContext,
      draft_session_id: draftSessionIdRef.current,
      flow_type: flowTypeRef.current,
      ...(notes ? { notes } : {}),
    })

    setLimitationState(prev => ({ ...prev, isOpen: false }))
  }, [limitationState])

  const closeLimitation = useCallback(() => {
    setLimitationState(prev => ({ ...prev, isOpen: false }))
  }, [])

  /** Cancel limitation and reset the entire session (user chose "Annulla") */
  const cancelLimitation = useCallback(() => {
    setLimitationState(prev => ({ ...prev, isOpen: false }))
    overrideMap.current.clear()
    setOverrideCodes(new Set())
  }, [])

  const hasOverride = useCallback((code: string) => {
    return overrideMap.current.has(code)
  }, [])

  /** Consume a single override (link to bookingId) */
  const consumeOverride = useCallback(async (code: string, bookingId?: string) => {
    const entry = overrideMap.current.get(code)
    if (!entry) return

    try {
      await authFetch('/.netlify/functions/limitation-override-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'consume',
          overrideId: entry.overrideId,
          bookingId: bookingId || null
        })
      })
    } catch {
      // Non-critical: override was already used, just log
    }

    overrideMap.current.delete(code)
    setOverrideCodes(new Set(overrideMap.current.keys()))
  }, [])

  /** Consume all overrides for the current session and link to final bookingId */
  const consumeAllOverrides = useCallback(async (bookingId?: string) => {
    const entries = Array.from(overrideMap.current.entries())
    for (const [code] of entries) {
      await consumeOverride(code, bookingId)
    }
  }, [consumeOverride])

  /**
   * Build audit snapshot of all overrides used in this session.
   * Call before booking insert to embed in booking_details.
   */
  const getOverrideAuditSnapshot = useCallback(() => {
    if (overrideMap.current.size === 0) return null
    return Array.from(overrideMap.current.values()).map(e => ({
      overrideId: e.overrideId,
      limitationCode: e.limitationCode,
      limitationMessage: e.limitationMessage,
      approvedAt: e.approvedAt,
      ...(e.notes ? { notes: e.notes } : {}),
      draftSessionId: draftSessionIdRef.current,
    }))
  }, [])

  return {
    limitationState,
    overrideCodes,
    activeOverrides,
    draftSessionId,
    flowType,
    newSession,
    requestOverride,
    handleOverrideApproved,
    closeLimitation,
    cancelLimitation,
    hasOverride,
    consumeOverride,
    consumeAllOverrides,
    getOverrideAuditSnapshot,
  }
}
