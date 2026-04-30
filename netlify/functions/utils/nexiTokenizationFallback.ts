/**
 * Nexi tokenization fallback.
 *
 * Some cards (virtual single-use, certain prepaid, exotic non-EU debit,
 * non-3DS, Maestro, some corporate cards) reject CONTRACT_CREATION /
 * MIT_UNSCHEDULED with HTTP 400. When that happens we still want the
 * customer to be able to pay — just without saving a contractId for
 * later MIT charges.
 *
 * Pattern: try the request with recurrence first; if Nexi answers 400
 * and the error text points at recurrence/contract/MIT, retry once
 * without the recurrence block.
 */

const RECURRENCE_ERROR_HINTS = [
    'recurrence',
    'contract',
    'mit_unscheduled',
    'contract_creation',
    'recurring',
    'tokeniz',
    'unscheduled',
];

export function isRecurrenceRejection(status: number, responseText: string): boolean {
    if (status !== 400) return false;
    const lower = responseText.toLowerCase();
    return RECURRENCE_ERROR_HINTS.some(hint => lower.includes(hint));
}

/**
 * Run a Nexi POST that includes a `recurrence` block in its payload.
 * If Nexi returns 400 with a recurrence-related error, retry once
 * with the recurrence block stripped.
 *
 * Returns { response, responseText, usedFallback }.
 */
export async function nexiCallWithRecurrenceFallback(args: {
    url: string;
    apiKey: string;
    correlationId: string;
    extraHeaders?: Record<string, string>;
    payload: any;
    /**
     * Mutates a copy of the payload to remove the recurrence block.
     * Default: deletes payload.paymentSession.recurrence.
     */
    stripRecurrence?: (payload: any) => any;
    logTag: string;
}): Promise<{ response: Response; responseText: string; usedFallback: boolean }> {
    const stripper = args.stripRecurrence || ((p: any) => {
        const copy = JSON.parse(JSON.stringify(p));
        if (copy?.paymentSession?.recurrence) delete copy.paymentSession.recurrence;
        return copy;
    });

    const doFetch = async (body: string) => {
        const res = await fetch(args.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': args.apiKey,
                'Correlation-Id': args.correlationId,
                ...(args.extraHeaders || {}),
            },
            body,
        });
        const text = await res.text();
        return { res, text };
    };

    const first = await doFetch(JSON.stringify(args.payload));
    if (first.res.ok) {
        return { response: first.res, responseText: first.text, usedFallback: false };
    }

    if (!isRecurrenceRejection(first.res.status, first.text)) {
        return { response: first.res, responseText: first.text, usedFallback: false };
    }

    console.warn(`[${args.logTag}] Tokenization rejected by Nexi (400) — retrying without recurrence. First-error excerpt:`, first.text.substring(0, 200));

    const fallbackPayload = stripper(args.payload);
    const second = await doFetch(JSON.stringify(fallbackPayload));

    return { response: second.res, responseText: second.text, usedFallback: true };
}
