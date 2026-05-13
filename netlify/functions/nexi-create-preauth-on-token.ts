import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { getCorsOrigin } from './cors-headers'
import { requireAuth } from './require-auth'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const NEXI_API_KEY = process.env.NEXI_API_KEY!
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'

/**
 * Crea una pre-autorizzazione su carta gia\' tokenizzata via paybylink
 * (l'unico endpoint provato che onora captureType=EXPLICIT).
 *
 * Differenza con nexi-create-preauth.ts: questo NON crea un nuovo
 * contractId (CONTRACT_CREATION), ma REUSA un contractId esistente
 * via recurrence.action=USE_CONTRACT. Nexi mostra la carta salvata
 * mascherata al cliente — niente reinserimento dati carta. Il cliente
 * conferma con un click (SCA se l'emittente lo richiede).
 *
 * Body: { contractId, amount, customerEmail?, customerName?, description?,
 *         expirationHours?, durationDays?, expectedCaptureBy? }
 */
const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' }

    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    try {
        const {
            contractId,
            amount,
            customerEmail,
            customerName,
            description,
            expirationHours = 24,
            durationDays,
            expectedCaptureBy,
        } = JSON.parse(event.body || '{}')

        if (!contractId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'contractId richiesto' }) }
        if (!amount || amount <= 0) return { statusCode: 400, headers, body: JSON.stringify({ error: 'amount > 0 richiesto' }) }

        const orderId = `PT${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 18)
        const amountCents = Math.round(amount * 100)
        const siteUrl = process.env.URL || 'https://admin.dr7empire.com'

        // Link scade in expirationHours (default 24h) per pagamento;
        // l'auth hold poi resta secondo le regole del circuito carte.
        const expirationDate = new Date(Date.now() + expirationHours * 60 * 60 * 1000)
        const toRomeDate = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })

        const payload = {
            order: {
                orderId,
                amount: amountCents.toString(),
                currency: 'EUR',
                description: description || `Pre-autorizzazione ${orderId}`,
                customField: `preauth_token_${contractId}`,
                customerInfo: {
                    cardHolderEmail: customerEmail || '',
                    cardHolderName: customerName || '',
                },
            },
            paymentSession: {
                actionType: 'PAY',
                captureType: 'EXPLICIT', // AUTHORIZATION only, no capture
                amount: amountCents.toString(),
                language: 'ita',
                expirationDate: toRomeDate(expirationDate),
                expirationTime: expirationDate.toISOString(),
                resultUrl: `${siteUrl}/admin?preauth=${orderId}&status=success`,
                cancelUrl: `${siteUrl}/admin?preauth=${orderId}&status=cancelled`,
                notificationUrl: `${siteUrl}/.netlify/functions/nexi-preauth-callback`,
                // CHIAVE: usa il contractId esistente. Nexi mostra la carta
                // mascherata al cliente che conferma in 1 click (SCA se
                // richiesto), senza reinserire dati carta.
                recurrence: {
                    action: 'USE_CONTRACT',
                    contractId,
                    contractType: 'MIT_UNSCHEDULED',
                },
            },
            expirationDate: toRomeDate(expirationDate),
        }

        const correlationId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })

        const pblUrl = NEXI_BASE_URL.replace('/v1', '/v2') + '/orders/paybylink'
        console.log('[nexi-create-preauth-on-token] POST', pblUrl, 'order:', orderId, 'amount:', amountCents)

        const response = await fetch(pblUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': NEXI_API_KEY,
                'Correlation-Id': correlationId,
                'Idempotency-Key': correlationId,
            },
            body: JSON.stringify(payload),
        })

        const responseText = await response.text()
        let responseData: Record<string, unknown> = {}
        try { responseData = JSON.parse(responseText) } catch { /* keep raw */ }

        if (!response.ok) {
            const errMsg = (responseData as Record<string, Record<string, unknown>[]>).errors?.[0]?.description
                || (responseData as Record<string, unknown>).message
                || `HTTP ${response.status}`
            console.error('[nexi-create-preauth-on-token] ERROR:', response.status, errMsg, responseText.substring(0, 300))
            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({ error: `Nexi: ${errMsg}`, details: responseData }),
            }
        }

        const paymentUrl = ((responseData as Record<string, Record<string, unknown>>).paymentLink?.link as string)
            || ((responseData as Record<string, unknown>).hostedPage as string)
            || null

        if (!paymentUrl) {
            return { statusCode: 502, headers, body: JSON.stringify({ error: 'Nexi non ha restituito paymentLink', details: responseData }) }
        }

        // Insert nexi_transactions in stato pending. Il callback aggiornera\'
        // a preauth_held quando il cliente conferma.
        const nowIso = new Date().toISOString()
        const nextRefreshDue = durationDays && Number(durationDays) > 6
            ? new Date(Date.now() + 6 * 86400000).toISOString()
            : null

        await supabase.from('nexi_transactions').insert({
            order_id: orderId,
            amount_cents: amountCents,
            status: 'preauth_pending_link',
            description: description || 'Pre-autorizzazione (link inviato)',
            customer_email: customerEmail || null,
            payment_link: paymentUrl,
            metadata: {
                type: 'preauth_link_use_contract',
                contract_id: contractId,
                customer_name: customerName,
                action_type: 'PAY',
                capture_type: 'EXPLICIT',
                recurrence_action: 'USE_CONTRACT',
                expires_at: expirationDate.toISOString(),
                expected_capture_by: expectedCaptureBy || null,
                duration_days: durationDays || null,
                next_refresh_due: nextRefreshDue,
                refresh_history: [],
                nexi_response: responseData,
            },
            created_at: nowIso,
        })

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                orderId,
                paymentUrl,
                expiresAt: expirationDate.toISOString(),
                message: 'Link pre-autorizzazione creato. Inviare al cliente per conferma.',
            }),
        }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[nexi-create-preauth-on-token] Exception:', msg)
        return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) }
    }
}

export { handler }
