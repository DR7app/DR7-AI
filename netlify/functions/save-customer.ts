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
            // Update existing customer
            const { data, error } = await supabase
                .from('customers_extended')
                .update(customerData)
                .eq('id', customerId)
                .select()
                .single();

            if (error) {
                console.error('[save-customer] Update error:', error);
                throw error;
            }
            result = data;
            console.log('[save-customer] Customer updated:', result.id);

            // Sync key fields to auth.users user_metadata so the main website sees updates
            if (result.user_id) {
                const fullName = [result.nome, result.cognome].filter(Boolean).join(' ')
                    || result.denominazione  // Business name fallback
                    || undefined;

                const metadataUpdate: Record<string, any> = {};
                if (fullName) metadataUpdate.full_name = fullName;
                if (result.telefono) metadataUpdate.phone = result.telefono;
                if (result.tipo_cliente === 'azienda' && result.denominazione) {
                    metadataUpdate.company_name = result.denominazione;
                }

                if (Object.keys(metadataUpdate).length > 0) {
                    const { error: authError } = await supabase.auth.admin.updateUserById(
                        result.user_id,
                        { user_metadata: metadataUpdate }
                    );
                    if (authError) {
                        console.error('[save-customer] Auth metadata sync error:', authError);
                    } else {
                        console.log('[save-customer] Auth metadata synced for user:', result.user_id);
                    }
                }
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
