import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Nexi XPay Configuration - uses API Key authentication (no MAC required)
const NEXI_API_KEY = process.env.NEXI_API_KEY!;

// Production URL
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
        const { cauzioneId, transactionId, orderId } = JSON.parse(event.body || '{}');

        if (!cauzioneId || !transactionId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'cauzioneId and transactionId are required' })
            };
        }

        console.log('Voiding pre-authorization:', { transactionId, cauzioneId });

        // Nexi Void/Cancel API call
        const voidPayload = {
            description: `Sblocco cauzione ${cauzioneId}`
        };

        const response = await fetch(`${NEXI_BASE_URL}/operations/${transactionId}/cancels`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': NEXI_API_KEY,
            },
            body: JSON.stringify(voidPayload)
        });

        const responseData = await response.json();

        if (!response.ok) {
            console.error('Nexi void error:', responseData);

            // Update cauzione with error
            await supabase
                .from('cauzioni')
                .update({
                    note: `Errore sblocco: ${responseData.errors?.[0]?.description || response.statusText}`,
                    updated_at: new Date().toISOString()
                })
                .eq('id', cauzioneId);

            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({ error: responseData.errors?.[0]?.description || 'Void failed' })
            };
        }

        // Update cauzione status
        const { error: updateError } = await supabase
            .from('cauzioni')
            .update({
                stato: 'Sbloccata',
                data_sblocco: new Date().toISOString(),
                note: `Preautorizzazione sbloccata - Nexi Op: ${responseData.operationId || transactionId}`,
                updated_at: new Date().toISOString()
            })
            .eq('id', cauzioneId);

        if (updateError) throw updateError;

        // Update nexi_transactions if exists
        if (orderId) {
            await supabase
                .from('nexi_transactions')
                .update({
                    status: 'voided',
                    metadata: { void_response: responseData }
                })
                .eq('order_id', orderId);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                operationId: responseData.operationId,
                message: 'Preautorizzazione sbloccata con successo'
            })
        };

    } catch (error: any) {
        console.error('Error voiding pre-authorization:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};

export { handler };
