import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './require-auth'

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    // Require authentication
    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    // Initialize Supabase with service role key (bypasses RLS)
    const supabase = createClient(
        process.env.VITE_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Finestra opzionale ?from=&to= (ISO). Serve al calendario: caricare TUTTE
    // le prenotazioni di sempre a ogni apertura fa crescere la risposta senza
    // limite, e quando supera il tetto della funzione il chiamante riceve un
    // errore e mostra un calendario vuoto. Con la finestra si leggono solo le
    // prenotazioni che toccano il mese a video.
    // Omessi = comportamento storico (tutto), per gli altri chiamanti.
    const windowFrom = event.queryStringParameters?.from || null;
    const windowTo = event.queryStringParameters?.to || null;

    try {
        // Fetch non-cancelled bookings, paginated past the 1000-row limit
        const allBookings: any[] = [];
        const PAGE_SIZE = 1000;
        let from = 0;

        while (true) {
            let query = supabase
                .from('bookings')
                .select('*')
                .neq('status', 'cancelled')
                .neq('status', 'annullata');

            if (windowTo) {
                // Ritiro prima della fine della finestra...
                query = query.lt('pickup_date', windowTo);
            }
            if (windowFrom) {
                // ...e riconsegna dopo l'inizio: e' il test di sovrapposizione.
                // dropoff nullo = prenotazione aperta, va sempre tenuta.
                query = query.or(`dropoff_date.is.null,dropoff_date.gte.${windowFrom}`);
            }

            const { data, error } = await query
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

        console.log(`[list-bookings] Total bookings fetched: ${allBookings.length}` +
            (windowFrom || windowTo ? ` (window ${windowFrom} -> ${windowTo})` : ' (full table)'));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                count: allBookings.length,
                window: windowFrom || windowTo ? { from: windowFrom, to: windowTo } : null,
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
