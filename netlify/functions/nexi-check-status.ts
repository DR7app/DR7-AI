import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const handler: Handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const { orderId } = JSON.parse(event.body || '{}');

        if (!orderId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Order ID is required' }) };
        }

        // 1. In real world, call Nexi API to get status:
        // const status = await fetchNexiStatus(orderId);

        // MOCK STATUS for demo purposes
        // Randomly return 'completed' or 'pending' if not found
        const mockStatus = Math.random() > 0.5 ? 'completed' : 'pending';

        // 2. Update DB
        const { data, error } = await supabase
            .from('nexi_transactions')
            .update({ status: mockStatus }) // In real app, map Nexi status code to our status
            .eq('order_id', orderId)
            .select()
            .single();

        if (error) {
            // If not found locally, maybe it's an external transaction?
            console.warn('Transaction not found in local DB:', orderId);
        }

        // 3. If tied to a booking and paid, update booking?
        if (data && data.booking_id && mockStatus === 'completed') {
            // Optional: Auto-mark booking as paid or add payment record
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                status: mockStatus,
                transaction: data
            }),
        };

    } catch (error: any) {
        console.error('Error checking Nexi status:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message }),
        };
    }
};

export { handler };
