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
            let phone = customerData.telefono.replace(/[\s\-\+\(\)]/g, '');
            if (phone.startsWith('00')) phone = phone.substring(2);
            if (phone.length === 10) phone = '39' + phone;
            customerData.telefono = phone;
        }

        console.log('[save-customer] Saving customer:', customerId ? 'UPDATE' : 'INSERT');

        // ===== DEDUP GUARD: Before any INSERT, check if customer already exists =====
        // This prevents duplicate customers when the caller doesn't provide a customerId
        if (!customerId) {
            let existingId: string | null = null;

            // 1. Check by codice_fiscale (strongest identifier for persona_fisica)
            if (!existingId && customerData.codice_fiscale?.trim()) {
                const { data } = await supabase
                    .from('customers_extended')
                    .select('id')
                    .eq('codice_fiscale', customerData.codice_fiscale.trim().toUpperCase())
                    .maybeSingle();
                if (data) existingId = data.id;
            }

            // 2. Check by partita_iva (strongest identifier for azienda)
            if (!existingId && customerData.partita_iva?.trim()) {
                const { data } = await supabase
                    .from('customers_extended')
                    .select('id')
                    .eq('partita_iva', customerData.partita_iva.trim())
                    .maybeSingle();
                if (data) existingId = data.id;
            }

            // 3. Check by email
            if (!existingId && customerData.email?.trim()) {
                const { data } = await supabase
                    .from('customers_extended')
                    .select('id')
                    .ilike('email', customerData.email.trim())
                    .maybeSingle();
                if (data) existingId = data.id;
            }

            // 4. Check by telefono (normalized)
            if (!existingId && customerData.telefono?.trim()) {
                const { data } = await supabase
                    .from('customers_extended')
                    .select('id')
                    .eq('telefono', customerData.telefono.trim())
                    .maybeSingle();
                if (data) existingId = data.id;
            }

            if (existingId) {
                console.log('[save-customer] DEDUP: Found existing customer', existingId, '— switching to UPDATE mode');
                // Redirect to UPDATE path instead of creating a duplicate
                const { data, error } = await supabase
                    .from('customers_extended')
                    .update(customerData)
                    .eq('id', existingId)
                    .select()
                    .single();

                if (error) {
                    console.error('[save-customer] DEDUP update error:', error);
                    throw error;
                }

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        success: true,
                        customer: data,
                        deduplicated: true
                    })
                };
            }
        }

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
            // Insert new customer
            const { data, error } = await supabase
                .from('customers_extended')
                .insert([customerData])
                .select()
                .single();

            if (error) {
                // Handle unique constraint violation (23505) — fallback to find & update
                if (error.code === '23505') {
                    console.log('[save-customer] Unique constraint violation — finding existing customer to update');
                    let fallbackId: string | null = null;

                    if (customerData.email) {
                        const { data: found } = await supabase
                            .from('customers_extended')
                            .select('id')
                            .ilike('email', customerData.email.trim())
                            .maybeSingle();
                        if (found) fallbackId = found.id;
                    }
                    if (!fallbackId && customerData.telefono) {
                        const { data: found } = await supabase
                            .from('customers_extended')
                            .select('id')
                            .eq('telefono', customerData.telefono.trim())
                            .maybeSingle();
                        if (found) fallbackId = found.id;
                    }
                    if (!fallbackId && customerData.codice_fiscale) {
                        const { data: found } = await supabase
                            .from('customers_extended')
                            .select('id')
                            .eq('codice_fiscale', customerData.codice_fiscale.trim().toUpperCase())
                            .maybeSingle();
                        if (found) fallbackId = found.id;
                    }

                    if (fallbackId) {
                        const { data: updated, error: updateErr } = await supabase
                            .from('customers_extended')
                            .update(customerData)
                            .eq('id', fallbackId)
                            .select()
                            .single();

                        if (updateErr) throw updateErr;
                        result = updated;
                        console.log('[save-customer] Unique violation resolved — updated existing:', fallbackId);

                        return {
                            statusCode: 200,
                            headers,
                            body: JSON.stringify({
                                success: true,
                                customer: result,
                                deduplicated: true
                            })
                        };
                    }
                }

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
