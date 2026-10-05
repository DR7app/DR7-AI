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

    // 05/10/2026: la lettura parte INSIEME al controllo del token, non dopo.
    // requireAuth fa due giri di rete (getUser + controllo staff); prima la
    // query aspettava che finissero. Nessun dato esce se l'auth fallisce:
    // la risposta si costruisce solo dopo `authErr` vuoto.
    const lettura = leggiTransazioni()
    lettura.catch(() => { /* gestita sotto, evita l'unhandled rejection */ })

    // Require authentication
    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    try {
        // 1. Fetch local transactions from DB (vedi leggiTransazioni sotto)
        const { dbTransactions, error } = await lettura

        if (error) throw error;

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

/**
 * 1. Fetch local transactions from DB
 *
 * 02/09/2026 - QUI MANCAVANO 5.349 TRANSAZIONI SU 6.349.
 * La query non aveva `.range()`, e PostgREST taglia OGNI risposta a
 * 1000 righe senza segnalare nulla: il tab Nexi mostrava le 1.000 piu'
 * recenti e basta, quindi "Incassato" e il contatore erano sbagliati.
 * Ora si pagina fino in fondo (`leggiTutteLeRighe`, pagine in
 * parallelo): stesse colonne, stesso ordine, tutte le righe.
 *
 * 6.349 righe intere pesano 10,67 MB e Netlify risponde 502 oltre i
 * 6 MB: il tab tornerebbe vuoto, cioe' lo stesso sintomo di prima da
 * una causa diversa. Il peso sta quasi tutto in `metadata` (73,6%),
 * di cui il tab legge SOLO due chiavi (`cauzione_id`, `customer_name`,
 * NexiTab.tsx:1114/1136/1160/1162). Si tengono quelle due e si lascia
 * cadere il resto del blob: nessuna riga in meno, nessun campo letto
 * in meno.
 *
 * 05/10/2026: le due chiavi si estraggono DENTRO Postgres
 * (`metadata->cauzione_id`), non piu' in Node. Prima `select('*')` faceva
 * viaggiare da Supabase alla function 8,2 MB di metadata (su 9,4 MB di
 * tabella) solo per buttarli via: ~3 s di trasferimento e parse. La
 * risposta al browser e' IDENTICA: stesse colonne nello stesso ordine,
 * `metadata` = { cauzione_id, customer_name } come prima, `null` se la
 * colonna e' null (letti a parte, quasi sempre zero righe).
 * ATTENZIONE: una colonna NUOVA su nexi_transactions va aggiunta qui sotto,
 * con `*` arrivava da sola.
 */
async function leggiTransazioni(): Promise<{ dbTransactions: any[]; error: unknown }> {
    const [tutte, senzaMetadata] = await Promise.all([
        leggiTutteLeRighe<any>(
            (from, to, conConteggio) => supabase
                .from('nexi_transactions')
                .select(`
        id, created_at, updated_at, booking_id, order_id, transaction_id,
        amount_cents, currency, status, payment_link, customer_email,
        description,
        meta_cauzione_id:metadata->cauzione_id,
        meta_customer_name:metadata->customer_name,
        contract_id,
        booking:bookings (
          id,
          vehicle_name,
          customer_name
        )
      `, conConteggio ? { count: 'exact' } : undefined)
                .order('created_at', { ascending: false })
                .range(from, to)
        ),
        supabase
            .from('nexi_transactions')
            .select('id')
            .is('metadata', null)
            .limit(10000),
    ])
    if (tutte.error) return { dbTransactions: [], error: tutte.error }
    if (senzaMetadata.error) return { dbTransactions: [], error: senzaMetadata.error }

    const idsSenzaMetadata = new Set((senzaMetadata.data || []).map((r: { id: string }) => r.id))
    const dbTransactions = (tutte.data || []).map((t: any) => {
        const { meta_cauzione_id, meta_customer_name, contract_id, booking, ...resto } = t
        return {
            ...resto,
            metadata: idsSenzaMetadata.has(t.id) ? null : {
                cauzione_id: meta_cauzione_id ?? null,
                customer_name: meta_customer_name ?? null,
            },
            contract_id,
            booking,
        }
    })
    return { dbTransactions, error: null }
}

export { handler };
