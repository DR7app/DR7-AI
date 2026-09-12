import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './require-auth'

// 12/09/2026 — Collega una transazione Nexi (pre-autorizzazione, addebito,
// link di pagamento) alla prenotazione del cliente. Le pre-auth create dal tab
// Nexi nascono senza `booking_id`: restavano righe orfane, senza mezzo ne'
// prenotazione, e la scheda della prenotazione non le vedeva. La scrittura
// passa di qui (service role) perche' le RLS non lasciano aggiornare
// nexi_transactions dal browser.
const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const handler: Handler = async (event) => {
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
        return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    try {
        const { transactionId, orderId, bookingId } = JSON.parse(event.body || '{}');

        if (!transactionId && !orderId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'transactionId o orderId richiesto' }) };
        }

        // bookingId null/'' = scollega (la riga torna orfana di proposito).
        let booking: { id: string; customer_name: string | null; vehicle_name: string | null } | null = null
        if (bookingId) {
            const { data: b, error: bErr } = await supabase
                .from('bookings')
                .select('id, customer_name, vehicle_name')
                .eq('id', bookingId)
                .maybeSingle()
            if (bErr) throw bErr
            if (!b) {
                return { statusCode: 404, headers, body: JSON.stringify({ error: 'Prenotazione non trovata' }) };
            }
            booking = b as typeof booking
        }

        const q = supabase
            .from('nexi_transactions')
            .update({ booking_id: bookingId || null })
            .select('id, order_id, booking_id')

        const { data: righe, error } = transactionId
            ? await q.eq('id', transactionId)
            : await q.eq('order_id', orderId)

        if (error) throw error
        if (!righe || righe.length === 0) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'Transazione Nexi non trovata' }) };
        }

        console.log('[nexi-link-booking] Collegate', righe.length, 'righe alla prenotazione', bookingId || '(scollegate)');

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                updated: righe.length,
                booking,
                message: bookingId
                    ? `Transazione collegata alla prenotazione di ${booking?.customer_name || bookingId}`
                    : 'Transazione scollegata dalla prenotazione',
            })
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[nexi-link-booking] ERROR:', msg)
        return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) };
    }
};

export { handler };
