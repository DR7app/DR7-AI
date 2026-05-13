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

        // Store transaction in DB. Distinguo preauth (mit_preauth) da addebito
        // (mit_charge) cosi\' Storico e report filtrano correttamente.
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
                // Solo per preauth: deadline interna admin per catturare i fondi.
                // L'auth Nexi/circuito carte rimane comunque governata dalle regole
                // dell'emittente (tipicamente 7-30gg). Qui registriamo l'intento.
                ...(isPreauth ? {
                    expected_capture_by: expectedCaptureBy || null,
                    duration_days: durationDays || null,
                } : {}),
                nexi_response: responseData
            },
            created_at: new Date().toISOString()
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
                    ? `Pre-autorizzazione di €${amount.toFixed(2)} creata (fondi bloccati, da catturare entro 7gg)`
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
