/**
 * Automatic wallet credit — daily cron.
 *
 * Admin configures per-customer recurring wallet credits via
 * CustomerWalletTab. Settings live in
 * customers_extended.metadata.wallet_recurring = {
 *   day:       1-31,             // day of month
 *   hour:      0-23,             // hour of day (Europe/Rome), default 9
 *   amount:    EUR,
 *   active:    boolean,
 *   last_run_at?: 'YYYY-MM-DD'   // idempotency
 * }
 *
 * Every hour at :00 (Europe/Rome) the cron:
 *   1. Loads all customers whose wallet_recurring.active = true.
 *   2. Filters to those where day == today's day-of-month AND
 *      hour == current Rome hour (defaults to 9 when hour missing).
 *   3. Skips if last_run_at == today's date (idempotency — safe to retry).
 *   4. Credits user_credit_balance.balance += amount.
 *   5. Inserts credit_transactions row (reference_type='wallet_auto_recharge').
 *   6. Updates last_run_at to today.
 *   7. Sends a WhatsApp via Pro template `wallet_auto_recharge` (best effort).
 *
 * NO card charge. The wallet is credited directly — this is an internal
 * accounting feature, not a Nexi MIT recurring payment.
 */
import { schedule } from '@netlify/functions'
import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const SITE_URL = process.env.URL || ''

interface RecurringSettings {
    day?: number
    hour?: number
    amount?: number
    active?: boolean
    last_run_at?: string
}

function romeHour(): number {
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Rome', hour: '2-digit', hour12: false,
    })
    return parseInt(fmt.format(new Date()), 10)
}
function romeTodayIso(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
}
function romeTodayDay(): number {
    return parseInt(romeTodayIso().substring(8, 10), 10)
}

const cronHandler: Handler = async (_event: HandlerEvent, _context: HandlerContext) => {
    const skip = (reason: string) => {
        console.log('[wallet-auto-recharge]', reason)
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason }) }
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return skip('missing supabase env')

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    })

    const todayIso = romeTodayIso()
    const todayDay = romeTodayDay()
    const currentHour = romeHour()

    // Load every customer with wallet_recurring set.
    const { data: customers, error } = await sb
        .from('customers_extended')
        .select('id, user_id, email, telefono, nome, cognome, metadata')
        .not('metadata->wallet_recurring', 'is', null)
    if (error) {
        console.error('[wallet-auto-recharge] customers query failed:', error.message)
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    }

    let credited = 0
    let skippedAlreadyToday = 0
    let skippedNotNow = 0
    let failed = 0

    for (const c of customers || []) {
        const meta = (c.metadata || {}) as Record<string, unknown>
        const r = (meta.wallet_recurring || {}) as RecurringSettings
        if (!r.active) continue

        // Hour defaults to 9 (Europe/Rome) when not set — preserves backward
        // compat with schedules saved before the hour selector existed.
        const scheduledHour = Number.isFinite(r.hour) ? Number(r.hour) : 9
        if (r.day !== todayDay || scheduledHour !== currentHour) {
            skippedNotNow++
            continue
        }
        if (r.last_run_at === todayIso) { skippedAlreadyToday++; continue }

        const amountEur = Number(r.amount || 0)
        if (amountEur <= 0) { console.warn(`[wallet-auto-recharge] invalid amount for ${c.id}`); continue }
        if (!c.user_id) {
            console.warn(`[wallet-auto-recharge] no user_id for ${c.id} — cannot credit wallet`)
            failed++
            continue
        }

        const customerName = `${c.nome || ''} ${c.cognome || ''}`.trim() || 'Cliente'

        // Credit the wallet.
        const { data: balRow } = await sb
            .from('user_credit_balance')
            .select('balance')
            .eq('user_id', c.user_id)
            .maybeSingle()
        const currentBalance = balRow?.balance ? parseFloat(String(balRow.balance)) : 0
        const newBalance = currentBalance + amountEur

        const { error: balErr } = await sb
            .from('user_credit_balance')
            .upsert(
                { user_id: c.user_id, balance: newBalance, last_updated: new Date().toISOString() },
                { onConflict: 'user_id' },
            )
        if (balErr) {
            console.error(`[wallet-auto-recharge] balance upsert failed for ${c.id}:`, balErr.message)
            failed++
            continue
        }

        const { error: txErr } = await sb
            .from('credit_transactions')
            .insert({
                user_id: c.user_id,
                transaction_type: 'credit',
                amount: amountEur,
                balance_after: newBalance,
                description: `Ricarica wallet automatica — €${amountEur.toFixed(2)}`,
                reference_type: 'wallet_auto_recharge',
            })
        if (txErr) {
            console.error(`[wallet-auto-recharge] tx insert failed for ${c.id}:`, txErr.message)
            // balance already bumped — log loudly but don't bail out
        }

        // Mark last_run_at so we don't credit again today.
        await sb
            .from('customers_extended')
            .update({ metadata: { ...meta, wallet_recurring: { ...r, last_run_at: todayIso } } })
            .eq('id', c.id)

        credited++

        // Best-effort WhatsApp confirmation via Pro template
        if (SITE_URL && c.telefono) {
            try {
                await fetch(`${SITE_URL}/.netlify/functions/send-whatsapp-notification`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        customPhone: c.telefono,
                        templateKey: 'wallet_auto_recharge',
                        templateVars: {
                            nome: c.nome || customerName.split(' ')[0],
                            customer_name: customerName,
                            amount: amountEur.toFixed(2),
                            amountEur: amountEur.toFixed(2),
                            importo: amountEur.toFixed(2),
                            total: amountEur.toFixed(2),
                            newBalance: newBalance.toFixed(2),
                            balance: newBalance.toFixed(2),
                        },
                    }),
                })
            } catch (waErr) {
                console.warn('[wallet-auto-recharge] WhatsApp send failed (non-blocking):', waErr)
            }
        }
    }

    console.log(`[wallet-auto-recharge] hour=${currentHour} day=${todayDay} credited=${credited} failed=${failed} skipped_already=${skippedAlreadyToday} skipped_not_now=${skippedNotNow}`)
    return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, credited, failed, skippedAlreadyToday, skippedNotNow }),
    }
}

// Cron runs at :00 of every hour. The handler gates per-customer on
// scheduledHour === currentHour so each customer only fires at their
// chosen time of day.
export const handler = schedule('0 * * * *', cronHandler)
