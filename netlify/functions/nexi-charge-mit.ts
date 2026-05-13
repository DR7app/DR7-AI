import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from './require-auth'

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const NEXI_API_KEY = process.env.NEXI_API_KEY!;
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1';

const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    // Require authentication
    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    try {
        const {
            contractId,
            amount,
            description,
            bookingId,
            customerId,
            customerEmail,
            customerName,
            captureType,
            expectedCaptureBy,
            durationDays
        } = JSON.parse(event.body || '{}');

        if (!contractId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'contractId è obbligatorio (carta registrata)' })
            };
        }

        if (!amount || amount <= 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Importo deve essere maggiore di zero' })
            };
        }

        if (!NEXI_API_KEY) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Configurazione Nexi mancante (API key)' })
            };
        }

        const orderId = `MIT-${Date.now()}-${Math.floor(Math.random() * 10000)}`.slice(0, 18);
        const amountCents = Math.round(amount * 100);
        const correlationId = uuidv4();
        const idempotencyKey = uuidv4();

        console.log('[nexi-charge-mit] Charging card:', {
            contractId, orderId, amountCents, description
        });

        const payload: any = {
            order: {
                orderId,
                amount: amountCents.toString(),
                currency: 'EUR',
                description: description || 'Addebito DR7 Empire'
            },
            contractId,
            captureType: captureType || 'IMPLICIT' // IMPLICIT = charge now, EXPLICIT = pre-auth hold
        };

        if (customerEmail || customerName) {
            payload.order.customerInfo = {
                cardHolderEmail: customerEmail || '',
                cardHolderName: customerName || ''
            };
        }

        const response = await fetch(`${NEXI_BASE_URL}/orders/mit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': NEXI_API_KEY,
                'Correlation-Id': correlationId,
                'Idempotency-Key': idempotencyKey
            },
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();
        console.log('[nexi-charge-mit] Response:', response.status, responseText.substring(0, 500));

        let responseData: any;
        try {
            responseData = JSON.parse(responseText);
        } catch {
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ error: `Nexi API error (${response.status}): ${responseText.substring(0, 200)}` })
            };
        }

        if (!response.ok) {
            console.error('[nexi-charge-mit] Error:', responseData);
            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({
                    error: responseData.errors?.[0]?.description || responseData.resultDescription || 'Addebito fallito',
                    details: responseData
                })
            };
        }

        const operationResult = responseData.operation?.operationResult || responseData.operationResult;
        const isSuccess = operationResult === 'AUTHORIZED' || operationResult === 'EXECUTED';
        const isPreauth = (captureType || 'IMPLICIT') === 'EXPLICIT';
        const nexiOperationId = responseData.operation?.operationId || responseData.operationId || null;

        // Safety: verifica che il contractId tokenizzato sia rimasto valido.
        // Se Nexi restituisce un contractId diverso nella response (raro ma
        // possibile su token refresh), aggiorno il customer cosi\' future
        // MIT/preauth puntano al nuovo. Se non lo restituisce ma l'op e\'
        // andata, assumo il token rimane lo stesso.
        const responseContractId = responseData.operation?.additionalData?.contractId
            || responseData.additionalData?.contractId
            || responseData.contractId
            || null
        if (isSuccess && responseContractId && responseContractId !== contractId) {
            console.warn('[nexi-charge-mit] Nexi returned NEW contractId', { input: contractId, returned: responseContractId })
            try {
                if (customerId) {
                    const { data: cust } = await supabase.from('customers_extended').select('metadata').eq('id', customerId).maybeSingle()
                    if (cust) {
                        await supabase.from('customers_extended').update({
                            metadata: { ...(cust.metadata || {}), nexi_contract_id: responseContractId, nexi_contract_updated: new Date().toISOString() },
                            updated_at: new Date().toISOString(),
                        }).eq('id', customerId)
                    }
                } else if (customerEmail) {
                    const { data: cust } = await supabase.from('customers_extended').select('id, metadata').eq('email', String(customerEmail).toLowerCase().trim()).maybeSingle()
                    if (cust) {
                        await supabase.from('customers_extended').update({
                            metadata: { ...(cust.metadata || {}), nexi_contract_id: responseContractId, nexi_contract_updated: new Date().toISOString() },
                            updated_at: new Date().toISOString(),
                        }).eq('id', cust.id)
                    }
                }
            } catch (e) {
                console.warn('[nexi-charge-mit] Failed updating contract refresh:', e)
            }
        } else if (isSuccess) {
            // Tocco solo nexi_contract_updated per tracciare che il token e\' vivo
            try {
                if (customerId) {
                    const { data: cust } = await supabase.from('customers_extended').select('metadata').eq('id', customerId).maybeSingle()
                    if (cust && (cust.metadata as Record<string, unknown> | null)?.nexi_contract_id === contractId) {
                        await supabase.from('customers_extended').update({
                            metadata: { ...(cust.metadata || {}), nexi_contract_updated: new Date().toISOString() },
                            updated_at: new Date().toISOString(),
                        }).eq('id', customerId)
                    }
                }
            } catch { /* non-fatal */ }
        }

        // Per preauth con durata > 7g: schedula auto-rinnovo settimanale.
        // I circuiti carte rilasciano il blocco dopo 7-30g a seconda
        // dell'emittente, quindi rifacciamo MIT EXPLICIT ogni 7g finche\' non
        // si raggiunge expected_capture_by. Il cron `nexi-preauth-refresh-cron`
        // legge next_refresh_due e processa le righe scadute.
        const nowIso = new Date().toISOString()
        const nextRefreshDue = isPreauth && durationDays && Number(durationDays) > 7
            ? new Date(Date.now() + 7 * 86400000).toISOString()
            : null

        await supabase.from('nexi_transactions').insert({
            order_id: orderId,
            booking_id: bookingId || null,
            amount_cents: amountCents,
            status: isSuccess ? (isPreauth ? 'preauth_held' : 'completed') : 'failed',
            description: description || (isPreauth ? 'Pre-autorizzazione MIT' : 'Addebito MIT'),
            customer_email: customerEmail || null,
            metadata: {
                type: isPreauth ? 'mit_preauth' : 'mit_charge',
                contract_id: contractId,
                customer_id: customerId,
                customer_name: customerName,
                correlation_id: correlationId,
                operation_result: operationResult,
                capture_type: captureType || 'IMPLICIT',
                ...(isPreauth ? {
                    expected_capture_by: expectedCaptureBy || null,
                    duration_days: durationDays || null,
                    // Operation id attiva (la usano capture/void per chiamare Nexi).
                    // Cambia ad ogni auto-refresh.
                    current_operation_id: nexiOperationId,
                    current_order_id: orderId,
                    // Schedulazione cron: NULL se durata <= 7g (nessun refresh).
                    next_refresh_due: nextRefreshDue,
                    // Storico dei rinnovi. Entry 0 = creazione, entry N = refresh #N.
                    refresh_history: [{
                        order_id: orderId,
                        operation_id: nexiOperationId,
                        created_at: nowIso,
                        voided_at: null,
                        auto: false,
                    }],
                } : {}),
                nexi_response: responseData
            },
            created_at: nowIso
        });

        if (!isSuccess) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: `${isPreauth ? 'Pre-autorizzazione' : 'Addebito'} rifiutato: ${operationResult || 'DECLINED'}`,
                    operationResult
                })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                orderId,
                operationResult,
                amount,
                message: isPreauth
                    ? `Pre-autorizzazione di €${amount.toFixed(2)} creata (fondi bloccati${durationDays ? `, da catturare entro ${durationDays}gg` : ''})`
                    : `Addebito di €${amount.toFixed(2)} effettuato con successo`
            })
        };

    } catch (error: any) {
        console.error('[nexi-charge-mit] Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};

export { handler };
