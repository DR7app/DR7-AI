import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const NEXI_API_KEY = process.env.NEXI_API_KEY!
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'

const REFRESH_INTERVAL_DAYS = 7

/**
 * Cron giornaliero che mantiene attive le pre-autorizzazioni a lungo
 * termine (cauzioni noleggio mensile/annuale). I circuiti carte
 * rilasciano l'auth-hold dopo 7-30g; senza refresh il blocco scade
 * e la cauzione diventa inesistente.
 *
 * Per ogni nexi_transactions con:
 *   status = 'preauth_held'
 *   metadata.type = 'mit_preauth'
 *   metadata.expected_capture_by > NOW()
 *   metadata.next_refresh_due <= NOW()
 *
 * 1. Richiama Nexi MIT /orders/mit con captureType=EXPLICIT sullo stesso
 *    contractId e amount, ottenendo un nuovo operationId.
 * 2. Se OK, void della vecchia auth (cancels) e aggiorna la riga:
 *    current_operation_id = nuovo, refresh_history append, next_refresh_due
 *    = NOW + 7g (o NULL se siamo gia\' oltre expected_capture_by).
 * 3. Se KO (card declined/expired), status = 'preauth_refresh_failed' e
 *    si lascia il vecchio operationId attivo (capture/void possono
 *    ancora tentare prima che scada).
 */
const handler: Handler = async (event) => {
    // Permetti POST diretto per testing manuale (con auth Bearer service key)
    const isManualTest = event.httpMethod === 'POST'
    if (isManualTest) {
        const auth = event.headers.authorization || event.headers.Authorization
        if (!auth || !auth.includes(supabaseServiceKey.slice(-12))) {
            return { statusCode: 401, body: 'Unauthorized' }
        }
    }

    const startedAt = new Date().toISOString()
    console.log('[nexi-preauth-refresh-cron] Started at', startedAt)

    const nowIso = new Date().toISOString()

    // Pesco le righe candidate. Filtro RLS via service role.
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

    const results: { id: string; status: 'refreshed' | 'expired' | 'failed' | 'skipped'; reason?: string }[] = []

    for (const row of (rows || [])) {
        const meta = (row.metadata || {}) as Record<string, unknown>
        const expectedCaptureBy = meta.expected_capture_by as string | null
        const contractId = meta.contract_id as string | null
        const customerName = meta.customer_name as string | null
        const currentOperationId = meta.current_operation_id as string | null
        const refreshHistory = Array.isArray(meta.refresh_history) ? meta.refresh_history : []

        // Salta se non c'e\' contract_id o expected_capture_by
        if (!contractId) {
            results.push({ id: row.id, status: 'skipped', reason: 'no contract_id' })
            continue
        }

        // Se siamo oltre expected_capture_by, smetti di rinnovare —
        // la cauzione e\' scaduta lato admin, deve catturare o annullare.
        if (expectedCaptureBy && new Date(expectedCaptureBy) <= new Date()) {
            await supabase.from('nexi_transactions').update({
                metadata: { ...meta, next_refresh_due: null, expired_at: nowIso }
            }).eq('id', row.id)
            results.push({ id: row.id, status: 'expired' })
            continue
        }

        // Crea una nuova auth con captureType EXPLICIT
        const newOrderId = `R${row.order_id.slice(-7)}${Date.now().toString(36).slice(-4)}`.slice(0, 18)
        const correlationId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })

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
        }

        const res = await fetch(`${NEXI_BASE_URL}/orders/mit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': NEXI_API_KEY,
                'Correlation-Id': correlationId,
                'Idempotency-Key': correlationId,
            },
            body: JSON.stringify(payload),
        })

        const text = await res.text()
        let data: Record<string, unknown> = {}
        try { data = JSON.parse(text) } catch { /* keep raw */ }

        const opResult = ((data as Record<string, Record<string, unknown>>).operation?.operationResult || data.operationResult) as string | undefined
        const newOpId = (((data as Record<string, Record<string, unknown>>).operation?.operationId) || data.operationId) as string | null

        if (!res.ok || !(opResult === 'AUTHORIZED' || opResult === 'EXECUTED')) {
            console.error('[nexi-preauth-refresh-cron] Refresh failed for', row.id, opResult, text.substring(0, 200))
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

        // Void della vecchia auth (libera il blocco precedente cosi\'
        // non si accumulano hold multipli sulla carta del cliente).
        if (currentOperationId) {
            try {
                await fetch(`${NEXI_BASE_URL}/operations/${currentOperationId}/cancels`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Api-Key': NEXI_API_KEY,
                        'Correlation-Id': correlationId.replace(/.$/, '1'),
                    },
                    body: JSON.stringify({ description: 'Auto-refresh: void previous auth' }),
                })
            } catch (e) {
                console.warn('[nexi-preauth-refresh-cron] Void previous auth failed (non-fatal):', e)
            }
        }

        // Aggiorna riga: nuovo current_operation_id, history++, next_refresh_due
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
                refresh_history: newHistory.slice(-20), // ultimi 20 rinnovi
            }
        }).eq('id', row.id)

        results.push({ id: row.id, status: 'refreshed' })
        console.log(`[nexi-preauth-refresh-cron] Refreshed ${row.id} -> ${newOrderId} / ${newOpId}`)
    }

    const summary = {
        startedAt,
        endedAt: new Date().toISOString(),
        candidates: rows?.length || 0,
        refreshed: results.filter(r => r.status === 'refreshed').length,
        expired: results.filter(r => r.status === 'expired').length,
        failed: results.filter(r => r.status === 'failed').length,
        skipped: results.filter(r => r.status === 'skipped').length,
    }
    console.log('[nexi-preauth-refresh-cron] Done', summary)
    return { statusCode: 200, body: JSON.stringify(summary) }
}

export { handler }
