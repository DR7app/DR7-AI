import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './require-auth'
import { rispostaJson } from './utils/rispostaCompressa'

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
        // Fetch non-cancelled bookings, paginated past the 1000-row limit.
        //
        // 25/08/2026: le pagine partivano UNA DOPO L'ALTRA, quindi il tempo di
        // risposta era la somma dei giri. Ora la prima pagina chiede anche il
        // conteggio esatto e le restanti partono tutte insieme. Stesse righe,
        // stesse colonne: cambia solo che si aspetta il MASSIMO invece della
        // SOMMA.
        const PAGE_SIZE = 1000;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const buildQuery = (withCount: boolean) => {
            let query = withCount
                ? supabase.from('bookings').select('*', { count: 'exact' })
                : supabase.from('bookings').select('*');

            query = query
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

            return query.order('pickup_date', { ascending: true });
        };

        const firstPage = await buildQuery(true).range(0, PAGE_SIZE - 1);
        if (firstPage.error) {
            console.error('[list-bookings] Error:', firstPage.error);
            throw firstPage.error;
        }

        const allBookings: any[] = [...(firstPage.data || [])];
        const total = firstPage.count ?? allBookings.length;

        if (total > PAGE_SIZE) {
            const offsets: number[] = [];
            for (let start = PAGE_SIZE; start < total; start += PAGE_SIZE) offsets.push(start);

            const rest = await Promise.all(
                offsets.map(start => buildQuery(false).range(start, start + PAGE_SIZE - 1))
            );

            for (const page of rest) {
                if (page.error) {
                    console.error('[list-bookings] Error:', page.error);
                    throw page.error;
                }
                allBookings.push(...(page.data || []));
            }

            // Se qualcuno inserisce una prenotazione MENTRE stiamo paginando, la
            // stessa riga puo' scivolare in due pagine: si toglie il doppione,
            // mai una riga distinta.
            const seen = new Set<string>();
            const unique = allBookings.filter(b => {
                if (!b?.id) return true;
                if (seen.has(b.id)) return false;
                seen.add(b.id);
                return true;
            });
            allBookings.length = 0;
            allBookings.push(...unique);
        }

        console.log(`[list-bookings] Total bookings fetched: ${allBookings.length}` +
            (windowFrom || windowTo ? ` (window ${windowFrom} -> ${windowTo})` : ' (full table)'));

        // Oltre i 6 MB Netlify risponde 502: la risposta va compressa.
        return rispostaJson({
            success: true,
            count: allBookings.length,
            window: windowFrom || windowTo ? { from: windowFrom, to: windowTo } : null,
            bookings: allBookings
        }, headers, true);

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
