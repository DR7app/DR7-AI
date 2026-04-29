import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { detectCardType, logCardAttempt, voidNexiTransaction, cancelBooking, notifyPrepaidBlocked } from './prepaid-card-guard';
import { renderTemplate } from './utils/messageTemplates';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const NEXI_API_KEY = process.env.NEXI_API_KEY!;
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1';

// Fetch operation details from Nexi to get card info (maskedPan, card type)
async function fetchNexiOperationDetails(operationId: string): Promise<any> {
    try {
        const res = await fetch(`${NEXI_BASE_URL}/operations/${operationId}`, {
            headers: {
                'X-Api-Key': NEXI_API_KEY,
                'Correlation-Id': randomUUID()
            }
        });
        if (res.ok) {
            const data = await res.json();
            console.log('[nexi-payment-callback] Operation details:', JSON.stringify(data).substring(0, 500));
            return data;
        }
        console.warn('[nexi-payment-callback] Failed to fetch operation:', res.status);
    } catch (e) {
        console.warn('[nexi-payment-callback] Error fetching operation:', e);
    }
    return null;
}

// BIN lookup to determine card type (credit/debit/prepaid)
async function lookupBin(bin: string): Promise<{ type: string; brand: string } | null> {
    try {
        const res = await fetch(`https://lookup.binlist.net/${bin}`, {
            headers: { 'Accept-Version': '3' }
        });
        if (res.ok) {
            const data = await res.json();
            console.log('[nexi-payment-callback] BIN lookup result:', JSON.stringify(data));
            return {
                type: (data.type || '').toLowerCase(), // credit, debit, prepaid
                brand: (data.scheme || '').toLowerCase()
            };
        }
    } catch (e) {
        console.warn('[nexi-payment-callback] BIN lookup error:', e);
    }
    return null;
}

const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        console.log('[nexi-payment-callback] Received:', event.body);

        // Parse callback (Nexi sends JSON or URL-encoded)
        let callbackData: any;
        if (event.headers['content-type']?.includes('application/json')) {
            callbackData = JSON.parse(event.body || '{}');
        } else {
            const params = new URLSearchParams(event.body || '');
            callbackData = Object.fromEntries(params.entries());
        }

        // Nexi Pay by Link v2 sends nested format: { operation: { orderId, operationResult, ... } }
        // Nexi hosted payment sends flat format: { orderId, result, resultCode, ... }
        const op = callbackData.operation || {};
        const orderId = callbackData.orderId || op.orderId;
        const operationId = callbackData.operationId || op.operationId;
        const transactionId = callbackData.transactionId || op.paymentEndToEndId;
        const result = callbackData.result || op.operationResult;
        const resultCode = callbackData.resultCode;
        const authorizationCode = callbackData.authorizationCode || op.additionalData?.authorizationCode;
        // Only use a contractId if Nexi actually returned one — i.e. the
        // original order had `recurrence: { action: 'CONTRACT_CREATION', ...}`.
        // Falling back to `orderId` (the previous behaviour) gave us a fake
        // token in customers_extended.metadata for every payment, even when
        // no card was tokenized — that's why the Nexi tab listed cards we
        // could not actually charge via MIT.
        const contractId = callbackData.contractId
            || op.additionalData?.contractId
            || op.additionalData?.recurringContractId
            || callbackData.recurringContractId
            || null;
        const paymentCircuit = callbackData.paymentCircuit || op.paymentCircuit || op.additionalData?.paymentCircuit || '';
        const paymentInstrument = callbackData.paymentInstrument || op.paymentInstrument || '';

        console.log('[nexi-payment-callback] Parsed:', { orderId, result, resultCode, authorizationCode, operationId, paymentCircuit, paymentInstrument, raw_keys: Object.keys(callbackData), raw_op_keys: Object.keys(op) });

        if (!orderId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing orderId' }) };
        }

        const isSuccess = result === 'OK' || result === 'AUTHORIZED' || result === 'EXECUTED' || resultCode === '00';

        // Find the nexi_transaction by order_id
        const { data: transaction } = await supabase
            .from('nexi_transactions')
            .select('id, booking_id, amount_cents, customer_email, contract_id, metadata, description, status')
            .eq('order_id', orderId)
            .single();

        if (!transaction) {
            console.error('[nexi-payment-callback] Transaction not found for order:', orderId);
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'Transaction not found' }) };
        }

        // Idempotency: if transaction already processed, return success without re-processing
        if (transaction.status === 'completed' || transaction.status === 'failed') {
            console.log(`[nexi-payment-callback] Transaction ${orderId} already processed (status: ${transaction.status}). Skipping.`);
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, already_processed: true, status: transaction.status }) };
        }

        // ─── EXPIRY VALIDATION ────────────────────────────────────────
        // Reject late payments: if payment_link_expires_at has passed, the booking
        // was already expired. Log it but don't confirm as paid.
        const expiresAtStr = transaction.metadata?.payment_link_expires_at || transaction.metadata?.link_expires_at;
        if (isSuccess && expiresAtStr) {
            const expiresAt = new Date(expiresAtStr);
            const now = new Date();
            // Grace period: 5 minutes after expiry to handle Nexi processing delays
            const graceMs = 5 * 60 * 1000;
            if (now.getTime() > expiresAt.getTime() + graceMs) {
                console.warn(`[nexi-payment-callback] LATE PAYMENT REJECTED — order ${orderId} expired at ${expiresAtStr}, callback received at ${now.toISOString()} (${Math.round((now.getTime() - expiresAt.getTime()) / 1000)}s late)`);
                // Update transaction as expired (don't mark completed)
                await supabase.from('nexi_transactions').update({
                    status: 'expired_late_payment',
                    metadata: {
                        ...(transaction.metadata || {}),
                        callback_result: result,
                        late_payment_at: now.toISOString(),
                        expired_at: expiresAtStr,
                        seconds_late: Math.round((now.getTime() - expiresAt.getTime()) / 1000),
                    },
                    updated_at: now.toISOString()
                }).eq('id', transaction.id);
                // Note: Nexi already charged the card. We need to refund.
                // For now, flag it for manual review. Auto-refund can be added later.
                console.warn(`[nexi-payment-callback] ⚠️ MANUAL REFUND NEEDED for order ${orderId} — customer paid after link expired`);
                return { statusCode: 200, headers, body: JSON.stringify({ status: 'expired', message: 'Payment received after link expiry — flagged for refund' }) };
            }
        }

        // Detect payment purpose from metadata or description
        const paymentPurpose = transaction.metadata?.payment_purpose
            || (transaction.description?.toLowerCase().startsWith('danni') ? 'danni' : null)
            || (transaction.description?.toLowerCase().startsWith('penali') ? 'penali' : null)
            || 'booking';
        const isDanniPenali = paymentPurpose === 'danni' || paymentPurpose === 'penali' || paymentPurpose === 'danni_penali';
        const isExtension = paymentPurpose === 'extension';
        const isTopup = paymentPurpose === 'booking_topup';

        console.log(`[nexi-payment-callback] Payment purpose: ${paymentPurpose}, isDanniPenali: ${isDanniPenali}, isExtension: ${isExtension}, isTopup: ${isTopup}`);

        // Update transaction status (preserve original metadata)
        await supabase.from('nexi_transactions').update({
            status: isSuccess ? 'completed' : 'failed',
            transaction_id: transactionId || operationId || null,
            contract_id: contractId || transaction.contract_id,
            metadata: {
                ...(transaction.metadata || {}),
                callback_result: result,
                result_code: resultCode,
                authorization_code: authorizationCode,
                operation_id: operationId,
                contract_id: contractId,
                payment_circuit: paymentCircuit,
                payment_instrument: paymentInstrument
            },
            updated_at: new Date().toISOString()
        }).eq('id', transaction.id);

        // ── AUTO-RESEND FRESH PAY-BY-LINK ON PAYMENT REFUSAL ───────────────
        // Quando Nexi rifiuta un pagamento, genera e invia un link fresco al
        // cliente. Ripete ad ogni rifiuto entro una finestra di 1 ora che parte
        // dal PRIMO link generato per questa prenotazione+purpose. Dopo 1 ora
        // niente più auto-resend — l'admin interviene manualmente.
        if (!isSuccess && transaction.booking_id) {
            // Trova il primo link generato per questa prenotazione + purpose.
            // Tutte le nexi_transactions sono ordinate per created_at — la più
            // vecchia è la prima del ciclo.
            const { data: firstTx } = await supabase
                .from('nexi_transactions')
                .select('created_at')
                .eq('booking_id', transaction.booking_id)
                .eq('payment_purpose', paymentPurpose || 'booking')
                .order('created_at', { ascending: true })
                .limit(1)
                .maybeSingle();

            const windowStartMs = firstTx?.created_at
                ? new Date(firstTx.created_at).getTime()
                : new Date(transaction.created_at).getTime();
            const elapsedMs = Date.now() - windowStartMs;
            const ONE_HOUR_MS = 60 * 60 * 1000;
            const retryCount = transaction.metadata?.auto_retry_count || 0;

            if (elapsedMs >= ONE_HOUR_MS) {
                console.log(`[nexi-payment-callback] Finestra 1h scaduta (${Math.round(elapsedMs / 60000)}min dal primo link) per booking ${transaction.booking_id} — no new link sent.`);
            } else {
                try {
                    const { data: refusedBooking } = await supabase
                        .from('bookings')
                        .select('id, customer_name, customer_phone, customer_email, vehicle_name, booking_details')
                        .eq('id', transaction.booking_id)
                        .single();

                    if (refusedBooking) {
                        const rbPhone = refusedBooking.customer_phone || refusedBooking.booking_details?.customer?.phone;
                        const rbName = refusedBooking.customer_name || refusedBooking.booking_details?.customer?.fullName || 'Cliente';
                        const rbEmail = refusedBooking.customer_email || refusedBooking.booking_details?.customer?.email || '';
                        const rbAmountEur = transaction.amount_cents / 100;
                        const rbRef = (refusedBooking.id || '').substring(0, 8).toUpperCase();
                        const rbDescription = transaction.description || `Pagamento DR7 - ${refusedBooking.vehicle_name || 'Prenotazione'} - ${rbName}`;

                        // Generate a fresh Pay-by-Link (1-hour expiry, same as admin flow)
                        const linkRes = await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/nexi-pay-by-link`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                bookingId: refusedBooking.id,
                                amount: rbAmountEur,
                                customerEmail: rbEmail,
                                customerName: rbName,
                                description: rbDescription,
                                expirationHours: 1,
                                paymentPurpose,
                            })
                        });
                        const linkData = await linkRes.json().catch(() => ({}));

                        if (linkRes.ok && linkData.paymentUrl) {
                            // Send WhatsApp using the existing "Richiesta Pagamento" Pro template
                            // (same message the admin-triggered Pay-by-Link flow uses)
                            if (rbPhone) {
                                // Passa tutti gli alias: il template admin-edited può usare
                                // {amount} o {total}, {link} o {payment_link}, {booking_ref}
                                // o {booking_id} — tutti risolvono allo stesso valore così
                                // niente leaka come {...} letterale nel messaggio al cliente.
                                const amountStr = rbAmountEur.toFixed(2);
                                const retryMsg = await renderTemplate('pro_richiesta_pagamento', {
                                    customer_name: rbName,
                                    nome: (rbName || '').split(' ')[0] || 'Cliente',
                                    amount: amountStr,
                                    total: amountStr,
                                    importo: amountStr,
                                    link: linkData.paymentUrl,
                                    payment_link: linkData.paymentUrl,
                                    booking_ref: rbRef,
                                    booking_id: rbRef,
                                });

                                if (retryMsg === null) {
                                    console.warn('[nexi-payment-callback] Template "pro_richiesta_pagamento" missing/disabled — skipping auto-retry send');
                                } else {
                                    await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/send-whatsapp-notification`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            customPhone: rbPhone,
                                            customMessage: retryMsg,
                                        })
                                    });

                                    // Log message send
                                    try {
                                        const minsLeft = Math.max(0, Math.round((ONE_HOUR_MS - elapsedMs) / 60000));
                                        await supabase.from('sent_messages_log').insert({
                                            customer_name: rbName,
                                            customer_phone: rbPhone,
                                            message_text: retryMsg,
                                            template_label: `Auto-retry Pay-by-Link (tentativo #${retryCount + 1}, finestra ${minsLeft}min rimanenti)`,
                                            status: 'sent',
                                        });
                                    } catch (logErr) {
                                        console.error('[nexi-payment-callback] Failed to log retry message:', logErr);
                                    }
                                }
                            }

                            // Persist retry count on the refused transaction
                            await supabase.from('nexi_transactions').update({
                                metadata: {
                                    ...(transaction.metadata || {}),
                                    auto_retry_count: retryCount + 1,
                                    auto_retry_at: new Date().toISOString(),
                                    auto_retry_link: linkData.paymentUrl,
                                }
                            }).eq('id', transaction.id);

                            const elapsedMinStr = Math.round(elapsedMs / 60000);
                            console.log(`[nexi-payment-callback] ✅ Auto-sent fresh Pay-by-Link to ${rbName} after refused payment (retry #${retryCount + 1}, ${elapsedMinStr}min dal primo link / finestra 60min)`);
                        } else {
                            console.warn('[nexi-payment-callback] Auto-retry: could not create fresh link:', linkData.error || `HTTP ${linkRes.status}`);
                        }
                    }
                } catch (retryErr) {
                    console.error('[nexi-payment-callback] Auto-retry link send failed (non-fatal):', retryErr);
                }
            }
        }

        // ── DANNI/PENALI PAYMENT ──────────────────────────────────────────
        if (isSuccess && isDanniPenali && transaction.booking_id) {
            console.log(`[nexi-payment-callback] Processing ${paymentPurpose} payment for booking ${transaction.booking_id}`);

            const { data: booking } = await supabase
                .from('bookings')
                .select('id, customer_name, customer_phone, customer_email, booking_details')
                .eq('id', transaction.booking_id)
                .single();

            if (booking) {
                const amountEur = (transaction.amount_cents / 100).toFixed(2);
                const details = booking.booking_details || {};

                // Mark matching danni/penali entries as paid.
                // amountPaid must equal what the CUSTOMER actually paid =
                // total − discount (DanniPenaliModal stores `discount` per item
                // when admin used "Prezzo finale desiderato"). Setting it to
                // the raw total leaves the booking looking under-paid forever.
                let updated = false;
                const arrayKeys = paymentPurpose === 'danni' ? ['danni'] : paymentPurpose === 'penali' ? ['penalties'] : ['danni', 'penalties'];
                for (const key of arrayKeys) {
                    const items = details[key] || [];
                    for (const item of items) {
                        if (item.paymentStatus === 'nexi_pay_by_link' || item.paymentStatus === 'pending' || !item.paymentStatus) {
                            const itemTotal = item.total || (item.amount || 0) * (item.quantity || 1);
                            const itemDiscount = Number(item.discount) || 0;
                            const itemEffective = Math.round((itemTotal - itemDiscount) * 100) / 100;
                            item.paymentStatus = 'paid';
                            item.paymentMethod = 'Nexi Pay by Link';
                            item.amountPaid = itemEffective;
                            item.paidAt = new Date().toISOString();
                            updated = true;
                        }
                    }
                }

                if (updated) {
                    await supabase.from('bookings').update({
                        booking_details: {
                            ...details,
                            nexi_transaction_id: transactionId || operationId,
                            nexi_contract_id: contractId,
                        }
                    }).eq('id', booking.id);
                    console.log(`[nexi-payment-callback] Marked ${paymentPurpose} as paid in booking_details`);
                }

                // Generate penalty/danni fattura.
                // Items are passed at FULL price (so the fattura subtotale
                // matches what the customer originally saw). The aggregate
                // `discount` (set by DanniPenaliModal) is sent as
                // discountAmount — generate-penalty-invoice appends a Sconto
                // line so Subtotal − Sconto = Totale renders correctly.
                try {
                    const custId = details.customer?.customerId || details.customer?.id || details.customer_id;
                    const allItems: { label: string; amount: number; quantity: number }[] = [];
                    let aggregateDiscount = 0;
                    for (const key of arrayKeys) {
                        for (const item of (details[key] || [])) {
                            if (item.paidAt === new Date().toISOString().split('T')[0] || item.paymentMethod === 'Nexi Pay by Link') {
                                const itemTotal = item.total || (item.amount || 0) * (item.quantity || 1);
                                allItems.push({
                                    label: item.label || (key === 'danni' ? 'Danno' : 'Penale'),
                                    amount: itemTotal,
                                    quantity: 1, // already aggregated into amount
                                });
                                aggregateDiscount += Number(item.discount) || 0;
                            }
                        }
                    }
                    // Use all items that were just marked paid
                    if (allItems.length === 0) {
                        // Fallback: create a single item from the transaction amount
                        allItems.push({ label: paymentPurpose === 'danni' ? 'Danni' : 'Penali', amount: transaction.amount_cents / 100, quantity: 1 });
                    }

                    const invoiceRes = await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/generate-penalty-invoice`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.ADMIN_API_TOKEN || ''}` },
                        body: JSON.stringify({
                            bookingId: booking.id,
                            customerId: custId,
                            items: allItems,
                            discountAmount: aggregateDiscount > 0 ? Math.round(aggregateDiscount * 100) / 100 : undefined,
                            type: paymentPurpose,
                            paymentStatus: 'paid'
                        })
                    });
                    const invoiceData = await invoiceRes.json();
                    if (invoiceRes.ok) {
                        console.log(`[nexi-payment-callback] ✅ Fattura ${paymentPurpose} generata: ${invoiceData.invoice?.numero_fattura || 'N/A'}`);
                    } else {
                        console.error(`[nexi-payment-callback] ❌ Fattura ${paymentPurpose} failed:`, invoiceData.error || invoiceData.message);
                    }
                } catch (invErr) {
                    console.error(`[nexi-payment-callback] Fattura ${paymentPurpose} error:`, invErr);
                }

                // Save contractId on customer
                if (contractId) {
                    const custEmail = (booking.customer_email || transaction.customer_email || '').toLowerCase().trim();
                    if (custEmail) {
                        const { data: custByEmail } = await supabase.from('customers_extended').select('id, metadata').eq('email', custEmail).maybeSingle();
                        if (custByEmail) {
                            await supabase.from('customers_extended').update({
                                metadata: { ...(custByEmail.metadata || {}), nexi_contract_id: contractId, nexi_contract_updated: new Date().toISOString() },
                                updated_at: new Date().toISOString()
                            }).eq('id', custByEmail.id);
                        }
                    }
                }

                // Send WhatsApp confirmation (NOT a rental confirmation)
                const custPhone = booking.customer_phone || details.customer?.phone;
                if (custPhone) {
                    const custName = booking.customer_name || details.customer?.fullName || 'Cliente';
                    const customerMsg = await renderTemplate('payment_received_damages', { custName, amountEur, paymentType: paymentPurpose === 'danni' ? 'danni' : paymentPurpose === 'penali' ? 'penali' : 'danni/penali' });
                    if (customerMsg === null) {
                        console.log('[nexi-payment-callback] Template "payment_received_damages" missing/disabled — skipping send');
                    } else {
                        await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/send-whatsapp-notification`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                customPhone: custPhone,
                                customMessage: customerMsg
                            })
                        });
                    }
                }

                // Admin notification
                const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || '393457905205';
                if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                    const adminMsg = await renderTemplate('payment_received_damages_admin', { customer_name: booking.customer_name, amountEur, paymentType: paymentPurpose });
                    if (adminMsg === null) {
                        console.log('[nexi-payment-callback] Template "payment_received_damages_admin" missing/disabled — skipping send');
                    } else {
                        await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                chatId: `${NOTIFICATION_PHONE}@c.us`,
                                message: adminMsg
                            })
                        });

                        // Log to sent_messages_log
                        try {
                            await supabase.from('sent_messages_log').insert({
                                customer_name: booking.customer_name || 'N/A',
                                customer_phone: NOTIFICATION_PHONE,
                                message_text: adminMsg,
                                template_label: `Payment Confirmation Admin (${paymentPurpose})`,
                                status: 'sent',
                            });
                        } catch (logErr) {
                            console.error('Failed to log message:', logErr);
                        }
                    }
                }
            }

            // NO contract, NO booking confirmation — just danni/penali
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, status: 'danni_penali_paid' }) };
        }

        // ── EXTENSION PAYMENT ────────────────────────────────────────────
        if (isSuccess && isExtension && transaction.booking_id) {
            const { data: booking } = await supabase
                .from('bookings')
                .select('id, customer_name, customer_phone, customer_email, vehicle_name, booking_details')
                .eq('id', transaction.booking_id)
                .single();

            if (booking) {
                const amountEur = (transaction.amount_cents / 100).toFixed(2);
                console.log(`[nexi-payment-callback] Extension payment received — €${amountEur} for booking ${booking.id}`);

                // Mark the latest pending extension as paid in booking_details
                const details = booking.booking_details || {};
                const extensions = details.extension_history || [];
                let markedPaid = false;
                for (const ext of extensions) {
                    if (ext.payment_status === 'pending' || ext.payment_status === 'nexi_pay_by_link') {
                        ext.payment_status = 'paid';
                        ext.payment_method = 'Nexi Pay by Link';
                        ext.paid_at = new Date().toISOString();
                        markedPaid = true;
                        break; // Mark only the first pending extension
                    }
                }

                if (markedPaid) {
                    await supabase.from('bookings').update({
                        booking_details: {
                            ...details,
                            extension_history: extensions,
                            nexi_extension_paid_at: new Date().toISOString(),
                        }
                    }).eq('id', booking.id);
                    console.log(`[nexi-payment-callback] Extension marked as paid in booking_details`);
                }

                // Generate fattura for EXTENSION AMOUNT ONLY (not full booking)
                try {
                    const extensionAmountEur = transaction.amount_cents / 100;
                    await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/generate-invoice-from-booking`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.ADMIN_API_TOKEN || ''}` },
                        body: JSON.stringify({ bookingId: booking.id, includeIVA: true, extensionAmount: extensionAmountEur })
                    });
                    console.log(`[nexi-payment-callback] Extension fattura generated — €${amountEur}`);
                } catch (invErr) {
                    console.error('[nexi-payment-callback] Extension fattura failed:', invErr);
                }

                // Send WhatsApp confirmation to customer
                const custPhone = booking.customer_phone || details.customer?.phone;
                if (custPhone) {
                    const custName = booking.customer_name || details.customer?.fullName || 'Cliente';
                    const customerMsg = await renderTemplate('payment_received_extension', { custName, amountEur });
                    if (customerMsg === null) {
                        console.log('[nexi-payment-callback] Template "payment_received_extension" missing/disabled — skipping send');
                    } else {
                        await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/send-whatsapp-notification`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                customPhone: custPhone,
                                customMessage: customerMsg
                            })
                        });
                    }
                }

                // Admin notification
                const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || '393457905205';
                if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                    const adminMsg = await renderTemplate('payment_received_extension_admin', { customer_name: booking.customer_name, amountEur, vehicle_name: booking.vehicle_name || 'N/A' });
                    if (adminMsg === null) {
                        console.log('[nexi-payment-callback] Template "payment_received_extension_admin" missing/disabled — skipping send');
                    } else {
                        await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                chatId: `${NOTIFICATION_PHONE}@c.us`,
                                message: adminMsg
                            })
                        });

                        // Log to sent_messages_log
                        try {
                            await supabase.from('sent_messages_log').insert({
                                customer_name: booking.customer_name || 'N/A',
                                customer_phone: NOTIFICATION_PHONE,
                                message_text: adminMsg,
                                template_label: 'Payment Confirmation Admin (extension)',
                                status: 'sent',
                            });
                        } catch (logErr) {
                            console.error('Failed to log message:', logErr);
                        }
                    }
                }
            }

            // NO contract, NO booking re-confirmation — just extension
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, status: 'extension_paid' }) };
        }

        // ── BOOKING TOP-UP PAYMENT ───────────────────────────────────────
        // Fired when the customer pays the delta pay-by-link the admin
        // generated after modifying a partial/paid booking upwards.
        //   - ADDS this amount to the booking's amount_paid (not overwrites)
        //   - marks status=paid if the total is now fully covered
        //   - generates a fattura for JUST this payment (delta invoice)
        //   - regenerates + sends the updated contract via WhatsApp
        if (isSuccess && isTopup && transaction.booking_id) {
            const { data: booking } = await supabase
                .from('bookings')
                .select('id, customer_name, customer_phone, customer_email, vehicle_name, vehicle_plate, service_type, service_name, appointment_date, price_total, booking_details, payment_status')
                .eq('id', transaction.booking_id)
                .single();

            if (booking) {
                const topupAmountEur = transaction.amount_cents / 100;
                const priorPaidCents = Number(booking.booking_details?.amountPaid ?? booking.booking_details?.amount_paid ?? 0) || 0;
                const newPaidCents = priorPaidCents + transaction.amount_cents;
                const fullyPaid = booking.price_total ? newPaidCents >= (booking.price_total - 1) : false;
                console.log(`[nexi-payment-callback] TOPUP €${topupAmountEur.toFixed(2)} for booking ${booking.id} — prior paid €${(priorPaidCents/100).toFixed(2)}, new paid €${(newPaidCents/100).toFixed(2)}, fully=${fullyPaid}`);

                // Update booking: status + accumulated amount_paid
                await supabase.from('bookings').update({
                    payment_status: fullyPaid ? 'paid' : 'partial',
                    amount_paid: newPaidCents,
                    status: fullyPaid ? 'confirmed' : booking.payment_status,
                    booking_details: {
                        ...booking.booking_details,
                        amountPaid: newPaidCents,
                        last_topup_amount_cents: transaction.amount_cents,
                        last_topup_at: new Date().toISOString(),
                        topup_history: [
                            ...(Array.isArray(booking.booking_details?.topup_history) ? booking.booking_details.topup_history : []),
                            { amount_cents: transaction.amount_cents, paid_at: new Date().toISOString(), nexi_order_id: transaction.order_id }
                        ],
                    }
                }).eq('id', booking.id);

                // Fattura for the topup amount only (delta invoice)
                try {
                    await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/generate-invoice-from-booking`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.ADMIN_API_TOKEN || ''}` },
                        body: JSON.stringify({ bookingId: booking.id, includeIVA: true, extensionAmount: topupAmountEur })
                    });
                    console.log(`[nexi-payment-callback] Topup fattura generated — €${topupAmountEur.toFixed(2)}`);
                } catch (invErr) {
                    console.error('[nexi-payment-callback] Topup fattura failed:', invErr);
                }

                // Regenerate the contract so it reflects the modified booking
                // and re-send the signing link (old signed version was already
                // cleared by generate-contract).
                try {
                    const contractRes = await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/generate-contract`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.ADMIN_API_TOKEN || ''}` },
                        body: JSON.stringify({ bookingId: booking.id })
                    });
                    if (contractRes.ok) {
                        console.log('[nexi-payment-callback] Contract regenerated after topup');
                        // Fire signature-init so the customer gets a fresh signing link
                        // on the updated contract.
                        const { data: contractRow } = await supabase
                            .from('contracts')
                            .select('id')
                            .eq('booking_id', booking.id)
                            .order('created_at', { ascending: false })
                            .limit(1)
                            .maybeSingle();
                        if (contractRow?.id) {
                            await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/signature-init`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ contractId: contractRow.id, bookingId: booking.id })
                            });
                            console.log('[nexi-payment-callback] Signature-init fired for updated contract');
                        }
                    }
                } catch (ctrErr) {
                    console.error('[nexi-payment-callback] Contract regen/send failed:', ctrErr);
                }

                // Customer WhatsApps:
                //   1. Payment received (extension-style receipt).
                //   2. If the topup made the booking FULLY PAID → conferma
                //      noleggio (rental_new_customer). Previously only the
                //      receipt was sent — the admin had asked for the
                //      conferma to arrive only AFTER payment, which is now
                //      honoured here at the moment the balance is cleared.
                const custPhone = booking.customer_phone || booking.booking_details?.customer?.phone;
                if (custPhone) {
                    const custName = booking.customer_name || 'Cliente';
                    const amountEur = topupAmountEur.toFixed(2);
                    const customerMsg = await renderTemplate('payment_received_extension', { custName, amountEur });
                    if (customerMsg) {
                        await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/send-whatsapp-notification`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ customPhone: custPhone, customMessage: customerMsg })
                        });
                    }

                    // Final conferma noleggio — only when payment makes the
                    // booking fully paid.
                    if (fullyPaid) {
                        // Re-fetch the booking to get the fresh status we just
                        // wrote, then pass it to send-whatsapp-notification so
                        // the legacy booking branch picks rental_new_customer.
                        const { data: fullBooking } = await supabase
                            .from('bookings')
                            .select('*')
                            .eq('id', booking.id)
                            .single();
                        if (fullBooking) {
                            await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/send-whatsapp-notification`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    customPhone: custPhone,
                                    booking: {
                                        ...fullBooking,
                                        service_type: 'car_rental',
                                        payment_status: 'paid',
                                        isEdit: false,
                                    }
                                })
                            });
                            console.log('[nexi-payment-callback] Topup → fully paid → conferma noleggio sent');
                        }
                    }
                }

                return { statusCode: 200, headers, body: JSON.stringify({ success: true, status: 'topup_paid', fullyPaid }) };
            }
        }

        // ── REGULAR BOOKING PAYMENT ───────────────────────────────────────
        if (isSuccess && transaction.booking_id) {
            const { data: booking } = await supabase
                .from('bookings')
                .select('id, user_id, customer_name, customer_phone, customer_email, vehicle_name, vehicle_plate, vehicle_type, service_type, service_name, appointment_date, payment_method, booking_details, price_total, pickup_date, dropoff_date, pickup_location, dropoff_location, deposit_amount, km_overage_fee, status, payment_status')
                .eq('id', transaction.booking_id)
                .single();

            if (booking) {
                const amountEur = (transaction.amount_cents / 100).toFixed(2);
                const paidAt = new Date().toISOString();

                // RACE CONDITION GUARD: Only confirm if booking is still in a payable state
                // If the expiration job already ran, booking.status might be 'expired'
                // In that case, we still confirm — payment was authorized before expiry
                // (Nexi authorized the charge, so the customer DID pay)
                const wasExpired = booking.status === 'expired';
                if (wasExpired) {
                    console.log(`[nexi-payment-callback] Booking ${booking.id} was expired but payment came through — re-confirming (payment wins over expiry)`);
                }

                // Skip if already paid (duplicate webhook)
                if (booking.booking_details?.nexi_paid_at || booking.payment_status === 'paid' || booking.payment_status === 'succeeded' || booking.payment_status === 'completed') {
                    console.log(`[nexi-payment-callback] Booking ${booking.id} already paid — skipping duplicate confirmation`);
                    return { statusCode: 200, headers, body: JSON.stringify({ success: true, already_paid: true }) };
                }

                // Validate payment amount matches booking price (tolerance: 1 cent for rounding)
                if (booking.price_total && Math.abs(transaction.amount_cents - booking.price_total) > 1) {
                    console.error(`[nexi-payment-callback] AMOUNT MISMATCH: paid ${transaction.amount_cents} cents but booking expects ${booking.price_total} cents — booking ${booking.id}`);
                }

                // ── PREPAID CARD CHECK ─────────────────────────────────
                // Detect prepaid from callback data (paymentInstrumentInfo is in the callback)
                // If prepaid: flag booking for 20% surcharge
                let isPrepaidCard = false
                const guardMaskedPan = callbackData.paymentInstrumentInfo || ''

                try {
                    // 1. BIN lookup from maskedPan in callback data (most reliable)
                    if (guardMaskedPan) {
                        const binMatch = guardMaskedPan.match(/^(\d{6,8})/)
                        if (binMatch) {
                            const binRes = await fetch(`https://lookup.binlist.net/${binMatch[1]}`, {
                                headers: { 'Accept-Version': '3' },
                            })
                            if (binRes.ok) {
                                const binData = await binRes.json()
                                console.log(`[nexi-payment-callback] PREPAID CHECK BIN: type=${binData.type}, prepaid=${binData.prepaid}`)
                                if (binData.type === 'prepaid' || binData.prepaid === true) isPrepaidCard = true
                            }
                        }
                    }

                    // 2. Keyword fallback in callback data
                    if (!isPrepaidCard) {
                        const raw = JSON.stringify(callbackData).toLowerCase()
                        if (raw.includes('prepagat') || raw.includes('"prepaid":true')) isPrepaidCard = true
                    }
                } catch (e) {
                    console.warn('[nexi-payment-callback] Prepaid check error:', e)
                }

                console.log(`[nexi-payment-callback] PREPAID CHECK: isPrepaid=${isPrepaidCard}, maskedPan=${guardMaskedPan}`)

                // Prepaid info logged — no surcharge, popup warning handled on frontend
                // ── END PREPAID CHECK ─────────────────────────────────────

                // Confirm the booking — CONDITIONAL UPDATE for safety
                const { data: confirmedRows } = await supabase.from('bookings').update({
                    payment_status: 'paid',
                    status: 'confirmed',
                    amount_paid: transaction.amount_cents,
                    updated_at: paidAt,
                    booking_details: {
                        ...booking.booking_details,
                        nexi_transaction_id: transactionId || operationId,
                        nexi_contract_id: contractId,
                        nexi_paid_at: paidAt,
                        paymentStatus: 'paid',
                    }
                })
                .eq('id', booking.id)
                .neq('payment_status', 'paid')  // Guard: don't re-confirm
                .select('id');

                if (!confirmedRows || confirmedRows.length === 0) {
                    console.log(`[nexi-payment-callback] Booking ${booking.id} — conditional update matched 0 rows (already paid by another webhook)`);
                    return { statusCode: 200, headers, body: JSON.stringify({ success: true, already_paid: true }) };
                }

                console.log(`[nexi-payment-callback] Booking ${booking.id} confirmed — €${amountEur} paid${wasExpired ? ' (recovered from expired)' : ''}`);


                // Store contractId + card details on customer
                {
                    const custId = booking.booking_details?.customer?.customerId || booking.booking_details?.customer?.id || booking.booking_details?.customer_id;
                    const custEmail = (booking.customer_email || booking.booking_details?.customer?.email || transaction.customer_email || '').toLowerCase().trim();

                    // Fetch card details from Nexi operation
                    let cardInfo: Record<string, any> = {}
                    if (operationId) {
                        const opDetails = await fetchNexiOperationDetails(operationId);
                        if (opDetails) {
                            const maskedPan = opDetails.paymentMethod?.maskedPan || opDetails.maskedPan || op.additionalData?.maskedPan || '';
                            const circuit = opDetails.paymentMethod?.circuit || opDetails.paymentCircuit || paymentCircuit || '';
                            const cardType = opDetails.paymentMethod?.cardType || '';
                            // BIN lookup for credit/debit/prepaid detection
                            let binType = '';
                            let binBrand = '';
                            if (maskedPan && maskedPan.length >= 6) {
                                const binResult = await lookupBin(maskedPan.substring(0, 6));
                                if (binResult) {
                                    binType = binResult.type; // credit, debit, prepaid
                                    binBrand = binResult.brand;
                                }
                            }
                            cardInfo = {
                                nexi_card_masked_pan: maskedPan,
                                nexi_card_circuit: circuit,
                                nexi_card_type: cardType || binType, // credit/debit/prepaid
                                nexi_card_brand: binBrand || circuit,
                                nexi_card_updated: new Date().toISOString(),
                            }
                            console.log(`[nexi-payment-callback] Card info: ${circuit} ${maskedPan} (${cardType || binType})`);
                        }
                    }

                    const metadataUpdate = {
                        ...(contractId ? { nexi_contract_id: contractId } : {}),
                        nexi_contract_updated: new Date().toISOString(),
                        ...cardInfo,
                    }

                    let savedOnCustomer = false;

                    if (custId) {
                        const { data: cust } = await supabase.from('customers_extended').select('id, metadata').eq('id', custId).maybeSingle();
                        if (cust) {
                            await supabase.from('customers_extended').update({
                                metadata: { ...(cust.metadata || {}), ...metadataUpdate },
                                updated_at: new Date().toISOString()
                            }).eq('id', cust.id);
                            savedOnCustomer = true;
                            console.log(`[nexi-payment-callback] Saved card info + contractId on customer ${cust.id} (by ID)`);
                        }
                    }

                    // Fallback: lookup by email
                    if (!savedOnCustomer && custEmail) {
                        const { data: custByEmail } = await supabase.from('customers_extended').select('id, metadata').eq('email', custEmail).maybeSingle();
                        if (custByEmail) {
                            await supabase.from('customers_extended').update({
                                metadata: { ...(custByEmail.metadata || {}), ...metadataUpdate },
                                updated_at: new Date().toISOString()
                            }).eq('id', custByEmail.id);
                            savedOnCustomer = true;
                            console.log(`[nexi-payment-callback] Saved card info + contractId on customer ${custByEmail.id} (by email: ${custEmail})`);
                        }
                    }

                    if (!savedOnCustomer) {
                        console.warn(`[nexi-payment-callback] Could not find customer to save card info. custId=${custId}, email=${custEmail}`);
                    }
                }

                // Send booking confirmation to customer via WhatsApp — uses Messaggi di Sistema templates
                const custPhone = booking.customer_phone || booking.booking_details?.customer?.phone;
                const baseUrl = process.env.URL || 'https://admin.dr7empire.com';
                if (custPhone) {
                    // Mark payment as received so templates render "Pagato" via payment_status
                    const bookingForMsg = { ...booking, payment_status: 'succeeded', payment_method: booking.payment_method || 'Nexi Pay by Link' };
                    await fetch(`${baseUrl}/.netlify/functions/send-whatsapp-notification`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ customPhone: custPhone, booking: bookingForMsg })
                    });
                    console.log('[nexi-payment-callback] Customer confirmation dispatched (template-based)');
                }

                // Admin notification — uses nexi_payment_received_admin template
                await fetch(`${baseUrl}/.netlify/functions/send-whatsapp-notification`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        templateKey: 'nexi_payment_received_admin',
                        templateVars: {
                            '{customer_name}': booking.customer_name || 'N/A',
                            '{amount}': amountEur,
                            '{booking_id}': `DR7-${booking.id.substring(0, 8).toUpperCase()}`,
                            '{vehicle_name}': booking.vehicle_name || 'N/A',
                        },
                    }),
                });

                // Auto-generate contract → then send signing link via WhatsApp
                // Skip for car wash / mechanical bookings — only car rentals get contracts
                const isWashOrMech = booking.service_type === 'car_wash' || booking.service_type === 'mechanical_service' || booking.service_type === 'mechanical' || booking.vehicle_type === 'car_wash' || booking.vehicle_type === 'mechanical' || booking.booking_details?.type === 'car_wash' || booking.booking_details?.type === 'mechanical' || booking.booking_details?.service_type === 'car_wash'
                if (isWashOrMech) {
                    console.log(`[nexi-payment-callback] Skipping contract for non-car booking (type: ${booking.vehicle_type || booking.booking_details?.type})`);
                } else try {
                    const baseUrl = process.env.URL || 'https://admin.dr7empire.com';
                    const contractRes = await fetch(`${baseUrl}/.netlify/functions/generate-contract`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ bookingId: booking.id })
                    });
                    const contractData = await contractRes.json();

                    if (contractRes.ok && contractData.success) {
                        console.log('[nexi-payment-callback] Contract PDF generated:', contractData.url);

                        // Fetch the contract record from DB to get its ID for signature-init
                        const { data: contractRow } = await supabase
                            .from('contracts')
                            .select('id')
                            .eq('booking_id', booking.id)
                            .single();

                        if (contractRow) {
                            // Send signing link to customer via WhatsApp
                            const sigRes = await fetch(`${baseUrl}/.netlify/functions/signature-init`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ contractId: contractRow.id, bookingId: booking.id })
                            });
                            const sigData = await sigRes.json();

                            if (sigRes.ok) {
                                console.log('[nexi-payment-callback] Signing link sent to customer');
                            } else {
                                console.error('[nexi-payment-callback] Signature init failed:', sigData.error);
                            }
                        } else {
                            console.error('[nexi-payment-callback] Contract record not found in DB for booking:', booking.id);
                        }
                    } else {
                        console.error('[nexi-payment-callback] Contract generation failed:', contractData.error || contractData);
                    }
                } catch (contractErr) {
                    console.error('[nexi-payment-callback] Contract/signing error:', contractErr);
                }

                // Auto-generate fattura for paid booking
                try {
                    const adminToken = process.env.ADMIN_API_TOKEN || '';
                    const invRes = await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/generate-invoice-from-booking`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${adminToken}`,
                        },
                        body: JSON.stringify({ bookingId: booking.id, includeIVA: true })
                    });
                    if (invRes.ok) {
                        console.log('[nexi-payment-callback] ✅ Fattura generated for booking:', booking.id);
                    } else {
                        const errData = await invRes.json().catch(() => ({}));
                        console.error('[nexi-payment-callback] ❌ Fattura failed:', invRes.status, errData.error || errData.message);
                    }
                } catch (invErr) {
                    console.error('[nexi-payment-callback] Fattura generation failed:', invErr);
                }

                // ── GLOBAL PREPAID CARD GUARD + CARD BONUS ──────────────────
                const isInitialBooking = paymentPurpose === 'booking'
                const isEligibleService = !booking.service_type || booking.service_type === 'car_rental' || booking.service_type === 'car_wash'
                const paidCents = transaction.amount_cents

                if (paidCents > 0) try {
                    // Detect card type using shared guard (Nexi API + BIN + keywords)
                    const opId = operationId || transactionId
                    const cardCheck = await detectCardType(opId || '', callbackData)

                    const custId = booking.booking_details?.customer?.customerId || booking.booking_details?.customer?.id || booking.booking_details?.customer_id || booking.user_id
                    const custPhone = booking.customer_phone || booking.booking_details?.customer?.phone

                    // Log every card check attempt
                    await logCardAttempt({
                        bookingId: booking.id,
                        customerId: custId,
                        customerName: booking.customer_name,
                        customerEmail: booking.customer_email,
                        cardCheck,
                        operationType: paymentPurpose,
                        nexiOrderId: orderId,
                        nexiOperationId: opId
                    })

                    console.log(`[nexi-payment-callback] Card guard: type=${cardCheck.cardType}, prepaid=${cardCheck.isPrepaid}, method=${cardCheck.detectionMethod}, circuit=${cardCheck.cardCircuit}`)

                    const isPrepagata = cardCheck.isPrepaid
                    const isCredito = cardCheck.cardType === 'credit'
                    const isDebito = cardCheck.cardType === 'debit'

                if (isPrepagata) {
                    // PREPAGATA: void payment + mark as failed
                    console.log(`[nexi-payment-callback] PREPAGATA — voiding payment, refusing booking ${booking.id}`)

                    // Void the payment immediately
                    const refundOpId = operationId || transactionId
                    if (refundOpId) await voidNexiTransaction(refundOpId)

                    await supabase.from('bookings').update({
                        payment_status: 'failed',
                        booking_details: {
                            ...(booking.booking_details || {}),
                            prepaid_card_rejected: true,
                            prepaid_rejected_at: new Date().toISOString()
                        }
                    }).eq('id', booking.id)

                    // Don't continue with bonus — payment refused
                } else if ((isCredito || isDebito) && isInitialBooking && isEligibleService) {
                    // CREDIT WALLET BONUS: credito 6%, debito 3%
                    // Only for initial car rental + lavaggio bookings
                    const percentage = isCredito ? 0.06 : 0.03;
                    const bonusCents = Math.round(paidCents * percentage);
                    const bonusEur = (bonusCents / 100).toFixed(2);
                    const percentLabel = isCredito ? '6%' : '3%';
                    const cardLabel = isCredito ? 'carta di credito' : 'carta di debito';

                    console.log(`[nexi-payment-callback] ${cardLabel} bonus: €${bonusEur} (${percentLabel} of €${amountEur})`);

                    try {
                        // Find user_id for credit wallet (user_credit_balance)
                        let userId = booking.user_id;

                        // If no user_id on booking, look up by email in auth.users
                        if (!userId) {
                            const custEmail = (booking.customer_email || booking.booking_details?.customer?.email || '').toLowerCase().trim();
                            if (custEmail) {
                                const { data: authUsers } = await supabase.auth.admin.listUsers();
                                const matchedUser = authUsers?.users?.find((u: any) =>
                                    u.email?.toLowerCase().trim() === custEmail
                                );
                                if (matchedUser) {
                                    userId = matchedUser.id;
                                    console.log(`[nexi-payment-callback] Found auth user by email: ${custEmail} → ${userId}`);
                                }
                            }
                        }

                        if (userId) {
                            // Get or create credit balance
                            let { data: creditBalance } = await supabase
                                .from('user_credit_balance')
                                .select('user_id, balance')
                                .eq('user_id', userId)
                                .maybeSingle();

                            const currentBalance = creditBalance?.balance ? parseFloat(creditBalance.balance) : 0;
                            const bonusEurNum = bonusCents / 100;
                            const newBalance = Math.round((currentBalance + bonusEurNum) * 100) / 100;

                            if (!creditBalance) {
                                // Create credit balance row
                                await supabase.from('user_credit_balance').insert({
                                    user_id: userId,
                                    balance: newBalance,
                                    last_updated: new Date().toISOString()
                                });
                            } else {
                                // Update existing balance
                                await supabase.from('user_credit_balance').update({
                                    balance: newBalance,
                                    last_updated: new Date().toISOString()
                                }).eq('user_id', userId);
                            }

                            // Record transaction
                            await supabase.from('credit_transactions').insert({
                                user_id: userId,
                                transaction_type: 'credit',
                                amount: bonusEurNum,
                                balance_after: newBalance,
                                description: `Bonus ${percentLabel} pagamento ${cardLabel} - Prenotazione #${booking.id.substring(0, 8).toUpperCase()}`,
                                reference_id: booking.id,
                                reference_type: 'card_bonus'
                            });

                            console.log(`[nexi-payment-callback] Credit wallet bonus: €${bonusEur} added for ${cardLabel}. New balance: €${newBalance.toFixed(2)}`);

                            // Notify customer about bonus
                            if (custPhone) {
                                const custName = booking.customer_name || 'Cliente';
                                const customerMsg = await renderTemplate('wallet_bonus_credit', { custName, bonusEur, cardLabel, percentLabel, newBalance: newBalance.toFixed(2) });
                                if (customerMsg === null) {
                                    console.log('[nexi-payment-callback] Template "wallet_bonus_credit" missing/disabled — skipping send');
                                } else {
                                    await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/send-whatsapp-notification`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            customPhone: custPhone,
                                            customMessage: customerMsg
                                        })
                                    });
                                }
                            }

                            // Notify admin
                            const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || '393457905205';
                            if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                                const adminBonusMsg = await renderTemplate('wallet_bonus_credit_admin', { customer_name: booking.customer_name || '-', cardLabel, bonusEur, percentLabel, newBalance: newBalance.toFixed(2), bookingRef: booking.id.substring(0, 8).toUpperCase() });
                                if (adminBonusMsg === null) {
                                    console.log('[nexi-payment-callback] Template "wallet_bonus_credit_admin" missing/disabled — skipping send');
                                } else {
                                    await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            chatId: `${NOTIFICATION_PHONE}@c.us`,
                                            message: adminBonusMsg
                                        })
                                    });
                                }
                            }
                        } else {
                            console.warn(`[nexi-payment-callback] No auth user found for card bonus. Customer: ${booking.customer_name}, email: ${booking.customer_email}. Bonus of €${bonusEur} NOT applied.`);
                        }
                    } catch (walletErr) {
                        console.error('[nexi-payment-callback] Credit wallet bonus error:', walletErr);
                    }
                }
                } catch (bonusErr) {
                    console.error('[nexi-payment-callback] Card bonus processing error (non-fatal):', bonusErr);
                }
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, status: isSuccess ? 'confirmed' : 'failed' })
        };

    } catch (error: any) {
        console.error('[nexi-payment-callback] Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};

export { handler };
