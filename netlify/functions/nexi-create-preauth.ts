import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// PREAUTH requires the EXPLICIT capture API key — the implicit key auto-charges regardless of actionType
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
        const { cauzioneId, amount, customerEmail, customerName, description } = JSON.parse(event.body || '{}');

        if (!cauzioneId || !amount) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'cauzioneId and amount are required' })
            };
        }

        // Generate unique order ID (max 18 chars for Nexi)
        const ts = Date.now().toString(36)
        const orderId = `C${cauzioneId.slice(0, 8)}${ts}`.slice(0, 18);

        // Convert amount to cents
        const amountCents = Math.round(amount * 100);

        const siteUrl = process.env.URL || 'https://admin.dr7empire.com';

        // Expiration: 7 days from now
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 7);
        const expirationDateStr = expirationDate.toISOString().split('T')[0];

        // Use /orders/hpp (Hosted Payment Page) with actionType PREAUTH
        // NOTE: /v2/orders/paybylink does NOT support PREAUTH — it always charges.
        // /v1/orders/hpp supports actionType PREAUTH and returns a hostedPage URL.
        const payload = {
            order: {
                orderId: orderId,
                amount: amountCents.toString(),
                currency: 'EUR',
                description: description || `Cauzione deposito ${cauzioneId}`,
                customerInfo: {
                    cardHolderEmail: customerEmail || '',
                    cardHolderName: customerName || ''
                }
            },
            paymentSession: {
                actionType: 'PREAUTH',       // CRITICAL: PREAUTH = hold only, NOT PAY
                captureType: 'EXPLICIT',     // EXPLICIT = must confirm manually via API
                amount: amountCents.toString(),
                language: 'ita',
                resultUrl: `${siteUrl}/admin?cauzione=${cauzioneId}&status=success`,
                cancelUrl: `${siteUrl}/admin?cauzione=${cauzioneId}&status=cancelled`,
                notificationUrl: `${siteUrl}/.netlify/functions/nexi-preauth-callback`
            }
        };

        console.log('[nexi-create-preauth] === PREAUTH REQUEST ===');
        console.log('[nexi-create-preauth] Endpoint: /v1/orders/hpp (NOT paybylink)');
        console.log('[nexi-create-preauth] actionType:', payload.paymentSession.actionType);
        console.log('[nexi-create-preauth] captureType:', payload.paymentSession.captureType);
        console.log('[nexi-create-preauth] orderId:', orderId);
        console.log('[nexi-create-preauth] amount (cents):', amountCents);
        console.log('[nexi-create-preauth] Full payload:', JSON.stringify(payload));

        const correlationId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })

        // Use /v1/orders/hpp — this endpoint supports PREAUTH + EXPLICIT capture
        const hppUrl = NEXI_BASE_URL + '/orders/hpp';
        console.log('[nexi-create-preauth] URL:', hppUrl);

        const response = await fetch(hppUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': NEXI_API_KEY,
                'Correlation-Id': correlationId
            },
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();
        console.log('[nexi-create-preauth] Response status:', response.status);
        console.log('[nexi-create-preauth] Response body:', responseText.substring(0, 500));

        let responseData: any;
        try {
            responseData = JSON.parse(responseText);
        } catch {
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ error: `Nexi API error (${response.status}): ${responseText.substring(0, 200) || 'risposta vuota'}` })
            };
        }

        if (!response.ok) {
            console.error('[nexi-create-preauth] ERROR:', JSON.stringify(responseData));
            const nexiError = responseData.errors?.[0]?.description
                || responseData.error?.description
                || responseData.message
                || responseData.error_description
                || JSON.stringify(responseData).substring(0, 300)
            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({
                    error: `Nexi (${response.status}): ${nexiError}`
                })
            };
        }

        // HPP returns hostedPage URL, paybylink returns paymentLink.link
        const paymentUrl = responseData.hostedPage || responseData.paymentLink?.link;
        console.log('[nexi-create-preauth] Payment URL:', paymentUrl);

        // Update cauzione with order ID
        const { error: updateError } = await supabase
            .from('cauzioni')
            .update({
                nexi_order_id: orderId,
                note: `Preautorizzazione in attesa - Order: ${orderId}`,
                updated_at: new Date().toISOString()
            })
            .eq('id', cauzioneId);

        if (updateError) {
            console.error('[nexi-create-preauth] Error updating cauzione:', updateError);
        }

        // Also store in nexi_transactions for tracking
        await supabase.from('nexi_transactions').insert({
            order_id: orderId,
            amount_cents: amountCents,
            status: 'pending_preauth',
            payment_link: paymentUrl,
            description: description || `Cauzione preautorizzazione`,
            customer_email: customerEmail || null,
            metadata: {
                type: 'preauth',
                cauzione_id: cauzioneId,
                customer_name: customerName,
                action_type: 'PREAUTH',
                capture_type: 'EXPLICIT',
                nexi_response: responseData
            },
            created_at: new Date().toISOString()
        }).then(r => {
            if (r.error) console.error('[nexi-create-preauth] DB insert error:', r.error);
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                paymentUrl: paymentUrl,
                orderId: orderId,
                message: 'Link pre-autorizzazione creato (blocco fondi, no incasso)'
            })
        };

    } catch (error: any) {
        console.error('[nexi-create-preauth] Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};

export { handler };
