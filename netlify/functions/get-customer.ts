import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './require-auth'

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    // Require authentication
    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    const supabase = createClient(
        process.env.VITE_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { id, email, phone } = event.queryStringParameters || {};

    if (!id && !email && !phone) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Provide id, email, or phone query parameter' })
        };
    }

    try {
        let customer = null;

        if (id) {
            const { data, error } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('id', id)
                .maybeSingle();
            if (error) throw error;
            customer = data;
        }

        // 2026-08-09 (roadmap #19): email e telefono NON sono identificatori
        // univoci. Due lead distinte possono condividere lo stesso numero (o la
        // stessa email dell'agenzia) e devono restare separate in TUTTO il
        // flusso. Prima si usava .maybeSingle(): con due lead lo stesso numero
        // la query ne restituiva UNA a caso — silenziosamente la persona
        // sbagliata — oppure andava in errore PGRST116 (500). Il chiamante
        // (ReservationsTab.validateCustomerData) validava cosi' i dati di
        // un'altra lead, ed e' cosi' che il contratto e' finito intestato al
        // Sig. Ambu invece che all'admin.
        //
        // Ora: si risolve SOLO se il match e' UNIVOCO. Se e' ambiguo si
        // risponde 404 con `ambiguous: true`, cosi' il chiamante sa che deve
        // farsi dare l'ID della lead invece di indovinare.
        let ambiguous: { field: 'email' | 'telefono'; count: number } | null = null;

        if (!customer && email) {
            const { data, error } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('email', email)
                .limit(2);
            if (error) throw error;
            if (data && data.length === 1) customer = data[0];
            else if (data && data.length > 1) ambiguous = { field: 'email', count: data.length };
        }

        if (!customer && !ambiguous && phone) {
            // Normalize phone before lookup
            let normPhone = phone.replace(/\D/g, '');
            if (normPhone.startsWith('00')) normPhone = normPhone.substring(2);
            if (normPhone.length === 10) normPhone = '39' + normPhone;

            const { data, error } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('telefono', normPhone)
                .limit(2);
            if (error) throw error;
            if (data && data.length === 1) customer = data[0];
            else if (data && data.length > 1) ambiguous = { field: 'telefono', count: data.length };
        }

        if (!customer) {
            if (ambiguous) {
                console.warn(`[get-customer] Match ambiguo su ${ambiguous.field}: ${ambiguous.count} lead. Serve l'id della lead.`);
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({
                        error: `Piu' clienti condividono ${ambiguous.field === 'email' ? 'questa email' : 'questo numero'}: seleziona il cliente dalla lista invece di cercarlo per ${ambiguous.field}.`,
                        ambiguous: true,
                        field: ambiguous.field,
                        count: ambiguous.count,
                    })
                };
            }
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Customer not found' })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ customer })
        };
    } catch (error: any) {
        console.error('[get-customer] Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message || 'Internal error' })
        };
    }
};
