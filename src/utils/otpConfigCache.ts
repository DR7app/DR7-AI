/**
 * Singleton cache of system_otp_overrides loaded once on first access and
 * kept fresh via a Supabase realtime subscription.
 *
 * Consumers query `isOtpRequired(code)` — defaults to TRUE when the row
 * is missing or the cache hasn't loaded yet, so disabling an OTP is an
 * explicit action: an empty/unloaded cache never silently bypasses.
 */
import { supabase } from '../supabaseClient'

interface OtpRow {
    id: string
    is_required: boolean
}

let cache: Map<string, boolean> | null = null
let loadPromise: Promise<void> | null = null
let subscribed = false

async function loadOnce(): Promise<void> {
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
        const { data } = await supabase
            .from('system_otp_overrides')
            .select('id, is_required')
        const map = new Map<string, boolean>()
        for (const r of (data || []) as OtpRow[]) map.set(r.id, !!r.is_required)
        cache = map

        if (!subscribed) {
            subscribed = true
            supabase
                .channel('system-otp-overrides')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'system_otp_overrides' }, async () => {
                    const { data: fresh } = await supabase
                        .from('system_otp_overrides')
                        .select('id, is_required')
                    const next = new Map<string, boolean>()
                    for (const r of (fresh || []) as OtpRow[]) next.set(r.id, !!r.is_required)
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
 */
export function isOtpRequired(code: string): boolean {
    // Trigger background load on first call (no await).
    if (!cache && !loadPromise) loadOnce()
    if (!cache) return true // not loaded yet → keep OTP gate
    const v = cache.get(code)
    if (v === undefined) return true // unknown code → keep gate (safe default)
    return v
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
