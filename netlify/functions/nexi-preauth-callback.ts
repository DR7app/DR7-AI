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
        console.log('Nexi pre-auth callback received:', event.body);

        // Parse callback data (Nexi sends as form-urlencoded or JSON)
        let callbackData: any;

        if (event.headers['content-type']?.includes('application/json')) {
            callbackData = JSON.parse(event.body || '{}');
        } else {
            // Parse URL-encoded form data
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
            amount,
            currency,
            contractId
        } = callbackData;

        console.log('Parsed callback data:', { orderId, operationId, result, authorizationCode });

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
                    .select('booking_id')
                    .eq('id', cauzione.id)
                    .single();

                if (cauzioneFull?.booking_id) {
                    const { data: booking } = await supabase
                        .from('bookings')
                        .select('customer_email, booking_details')
                        .eq('id', cauzioneFull.booking_id)
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
