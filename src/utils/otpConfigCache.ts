/**
 * Singleton cache of system_otp_overrides loaded once on first access and
 * kept fresh via a Supabase realtime subscription.
 *
 * Consumers query:
 *   - `isOtpRequired(code)`              → binary (legacy)
 *   - `getOtpConditions(code)`           → array of conditions, [] if none
 *   - `shouldRequireOtp(code, context)`  → combined gate (legacy + conditions)
 *
 * Disabling an OTP is an explicit action: an empty/unloaded cache never
 * silently bypasses (defaults conservatively to TRUE).
 */
import { supabase } from '../supabaseClient'
import { evaluateConditions, type OtpCondition, type OtpContext } from './otpConditionEngine'

interface OtpRow {
    id: string
    is_required: boolean
    conditions?: OtpCondition[] | null
}

interface OtpCacheEntry {
    is_required: boolean
    conditions: OtpCondition[]
}

let cache: Map<string, OtpCacheEntry> | null = null
let loadPromise: Promise<void> | null = null
let subscribed = false

function rowToEntry(r: OtpRow): OtpCacheEntry {
    const conds = Array.isArray(r.conditions) ? r.conditions : []
    return { is_required: !!r.is_required, conditions: conds }
}

async function loadOnce(): Promise<void> {
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
        const { data } = await supabase
            .from('system_otp_overrides')
            .select('id, is_required, conditions')
        const map = new Map<string, OtpCacheEntry>()
        for (const r of (data || []) as OtpRow[]) map.set(r.id, rowToEntry(r))
        cache = map

        if (!subscribed) {
            subscribed = true
            supabase
                .channel('system-otp-overrides')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'system_otp_overrides' }, async () => {
                    const { data: fresh } = await supabase
                        .from('system_otp_overrides')
                        .select('id, is_required, conditions')
                    const next = new Map<string, OtpCacheEntry>()
                    for (const r of (fresh || []) as OtpRow[]) next.set(r.id, rowToEntry(r))
                    cache = next
                })
                .subscribe()
        }
    })()
    return loadPromise
}

/**
 * Synchronous predicate used inside React handlers. Returns TRUE
 * whenever we don't have a definitive "false" — keeps OTP gates
 * conservative until the cache is populated.
 *
 * LEGACY API: ignora le conditions. Per il match condizionale usa
 * `shouldRequireOtp(code, context)`.
 */
export function isOtpRequired(code: string): boolean {
    if (!cache && !loadPromise) loadOnce()
    if (!cache) return true
    const entry = cache.get(code)
    if (!entry) return true
    return entry.is_required
}

/**
 * Ritorna le condizioni configurate per questo OTP. Vuoto se none
 * (l'OTP usa solo il toggle binario).
 */
export function getOtpConditions(code: string): OtpCondition[] {
    if (!cache && !loadPromise) loadOnce()
    if (!cache) return []
    return cache.get(code)?.conditions || []
}

/**
 * Gate completo: combina is_required + condizioni.
 *
 *   - is_required = false      → OTP MAI richiesto (bypass)
 *   - conditions = []          → OTP SEMPRE richiesto (se is_required)
 *   - conditions non vuote     → OTP richiesto solo se TUTTE matchano
 *
 * Quando le condizioni esistono ma il caller non passa un context,
 * defaultiamo a TRUE (conservativo: meglio chiedere OTP che bypassare
 * silenziosamente per mancanza di dati runtime).
 */
export function shouldRequireOtp(code: string, context?: OtpContext): boolean {
    if (!isOtpRequired(code)) return false
    const conds = getOtpConditions(code)
    if (conds.length === 0) return true
    if (!context) return true
    return evaluateConditions(conds, context)
}

/** Force a reload (used by GestioneOtpTab right after a save). */
export async function reloadOtpConfig(): Promise<void> {
    loadPromise = null
    cache = null
    await loadOnce()
}

/** Pre-warm the cache (call from app entry / admin boot). */
export function ensureOtpConfigLoaded(): Promise<void> {
    return loadOnce()
}
