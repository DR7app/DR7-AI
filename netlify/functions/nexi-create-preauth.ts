import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './require-auth'
import { nexiCallWithRecurrenceFallback } from './utils/nexiTokenizationFallback';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Use same API key as pay-by-link — /v2/orders/paybylink supports captureType EXPLICIT
const NEXI_API_KEY = process.env.NEXI_API_KEY!;
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
        const { cauzioneId, amount, customerEmail, customerName, description, expirationHours } = JSON.parse(event.body || '{}');

        if (!amount) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'amount is required' })
            };
        }

        // Generate unique order ID (max 18 chars for Nexi).
        // - Con cauzioneId: prefisso C + slug cauzione (flusso classico)
        // - Senza cauzioneId: prefisso PA (preauth standalone dal tab Nexi)
        const ts = Date.now().toString(36)
        const orderId = cauzioneId
            ? `C${cauzioneId.slice(0, 8)}${ts}`.slice(0, 18)
            : `PA${ts}${Math.random().toString(36).slice(2, 6)}`.slice(0, 18);

        // Convert amount to cents
        const amountCents = Math.round(amount * 100);

        const siteUrl = process.env.URL || 'https://dr7ai.com';

        // Calculate expiration: use hours if specified, otherwise 7 days
        const expirationDate = new Date();
        if (expirationHours) {
            expirationDate.setTime(expirationDate.getTime() + expirationHours * 60 * 60 * 1000);
        } else {
            expirationDate.setDate(expirationDate.getDate() + 7);
        }
        // Use Europe/Rome timezone for the yyyy-MM-dd date string.
        // Set to the actual expiration date (same day if expirationHours < 24).
        // expirationTime (ISO timestamp) provides the precise cutoff.
        const toRomeDate = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }); // sv-SE gives yyyy-MM-dd
        const expirationDateStr = toRomeDate(expirationDate);
        console.log('[nexi-create-preauth] Expiration:', expirationDate.toISOString(), 'Rome date for Nexi:', expirationDateStr);

        // Use /v2/orders/paybylink with captureType EXPLICIT for preauth
        // This uses the same API key as regular pay-by-link (no separate HPP key needed)
        const payload = {
            order: {
                orderId: orderId,
                amount: amountCents.toString(),
                currency: 'EUR',
                description: description || `Cauzione deposito ${cauzioneId}`,
                customField: `cauzione_${cauzioneId}`,
                customerInfo: {
                    cardHolderEmail: customerEmail || '',
                    cardHolderName: customerName || ''
                }
            },
            paymentSession: {
                actionType: 'PAY',           // PAY + EXPLICIT = authorize only, capture manually later
                captureType: 'EXPLICIT',     // EXPLICIT = funds held, not charged until capture API call
                amount: amountCents.toString(),
                language: 'ita',
                expirationDate: expirationDateStr,
                expirationTime: expirationDate.toISOString(),
                resultUrl: `${siteUrl}/admin?cauzione=${cauzioneId}&status=success`,
                cancelUrl: `${siteUrl}/admin?cauzione=${cauzioneId}&status=cancelled`,
                notificationUrl: `${siteUrl}/.netlify/functions/nexi-preauth-callback`,
                // Tokenize the card during preauth so the cauzione capture
                // (or any later MIT charge: sforo, danni) doesn't need the
                // card again from the customer.
                recurrence: {
                    action: 'CONTRACT_CREATION',
                    contractId: orderId,
                    contractType: 'MIT_UNSCHEDULED',
                },
            },
            expirationDate: expirationDateStr,
        };

        console.log('[nexi-create-preauth] === PREAUTH REQUEST ===');
        console.log('[nexi-create-preauth] Endpoint: /v2/orders/paybylink (same key as pay-by-link)');
        console.log('[nexi-create-preauth] actionType: PAY, captureType: EXPLICIT (authorize only, capture manually)');
        console.log('[nexi-create-preauth] orderId:', orderId);
        console.log('[nexi-create-preauth] amount (cents):', amountCents);

        const correlationId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })

        // Use v2 paybylink endpoint (base URL has /v1, replace with /v2)
        const pblUrl = NEXI_BASE_URL.replace('/v1', '/v2') + '/orders/paybylink';
        console.log('[nexi-create-preauth] URL:', pblUrl);

        const { response, responseText, usedFallback } = await nexiCallWithRecurrenceFallback({
            url: pblUrl,
            apiKey: NEXI_API_KEY,
            correlationId,
            payload,
            logTag: 'nexi-create-preauth',
        });

        console.log('[nexi-create-preauth] Response status:', response.status, 'fallback:', usedFallback);
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

        // paybylink returns paymentLink.link
        const paymentUrl = responseData.paymentLink?.link || responseData.hostedPage;
        console.log('[nexi-create-preauth] Payment URL:', paymentUrl);

        // Update cauzione with order ID and expiration timestamp
        const { error: updateError } = await supabase
            .from('cauzioni')
            .update({
                nexi_order_id: orderId,
                note: `Preautorizzazione in attesa - Order: ${orderId} - Scade: ${expirationDate.toISOString()}`,
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
                tokenization_requested: !usedFallback,
                tokenization_fallback_used: usedFallback,
                expires_at: expirationDate.toISOString(),
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
