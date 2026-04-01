import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { requireAuth } from './require-auth'

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Nexi XPay Configuration
const NEXI_API_KEY = process.env.NEXI_API_KEY!;
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1';

/** Payment link validity: 1 hour (matches bookingPaymentService.ts constant) */
const PAYMENT_LINK_TTL_HOURS = 1;

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
        const {
            bookingId,
            amount,
            customerEmail,
            customerName,
            description,
            expirationDays = 7,
            expirationHours,
            paymentPurpose,
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
            : `P${ts}${randomUUID().slice(0, 6)}`.slice(0, 18);

        // Convert amount to cents
        const amountCents = Math.round(amount * 100);

        // Calculate expiration: for bookings, always use 1 hour
        const now = new Date();
        const linkCreatedAt = now.toISOString();
        const expirationDate = new Date();
        const effectiveHours = expirationHours || (paymentPurpose === 'booking' || !paymentPurpose ? PAYMENT_LINK_TTL_HOURS : null);
        if (effectiveHours) {
            expirationDate.setTime(expirationDate.getTime() + effectiveHours * 60 * 60 * 1000);
        } else {
            expirationDate.setDate(expirationDate.getDate() + Math.max(expirationDays, 1));
        }
        const linkExpiresAt = expirationDate.toISOString();
        const expirationDateStr = expirationDate.toISOString().split('T')[0];

        console.log(`[nexi-pay-by-link] bookingId=${bookingId}, amount=${amount}, purpose=${paymentPurpose || 'booking'}, expires=${linkExpiresAt}`);

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

        const correlationId = randomUUID()
        const payByLinkUrl = NEXI_BASE_URL.replace('/v1', '/v2') + '/orders/paybylink';
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
        console.log('[nexi-pay-by-link] Nexi response status:', response.status);
        console.log('[nexi-pay-by-link] API key configured:', !!NEXI_API_KEY);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let responseData: any;
        try {
            responseData = JSON.parse(responseText);
        } catch {
            console.error('[nexi-pay-by-link] Non-JSON response:', response.status, responseText.substring(0, 500));
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ error: `Nexi API error (${response.status}): ${responseText.substring(0, 200) || 'risposta vuota'}` })
            };
        }

        if (!response.ok) {
            console.error('[nexi-pay-by-link] Nexi error:', responseData);
            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({
                    error: responseData.errors?.[0]?.description || 'Failed to create payment link'
                })
            };
        }

        const paymentUrl = responseData.paymentLink?.link || responseData.hostedPage;
        console.log(`[nexi-pay-by-link] Payment URL created: ${paymentUrl}`);

        // ── Store in nexi_transactions table ──
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
                    payment_purpose: paymentPurpose || 'booking',
                    customer_name: customerName,
                    link_created_at: linkCreatedAt,
                    link_expires_at: linkExpiresAt,
                    nexi_response: responseData
                },
                created_at: now.toISOString()
            });

        if (dbError) {
            console.error('[nexi-pay-by-link] Error storing transaction:', dbError);
        }

        // ── Update booking with payment link info and tracking fields ──
        if (bookingId) {
            const { data: existingBooking } = await supabase
                .from('bookings')
                .select('id, booking_details')
                .eq('id', bookingId)
                .single();

            if (existingBooking) {
                await supabase.from('bookings').update({
                    payment_link_url: paymentUrl,
                    payment_link_created_at: linkCreatedAt,
                    payment_link_expires_at: linkExpiresAt,
                    booking_details: {
                        ...(existingBooking.booking_details || {}),
                        nexi_payment_link: paymentUrl,
                        nexi_order_id: orderId,
                        payment_link_created_at: linkCreatedAt,
                        payment_link_expires_at: linkExpiresAt,
                    }
                }).eq('id', bookingId);

                console.log(`[nexi-pay-by-link] Booking ${bookingId} updated: payment_link_expires_at=${linkExpiresAt}`);
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                paymentUrl: paymentUrl,
                orderId: orderId,
                amount: amount,
                linkCreatedAt: linkCreatedAt,
                expiresAt: linkExpiresAt,
                message: 'Payment link created successfully'
            })
        };

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[nexi-pay-by-link] Error:', message);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: message })
        };
    }
};

export { handler };
