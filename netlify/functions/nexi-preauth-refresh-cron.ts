import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const NEXI_API_KEY = process.env.NEXI_API_KEY!
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'

const REFRESH_INTERVAL_DAYS = 6

/**
 * Cron giornaliero per le pre-autorizzazioni a lungo termine (cauzioni
 * con durata > 7 giorni). I circuiti carte rilasciano l'auth-hold dopo
 * 7-30g a seconda dell'emittente: senza un refresh il blocco scade.
 *
 * Strategia (evita doppio blocco fondi):
 * 1) Per ogni riga preauth_held con next_refresh_due <= NOW e
 *    expected_capture_by > NOW:
 * 2) PRIMA si fa il VOID dell'auth attiva (current_operation_id). Cosi\'
 *    sulla carta del cliente resta 0 hold attivi.
 * 3) Se il void riesce, si crea un NUOVO link preauth via paybylink
 *    USE_CONTRACT (l'unico endpoint Nexi che onora EXPLICIT). Il link
 *    viene salvato in metadata e va inviato al cliente (notification
 *    separata: WhatsApp/email).
 * 4) La riga passa in stato 'preauth_pending_refresh_confirm' finche\'
 *    il cliente non conferma cliccando il link (callback aggiorna a
 *    'preauth_held').
 * 5) Se il void fallisce: skip refresh oggi, retry domani. NESSUN
 *    accumulo di auth holds.
 *
 * /v1/orders/mit con EXPLICIT NON funziona (confermato bug Nexi:
 * addebita invece di bloccare). Per questo non si usa qui.
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
    console.log('[nexi-preauth-refresh-cron] Started at', startedAt, 'interval', REFRESH_INTERVAL_DAYS, 'days')

    const nowIso = new Date().toISOString()
    const siteUrl = process.env.URL || 'https://admin.dr7empire.com'

    // Solo preauth_held (l'unica situazione che ha senso rinnovare).
    const { data: rows, error: queryErr } = await supabase
        .from('nexi_transactions')
        .select('id, order_id, amount_cents, customer_email, description, metadata')
        .eq('status', 'preauth_held')
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

        if (!contractId) {
            results.push({ id: row.id, status: 'skipped', reason: 'no contract_id' })
            continue
        }

        // Se la deadline admin e\' passata, ferma il rinnovo.
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

        // STEP 1: VOID della vecchia auth PRIMA di creare la nuova.
        // Evita di avere 2 holds attivi contemporaneamente sulla carta.
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
                    // Il void e\' fallito. NON creo una nuova auth — eviterei un
                    // doppio blocco. Lascio la riga com'e\' e riprovo domani.
                    const txt = await voidRes.text()
                    console.warn('[nexi-preauth-refresh-cron] Void OLD failed, skipping refresh today:', row.id, voidRes.status, txt.substring(0, 200))
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

        // STEP 2: crea il NUOVO link preauth via paybylink USE_CONTRACT.
        // Endpoint provato (lo stesso usato per le cauzioni con EXPLICIT).
        const newOrderId = `R${row.order_id.slice(-7)}${Date.now().toString(36).slice(-4)}`.slice(0, 18)
        const linkExpiration = new Date(Date.now() + 48 * 60 * 60 * 1000) // 48h per cliccare

        const payload = {
            order: {
                orderId: newOrderId,
                amount: String(row.amount_cents),
                currency: 'EUR',
                description: row.description || `Rinnovo pre-autorizzazione ${row.order_id}`,
                customField: `refresh_${row.id}`,
                customerInfo: {
                    cardHolderEmail: row.customer_email || '',
                    cardHolderName: customerName || '',
                },
            },
            paymentSession: {
                actionType: 'PAY',
                captureType: 'EXPLICIT',
                amount: String(row.amount_cents),
                language: 'ita',
                expirationDate: linkExpiration.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }),
                expirationTime: linkExpiration.toISOString(),
                resultUrl: `${siteUrl}/admin?refresh=${newOrderId}&status=success`,
                cancelUrl: `${siteUrl}/admin?refresh=${newOrderId}&status=cancelled`,
                notificationUrl: `${siteUrl}/.netlify/functions/nexi-preauth-callback`,
                recurrence: {
                    action: 'USE_CONTRACT',
                    contractId,
                    contractType: 'MIT_UNSCHEDULED',
                },
            },
            expirationDate: linkExpiration.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }),
        }

        const pblUrl = NEXI_BASE_URL.replace('/v1', '/v2') + '/orders/paybylink'
        const newRes = await fetch(pblUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': NEXI_API_KEY,
                'Correlation-Id': correlationBase.replace(/.$/, '1'),
                'Idempotency-Key': correlationBase.replace(/.$/, '2'),
            },
            body: JSON.stringify(payload),
        })

        const newText = await newRes.text()
        let newData: Record<string, unknown> = {}
        try { newData = JSON.parse(newText) } catch { /* keep raw */ }

        const paymentUrl = ((newData as Record<string, Record<string, unknown>>).paymentLink?.link as string) || null

        if (!newRes.ok || !paymentUrl) {
            console.error('[nexi-preauth-refresh-cron] Create NEW preauth failed:', row.id, newRes.status, newText.substring(0, 200))
            await supabase.from('nexi_transactions').update({
                status: 'preauth_refresh_failed',
                metadata: {
                    ...meta,
                    refresh_failed_at: nowIso,
                    refresh_failure_reason: `create new failed: HTTP ${newRes.status}`,
                    refresh_failure_response: newData,
                }
            }).eq('id', row.id)
            results.push({ id: row.id, status: 'failed', reason: `create_new_failed_${newRes.status}` })
            continue
        }

        // STEP 3: aggiorna la riga in attesa che il cliente confermi il link.
        // Quando clicca, il callback nexi-preauth-callback aggiornera\' a preauth_held.
        const nextDue = new Date(Date.now() + REFRESH_INTERVAL_DAYS * 86400000).toISOString()
        const newHistory = [
            ...refreshHistory.map((h: Record<string, unknown>, i: number) =>
                i === refreshHistory.length - 1 && !h.voided_at ? { ...h, voided_at: nowIso } : h
            ),
            {
                order_id: newOrderId,
                operation_id: null, // verra\' impostato dal callback quando cliente conferma
                created_at: nowIso,
                voided_at: null,
                auto: true,
                payment_link: paymentUrl,
                link_expires_at: linkExpiration.toISOString(),
            }
        ]

        await supabase.from('nexi_transactions').update({
            status: 'preauth_pending_refresh_confirm',
            metadata: {
                ...meta,
                current_operation_id: null, // void della vecchia gia\' fatto
                current_order_id: newOrderId,
                pending_refresh_link: paymentUrl,
                pending_refresh_expires_at: linkExpiration.toISOString(),
                next_refresh_due: nextDue,
                last_refreshed_at: nowIso,
                refresh_history: newHistory.slice(-20),
            }
        }).eq('id', row.id)

        // TODO (futuro): notifica al cliente con il link via WhatsApp/email.
        // Per ora il link e\' salvato in metadata.pending_refresh_link e
        // l'admin lo puo\' rinviare manualmente dal tab Nexi.

        results.push({ id: row.id, status: 'refreshed' })
        console.log(`[nexi-preauth-refresh-cron] Refreshed ${row.id} -> ${newOrderId} (link pending customer confirm)`)
    }

    const summary = {
        startedAt,
        endedAt: new Date().toISOString(),
        intervalDays: REFRESH_INTERVAL_DAYS,
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
