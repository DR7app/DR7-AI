// "Invia ora" per l'Avviso Scadenza Cauzione (Centralina Pro > Cauzioni).
// Forza l'invio ignorando l'orario, il flag cron e la modalita' manuale, e
// restituisce il motivo quando non parte niente.
import { Handler } from '@netlify/functions';
import { processScadenzaCauzioneAvviso } from './process-scheduled-system-messages-cron';

export const handler: Handler = async (event) => {
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '{}' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
    try {
        const res = await processScadenzaCauzioneAvviso(Date.now(), { force: true });
        const ok = res.sent > 0;
        let message: string;
        if (ok) message = `Avviso inviato per ${res.sent} cauzione/i.`;
        else if (res.reason) message = res.reason;
        else if (res.errors > 0) message = `Invio fallito (${res.errors} errori) — controlla numero WhatsApp ed email dei destinatari.`;
        // Senza questo ramo tutte le cauzioni scartate finivano in un generico
        // "Niente da inviare", indistinguibile da un pulsante che non funziona.
        else if (res.skipped > 0) message = `${res.skipped} cauzione/i saltate: gia' avvisate oggi, variante del messaggio spenta, o importo da restituire pari a zero.`;
        else message = 'Niente da inviare.';
        // Esito email accanto a quello WhatsApp: se l'email non parte, il motivo
        // va detto qui (SMTP, interruttore System Control), non solo nei log.
        const em = res.email;
        if (em && (res.sent > 0 || res.errors > 0)) {
            if (em.ferma) message += ` Email NON inviate: ${em.ferma}`;
            else if (em.errori.length > 0) message += ` Email NON inviate: ${em.errori.join(' | ')}`;
            else if (em.inviate > 0) message += ` Email inviate: ${em.inviate}.`;
        }
        return { statusCode: 200, headers, body: JSON.stringify({ ok, ...res, message }) };
    } catch (e) {
        return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: (e as Error).message }) };
    }
};
