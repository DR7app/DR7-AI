/**
 * Motore degli allarmi — carica i dati, esegue le rilevazioni, tiene in ordine
 * lo storico.
 *
 * 2026-08-21. Separato da `alarmDetectors.ts` di proposito: li' c'e' la logica
 * pura (dati dentro, occorrenze fuori, nessuna rete), qui c'e' tutto quello che
 * tocca il database.
 *
 * Come funziona un giro:
 *   1. si leggono gli allarmi accesi e con rilevazione disponibile;
 *   2. si carica UNA volta la finestra di lavoro (noleggi, veicoli, cauzioni,
 *      firme) — non una query per allarme: con oltre 300 righe di catalogo
 *      sarebbe un diluvio di richieste ogni minuto;
 *   3. si eseguono le rilevazioni;
 *   4. si allinea `alarm_events`: chi e' nuovo si apre, chi c'era gia' e non e'
 *      stato risolto conta una ripetizione, chi non si vede piu' si chiude da
 *      solo con la nota "condizione rientrata".
 *
 * Il punto 4 e' il motivo per cui esiste questa tabella: senza, un allarme
 * risolto tornerebbe a suonare al giro dopo, e nessuno saprebbe mai chi ha
 * sistemato cosa.
 */
import { supabase } from '../supabaseClient'
import {
    eseguiRilevazioni,
    type AlarmCfgLite,
    type AlarmHit,
    type BookingLite,
    type DetectorContext,
} from './alarmDetectors'
import { PRIORITY_RANK, type AlarmPriority } from '../data/alarmCatalog'

const GIORNO = 24 * 60 * 60 * 1000
/** Finestra di lavoro: quello che e' successo ieri e quello che succede domani. */
const GIORNI_INDIETRO = 45
const GIORNI_AVANTI = 45

export interface AlarmEventRow {
    id: string
    alarm_id: string
    booking_id: string | null
    vehicle_id: string | null
    entita: string | null
    priority: AlarmPriority
    stato: 'aperto' | 'posticipato' | 'risolto'
    triggered_at: string
    ripetizioni: number
    ultima_notifica: string | null
    posticipato_a: string | null
    risolto_at: string | null
    risolto_da_nome: string | null
    nota: string | null
}

/** Errore parlante quando la migration del catalogo non e' ancora passata. */
export class CatalogoNonInstallato extends Error {
    constructor() { super('Catalogo allarmi non installato') }
}

function isColonnaMancante(err: { code?: string; message?: string } | null): boolean {
    if (!err) return false
    // PGRST204: colonna assente nello schema cache. 42703: colonna inesistente.
    return err.code === 'PGRST204' || err.code === '42703' ||
        /column .* does not exist|could not find the .* column/i.test(String(err.message || ''))
}

/** Le righe del catalogo che oggi possono davvero suonare. */
export async function caricaConfigurazioni(): Promise<AlarmCfgLite[]> {
    const { data, error } = await supabase
        .from('system_alarms')
        .select('id, detector, threshold_value, threshold_unit, priority, is_enabled, stato_rilevamento')
        .eq('is_enabled', true)
        .eq('stato_rilevamento', 'attivo')
    if (error) {
        if (isColonnaMancante(error)) throw new CatalogoNonInstallato()
        throw error
    }
    return (data || []) as AlarmCfgLite[]
}

/**
 * La finestra di lavoro. Una lettura sola, riusata da tutte le rilevazioni.
 * I noleggi si prendono per sovrapposizione con la finestra, esattamente come
 * fa il calendario: un noleggio lungo iniziato tre settimane fa e ancora fuori
 * deve esserci, altrimenti "veicolo ancora fuori" non lo vedrebbe mai.
 */
export async function caricaContesto(now: Date): Promise<DetectorContext> {
    const da = new Date(now.getTime() - GIORNI_INDIETRO * GIORNO).toISOString()
    const a = new Date(now.getTime() + GIORNI_AVANTI * GIORNO).toISOString()

    const [bookingsRes, vehiclesRes, cauzioniRes] = await Promise.all([
        supabase
            .from('bookings')
            .select('*')
            .neq('status', 'cancelled')
            .neq('status', 'annullata')
            .or(
                `and(pickup_date.lte.${a},dropoff_date.gte.${da}),` +
                `and(pickup_date.gte.${da},pickup_date.lte.${a}),` +
                `and(appointment_date.gte.${da},appointment_date.lte.${a})`,
            )
            .order('pickup_date', { ascending: true })
            .range(0, 1999),
        supabase
            .from('vehicles')
            .select('id, display_name, plate, status, current_km, updated_at, insurance_expiry, tax_expiry, inspection_expiry, leasing_expiry')
            .neq('status', 'retired')
            .range(0, 999),
        supabase
            .from('cauzioni')
            .select('id, veicolo_id, riferimento_contratto_id, importo, stato, stato_restituzione, scadenza_cauzione, data_restituzione')
            .range(0, 999),
    ])

    const bookings = (bookingsRes.data || []) as BookingLite[]
    const vehicles = vehiclesRes.data || []
    // Le cauzioni passano dalla RLS: se l'operatore non le vede, le rilevazioni
    // sulle cauzioni semplicemente non scattano — meglio che far esplodere il
    // giro intero.
    const cauzioni = cauzioniRes.data || []

    // Firme: una sola query per tutte le prenotazioni della finestra.
    const firme = new Map<string, Record<string, unknown>>()
    const ids = bookings.filter(b => b.id).map(b => String(b.id))
    for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200)
        const { data } = await supabase
            .from('signature_requests')
            .select('booking_id, signed_at, signature_image, signature_image_2, status, created_at')
            .in('booking_id', chunk)
            .order('created_at', { ascending: true })
        for (const r of data || []) {
            // L'ultima richiesta vince: e' quella che conta per "firmato o no".
            firme.set(String(r.booking_id), r)
        }
    }

    const perVeicolo = new Map<string, BookingLite[]>()
    for (const b of bookings) {
        if (!b.vehicle_id) continue
        const k = String(b.vehicle_id)
        const arr = perVeicolo.get(k) || []
        arr.push(b)
        perVeicolo.set(k, arr)
    }

    return { now, bookings, vehicles, cauzioni, firme, perVeicolo }
}

/** Chiave di identita' di un'occorrenza: allarme + cosa riguarda. */
function chiave(alarmId: string, hit: AlarmHit): string {
    return `${alarmId}|${hit.bookingId || ''}|${hit.bookingId ? '' : (hit.vehicleId || '')}`
}

export interface EsitoGiro {
    aperti: number
    nuovi: number
    richiusi: number
}

/**
 * Allinea `alarm_events` a quello che le rilevazioni vedono adesso.
 *
 * Nota sulle occorrenze posticipate: restano posticipate. Un allarme rimandato
 * a piu' tardi non deve riaprirsi al giro successivo — sarebbe l'esatto
 * contrario di quello che l'operatore ha chiesto premendo "Posticipa".
 */
export async function sincronizzaEventi(
    risultati: { cfg: AlarmCfgLite; hit: AlarmHit }[],
    now: Date,
): Promise<EsitoGiro> {
    const { data: apertiRaw, error } = await supabase
        .from('alarm_events')
        .select('*')
        .neq('stato', 'risolto')
    if (error) {
        if (isColonnaMancante(error)) throw new CatalogoNonInstallato()
        throw error
    }
    const aperti = (apertiRaw || []) as AlarmEventRow[]
    const apertiPerChiave = new Map<string, AlarmEventRow>()
    for (const e of aperti) {
        apertiPerChiave.set(chiave(e.alarm_id, { bookingId: e.booking_id || undefined, vehicleId: e.vehicle_id || undefined, entita: '' }), e)
    }

    const visti = new Set<string>()
    const daInserire: Record<string, unknown>[] = []
    const daRipetere: { id: string; ripetizioni: number }[] = []

    for (const { cfg, hit } of risultati) {
        const k = chiave(cfg.id, hit)
        if (visti.has(k)) continue // stessa occorrenza vista due volte nello stesso giro
        visti.add(k)
        const esistente = apertiPerChiave.get(k)
        if (!esistente) {
            daInserire.push({
                alarm_id: cfg.id,
                booking_id: hit.bookingId || null,
                vehicle_id: hit.bookingId ? null : (hit.vehicleId || null),
                entita: hit.entita,
                priority: cfg.priority,
                stato: 'aperto',
                triggered_at: now.toISOString(),
                nota: hit.dettaglio || null,
            })
        } else if (esistente.stato === 'aperto') {
            daRipetere.push({ id: esistente.id, ripetizioni: (esistente.ripetizioni || 0) + 1 })
        }
    }

    // Nuove occorrenze. `upsert` con ignoreDuplicates per non litigare con
    // l'indice unico se due schede aperte fanno il giro nello stesso istante.
    if (daInserire.length > 0) {
        await supabase.from('alarm_events').upsert(daInserire, { ignoreDuplicates: true })
    }

    // Ripetizioni: UNA richiesta per tutte le occorrenze ancora aperte.
    //
    // 01/09/2026 - prima era una UPDATE PER RIGA: con 845 occorrenze aperte
    // erano centinaia di richieste in fila, a ogni apertura del gestionale e
    // per ogni operatore collegato. Ora l'incremento lo fa il database
    // (`incrementa_ripetizioni_allarmi`), che somma +1 sul valore corrente:
    // due schede che girano nello stesso istante non si sovrascrivono piu'.
    //
    // Se la migration non e' ancora passata, la funzione non esiste: si torna
    // alle UPDATE una per una, cosi' il gestionale non resta senza contatori
    // aspettando il database.
    if (daRipetere.length > 0) {
        const { error: errRpc } = await supabase.rpc('incrementa_ripetizioni_allarmi', {
            ids: daRipetere.map(r => r.id),
        })
        if (errRpc) {
            for (const r of daRipetere) {
                await supabase
                    .from('alarm_events')
                    .update({ ripetizioni: r.ripetizioni })
                    .eq('id', r.id)
            }
        }
    }

    // Chiusura automatica: la condizione non c'e' piu'.
    const daChiudere = aperti.filter(e => e.stato === 'aperto' && !visti.has(
        chiave(e.alarm_id, { bookingId: e.booking_id || undefined, vehicleId: e.vehicle_id || undefined, entita: '' }),
    ))
    if (daChiudere.length > 0) {
        await supabase
            .from('alarm_events')
            .update({
                stato: 'risolto',
                risolto_at: now.toISOString(),
                risolto_da_nome: 'Sistema — condizione rientrata',
            })
            .in('id', daChiudere.map(e => e.id))
    }

    // I posticipi scaduti tornano aperti: e' il senso di "posticipa".
    await supabase
        .from('alarm_events')
        .update({ stato: 'aperto' })
        .eq('stato', 'posticipato')
        .lte('posticipato_a', now.toISOString())

    return { aperti: visti.size, nuovi: daInserire.length, richiusi: daChiudere.length }
}

/**
 * Esclusioni sulla singola pratica. Un allarme spento QUI vale solo per quella
 * prenotazione (o quel veicolo): la regola generale resta accesa per tutte le
 * altre. E' la richiesta "ON/OFF sulla singola pratica".
 */
async function caricaEsclusioni(): Promise<Set<string>> {
    const { data, error } = await supabase
        .from('alarm_overrides')
        .select('alarm_id, booking_id, vehicle_id, is_enabled')
        .eq('is_enabled', false)
    if (error) return new Set()
    return new Set((data || []).map(o =>
        `${o.alarm_id}|${o.booking_id || ''}|${o.booking_id ? '' : (o.vehicle_id || '')}`))
}

/** Un giro completo. Ritorna null se il catalogo non e' ancora installato. */
export async function giroAllarmi(now = new Date()): Promise<EsitoGiro | null> {
    try {
        const cfgs = await caricaConfigurazioni()
        if (cfgs.length === 0) return { aperti: 0, nuovi: 0, richiusi: 0 }
        const [ctx, esclusi] = await Promise.all([caricaContesto(now), caricaEsclusioni()])
        const risultati = eseguiRilevazioni(cfgs, ctx)
            .filter(({ cfg, hit }) => !esclusi.has(chiave(cfg.id, hit)))
        return await sincronizzaEventi(risultati, now)
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
