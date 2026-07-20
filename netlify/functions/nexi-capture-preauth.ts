import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './require-auth'

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Use same API key as pay-by-link
const NEXI_API_KEY = process.env.NEXI_API_KEY!;
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1';

const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    // Require authentication
    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    try {
        const { cauzioneId, operationId: inputOperationId, amount, orderId, transactionId, referenceDate: refDate } = JSON.parse(event.body || '{}');

        // Per le preauth auto-rinnovate, l'operationId attivo si trova in
        // nexi_transactions.metadata.current_operation_id (il vecchio
        // viene voided dal cron). Provo questa scorciatoia prima del
        // fallback lookup su /operations.
        let metaOperationId: string | null = null
        if (!inputOperationId && transactionId) {
            const { data: tx } = await supabase
                .from('nexi_transactions')
                .select('metadata, order_id')
                .eq('id', transactionId)
                .maybeSingle()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            metaOperationId = ((tx?.metadata as any)?.current_operation_id) || null
        }

        if (!amount || (!inputOperationId && !orderId)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'amount and (operationId or orderId) are required' })
            };
        }

        const amountCents = Math.round(amount * 100);

        const correlationId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })

        const captureHeaders = {
            'Content-Type': 'application/json',
            'X-Api-Key': NEXI_API_KEY,
            'Correlation-Id': correlationId,
            'Idempotency-Key': correlationId
        }

        // Step 1: Find the real operationId by looking up operations for this orderId
        let realOperationId = inputOperationId || metaOperationId
        let scannedForError: Array<{ orderId: string; amount: string; time: string; result: string }> = []
        if (!realOperationId && orderId) {
            console.log('[nexi-capture-preauth] Looking up operations for orderId:', orderId);
            const fromTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
            const toTime = new Date().toISOString()
            const opsUrl = `${NEXI_BASE_URL}/operations?fromTime=${encodeURIComponent(fromTime)}&toTime=${encodeURIComponent(toTime)}&maxRecords=500&operationType=AUTHORIZATION`
            const opsRes = await fetch(opsUrl, {
                headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16) }) }
            })
            if (opsRes.ok) {
                const opsData = await opsRes.json()
                const allOps = opsData.operations || []
                console.log('[nexi-capture-preauth] Scanned', allOps.length, 'operations')
                const isAuthorized = (op: any) => {
                    const r = String(op.operationResult || '').toUpperCase()
                    return r === 'AUTHORIZED' || r === 'PENDING' || r === ''
                }
                // 1) Match esatto per orderId.
                const matchingOps = allOps.filter((op: any) => op.orderId === orderId)
                const authOp = matchingOps.find(isAuthorized) || matchingOps[0]
                if (authOp?.operationId) {
                    realOperationId = authOp.operationId
                    console.log('[nexi-capture-preauth] Found by orderId, operationId:', realOperationId)
                } else {
                    // 2) FALLBACK 2026-07-20: l'orderId DR7 puo' NON coincidere con
                    //    l'orderId reale su Nexi (pre-auth via link/portale). Cerca la
                    //    pre-autorizzazione AUTORIZZATA con lo STESSO IMPORTO. Se unica
                    //    la catturiamo; se piu' d'una prendiamo la piu' vicina alla data
                    //    di riferimento (o la piu' recente).
                    const amountOps = allOps.filter((op: any) => isAuthorized(op) && Number(op.operationAmount) === amountCents)
                    if (amountOps.length === 1) {
                        realOperationId = amountOps[0].operationId
                        console.log('[nexi-capture-preauth] Fallback by AMOUNT (unica), operationId:', realOperationId)
                    } else if (amountOps.length > 1) {
                        const refMs = refDate ? new Date(refDate).getTime() : Date.now()
                        amountOps.sort((a: any, b: any) => Math.abs(new Date(a.operationTime || 0).getTime() - refMs) - Math.abs(new Date(b.operationTime || 0).getTime() - refMs))
                        realOperationId = amountOps[0].operationId
                        console.log('[nexi-capture-preauth] Fallback by AMOUNT (piu\' vicina a', refDate, '), operationId:', realOperationId)
                    } else {
                        // Diagnostica: elenca le AUTHORIZATION viste (orderId/importo/tempo).
                        scannedForError = allOps.filter(isAuthorized).slice(0, 20).map((op: any) => ({ orderId: op.orderId, amount: op.operationAmount, time: op.operationTime, result: op.operationResult }))
                        console.warn('[nexi-capture-preauth] Nessuna operazione per orderId', orderId, 'ne per importo', amountCents)
                    }
                }
            } else {
                const errText = await opsRes.text()
                console.warn('[nexi-capture-preauth] Operations lookup failed:', opsRes.status, errText.substring(0, 200))
            }
        }

        if (!realOperationId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: `Pre-autorizzazione non trovata su Nexi per ordine ${orderId} ne per importo €${(amountCents / 100).toFixed(2)}. Operazioni autorizzate viste: ${JSON.stringify(scannedForError)}` }) }
        }

        // Step 2: Capture with the real operationId
        console.log('[nexi-capture-preauth] Capturing with operationId:', realOperationId, 'amount:', amountCents);
        const capturePayload = {
            amount: amountCents.toString(),
            currency: 'EUR',
            description: `Incasso ${cauzioneId || orderId}`
        }

        const response = await fetch(`${NEXI_BASE_URL}/operations/${realOperationId}/captures`, {
            method: 'POST', headers: captureHeaders, body: JSON.stringify(capturePayload)
        });

        const responseText = await response.text();
        console.log('[nexi-capture-preauth] Response:', response.status, responseText.substring(0, 500));

        let responseData: any;
        try {
            responseData = JSON.parse(responseText);
        } catch {
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ error: `Nexi API error (${response.status}): ${responseText.substring(0, 200)}` })
            };
        }

        if (!response.ok) {
            console.error('[nexi-capture-preauth] ERROR:', responseData);

            if (cauzioneId) {
                await supabase
                    .from('cauzioni')
                    .update({
                        note: `Errore incasso: ${responseData.errors?.[0]?.description || response.statusText}`,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', cauzioneId);
            }

            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({ error: responseData.errors?.[0]?.description || 'Capture failed' })
            };
        }

        const captureOpId = responseData.operationId || realOperationId;

        // Update cauzione status (solo se la preauth era legata a una cauzione)
        if (cauzioneId) {
            const { error: updateError } = await supabase
                .from('cauzioni')
                .update({
                    stato: 'Incassata',
                    data_incasso: new Date().toISOString(),
                    note: `Incassato €${amount.toFixed(2)} - Nexi Op: ${captureOpId}`,
                    updated_at: new Date().toISOString()
                })
                .eq('id', cauzioneId);

            if (updateError) throw updateError;
        }

        // Update nexi_transactions row. Match per id (transactionId) se passato,
        // altrimenti per order_id. Stato finale 'preauth_captured' per
        // distinguere da un IMPLICIT charge.
        if (transactionId || orderId) {
            const q = supabase
                .from('nexi_transactions')
                .update({
                    status: 'preauth_captured',
                    metadata: { capture_operation_id: captureOpId, capture_response: responseData, capture_amount_cents: amountCents }
                })
            if (transactionId) {
                await q.eq('id', transactionId)
            } else if (orderId) {
                await q.eq('order_id', orderId)
            }
        }

        console.log('[nexi-capture-preauth] SUCCESS: Captured €' + amount.toFixed(2));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                operationId: captureOpId,
                message: `Incassato €${amount.toFixed(2)} con successo`
            })
        };

    } catch (error: any) {
        console.error('[nexi-capture-preauth] Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};

export { handler };
