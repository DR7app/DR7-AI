import type { Handler } from "@netlify/functions";

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

function normalizePhone(raw: string | null | undefined): string {
    if (!raw) return "";
    let phone = raw.replace(/[\s\-+()]/g, "");
    if (phone.startsWith("00")) phone = phone.substring(2);
    if (phone.length === 10) phone = "39" + phone;
    return phone;
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }

    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Green API non configurato' }) };
    }

    let customers: Array<{ nome?: string; cognome?: string; phone?: string; email?: string }> = [];
    let message = '';
    try {
        const body = JSON.parse(event.body || '{}');
        customers = body.customers || [];
        message = body.message || '';
    } catch {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    if (!Array.isArray(customers) || customers.length === 0) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Nessun cliente specificato' }) };
    }
    if (!message) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Messaggio mancante' }) };
    }

    const url = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;
    let sent = 0;
    const errors: string[] = [];

    for (const c of customers) {
        const phone = normalizePhone(c.phone);
        if (!phone || phone.length < 10) {
            errors.push(`${c.nome || c.email || 'cliente'}: numero mancante o invalido`);
            continue;
        }
        const personalized = message
            .replace(/{nome}/g, c.nome || 'Cliente')
            .replace(/{cognome}/g, c.cognome || '');

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId: `${phone}@c.us`, message: personalized }),
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || result.error) throw new Error(result.error || `Green API ${res.status}`);
            sent++;
            await new Promise(r => setTimeout(r, 800));
        } catch (err: unknown) {
            const m = err instanceof Error ? err.message : String(err);
            errors.push(`${c.nome || phone}: ${m}`);
        }
    }

    return {
        statusCode: 200,
        body: JSON.stringify({
            success: true,
            sent,
            total: customers.length,
            errors: errors.length > 0 ? errors : undefined,
        }),
    };
};
