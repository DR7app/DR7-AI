// "Invia ora" del messaggio Ritiro spazzatura (tab Immondizia, 23/11/2026).
// Manda subito WhatsApp ed email ai destinatari salvati, ignorando ora e
// calendario, e dice quanti sono partiti.
import { Handler } from '@netlify/functions';
import { inviaRitiroSpazzaturaOra } from './process-scheduled-system-messages-cron';

export const handler: Handler = async (event) => {
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '{}' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
    try {
        const { id } = JSON.parse(event.body || '{}');
        if (!id) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, message: 'id mancante' }) };
        const r = await inviaRitiroSpazzaturaOra(String(id));
        return { statusCode: 200, headers, body: JSON.stringify(r) };
    } catch (e) {
        return { statusCode: 500, headers, body: JSON.stringify({ ok: false, message: (e as Error).message }) };
    }
};
