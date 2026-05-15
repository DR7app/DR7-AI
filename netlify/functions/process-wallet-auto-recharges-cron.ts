/**
 * Automatic wallet recharge — daily cron.
 *
 * Admin configures per-customer recurring top-ups via CustomerWalletTab
 * (saved in customers_extended.metadata.wallet_recurring = { day, amount,
 * active, last_run_at? }). This cron runs every day at 09:00 Europe/Rome
 * and:
 *   1. Loads all customers whose wallet_recurring.active = true AND day
 *      matches today's day-of-month (Europe/Rome).
 *   2. For each: skips if last_run_at == today's date (idempotency — safe
 *      to retry without double-charging the card).
 *   3. Charges the customer's tokenized Nexi card (MIT scheduled) using
 *      metadata.nexi_contract_id.
 *   4. On success: bumps user_credit_balance and inserts a credit_transactions
 *      row (transaction_type='credit', reference_type='wallet_auto_recharge').
 *   5. Updates metadata.wallet_recurring.last_run_at to today.
 *   6. Sends a WhatsApp confirmation via the Pro template `wallet_auto_recharge`
 *      (admin must configure the body — no hardcoded fallback).
 *
 * Cron fires at 07 and 08 UTC; the function gates internally on the actual
 * Europe/Rome hour == 9 so DST flips don't break the schedule.
 */
import { schedule } from '@netlify/functions'
import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const NEXI_API_KEY = process.env.NEXI_API_KEY || ''
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'
const SITE_URL = process.env.URL || ''

interface RecurringSettings {
    day?: number
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

async function chargeMit(
    contractId: string,
    amountEur: number,
    description: string,
    customerEmail: string,
    customerName: string,
): Promise<{ success: boolean; error?: string; orderId?: string }> {
    if (!NEXI_API_KEY) return { success: false, error: 'NEXI_API_KEY not configured' }
    const orderId = `MIT-WR-${Date.now()}-${Math.floor(Math.random() * 10000)}`.slice(0, 24)
    const amountCents = Math.round(amountEur * 100)
    const idempotencyKey = `wallet-recharge-${contractId}-${romeTodayIso()}`

    try {
        const res = await fetch(`${NEXI_BASE_URL}/orders/contracts/${contractId}/charges`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': NEXI_API_KEY,
                'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify({
                order: {
                    orderId,
                    amount: amountCents,
                    currency: 'EUR',
                    description: description.slice(0, 35),
                    customerInfo: { cardHolderEmail: customerEmail, cardHolderName: customerName },
                },
                recurrence: { action: 'NO_RECURRING' },
            }),
        })
        const data = await res.json().catch(() => ({} as { errors?: { message?: string }[] }))
        if (!res.ok) {
            const msg = (data as { errors?: { message?: string }[] })?.errors?.[0]?.message
                || `HTTP ${res.status}`
            return { success: false, error: msg, orderId }
        }
        return { success: true, orderId }
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e), orderId }
    }
}

const cronHandler: Handler = async (_event: HandlerEvent, _context: HandlerContext) => {
    const skip = (reason: string) => {
        console.log('[wallet-auto-recharge]', reason)
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason }) }
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return skip('missing supabase env')

    // Gate on Europe/Rome hour == 9. Cron fires at 07+08 UTC to cover CEST
    // (UTC+2, 09 Rome = 07 UTC) and CET (UTC+1, 09 Rome = 08 UTC).
    const hour = romeHour()
    if (hour !== 9) return skip(`outside fire window (rome hour=${hour})`)

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    })

    const todayIso = romeTodayIso()
    const todayDay = romeTodayDay()

    // Load every active wallet_recurring set for today's day-of-month.
    const { data: customers, error } = await sb
        .from('customers_extended')
        .select('id, user_id, email, telefono, full_name, nome, cognome, metadata')
        .not('metadata->wallet_recurring', 'is', null)
    if (error) {
        console.error('[wallet-auto-recharge] customers query failed:', error.message)
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    }

    let charged = 0
    let skippedAlreadyToday = 0
    let skippedNotToday = 0
    let failed = 0

    for (const c of customers || []) {
        const meta = (c.metadata || {}) as Record<string, unknown>
        const r = (meta.wallet_recurring || {}) as RecurringSettings
        if (!r.active) continue
        if (r.day !== todayDay) { skippedNotToday++; continue }
        if (r.last_run_at === todayIso) { skippedAlreadyToday++; continue }
        const amountEur = Number(r.amount || 0)
        if (amountEur <= 0) { console.warn(`[wallet-auto-recharge] invalid amount for ${c.id}`); continue }
        const contractId = (meta.nexi_contract_id as string | undefined) || ''
        if (!contractId) {
            console.warn(`[wallet-auto-recharge] no nexi_contract_id for ${c.id} — admin must tokenize the card first`)
            failed++
            continue
        }
        if (!c.user_id) {
            console.warn(`[wallet-auto-recharge] no user_id for ${c.id} — cannot credit wallet`)
            failed++
            continue
        }

        const customerName = c.full_name || `${c.nome || ''} ${c.cognome || ''}`.trim() || 'Cliente'
        const customerEmail = c.email || ''

        const result = await chargeMit(
            contractId,
            amountEur,
            `Ricarica wallet automatica`,
            customerEmail,
            customerName,
        )
        if (!result.success) {
            console.error(`[wallet-auto-recharge] charge failed for ${c.id}: ${result.error}`)
            failed++
            continue
        }

        // Credit the wallet
        const { data: balRow } = await sb
            .from('user_credit_balance')
            .select('balance')
            .eq('user_id', c.user_id)
            .maybeSingle()
        const currentBalance = balRow?.balance ? parseFloat(String(balRow.balance)) : 0
        const newBalance = currentBalance + amountEur

        await sb
            .from('user_credit_balance')
            .upsert(
                { user_id: c.user_id, balance: newBalance, last_updated: new Date().toISOString() },
                { onConflict: 'user_id' },
            )

        await sb
            .from('credit_transactions')
            .insert({
                user_id: c.user_id,
                transaction_type: 'credit',
                amount: amountEur,
                balance_after: newBalance,
                description: `Ricarica wallet automatica — €${amountEur.toFixed(2)}`,
                reference_id: result.orderId,
                reference_type: 'wallet_auto_recharge',
            })

        // Mark last_run_at so we don't recharge again today
        await sb
            .from('customers_extended')
            .update({ metadata: { ...meta, wallet_recurring: { ...r, last_run_at: todayIso } } })
            .eq('id', c.id)

        charged++

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

    console.log(`[wallet-auto-recharge] done — charged=${charged}, failed=${failed}, skipped_already_today=${skippedAlreadyToday}, skipped_not_today=${skippedNotToday}`)
    return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, charged, failed, skippedAlreadyToday, skippedNotToday }),
    }
}

// Cron fires at 07 + 08 UTC (covers CEST and CET — gate inside on Rome=09).
export const handler = schedule('0 7,8 * * *', cronHandler)
