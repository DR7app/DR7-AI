import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
        console.log('[nexi-preauth-callback] Method:', event.httpMethod);
        console.log('[nexi-preauth-callback] Body:', event.body);
        console.log('[nexi-preauth-callback] Query:', JSON.stringify(event.queryStringParameters));
        console.log('[nexi-preauth-callback] Headers content-type:', event.headers['content-type']);

        // Parse callback data — Nexi may send as POST JSON, POST form-urlencoded, or GET with query params
        let callbackData: any;

        if (event.queryStringParameters && Object.keys(event.queryStringParameters).length > 0) {
            // GET request with query params
            callbackData = event.queryStringParameters;
        } else if (event.headers['content-type']?.includes('application/json')) {
            callbackData = JSON.parse(event.body || '{}');
        } else if (event.body) {
            // Try JSON first, then URL-encoded
            try {
                callbackData = JSON.parse(event.body);
            } catch {
                const params = new URLSearchParams(event.body);
                callbackData = Object.fromEntries(params.entries());
            }
        } else {
            callbackData = {};
        }

        console.log('[nexi-preauth-callback] Parsed callbackData keys:', Object.keys(callbackData));

        // Nexi Pay-by-Link v2 sends nested format: { operation: { orderId, operationResult, ... } }
        // Nexi hosted payment sends flat format: { orderId, result, resultCode, ... }
        const op = callbackData.operation || {};
        const orderId = callbackData.orderId || op.orderId;
        const operationId = callbackData.operationId || op.operationId;
        const transactionId = callbackData.transactionId || op.paymentEndToEndId;
        const result = callbackData.result || op.operationResult;
        const resultCode = callbackData.resultCode;
        const authorizationCode = callbackData.authorizationCode || op.additionalData?.authorizationCode;
        const contractId = callbackData.contractId || op.additionalData?.contractId;
        const amount = callbackData.amount || op.operationAmount;
        const currency = callbackData.currency || op.operationCurrency;

        console.log('[nexi-preauth-callback] Parsed:', { orderId, operationId, result, resultCode, authorizationCode, contractId, raw_keys: Object.keys(callbackData), raw_op_keys: Object.keys(op) });

        if (!orderId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing orderId' })
            };
        }

        // Find cauzione by nexi_order_id
        const { data: cauzione, error: findError } = await supabase
            .from('cauzioni')
            .select('id')
            .eq('nexi_order_id', orderId)
            .single();

        if (findError || !cauzione) {
            console.error('Cauzione not found for order:', orderId);
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Cauzione not found' })
            };
        }

        // Update cauzione based on result
        const isSuccess = result === 'OK' || result === 'AUTHORIZED' || result === 'EXECUTED' || resultCode === '00';

        const updateData: any = {
            updated_at: new Date().toISOString()
        };

        if (isSuccess) {
            updateData.nexi_transaction_id = transactionId || operationId;
            // Store contractId from Nexi response (or derive from orderId)
            if (contractId) {
                updateData.nexi_contract_id = contractId;
            }
            updateData.note = `Preautorizzazione completata - Auth: ${authorizationCode || operationId}${contractId ? ` - Carta registrata (${contractId})` : ''}`;
            // Keep stato as 'Attiva' - ready for SBLOCCA or INCASSA
        } else {
            updateData.note = `Preautorizzazione fallita - ${result || resultCode}`;
        }

        const { error: updateError } = await supabase
            .from('cauzioni')
            .update(updateData)
            .eq('id', cauzione.id);

        if (updateError) {
            console.error('Error updating cauzione:', updateError);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Failed to update cauzione' })
            };
        }

        console.log('Cauzione updated successfully:', cauzione.id);

        // Save contractId to customer for future MIT charges
        if (isSuccess && contractId) {
            try {
                // Get booking from cauzione to find customer
                const { data: cauzioneFull } = await supabase
                    .from('cauzioni')
                    .select('riferimento_contratto_id')
                    .eq('id', cauzione.id)
                    .single();

                if (cauzioneFull?.riferimento_contratto_id) {
                    const { data: booking } = await supabase
                        .from('bookings')
                        .select('customer_email, booking_details')
                        .eq('id', cauzioneFull.riferimento_contratto_id)
                        .single();

                    if (booking) {
                        const custId = booking.booking_details?.customer?.customerId || booking.booking_details?.customer?.id || booking.booking_details?.customer_id;
                        const custEmail = (booking.customer_email || booking.booking_details?.customer?.email || '').toLowerCase().trim();

                        let saved = false;
                        if (custId) {
                            const { data: cust } = await supabase.from('customers_extended').select('id, metadata').eq('id', custId).maybeSingle();
                            if (cust) {
                                await supabase.from('customers_extended').update({
                                    metadata: { ...(cust.metadata || {}), nexi_contract_id: contractId, nexi_contract_updated: new Date().toISOString() },
                                    updated_at: new Date().toISOString()
                                }).eq('id', cust.id);
                                saved = true;
                                console.log(`[nexi-preauth-callback] Saved contractId ${contractId} on customer ${cust.id}`);
                            }
                        }
                        if (!saved && custEmail) {
                            const { data: custByEmail } = await supabase.from('customers_extended').select('id, metadata').eq('email', custEmail).maybeSingle();
                            if (custByEmail) {
                                await supabase.from('customers_extended').update({
                                    metadata: { ...(custByEmail.metadata || {}), nexi_contract_id: contractId, nexi_contract_updated: new Date().toISOString() },
                                    updated_at: new Date().toISOString()
                                }).eq('id', custByEmail.id);
                                console.log(`[nexi-preauth-callback] Saved contractId ${contractId} on customer ${custByEmail.id} (by email)`);
                            }
                        }
                    }
                }
            } catch (custErr) {
                console.error('[nexi-preauth-callback] Error saving contractId to customer:', custErr);
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true })
        };

    } catch (error: any) {
        console.error('Error processing callback:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};

export { handler };
