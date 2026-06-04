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

        if (!customer && email) {
            const { data, error } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('email', email)
                .maybeSingle();
            if (error) throw error;
            customer = data;
        }

        if (!customer && phone) {
            // Normalize phone before lookup
            let normPhone = phone.replace(/\D/g, '');
            if (normPhone.startsWith('00')) normPhone = normPhone.substring(2);
            if (normPhone.length === 10) normPhone = '39' + normPhone;

            const { data, error } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('telefono', normPhone)
                .maybeSingle();
            if (error) throw error;
            customer = data;
        }

        if (!customer) {
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
