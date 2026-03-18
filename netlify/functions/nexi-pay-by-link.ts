import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Nexi XPay Configuration
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
            bookingId,
            amount,
            customerEmail,
            customerName,
            description,
            expirationDays = 7 // Link valid for 7 days by default
        } = JSON.parse(event.body || '{}');

        if (!NEXI_API_KEY) {
            console.error('NEXI_API_KEY environment variable is not set');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Configurazione Nexi mancante (API key)' })
            };
        }

        if (!amount || amount <= 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Valid amount is required' })
            };
        }

        // Generate unique order ID (max 18 chars for Nexi)
        const ts = Date.now().toString(36)
        const orderId = bookingId
            ? `P${bookingId.slice(0, 8)}${ts}`.slice(0, 18)
            : `P${ts}${Math.floor(Math.random() * 1000)}`.slice(0, 18);

        // Convert amount to cents
        const amountCents = Math.round(amount * 100);

        // Calculate expiration date (minimum 2 days from now to avoid date boundary issues)
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + Math.max(expirationDays, 2));
        // Nexi wants YYYY-MM-DD format
        const expirationDateStr = expirationDate.toISOString().split('T')[0];
        console.log('[nexi-pay-by-link] Expiration date:', expirationDateStr);

        // Create payment link request (using /v2/orders/paybylink endpoint)
        const payload = {
            order: {
                orderId: orderId,
                amount: amountCents.toString(),
                currency: 'EUR',
                description: description || `Pagamento DR7 Empire`,
                customerInfo: {
                    cardHolderEmail: customerEmail || '',
                    cardHolderName: customerName || ''
                }
            },
            paymentSession: {
                actionType: 'PAY',
                amount: amountCents.toString(),
                language: 'ita',
                expirationDate: expirationDateStr,
                expirationTime: expirationDate.toISOString(),
                resultUrl: `${process.env.URL || 'https://admin.dr7empire.com'}/payment-success?order=${orderId}`,
                cancelUrl: `${process.env.URL || 'https://admin.dr7empire.com'}/payment-cancelled?order=${orderId}`,
                notificationUrl: `${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/nexi-payment-callback`
            },
            expirationDate: expirationDateStr
        };

        console.log('[nexi-pay-by-link] Request:', JSON.stringify(payload));

        const correlationId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })
        // Use v2 paybylink endpoint (base URL has /v1, replace with /v2)
        const payByLinkUrl = NEXI_BASE_URL.replace('/v1', '/v2') + '/orders/paybylink';
        console.log('[nexi-pay-by-link] URL:', payByLinkUrl);
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
        console.log('Nexi response status:', response.status);
        console.log('Nexi response headers:', JSON.stringify(Object.fromEntries(response.headers.entries())));
        console.log('Nexi response body:', responseText || '(empty)');
        console.log('API key first/last 4:', NEXI_API_KEY?.slice(0, 4) + '...' + NEXI_API_KEY?.slice(-4));

        let responseData: any;
        try {
            responseData = JSON.parse(responseText);
        } catch {
            console.error('Nexi returned non-JSON response:', response.status, responseText.substring(0, 500));
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ error: `Nexi API error (${response.status}): ${responseText.substring(0, 200) || 'risposta vuota'}` })
            };
        }

        if (!response.ok) {
            console.error('Nexi Pay by Link error:', responseData);
            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({
                    error: responseData.errors?.[0]?.description || 'Failed to create payment link'
                })
            };
        }

        // paybylink returns paymentLink.link, build returns hostedPage
        const paymentUrl = responseData.paymentLink?.link || responseData.hostedPage;
        console.log('[nexi-pay-by-link] Payment URL:', paymentUrl);

        // Store in database
        const { error: dbError } = await supabase
            .from('nexi_transactions')
            .insert({
                order_id: orderId,
                booking_id: bookingId || null,
                amount_cents: amountCents,
                status: 'pending',
                payment_link: paymentUrl,
                description: description || `Pagamento DR7 Empire`,
                customer_email: customerEmail || null,
                contract_id: orderId.slice(0, 18),
                metadata: {
                    type: 'pay_by_link',
                    customer_name: customerName,
                    expiration_date: expirationDate.toISOString(),
                    nexi_response: responseData
                },
                created_at: new Date().toISOString()
            });

        if (dbError) {
            console.error('Error storing transaction:', dbError);
            // Don't fail - payment link was created successfully
        }

        // If linked to a booking, update booking with payment link info
        if (bookingId) {
            await supabase
                .from('booking_details')
                .update({
                    nexi_order_id: orderId,
                    payment_link: paymentUrl,
                    updated_at: new Date().toISOString()
                })
                .eq('id', bookingId);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                paymentUrl: paymentUrl,
                orderId: orderId,
                amount: amount,
                expiresAt: expirationDate.toISOString(),
                message: 'Payment link created successfully'
            })
        };

    } catch (error: any) {
        console.error('Error creating pay by link:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};

export { handler };
