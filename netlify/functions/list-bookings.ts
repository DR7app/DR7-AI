import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
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
        // Fetch ALL non-cancelled bookings, paginated past the 1000-row limit
        const allBookings: any[] = [];
        const PAGE_SIZE = 1000;
        let from = 0;

        while (true) {
            const { data, error } = await supabase
                .from('bookings')
                .select('*')
                .neq('status', 'cancelled')
                .order('pickup_date', { ascending: true })
                .range(from, from + PAGE_SIZE - 1);

            if (error) {
                console.error('[list-bookings] Error:', error);
                throw error;
            }

            if (data && data.length > 0) {
                allBookings.push(...data);
                from += data.length;
                if (data.length < PAGE_SIZE) break;
            } else {
                break;
            }
        }

        console.log(`[list-bookings] Total bookings fetched: ${allBookings.length}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                bookings: allBookings
            })
        };

    } catch (error: any) {
        console.error('[list-bookings] Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: error.message || 'Failed to load bookings',
                code: error.code
            })
        };
    }
};
