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
        // Fetch ALL customers from customers_extended
        // Supabase defaults to 1000 rows — paginate to get everything
        const allCustomers: any[] = [];
        const PAGE_SIZE = 1000;
        let from = 0;

        while (true) {
            const { data, error } = await supabase
                .from('customers_extended')
                .select('*')
                .order('updated_at', { ascending: false })
                .range(from, from + PAGE_SIZE - 1);

            if (error) {
                console.error('[list-customers] Error:', error);
                throw error;
            }

            if (data && data.length > 0) {
                allCustomers.push(...data);
                from += data.length;
                // If we got fewer than PAGE_SIZE, we've reached the end
                if (data.length < PAGE_SIZE) break;
            } else {
                break;
            }
        }

        console.log(`[list-customers] Total customers fetched: ${allCustomers.length}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                customers: allCustomers
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
