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
        //
        // 25/08/2026 (stesso giorno): questa lista conteneva
        // `data_scadenza_patente` e `patente_data_rilascio`, che in
        // `customers_extended` NON ESISTONO. PostgREST rifiuta l'intera query
        // con 42703, quindi `?fields=picker` rispondeva 400 e la ricerca
        // cliente del form prenotazione restava con i soli clienti ricavati
        // dalle prenotazioni passate: un cliente appena creato non compariva
        // mai. Le due date si leggono comunque da `metadata.patente`.
        const PICKER_FIELDS = [
            'id', 'tipo_cliente', 'nome', 'cognome', 'denominazione',
            'ragione_sociale', 'ente_ufficio', 'email', 'telefono',
            'numero_patente', 'note', 'created_at', 'updated_at',
            'data_nascita', 'scadenza_patente',
            'data_rilascio_patente', 'metadata',
        ].join(',');
        // ?fields=anagrafica -> le colonne che la tab Clienti tiene davvero.
        //
        // 02/09/2026: la tab chiedeva la riga INTERA (88 colonne, 5,13 MB
        // misurati su 2059 clienti) e poi, riga per riga, ne copiava a mano un
        // sottoinsieme in un oggetto nuovo. Tutto il resto veniva buttato via
        // subito dopo essere stato scaricato. Questo elenco e' esattamente
        // quel sottoinsieme, letto dal codice della tab: chiedere il resto era
        // banda pagata per niente.
        //
        // `user_id` non e' letto oggi dalla tab (vedi il bug del wallet), ma
        // viaggia qui perche' e' una colonna sola e serve al collegamento
        // wallet / DR7 Club.
        //
        // Se una di queste colonne non esistesse, PostgREST rifiuta TUTTA la
        // query: sotto c'e' la rete di sicurezza che rilegge la riga intera.
        // Peggio che va, si torna esattamente al comportamento di prima.
        const ANAGRAFICA_FIELDS = [
            'id', 'user_id', 'tipo_cliente', 'nome', 'cognome',
            'denominazione', 'ragione_sociale', 'ente_ufficio',
            'email', 'telefono', 'pec', 'note', 'source', 'status',
            'created_at', 'updated_at', 'metadata',
            'codice_fiscale', 'partita_iva', 'codice_destinatario',
            'codice_univoco', 'contatti_cliente',
            'indirizzo', 'numero_civico', 'cap', 'codice_postale',
            'citta', 'citta_residenza', 'provincia_residenza', 'nazione',
            'indirizzo_azienda', 'indirizzo_ddt', 'sede_legale',
            'data_nascita', 'luogo_nascita', 'provincia_nascita', 'sesso',
            'numero_patente', 'tipo_patente', 'patente',
            'scadenza_patente', 'data_rilascio_patente', 'data_rilascio',
            'emessa_da', 'rilasciata_da',
            'membership_tier', 'membership_expires_at',
        ].join(',');

        const wantsPicker = event.queryStringParameters?.fields === 'picker';
        const wantsAnagrafica = event.queryStringParameters?.fields === 'anagrafica';
        const columns = wantsPicker ? PICKER_FIELDS
            : wantsAnagrafica ? ANAGRAFICA_FIELDS
            : '*';

        // `id` come secondo criterio NON e' un dettaglio estetico: le pagine
        // sono richieste in parallelo, quindi sono query separate. Con il solo
        // `updated_at` due clienti con lo stesso istante possono finire in
        // ordine diverso da una pagina all'altra: uno viene restituito due
        // volte e un altro NON viene restituito da nessuna pagina (sparisce
        // dall'anagrafica, e con lei dalla ricerca cliente del form
        // prenotazione). Con un criterio univoco l'ordine e' lo stesso per
        // tutte le pagine e nessuna riga si perde.
        let columnsInUse = columns;
        const page = (from: number, withCount: boolean) => (withCount
            ? supabase.from('customers_extended').select(columnsInUse, { count: 'exact' })
            : supabase.from('customers_extended').select(columnsInUse))
            .order('updated_at', { ascending: false })
            .order('id', { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

        let firstPage = await page(0, true);

        // Rete di sicurezza: se l'elenco ridotto viene rifiutato (una colonna
        // rinominata o rimossa), si rilegge la riga intera invece di lasciare
        // le tab senza anagrafica. Meglio una risposta piu' pesante che un
        // gestionale che non trova i clienti.
        if (firstPage.error && columnsInUse !== '*') {
            console.error(`[list-customers] elenco ridotto rifiutato, ripiego su *:`, firstPage.error);
            columnsInUse = '*';
            firstPage = await page(0, true);
        }

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

        // Oltre i 6 MB Netlify risponde 502 ResponseSizeTooLarge e la tab
        // resta vuota senza errore visibile: la risposta va compressa.
        return rispostaJson({ success: true, customers: allCustomers }, headers, true);

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
