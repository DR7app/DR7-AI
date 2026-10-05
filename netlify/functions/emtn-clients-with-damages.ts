/**
 * EMTN — GET /emtn-clients-with-damages
 *
 * Elenco dei clienti di QUESTA installazione con danni, penali (anche solo in
 * fattura) o importi da saldare. Legge solo il database locale: in una copia
 * venduta mostra i clienti dell'acquirente, mai quelli DR7. Lo storico della
 * rete (emtn_storico_rete) NON si legge mai qui: si consulta solo per codice
 * fiscale, da emtn-search.
 *
 * Il calcolo vive in utils/emtnClientiDanni.ts.
 */
import { Handler } from '@netlify/functions'
import { requireAuth } from './require-auth'
import { getServiceSupabase, jsonResponse } from './utils/emtn'
import { raccogliClientiConDanni, type Aggregated } from './utils/emtnClientiDanni'

export const handler: Handler = async (event) => {
    const origin = event.headers.origin || event.headers.Origin
    if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {}, origin)
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
        return jsonResponse(405, { error: 'Method not allowed' }, origin)
    }

    // 05/10/2026: il calcolo (solo letture) parte insieme al controllo del
    // token invece di aspettarlo: requireAuth costa due giri di rete. Nessun
    // dato esce se l'auth fallisce: la risposta si costruisce dopo.
    let calcolo: Promise<Aggregated[]>
    try {
        calcolo = raccogliClientiConDanni(getServiceSupabase())
    } catch (err) {
        calcolo = Promise.reject(err)
    }
    calcolo.catch(() => { /* gestita sotto, evita l'unhandled rejection */ })

    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    let clients: Aggregated[]
    try {
        clients = await calcolo
    } catch (err) {
        return jsonResponse(500, { error: (err as Error).message }, origin)
    }

    return jsonResponse(200, {
        count: clients.length,
        totalUnpaid: clients.reduce((s, c) => s + c.unpaid_damage_total + c.unpaid_penalty_total + c.unpaid_other_total, 0),
        clients,
    }, origin)
}
