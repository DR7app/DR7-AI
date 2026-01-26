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

        // Generate unique order ID
        const orderId = `CAU-${cauzioneId.slice(0, 8)}-${Date.now()}`;

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
                actionType: 'AUTH',  // AUTH = pre-authorization (hold funds, don't capture)
                amount: amountCents.toString(),
                language: 'ita',
                resultUrl: `${process.env.URL || 'https://dr7admin.netlify.app'}/admin?cauzione=${cauzioneId}&status=success`,
                cancelUrl: `${process.env.URL || 'https://dr7admin.netlify.app'}/admin?cauzione=${cauzioneId}&status=cancelled`,
                notificationUrl: `${process.env.URL || 'https://dr7admin.netlify.app'}/.netlify/functions/nexi-preauth-callback`
            }
        };

        console.log('Creating Nexi pre-authorization:', { orderId, amountCents, cauzioneId });

        const response = await fetch(`${NEXI_BASE_URL}/orders/build`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': NEXI_API_KEY,
            },
            body: JSON.stringify(payload)
        });

        const responseData = await response.json();

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

        // Update cauzione with order ID (transaction ID will come from callback)
        const { error: updateError } = await supabase
            .from('cauzioni')
            .update({
                nexi_order_id: orderId,
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
                paymentUrl: responseData.hostedPage,
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
