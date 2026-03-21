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
                contract_id: contractId,
                payment_circuit: paymentCircuit,
                payment_instrument: paymentInstrument
            },
            updated_at: new Date().toISOString()
        }).eq('id', transaction.id);

        // If payment succeeded and linked to a booking, CONFIRM the booking
        if (isSuccess && transaction.booking_id) {
            const { data: booking } = await supabase
                .from('bookings')
                .select('id, customer_name, customer_phone, customer_email, vehicle_name, vehicle_type, payment_method, booking_details, price_total, pickup_date, dropoff_date, pickup_location, dropoff_location, deposit_amount, km_overage_fee')
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

                // Store contractId on customer for future MIT charges
                if (contractId) {
                    const custId = booking.booking_details?.customer?.customerId || booking.booking_details?.customer?.id || booking.booking_details?.customer_id;
                    if (custId) {
                        await supabase.from('customers_extended').update({
                            nexi_contract_id: contractId,
                            updated_at: new Date().toISOString()
                        }).eq('id', custId);
                        console.log(`[nexi-payment-callback] Saved contractId ${contractId} on customer ${custId}`);
                    }
                }

                // Send full booking confirmation to customer via WhatsApp
                const custPhone = booking.customer_phone || booking.booking_details?.customer?.phone;
                if (custPhone) {
                    const custName = booking.customer_name || booking.booking_details?.customer?.fullName || 'Cliente';
                    const custFirstName = custName.split(' ')[0] || 'Cliente';
                    const bookingRef = booking.id.substring(0, 8).toUpperCase();

                    // Format dates in Rome timezone
                    const fmtDate = (d: string) => new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' });
                    const fmtTime = (d: string) => new Date(d).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' });

                    const pickupLabel = booking.pickup_location === 'dr7_office' ? 'DR7 Office' : (booking.booking_details?.delivery_address ? `${booking.booking_details.delivery_address.street}, ${booking.booking_details.delivery_address.city}` : booking.pickup_location || 'DR7 Office');

                    // KM info
                    const unlimitedKm = booking.booking_details?.unlimited_km;
                    const kmLimit = booking.booking_details?.km_limit;
                    let kmLabel = '-';
                    if (unlimitedKm || kmLimit === 'Illimitati') {
                        kmLabel = 'Illimitati';
                    } else if (kmLimit) {
                        kmLabel = `${kmLimit} km`;
                    }

                    // Deposit
                    const depositEur = booking.deposit_amount ? (booking.deposit_amount / 100).toFixed(2) : (booking.booking_details?.deposit || '0');
                    const depositStatus = booking.booking_details?.deposit_status === 'incassata' ? 'Pagata' : 'Da saldare';
                    const depositLabel = parseFloat(String(depositEur)) > 0 ? `€${depositEur} (${depositStatus})` : '€0';

                    // Insurance
                    const insMap: Record<string, string> = { 'KASKO': 'Kasko', 'KASKO_BASE': 'Kasko Base', 'KASKO_BLACK': 'Kasko Black', 'KASKO_SIGNATURE': 'Kasko Signature', 'DR7': 'Kasko DR7' };
                    const insuranceLabel = insMap[booking.booking_details?.insuranceOption || ''] || 'Kasko Base';

                    const totalEur = booking.price_total ? (booking.price_total / 100).toFixed(2) : amountEur;

                    let custMsg = `Salve ${custFirstName},\n\nConfermiamo la sua prenotazione.\n\n`;
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

                // ── Card type bonus/surcharge ──────────────────────────────
                // Detect card type from Nexi callback data
                const cardType = (paymentCircuit || '').toLowerCase()
                const rawCardType = JSON.stringify(callbackData).toLowerCase()
                const isPrepagata = rawCardType.includes('prepagat') || rawCardType.includes('prepaid')
                const isCredito = rawCardType.includes('credito') || rawCardType.includes('credit')
                const isDebito = rawCardType.includes('debito') || rawCardType.includes('debit')

                console.log(`[nexi-payment-callback] Card type detection: circuit=${paymentCircuit}, prepagata=${isPrepagata}, credito=${isCredito}, debito=${isDebito}`)

                const custId = booking.booking_details?.customer?.customerId || booking.booking_details?.customer?.id || booking.booking_details?.customer_id || booking.user_id;
                const paidCents = transaction.amount_cents;

                if (isPrepagata && contractId && paidCents > 0) {
                    // PREPAGATA: charge 10% surcharge via MIT
                    const surchargeCents = Math.round(paidCents * 0.10);
                    const surchargeEur = (surchargeCents / 100).toFixed(2);
                    console.log(`[nexi-payment-callback] Prepagata surcharge: €${surchargeEur} (10% of €${amountEur})`);

                    try {
                        const baseUrl = process.env.URL || 'https://admin.dr7empire.com';
                        const mitRes = await fetch(`${baseUrl}/.netlify/functions/nexi-charge-mit`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contractId: contractId,
                                amount: surchargeCents / 100,
                                description: `Supplemento carta prepagata 10% - Prenotazione #${booking.id.substring(0, 8).toUpperCase()}`,
                                bookingId: booking.id,
                                customerEmail: booking.customer_email || '',
                                customerName: booking.customer_name || ''
                            })
                        });
                        const mitData = await mitRes.json();
                        if (mitRes.ok && mitData.success) {
                            console.log(`[nexi-payment-callback] ✅ Prepagata surcharge €${surchargeEur} charged`);
                        } else {
                            console.error(`[nexi-payment-callback] ❌ Prepagata surcharge failed:`, mitData.error);
                        }
                    } catch (mitErr) {
                        console.error('[nexi-payment-callback] Prepagata surcharge error:', mitErr);
                    }

                } else if ((isCredito || isDebito) && custId && paidCents > 0) {
                    // CREDITO: 10% wallet credit, DEBITO: 5% wallet credit
                    const percentage = isCredito ? 0.10 : 0.05;
                    const bonusCents = Math.round(paidCents * percentage);
                    const bonusEur = (bonusCents / 100).toFixed(2);
                    const percentLabel = isCredito ? '10%' : '5%';
                    const cardLabel = isCredito ? 'carta di credito' : 'carta di debito';

                    console.log(`[nexi-payment-callback] ${cardLabel} bonus: €${bonusEur} (${percentLabel} of €${amountEur})`);

                    try {
                        // Find or create wallet
                        let { data: wallet } = await supabase
                            .from('customer_wallets')
                            .select('id, balance_cents, total_earned_cents')
                            .eq('customer_id', custId)
                            .maybeSingle();

                        if (!wallet) {
                            const { data: newWallet } = await supabase
                                .from('customer_wallets')
                                .insert({
                                    customer_id: custId,
                                    balance_cents: 0,
                                    total_earned_cents: 0,
                                    total_spent_cents: 0,
                                    total_topped_up_cents: 0
                                })
                                .select()
                                .single();
                            wallet = newWallet;
                        }

                        if (wallet) {
                            const newBalance = wallet.balance_cents + bonusCents;

                            // Add wallet transaction
                            await supabase.from('wallet_transactions').insert({
                                wallet_id: wallet.id,
                                type: 'nexi_card_bonus',
                                amount_cents: bonusCents,
                                balance_after_cents: newBalance,
                                description: `Bonus ${percentLabel} pagamento ${cardLabel} - Prenotazione #${booking.id.substring(0, 8).toUpperCase()}`
                            });

                            // Update wallet balance
                            await supabase.from('customer_wallets').update({
                                balance_cents: newBalance,
                                total_earned_cents: wallet.total_earned_cents + bonusCents,
                                updated_at: new Date().toISOString()
                            }).eq('id', wallet.id);

                            console.log(`[nexi-payment-callback] ✅ Wallet credited €${bonusEur} for ${cardLabel}`);

                            // Notify customer about bonus
                            if (custPhone) {
                                const custName = booking.customer_name || 'Cliente';
                                await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/send-whatsapp-notification`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        customPhone: custPhone,
                                        customMessage: `🎁 *Bonus pagamento!*\n\nGentile ${custName},\n\nHai ricevuto *€${bonusEur}* di credito sul tuo wallet DR7 grazie al pagamento con ${cardLabel}.\n\nSaldo attuale: *€${(newBalance / 100).toFixed(2)}*\n\nGrazie,\nDR7`
                                    })
                                });
                            }
                        }
                    } catch (walletErr) {
                        console.error('[nexi-payment-callback] Wallet bonus error:', walletErr);
                    }
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
