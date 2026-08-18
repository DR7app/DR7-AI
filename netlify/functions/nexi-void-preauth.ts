import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './require-auth'

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// 2026-08-18 — CAUSA DEL "Nexi ha rifiutato lo sblocco: HTTP 401".
// Questa era l'UNICA function Nexi a partire da NEXI_API_KEY_EXPLICIT: tutte
// le altre (creazione pre-auth, cattura, pay-by-link) usano NEXI_API_KEY. Una
// pre-autorizzazione si annulla con la STESSA chiave/terminale che l'ha
// autorizzata: con una chiave diversa Nexi risponde 401 anche su un
// operationId corretto — ed e' esattamente quello che succedeva (401 pure
// sulla lettura delle operazioni, quindi nemmeno la ricerca poteva aiutare).
// Ordine invertito: prima la chiave standard, l'altra solo come ripiego.
const NEXI_API_KEY = process.env.NEXI_API_KEY || process.env.NEXI_API_KEY_EXPLICIT!;
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
        const { cauzioneId, operationId: inputOperationId, orderId, transactionId } = JSON.parse(event.body || '{}');

        // Risolvi operationId attivo (le preauth auto-rinnovate hanno il
        // current_operation_id nel metadata della riga nexi_transactions).
        let operationId = inputOperationId as string | null
        if (!operationId && transactionId) {
            const { data: tx } = await supabase
                .from('nexi_transactions')
                .select('metadata')
                .eq('id', transactionId)
                .maybeSingle()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            operationId = ((tx?.metadata as any)?.current_operation_id) || null
        }

        if (!operationId && !orderId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'operationId or orderId required' })
            };
        }
        if (!operationId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'operationId mancante (passa transactionId o operationId esplicito)' })
            };
        }

        console.log('[nexi-void-preauth] === VOID/REFUND REQUEST ===');
        console.log('[nexi-void-preauth] operationId (input):', operationId);
        console.log('[nexi-void-preauth] cauzioneId:', cauzioneId);

        // ── Dati della cauzione: servono per riconoscere l'operazione su Nexi ──
        // (importo + giorno). Senza, non si puo' distinguere la pre-auth giusta.
        let cauzioneImporto: number | null = null
        let cauzioneRefDate: string | null = null
        if (cauzioneId) {
            const { data: cz } = await supabase
                .from('cauzioni')
                // Solo colonne che esistono davvero (create_cauzioni_system.sql):
                // una colonna inventata farebbe fallire l'INTERA select e ci
                // lascerebbe senza importo per riconoscere l'operazione.
                .select('importo, created_at, data_restituzione_veicolo')
                .eq('id', cauzioneId)
                .maybeSingle()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const czAny = cz as any
            cauzioneImporto = czAny?.importo != null ? Number(czAny.importo) : null
            cauzioneRefDate = czAny?.created_at || czAny?.data_restituzione_veicolo || null
        }

        // 2026-08-18 (segnalazione direzione: "failed to refund/void"). L'id
        // salvato sulla cauzione NON e' sempre un operationId Nexi: al momento
        // della creazione si salva `operationId || orderId`, e per le pre-auth
        // nate da link e' spesso l'ORDER id. Chiamare /operations/{orderId}/cancels
        // fallisce, e subito dopo falliva anche /refunds — da qui l'errore
        // generico. La cattura (nexi-capture-preauth) risolve gia' l'operazione
        // vera scandendo le AUTHORIZATION su Nexi: qui si fa lo stesso.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const randomCorrelation = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let candidatiDiagnostica: any[] = []
        async function resolveOperationId(): Promise<string | null> {
            const amountCents = cauzioneImporto != null ? Math.round(cauzioneImporto * 100) : null
            const fromTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
            const toTime = new Date().toISOString()
            const opsUrl = `${NEXI_BASE_URL}/operations?fromTime=${encodeURIComponent(fromTime)}&toTime=${encodeURIComponent(toTime)}&maxRecords=500&operationType=AUTHORIZATION`
            const opsRes = await fetch(opsUrl, { headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': randomCorrelation() } })
            if (!opsRes.ok) {
                console.warn('[nexi-void-preauth] Operations lookup failed:', opsRes.status, (await opsRes.text()).substring(0, 200))
                return null
            }
            const opsData = await opsRes.json()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const allOps: any[] = opsData.operations || []
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const isAuthorized = (op: any) => String(op.operationResult || '').toUpperCase() === 'AUTHORIZED'
            const wantedOrder = orderId || operationId
            // 1) per orderId, con importo coerente quando lo conosciamo
            const byOrder = allOps.filter(op => op.orderId === wantedOrder && (amountCents == null || !op.operationAmount || Number(op.operationAmount) === amountCents))
            const authByOrder = byOrder.find(op => isAuthorized(op) && (amountCents == null || Number(op.operationAmount) === amountCents)) || byOrder.find(isAuthorized)
            if (authByOrder?.operationId) return authByOrder.operationId
            // 2) ripiego SICURO: stessa cifra e stesso giorno, e SOLO se e' unica.
            //    Mai indovinare: si rischia di sbloccare la cauzione di un altro.
            if (amountCents != null) {
                const sameAmount = allOps.filter(op => isAuthorized(op) && Number(op.operationAmount) === amountCents)
                const refMs = cauzioneRefDate ? new Date(cauzioneRefDate).getTime() : NaN
                const sameDay = Number.isFinite(refMs)
                    ? sameAmount.filter(op => Math.abs(new Date(op.operationTime || 0).getTime() - refMs) <= 3 * 24 * 60 * 60 * 1000)
                    : sameAmount
                if (sameDay.length === 1) return sameDay[0].operationId
                candidatiDiagnostica = sameDay.slice(0, 10).map(op => ({ orderId: op.orderId, amount: op.operationAmount, time: op.operationTime, result: op.operationResult }))
            }
            if (candidatiDiagnostica.length === 0) {
                candidatiDiagnostica = allOps
                    .filter(op => amountCents == null || Number(op.operationAmount) === amountCents)
                    .slice(0, 10)
                    .map(op => ({ orderId: op.orderId, amount: op.operationAmount, time: op.operationTime, result: op.operationResult }))
            }
            return null
        }

        // Try /cancels first (for pre-auths not yet captured)
        // If that fails, try /refunds (for already captured or partial)
        const correlationId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })

        const cancelPayload = {
            description: `Sblocco cauzione ${cauzioneId}`
        };

        // First attempt: cancel (void pre-auth) con l'id che abbiamo in casa.
        const tryCancel = async (opId: string, corr: string) => {
            console.log('[nexi-void-preauth] Trying /cancels on', opId);
            const r = await fetch(`${NEXI_BASE_URL}/operations/${opId}/cancels`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Api-Key': NEXI_API_KEY,
                    'Correlation-Id': corr
                },
                body: JSON.stringify(cancelPayload)
            });
            const t = await r.text();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let d: any;
            try { d = JSON.parse(t); } catch { d = { raw: t }; }
            return { r, t, d };
        };

        let { r: response, t: responseText, d: responseData } = await tryCancel(operationId, correlationId);

        // 2026-08-18: se fallisce, PRIMA di dichiarare l'errore proviamo a
        // risolvere l'operazione vera su Nexi (l'id salvato e' spesso un
        // orderId) e ritentiamo l'annullamento con quello.
        if (!response.ok) {
            console.log('[nexi-void-preauth] /cancels fallita, provo a risolvere l\'operazione reale su Nexi...');
            const resolved = await resolveOperationId();
            if (resolved && resolved !== operationId) {
                console.log('[nexi-void-preauth] operationId risolto:', resolved, '(era', operationId + ')');
                operationId = resolved;
                ({ r: response, t: responseText, d: responseData } = await tryCancel(operationId, randomCorrelation()));
            }
        }

        // If cancel fails, try refund
        if (!response.ok) {
            console.log('[nexi-void-preauth] /cancels failed, trying /refunds...');
            const refundCorrelationId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
            })

            // Get the cauzione amount for refund
            const { data: cauzione } = await supabase
                .from('cauzioni')
                .select('importo')
                .eq('id', cauzioneId)
                .single();

            const refundPayload: any = {
                description: `Sblocco cauzione ${cauzioneId}`
            };
            if (cauzione?.importo) {
                refundPayload.amount = Math.round(Number(cauzione.importo) * 100).toString();
                refundPayload.currency = 'EUR';
            }

            response = await fetch(`${NEXI_BASE_URL}/operations/${operationId}/refunds`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Api-Key': NEXI_API_KEY,
                    'Correlation-Id': refundCorrelationId
                },
                body: JSON.stringify(refundPayload)
            });

            responseText = await response.text();
            try { responseData = JSON.parse(responseText); } catch { responseData = { raw: responseText }; }
        }

        console.log('[nexi-void-preauth] Response:', response.status, responseText.substring(0, 500));

        if (!response.ok) {
            console.error('[nexi-void-preauth] ERROR:', responseData);

            if (cauzioneId) {
                await supabase
                    .from('cauzioni')
                    .update({
                        note: `Errore sblocco: ${responseData.errors?.[0]?.description || response.statusText}`,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', cauzioneId);
            }

            // 2026-08-18: prima usciva solo "Void/refund failed" e non si capiva
            // NIENTE. Ora si dice cosa ha risposto Nexi, su quale operazione si e'
            // provato, e — se non l'abbiamo trovata — quali pre-autorizzazioni
            // dello stesso importo esistono davvero, con il loro stato.
            const nexiMsg = responseData.errors?.[0]?.description
                || responseData.errors?.[0]?.code
                || (typeof responseData.raw === 'string' ? responseData.raw.substring(0, 200) : '')
                || `HTTP ${response.status}`
            const diagnostica = candidatiDiagnostica.length > 0
                ? ` Pre-autorizzazioni trovate su Nexi per questo importo: ${JSON.stringify(candidatiDiagnostica)}.`
                : ''
            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({
                    error: `Nexi ha rifiutato lo sblocco dell'operazione ${operationId}: ${nexiMsg}.${diagnostica}`,
                    operationId,
                    candidates: candidatiDiagnostica,
                })
            };
        }

        const voidOpId = responseData.operationId || operationId;

        // Update cauzione status (solo se la preauth era legata a una cauzione)
        if (cauzioneId) {
            const { error: updateError } = await supabase
                .from('cauzioni')
                .update({
                    stato: 'Sbloccata',
                    data_sblocco: new Date().toISOString(),
                    note: `Preautorizzazione sbloccata - Nexi Op: ${voidOpId}`,
                    updated_at: new Date().toISOString()
                })
                .eq('id', cauzioneId);

            if (updateError) throw updateError;
        }

        // Update nexi_transactions (sia per cauzioni che per preauth standalone
        // create dal tab Nexi). Match per transactionId se presente, altrimenti
        // per orderId.
        if (transactionId || orderId) {
            const q = supabase
                .from('nexi_transactions')
                .update({
                    status: 'preauth_voided',
                    metadata: { void_operation_id: voidOpId, void_response: responseData }
                })
            if (transactionId) {
                await q.eq('id', transactionId)
            } else if (orderId) {
                await q.eq('order_id', orderId)
            }
        }

        console.log('[nexi-void-preauth] SUCCESS: Pre-auth voided');

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                operationId: voidOpId,
                message: 'Preautorizzazione sbloccata con successo'
            })
        };

    } catch (error: any) {
        console.error('[nexi-void-preauth] Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};

export { handler };
