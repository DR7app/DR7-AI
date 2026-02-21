import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    // Initialize Supabase with service role key (bypasses RLS)
    const supabase = createClient(
        process.env.VITE_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    try {
        const { customerData, customerId } = JSON.parse(event.body || '{}');

        if (!customerData) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'customerData is required' })
            };
        }

        console.log('[save-customer] Saving customer:', customerId ? 'UPDATE' : 'INSERT');

        let result;

        if (customerId) {
            // Try to update existing customer
            const { data, error } = await supabase
                .from('customers_extended')
                .update(customerData)
                .eq('id', customerId)
                .select()
                .single();

            if (error && error.code === 'PGRST116') {
                // No row found for UPDATE — customer doesn't exist in customers_extended yet
                // Fall back to INSERT with the provided ID (upsert behavior)
                console.log('[save-customer] Customer not found for update, falling back to insert with ID:', customerId);
                const { data: insertData, error: insertError } = await supabase
                    .from('customers_extended')
                    .insert([{ ...customerData, id: customerId }])
                    .select()
                    .single();

                if (insertError) {
                    console.error('[save-customer] Fallback insert error:', insertError);
                    throw insertError;
                }
                result = insertData;
                console.log('[save-customer] Customer created via fallback insert:', result.id);
            } else if (error) {
                console.error('[save-customer] Update error:', error);
                throw error;
            } else {
                result = data;
                console.log('[save-customer] Customer updated:', result.id);
            }
        } else {
            // Insert new customer
            const { data, error } = await supabase
                .from('customers_extended')
                .insert([customerData])
                .select()
                .single();

            if (error) {
                console.error('[save-customer] Insert error:', error);
                throw error;
            }
            result = data;
            console.log('[save-customer] Customer created:', result.id);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                customer: result
            })
        };

    } catch (error: any) {
        console.error('[save-customer] Error:', error);
        return {
            statusCode: error.code === '23505' ? 409 : 500,
            headers,
            body: JSON.stringify({
                error: error.message || 'Failed to save customer',
                code: error.code,
                details: error.details
            })
        };
    }
};
