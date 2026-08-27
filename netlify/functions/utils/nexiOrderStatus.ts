/**
 * nexiOrderStatus — lettura dell'esito REALE di un ordine Nexi.
 *
 * BUG 2026-08-27: il callback pre-autorizzazione leggeva
 * `orderStatus.lastOperation.operationResult`, campo che l'API
 * GET /orders/{orderId} NON ritorna. Risultato: sempre 'UNKNOWN' ->
 * ogni pre-autorizzazione, anche riuscita e con i fondi bloccati sulla
 * carta, veniva marcata RIFIUTATA e il messaggio al cliente non partiva.
 *
 * Forma vera della risposta (la stessa usata da nexi-verify-captures e
 * nexi-reconcile-preauth):
 *   {
 *     orderStatus: { authorizedAmount, capturedAmount, refundedAmount,
 *                    lastOperationType, order: {...} },
 *     operations: [ { operationType, operationResult, operationId,
 *                     operationAmount, additionalData: {...} }, ... ]
 *   }
 */

const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1';

export type NexiOrderOutcome = {
    /** AUTHORIZED | EXECUTED | VOIDED | REFUNDED | DECLINED | PENDING | UNKNOWN */
    operationResult: string;
    lastOperationType: string;
    operationId: string | null;
    authorizationCode: string | null;
    contractId: string | null;
    /** centesimi */
    amount: number | null;
    authorizedAmount: number;
    capturedAmount: number;
    refundedAmount: number;
    operationCount: number;
};

const num = (v: any) => {
    const n = parseInt(String(v ?? '0'), 10);
    return Number.isFinite(n) ? n : 0;
};
const up = (v: any) => String(v ?? '').toUpperCase();

/** Deriva l'esito dell'ordine da `orderStatus` + `operations[]`. */
export function parseNexiOrder(data: any): NexiOrderOutcome {
    const os = data?.orderStatus || {};
    const ops: any[] = Array.isArray(data?.operations)
        ? data.operations
        : (Array.isArray(os.operations) ? os.operations : []);

    const authorizedAmount = num(os.authorizedAmount);
    const capturedAmount = num(os.capturedAmount);
    const refundedAmount = num(os.refundedAmount);

    const authOp = ops.find(o => up(o.operationType) === 'AUTHORIZATION' && up(o.operationResult) === 'AUTHORIZED');
    const captureOp = ops.find(o => up(o.operationType) === 'CAPTURE' && ['EXECUTED', 'OK'].includes(up(o.operationResult)));
    const voidOp = ops.find(o => ['VOID', 'CANCEL', 'CANCELLATION'].includes(up(o.operationType)));
    const refundOp = ops.find(o => up(o.operationType) === 'REFUND');
    const declinedOp = ops.find(o => ['DECLINED', 'DENIED', 'DENIED_BY_RISK', 'FAILED', 'THREEDS_FAILED'].includes(up(o.operationResult)));

    // Fallback per eventuali risposte che espongono `lastOperation`.
    const lastOp = os.lastOperation || {};

    let operationResult: string;
    if (capturedAmount > 0 || captureOp) operationResult = 'EXECUTED';
    else if (refundedAmount > 0 || refundOp) operationResult = 'REFUNDED';
    else if (voidOp) operationResult = 'VOIDED';
    else if (authorizedAmount > 0 && authOp) operationResult = 'AUTHORIZED';
    else if (declinedOp) operationResult = up(declinedOp.operationResult);
    else if (lastOp.operationResult) operationResult = up(lastOp.operationResult);
    else operationResult = 'UNKNOWN';

    const mainOp = captureOp || authOp || refundOp || voidOp || declinedOp || ops[0] || lastOp;

    return {
        operationResult,
        lastOperationType: up(os.lastOperationType || mainOp?.operationType || 'UNKNOWN'),
        operationId: mainOp?.operationId || null,
        authorizationCode: mainOp?.additionalData?.authorizationCode || null,
        contractId: mainOp?.additionalData?.contractId || null,
        amount: capturedAmount || authorizedAmount || (mainOp?.operationAmount != null ? num(mainOp.operationAmount) : null),
        authorizedAmount,
        capturedAmount,
        refundedAmount,
        operationCount: ops.length,
    };
}

/**
 * Interroga Nexi per l'esito reale dell'ordine. La notifica in arrivo non e'
 * autenticata e puo' riferirsi a un tentativo diverso da quello finale:
 * l'unica fonte di verita' e' l'API.
 * Ritorna null se la chiamata non e' andata a buon fine (chi chiama NON deve
 * scrivere nulla: meglio far ripetere la notifica che marcare a caso).
 */
export async function fetchNexiOrderOutcome(orderId: string, apiKey: string, tag = 'nexi'): Promise<NexiOrderOutcome | null> {
    if (!apiKey) {
        console.error(`[${tag}] NEXI_API_KEY mancante: impossibile verificare l'ordine`);
        return null;
    }
    try {
        const correlationId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
        const res = await fetch(`${NEXI_BASE_URL}/orders/${orderId}`, {
            method: 'GET',
            headers: { 'X-Api-Key': apiKey, 'Correlation-Id': correlationId }
        });
        const text = await res.text();
        if (!res.ok) {
            console.error(`[${tag}] Verifica ordine fallita:`, res.status, text.substring(0, 300));
            return null;
        }
        return parseNexiOrder(JSON.parse(text));
    } catch (err) {
        console.error(`[${tag}] Errore verifica ordine:`, err);
        return null;
    }
}
