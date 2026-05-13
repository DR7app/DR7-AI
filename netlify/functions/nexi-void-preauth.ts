import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './require-auth'

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Void operates on pre-auth created with the explicit key
const NEXI_API_KEY = process.env.NEXI_API_KEY_EXPLICIT || process.env.NEXI_API_KEY!;
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
        const { cauzioneId, operationId: inputOperationId, orderId, transactionId } = JSON.parse(event.body || '{}');

        // Risolvi operationId attivo (le preauth auto-rinnovate hanno il
        // current_operation_id nel metadata della riga nexi_transactions).
        let operationId = inputOperationId as string | null
        if (!operationId && transactionId) {
            const { data: tx } = await supabase
                .from('nexi_transactions')
                .select('metadata')
                .eq('id', transactionId)
                .maybeSingle()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            operationId = ((tx?.metadata as any)?.current_operation_id) || null
        }

        if (!operationId && !orderId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'operationId or orderId required' })
            };
        }
        if (!operationId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'operationId mancante (passa transactionId o operationId esplicito)' })
            };
        }

        console.log('[nexi-void-preauth] === VOID/REFUND REQUEST ===');
        console.log('[nexi-void-preauth] operationId:', operationId);
        console.log('[nexi-void-preauth] cauzioneId:', cauzioneId);

        // Try /cancels first (for pre-auths not yet captured)
        // If that fails, try /refunds (for already captured or partial)
        const correlationId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })

        const cancelPayload = {
            description: `Sblocco cauzione ${cauzioneId}`
        };

        // First attempt: cancel (void pre-auth)
        console.log('[nexi-void-preauth] Trying /cancels...');
        let response = await fetch(`${NEXI_BASE_URL}/operations/${operationId}/cancels`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': NEXI_API_KEY,
                'Correlation-Id': correlationId
            },
            body: JSON.stringify(cancelPayload)
        });

        let responseText = await response.text();
        let responseData: any;
        try { responseData = JSON.parse(responseText); } catch { responseData = { raw: responseText }; }

        // If cancel fails, try refund
        if (!response.ok) {
            console.log('[nexi-void-preauth] /cancels failed, trying /refunds...');
            const refundCorrelationId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
            })

            // Get the cauzione amount for refund
            const { data: cauzione } = await supabase
                .from('cauzioni')
                .select('importo')
                .eq('id', cauzioneId)
                .single();

            const refundPayload: any = {
                description: `Sblocco cauzione ${cauzioneId}`
            };
            if (cauzione?.importo) {
                refundPayload.amount = Math.round(Number(cauzione.importo) * 100).toString();
                refundPayload.currency = 'EUR';
            }

            response = await fetch(`${NEXI_BASE_URL}/operations/${operationId}/refunds`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Api-Key': NEXI_API_KEY,
                    'Correlation-Id': refundCorrelationId
                },
                body: JSON.stringify(refundPayload)
            });

            responseText = await response.text();
            try { responseData = JSON.parse(responseText); } catch { responseData = { raw: responseText }; }
        }

        console.log('[nexi-void-preauth] Response:', response.status, responseText.substring(0, 500));

        if (!response.ok) {
            console.error('[nexi-void-preauth] ERROR:', responseData);

            if (cauzioneId) {
                await supabase
                    .from('cauzioni')
                    .update({
                        note: `Errore sblocco: ${responseData.errors?.[0]?.description || response.statusText}`,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', cauzioneId);
            }

            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({ error: responseData.errors?.[0]?.description || 'Void/refund failed' })
            };
        }

        const voidOpId = responseData.operationId || operationId;

        // Update cauzione status (solo se la preauth era legata a una cauzione)
        if (cauzioneId) {
            const { error: updateError } = await supabase
                .from('cauzioni')
                .update({
                    stato: 'Sbloccata',
                    data_sblocco: new Date().toISOString(),
                    note: `Preautorizzazione sbloccata - Nexi Op: ${voidOpId}`,
                    updated_at: new Date().toISOString()
                })
                .eq('id', cauzioneId);

            if (updateError) throw updateError;
        }

        // Update nexi_transactions (sia per cauzioni che per preauth standalone
        // create dal tab Nexi). Match per transactionId se presente, altrimenti
        // per orderId.
        if (transactionId || orderId) {
            const q = supabase
                .from('nexi_transactions')
                .update({
                    status: 'preauth_voided',
                    metadata: { void_operation_id: voidOpId, void_response: responseData }
                })
            if (transactionId) {
                await q.eq('id', transactionId)
            } else if (orderId) {
                await q.eq('order_id', orderId)
            }
        }

        console.log('[nexi-void-preauth] SUCCESS: Pre-auth voided');

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                operationId: voidOpId,
                message: 'Preautorizzazione sbloccata con successo'
            })
        };

    } catch (error: any) {
        console.error('[nexi-void-preauth] Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};

export { handler };
