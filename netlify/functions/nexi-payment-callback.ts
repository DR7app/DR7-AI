import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { detectCardType, logCardAttempt, voidNexiTransaction, cancelBooking, notifyPrepaidBlocked } from './prepaid-card-guard';

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
        const contractId = callbackData.contractId || op.additionalData?.contractId || orderId;
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
            if (now > expiresAt) {
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

        console.log(`[nexi-payment-callback] Payment purpose: ${paymentPurpose}, isDanniPenali: ${isDanniPenali}, isExtension: ${isExtension}`);

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

                // Mark matching danni/penali entries as paid
                let updated = false;
                const arrayKeys = paymentPurpose === 'danni' ? ['danni'] : paymentPurpose === 'penali' ? ['penalties'] : ['danni', 'penalties'];
                for (const key of arrayKeys) {
                    const items = details[key] || [];
                    for (const item of items) {
                        if (item.paymentStatus === 'nexi_pay_by_link' || item.paymentStatus === 'pending' || !item.paymentStatus) {
                            item.paymentStatus = 'paid';
                            item.paymentMethod = 'Nexi Pay by Link';
                            item.amountPaid = item.total || (item.amount || 0) * (item.quantity || 1);
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

                // Generate penalty/danni fattura
                try {
                    const custId = details.customer?.customerId || details.customer?.id || details.customer_id;
                    const allItems: { label: string; amount: number; quantity: number }[] = [];
                    for (const key of arrayKeys) {
                        for (const item of (details[key] || [])) {
                            if (item.paidAt === new Date().toISOString().split('T')[0] || item.paymentMethod === 'Nexi Pay by Link') {
                                allItems.push({ label: item.label || (key === 'danni' ? 'Danno' : 'Penale'), amount: item.amount || item.total || 0, quantity: item.quantity || 1 });
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
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            bookingId: booking.id,
                            customerId: custId,
                            items: allItems,
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
                    await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/send-whatsapp-notification`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            customPhone: custPhone,
                            customMessage: `Gentile ${custName},\n\nConfermiamo la ricezione del pagamento di €${amountEur} per ${paymentPurpose === 'danni' ? 'danni' : paymentPurpose === 'penali' ? 'penali' : 'danni/penali'}.\n\nGrazie,\nDR7`
                        })
                    });
                }

                // Admin notification
                const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || '393457905205';
                if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                    await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chatId: `${NOTIFICATION_PHONE}@c.us`,
                            message: `💰 *PAGAMENTO ${paymentPurpose.toUpperCase()} RICEVUTO*\n\n*Cliente:* ${booking.customer_name}\n*Importo:* €${amountEur}\n*Tipo:* ${paymentPurpose}\n\nFattura generata automaticamente.`
                        })
                    });
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
                        headers: { 'Content-Type': 'application/json' },
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
                    await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/send-whatsapp-notification`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            customPhone: custPhone,
                            customMessage: `Gentile ${custName},\n\nConfermiamo la ricezione del pagamento di €${amountEur} per l'estensione del noleggio.\n\nGrazie,\nDR7`
                        })
                    });
                }

                // Admin notification
                const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || '393457905205';
                if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                    await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chatId: `${NOTIFICATION_PHONE}@c.us`,
                            message: `💰 *PAGAMENTO ESTENSIONE RICEVUTO*\n\n*Cliente:* ${booking.customer_name}\n*Importo:* €${amountEur}\n*Veicolo:* ${booking.vehicle_name || 'N/A'}\n\nFattura estensione generata automaticamente.`
                        })
                    });
                }
            }

            // NO contract, NO booking re-confirmation — just extension
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, status: 'extension_paid' }) };
        }

        // ── REGULAR BOOKING PAYMENT ───────────────────────────────────────
        if (isSuccess && transaction.booking_id) {
            const { data: booking } = await supabase
                .from('bookings')
                .select('id, user_id, customer_name, customer_phone, customer_email, vehicle_name, vehicle_type, service_type, payment_method, booking_details, price_total, pickup_date, dropoff_date, pickup_location, dropoff_location, deposit_amount, km_overage_fee, status, payment_status')
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
                    // Still confirm (payment was authorized) but log the discrepancy for manual review
                }

                // Confirm the booking — CONDITIONAL UPDATE for safety
                const { data: confirmedRows } = await supabase.from('bookings').update({
                    payment_status: 'paid',
                    status: 'confirmed',
                    paid_at: paidAt,
                    amount_paid: transaction.amount_cents,
                    expired_at: null,  // Clear expiry if it was set by the cron job
                    booking_details: {
                        ...booking.booking_details,
                        nexi_transaction_id: transactionId || operationId,
                        nexi_contract_id: contractId,
                        nexi_paid_at: paidAt,
                        paymentStatus: 'paid'
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

                // Send full booking confirmation to customer via WhatsApp
                const custPhone = booking.customer_phone || booking.booking_details?.customer?.phone;
                if (custPhone) {
                    const custName = booking.customer_name || booking.booking_details?.customer?.fullName || 'Cliente';
                    const custFirstName = custName.split(' ')[0] || 'Cliente';
                    const bookingRef = booking.id.substring(0, 8).toUpperCase();
                    const totalEur = booking.price_total ? (booking.price_total / 100).toFixed(2) : amountEur;

                    // Format dates in Rome timezone
                    const fmtDate = (d: string) => new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' });
                    const fmtTime = (d: string) => new Date(d).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' });

                    let custMsg = '';

                    // Detect car wash / mechanical
                    const isCarWashBooking = booking.service_type === 'car_wash' || booking.booking_details?.service_type === 'car_wash' || booking.booking_details?.type === 'car_wash';
                    const isMechBooking = booking.service_type === 'mechanical_service' || booking.service_type === 'mechanical';

                    if (isCarWashBooking) {
                        // Car wash confirmation
                        const serviceName = booking.booking_details?.serviceName || booking.vehicle_name || 'Autolavaggio';
                        const apptDate = booking.pickup_date || booking.booking_details?.appointment_date;
                        const fmtApptDate = apptDate ? new Date(apptDate).toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' }) : '';
                        const fmtApptTime = apptDate ? new Date(apptDate).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' }) : '';

                        const vehiclePlate = booking.booking_details?.vehicle_plate || booking.booking_details?.vehicle?.plate || '';
                        custMsg = ``;
                        custMsg += `Salve ${custFirstName},\n\nConfermiamo il suo appuntamento.\n\n`;
                        custMsg += `*NUOVA PRENOTAZIONE AUTOLAVAGGIO*\n\n`;
                        custMsg += `*ID:* DR7-${bookingRef}\n`;
                        custMsg += `*Servizio:* ${serviceName}\n`;
                        if (vehiclePlate) custMsg += `*Targa:* ${vehiclePlate}\n`;
                        if (fmtApptDate) custMsg += `*Data e Ora:* ${fmtApptDate} alle ${fmtApptTime}\n`;
                        custMsg += `*Totale:* €${totalEur}\n`;
                        custMsg += `*Pagamento:* Pagato\n`;
                        if (booking.booking_details?.notes) custMsg += `*Note:* ${booking.booking_details.notes}\n`;
                        custMsg += `\nCordiali Saluti,\nDR7\n\nSe questo messaggio non era destinato a lei, oppure lo ha già ricevuto in precedenza, può semplicemente ignorarlo.`;
                    } else if (isMechBooking) {
                        // Mechanical confirmation (simple)
                        custMsg = `Salve ${custFirstName},\n\nConfermiamo il pagamento per il servizio meccanico.\n\n`;
                        custMsg += `*ID:* DR7-${bookingRef}\n`;
                        custMsg += `*Totale:* €${totalEur}\n`;
                        custMsg += `*Pagamento:* Pagato\n`;
                        custMsg += `\nCordiali Saluti,\nDR7`;
                    } else {
                        // Car rental confirmation
                        const pickupLabel = booking.pickup_location === 'dr7_office' ? 'DR7 Office' : (booking.booking_details?.delivery_address ? `${booking.booking_details.delivery_address.street}, ${booking.booking_details.delivery_address.city}` : booking.pickup_location || 'DR7 Office');

                        const unlimitedKm = booking.booking_details?.unlimited_km;
                        const kmLimit = booking.booking_details?.km_limit;
                        let kmLabel = '-';
                        if (unlimitedKm || kmLimit === 'Illimitati') {
                            kmLabel = 'Illimitati';
                        } else if (kmLimit) {
                            kmLabel = `${kmLimit} km`;
                        }

                        const depositEur = booking.deposit_amount ? (booking.deposit_amount / 100).toFixed(2) : (booking.booking_details?.deposit || '0');
                        const depositStatus = booking.booking_details?.deposit_status === 'incassata' ? 'Pagata' : 'Da saldare';
                        const depositLabel = parseFloat(String(depositEur)) > 0 ? `€${depositEur} (${depositStatus})` : '€0';

                        const insMap: Record<string, string> = { 'KASKO': 'Kasko', 'KASKO_BASE': 'Kasko Base', 'KASKO_BLACK': 'Kasko Black', 'KASKO_SIGNATURE': 'Kasko Signature', 'DR7': 'Kasko DR7' };
                        const insuranceLabel = insMap[booking.booking_details?.insuranceOption || ''] || 'Kasko Base';

                        custMsg = `Salve ${custFirstName},\n\nConfermiamo la sua prenotazione.\n\n`;
                        custMsg += `*NUOVA PRENOTAZIONE NOLEGGIO*\n\n`;
                        custMsg += `*ID:* DR7-${bookingRef}\n`;
                        custMsg += `*Veicolo:* ${booking.vehicle_name || 'N/A'}\n`;
                        custMsg += `*Ritiro:* ${fmtDate(booking.pickup_date)} alle ${fmtTime(booking.pickup_date)}\n`;
                        custMsg += `*Riconsegna:* ${fmtDate(booking.dropoff_date)} alle ${fmtTime(booking.dropoff_date)}\n`;
                        custMsg += `*Luogo ritiro:* ${pickupLabel}\n`;
                        custMsg += `*Assicurazione:* ${insuranceLabel}\n`;
                        custMsg += `*Totale:* €${totalEur}\n`;
                        custMsg += `*Cauzione:* ${depositLabel}\n`;
                        custMsg += `*KM:* ${kmLabel}\n`;
                        custMsg += `*Pagamento:* Pagato (Nexi Pay by Link)\n`;
                        if (booking.booking_details?.notes) custMsg += `*Note:* ${booking.booking_details.notes}\n`;
                        custMsg += `\nCordiali Saluti,\nDR7`;
                    }

                    await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/send-whatsapp-notification`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            customPhone: custPhone,
                            customMessage: custMsg
                        })
                    });
                    console.log('[nexi-payment-callback] WhatsApp booking confirmation sent to customer');
                }

                // Send admin notification
                const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || '393457905205';
                if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                    await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chatId: `${NOTIFICATION_PHONE}@c.us`,
                            message: `💰 *PAGAMENTO NEXI RICEVUTO*\n\n*Cliente:* ${booking.customer_name}\n*Importo:* €${amountEur}\n*Prenotazione:* #${booking.id.substring(0, 8).toUpperCase()}\n*Veicolo:* ${booking.vehicle_name || 'N/A'}\n\nPrenotazione confermata automaticamente.`
                        })
                    });
                }

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
                    await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/generate-invoice-from-booking`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ bookingId: booking.id, includeIVA: true })
                    });
                    console.log('[nexi-payment-callback] Fattura generated for booking:', booking.id);
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
                    // PREPAGATA BLOCKED: cancel + refund + notify (using shared guard)
                    console.log(`[nexi-payment-callback] PREPAGATA BLOCKED — cancelling booking ${booking.id}`)

                    await cancelBooking(booking.id, 'Carta prepagata non accettata')

                    const refundOpId = operationId || transactionId
                    if (refundOpId) await voidNexiTransaction(refundOpId)

                    await notifyPrepaidBlocked({
                        customerPhone: custPhone,
                        customerName: booking.customer_name,
                        bookingRef: booking.id.substring(0, 8).toUpperCase(),
                        amount: amountEur
                    })

                    // Don't continue with bonus — booking is cancelled
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
                                await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/send-whatsapp-notification`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        customPhone: custPhone,
                                        customMessage: `Gentile ${custName},\n\nHa ricevuto *€${bonusEur}* di credito sul suo wallet DR7 grazie al pagamento con ${cardLabel} (${percentLabel}).\n\nSaldo attuale: *€${newBalance.toFixed(2)}*\n\nIl credito è spendibile direttamente sul sito per le prossime prenotazioni.\n\nGrazie per la collaborazione.\n\nDR7`
                                    })
                                });
                            }

                            // Notify admin
                            const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || '393457905205';
                            if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                                await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        chatId: `${NOTIFICATION_PHONE}@c.us`,
                                        message: `*BONUS CARTA ACCREDITATO*\n\n*Cliente:* ${booking.customer_name || '-'}\n*Carta:* ${cardLabel}\n*Bonus:* €${bonusEur} (${percentLabel})\n*Nuovo saldo wallet:* €${newBalance.toFixed(2)}\n*Prenotazione:* #${booking.id.substring(0, 8).toUpperCase()}`
                                    })
                                });
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
