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

        // Generate unique order ID
        const orderId = bookingId
            ? `PAY-${bookingId.slice(0, 8)}-${Date.now()}`
            : `PAY-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

        // Convert amount to cents
        const amountCents = Math.round(amount * 100);

        // Calculate expiration date
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + expirationDays);

        // Create payment link request
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
                actionType: 'PAY',  // PAY = direct payment (not pre-auth)
                amount: amountCents.toString(),
                language: 'ita',
                resultUrl: `${process.env.URL || 'https://dr7empire.com'}/payment-success?order=${orderId}`,
                cancelUrl: `${process.env.URL || 'https://dr7empire.com'}/payment-cancelled?order=${orderId}`,
                notificationUrl: `${process.env.URL || 'https://dr7admin.netlify.app'}/.netlify/functions/nexi-payment-callback`
            }
        };

        console.log('Creating Nexi Pay by Link:', { orderId, amountCents, bookingId });

        const response = await fetch(`${NEXI_BASE_URL}/orders/build`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': NEXI_API_KEY,
            },
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();
        let responseData: any;
        try {
            responseData = JSON.parse(responseText);
        } catch {
            console.error('Nexi returned non-JSON response:', response.status, responseText.substring(0, 500));
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ error: `Nexi API error (${response.status}): risposta non valida` })
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

        const paymentUrl = responseData.hostedPage;

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
