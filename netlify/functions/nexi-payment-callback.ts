import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
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
        const contractId = callbackData.contractId;

        console.log('[nexi-payment-callback] Parsed:', { orderId, result, resultCode, authorizationCode, operationId, raw_keys: Object.keys(callbackData) });

        if (!orderId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing orderId' }) };
        }

        const isSuccess = result === 'OK' || result === 'AUTHORIZED' || result === 'EXECUTED' || resultCode === '00';

        // Find the nexi_transaction by order_id
        const { data: transaction } = await supabase
            .from('nexi_transactions')
            .select('id, booking_id, amount_cents, customer_email, contract_id')
            .eq('order_id', orderId)
            .single();

        if (!transaction) {
            console.error('[nexi-payment-callback] Transaction not found for order:', orderId);
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'Transaction not found' }) };
        }

        // Update transaction status
        await supabase.from('nexi_transactions').update({
            status: isSuccess ? 'completed' : 'failed',
            transaction_id: transactionId || operationId || null,
            contract_id: contractId || transaction.contract_id,
            metadata: {
                callback_result: result,
                result_code: resultCode,
                authorization_code: authorizationCode,
                operation_id: operationId,
                contract_id: contractId
            },
            updated_at: new Date().toISOString()
        }).eq('id', transaction.id);

        // If payment succeeded and linked to a booking, CONFIRM the booking
        if (isSuccess && transaction.booking_id) {
            const { data: booking } = await supabase
                .from('bookings')
                .select('id, customer_name, customer_phone, customer_email, vehicle_name, vehicle_type, payment_method, booking_details, price_total')
                .eq('id', transaction.booking_id)
                .single();

            if (booking) {
                const amountEur = (transaction.amount_cents / 100).toFixed(2);

                // Confirm the booking
                await supabase.from('bookings').update({
                    payment_status: 'paid',
                    status: 'confirmed',
                    amount_paid: transaction.amount_cents,
                    booking_details: {
                        ...booking.booking_details,
                        nexi_transaction_id: transactionId || operationId,
                        nexi_contract_id: contractId,
                        nexi_paid_at: new Date().toISOString(),
                        paymentStatus: 'paid'
                    }
                }).eq('id', booking.id);

                console.log(`[nexi-payment-callback] Booking ${booking.id} confirmed — €${amountEur} paid`);

                // Send WhatsApp confirmation to customer (through send-whatsapp-notification for Rentora wrapper)
                const custPhone = booking.customer_phone || booking.booking_details?.customer?.phone;
                if (custPhone) {
                    const custName = booking.customer_name || booking.booking_details?.customer?.fullName || 'Cliente';
                    const bookingRef = booking.id.substring(0, 8).toUpperCase();

                    await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/send-whatsapp-notification`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            customPhone: custPhone,
                            customMessage: `✅ *Pagamento ricevuto!*\n\nGentile ${custName},\n\nIl pagamento di *€${amountEur}* per la prenotazione #${bookingRef} è stato confermato.\n\nLa sua prenotazione è ora *CONFERMATA*.\n\nGrazie,\nDR7`
                        })
                    });
                    console.log('[nexi-payment-callback] WhatsApp confirmation sent to customer');
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
                const isWashOrMech = booking.vehicle_type === 'car_wash' || booking.vehicle_type === 'mechanical' || booking.booking_details?.type === 'car_wash' || booking.booking_details?.type === 'mechanical'
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
