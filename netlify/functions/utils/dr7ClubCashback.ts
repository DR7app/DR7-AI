/**
 * DR7 Club tier-based cashback helper.
 *
 * Source of truth for tiers is Centralina Pro
 * (`centralina_pro_config.config.dr7_club.tiers`), loaded at runtime by
 * `loadActiveTiers()`. The hardcoded `TIER_THRESHOLDS` below is the
 * fallback when Centralina Pro has never been saved.
 *
 * Rule:
 *  - User must have an active DR7 Club subscription
 *  - Cashback % depends on the user's tier (computed from annual spend
 *    over the last 12 months: card-paid bookings + wallet recharges)
 *
 * Usage:
 *   const pct = await getClubCashbackPct(supabase, userId)
 *   if (pct == null) // no active club / no matching tier → no cashback
 *
 * Cashback amount lands in `user_credit_balance.balance` and is recorded
 * in `credit_transactions` with `reference_type='card_bonus'` so the
 * daily interest accrual (`accrue-club-wallet-interest.ts`) excludes it
 * from the principal — no interest-on-bonus loop.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface TierThreshold {
    tier: string
    min: number
    max: number
    rewardPercent: number
    label: string
}

/**
 * Default tiers — used as fallback ONLY when Centralina Pro has never
 * been saved (no `dr7_club` key in the config row). If the operator
 * explicitly saves an empty list or disables every tier, that intent
 * wins (no cashback).
 */
// ────────────────────────────────────────────────────────────────────────────
// REGOLE SPESA ANNUA — devono restare IDENTICHE in tre punti:
//   1. Sito/utils/dr7club.ts::getAnnualSpend            (cosa VEDE il cliente)
//   2. Sito/netlify/functions/utils/dr7ClubCashback.js  (cashback lato sito)
//   3. DR7-staging/netlify/functions/utils/dr7ClubCashback.ts (questo file)
// Prima del 2026-08-08 divergevano: solo il frontend escludeva le ricariche
// registrate in doppio, quindi il backend calcolava una spesa più alta e
// versava il cashback del tier superiore (Runchina: mostrato 3%, versato 4%).
// ────────────────────────────────────────────────────────────────────────────

/** Stati prenotazione che contano come spesa. */
export const BOOKING_COUNTED_STATUSES = ['completed', 'completata', 'confirmed', 'active']

/**
 * Ricariche registrate DUE VOLTE in credit_wallet_purchases (pagate una sola
 * volta dal cliente). Vanno escluse: gonfiano il tier e quindi il cashback.
 * Fallback usato quando la colonna `excluded_from_tier` non è ancora presente.
 */
export const DUPLICATE_PURCHASE_IDS = new Set<string>([
    '39a4c9cd-5670-465c-977d-cce805514c38', // Runchina 26/02 €1.000 — doppione
    '4e6364d9-8707-4f12-897d-e02d63e0682d', // Runchina 05/05 €2.000 — doppione
])

/**
 * Spesa "congelata" pre-fix per clienti grandfathered. È un PAVIMENTO, mai una
 * sostituzione. Mirror di Sito/utils/dr7club.ts::TIER_SPEND_OVERRIDES.
 */
export const TIER_SPEND_OVERRIDES: Record<string, number> = {
    '3b896d05-3d65-4819-a46a-ea9894343935': 3155.20, // Massimo Runchina
}

/** true se il metodo di pagamento è wallet/gift card (credito riciclato). */
export function isWalletOrGiftMethod(pm: unknown): boolean {
    const m = String(pm || '').toLowerCase().trim()
    if (!m) return false
    return m === 'credit' || m === 'credito' || m.includes('wallet') || m.includes('gift')
}

/** Email dell'utente, per agganciare le prenotazioni create in admin. */
async function getUserEmail(supabase: SupabaseClient, userId: string): Promise<string | null> {
    try {
        const { data } = await supabase.auth.admin.getUserById(userId)
        return data?.user?.email ?? null
    } catch (err) {
        console.warn('[dr7ClubCashback] getUserEmail failed (non-blocking):', (err as Error).message)
        return null
    }
}

/**
 * Somma delle ricariche wallet pagate negli ultimi 12 mesi, in euro.
 * Usa `recharge_amount` (quanto ha pagato il cliente), NON `received_amount`
 * (che include il bonus pacchetto). Esclude i doppioni.
 */
export async function getRechargeSpendEur(
    supabase: SupabaseClient,
    userId: string,
    sinceIso: string
): Promise<number> {
    // La colonna excluded_from_tier arriva con la migrazione 20260808000000: se
    // non c'è ancora, si ripiega sulla lista statica senza far fallire il
    // calcolo (un errore qui azzererebbe la spesa e il cashback di tutti).
    let rows: any[] | null = null
    const withFlag = await supabase
        .from('credit_wallet_purchases')
        .select('id, recharge_amount, excluded_from_tier')
        .eq('user_id', userId)
        .eq('payment_status', 'succeeded')
        .gte('created_at', sinceIso)
    if (withFlag.error) {
        const fallback = await supabase
            .from('credit_wallet_purchases')
            .select('id, recharge_amount')
            .eq('user_id', userId)
            .eq('payment_status', 'succeeded')
            .gte('created_at', sinceIso)
        rows = fallback.data
    } else {
        rows = withFlag.data
    }

    let total = 0
    for (const r of (rows || [])) {
        if (r.excluded_from_tier === true) continue
        if (DUPLICATE_PURCHASE_IDS.has(String(r.id))) continue
        const amount = Number(r.recharge_amount || 0)
        if (amount > 0) total += amount
    }
    return total
}

export const TIER_THRESHOLDS: TierThreshold[] = [
    { tier: 'access',    min: 0,     max: 2999,     rewardPercent: 2, label: 'Access' },
    { tier: 'black',     min: 3000,  max: 9999,     rewardPercent: 3, label: 'Black' },
    { tier: 'signature', min: 10000, max: Infinity, rewardPercent: 4, label: 'Signature' },
]

export type ClubTier = string

export interface TierInfo {
    tier: ClubTier
    label: string
    rewardPercent: number
    annualSpend: number
}

interface RawCentralinaTier {
    id?: unknown
    label?: unknown
    min_annual_spend?: unknown
    rate_pct?: unknown
    is_active?: unknown
}

/**
 * Load the active DR7 Club tier list from Centralina Pro. Returns:
 *  - `TIER_THRESHOLDS` when the config row has no `dr7_club` key
 *    (Centralina Pro never saved this section).
 *  - The operator-edited list otherwise — even if empty (operator
 *    disabled / removed every tier → cashback turned off by intent).
 */
export async function loadActiveTiers(supabase: SupabaseClient): Promise<TierThreshold[]> {
    try {
        const { data } = await supabase
            .from('centralina_pro_config')
            .select('config')
            .eq('id', 'main')
            .maybeSingle()
        const cfg = (data?.config ?? null) as Record<string, unknown> | null
        const dr7Club = cfg?.dr7_club as Record<string, unknown> | undefined
        const tiersRaw = dr7Club?.tiers as RawCentralinaTier[] | undefined
        // No dr7_club key at all → fall back to defaults.
        if (!Array.isArray(tiersRaw)) return TIER_THRESHOLDS
        const active = tiersRaw
            .filter((t) => t && t.is_active !== false)
            .map((t) => {
                const label = String(t.label ?? t.id ?? 'Tier')
                const idStr = String(t.id ?? label).toLowerCase().replace(/\s+/g, '_') || 'tier'
                const min = typeof t.min_annual_spend === 'number'
                    ? t.min_annual_spend
                    : Number(t.min_annual_spend ?? 0)
                const reward = typeof t.rate_pct === 'number'
                    ? t.rate_pct
                    : Number(t.rate_pct ?? 0)
                return { tier: idStr, label, min, rewardPercent: reward, max: 0 }
            })
            .filter((t) => Number.isFinite(t.min) && Number.isFinite(t.rewardPercent))
            .sort((a, b) => a.min - b.min)
        // Operator explicitly disabled / deleted every tier → return empty
        // so the caller produces no cashback. This is intentional, not an error.
        if (active.length === 0) return []
        // Compute `max` based on the next tier's threshold; top tier is open-ended.
        for (let i = 0; i < active.length; i++) {
            active[i].max = i < active.length - 1 ? active[i + 1].min - 1 : Infinity
        }
        return active
    } catch (err) {
        console.error('[dr7ClubCashback] loadActiveTiers failed, using defaults:', err)
        return TIER_THRESHOLDS
    }
}

/**
 * Pick the tier matching `annualSpend` from `tiers`. Returns rewardPercent=0
 * (and a synthetic 'none' tier) when no tier matches — e.g. operator removed
 * the lowest band or the spend is below it.
 */
export function calculateTier(annualSpend: number, tiers: TierThreshold[] = TIER_THRESHOLDS): TierInfo {
    const t = tiers.find(x => annualSpend >= x.min && annualSpend <= x.max)
    if (!t) return { tier: 'none', label: 'Nessun tier', rewardPercent: 0, annualSpend }
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

    // Prenotazioni: stessi TRE percorsi di aggancio usati dal frontend, senno'
    // le prenotazioni create in admin o prima dell'account non contano.
    const email = await getUserEmail(supabase, userId)
    const orClauses = [
        `user_id.eq.${userId}`,
        `booking_details->customer->>customerId.eq.${userId}`,
    ]
    if (email) orClauses.push(`customer_email.ilike.${email}`)

    const { data: bookings } = await supabase
        .from('bookings')
        .select('price_total, payment_method, payment_status, status, created_at')
        .or(orClauses.join(','))
        .in('status', BOOKING_COUNTED_STATUSES)
        .in('payment_status', ['paid', 'completed', 'succeeded'])
        .gte('created_at', sinceIso)

    let totalEur = 0
    for (const b of (bookings || [])) {
        // Conta OGNI metodo che porta denaro nuovo (carta, Nexi, bonifico,
        // contanti...) ed esclude solo wallet/gift card = credito riciclato.
        // Prima c'era una whitelist nexi|card|stripe che tagliava i bonifici.
        if (isWalletOrGiftMethod((b as any).payment_method)) continue
        // bookings.price_total è in CENTESIMI.
        const amount = Number((b as any).price_total || 0) / 100
        if (amount > 0) totalEur += amount
    }

    totalEur += await getRechargeSpendEur(supabase, userId, sinceIso)

    const computed = Math.round(totalEur * 100) / 100
    const override = TIER_SPEND_OVERRIDES[userId]
    // L'override è un PAVIMENTO (mai una sostituzione): stessa regola del sito.
    return typeof override === 'number' ? Math.max(override, computed) : computed
}

/**
 * Returns the cashback percentage for the user, or null when no cashback
 * should be awarded — covering: no active club, no configured tier
 * matches the spend, or the matching tier has rewardPercent <= 0.
 * Wraps `hasActiveClub` + `getAnnualSpendEur` + `loadActiveTiers` +
 * `calculateTier`.
 */
export async function getClubCashbackPct(supabase: SupabaseClient, userId: string): Promise<number | null> {
    if (!await hasActiveClub(supabase, userId)) return null
    const [spend, tiers] = await Promise.all([
        getAnnualSpendEur(supabase, userId),
        loadActiveTiers(supabase),
    ])
    const pct = calculateTier(spend, tiers).rewardPercent
    return pct > 0 ? pct : null
}
