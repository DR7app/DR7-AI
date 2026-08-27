import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { applyTokenizedCardUpdate } from './utils/nexiCards';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Sempre NEXI_API_KEY: NEXI_API_KEY_EXPLICIT restituisce 401 sull'API XPay.
const NEXI_API_KEY = process.env.NEXI_API_KEY!;
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1';

// Esiti Nexi che NON sono una preautorizzazione riuscita.
const FAILURE_RESULTS = new Set([
    'DECLINED', 'DENIED_BY_RISK', 'THREEDS_FAILED', 'THREEDS_VALIDATED',
    'FAILED', 'CANCELED', 'CANCELLED', 'VOIDED', 'REFUNDED', 'PENDING',
    'AUTHORIZATION_REQUESTED', 'UNKNOWN'
]);

/**
 * Interroga Nexi per l'esito REALE dell'ordine. La notifica in arrivo non e'
 * autenticata (chiunque puo' POSTare su questa URL) e puo' riferirsi a un
 * tentativo diverso da quello finale: l'unica fonte di verita' e' l'API.
 * Ritorna null se la chiamata non e' andata a buon fine.
 */
async function fetchNexiOrderOutcome(orderId: string): Promise<{ operationResult: string; lastOperationType: string; operationId: string | null; authorizationCode: string | null; contractId: string | null; amount: number | null } | null> {
    if (!NEXI_API_KEY) {
        console.error('[nexi-preauth-callback] NEXI_API_KEY mancante: impossibile verificare l\'ordine');
        return null;
    }
    try {
        const correlationId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
        const res = await fetch(`${NEXI_BASE_URL}/orders/${orderId}`, {
            method: 'GET',
            headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': correlationId }
        });
        const text = await res.text();
        if (!res.ok) {
            console.error('[nexi-preauth-callback] Verifica ordine fallita:', res.status, text.substring(0, 300));
            return null;
        }
        const data = JSON.parse(text);
        const lastOp = data.orderStatus?.lastOperation || {};
        return {
            operationResult: String(lastOp.operationResult || 'UNKNOWN').toUpperCase(),
            lastOperationType: String(data.orderStatus?.lastOperationType || lastOp.operationType || 'UNKNOWN').toUpperCase(),
            operationId: lastOp.operationId || null,
            authorizationCode: lastOp.additionalData?.authorizationCode || null,
            contractId: lastOp.additionalData?.contractId || null,
            amount: lastOp.operationAmount != null ? Number(lastOp.operationAmount) : null
        };
    } catch (err) {
        console.error('[nexi-preauth-callback] Errore verifica ordine:', err);
        return null;
    }
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

        // Check if the payment link has expired (server-side enforcement)
        const { data: txn } = await supabase
            .from('nexi_transactions')
            .select('metadata')
            .eq('order_id', orderId)
            .maybeSingle();

        const expiresAt = txn?.metadata?.expires_at;
        if (expiresAt && new Date() > new Date(expiresAt)) {
            console.log(`[nexi-preauth-callback] REJECTED — link expired at ${expiresAt}, payment arrived at ${new Date().toISOString()}`);
            await supabase.from('cauzioni').update({
                nexi_transaction_id: null,
                nexi_operation_id: null,
                note: `Pagamento rifiutato — link scaduto (scadenza: ${expiresAt})`,
                updated_at: new Date().toISOString()
            }).eq('id', cauzione.id);
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
        const verified = await fetchNexiOrderOutcome(orderId);
        if (verified) {
            console.log('[nexi-preauth-callback] Verifica Nexi:', JSON.stringify(verified));
        } else {
            console.warn('[nexi-preauth-callback] Verifica Nexi non disponibile: uso il payload della notifica (fail-closed)');
        }

        const effectiveResult = String(verified?.operationResult || result || '').toUpperCase();
        const effectiveOperationType = verified?.lastOperationType || '';
        const effectiveOperationId = verified?.operationId || operationId || transactionId || null;
        const effectiveAuthCode = verified?.authorizationCode || authorizationCode || null;
        const effectiveContractId = verified?.contractId || contractId || null;
        const effectiveAmount = verified?.amount != null ? verified.amount : (amount != null ? Number(amount) : null);
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
        if ((isPreauthorized || wasCharged) && effectiveContractId) {
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
