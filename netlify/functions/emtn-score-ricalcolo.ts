/**
 * EMTN — ricalcolo programmato dei punteggi salvati (07/11/2026), ogni 10 min.
 *
 * emtn_score_clienti e' cio' che leggono l'allarme "Cliente sotto la soglia
 * EMTN" e il blocco delle prenotazioni dal sito (Centralina Pro > EMTN). Un
 * numero mai calcolato o vecchio non serve: questo giro lo tiene aggiornato,
 * con lo STESSO calcolo di emtn-search (utils/emtnScoreCliente.ts).
 *
 * Ordine:
 *  1. clienti con un noleggio in corso, futuro o creato negli ultimi giorni
 *     (sono quelli per cui suona l'allarme): ricalcolati se il numero ha piu'
 *     di FRESCO_MS;
 *  2. poi tutte le altre schede con codice fiscale, partendo da quelle mai
 *     calcolate e dalle piu' vecchie (RPC dr7_emtn_score_da_ricalcolare): cosi'
 *     anche chi non prenota da mesi ha un numero quando torna sul sito.
 *
 * Ogni giro si ferma a BUDGET_MS: il resto passa al giro dopo. Migrazione
 * 20261107_emtn_soglie non ancora eseguita: si calcola senza salvare (nessun
 * danno), la RPC del punto 2 manca e il giro fa solo il punto 1.
 */
import { schedule } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { conSystemControl } from './utils/systemControl'
import { VERSIONE_ALGORITMO } from '../../src/utils/emtnScore/motore'
import { eNoleggio, type BookingPerScore } from './utils/emtnScoreServer'
import {
    eUuid, lavoriDaSchede, leggiScoreSalvati, ricalcolaMolti, schedePerId,
} from './utils/emtnScorePersistito'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const FRESCO_MS = 6 * 60 * 60_000
/** Le scheduled function hanno 30 s. */
const BUDGET_MS = 22_000
const GIORNO = 24 * 60 * 60_000
/** Schede gia' calcolate: si ripassano dopo una settimana. */
const ORE_SCHEDE_VECCHIE = 24 * 7
const SCHEDE_PER_GIRO = 60

type Prenotazione = BookingPerScore & {
    user_id?: string | null
    booking_details?: (BookingPerScore['booking_details'] & {
        customer_id?: string | null
        customer?: { customerId?: string | null; id?: string | null } | null
    }) | null
}

/** Id del cliente su una prenotazione: account del sito o scheda. Mai nome/telefono. */
export function idClienteDellaPrenotazione(b: Prenotazione): string[] {
    const bd = b.booking_details || {}
    return [b.user_id, bd.customer_id, bd.customer?.customerId, bd.customer?.id].filter(eUuid)
}

const giro = async () => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Supabase non configurato' }) }
    }
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    const t0 = Date.now()
    const scadenza = t0 + BUDGET_MS

    // 1. Clienti con un noleggio vivo.
    const da = new Date(t0 - GIORNO).toISOString()
    const creatiDa = new Date(t0 - 3 * GIORNO).toISOString()
    const idPrenotazioni = new Set<string>()
    for (let p = 0; p < 5; p++) {
        const { data, error } = await sb
            .from('bookings')
            .select('id, user_id, status, service_type, vehicle_plate, vehicle_name, booking_details')
            .neq('status', 'cancelled')
            .neq('status', 'annullata')
            .or(`dropoff_date.gte.${da},pickup_date.gte.${da},created_at.gte.${creatiDa}`)
            .order('id', { ascending: true })
            .range(p * 1000, p * 1000 + 999)
        if (error) {
            console.error('[emtn-score-ricalcolo] prenotazioni non lette:', error.message)
            break
        }
        for (const b of (data || []) as Prenotazione[]) {
            if (!eNoleggio(b)) continue
            for (const id of idClienteDellaPrenotazione(b)) idPrenotazioni.add(id)
        }
        if (!data || data.length < 1000) break
    }
    const salvati = await leggiScoreSalvati(sb, [...idPrenotazioni])
    const vecchi = [...idPrenotazioni].filter(id => {
        const r = salvati.get(id)
        return !r || r.versione !== VERSIONE_ALGORITMO || t0 - Date.parse(r.calcolato_il) >= FRESCO_MS
    })

    let fatti = 0
    let errori = 0
    if (vecchi.length > 0) {
        try {
            const lavori = lavoriDaSchede(await schedePerId(sb, vecchi))
            const r = await ricalcolaMolti(sb, lavori, { scadenza, parallelo: 4 })
            fatti += r.fatti
            errori += r.errori
        } catch (e) {
            console.error('[emtn-score-ricalcolo] noleggi vivi:', e instanceof Error ? e.message : e)
        }
    }

    // 2. Tutte le altre schede, dalle mai calcolate alle piu' vecchie.
    if (Date.now() < scadenza - 2000) {
        const { data, error } = await sb.rpc('dr7_emtn_score_da_ricalcolare', { p_limite: SCHEDE_PER_GIRO, p_ore: ORE_SCHEDE_VECCHIE })
        if (!error && Array.isArray(data) && data.length > 0) {
            try {
                const ids = (data as Array<{ customer_id: string }>).map(r => r.customer_id).filter(eUuid)
                const lavori = lavoriDaSchede(await schedePerId(sb, ids))
                const r = await ricalcolaMolti(sb, lavori, { scadenza, parallelo: 4 })
                fatti += r.fatti
                errori += r.errori
            } catch (e) {
                console.error('[emtn-score-ricalcolo] schede:', e instanceof Error ? e.message : e)
            }
        }
    }

    const durata = Date.now() - t0
    return { statusCode: 200, body: JSON.stringify({ clienti_con_noleggio: idPrenotazioni.size, ricalcolati: fatti, errori, durata_ms: durata }) }
}

export const handler = schedule('*/10 * * * *', conSystemControl('emtn-score-ricalcolo', giro, { cron: true }))
