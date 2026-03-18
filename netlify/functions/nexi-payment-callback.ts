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

        const {
            orderId,
            operationId,
            transactionId,
            result,
            resultCode,
            authorizationCode,
            contractId
        } = callbackData;

        console.log('[nexi-payment-callback] Parsed:', { orderId, result, resultCode, authorizationCode, contractId });

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
                .select('id, customer_name, customer_phone, customer_email, vehicle_name, payment_method, booking_details, price_total')
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

                // Send WhatsApp confirmation to customer
                const custPhone = booking.customer_phone || booking.booking_details?.customer?.phone;
                if (custPhone && GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                    let cleanPhone = custPhone.replace(/[\s\-\+\(\)]/g, '');
                    if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2);
                    if (cleanPhone.length === 10) cleanPhone = '39' + cleanPhone;

                    const custName = booking.customer_name || booking.booking_details?.customer?.fullName || 'Cliente';

                    await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chatId: `${cleanPhone}@c.us`,
                            message: `✅ *Pagamento ricevuto!*\n\nGentile ${custName},\n\nIl pagamento di *€${amountEur}* per la prenotazione #${booking.id.substring(0, 8).toUpperCase()} è stato confermato.\n\nLa sua prenotazione è ora *CONFERMATA*.\n\nGrazie,\nDR7 Empire`
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

                // Auto-generate fattura for paid booking
                try {
                    await fetch(`${process.env.URL || 'https://dr7admin.netlify.app'}/.netlify/functions/generate-invoice-from-booking`, {
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
