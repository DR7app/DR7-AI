import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const NEXI_API_KEY = process.env.NEXI_API_KEY!
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'

const REFRESH_INTERVAL_DAYS = 6

/**
 * Cron giornaliero (03:30 UTC) per le pre-autorizzazioni a lungo termine.
 * I circuiti carte rilasciano l'auth-hold dopo 7-30g a seconda dell'emittente,
 * quindi rinnoviamo silenziosamente ogni 6g via MIT EXPLICIT.
 *
 * Strategia VOID-FIRST: nessun doppio blocco sulla carta del cliente.
 *
 * Per ogni nexi_transactions con:
 *   status = 'preauth_held'
 *   metadata.type = 'mit_preauth'
 *   metadata.expected_capture_by > NOW
 *   metadata.next_refresh_due <= NOW
 *
 * 1) VOID dell'auth attiva (current_operation_id). Carta -> 0 hold.
 *    Se fallisce: skip, retry domani (NO doppio blocco).
 * 2) Crea nuova MIT preauth (recurrence.action=USE_CONTRACT,
 *    captureType=EXPLICIT). Aggiorna current_operation_id, history,
 *    next_refresh_due = NOW + 6g.
 * 3) Se Nexi ritorna EXECUTED (charge invece di hold): auto-refund +
 *    status='preauth_refresh_wrong_charged' per intervento manuale.
 */
const handler: Handler = async (event) => {
    const isManualTest = event.httpMethod === 'POST'
    if (isManualTest) {
        const auth = event.headers.authorization || event.headers.Authorization
        if (!auth || !auth.includes(supabaseServiceKey.slice(-12))) {
            return { statusCode: 401, body: 'Unauthorized' }
        }
    }

    const startedAt = new Date().toISOString()
    console.log('[nexi-preauth-refresh-cron] Started at', startedAt, 'interval', REFRESH_INTERVAL_DAYS, 'days')

    const nowIso = new Date().toISOString()

    const { data: rows, error: queryErr } = await supabase
        .from('nexi_transactions')
        .select('id, order_id, amount_cents, customer_email, description, metadata')
        .eq('status', 'preauth_held')
        .filter('metadata->>type', 'eq', 'mit_preauth')
        .filter('metadata->>next_refresh_due', 'lte', nowIso)

    if (queryErr) {
        console.error('[nexi-preauth-refresh-cron] Query failed:', queryErr)
        return { statusCode: 500, body: JSON.stringify({ error: queryErr.message }) }
    }

    const results: { id: string; status: 'refreshed' | 'expired' | 'failed' | 'skipped' | 'wrong_charged'; reason?: string }[] = []

    for (const row of (rows || [])) {
        const meta = (row.metadata || {}) as Record<string, unknown>
        const expectedCaptureBy = meta.expected_capture_by as string | null
        const contractId = meta.contract_id as string | null
        const customerName = meta.customer_name as string | null
        const currentOperationId = meta.current_operation_id as string | null
        const refreshHistory = Array.isArray(meta.refresh_history) ? meta.refresh_history : []

        if (!contractId) {
            results.push({ id: row.id, status: 'skipped', reason: 'no contract_id' })
            continue
        }

        if (expectedCaptureBy && new Date(expectedCaptureBy) <= new Date()) {
            await supabase.from('nexi_transactions').update({
                metadata: { ...meta, next_refresh_due: null, expired_at: nowIso }
            }).eq('id', row.id)
            results.push({ id: row.id, status: 'expired' })
            continue
        }

        const correlationBase = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })

        // STEP 1: void OLD prima di creare la nuova auth.
        if (currentOperationId) {
            try {
                const voidRes = await fetch(`${NEXI_BASE_URL}/operations/${currentOperationId}/cancels`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Api-Key': NEXI_API_KEY,
                        'Correlation-Id': correlationBase,
                    },
                    body: JSON.stringify({ description: 'Auto-refresh: void prima del rinnovo' }),
                })
                if (!voidRes.ok) {
                    const txt = await voidRes.text()
                    console.warn('[nexi-preauth-refresh-cron] Void OLD failed, skipping refresh:', row.id, voidRes.status, txt.substring(0, 200))
                    await supabase.from('nexi_transactions').update({
                        metadata: {
                            ...meta,
                            last_refresh_attempt_at: nowIso,
                            last_refresh_attempt_failure: `void_old failed: HTTP ${voidRes.status}`,
                        }
                    }).eq('id', row.id)
                    results.push({ id: row.id, status: 'failed', reason: 'void_old_failed' })
                    continue
                }
            } catch (e) {
                console.error('[nexi-preauth-refresh-cron] Void OLD exception:', e)
                results.push({ id: row.id, status: 'failed', reason: 'void_old_exception' })
                continue
            }
        }

        // STEP 2: silent MIT preauth con recurrence block (USE_CONTRACT)
        const newOrderId = `R${row.order_id.slice(-7)}${Date.now().toString(36).slice(-4)}`.slice(0, 18)
        const payload = {
            order: {
                orderId: newOrderId,
                amount: String(row.amount_cents),
                currency: 'EUR',
                description: row.description || `Auto-refresh preauth ${row.order_id}`,
                customerInfo: customerName || row.customer_email ? {
                    cardHolderEmail: row.customer_email || '',
                    cardHolderName: customerName || ''
                } : undefined,
            },
            contractId,
            captureType: 'EXPLICIT',
            // recurrence block RIMOSSO 2026-05-13 dopo bug in produzione:
            // includere il blocco recurrence sul MIT faceva interpretare a
            // Nexi anche gli addebiti normali come pre-auth. Sicurezza prima
            // della feature: senza recurrence il MIT preauth probabilmente
            // non funziona (Nexi addebita), ma almeno gli IMPLICIT charge
            // tornano sicuri.
        }

        const res = await fetch(`${NEXI_BASE_URL}/orders/mit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': NEXI_API_KEY,
                'Correlation-Id': correlationBase.replace(/.$/, '1'),
                'Idempotency-Key': correlationBase.replace(/.$/, '2'),
            },
            body: JSON.stringify(payload),
        })

        const text = await res.text()
        let data: Record<string, unknown> = {}
        try { data = JSON.parse(text) } catch { /* keep raw */ }

        const opResult = ((data as Record<string, Record<string, unknown>>).operation?.operationResult || data.operationResult) as string | undefined
        const newOpId = (((data as Record<string, Record<string, unknown>>).operation?.operationId) || data.operationId) as string | null

        // Safety: se Nexi ha addebitato invece di bloccare, refund immediato
        if (opResult === 'EXECUTED' && newOpId) {
            console.error('[nexi-preauth-refresh-cron] WRONG CHARGE during refresh — auto-refunding op', newOpId)
            try {
                await fetch(`${NEXI_BASE_URL}/operations/${newOpId}/refunds`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Api-Key': NEXI_API_KEY,
                        'Correlation-Id': correlationBase.replace(/.$/, '3'),
                        'Idempotency-Key': correlationBase.replace(/.$/, '4'),
                    },
                    body: JSON.stringify({
                        amount: String(row.amount_cents),
                        currency: 'EUR',
                        description: 'Auto-refund cron: EXECUTED instead of AUTHORIZED',
                    }),
                })
            } catch (e) {
                console.error('[nexi-preauth-refresh-cron] Refund failed:', e)
            }
            await supabase.from('nexi_transactions').update({
                status: 'preauth_refresh_wrong_charged',
                metadata: { ...meta, refresh_wrong_charged_at: nowIso, refresh_wrong_charged_op: newOpId }
            }).eq('id', row.id)
            results.push({ id: row.id, status: 'wrong_charged' })
            continue
        }

        if (!res.ok || opResult !== 'AUTHORIZED') {
            console.error('[nexi-preauth-refresh-cron] Refresh failed:', row.id, opResult, text.substring(0, 200))
            await supabase.from('nexi_transactions').update({
                status: 'preauth_refresh_failed',
                metadata: {
                    ...meta,
                    refresh_failed_at: nowIso,
                    refresh_failure_reason: opResult || `HTTP ${res.status}`,
                    refresh_failure_response: data,
                }
            }).eq('id', row.id)
            results.push({ id: row.id, status: 'failed', reason: opResult || `HTTP ${res.status}` })
            continue
        }

        // STEP 3: success — aggiorna riga con nuovo operationId attivo
        const nextDue = new Date(Date.now() + REFRESH_INTERVAL_DAYS * 86400000).toISOString()
        const newHistory = [
            ...refreshHistory.map((h: Record<string, unknown>, i: number) =>
                i === refreshHistory.length - 1 && !h.voided_at ? { ...h, voided_at: nowIso } : h
            ),
            {
                order_id: newOrderId,
                operation_id: newOpId,
                created_at: nowIso,
                voided_at: null,
                auto: true,
            }
        ]

        await supabase.from('nexi_transactions').update({
            metadata: {
                ...meta,
                current_operation_id: newOpId,
                current_order_id: newOrderId,
                next_refresh_due: nextDue,
                last_refreshed_at: nowIso,
                refresh_history: newHistory.slice(-20),
            }
        }).eq('id', row.id)

        results.push({ id: row.id, status: 'refreshed' })
        console.log(`[nexi-preauth-refresh-cron] Refreshed ${row.id} -> ${newOrderId} / ${newOpId}`)
    }

    const summary = {
        startedAt,
        endedAt: new Date().toISOString(),
        intervalDays: REFRESH_INTERVAL_DAYS,
        candidates: rows?.length || 0,
        refreshed: results.filter(r => r.status === 'refreshed').length,
        expired: results.filter(r => r.status === 'expired').length,
        failed: results.filter(r => r.status === 'failed').length,
        wrongCharged: results.filter(r => r.status === 'wrong_charged').length,
        skipped: results.filter(r => r.status === 'skipped').length,
    }
    console.log('[nexi-preauth-refresh-cron] Done', summary)
    return { statusCode: 200, body: JSON.stringify(summary) }
}

export { handler }
