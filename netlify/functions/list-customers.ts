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
        // Fetch ALL customers from customers_extended.
        // Supabase taglia a 1000 righe, quindi si pagina.
        //
        // 25/08/2026: le pagine partivano una dopo l'altra e il tempo di
        // risposta era la somma dei giri. Ora la prima chiede anche il
        // conteggio esatto e le altre partono tutte insieme. Stesse righe.
        const PAGE_SIZE = 1000;

        const page = (from: number, withCount: boolean) => (withCount
            ? supabase.from('customers_extended').select('*', { count: 'exact' })
            : supabase.from('customers_extended').select('*'))
            .order('updated_at', { ascending: false })
            .range(from, from + PAGE_SIZE - 1);

        const firstPage = await page(0, true);
        if (firstPage.error) {
            console.error('[list-customers] Error:', firstPage.error);
            throw firstPage.error;
        }

        const allCustomers: any[] = [...(firstPage.data || [])];
        const total = firstPage.count ?? allCustomers.length;

        if (total > PAGE_SIZE) {
            const offsets: number[] = [];
            for (let from = PAGE_SIZE; from < total; from += PAGE_SIZE) offsets.push(from);

            const rest = await Promise.all(offsets.map(from => page(from, false)));
            for (const p of rest) {
                if (p.error) {
                    console.error('[list-customers] Error:', p.error);
                    throw p.error;
                }
                allCustomers.push(...(p.data || []));
            }

            // Doppioni possibili solo se qualcuno scrive mentre paginiamo.
            const seen = new Set<string>();
            const unique = allCustomers.filter(c => {
                if (!c?.id) return true;
                if (seen.has(c.id)) return false;
                seen.add(c.id);
                return true;
            });
            allCustomers.length = 0;
            allCustomers.push(...unique);
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
