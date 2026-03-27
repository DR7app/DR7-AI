import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Capture operates on pre-auth created with the explicit key
const NEXI_API_KEY = process.env.NEXI_API_KEY_EXPLICIT || process.env.NEXI_API_KEY!;
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
        const { cauzioneId, operationId, amount, orderId } = JSON.parse(event.body || '{}');

        if (!cauzioneId || !operationId || !amount) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'cauzioneId, operationId, and amount are required' })
            };
        }

        const amountCents = Math.round(amount * 100);

        // POST /operations/{operationId}/captures — captures a pre-authorized amount
        const capturePayload = {
            amount: amountCents.toString(),
            currency: 'EUR',
            description: `Incasso cauzione ${cauzioneId}`
        };

        console.log('[nexi-capture-preauth] === CAPTURE REQUEST ===');
        console.log('[nexi-capture-preauth] operationId:', operationId);
        console.log('[nexi-capture-preauth] amount (cents):', amountCents);
        console.log('[nexi-capture-preauth] Endpoint:', `${NEXI_BASE_URL}/operations/${operationId}/captures`);

        const correlationId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })

        const response = await fetch(`${NEXI_BASE_URL}/operations/${operationId}/captures`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': NEXI_API_KEY,
                'Correlation-Id': correlationId
            },
            body: JSON.stringify(capturePayload)
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
