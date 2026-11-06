/**
 * EMTN — POST /emtn-score-clienti (07/11/2026)
 *
 * Badge EMTN nella lista Prenotazioni: il punteggio di molti clienti in una
 * chiamata. Il numero e' quello di EMTN (stesso calcolo di emtn-search, in
 * utils/emtnScoreCliente.ts), salvato in emtn_score_clienti.
 *
 * Body: { ids: string[] } — id del cliente sulla prenotazione: scheda
 *        (customers_extended.id) o account del sito (user_id). Mai nome,
 *        email o telefono.
 * Returns: { punteggi: { [id]: { score, band, livello, calcolato_il } | null },
 *            inCorso: string[] }
 *   null     = cliente senza codice fiscale valido (o senza scheda): nessun badge.
 *   inCorso  = non ancora calcolati in questa chiamata (tempo finito): il
 *              gestionale richiede piu' tardi.
 *
 * Un punteggio salvato da meno di FRESCO_MS si restituisce com'e'; piu'
 * vecchio (o di una versione precedente dell'algoritmo) si ricalcola.
 * Non scrive il log di consultazione EMTN: non mostra la storia del cliente,
 * solo il numero, e solo allo staff.
 */
import { Handler } from '@netlify/functions'
import { requireAuth } from './require-auth'
import { getServiceSupabase, jsonResponse } from './utils/emtn'
import { VERSIONE_ALGORITMO } from '../../src/utils/emtnScore/motore'
import {
    eUuid, lavoriDaSchede, leggiScoreSalvati, ricalcolaMolti, schedePerId, type ScorePersistito,
} from './utils/emtnScorePersistito'

/** Oltre questo il punteggio salvato si ricalcola. */
const FRESCO_MS = 6 * 60 * 60_000
/** Tempo massimo di calcolo per chiamata (le function hanno ~26 s). */
const BUDGET_MS = 15_000
const MAX_ID = 300

type Punteggio = Pick<ScorePersistito, 'score' | 'band' | 'livello' | 'calcolato_il'>

export const handler: Handler = async (event) => {
    const origin = event.headers.origin || event.headers.Origin
    if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {}, origin)
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' }, origin)

    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    const body = (() => { try { return JSON.parse(event.body || '{}') } catch { return null } })()
    const ids: string[] = Array.from(new Set((Array.isArray(body?.ids) ? body.ids : []).filter(eUuid))).slice(0, MAX_ID) as string[]
    if (ids.length === 0) return jsonResponse(200, { punteggi: {}, inCorso: [] }, origin)

    const t0 = Date.now()
    const sb = getServiceSupabase()
    const punteggi: Record<string, Punteggio | null> = {}
    const prendi = (r: ScorePersistito): Punteggio => ({ score: r.score, band: r.band, livello: r.livello, calcolato_il: r.calcolato_il })

    const salvati = await leggiScoreSalvati(sb, ids)
    const daCalcolare: string[] = []
    for (const id of ids) {
        const r = salvati.get(id)
        const fresco = r && r.versione === VERSIONE_ALGORITMO && Date.now() - Date.parse(r.calcolato_il) < FRESCO_MS
        if (r) punteggi[id] = prendi(r)
        if (!fresco) daCalcolare.push(id)
    }

    const inCorso = new Set<string>()
    if (daCalcolare.length > 0) {
        try {
            const schede = await schedePerId(sb, daCalcolare)
            const lavori = lavoriDaSchede(schede)
            // Id senza scheda o senza codice fiscale: nessun punteggio EMTN.
            const conCf = new Set(lavori.flatMap(l => l.ids))
            for (const id of daCalcolare) if (!conCf.has(id) && !(id in punteggi)) punteggi[id] = null
            for (const l of lavori) for (const id of l.ids) if (daCalcolare.includes(id)) inCorso.add(id)
            const { righe } = await ricalcolaMolti(sb, lavori, { scadenza: t0 + BUDGET_MS, parallelo: 4 })
            for (const r of righe) {
                if (!ids.includes(r.persona_id)) continue
                punteggi[r.persona_id] = prendi(r)
                inCorso.delete(r.persona_id)
            }
        } catch (e) {
            console.error('[emtn-score-clienti]', e instanceof Error ? e.message : e)
        }
    }
    // Un vecchio punteggio vale piu' di niente: chi ce l'ha non e' "in corso".
    for (const id of [...inCorso]) if (punteggi[id]) inCorso.delete(id)

    return jsonResponse(200, { punteggi, inCorso: [...inCorso] }, origin)
}
