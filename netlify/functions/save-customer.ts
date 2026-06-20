import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './require-auth'

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

    // Require authentication
    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    try {
        const { customerData, customerId } = JSON.parse(event.body || '{}');

        if (!customerData) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'customerData is required' })
            };
        }

        // Normalize phone number to digits-only with country code (e.g., 393290838561)
        if (customerData.telefono) {
            let phone = customerData.telefono.replace(/\D/g, '');
            if (phone.startsWith('00')) phone = phone.substring(2);
            if (phone.length === 10) phone = '39' + phone;
            customerData.telefono = phone;
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
            // Check for existing customer before inserting (prevent duplicates)
            let existingCustomer = null;

            // Regola: NON si fondono MAI lead di tipo_cliente diverso (persona
            // fisica vs azienda vs PA). Possono condividere CF/telefono/email
            // (es. ditta individuale = CF del titolare) ma restano lead distinte.
            // 1. Check by codice_fiscale (stesso tipo_cliente)
            if (!existingCustomer && customerData.codice_fiscale) {
                let q = supabase.from('customers_extended').select('*').eq('codice_fiscale', customerData.codice_fiscale.toUpperCase());
                if (customerData.tipo_cliente) q = q.eq('tipo_cliente', customerData.tipo_cliente);
                const { data } = await q.limit(1);
                if (data && data.length) existingCustomer = data[0];
            }
            // 2. Check by partita_iva (stesso tipo_cliente)
            if (!existingCustomer && customerData.partita_iva) {
                let q = supabase.from('customers_extended').select('*').eq('partita_iva', customerData.partita_iva);
                if (customerData.tipo_cliente) q = q.eq('tipo_cliente', customerData.tipo_cliente);
                const { data } = await q.limit(1);
                if (data && data.length) existingCustomer = data[0];
            }
            // 3. Check by email — SOLO stesso tipo_cliente. Una persona fisica
            //    e la sua azienda (o PA) possono condividere email/telefono:
            //    sono lead DIVERSE, non un duplicato. Senza questo filtro,
            //    salvando un'azienda col contatto di una persona, l'azienda
            //    sovrascriveva la riga della persona (le due lead venivano unite).
            if (!existingCustomer && customerData.email) {
                let q = supabase.from('customers_extended').select('*').ilike('email', customerData.email);
                if (customerData.tipo_cliente) q = q.eq('tipo_cliente', customerData.tipo_cliente);
                const { data } = await q.limit(1);
                if (data && data.length) existingCustomer = data[0];
            }
            // 4. Check by phone — anch'esso SOLO stesso tipo_cliente (vedi sopra).
            if (!existingCustomer && customerData.telefono) {
                let q = supabase.from('customers_extended').select('*').eq('telefono', customerData.telefono);
                if (customerData.tipo_cliente) q = q.eq('tipo_cliente', customerData.tipo_cliente);
                const { data } = await q.limit(1);
                if (data && data.length) existingCustomer = data[0];
            }

            if (existingCustomer) {
                // Update existing customer instead of creating duplicate
                console.log('[save-customer] Found existing customer, updating:', existingCustomer.id);
                const { data, error } = await supabase
                    .from('customers_extended')
                    .update(customerData)
                    .eq('id', existingCustomer.id)
                    .select()
                    .single();
                if (error) { console.error('[save-customer] Update existing error:', error); throw error; }
                result = data;
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
