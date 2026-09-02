import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './require-auth'
import { leggiTutteLeRighe } from './utils/leggiTutteLeRighe'
import { rispostaJson } from './utils/rispostaCompressa'

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const handler: Handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // Require authentication
    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    try {
        // 1. Fetch local transactions from DB
        //
        // 02/09/2026 - QUI MANCAVANO 5.349 TRANSAZIONI SU 6.349.
        // La query non aveva `.range()`, e PostgREST taglia OGNI risposta a
        // 1000 righe senza segnalare nulla: il tab Nexi mostrava le 1.000 piu'
        // recenti e basta, quindi "Incassato" e il contatore erano sbagliati.
        // Ora si pagina fino in fondo (`leggiTutteLeRighe`, pagine in
        // parallelo): stesse colonne, stesso ordine, tutte le righe.
        const { data: righeComplete, error } = await leggiTutteLeRighe<any>(
            (from, to, conConteggio) => supabase
                .from('nexi_transactions')
                .select(`
        *,
        booking:bookings (
          id,
          vehicle_name,
          customer_name
        )
      `, conConteggio ? { count: 'exact' } : undefined)
                .order('created_at', { ascending: false })
                .range(from, to)
        );

        if (error) throw error;

        // 6.349 righe intere pesano 10,67 MB e Netlify risponde 502 oltre i
        // 6 MB: il tab tornerebbe vuoto, cioe' lo stesso sintomo di prima da
        // una causa diversa. Il peso sta quasi tutto in `metadata` (73,6%),
        // di cui il tab legge SOLO due chiavi (`cauzione_id`, `customer_name`,
        // NexiTab.tsx:1114/1136/1160/1162). Si tengono quelle due e si lascia
        // cadere il resto del blob: nessuna riga in meno, nessun campo letto
        // in meno.
        const dbTransactions = (righeComplete || []).map((t: any) => {
            const m = t?.metadata
            if (!m || typeof m !== 'object') return t
            return {
                ...t,
                metadata: {
                    cauzione_id: (m as Record<string, unknown>).cauzione_id ?? null,
                    customer_name: (m as Record<string, unknown>).customer_name ?? null,
                },
            }
        });

        // 2. Ideally fetch from Nexi API to get external website transactions too
        // const nexiExternalTransactions = await fetchNexiOrders(...);

        // For now, return DB transactions. In a real scenario, we might merge lists.
        // If the user wants specific fields, we map them here.

        // Compressa: 6.349 transazioni non stanno nei 6 MB di Netlify in chiaro.
        return rispostaJson({ transactions: dbTransactions }, headers, true);

    } catch (error: any) {
        console.error('Error fetching Nexi transactions:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message }),
        };
    }
};

export { handler };
