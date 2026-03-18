import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const NEXI_API_KEY = process.env.NEXI_API_KEY!;
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1';

const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    try {
        const {
            contractId,
            amount,
            description,
            bookingId,
            customerId,
            customerEmail,
            customerName
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
            captureType: 'IMPLICIT' // Auto-capture (charge immediately)
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

        // Store transaction in DB
        await supabase.from('nexi_transactions').insert({
            order_id: orderId,
            booking_id: bookingId || null,
            amount_cents: amountCents,
            status: isSuccess ? 'completed' : 'failed',
            description: description || 'Addebito MIT',
            customer_email: customerEmail || null,
            metadata: {
                type: 'mit_charge',
                contract_id: contractId,
                customer_id: customerId,
                customer_name: customerName,
                correlation_id: correlationId,
                operation_result: operationResult,
                nexi_response: responseData
            },
            created_at: new Date().toISOString()
        });

        if (!isSuccess) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: `Addebito rifiutato: ${operationResult || 'DECLINED'}`,
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
                message: `Addebito di €${amount.toFixed(2)} effettuato con successo`
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
