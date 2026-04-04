import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const NEXI_API_KEY = process.env.NEXI_API_KEY!;
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1';

/**
 * PAY-BY-LINK — Payment Link Generation
 *
 * EXPIRATION RULES:
 * - Default for bookings: 1 hour (expirationHours=1)
 * - Configurable via expirationHours or expirationDays
 * - Nexi receives the EXACT expiration datetime (yyyy-MM-dd HH:mm:ss.0)
 * - Rentora stores payment_link_sent_at and payment_link_expires_at (UTC ISO)
 * - The cancel job + callback both validate against payment_link_expires_at
 */

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
        const {
            bookingId,
            amount,
            customerEmail,
            customerName,
            description,
            expirationDays = 7,
            expirationHours, // Override: 1 = 1 hour (default for bookings)
            paymentPurpose,
        } = JSON.parse(event.body || '{}');

        if (!NEXI_API_KEY) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'Configurazione Nexi mancante (API key)' }) };
        }

        if (!amount || amount <= 0) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Valid amount is required' }) };
        }

        // ─── Timestamps ─────────────────────────────────────────────────
        // payment_link_sent_at = NOW (UTC)
        // payment_link_expires_at = NOW + expirationHours (or expirationDays)
        const sentAt = new Date(); // UTC server time = moment of link creation
        const expiresAt = new Date(sentAt.getTime());

        if (expirationHours) {
            expiresAt.setTime(expiresAt.getTime() + expirationHours * 60 * 60 * 1000);
        } else {
            expiresAt.setDate(expiresAt.getDate() + Math.max(expirationDays, 1));
        }

        // ─── Nexi expiration format ─────────────────────────────────────
        // Nexi v2 paybylink accepts: "yyyy-MM-dd HH:mm:ss.0"
        // Must be in Europe/Rome timezone for Nexi's interpretation
        const toNexiDatetime = (d: Date) => {
            // Nexi v2 paybylink requires ISO8601 format
            const rome = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
            const y = rome.getFullYear();
            const mo = String(rome.getMonth() + 1).padStart(2, '0');
            const da = String(rome.getDate()).padStart(2, '0');
            const h = String(rome.getHours()).padStart(2, '0');
            const mi = String(rome.getMinutes()).padStart(2, '0');
            const s = String(rome.getSeconds()).padStart(2, '0');
            // Determine Rome timezone offset (CET +01:00 or CEST +02:00)
            const jan = new Date(y, 0, 1);
            const jul = new Date(y, 6, 1);
            const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
            const isDST = rome.getTimezoneOffset() < stdOffset;
            const tzOffset = isDST ? '+02:00' : '+01:00';
            return `${y}-${mo}-${da}T${h}:${mi}:${s}.000${tzOffset}`;
        };

        const nexiExpirationStr = toNexiDatetime(expiresAt);

        console.log('[nexi-pay-by-link] sentAt (UTC):', sentAt.toISOString());
        console.log('[nexi-pay-by-link] expiresAt (UTC):', expiresAt.toISOString());
        console.log('[nexi-pay-by-link] Nexi expiration (Rome):', nexiExpirationStr);
        console.log('[nexi-pay-by-link] Duration:', expirationHours ? `${expirationHours}h` : `${expirationDays}d`);

        // ─── Order ID ───────────────────────────────────────────────────
        const ts = Date.now().toString(36);
        const orderId = bookingId
            ? `P${bookingId.slice(0, 8)}${ts}`.slice(0, 18)
            : `P${ts}${Math.floor(Math.random() * 1000)}`.slice(0, 18);

        const amountCents = Math.round(amount * 100);

        // ─── Nexi Payload ───────────────────────────────────────────────
        const payload = {
            order: {
                orderId,
                amount: amountCents.toString(),
                currency: 'EUR',
                description: description || 'Pagamento DR7 Empire',
                customerInfo: {
                    cardHolderEmail: customerEmail || '',
                    cardHolderName: customerName || ''
                }
            },
            paymentSession: {
                actionType: 'PAY',
                captureType: 'IMPLICIT',
                amount: amountCents.toString(),
                language: 'ita',
                recurrence: {
                    action: 'CONTRACT_CREATION',
                    contractId: orderId,
                    contractType: 'MIT_UNSCHEDULED'
                },
                expirationDate: nexiExpirationStr,
                resultUrl: `${process.env.URL || 'https://admin.dr7empire.com'}/payment-success?order=${orderId}`,
                cancelUrl: `${process.env.URL || 'https://admin.dr7empire.com'}/payment-cancelled?order=${orderId}`,
                notificationUrl: `${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/nexi-payment-callback`
            },
            expirationDate: nexiExpirationStr
        };

        console.log('[nexi-pay-by-link] Payload:', JSON.stringify(payload));

        // ─── Call Nexi API ──────────────────────────────────────────────
        const correlationId = crypto.randomUUID();
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
        console.log('[nexi-pay-by-link] Response:', response.status, responseText.substring(0, 500));

        let responseData: any;
        try {
            responseData = JSON.parse(responseText);
        } catch {
            return {
                statusCode: 502, headers,
                body: JSON.stringify({ error: `Nexi API error (${response.status}): ${responseText.substring(0, 200) || 'risposta vuota'}` })
            };
        }

        if (!response.ok) {
            console.error('[nexi-pay-by-link] Nexi error:', responseData);
            return {
                statusCode: response.status, headers,
                body: JSON.stringify({ error: responseData.errors?.[0]?.description || 'Failed to create payment link' })
            };
        }

        const paymentUrl = responseData.paymentLink?.link || responseData.hostedPage;
        const nexiLinkId = responseData.paymentLink?.linkId || null;
        console.log('[nexi-pay-by-link] Payment URL:', paymentUrl, 'linkId:', nexiLinkId);

        // ─── Store in nexi_transactions ─────────────────────────────────
        const { error: dbError } = await supabase
            .from('nexi_transactions')
            .insert({
                order_id: orderId,
                booking_id: bookingId || null,
                amount_cents: amountCents,
                status: 'pending',
                payment_link: paymentUrl,
                description: description || 'Pagamento DR7 Empire',
                customer_email: customerEmail || null,
                contract_id: orderId.slice(0, 18),
                metadata: {
                    type: 'pay_by_link',
                    payment_purpose: paymentPurpose || 'booking',
                    customer_name: customerName,
                    nexi_link_id: nexiLinkId,
                    // ─── EXPIRATION TRACKING (UTC) ───
                    payment_link_sent_at: sentAt.toISOString(),
                    payment_link_expires_at: expiresAt.toISOString(),
                    payment_provider_expires_at: nexiExpirationStr,
                    nexi_response: responseData,
                },
                created_at: sentAt.toISOString()
            });

        if (dbError) console.error('[nexi-pay-by-link] DB error:', dbError);

        // ─── Update booking with expiration tracking ────────────────────
        if (bookingId) {
            await supabase.from('bookings').update({
                booking_details: supabase.rpc ? undefined : undefined, // Will be updated by caller
            }).eq('id', bookingId);
            // Note: the caller (ReservationsTab) updates booking_details with the link
        }

        // ─── Return with exact expiration timestamps ────────────────────
        return {
            statusCode: 200, headers,
            body: JSON.stringify({
                success: true,
                paymentUrl,
                paymentLink: paymentUrl,
                orderId,
                nexiLinkId,
                amount,
                // Expiration timestamps (UTC ISO)
                sentAt: sentAt.toISOString(),
                expiresAt: expiresAt.toISOString(),
                providerExpiresAt: nexiExpirationStr,
                message: 'Payment link created successfully'
            })
        };

    } catch (error: any) {
        console.error('[nexi-pay-by-link] Error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};

export { handler };
