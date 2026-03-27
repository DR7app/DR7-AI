import type { Handler } from "@netlify/functions";

const CALLMEBOT_API_KEY = process.env.CALLMEBOT_API_KEY;
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ message: 'Method Not Allowed' }),
        };
    }

    // Auth check
    const authHeader = event.headers.authorization || event.headers.Authorization;
    const token = authHeader?.replace('Bearer ', '');
    if (!ADMIN_API_TOKEN || token !== ADMIN_API_TOKEN) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Unauthorized' }),
        };
    }

    if (!CALLMEBOT_API_KEY) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'CallMeBot API key not configured' }),
        };
    }

    try {
        const { customers, message } = JSON.parse(event.body || '{}');

        if (!customers || !Array.isArray(customers) || customers.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Nessun cliente specificato' }),
            };
        }

        if (!message) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Messaggio mancante' }),
            };
        }

        console.log(`[send-whatsapp-voucher] Attempting to send to ${customers.length} customers`);

        let successCount = 0;
        const errors: string[] = [];

        // Send messages sequentially to avoid rate limiting
        for (const customer of customers) {
            // Clean phone number: remove spaces, ensure it has country code if possible
            // Assuming Italian numbers mostly, but data might be mixed.
            let phone = customer.phone?.replace(/\s+/g, '').replace(/-/g, '') || '';

            if (!phone) {
                console.log(`[send-whatsapp-voucher] Skipping ${customer.nome}: No phone number`);
                errors.push(`${customer.nome}: Numero mancante`);
                continue;
            }

            // Basic formatting: if starts with 3, add +39 (Italy default)? 
            // Or just send as is if it has +? CallMeBot usually expects +CC...
            if (!phone.startsWith('+')) {
                // Heuristic: if 10 digits starting with 3, probably IT mobile
                if (phone.length === 10 && phone.startsWith('3')) {
                    phone = '+39' + phone;
                } else {
                    // If we don't know the country code, we might fail. 
                    // We'll leave it as is if we can't guess, CallMeBot needs International format
                }
            }

            // Personalize message
            const personalizedMessage = message
                .replace(/{nome}/g, customer.nome || 'Cliente')
                .replace(/{cognome}/g, customer.cognome || '');

            const wrappedMessage = `*MESSAGGIO AUTOMATICO GENERATO DA RENTORA*\n_Questo messaggio è stato inviato tramite il sistema automatizzato sviluppato da Rentora._\n\n${personalizedMessage}\n\n_Se questo messaggio non era destinato a lei, oppure lo ha già ricevuto in precedenza, può semplicemente ignorarlo._`;

            const encodedMessage = encodeURIComponent(wrappedMessage);
            const callmebotUrl = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodedMessage}&apikey=${CALLMEBOT_API_KEY}`;

            try {
                // CallMeBot might be slow, so we await
                const response = await fetch(callmebotUrl);

                // CallMeBot returns 200 even on some errors, need to check text?
                // Actually typically it just works or times out.
                if (response.ok) {
                    successCount++;
                    console.log(`[send-whatsapp-voucher] Sent to ${customer.email || customer.nome} (${phone})`);
                } else {
                    throw new Error(`API returned ${response.status}`);
                }

                // Small delay to be nice to the API
                await new Promise(r => setTimeout(r, 1000));

            } catch (err: any) {
                console.error(`[send-whatsapp-voucher] Failed for ${phone}:`, err);
                errors.push(`${customer.nome || phone}: ${err.message}`);
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                sent: successCount,
                total: customers.length,
                errors: errors.length > 0 ? errors : undefined
            }),
        };

    } catch (error: any) {
        console.error('Error sending WhatsApp vouchers:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
