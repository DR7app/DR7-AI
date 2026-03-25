import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Nexi XPay Configuration - only API Key needed for REST API
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

        // Create pre-authorization request
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
                actionType: 'PREAUTH',  // PREAUTH = pre-authorization (hold funds, don't capture)
                amount: amountCents.toString(),
                language: 'ita',
                resultUrl: `${process.env.URL || 'https://admin.dr7empire.com'}/admin?cauzione=${cauzioneId}&status=success`,
                cancelUrl: `${process.env.URL || 'https://admin.dr7empire.com'}/admin?cauzione=${cauzioneId}&status=cancelled`,
                notificationUrl: `${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/nexi-preauth-callback`,
                expirationDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                expirationTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                recurrence: {
                    action: 'CONTRACT_CREATION',
                    contractId: orderId.slice(0, 18),
                    contractType: 'MIT_UNSCHEDULED'
                }
            }
        };

        console.log('Creating Nexi pre-authorization:', { orderId, amountCents, cauzioneId });

        const correlationId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })
        const payByLinkUrl = NEXI_BASE_URL.replace('/v1', '/v2') + '/orders/paybylink';
        console.log('[nexi-create-preauth] Using URL:', payByLinkUrl);
        const response = await fetch(payByLinkUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': NEXI_API_KEY,
                'Correlation-Id': correlationId
            },
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();
        console.log('Nexi preauth response:', response.status, responseText.substring(0, 500));
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
            console.error('Nexi pre-auth error:', responseData);
            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({
                    error: responseData.errors?.[0]?.description || 'Failed to create pre-authorization'
                })
            };
        }

        // Store contractId for future MIT charges (same as orderId, max 18 chars)
        const contractId = orderId.slice(0, 18)

        // Update cauzione with order ID and contract ID (transaction ID will come from callback)
        const { error: updateError } = await supabase
            .from('cauzioni')
            .update({
                nexi_order_id: orderId,
                nexi_contract_id: contractId,
                note: `Preautorizzazione in attesa - Order: ${orderId}`,
                updated_at: new Date().toISOString()
            })
            .eq('id', cauzioneId);

        if (updateError) {
            console.error('Error updating cauzione:', updateError);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                paymentUrl: responseData.paymentLink?.link || responseData.hostedPage,
                orderId: orderId,
                message: 'Redirect customer to payment page'
            })
        };

    } catch (error: any) {
        console.error('Error creating pre-authorization:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};

export { handler };
