import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Use same API key as pay-by-link
const NEXI_API_KEY = process.env.NEXI_API_KEY!;
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1';

const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
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
        const { cauzioneId, operationId: inputOperationId, amount, orderId } = JSON.parse(event.body || '{}');

        if (!amount || (!inputOperationId && !orderId)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'amount and (operationId or orderId) are required' })
            };
        }

        const amountCents = Math.round(amount * 100);

        const correlationId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })

        const captureHeaders = {
            'Content-Type': 'application/json',
            'X-Api-Key': NEXI_API_KEY,
            'Correlation-Id': correlationId,
            'Idempotency-Key': correlationId
        }

        // Step 1: Find the real operationId by looking up operations for this orderId
        let realOperationId = inputOperationId
        if (orderId) {
            console.log('[nexi-capture-preauth] Looking up operations for orderId:', orderId);
            const opsRes = await fetch(`${NEXI_BASE_URL}/operations?orderId=${orderId}`, {
                headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': correlationId + '-lookup' }
            })
            if (opsRes.ok) {
                const opsData = await opsRes.json()
                console.log('[nexi-capture-preauth] Operations response:', JSON.stringify(opsData).substring(0, 500))
                const operations = opsData.operations || opsData || []
                // Find the AUTHORIZATION operation
                const authOp = Array.isArray(operations)
                    ? operations.find((op: any) => op.operationType === 'AUTHORIZATION' && op.operationResult === 'AUTHORIZED')
                    || operations.find((op: any) => op.operationType === 'AUTHORIZATION')
                    || operations[0]
                    : null
                if (authOp?.operationId) {
                    realOperationId = authOp.operationId
                    console.log('[nexi-capture-preauth] Found real operationId:', realOperationId)
                }
            } else {
                console.warn('[nexi-capture-preauth] Operations lookup failed:', opsRes.status)
            }
        }

        if (!realOperationId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Could not find operationId' }) }
        }

        // Step 2: Capture with the real operationId
        console.log('[nexi-capture-preauth] Capturing with operationId:', realOperationId, 'amount:', amountCents);
        const capturePayload = {
            amount: amountCents.toString(),
            currency: 'EUR',
            description: `Incasso ${cauzioneId || orderId}`
        }

        const response = await fetch(`${NEXI_BASE_URL}/operations/${realOperationId}/captures`, {
            method: 'POST', headers: captureHeaders, body: JSON.stringify(capturePayload)
        });

        const responseText = await response.text();
        console.log('[nexi-capture-preauth] Response:', response.status, responseText.substring(0, 500));

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
            console.error('[nexi-capture-preauth] ERROR:', responseData);

            await supabase
                .from('cauzioni')
                .update({
                    note: `Errore incasso: ${responseData.errors?.[0]?.description || response.statusText}`,
                    updated_at: new Date().toISOString()
                })
                .eq('id', cauzioneId);

            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({ error: responseData.errors?.[0]?.description || 'Capture failed' })
            };
        }

        const captureOpId = responseData.operationId || operationId;

        // Update cauzione status
        const { error: updateError } = await supabase
            .from('cauzioni')
            .update({
                stato: 'Incassata',
                data_incasso: new Date().toISOString(),
                note: `Incassato €${amount.toFixed(2)} - Nexi Op: ${captureOpId}`,
                updated_at: new Date().toISOString()
            })
            .eq('id', cauzioneId);

        if (updateError) throw updateError;

        // Update nexi_transactions
        if (orderId) {
            await supabase
                .from('nexi_transactions')
                .update({
                    status: 'captured',
                    metadata: { capture_operation_id: captureOpId, capture_response: responseData }
                })
                .eq('order_id', orderId);
        }

        console.log('[nexi-capture-preauth] SUCCESS: Captured €' + amount.toFixed(2));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                operationId: captureOpId,
                message: `Incassato €${amount.toFixed(2)} con successo`
            })
        };

    } catch (error: any) {
        console.error('[nexi-capture-preauth] Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};

export { handler };
