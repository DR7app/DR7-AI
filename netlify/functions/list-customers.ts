import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    // Initialize Supabase with service role key (bypasses RLS)
    const supabase = createClient(
        process.env.VITE_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    try {
        // Fetch all customers from customers_extended
        const { data: customers, error } = await supabase
            .from('customers_extended')
            .select('*')
            .order('updated_at', { ascending: false });

        if (error) {
            console.error('[list-customers] Error:', error);
            throw error;
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                customers: customers || []
            })
        };

    } catch (error: any) {
        console.error('[list-customers] Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: error.message || 'Failed to load customers',
                code: error.code
            })
        };
    }
};
