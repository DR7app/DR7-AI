import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './require-auth'
import { nexiCallWithRecurrenceFallback } from './utils/nexiTokenizationFallback';
import { adminBaseUrl, successUrl, cancelUrl } from './utils/paymentReturnUrls';
import { handler as syncCauzione } from './sync-booking-cauzione';

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
        const { cauzioneId: inputCauzioneId, customerId, amount, customerEmail, customerName, description, expirationHours, bookingId } = JSON.parse(event.body || '{}');

        if (!amount) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'amount is required' })
            };
        }

        // 2026-09-12 — Una pre-autorizzazione nata dal tab Nexi restava senza
        // cauzione: allo sblocco mancava tutto (importo, data, prenotazione) e
        // usciva "operationId mancante". Regola: se c'e' una prenotazione, la
        // pre-autorizzazione e' SEMPRE la cauzione di quella prenotazione.
        let cauzioneId: string | null = inputCauzioneId || null;
        let cauzioneCreata = false;
        let avvisoCauzione: string | null = null;
        if (!cauzioneId && bookingId) {
            const { data: esistente } = await supabase
                .from('cauzioni')
                // Le cauzioni chiuse (Restituita/Incassata) restano per lo
                // storico: una nuova pre-auth non deve riaprirle.
                .select('id, stato, created_at')
                .eq('riferimento_contratto_id', bookingId)
                .not('stato', 'in', '("Restituita","Incassata")')
                .order('created_at', { ascending: false })
                .limit(1)
            const riga = esistente?.[0]
            if (riga?.id) {
                cauzioneId = riga.id as string
                console.log('[nexi-create-preauth] Cauzione della prenotazione trovata:', cauzioneId)
            } else {
                // Nessuna cauzione: la si crea con la stessa funzione usata
                // dalle prenotazioni, cosi' scadenza e metodo seguono la
                // Centralina invece di essere reinventati qui.
                const { data: bk } = await supabase
                    .from('bookings')
                    .select('id, customer_id, vehicle_id, dropoff_date, customer_email, customer_phone, customer_name')
                    .eq('id', bookingId)
                    .maybeSingle()
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const bkAny = bk as any
                if (!bkAny) {
                    avvisoCauzione = 'Prenotazione non trovata: la pre-autorizzazione resta senza cauzione.'
                } else {
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const res: any = await syncCauzione({
                            httpMethod: 'POST',
                            body: JSON.stringify({
                                bookingId,
                                customerId: bkAny.customer_id || customerId || null,
                                vehicleId: bkAny.vehicle_id || null,
                                returnDate: bkAny.dropoff_date,
                                depositAmount: amount,
                                paymentMethod: 'preautorizzazione',
                                depositPaid: false,
                                guestEmail: bkAny.customer_email || customerEmail || undefined,
                                guestPhone: bkAny.customer_phone || undefined,
                                guestName: bkAny.customer_name || customerName || undefined,
                            }),
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        } as any, {} as any, (() => undefined) as any)
                        const body = res?.body ? JSON.parse(res.body) : null
                        if (body?.cauzione?.id) {
                            cauzioneId = body.cauzione.id as string
                            cauzioneCreata = body.action === 'created'
                            console.log('[nexi-create-preauth] Cauzione', body.action, 'per la prenotazione:', cauzioneId)
                        } else {
                            avvisoCauzione = body?.error || 'Cauzione non creata per questa prenotazione.'
                        }
                    } catch (e) {
                        console.error('[nexi-create-preauth] Creazione cauzione fallita:', e)
                        avvisoCauzione = 'Creazione della cauzione fallita: la pre-autorizzazione resta senza cauzione.'
                    }
                }
                if (avvisoCauzione) console.warn('[nexi-create-preauth]', avvisoCauzione)
            }
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

        // Il cliente atterra sul SITO, mai sul gestionale; il callback
        // server-to-server resta su questo dominio.
        const adminUrl = adminBaseUrl();

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
                description: description || (cauzioneId ? `Cauzione deposito ${cauzioneId}` : 'Pre-autorizzazione DR7'),
                customField: cauzioneId
                    ? `cauzione_${cauzioneId}`
                    : (customerId ? `cliente_${customerId}` : 'preauth'),
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
                resultUrl: successUrl(orderId, 'cauzione'),
                cancelUrl: cancelUrl(orderId, 'cauzione'),
                notificationUrl: `${adminUrl}/.netlify/functions/nexi-preauth-callback`,
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

        // Update cauzione with order ID and expiration timestamp.
        // Senza cauzioneId (pre-auth dal tab Nexi o dal tab Clienti) non c'e'
        // nessuna riga da aggiornare: prima si finiva su `.eq('id', undefined)`,
        // cioe' una query fallita a ogni link standalone.
        if (cauzioneId) {
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
        }

        // Also store in nexi_transactions for tracking
        await supabase.from('nexi_transactions').insert({
            order_id: orderId,
            // La prenotazione si scrive subito: prima la riga restava orfana e
            // andava ricollegata a mano dal tab Nexi.
            booking_id: bookingId || null,
            amount_cents: amountCents,
            status: 'pending_preauth',
            payment_link: paymentUrl,
            description: description || `Cauzione preautorizzazione`,
            customer_email: customerEmail || null,
            metadata: {
                type: 'preauth',
                cauzione_id: cauzioneId || null,
                // Cliente scelto dall'anagrafica nel tab Nexi o dal menu
                // Gestisci del tab Clienti: serve per riagganciare la
                // pre-autorizzazione (e la carta) alla scheda cliente.
                customer_id: customerId || null,
                payment_purpose: cauzioneId ? 'cauzione' : 'cliente',
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
                bookingId: bookingId || null,
                cauzioneId: cauzioneId || null,
                cauzioneCreata,
                avvisoCauzione,
                message: avvisoCauzione
                    ? `Link pre-autorizzazione creato. ${avvisoCauzione}`
                    : (cauzioneCreata
                        ? 'Link pre-autorizzazione creato e cauzione della prenotazione aperta'
                        : (cauzioneId
                            ? 'Link pre-autorizzazione creato e collegato alla cauzione della prenotazione'
                            : 'Link pre-autorizzazione creato (blocco fondi, no incasso)'))
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
