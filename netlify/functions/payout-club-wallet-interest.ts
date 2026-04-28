/**
 * Monthly cron: pay out the previous month's accrued DR7 Club wallet interest.
 *
 * Runs on the 1st of each month at 03:00 Rome. For each user with unpaid
 * accruals dated in the previous month:
 *   1. Sum accrual_eur for that month.
 *   2. Insert a `credit_transactions` row (transaction_type='credit',
 *      reference_type='club_interest_payout') and bump
 *      `user_credit_balance.balance`.
 *   3. Stamp paid_out_at + payout_tx_id on every accrual row processed.
 *
 * Future re-runs are no-ops because paid_out_at IS NULL is the gate.
 */
import { Handler, schedule } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function previousMonthBounds(): { startIso: string; endIso: string; label: string } {
    // Compute in Europe/Rome to avoid month-boundary drift around DST.
    const now = new Date()
    const romeNowStr = now.toLocaleString('en-CA', { timeZone: 'Europe/Rome' })
    const [y, mo] = romeNowStr.split(',')[0].split('-').map(Number)
    // Previous month
    const prevMonth = mo === 1 ? 12 : mo - 1
    const prevYear = mo === 1 ? y - 1 : y
    const start = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`
    const lastDay = new Date(prevYear, prevMonth, 0).getDate() // day 0 of next month = last day
    const end = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    return { startIso: start, endIso: end, label: `${prevYear}-${String(prevMonth).padStart(2, '0')}` }
}

const handler: Handler = async () => {
    if (!supabaseUrl || !supabaseServiceKey) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Missing Supabase env vars' }) }
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { startIso, endIso, label } = previousMonthBounds()
    console.log(`[club-payout] processing month=${label} (${startIso} → ${endIso})`)

    const { data: rows, error } = await supabase
        .from('wallet_interest_accruals')
        .select('id, user_id, accrual_eur, accrual_date')
        .is('paid_out_at', null)
        .gte('accrual_date', startIso)
        .lte('accrual_date', endIso)
    if (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    }
    if (!rows || rows.length === 0) {
        console.log('[club-payout] nothing to pay out')
        return { statusCode: 200, body: JSON.stringify({ ok: true, month: label, paid_users: 0 }) }
    }

    // Aggregate per user.
    const perUser = new Map<string, { total: number; ids: string[] }>()
    for (const r of rows) {
        const uid = String(r.user_id)
        const cur = perUser.get(uid) || { total: 0, ids: [] }
        cur.total += Number(r.accrual_eur || 0)
        cur.ids.push(r.id)
        perUser.set(uid, cur)
    }

    let paidUsers = 0
    let totalPaidEur = 0
    for (const [userId, agg] of perUser.entries()) {
        // Round to 2 decimals at payout time so the wallet balance stays clean.
        const payoutEur = Math.round(agg.total * 100) / 100
        if (payoutEur <= 0) continue

        try {
            // Bump user_credit_balance.balance.
            const { data: bal } = await supabase
                .from('user_credit_balance')
                .select('balance')
                .eq('user_id', userId)
                .maybeSingle()
            const newBalance = Math.round(((Number(bal?.balance || 0) + payoutEur)) * 100) / 100

            if (bal) {
                await supabase
                    .from('user_credit_balance')
                    .update({ balance: newBalance, last_updated: new Date().toISOString() })
                    .eq('user_id', userId)
            } else {
                await supabase
                    .from('user_credit_balance')
                    .insert({ user_id: userId, balance: newBalance })
            }

            // Insert credit_transactions row.
            const { data: tx } = await supabase
                .from('credit_transactions')
                .insert({
                    user_id: userId,
                    transaction_type: 'credit',
                    amount: payoutEur,
                    balance_after: newBalance,
                    description: `DR7 CLUB PRIVILEGE — interesse mensile ${label} (0,1%/giorno)`,
                    reference_type: 'club_interest_payout',
                })
                .select('id')
                .single()

            // Stamp paid_out_at on every accrual.
            const stamp = new Date().toISOString()
            await supabase
                .from('wallet_interest_accruals')
                .update({ paid_out_at: stamp, payout_tx_id: tx?.id || null })
                .in('id', agg.ids)

            paidUsers++
            totalPaidEur += payoutEur
            console.log(`[club-payout] user=${userId} +€${payoutEur} (new=${newBalance})`)
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`[club-payout] user=${userId} payout failed:`, msg)
        }
    }

    console.log(`[club-payout] done: ${paidUsers} users, total €${totalPaidEur.toFixed(2)}`)
    return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, month: label, paid_users: paidUsers, total_eur: totalPaidEur }),
    }
}

// 1st of each month at 02:00 UTC (~03:00 / 04:00 Rome depending on DST).
export const handler_scheduled = schedule('0 2 1 * *', handler)
export { handler }
