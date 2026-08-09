/**
 * Daily cron: 0.1% interest accrual for DR7 Club members.
 *
 * For each active club member:
 *   1. Compute today's "card-paid principal":
 *        principal = MAX(0, current_balance - lifetime_bonus_credits_remaining)
 *      Bonus credits (elenco unico in ./utils/walletCredit.ts) are spent
 *      last — interest only earns on what the customer actually paid.
 *   2. Insert a row into wallet_interest_accruals with
 *      accrual_eur = principal × 0.001.
 *
 * Idempotent via UNIQUE (user_id, accrual_date) — safe to retry.
 */
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { computeRealPrincipalEur } from './utils/walletCredit'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const DAILY_RATE = 0.001 // 0.1% per day

// 2026-08-08: l'elenco dei reference_type "bonus" NON vive piu' qui. E'
// centralizzato in ./utils/walletCredit.ts (mirror di Sito/utils/walletCredit.ts),
// cosi' il capitale su cui matura lo 0,1%/giorno e il "Credito reale" mostrato
// al cliente sul profilo sono per costruzione lo stesso numero. Le copie
// divergenti erano la causa dell'inversione credito/bonus.
const handler: Handler = async () => {
    if (!supabaseUrl || !supabaseServiceKey) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Missing Supabase env vars' }) }
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }) // YYYY-MM-DD

    // 1. Get every active DR7 Club user.
    const { data: clubRows, error: clubErr } = await supabase
        .from('dr7_club_subscriptions')
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

            // 2b. Capitale = saldo - bonus residuo. Il bonus si consuma per
            // ultimo, quindi il capitale e' il credito realmente pagato ancora
            // a saldo. Classificazione in ./utils/walletCredit.ts.
            const { data: txs } = await supabase
                .from('credit_transactions')
                .select('amount, transaction_type, reference_type')
                .eq('user_id', userId)
            const principal = computeRealPrincipalEur(currentBalance, txs)
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

// Cron registered via netlify.toml [functions."accrue-club-wallet-interest"]
// schedule = "30 1 * * *" — runs daily at 01:30 UTC (~02:30/03:30 Rome).
export { handler }
