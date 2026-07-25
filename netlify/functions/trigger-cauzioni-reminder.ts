// "Invia ora" per il Promemoria Rimborso Cauzioni (Staff). Forza l'invio
// ignorando l'orario e il flag cron (utile per testare), e restituisce una
// diagnosi: quanti inviati, quanti saltati e il MOTIVO se non parte.
import { Handler } from '@netlify/functions';
import { processCauzioniRimborsoStaffReminder } from './process-scheduled-system-messages-cron';

export const handler: Handler = async (event) => {
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '{}' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
    try {
        const res = await processCauzioniRimborsoStaffReminder(Date.now(), { force: true });
        const ok = res.sent > 0;
        let message: string;
        if (ok) message = `Inviato a ${res.sent} destinatario/i.`;
        else if (res.reason) message = res.reason;
        else if (res.errors > 0) message = `Invio fallito (${res.errors} errori) — controlla il numero WhatsApp dei destinatari.`;
        else message = 'Niente da inviare.';
        return { statusCode: 200, headers, body: JSON.stringify({ ok, ...res, message }) };
    } catch (e) {
        return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: (e as Error).message }) };
    }
};
