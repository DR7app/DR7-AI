import { Handler } from '@netlify/functions'

/**
 * 25/09/2026 — Dismessa. La firma dei contratti DR7 si fa solo su
 * dr7trust.com (DR7 Trust), che lega il link al dispositivo e
 * controlla OTP e firma. Questa copia vecchia non aveva quei controlli: con il
 * token si poteva verificare l'OTP e firmare da qui, scavalcando il blocco.
 * Tutti i link inviati da giugno 2026 puntano a dr7trust.com.
 */
export const handler: Handler = async () => ({
    statusCode: 410,
    body: JSON.stringify({
        error: 'Questo indirizzo non e\' piu\' attivo. Apri il link di firma ricevuto su WhatsApp (dr7trust.com).',
        code: 'endpoint_dismesso',
    }),
})
