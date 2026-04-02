import { useState, useCallback, useRef } from 'react'
import { authFetch } from '../utils/authFetch'
import { logAdminAction } from '../utils/logAdminAction'

interface LimitationState {
  isOpen: boolean
  limitationCode: string
  limitationMessage: string
  actionContext: string
}

/**
 * Hook to manage limitation override flow.
 *
 * Usage:
 *   const { limitationState, requestOverride, consumeOverride, closeLimitation, overrideIds } = useLimitationOverride()
 *
 *   // In validation:
 *   if (licenseAge < 2) {
 *     requestOverride('license_too_recent', 'Patente rilasciata da meno di 2 anni', bookingContext)
 *     return // stop flow
 *   }
 *
 *   // Check if override already approved:
 *   if (overrideIds.has('license_too_recent')) {
 *     // proceed — override was approved
 *   }
 *
 *   // After booking succeeds, consume the override:
 *   await consumeOverride('license_too_recent')
 */
export function useLimitationOverride() {
  const [limitationState, setLimitationState] = useState<LimitationState>({
    isOpen: false,
    limitationCode: '',
    limitationMessage: '',
    actionContext: '',
  })

  // Map of limitationCode -> overrideId (approved but not yet consumed)
  const overrideMap = useRef<Map<string, string>>(new Map())

  // Expose a simple Set-like interface for checking
  const [overrideCodes, setOverrideCodes] = useState<Set<string>>(new Set())

  const requestOverride = useCallback((code: string, message: string, context?: string) => {
    setLimitationState({
      isOpen: true,
      limitationCode: code,
      limitationMessage: message,
      actionContext: context || `${code}_${Date.now()}`,
    })
  }, [])

  const handleOverrideApproved = useCallback((overrideId: string) => {
    const code = limitationState.limitationCode
    overrideMap.current.set(code, overrideId)
    setOverrideCodes(new Set(overrideMap.current.keys()))

    // Audit log
    logAdminAction('limitation_override_approved', 'limitation', overrideId, {
      limitation_code: code,
      limitation_message: limitationState.limitationMessage,
      action_context: limitationState.actionContext,
    })

    setLimitationState(prev => ({ ...prev, isOpen: false }))
  }, [limitationState])

  const closeLimitation = useCallback(() => {
    setLimitationState(prev => ({ ...prev, isOpen: false }))
  }, [])

  const hasOverride = useCallback((code: string) => {
    return overrideMap.current.has(code)
  }, [])

  const consumeOverride = useCallback(async (code: string) => {
    const overrideId = overrideMap.current.get(code)
    if (!overrideId) return

    try {
      await authFetch('/.netlify/functions/limitation-override-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'consume', overrideId })
      })
    } catch {
      // Non-critical: override was already used, just log
    }

    overrideMap.current.delete(code)
    setOverrideCodes(new Set(overrideMap.current.keys()))
  }, [])

  const consumeAllOverrides = useCallback(async () => {
    const entries = Array.from(overrideMap.current.entries())
    for (const [code] of entries) {
      await consumeOverride(code)
    }
  }, [consumeOverride])

  return {
    limitationState,
    overrideCodes,
    requestOverride,
    handleOverrideApproved,
    closeLimitation,
    hasOverride,
    consumeOverride,
    consumeAllOverrides,
  }
}
