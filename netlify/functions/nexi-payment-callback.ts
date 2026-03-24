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
            .select('id, booking_id, amount_cents, customer_email, contract_id, metadata, description')
            .eq('order_id', orderId)
            .single();

        if (!transaction) {
            console.error('[nexi-payment-callback] Transaction not found for order:', orderId);
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'Transaction not found' }) };
        }

        // Detect payment purpose from metadata or description
        const paymentPurpose = transaction.metadata?.payment_purpose
            || (transaction.description?.toLowerCase().startsWith('danni') ? 'danni' : null)
            || (transaction.description?.toLowerCase().startsWith('penali') ? 'penali' : null)
            || 'booking';
        const isDanniPenali = paymentPurpose === 'danni' || paymentPurpose === 'penali' || paymentPurpose === 'danni_penali';

        console.log(`[nexi-payment-callback] Payment purpose: ${paymentPurpose}, isDanniPenali: ${isDanniPenali}`);

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

        // ── REGULAR BOOKING PAYMENT ───────────────────────────────────────
        if (isSuccess && transaction.booking_id) {
            const { data: booking } = await supabase
                .from('bookings')
                .select('id, user_id, customer_name, customer_phone, customer_email, vehicle_name, vehicle_type, service_type, payment_method, booking_details, price_total, pickup_date, dropoff_date, pickup_location, dropoff_location, deposit_amount, km_overage_fee')
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
                    // Try by customer ID first
                    const custId = booking.booking_details?.customer?.customerId || booking.booking_details?.customer?.id || booking.booking_details?.customer_id;
                    const custEmail = (booking.customer_email || booking.booking_details?.customer?.email || transaction.customer_email || '').toLowerCase().trim();

                    let savedOnCustomer = false;

                    if (custId) {
                        const { data: cust } = await supabase.from('customers_extended').select('id, metadata').eq('id', custId).maybeSingle();
                        if (cust) {
                            await supabase.from('customers_extended').update({
                                metadata: { ...(cust.metadata || {}), nexi_contract_id: contractId, nexi_contract_updated: new Date().toISOString() },
                                updated_at: new Date().toISOString()
                            }).eq('id', cust.id);
                            savedOnCustomer = true;
                            console.log(`[nexi-payment-callback] Saved contractId ${contractId} on customer ${cust.id} (by ID)`);
                        }
                    }

                    // Fallback: lookup by email
                    if (!savedOnCustomer && custEmail) {
                        const { data: custByEmail } = await supabase.from('customers_extended').select('id, metadata').eq('email', custEmail).maybeSingle();
                        if (custByEmail) {
                            await supabase.from('customers_extended').update({
                                metadata: { ...(custByEmail.metadata || {}), nexi_contract_id: contractId, nexi_contract_updated: new Date().toISOString() },
                                updated_at: new Date().toISOString()
                            }).eq('id', custByEmail.id);
                            savedOnCustomer = true;
                            console.log(`[nexi-payment-callback] Saved contractId ${contractId} on customer ${custByEmail.id} (by email: ${custEmail})`);
                        }
                    }

                    if (!savedOnCustomer) {
                        console.warn(`[nexi-payment-callback] Could not find customer to save contractId. custId=${custId}, email=${custEmail}`);
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
                        custMsg = `MESSAGGIO AUTOMATICO GENERATO DA RENTORA\nQuesto messaggio è stato inviato tramite il sistema automatizzato sviluppato da Rentora.\n\n`;
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

                // ── Card type bonus/surcharge ──────────────────────────────
                // Only for INITIAL bookings (car rental + lavaggio), NOT extensions
                const isInitialBooking = paymentPurpose === 'booking'
                const isEligibleService = !booking.service_type
                    || booking.service_type === 'car_rental'
                    || booking.service_type === 'car_wash'

                // Detect card type from Nexi callback data
                const rawCardType = JSON.stringify(callbackData).toLowerCase()
                const isPrepagata = rawCardType.includes('prepagat') || rawCardType.includes('prepaid')
                const isCredito = rawCardType.includes('credito') || rawCardType.includes('credit')
                const isDebito = rawCardType.includes('debito') || rawCardType.includes('debit')

                console.log(`[nexi-payment-callback] Card type detection: circuit=${paymentCircuit}, prepagata=${isPrepagata}, credito=${isCredito}, debito=${isDebito}, isInitialBooking=${isInitialBooking}, isEligibleService=${isEligibleService}`)

                const paidCents = transaction.amount_cents;

                if (isPrepagata && contractId && paidCents > 0) {
                    // PREPAGATA: charge 20% surcharge via MIT
                    const surchargeCents = Math.round(paidCents * 0.20);
                    const surchargeEur = (surchargeCents / 100).toFixed(2);
                    console.log(`[nexi-payment-callback] Prepagata surcharge: €${surchargeEur} (20% of €${amountEur})`);

                    try {
                        const baseUrl = process.env.URL || 'https://admin.dr7empire.com';
                        const mitRes = await fetch(`${baseUrl}/.netlify/functions/nexi-charge-mit`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contractId: contractId,
                                amount: surchargeCents / 100,
                                description: `Supplemento carta prepagata 20% - Prenotazione #${booking.id.substring(0, 8).toUpperCase()}`,
                                bookingId: booking.id,
                                customerEmail: booking.customer_email || '',
                                customerName: booking.customer_name || ''
                            })
                        });
                        const mitData = await mitRes.json();
                        if (mitRes.ok && mitData.success) {
                            console.log(`[nexi-payment-callback] Prepagata surcharge €${surchargeEur} charged`);
                        } else {
                            console.error(`[nexi-payment-callback] Prepagata surcharge failed:`, mitData.error);
                        }
                    } catch (mitErr) {
                        console.error('[nexi-payment-callback] Prepagata surcharge error:', mitErr);
                    }

                } else if ((isCredito || isDebito) && isInitialBooking && isEligibleService && paidCents > 0) {
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
                                        customMessage: `MESSAGGIO AUTOMATICO GENERATO DA RENTORA\nQuesto messaggio è stato inviato tramite il sistema automatizzato Rentora.\n\nGentile ${custName},\n\nHa ricevuto *€${bonusEur}* di credito sul suo wallet DR7 grazie al pagamento con ${cardLabel} (${percentLabel}).\n\nSaldo attuale: *€${newBalance.toFixed(2)}*\n\nIl credito è spendibile direttamente sul sito per le prossime prenotazioni.\n\nGrazie per la collaborazione.\n\nDR7`
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
