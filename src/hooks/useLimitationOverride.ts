import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { authFetch } from '../utils/authFetch'
import { logAdminAction } from '../utils/logAdminAction'
import { ensureOtpConfigLoaded, isOtpRequired, shouldRequireOtp } from '../utils/otpConfigCache'
import type { OtpContext } from '../utils/otpConditionEngine'
import { supabase } from '../supabaseClient'

// Direzione + Salvatore + Ophelie: bypassano TUTTE le richieste OTP a
// prescindere dal codice. Stesso elenco usato da OperatoriTab/PreventiviTab
// per altri gate sensibili. 2026-05-15: aggiunta ophe@dr7.app per i lavori
// di sviluppo/manutenzione (configurazione siti, debug, modifiche di test).
const OTP_BYPASS_EMAILS = new Set([
  'valerio@dr7.app',
  'ilenia@dr7.app',
  'salvatore@dr7.app',
  'ophe@dr7.app',
])

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

  // Carica e memorizza l'email dell'admin loggato — usata per il bypass
  // globale (direzione + Salvatore). Letta una sola volta al mount.
  const adminEmailRef = useRef<string | null>(null)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      adminEmailRef.current = (data.session?.user?.email || '').toLowerCase()
    })
  }, [])

  const requestOverride = useCallback((
    code: string,
    message: string,
    contextOrOptions?: string | { audit?: string; context?: OtpContext; bypass?: boolean }
  ) => {
    // Normalize il 3o parametro: stringa = solo audit, oggetto = { audit, context, bypass }
    const auditCtx = typeof contextOrOptions === 'string'
      ? contextOrOptions
      : contextOrOptions?.audit
    const runtimeCtx = typeof contextOrOptions === 'object' && contextOrOptions
      ? contextOrOptions.context
      : undefined
    // bypass=true: il caller dichiara che questa istanza NON deve mai chiedere
    // OTP (es. veicolo TEST). Equivalente a is_required=false ma deciso al
    // call-site con dati runtime (vehicle_plate, ecc.). Audit log marcato
    // come 'caller_bypass' per tracciabilita'.
    const explicitBypass = typeof contextOrOptions === 'object' && contextOrOptions?.bypass === true
    // Bypass globale per direzione + Salvatore: nessun OTP, mai, per qualsiasi codice.
    const adminBypass = !!adminEmailRef.current && OTP_BYPASS_EMAILS.has(adminEmailRef.current)
    const callerBypass = explicitBypass || adminBypass

    // Gate completo: is_required AND conditions. Se l'OTP e' disabilitato
    // OPPURE le condizioni configurate non matchano il context runtime,
    // OPPURE il caller ha richiesto un bypass esplicito (test vehicle),
    // bypass silenzioso + audit log.
    if (callerBypass || !shouldRequireOtp(code, runtimeCtx)) {
      const isDisabled = !isOtpRequired(code)
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
        action_context: auditCtx || `${code}_${Date.now()}`,
        draft_session_id: draftSessionIdRef.current,
        flow_type: flowTypeRef.current,
        reason: adminBypass
          ? `admin_bypass (${adminEmailRef.current})`
          : explicitBypass
            ? 'caller_bypass (es. veicolo TEST)'
            : isDisabled
              ? 'is_required=false in system_otp_overrides'
              : 'conditions_not_matched',
        ...(runtimeCtx ? { runtime_context: runtimeCtx as Record<string, unknown> } : {}),
      })
      return
    }
    setLimitationState({
      isOpen: true,
      limitationCode: code,
      limitationMessage: message,
      actionContext: auditCtx || `${code}_${Date.now()}`,
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

  /**
   * Marca come approvati ulteriori codici limitation con lo stesso
   * overrideId di un'OTP appena verificata. Serve per i flussi in cui un
   * unico OTP autorizza più gate insieme (email "motivazioni combinate"):
   * la modal verifica la prima limitation, poi questo metodo registra
   * anche le altre nella stessa sessione, così i gate successivi non
   * ri-promptano e l'audit log traccia tutte le autorizzazioni.
   */
  const markCodesApproved = useCallback((codes: string[], overrideId: string, message: string) => {
    if (!codes || codes.length === 0) return
    const approvedAt = new Date().toISOString()
    for (const code of codes) {
      if (overrideMap.current.has(code)) continue
      overrideMap.current.set(code, {
        overrideId,
        limitationCode: code,
        limitationMessage: message,
        approvedAt,
      })
      logAdminAction('limitation_override_approved_combo', 'limitation', overrideId, {
        limitation_code: code,
        limitation_message: message,
        action_context: `combo_${overrideId}`,
        draft_session_id: draftSessionIdRef.current,
        flow_type: flowTypeRef.current,
        combo: true,
      })
    }
    setOverrideCodes(new Set(overrideMap.current.keys()))
  }, [])

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
    markCodesApproved,
    closeLimitation,
    cancelLimitation,
    hasOverride,
    consumeOverride,
    consumeAllOverrides,
    getOverrideAuditSnapshot,
  }
}
