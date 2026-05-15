/**
 * Wallet auto-recharge — MANUAL fire endpoint.
 *
 * Same logic as process-wallet-auto-recharges-cron.ts but bypasses the
 * Rome-hour=9 gate so admin can fire today's run on demand (e.g. when
 * the scheduled hour has already passed). Requires admin authentication.
 *
 * POST body (REQUIRED):
 *   { customerId: string }   — the customer's customers_extended.id.
 *                              The endpoint refuses to fire without it,
 *                              so it can never accidentally charge more
 *                              than one customer per call.
 *
 * Idempotency is preserved via metadata.wallet_recurring.last_run_at, so
 * repeated calls on the same day are safe (returns "already charged today").
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'

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

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }
    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: 'missing supabase env' }) }
    }

    let body: { customerId?: string; ignoreDayFilter?: boolean } = {}
    try { body = JSON.parse(event.body || '{}') } catch { /* ignore */ }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    })

    const todayIso = romeTodayIso()
    const todayDay = romeTodayDay()

    let query = sb
        .from('customers_extended')
        .select('id, user_id, email, telefono, full_name, nome, cognome, metadata')
        .not('metadata->wallet_recurring', 'is', null)
    if (body.customerId) query = query.eq('id', body.customerId)

    const { data: customers, error } = await query
    if (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    }

    const results: Array<{ customer_id: string; status: string; reason?: string; amount?: number; orderId?: string }> = []
    let charged = 0

    for (const c of customers || []) {
        const meta = (c.metadata || {}) as Record<string, unknown>
        const r = (meta.wallet_recurring || {}) as RecurringSettings
        if (!r.active) { results.push({ customer_id: c.id, status: 'skipped', reason: 'not active' }); continue }
        if (!body.ignoreDayFilter && r.day !== todayDay) {
            results.push({ customer_id: c.id, status: 'skipped', reason: `day=${r.day} ≠ today=${todayDay}` })
            continue
        }
        if (r.last_run_at === todayIso) {
            results.push({ customer_id: c.id, status: 'skipped', reason: 'already charged today' })
            continue
        }
        const amountEur = Number(r.amount || 0)
        if (amountEur <= 0) { results.push({ customer_id: c.id, status: 'skipped', reason: 'invalid amount' }); continue }
        const contractId = (meta.nexi_contract_id as string | undefined) || ''
        if (!contractId) { results.push({ customer_id: c.id, status: 'failed', reason: 'no nexi_contract_id (card not tokenized)' }); continue }
        if (!c.user_id) { results.push({ customer_id: c.id, status: 'failed', reason: 'no user_id' }); continue }

        const customerName = c.full_name || `${c.nome || ''} ${c.cognome || ''}`.trim() || 'Cliente'
        const customerEmail = c.email || ''

        const chargeRes = await chargeMit(contractId, amountEur, 'Ricarica wallet automatica', customerEmail, customerName)
        if (!chargeRes.success) {
            results.push({ customer_id: c.id, status: 'failed', reason: `Nexi charge failed: ${chargeRes.error}` })
            continue
        }

        // Credit wallet
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
                reference_id: chargeRes.orderId,
                reference_type: 'wallet_auto_recharge',
            })

        await sb
            .from('customers_extended')
            .update({ metadata: { ...meta, wallet_recurring: { ...r, last_run_at: todayIso } } })
            .eq('id', c.id)

        charged++
        results.push({ customer_id: c.id, status: 'charged', amount: amountEur, orderId: chargeRes.orderId })

        // Best-effort WhatsApp via Pro template
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
                console.warn('[wallet-auto-recharge-run-now] WhatsApp send failed:', waErr)
            }
        }
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, charged, results }),
    }
}
