import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './require-auth'

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

    // 25/08/2026 - questo endpoint rispondeva 200 A CHIUNQUE, senza nessun
    // controllo: bastava l'indirizzo per scaricare l'anagrafica completa
    // (2059 clienti, nome, email, telefono, codice fiscale, patente).
    // Ora vuole la sessione come tutte le altre function che leggono dati.
    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

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

        // ?fields=picker -> solo le colonne che servono a chi usa questo
        // elenco come anagrafica di scelta cliente. Misurato in produzione:
        // la riga intera ha 88 colonne e pesa 5,13 MB su 2059 clienti; queste
        // 17 pesano 0,65 MB. Stessi clienti, tutti, solo con meno campi.
        // Senza il parametro la risposta resta quella di prima, intera.
        const PICKER_FIELDS = [
            'id', 'tipo_cliente', 'nome', 'cognome', 'denominazione',
            'ragione_sociale', 'ente_ufficio', 'email', 'telefono',
            'numero_patente', 'note', 'created_at', 'updated_at',
            'data_nascita', 'scadenza_patente', 'data_scadenza_patente',
            'data_rilascio_patente', 'patente_data_rilascio', 'metadata',
        ].join(',');
        const columns = event.queryStringParameters?.fields === 'picker'
            ? PICKER_FIELDS
            : '*';

        const page = (from: number, withCount: boolean) => (withCount
            ? supabase.from('customers_extended').select(columns, { count: 'exact' })
            : supabase.from('customers_extended').select(columns))
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
