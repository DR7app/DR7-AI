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
                // SOLO 'AUTHORIZED' = pre-auth ancora HELD e catturabile. Escludiamo
                // EXECUTED/VOIDED/ecc. (gia' eseguite/annullate) per non ritentare
                // sull'operazione sbagliata (bug "already executed - aaccda6b").
                const isAuthorized = (op: any) => String(op.operationResult || '').toUpperCase() === 'AUTHORIZED'
                // 1) Match esatto per orderId — MA solo se l'IMPORTO coincide.
                //    (Prima catturava QUALSIASI op con quell'orderId a prescindere
                //    dall'importo → cattura falsa su operazione sbagliata mentre la
                //    vera pre-auth restava Preautorizzata su Nexi.)
                const matchingOps = allOps.filter((op: any) => op.orderId === orderId && (Number(op.operationAmount) === amountCents || !op.operationAmount))
                const authOp = matchingOps.find((op: any) => isAuthorized(op) && Number(op.operationAmount) === amountCents)
                    || matchingOps.find(isAuthorized)
                if (authOp?.operationId) {
                    realOperationId = authOp.operationId
                    console.log('[nexi-capture-preauth] Found by orderId, operationId:', realOperationId)
                } else {
                    // 2) FALLBACK SICURO 2026-07-20: l'orderId DR7 puo' NON coincidere
                    //    con quello reale su Nexi (pre-auth via link/portale). Cerchiamo
                    //    la pre-auth AUTORIZZATA con lo STESSO IMPORTO **e nello STESSO
                    //    GIORNO** della transazione. Auto-cattura SOLO se e' UNICA: mai
                    //    indovinare (rischio di catturare i €X di un ALTRO cliente).
                    const amountOps = allOps.filter((op: any) => isAuthorized(op) && Number(op.operationAmount) === amountCents)
                    const refMs = refDate ? new Date(refDate).getTime() : NaN
                    const sameDay = Number.isFinite(refMs)
                        ? amountOps.filter((op: any) => Math.abs(new Date(op.operationTime || 0).getTime() - refMs) <= 24 * 60 * 60 * 1000)
                        : amountOps
                    if (sameDay.length === 1) {
                        realOperationId = sameDay[0].operationId
                        console.log('[nexi-capture-preauth] Fallback SICURO (importo + stesso giorno, unica), operationId:', realOperationId)
                    } else if (sameDay.length > 1) {
                        // Ambiguo: NON catturare. Elenca i candidati e chiedi di scegliere.
                        scannedForError = sameDay.slice(0, 20).map((op: any) => ({ orderId: op.orderId, amount: op.operationAmount, time: op.operationTime, result: op.operationResult }))
                        return { statusCode: 409, headers, body: JSON.stringify({ error: `Trovate ${sameDay.length} pre-autorizzazioni da €${(amountCents / 100).toFixed(2)} nello stesso giorno: per sicurezza NON catturo automaticamente (rischio cliente sbagliato). Candidati: ${JSON.stringify(scannedForError)}` }) }
                    } else {
                        // Nessuna AUTHORIZED per questo importo. Diagnostica COMPLETA:
                        // elenca TUTTE le operazioni di questo importo con il loro stato
                        // (AUTHORIZED/EXECUTED/VOIDED...) per capire dov'e' finito il denaro.
                        scannedForError = allOps
                            .filter((op: any) => Number(op.operationAmount) === amountCents)
                            .slice(0, 20)
                            .map((op: any) => ({ orderId: op.orderId, amount: op.operationAmount, time: op.operationTime, result: op.operationResult, operationId: op.operationId }))
                        console.warn('[nexi-capture-preauth] Nessuna AUTHORIZED da', amountCents, '— ops stesso importo:', JSON.stringify(scannedForError))
                    }
                }
            } else {
                const errText = await opsRes.text()
                console.warn('[nexi-capture-preauth] Operations lookup failed:', opsRes.status, errText.substring(0, 200))
            }
        }

        if (!realOperationId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: `Nessuna pre-autorizzazione AUTORIZZATA (ancora catturabile) da €${(amountCents / 100).toFixed(2)} trovata su Nexi per l'ordine ${orderId}. Operazioni di questo importo su Nexi (con stato): ${JSON.stringify(scannedForError)}`, operations: scannedForError }) }
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

        // 2026-07-20: "already executed operation can't be captured" = l'operazione
        // e' GIA' stata eseguita/catturata → i soldi SONO GIA' stati presi. NON e'
        // un errore: allineiamo DR7 a "catturato" e diciamo che e' fatto.
        const errDesc = String(responseData?.errors?.[0]?.description || responseData?.error || responseText || '').toLowerCase()
        const alreadyDone = /already executed|already captured|gia.?\s*eseguit|gia.?\s*cattur/.test(errDesc)
        if (!response.ok && alreadyDone) {
            console.log('[nexi-capture-preauth] Operazione GIA\' eseguita/catturata — soldi gia\' presi. OpId:', realOperationId)
            if (cauzioneId) {
                await supabase.from('cauzioni').update({
                    stato: 'Incassata',
                    data_incasso: new Date().toISOString(),
                    note: `Gia' incassata su Nexi (operazione gia' eseguita) - Op: ${realOperationId}`,
                    updated_at: new Date().toISOString(),
                }).eq('id', cauzioneId)
            }
            if (transactionId || orderId) {
                const q2 = supabase.from('nexi_transactions').update({ status: 'preauth_captured', metadata: { already_executed: true, operation_id: realOperationId } })
                if (transactionId) await q2.eq('id', transactionId); else await q2.eq('order_id', orderId)
            }
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, alreadyExecuted: true, message: `Questa pre-autorizzazione era GIA' stata incassata su Nexi (operazione ${realOperationId}). I €${amount.toFixed(2)} sono gia' stati presi. Verifica in Nexi tra le operazioni eseguite.` }) }
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
