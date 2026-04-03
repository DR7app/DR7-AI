import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const handler: Handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        // 1. Fetch local transactions from DB
        const { data: dbTransactions, error } = await supabase
            .from('nexi_transactions')
            .select(`
        *,
        booking:bookings (
          id,
          vehicle_name,
          customer_name
        )
      `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // 2. Ideally fetch from Nexi API to get external website transactions too
        // const nexiExternalTransactions = await fetchNexiOrders(...);

        // For now, return DB transactions. In a real scenario, we might merge lists.
        // If the user wants specific fields, we map them here.

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                transactions: dbTransactions
            }),
        };

    } catch (error: any) {
        console.error('Error fetching Nexi transactions:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message }),
        };
    }
};

export { handler };
