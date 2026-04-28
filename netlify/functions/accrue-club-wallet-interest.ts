/**
 * Daily cron: 0.1% interest accrual for DR7 Club members.
 *
 * For each active club member:
 *   1. Compute today's "card-paid principal":
 *        principal = MAX(0, current_balance - lifetime_bonus_credits_remaining)
 *      Bonus credits (reference_type IN 'card_bonus', 'admin_manual',
 *      'referral', 'club_interest_payout', etc.) are spent last — interest
 *      only earns on what the customer actually paid by card.
 *   2. Insert a row into wallet_interest_accruals with
 *      accrual_eur = principal × 0.001.
 *
 * Idempotent via UNIQUE (user_id, accrual_date) — safe to retry.
 */
import { Handler, schedule } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const DAILY_RATE = 0.001 // 0.1% per day

// reference_types that count as BONUS credit (NOT card-paid).
const BONUS_REFERENCE_TYPES = new Set([
    'card_bonus',
    'admin_manual',
    'admin_credit',
    'referral',
    'referral_bonus',
    'milestone',
    'registration_bonus',
    'club_interest_payout',
    'gift',
    'voucher',
    'compensation',
])

const handler: Handler = async () => {
    if (!supabaseUrl || !supabaseServiceKey) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Missing Supabase env vars' }) }
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }) // YYYY-MM-DD

    // 1. Get every active DR7 Club user.
    const { data: clubRows, error: clubErr } = await supabase
        .from('club_subscriptions')
        .select('user_id')
        .eq('status', 'active')
    if (clubErr) {
        console.error('[club-interest] club lookup error:', clubErr.message)
        return { statusCode: 500, body: JSON.stringify({ error: clubErr.message }) }
    }
    const userIds = Array.from(new Set((clubRows || []).map(r => r.user_id).filter(Boolean)))
    console.log(`[club-interest] ${userIds.length} active club members`)

    let inserted = 0
    let skipped = 0
    for (const userId of userIds) {
        try {
            // 2a. Current balance.
            const { data: bal } = await supabase
                .from('user_credit_balance')
                .select('balance')
                .eq('user_id', userId)
                .maybeSingle()
            const currentBalance = Number(bal?.balance || 0)
            if (currentBalance <= 0) { skipped++; continue }

            // 2b. Lifetime bonus credits (sum of all credit transactions where
            // reference_type is in BONUS_REFERENCE_TYPES). Bonuses are
            // assumed to be spent last so principal = balance - bonusRemaining.
            const { data: txs } = await supabase
                .from('credit_transactions')
                .select('amount, transaction_type, reference_type')
                .eq('user_id', userId)
            let lifetimeBonusCredits = 0
            for (const t of (txs || [])) {
                if (t.transaction_type !== 'credit') continue
                const ref = String(t.reference_type || '').toLowerCase()
                if (BONUS_REFERENCE_TYPES.has(ref)) {
                    lifetimeBonusCredits += Number(t.amount || 0)
                }
            }

            const principal = Math.max(0, currentBalance - lifetimeBonusCredits)
            if (principal <= 0) { skipped++; continue }

            const accrual = Math.round(principal * DAILY_RATE * 10000) / 10000 // 4 decimals (sub-cent)

            const { error: insertErr } = await supabase
                .from('wallet_interest_accruals')
                .insert({
                    user_id: userId,
                    accrual_date: today,
                    principal_eur: Math.round(principal * 100) / 100,
                    rate_pct: 0.1,
                    accrual_eur: accrual,
                })
            if (insertErr) {
                // Duplicate (already accrued today) → ignore
                if (insertErr.code === '23505') { skipped++; continue }
                console.error(`[club-interest] insert failed user=${userId}:`, insertErr.message)
            } else {
                inserted++
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`[club-interest] error user=${userId}:`, msg)
        }
    }

    console.log(`[club-interest] done: inserted=${inserted}, skipped=${skipped}`)
    return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, date: today, inserted, skipped }),
    }
}

// Run every day at 02:30 Rome time (00:30 UTC during DST, 01:30 UTC otherwise —
// schedule uses UTC; pick a time that's reliably after midnight in Italy).
export const handler_scheduled = schedule('30 1 * * *', handler)
export { handler }
