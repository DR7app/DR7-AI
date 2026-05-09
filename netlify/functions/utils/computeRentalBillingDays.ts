/**
 * Customer-facing rental billing days helper (admin Netlify side).
 *
 * Matches the website's `CarBookingWizard` billing rule so the contract
 * and invoice show the same days the customer agreed to on checkout:
 *
 *   1) Calendar-day diff (max 1)
 *   2) +1 day if return time on the return day is later than
 *      (pickup_time - grace_minutes). Default grace = 90 (1h30).
 *
 * Grace is read from `centralina_pro_config.config.automations.late_return_grace_minutes`,
 * cached at module level for 60s. Operators edit it in admin
 * Centralina Pro > Automazioni > Grace ritardo riconsegna.
 *
 * Pre-existing memory note "Contract & Invoice: Math.ceil(rawTimeDiff/24h) — DO NOT CHANGE"
 * is superseded by this helper: the user explicitly asked for the grace
 * rule to apply on admin too (so the contract amount = website preview).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const TTL_MS = 60_000
const DEFAULT_GRACE = 90

let cache: { grace: number; expires: number } | null = null

async function loadGraceMinutes(supabase: SupabaseClient): Promise<number> {
    const now = Date.now()
    if (cache && cache.expires > now) return cache.grace
    let value = DEFAULT_GRACE
    try {
        const { data } = await supabase
            .from('centralina_pro_config')
            .select('config')
            .eq('id', 'main')
            .maybeSingle()
        const cfg = (data?.config ?? null) as Record<string, unknown> | null
        const automations = cfg?.automations as Record<string, unknown> | undefined
        const v = automations?.late_return_grace_minutes
        if (typeof v === 'number' && v >= 0 && v <= 720) value = v
    } catch (err) {
        console.error('[computeRentalBillingDays] grace load failed:', err)
    }
    cache = { grace: value, expires: now + TTL_MS }
    return value
}

/**
 * Returns the number of billing days for a rental, applying the
 * configurable late-return grace rule.
 * Always returns at least 1.
 */
export async function computeRentalBillingDays(
    pickup: Date,
    dropoff: Date,
    supabase: SupabaseClient,
): Promise<number> {
    if (!(pickup instanceof Date) || !(dropoff instanceof Date)) return 1
    if (Number.isNaN(pickup.getTime()) || Number.isNaN(dropoff.getTime())) return 1
    if (dropoff <= pickup) return 1

    // Calendar-day diff (midnight to midnight)
    const pDate = new Date(pickup); pDate.setHours(0, 0, 0, 0)
    const rDate = new Date(dropoff); rDate.setHours(0, 0, 0, 0)
    const diffDaysCalendar = Math.round(
        (rDate.getTime() - pDate.getTime()) / (1000 * 60 * 60 * 24)
    )

    let billingDays = Math.max(1, diffDaysCalendar)

    // Grace rule: +1 day if return is past (pickup_time - grace) on the
    // return day. Only applies for multi-day rentals.
    if (diffDaysCalendar > 0) {
        const grace = await loadGraceMinutes(supabase)
        const pickupMinutes = pickup.getHours() * 60 + pickup.getMinutes()
        const returnMinutes = dropoff.getHours() * 60 + dropoff.getMinutes()
        const graceThreshold = pickupMinutes - grace
        if (returnMinutes > graceThreshold) {
            billingDays += 1
        }
    }

    return billingDays
}
