/**
 * Motore allarmi sul server — ogni minuto.
 *
 * 02/10/2026. Fino a oggi il giro allarmi girava solo nel browser: nessuna
 * postazione del gestionale aperta = nessuna rilevazione e nessun messaggio
 * al cliente. Un "contratto non firmato 30 minuti prima del ritiro" delle 9
 * con il primo operatore collegato alle 9:15 non partiva mai.
 *
 * Questo cron fa lo stesso giro (src/utils/motoreAllarmi.ts: stesse
 * rilevazioni, stesse regole su alarm_events) con la chiave di servizio, poi
 * manda i messaggi al cliente scelti in Centralina Pro > Allarmi, e lascia il
 * battito in alarm_engine_battito. Le schede aperte vedono il battito e si
 * limitano a suonare; se il battito manca, rifanno il giro da sole.
 *
 * Il suono resta nel browser: un server non ha altoparlanti.
 */
import { schedule } from '@netlify/functions'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { conSystemControl } from './utils/systemControl'
import { inviaMessaggioAllarme } from './utils/messaggioAllarme'
import {
    CatalogoNonInstallato,
    eseguiGiro,
    messaggiDaInviare,
    type AlarmEventRow,
} from '../../src/utils/motoreAllarmi'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

/** Il cron ha 30 s: oltre questo i messaggi rimasti passano al giro dopo. */
const BUDGET_MESSAGGI_MS = 20_000
/**
 * Messaggi in sospeso: occorrenze aperte negli ultimi minuti con il messaggio
 * non ancora partito (giro precedente finito il tempo, scheda di riserva che
 * non ha inviato). Solo recenti: accendere un messaggio su un allarme non deve
 * mandarlo a tutte le pratiche gia' aperte da ore.
 */
const FINESTRA_SOSPESI_MS = 10 * 60_000

async function scriviBattito(sb: SupabaseClient, riga: Record<string, unknown>) {
    const { error } = await sb
        .from('alarm_engine_battito')
        .upsert({ fonte: 'server', ultimo_giro: new Date().toISOString(), ...riga }, { onConflict: 'fonte' })
    if (error) console.warn('[alarm-engine-cron] battito non scritto:', error.message)
}

async function inSospeso(sb: SupabaseClient, now: Date): Promise<AlarmEventRow[]> {
    const { data, error } = await sb
        .from('alarm_events')
        .select('*')
        .eq('stato', 'aperto')
        .is('messaggio_cliente_at', null)
        .not('booking_id', 'is', null)
        .gte('triggered_at', new Date(now.getTime() - FINESTRA_SOSPESI_MS).toISOString())
        .range(0, 199)
    if (error) return []
    return (data || []) as AlarmEventRow[]
}

const giro = async () => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Supabase non configurato' }) }
    }
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    })
    const t0 = Date.now()
    const now = new Date()
    try {
        const esito = await eseguiGiro(sb, now)

        // Nuove di questo giro + rimaste indietro: la prenotazione atomica su
        // messaggio_cliente_at impedisce comunque il doppio invio.
        const candidati = new Map<string, AlarmEventRow>()
        for (const e of [...(esito.nuoviEventi || []), ...(await inSospeso(sb, now))]) candidati.set(e.id, e)
        const invii = await messaggiDaInviare(sb, [...candidati.values()])
        let inviati = 0
        for (const inv of invii) {
            if (Date.now() - t0 > BUDGET_MESSAGGI_MS) break
            try {
                const r = await inviaMessaggioAllarme(sb, inv)
                if (r.sent) inviati++
            } catch (e) {
                console.warn('[alarm-engine-cron] messaggio non inviato:', inv.eventId, e)
            }
        }

        const durata = Date.now() - t0
        await scriviBattito(sb, {
            durata_ms: durata,
            aperti: esito.aperti,
            nuovi: esito.nuovi,
            richiusi: esito.richiusi,
            messaggi: inviati,
            errore: null,
        })
        return {
            statusCode: 200,
            body: JSON.stringify({ aperti: esito.aperti, nuovi: esito.nuovi, richiusi: esito.richiusi, messaggi: inviati, durata_ms: durata }),
        }
    } catch (e) {
        // Battito con errore = le schede aperte riprendono il giro da sole.
        const msg = e instanceof CatalogoNonInstallato ? 'catalogo non installato' : ((e as Error)?.message || String(e))
        await scriviBattito(sb, { durata_ms: Date.now() - t0, errore: msg.slice(0, 500) })
        console.error('[alarm-engine-cron] giro fallito:', e)
        return { statusCode: 500, body: JSON.stringify({ error: msg }) }
    }
}

export const handler = schedule('* * * * *', conSystemControl('alarm-engine-cron', giro, { cron: true }))
