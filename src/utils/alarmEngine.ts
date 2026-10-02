/**
 * Motore degli allarmi nel browser.
 *
 * 02/10/2026: il giro vero sta in `motoreAllarmi.ts` e gira sul SERVER ogni
 * minuto (netlify/functions/alarm-engine-cron.ts): apre e chiude le
 * occorrenze e manda i messaggi al cliente anche quando nessuna postazione e'
 * aperta. Il browser qui fa due cose:
 *   - se il server batte (alarm_engine_battito recente), legge soltanto le
 *     occorrenze aperte, per suonare: niente rilevazioni, niente scritture;
 *   - se il server tace (cron fermo, deploy, migration non passata), fa il
 *     giro completo da se', come prima, messaggi compresi. Gli allarmi non
 *     dipendono mai da una sola delle due strade.
 *
 * `alarm_events` = una riga per occorrenza: chi e' nuovo si apre, chi c'era
 * gia' conta una ripetizione, chi non si vede piu' si chiude da solo con la
 * nota "condizione rientrata". Senza, un allarme risolto tornerebbe a suonare
 * al giro dopo e nessuno saprebbe chi ha sistemato cosa.
 */
import { supabase } from '../supabaseClient'
import type { DetectorContext } from './alarmDetectors'
import { PRIORITY_RANK } from '../data/alarmCatalog'
import { authFetch } from './authFetch'
import {
    CatalogoNonInstallato,
    caricaConfigurazioni,
    caricaContesto,
    eseguiGiro,
    leggiNonRisolti,
    messaggiDaInviare,
    serverAttivo,
    type AlarmEventRow,
    type EsitoGiro,
} from './motoreAllarmi'

export type { AlarmEventRow, EsitoGiro, AlarmCfgMotore } from './motoreAllarmi'
export { CatalogoNonInstallato, ALLARMI_APERTI_DAL_SERVER } from './motoreAllarmi'

/**
 * 01/10/2026: le rilevazioni ripartono ogni minuto con l'ora vera, ma la
 * finestra di duemila prenotazioni si rilegge solo ogni due minuti: e' quella
 * la lettura pesante che il 29/08 aveva fatto togliere il polling.
 */
const CONTESTO_VALIDO_MS = 2 * 60 * 1000
let contestoInCache: { letto: number; ctx: DetectorContext } | null = null

async function contestoRecente(now: Date): Promise<DetectorContext> {
    if (contestoInCache && now.getTime() - contestoInCache.letto < CONTESTO_VALIDO_MS) {
        return { ...contestoInCache.ctx, now }
    }
    const ctx = await caricaContesto(supabase, now)
    contestoInCache = { letto: now.getTime(), ctx }
    return ctx
}

/** Riserva: senza server, i messaggi al cliente partono da questa scheda. */
async function inviaMessaggiCliente(nuovi: AlarmEventRow[]): Promise<void> {
    const invii = await messaggiDaInviare(supabase, nuovi)
    for (const corpo of invii) {
        try {
            await authFetch('/.netlify/functions/alarm-send-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(corpo),
            })
        } catch (err) {
            console.warn('[allarmi] messaggio al cliente non inviato:', err)
        }
    }
}

/** Un giro. Ritorna null se il catalogo non e' ancora installato. */
export async function giroAllarmi(now = new Date()): Promise<EsitoGiro | null> {
    try {
        if (await serverAttivo(supabase, now)) {
            // Il server ha gia' fatto il giro di questo minuto: qui si legge
            // solo cosa e' aperto, per suonare con il suono della riga.
            const [cfgs, nonRisolti] = await Promise.all([caricaConfigurazioni(supabase), leggiNonRisolti(supabase)])
            const eventiAperti = nonRisolti.filter(e => e.stato === 'aperto')
            return {
                aperti: eventiAperti.length,
                nuovi: 0,
                richiusi: 0,
                eventiAperti,
                configurazioni: new Map(cfgs.map(c => [c.id, c])),
            }
        }
        const esito = await eseguiGiro(supabase, now, contestoRecente)
        if (esito.nuoviEventi?.length) {
            void inviaMessaggiCliente(esito.nuoviEventi).catch(err => console.warn('[allarmi] messaggi cliente:', err))
        }
        return esito
    } catch (e) {
        if (e instanceof CatalogoNonInstallato) return null
        console.error('[allarmi] giro fallito:', e)
        return null
    }
}

// ─── Azioni dell'operatore ───────────────────────────────────────────────────

export async function risolviEvento(eventId: string, nome: string, nota?: string) {
    const { data: sessione } = await supabase.auth.getUser()
    return supabase
        .from('alarm_events')
        .update({
            stato: 'risolto',
            risolto_at: new Date().toISOString(),
            risolto_da: sessione?.user?.id || null,
            risolto_da_nome: nome,
            ...(nota ? { nota } : {}),
        })
        .eq('id', eventId)
}

export async function posticipaEvento(eventId: string, minuti: number) {
    const { data: sessione } = await supabase.auth.getUser()
    return supabase
        .from('alarm_events')
        .update({
            stato: 'posticipato',
            posticipato_a: new Date(Date.now() + minuti * 60_000).toISOString(),
            posticipato_da: sessione?.user?.id || null,
        })
        .eq('id', eventId)
}

/** Spegne un allarme per UNA sola pratica, senza toccare la regola generale. */
export async function disattivaPerPratica(alarmId: string, bookingId: string | null, vehicleId: string | null, motivo?: string) {
    const { data: sessione } = await supabase.auth.getUser()
    return supabase.from('alarm_overrides').upsert({
        alarm_id: alarmId,
        booking_id: bookingId,
        vehicle_id: bookingId ? null : vehicleId,
        is_enabled: false,
        motivo: motivo || null,
        updated_by: sessione?.user?.id || null,
        updated_at: new Date().toISOString(),
    }, { onConflict: bookingId ? 'alarm_id,booking_id' : 'alarm_id,vehicle_id' })
}

/** Occorrenze aperte, la piu' grave per prima. */
export async function caricaApertiOrdinati(): Promise<AlarmEventRow[]> {
    const { data, error } = await supabase
        .from('alarm_events')
        .select('*')
        .neq('stato', 'risolto')
        .order('triggered_at', { ascending: false })
        .range(0, 499)
    if (error) return []
    const rows = (data || []) as AlarmEventRow[]
    return rows.sort((a, b) => {
        const pa = PRIORITY_RANK[a.priority] ?? 0
        const pb = PRIORITY_RANK[b.priority] ?? 0
        if (pa !== pb) return pb - pa
        return new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime()
    })
}
