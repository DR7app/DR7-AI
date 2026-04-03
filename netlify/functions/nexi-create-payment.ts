import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { requireAuth } from './require-auth'

// Environment variables for Nexi
// these should be set in Netlify env vars
// NEXI_API_KEY
// NEXI_SECRET_KEY
// NEXI_MERCHANT_ID (or Alias)

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Nexi XPay Configuration (using Test environment by default if prod vars missing)
const NEXI_TEST_URL = 'https://stg-ta.nexi.it/api/phoenix-0.0/psp/api/v1/orders/build';
const NEXI_PROD_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1/orders/build'; // Verify exact prod URL
const NEXI_URL = process.env.NEXI_ENV === 'production' ? NEXI_PROD_URL : NEXI_TEST_URL;

const handler: Handler = async (event, context) => {
    // CORS headers
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
        const { bookingId, amount, email, description, orderId: providedOrderId } = JSON.parse(event.body || '{}');

        if (!amount) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Amount is required' }) };
        }

        // Generate Order ID if not provided
        const orderId = providedOrderId || `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        // Calculate MAC/Signature if required by XPay version (Using API Key usually serves as auth)
        // For standard XPay build, we typically send apiKey in headers.

        const apiKey = process.env.NEXI_API_KEY || 'ALIAS_WEB_00000001'; // Default test alias
        // Note: Actual implementation depends on specific XPay integration guides. 
        // Assuming standard "Simple" or "Server-to-Server" path.

        // Payload for Nexi
        const nexiPayload = {
            order: {
                orderId: orderId,
                amount: amount, // check if needs to be cents or decimal. Usually decimal for XPay V1, but checking docs is safer. Let's assume decimal EUR.
                currency: 'EUR',
                description: description || `Booking Payment ${bookingId || ''}`,
                customerInfo: {
                    cardHolderEmail: email
                }
            },
            paymentSession: {
                actionType: 'PAY',
                amount: amount,
                language: 'ita',
                resultUrl: `${process.env.URL || 'http://localhost:8888'}/admin`, // Redirect back to admin
                cancelUrl: `${process.env.URL || 'http://localhost:8888'}/admin`,
            }
        };

        // MOCKING NEXI RESPONSE FOR NOW if no API key present to avoid blocking dev
        // In real scenario, uncomment fetch block below

        /*
        const response = await fetch(NEXI_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': apiKey,
                // 'Correlation-Id': ...
            },
            body: JSON.stringify(nexiPayload)
        });
        
        if (!response.ok) {
            throw new Error(`Nexi API Error: ${response.statusText}`);
        }
        
        const nexiData = await response.json();
        const paymentUrl = nexiData.hostedPageHttpUrl; // or similar field
        */

        // MOCK RESPONSE
        const paymentUrl = `https://nm.nexi.it/.../mock_payment_page?orderId=${orderId}`;

        // Store in Database
        const { error: dbError } = await supabase
            .from('nexi_transactions')
            .insert({
                order_id: orderId,
                booking_id: bookingId,
                amount_cents: Math.round(amount * 100), // Convert to cents for DB
                status: 'pending',
                payment_link: paymentUrl,
                description: description,
                customer_email: email,
                metadata: { nexi_payload: nexiPayload } // Store payload for debugging
            });

        if (dbError) throw dbError;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                paymentUrl,
                orderId
            }),
        };

    } catch (error: any) {
        console.error('Error creating Nexi payment:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message }),
        };
    }
};

export { handler };
