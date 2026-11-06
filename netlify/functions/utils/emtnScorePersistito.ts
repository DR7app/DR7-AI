/**
 * EMTN Score salvato per persona (07/11/2026).
 *
 * Il punteggio lo calcola SOLO il codice (src/utils/emtnScore/motore.ts, via
 * utils/emtnScoreCliente.ts): troppe fonti (prenotazioni, voci danni/penali,
 * fatture, multe, pratiche, rete) per rifarlo in SQL senza creare una seconda
 * formula. Qui il risultato si scrive in `emtn_score_clienti`, una riga per
 * id della persona (customers_extended.id e, se c'e', il suo user_id del sito),
 * cosi' lo leggono:
 *  - il badge EMTN della lista prenotazioni (emtn-score-clienti);
 *  - l'allarme "Cliente sotto la soglia EMTN" (src/utils/allarmi/emtnSoglia.ts);
 *  - il database, che rifiuta le prenotazioni dal sito sotto la soglia di
 *    blocco (dr7_emtn_blocca_prenotazione_sito, migrazione 20261107_emtn_soglie).
 *
 * Il cliente si riconosce SOLO per id. Il codice fiscale e' quello della sua
 * scheda: e' la chiave con cui EMTN raccoglie la storia (come emtn-search).
 * Clienti senza codice fiscale (esteri) non hanno un punteggio salvato: il
 * blocco non li tocca mai (nel dubbio si prenota).
 *
 * Tabella assente (migrazione non ancora eseguita): ogni scrittura e lettura
 * fallisce in silenzio e tutto continua come prima.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RisultatoEMTNScore } from '../../../src/utils/emtnScore/motore'
import { calcolaReportCliente } from './emtnScoreCliente'
import { isValidCF, normalizeCF } from './emtn'

export interface ScorePersistito {
    persona_id: string
    codice_fiscale: string
    client_id: string | null
    score: number
    livello: string
    band: 'green' | 'yellow' | 'red'
    blocco: boolean
    versione: string
    calcolato_il: string
}

export const COLONNE_SCORE = 'persona_id, codice_fiscale, client_id, score, livello, band, blocco, versione, calcolato_il'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const eUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/**
 * Scrive il punteggio su ogni id delle schede trovate per quel codice fiscale
 * (e sugli id in piu' passati da chi ha chiesto il calcolo). Ritorna le righe
 * calcolate, anche se la tabella non c'e' ancora.
 */
export async function salvaScoreClienti(
    sb: SupabaseClient,
    profili: { id: string | null; user_id: string | null }[],
    { clientId, cf, risultato, altriId = [] }: { clientId: string | null; cf: string; risultato: RisultatoEMTNScore; altriId?: string[] },
): Promise<ScorePersistito[]> {
    const ids = Array.from(new Set([...profili.flatMap(p => [p.id, p.user_id]), ...altriId].filter(eUuid)))
    if (ids.length === 0 || !cf) return []
    const ora = new Date().toISOString()
    const righe: ScorePersistito[] = ids.map(persona_id => ({
        persona_id,
        codice_fiscale: cf,
        client_id: clientId,
        score: Math.max(0, Math.min(100, Math.round(risultato.score))),
        livello: risultato.livello,
        band: risultato.band,
        blocco: !!risultato.blocco,
        versione: risultato.versione,
        calcolato_il: ora,
    }))
    // Le righe tornano comunque a chi ha chiesto il calcolo (il badge si
    // vede anche prima della migrazione); solo il salvataggio puo' mancare.
    try {
        const { error } = await sb.from('emtn_score_clienti').upsert(righe, { onConflict: 'persona_id' })
        if (error) console.warn('[emtn-score] punteggio non salvato:', error.message)
    } catch { /* tabella assente: si continua */ }
    return righe
}

/** Righe salvate per questi id (customers_extended.id o user_id). */
export async function leggiScoreSalvati(sb: SupabaseClient, ids: string[]): Promise<Map<string, ScorePersistito>> {
    const out = new Map<string, ScorePersistito>()
    const validi = Array.from(new Set(ids.filter(eUuid)))
    for (let i = 0; i < validi.length; i += 200) {
        const { data, error } = await sb.from('emtn_score_clienti').select(COLONNE_SCORE).in('persona_id', validi.slice(i, i + 200))
        if (error) return out
        for (const r of (data || []) as ScorePersistito[]) out.set(r.persona_id, r)
    }
    return out
}

export interface SchedaPerScore { id: string; user_id: string | null; codice_fiscale: string | null }

/**
 * Le schede cliente di questi id: un id puo' essere la scheda stessa
 * (customers_extended.id, prenotazioni del gestionale) o l'account del sito
 * (customers_extended.user_id, prenotazioni dal sito).
 */
export async function schedePerId(sb: SupabaseClient, ids: string[]): Promise<SchedaPerScore[]> {
    const validi = Array.from(new Set(ids.filter(eUuid)))
    const out = new Map<string, SchedaPerScore>()
    for (let i = 0; i < validi.length; i += 100) {
        const lista = validi.slice(i, i + 100).join(',')
        const { data, error } = await sb
            .from('customers_extended')
            .select('id, user_id, codice_fiscale')
            .or(`id.in.(${lista}),user_id.in.(${lista})`)
        if (error) throw error
        for (const r of (data || []) as SchedaPerScore[]) out.set(r.id, r)
    }
    return [...out.values()]
}

/** Codice fiscale utilizzabile da EMTN, o '' (straniero, vuoto, malformato). */
export function cfDellaScheda(s: { codice_fiscale: string | null }): string {
    const cf = normalizeCF(String(s.codice_fiscale || '').replace(/\s+/g, ''))
    return isValidCF(cf) ? cf : ''
}

/**
 * Ricalcola e salva il punteggio di UNA persona (per codice fiscale), con lo
 * stesso calcolo di emtn-search. Non crea la riga emtn_clients e non scrive
 * il log di consultazione: non e' una consultazione, e' la manutenzione del
 * numero salvato. Ritorna le righe scritte.
 */
export async function ricalcolaEPersisti(
    sb: SupabaseClient,
    cf: string,
    altriId: string[] = [],
): Promise<{ risultato: RisultatoEMTNScore; righe: ScorePersistito[] }> {
    const { data: client } = await sb
        .from('emtn_clients')
        .select('id')
        .eq('codice_fiscale', cf)
        .limit(1)
        .maybeSingle()
    const clientId = (client as { id?: string } | null)?.id || null
    const report = await calcolaReportCliente(
        sb,
        { cf, estero: false, nomeE: '', cognomeE: '', nascitaE: '' },
        clientId ? { id: clientId } : null,
        'sistema (ricalcolo EMTN)',
    )
    const righe = await salvaScoreClienti(sb, report.profili, { clientId, cf, risultato: report.emtnScore, altriId })
    return { risultato: report.emtnScore, righe }
}

/**
 * Ricalcola un elenco di codici fiscali in parallelo (pochi alla volta) fino
 * al tempo concesso: quello che resta passa al giro dopo.
 */
export async function ricalcolaMolti(
    sb: SupabaseClient,
    lavori: { cf: string; ids: string[] }[],
    { scadenza, parallelo = 4 }: { scadenza: number; parallelo?: number },
): Promise<{ fatti: number; errori: number; righe: ScorePersistito[] }> {
    let fatti = 0
    let errori = 0
    const righe: ScorePersistito[] = []
    const coda = [...lavori]
    const operaio = async () => {
        while (coda.length > 0 && Date.now() < scadenza) {
            const l = coda.shift()!
            try {
                const r = await ricalcolaEPersisti(sb, l.cf, l.ids)
                righe.push(...r.righe)
                fatti++
            } catch (e) {
                errori++
                console.warn('[emtn-score] ricalcolo non riuscito:', e instanceof Error ? e.message : e)
            }
        }
    }
    await Promise.all(Array.from({ length: Math.max(1, parallelo) }, operaio))
    return { fatti, errori, righe }
}

/** Raggruppa le schede per codice fiscale (stessa persona = un solo calcolo). */
export function lavoriDaSchede(schede: SchedaPerScore[]): { cf: string; ids: string[] }[] {
    const perCf = new Map<string, Set<string>>()
    for (const s of schede) {
        const cf = cfDellaScheda(s)
        if (!cf) continue
        const set = perCf.get(cf) || new Set<string>()
        // Gli id con cui la persona compare (scheda e account): anche se il CF
        // fosse salvato con spazi o minuscole la riga arriva a questi id.
        for (const id of [s.id, s.user_id]) if (eUuid(id)) set.add(id)
        perCf.set(cf, set)
    }
    return [...perCf.entries()].map(([cf, ids]) => ({ cf, ids: [...ids] }))
}
