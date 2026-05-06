/**
 * DR7 Club tier-based cashback helper.
 *
 * Single source of truth for the cashback rule:
 *  - User must have an active DR7 Club subscription
 *  - Cashback % depends on the user's tier (computed from annual spend
 *    over the last 12 months: card-paid bookings + wallet recharges)
 *  - Tiers (mirrors `dr7-web-bugfix/utils/dr7club.ts`):
 *      Access     €0     – €2.999    →  2%
 *      Black      €3.000 – €9.999    →  3%
 *      Signature  €10.000+           →  4%
 *
 * Usage:
 *   const pct = await getClubCashbackPct(supabase, userId)
 *   if (pct == null) // no active club → no cashback
 *
 * Cashback amount lands in `user_credit_balance.balance` and is recorded
 * in `credit_transactions` with `reference_type='card_bonus'` so the
 * daily interest accrual (`accrue-club-wallet-interest.ts`) excludes it
 * from the principal — no interest-on-bonus loop.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const TIER_THRESHOLDS = [
    { tier: 'access' as const,    min: 0,     max: 2999,     rewardPercent: 2, label: 'Access' },
    { tier: 'black' as const,     min: 3000,  max: 9999,     rewardPercent: 3, label: 'Black' },
    { tier: 'signature' as const, min: 10000, max: Infinity, rewardPercent: 4, label: 'Signature' },
]

export type ClubTier = 'access' | 'black' | 'signature'

export interface TierInfo {
    tier: ClubTier
    label: string
    rewardPercent: number
    annualSpend: number
}

export function calculateTier(annualSpend: number): TierInfo {
    const t = TIER_THRESHOLDS.find(x => annualSpend >= x.min && annualSpend <= x.max) || TIER_THRESHOLDS[0]
    return { tier: t.tier, label: t.label, rewardPercent: t.rewardPercent, annualSpend }
}

/**
 * Returns true if the user has an active, non-expired DR7 Club subscription.
 */
export async function hasActiveClub(supabase: SupabaseClient, userId: string): Promise<boolean> {
    if (!userId) return false
    const { data } = await supabase
        .from('dr7_club_subscriptions')
        .select('id, status, expires_at')
        .eq('user_id', userId)
        .eq('status', 'active')
        .gte('expires_at', new Date().toISOString())
        .maybeSingle()
    return !!data
}

/**
 * Compute the user's annual spend (card-paid bookings + card wallet recharges)
 * over the last 12 months, in EUR. Excludes wallet-paid bookings, cancelled
 * bookings, and bonus credits — per `tier_annual_spend_rule.md`.
 */
export async function getAnnualSpendEur(supabase: SupabaseClient, userId: string): Promise<number> {
    if (!userId) return 0

    const since = new Date()
    since.setFullYear(since.getFullYear() - 1)
    const sinceIso = since.toISOString()

    // Card-paid bookings in the last 12 months.
    const { data: bookings } = await supabase
        .from('bookings')
        .select('price_total, total_amount, payment_method, payment_status, status, created_at')
        .eq('user_id', userId)
        .gte('created_at', sinceIso)
        .in('payment_status', ['paid', 'completed', 'succeeded'])

    let totalEur = 0
    for (const b of (bookings || [])) {
        const pm = String((b as any).payment_method || '').toLowerCase()
        if (!pm.includes('nexi') && !pm.includes('card') && !pm.includes('stripe')) continue
        const status = String((b as any).status || '').toLowerCase()
        if (status === 'cancelled' || status === 'annullata') continue
        const amount = Number((b as any).price_total ?? (b as any).total_amount ?? 0)
        if (amount > 0) totalEur += amount
    }

    // Wallet recharges (use `recharge_amount`, not `received_amount`,
    // so package bonuses don't compound into tier).
    const { data: recharges } = await supabase
        .from('credit_wallet_purchases')
        .select('recharge_amount, payment_status, created_at')
        .eq('user_id', userId)
        .eq('payment_status', 'succeeded')
        .gte('created_at', sinceIso)

    for (const r of (recharges || [])) {
        const amount = Number((r as any).recharge_amount || 0)
        if (amount > 0) totalEur += amount
    }

    return Math.round(totalEur * 100) / 100
}

/**
 * Returns the cashback percentage for the user, or null if no cashback
 * (no active club). Wraps `hasActiveClub` + `getAnnualSpendEur` + `calculateTier`.
 */
export async function getClubCashbackPct(supabase: SupabaseClient, userId: string): Promise<number | null> {
    if (!await hasActiveClub(supabase, userId)) return null
    const spend = await getAnnualSpendEur(supabase, userId)
    return calculateTier(spend).rewardPercent
}
