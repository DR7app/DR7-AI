import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { applyTokenizedCardUpdate } from './utils/nexiCards';
import { fetchNexiCardInfo } from './utils/nexiCardInfo';
import { lookupBin } from './utils/binLookup';
import { triggerSystemMessageEvent } from './utils/triggerSystemMessageEvent';
import { fetchNexiOrderOutcome } from './utils/nexiOrderStatus';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Sempre NEXI_API_KEY: NEXI_API_KEY_EXPLICIT restituisce 401 sull'API XPay.
const NEXI_API_KEY = process.env.NEXI_API_KEY!;

// Esiti Nexi che NON sono una preautorizzazione riuscita.
const FAILURE_RESULTS = new Set([
    'DECLINED', 'DENIED_BY_RISK', 'THREEDS_FAILED', 'THREEDS_VALIDATED',
    'FAILED', 'CANCELED', 'CANCELLED', 'VOIDED', 'REFUNDED', 'PENDING',
    'AUTHORIZATION_REQUESTED', 'UNKNOWN'
]);

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
        // 2026-08-27: si caricano anche cliente/importo/veicolo perche' su
        // pre-autorizzazione riuscita parte il messaggio Pro al cliente
        // (evento `cauzione_preauth_completed`).
        const { data: cauzione } = await supabase
            .from('cauzioni')
            .select('id, cliente_id, veicolo_id, importo, nexi_transaction_id, riferimento_contratto_id')
            .eq('nexi_order_id', orderId)
            .maybeSingle();

        const { data: txn } = await supabase
            .from('nexi_transactions')
            .select('id, metadata, customer_email')
            .eq('order_id', orderId)
            .maybeSingle();

        // 01/09/2026: la pre-autorizzazione puo' NON avere una cauzione dietro
        // (link creato dal tab Nexi o dal menu Gestisci del tab Clienti): in
        // quel caso esiste solo la riga in nexi_transactions. Prima si usciva
        // 404 e quella pre-auth restava "in attesa" per sempre, con la carta
        // mai registrata sulla scheda cliente.
        if (!cauzione && !txn) {
            console.error('Cauzione not found for order:', orderId);
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Cauzione not found' })
            };
        }
        if (!cauzione) {
            console.log('[nexi-preauth-callback] Pre-autorizzazione senza cauzione (standalone) per order:', orderId);
        }

        // Check if the payment link has expired (server-side enforcement)
        const expiresAt = txn?.metadata?.expires_at;
        if (expiresAt && new Date() > new Date(expiresAt)) {
            console.log(`[nexi-preauth-callback] REJECTED — link expired at ${expiresAt}, payment arrived at ${new Date().toISOString()}`);
            // NON azzerare qui nexi_transaction_id: una notifica tardiva o
            // duplicata su un ordine gia' autorizzato cancellerebbe una
            // pre-auth valida. La pulizia avviene solo su esito verificato.
            if (cauzione) {
                await supabase.from('cauzioni').update({
                    note: `Pagamento rifiutato — link scaduto (scadenza: ${expiresAt})`,
                    updated_at: new Date().toISOString()
                }).eq('id', cauzione.id);
            }
            // Update transaction as expired too
            await supabase.from('nexi_transactions').update({
                status: 'expired',
                metadata: { ...txn.metadata, rejected_at: new Date().toISOString(), reason: 'link_expired' }
            }).eq('order_id', orderId);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: false, error: 'Link scaduto' })
            };
        }

        // ESITO REALE: la notifica non e' autenticata e puo' arrivare per un
        // tentativo intermedio. Chiediamo sempre a Nexi qual e' l'ultimo stato
        // dell'ordine e usiamo QUELLO. Il payload serve solo da fallback.
        const verified = await fetchNexiOrderOutcome(orderId, NEXI_API_KEY, 'nexi-preauth-callback');
        if (verified) {
            console.log('[nexi-preauth-callback] Verifica Nexi:', JSON.stringify(verified));
        } else {
            // Senza risposta da Nexi l'esito e' ignoto. Non tocchiamo nulla:
            // marcare "rifiutata" una pre-auth magari buona (azzerando i
            // riferimenti) sarebbe peggio del bug di partenza. Il 503 fa
            // ripetere la notifica a Nexi.
            console.error('[nexi-preauth-callback] Verifica Nexi FALLITA per', orderId, '— nessuna scrittura, la notifica verra\' ripetuta');
            await supabase.from('nexi_transactions').update({
                metadata: {
                    ...(txn?.metadata || {}),
                    ultima_verifica_fallita: new Date().toISOString(),
                    payload_notifica_result: result || null,
                }
            }).eq('order_id', orderId);
            return {
                statusCode: 503,
                headers,
                body: JSON.stringify({ success: false, error: 'Verifica Nexi non disponibile, riprovare' })
            };
        }

        // Ordine senza nessuna operazione: il cliente non ha (ancora) pagato,
        // oppure Nexi non ha ancora registrato il tentativo. Esito non deciso:
        // non scriviamo niente e facciamo ripetere la notifica.
        if (verified.operationCount === 0 && verified.operationResult === 'UNKNOWN') {
            console.warn('[nexi-preauth-callback] Ordine senza operazioni su Nexi:', orderId, '— nessuna scrittura');
            return {
                statusCode: 503,
                headers,
                body: JSON.stringify({ success: false, error: 'Esito non ancora disponibile su Nexi' })
            };
        }

        // Fonte di verita' = Nexi. Il payload copre solo i campi che l'API non ritorna.
        const effectiveResult = String(verified.operationResult || '').toUpperCase();
        const effectiveOperationType = verified.lastOperationType || '';
        const effectiveOperationId = verified.operationId || operationId || transactionId || null;
        const effectiveAuthCode = verified.authorizationCode || authorizationCode || null;
        const effectiveContractId = verified.contractId || contractId || null;
        const effectiveAmount = verified.amount != null ? verified.amount : (amount != null ? Number(amount) : null);
        const amountStr = effectiveAmount != null ? (Number(effectiveAmount) / 100).toFixed(2) : '?';

        // AUTHORIZED = fondi bloccati (preauth corretta). EXECUTED = fondi
        // incassati (endpoint sbagliato, ma i soldi sono usciti davvero).
        // Qualsiasi altro esito e' un FALLIMENTO: mai marcare pre-autorizzata.
        const isFailure = !effectiveResult || FAILURE_RESULTS.has(effectiveResult);
        const isPreauthorized = !isFailure && effectiveResult === 'AUTHORIZED';
        const wasCharged = !isFailure && (effectiveResult === 'EXECUTED' || effectiveResult === 'OK');
        // Esito sconosciuto e non riconosciuto: trattato come fallimento.
        const isUnknown = !isFailure && !isPreauthorized && !wasCharged;

        const updateData: any = {
            updated_at: new Date().toISOString()
        };

        // Stato della riga in nexi_transactions, allineato all'esito reale.
        let txStatus: string;

        if (isPreauthorized) {
            // Corretto: fondi BLOCCATI, non incassati
            updateData.nexi_transaction_id = effectiveOperationId;
            updateData.nexi_operation_id = effectiveOperationId;
            if (effectiveContractId) {
                updateData.nexi_contract_id = effectiveContractId;
            }
            updateData.stato = 'Attiva'; // Pre-authorized and ready for SBLOCCA or INCASSA
            updateData.metodo = 'preautorizzazione'; // 2026-07-18: badge mostra "Pre-autorizzata" (pre-auth completata)
            updateData.note = `Preautorizzazione completata (fondi bloccati) - OpId: ${effectiveOperationId || 'N/A'} - Auth: ${effectiveAuthCode || 'N/A'}${effectiveContractId ? ` - Carta registrata (${effectiveContractId})` : ''} - Importo: €${amountStr}`;
            txStatus = 'preauth_held';
            console.log('[nexi-preauth-callback] PREAUTH SUCCESS — operationId:', effectiveOperationId, 'authCode:', effectiveAuthCode);
        } else if (wasCharged) {
            // WARNING: funds were CHARGED instead of held — this means the endpoint did PAY not PREAUTH
            updateData.nexi_transaction_id = effectiveOperationId;
            updateData.nexi_operation_id = effectiveOperationId;
            if (effectiveContractId) {
                updateData.nexi_contract_id = effectiveContractId;
            }
            updateData.stato = 'Incassata'; // Mark as charged since money was taken
            updateData.note = `ATTENZIONE: Importo INCASSATO (non bloccato) - Result: ${effectiveResult} - OpId: ${effectiveOperationId || 'N/A'} - Auth: ${effectiveAuthCode || 'N/A'} - €${amountStr}`;
            txStatus = 'preauth_wrongly_charged';
            console.log('[nexi-preauth-callback] WARNING: CHARGED instead of PREAUTH — result:', effectiveResult, 'operationId:', effectiveOperationId);
        } else {
            // FALLIMENTO (rifiutata, 3DS fallito, annullata, esito ignoto...).
            // BUG 2026-08-27: prima si scriveva solo la nota, lasciando
            // nexi_transaction_id + metodo='preautorizzazione' -> il gestionale
            // continuava a mostrare "Pre-autorizzata" su una carta RIFIUTATA.
            // Ora ripuliamo i riferimenti Nexi: nessun fondo e' bloccato.
            updateData.nexi_transaction_id = null;
            updateData.nexi_operation_id = null;
            updateData.note = `Preautorizzazione RIFIUTATA - Esito: ${effectiveResult || resultCode || 'sconosciuto'}${effectiveOperationType ? ` (${effectiveOperationType})` : ''} - Importo: €${amountStr} - ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`;
            txStatus = 'failed';
            console.log('[nexi-preauth-callback] FAILED — result:', effectiveResult, 'resultCode:', resultCode, 'unknownResult:', isUnknown);
        }

        if (cauzione) {
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

            console.log('Cauzione updated successfully:', cauzione.id, '- txStatus:', txStatus);
        }

        // ── Pre-autorizzazione EFFETTUATA: messaggio Pro al cliente ────────
        // Evento `cauzione_preauth_completed` (gruppo Cauzioni in Messaggi di
        // Sistema Pro). Se nessun template lo gestisce, il resolver salta
        // l'invio: niente testo hardcoded.
        // Idempotenza: Nexi puo' ripetere la notifica; se la cauzione portava
        // gia' questo operationId il messaggio e' partito al primo giro.
        const alreadyProcessed = !!cauzione?.nexi_transaction_id
            && String(cauzione.nexi_transaction_id) === String(effectiveOperationId || '');
        if (cauzione && isPreauthorized && !alreadyProcessed) {
            try {
                const { data: cust } = await supabase
                    .from('customers_extended')
                    .select('nome, cognome, ragione_sociale, telefono, email')
                    .eq('id', cauzione.cliente_id)
                    .maybeSingle();
                const phone = (cust?.telefono || '').trim();
                if (!phone) {
                    console.warn('[nexi-preauth-callback] Nessun telefono cliente: messaggio pre-autorizzazione non inviato');
                } else {
                    const custName = (cust?.ragione_sociale || `${cust?.nome || ''} ${cust?.cognome || ''}`.trim() || 'Cliente');
                    let veicolo: { display_name?: string; plate?: string } | null = null;
                    if (cauzione.veicolo_id) {
                        const { data: v } = await supabase
                            .from('vehicles')
                            .select('display_name, plate')
                            .eq('id', cauzione.veicolo_id)
                            .maybeSingle();
                        veicolo = v;
                    }
                    const importoStr = Number(cauzione.importo || 0).toFixed(2);
                    const baseUrl = process.env.URL || 'https://platform.dr7ai.com';

                    // 1) Evento Messaggi di Sistema Pro `on_cauzione_preauthorized`
                    // ("Cauzione pre-autorizzata"): fa partire i template che
                    // l'admin ha collegato all'evento nella tendina Evento.
                    // Passa il numero del cliente perche' il sender scarta gli
                    // invii senza destinatario esplicito. Dedup per cauzione
                    // via system_message_send_log.
                    let inviatiDaEvento = 0;
                    try {
                        const evRes = await triggerSystemMessageEvent({
                            bookingId: cauzione.id,
                            event: 'on_cauzione_preauthorized',
                            recipientPhone: phone,
                            syntheticBooking: {
                                id: cauzione.id,
                                customer_name: custName,
                                customer_email: cust?.email || null,
                                customer_phone: phone,
                                vehicle_name: veicolo?.display_name || '',
                                vehicle_plate: veicolo?.plate || '',
                                deposit_amount: Number(cauzione.importo || 0),
                                booking_details: { deposit: Number(cauzione.importo || 0), depositOption: 'standard' },
                                payment_method: 'card',
                                // status 'active': il filtro di default dei
                                // template e' target_status = confirmed,active.
                                // Con lo stato reale della cauzione (es.
                                // 'da_incassare') il messaggio verrebbe scartato.
                                status: 'active',
                                payment_status: 'preauth',
                                price_total: Math.round(Number(cauzione.importo || 0) * 100),
                            },
                        });
                        inviatiDaEvento = evRes?.sent || 0;
                    } catch (evErr) {
                        console.error('[nexi-preauth-callback] Evento on_cauzione_preauthorized fallito (non bloccante):', evErr);
                    }

                    // 2) Routing per evento `cauzione_preauth_completed` (la
                    // spunta nella lista eventi del template). Parte SOLO se
                    // il trigger sopra non ha gia' mandato niente: altrimenti
                    // lo stesso template, collegato in tutti e due i modi,
                    // manderebbe due WhatsApp al cliente.
                    if (inviatiDaEvento > 0) {
                        console.log(`[nexi-preauth-callback] Pre-autorizzazione: ${inviatiDaEvento} messaggio/i inviati dall'evento on_cauzione_preauthorized — routing cauzione_preauth_completed saltato`);
                    } else {
                        await fetch(`${baseUrl}/.netlify/functions/send-whatsapp-notification`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                customPhone: phone,
                                templateKey: 'cauzione_preauth_completed',
                                booking: { service_type: 'rental' },
                                templateVars: {
                                    '{nome}': custName.split(' ')[0] || 'Cliente',
                                    '{nome cliente}': custName,
                                    '{nome_cliente}': custName,
                                    '{cliente}': custName,
                                    '{customer_name}': custName,
                                    '{amount}': importoStr,
                                    '{importo}': importoStr,
                                    '{total}': importoStr,
                                    '{vehicle_name}': veicolo?.display_name || '',
                                    '{targa}': veicolo?.plate || '',
                                    '{data}': new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }),
                                },
                            }),
                        });
                        console.log('[nexi-preauth-callback] Messaggio cauzione_preauth_completed inviato a', phone);
                    }
                }
            } catch (msgErr) {
                console.error('[nexi-preauth-callback] Invio messaggio pre-autorizzazione fallito (non bloccante):', msgErr);
            }
        }

        // Allinea SEMPRE nexi_transactions all'esito reale. Senza questo la riga
        // resta 'pending_preauth' (mostrata "Pre-autorizzato" nel tab Nexi)
        // anche quando la carta e' stata rifiutata.
        const { error: txUpdateError } = await supabase
            .from('nexi_transactions')
            .update({
                status: txStatus,
                metadata: {
                    ...(txn?.metadata || {}),
                    operation_result: effectiveResult || null,
                    operation_type: effectiveOperationType || null,
                    operation_id: effectiveOperationId,
                    authorization_code: effectiveAuthCode,
                    verified_with_nexi: !!verified,
                    callback_processed_at: new Date().toISOString()
                }
            })
            .eq('order_id', orderId);

        if (txUpdateError) {
            console.error('[nexi-preauth-callback] Errore aggiornamento nexi_transactions:', txUpdateError);
        }

        // Save contractId to customer for future MIT charges
        if (cauzione && (isPreauthorized || wasCharged) && effectiveContractId) {
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
                                    metadata: applyTokenizedCardUpdate(cust.metadata, { nexi_contract_id: effectiveContractId, nexi_contract_updated: new Date().toISOString() }),
                                    updated_at: new Date().toISOString()
                                }).eq('id', cust.id);
                                saved = true;
                                console.log(`[nexi-preauth-callback] Saved contractId ${effectiveContractId} on customer ${cust.id}`);
                            }
                        }
                        if (!saved && custEmail) {
                            const { data: custByEmail } = await supabase.from('customers_extended').select('id, metadata').eq('email', custEmail).maybeSingle();
                            if (custByEmail) {
                                await supabase.from('customers_extended').update({
                                    metadata: applyTokenizedCardUpdate(custByEmail.metadata, { nexi_contract_id: effectiveContractId, nexi_contract_updated: new Date().toISOString() }),
                                    updated_at: new Date().toISOString()
                                }).eq('id', custByEmail.id);
                                console.log(`[nexi-preauth-callback] Saved contractId ${effectiveContractId} on customer ${custByEmail.id} (by email)`);
                            }
                        }
                    }
                }
            } catch (custErr) {
                console.error('[nexi-preauth-callback] Error saving contractId to customer:', custErr);
            }
        }

        // ── PRE-AUTORIZZAZIONE SU CLIENTE, SENZA CAUZIONE ─────────────────
        // 01/09/2026: link creato dal menu Gestisci del tab Clienti (o dal tab
        // Nexi scegliendo il cliente). Non c'e' nessuna cauzione da aggiornare,
        // ma la carta deve finire sulla scheda del cliente: e' l'unico motivo
        // per cui il link e' stato mandato. Stessa logica del ramo "link
        // cliente" di nexi-payment-callback.
        if (!cauzione && (isPreauthorized || wasCharged)) {
            try {
                // Rilettura: poco sopra abbiamo scritto esito/operation_id in
                // metadata. Partendo dalla copia vecchia li cancelleremmo.
                const { data: txFresh } = await supabase
                    .from('nexi_transactions')
                    .select('metadata, customer_email')
                    .eq('order_id', orderId)
                    .maybeSingle();
                const meta = txFresh?.metadata || txn?.metadata || {};
                const custIdLink = meta.customer_id || null;
                const custEmailLink = (txFresh?.customer_email || txn?.customer_email || meta.customer_email || '').toLowerCase().trim();

                let cardInfoLink: Record<string, any> = {};
                const cardLink = await fetchNexiCardInfo(NEXI_API_KEY, {
                    operationId: effectiveOperationId,
                    orderId,
                });
                if (cardLink) {
                    let binType = '';
                    let binBrand = '';
                    const binForLookup = cardLink.bin
                        || (cardLink.maskedPan && /^\d{6}/.test(cardLink.maskedPan.trim()) ? cardLink.maskedPan.trim().substring(0, 6) : '');
                    if (binForLookup && binForLookup.length >= 4) {
                        const binResult = await lookupBin(binForLookup);
                        if (binResult) { binType = binResult.type; binBrand = binResult.brand; }
                    }
                    cardInfoLink = {
                        nexi_card_masked_pan: cardLink.maskedPan,
                        nexi_card_circuit: cardLink.circuit || '',
                        nexi_card_type: cardLink.cardType || binType,
                        nexi_card_brand: binBrand || cardLink.circuit || '',
                        nexi_card_bin: binForLookup || '',
                        nexi_card_updated: new Date().toISOString(),
                    };
                    // La carta resta anche sulla riga della transazione: il tab
                    // Nexi la mostra pure se il cliente non si aggancia.
                    await supabase.from('nexi_transactions').update({
                        metadata: { ...meta, ...cardInfoLink },
                        updated_at: new Date().toISOString(),
                    }).eq('order_id', orderId);
                }

                const aggiornamento = {
                    ...(effectiveContractId ? { nexi_contract_id: effectiveContractId } : {}),
                    nexi_contract_updated: new Date().toISOString(),
                    ...cardInfoLink,
                };

                let cliente: any = null;
                if (custIdLink) {
                    const { data } = await supabase.from('customers_extended').select('id, metadata').eq('id', custIdLink).maybeSingle();
                    cliente = data;
                }
                if (!cliente && custEmailLink) {
                    const { data } = await supabase.from('customers_extended').select('id, metadata').eq('email', custEmailLink).maybeSingle();
                    cliente = data;
                }

                if (cliente) {
                    await supabase.from('customers_extended').update({
                        metadata: applyTokenizedCardUpdate(cliente.metadata, aggiornamento),
                        updated_at: new Date().toISOString()
                    }).eq('id', cliente.id);
                    console.log(`[nexi-preauth-callback] Pre-auth cliente: carta registrata sulla scheda ${cliente.id}`);
                } else {
                    console.warn(`[nexi-preauth-callback] Pre-auth cliente: nessuna scheda trovata (id=${custIdLink || '-'}, email=${custEmailLink || '-'}) — carta salvata solo sulla transazione`);
                }
            } catch (linkErr) {
                console.error('[nexi-preauth-callback] Pre-auth cliente: registrazione carta fallita (non bloccante):', linkErr);
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
