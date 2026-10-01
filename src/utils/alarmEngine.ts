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
import { MODULI_ALLARMI, detectorsDeiModuli } from './allarmi'
import { authFetch } from './authFetch'

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

/**
 * 01/10/2026: la riga del catalogo porta anche COME avvisare. Prima il motore
 * leggeva solo la rilevazione: suono, "Gestionale" e "Ripeti se non risolto"
 * scelti in Centralina Pro > Allarmi restavano scritti sotto ogni allarme ma
 * nessuno li leggeva, e i 300 allarmi del catalogo non suonavano mai.
 */
export interface AlarmCfgMotore extends AlarmCfgLite {
    label?: string | null
    sound_key?: string | null
    notifica_gestionale?: boolean | null
    ripeti_finche_non_risolto?: boolean | null
    ripeti_ogni_minuti?: number | null
}

/** Le righe del catalogo che oggi possono davvero suonare. */
export async function caricaConfigurazioni(): Promise<AlarmCfgMotore[]> {
    const { data, error } = await supabase
        .from('system_alarms')
        .select('id, label, detector, threshold_value, threshold_unit, priority, is_enabled, stato_rilevamento, sound_key, notifica_gestionale, ripeti_finche_non_risolto, ripeti_ogni_minuti')
        .eq('is_enabled', true)
        .eq('stato_rilevamento', 'attivo')
    if (error) {
        if (isColonnaMancante(error)) throw new CatalogoNonInstallato()
        throw error
    }
    return (data || []) as AlarmCfgMotore[]
}

/**
 * 01/10/2026: il giro torna a girare ogni minuto (un allarme "10 minuti prima"
 * deve suonare 10 minuti prima, non quando qualcuno riapre la pagina). Le
 * rilevazioni ripartono ogni minuto con l'ora vera, ma la finestra di duemila
 * prenotazioni si rilegge solo ogni due minuti: e' quella la lettura pesante
 * che il 29/08 aveva fatto togliere il polling.
 */
const CONTESTO_VALIDO_MS = 2 * 60 * 1000
let contestoInCache: { letto: number; ctx: DetectorContext } | null = null

async function contestoRecente(now: Date): Promise<DetectorContext> {
    if (contestoInCache && now.getTime() - contestoInCache.letto < CONTESTO_VALIDO_MS) {
        return { ...contestoInCache.ctx, now }
    }
    const ctx = await caricaContesto(now)
    contestoInCache = { letto: now.getTime(), ctx }
    return ctx
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
            .select('id, veicolo_id, riferimento_contratto_id, importo, stato, stato_restituzione, scadenza_cauzione, data_restituzione, metodo, data_incasso')
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
    // 02/09/2026: i blocchi partivano uno dopo l'altro e il giro allarmi
    // finiva secondi dopo l'apertura, tenendo occupata la rete mentre la tab
    // caricava i suoi dati. Ora partono insieme; l'ordine di scrittura nella
    // mappa resta quello dei blocchi, che sono disgiunti per booking_id.
    const blocchi: string[][] = []
    for (let i = 0; i < ids.length; i += 200) blocchi.push(ids.slice(i, i + 200))
    const risposte = await Promise.all(blocchi.map(chunk => supabase
        .from('signature_requests')
        .select('booking_id, signed_at, signature_image, signature_image_2, status, created_at')
        .in('booking_id', chunk)
        .order('created_at', { ascending: true })
        .then(r => r.data || [])))
    for (const data of risposte) {
        for (const r of data) {
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

    // 01/10/2026: i moduli per gruppo leggono le loro tabelle insieme. Un
    // modulo che fallisce non ferma gli altri: i suoi allarmi tacciono e
    // l'errore resta in console.
    const extra: Record<string, unknown[]> = {}
    const letture = await Promise.all(MODULI_ALLARMI.filter(m => m.carica).map(async m => {
        try { return await m.carica!(now) } catch (e) {
            console.warn(`[allarmi] dati del modulo ${m.nome} non caricati:`, e)
            return {}
        }
    }))
    for (const l of letture) Object.assign(extra, l)

    return { now, bookings, vehicles, cauzioni, firme, perVeicolo, extra }
}

/**
 * Voci del catalogo che apre una Netlify function, non un detector del giro:
 * il giro non le chiude mai da solo. Tenere allineato con
 * netlify/functions/nexi-payment-callback.ts (ALLARME_PAGAMENTO_DA_VERIFICARE).
 */
export const ALLARMI_APERTI_DAL_SERVER = new Set<string>(['pag_pagamento_verificare'])

/** Chiave di identita' di un'occorrenza: allarme + cosa riguarda. */
function chiave(alarmId: string, hit: AlarmHit): string {
    return `${alarmId}|${hit.bookingId || ''}|${hit.bookingId ? '' : (hit.vehicleId || '')}`
}

export interface EsitoGiro {
    aperti: number
    nuovi: number
    richiusi: number
    /** Occorrenze aperte dopo il giro (nuove comprese): servono per suonare. */
    eventiAperti?: AlarmEventRow[]
    /** Configurazione per id, per sapere suono e ripetizione di ogni evento. */
    configurazioni?: Map<string, AlarmCfgMotore>
    /** Occorrenze aperte da QUESTA scheda in questo giro (upsert senza doppioni). */
    nuoviEventi?: AlarmEventRow[]
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
    let inseriti: AlarmEventRow[] = []
    if (daInserire.length > 0) {
        const { data: righe } = await supabase
            .from('alarm_events')
            .upsert(daInserire, { ignoreDuplicates: true })
            .select('*')
        inseriti = (righe || []) as AlarmEventRow[]
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
    // 01/10/2026: tranne gli allarmi aperti dal SERVER (es. pagamento Nexi
    // incassato ma non applicato): nessun detector li rivede, quindi senza
    // questa esclusione il giro successivo li chiudeva da solo come
    // "condizione rientrata" e nessuno li vedeva. Si chiudono solo a mano.
    const daChiudere = aperti.filter(e => e.stato === 'aperto' && !ALLARMI_APERTI_DAL_SERVER.has(e.alarm_id) && !visti.has(
        chiave(e.alarm_id, { bookingId: e.booking_id || undefined, vehicleId: e.vehicle_id || undefined, entita: '' }),
    ))
    // 01/10/2026: a blocchi di 200. Una sola `.in()` con centinaia di UUID
    // supera la lunghezza della query string, PostgREST risponde 400 e non si
    // chiude niente (trovato sulla demo il 01/09, vale anche qui).
    for (let i = 0; i < daChiudere.length; i += 200) {
        const { error: errChiusura } = await supabase
            .from('alarm_events')
            .update({
                stato: 'risolto',
                risolto_at: now.toISOString(),
                risolto_da_nome: 'Sistema — condizione rientrata',
            })
            .in('id', daChiudere.slice(i, i + 200).map(e => e.id))
        if (errChiusura) console.warn('[allarmi] chiusura automatica fallita:', errChiusura)
    }

    // I posticipi scaduti tornano aperti: e' il senso di "posticipa".
    await supabase
        .from('alarm_events')
        .update({ stato: 'aperto' })
        .eq('stato', 'posticipato')
        .lte('posticipato_a', now.toISOString())

    const chiusi = new Set(daChiudere.map(e => e.id))
    const eventiAperti = [
        ...aperti.filter(e => e.stato === 'aperto' && !chiusi.has(e.id)),
        ...inseriti.filter(e => e.stato === 'aperto'),
    ]
    return { aperti: visti.size, nuovi: daInserire.length, richiusi: daChiudere.length, eventiAperti, nuoviEventi: inseriti }
}

/**
 * Messaggio al cliente collegato all'allarme (01/10/2026, direzione): quando
 * un allarme si apre su una prenotazione e in Centralina Pro > Allarmi ha un
 * messaggio scelto con "Invia automaticamente" acceso, il cliente lo riceve.
 *
 * Solo per le occorrenze NUOVE di questo giro: l'upsert con ignoreDuplicates
 * restituisce la riga a una sola scheda, e alarm-send-message la "prenota"
 * su alarm_events.messaggio_cliente_at — un messaggio per occorrenza, anche
 * con dieci operatori collegati. Le occorrenze gia' aperte prima di accendere
 * l'invio non ricevono niente: accendere non deve scatenare un invio di massa.
 *
 * Configurazione letta a parte: se la migration non e' ancora passata la
 * lettura fallisce e si salta l'invio, gli allarmi continuano a suonare.
 */
async function inviaMessaggiCliente(nuovi: AlarmEventRow[]): Promise<void> {
    const conPratica = nuovi.filter(e => e.booking_id)
    if (conPratica.length === 0) return
    const ids = Array.from(new Set(conPratica.map(e => e.alarm_id)))
    const { data, error } = await supabase
        .from('system_alarms')
        .select('id, message_key, messaggio_cliente_auto')
        .in('id', ids)
    if (error || !data) return
    const messaggi = new Map<string, string>()
    for (const r of data as { id: string; message_key: string | null; messaggio_cliente_auto: boolean | null }[]) {
        if (r.messaggio_cliente_auto && r.message_key) messaggi.set(r.id, r.message_key)
    }
    for (const e of conPratica) {
        const templateKey = messaggi.get(e.alarm_id)
        if (!templateKey) continue
        try {
            await authFetch('/.netlify/functions/alarm-send-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ alarmId: e.alarm_id, entityId: e.booking_id, templateKey, eventId: e.id }),
            })
        } catch (err) {
            console.warn('[allarmi] messaggio al cliente non inviato:', err)
        }
    }
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
        const [ctx, esclusi] = await Promise.all([contestoRecente(now), caricaEsclusioni()])
        const risultati = eseguiRilevazioni(cfgs, ctx, detectorsDeiModuli())
            .filter(({ cfg, hit }) => !esclusi.has(chiave(cfg.id, hit)))
        const esito = await sincronizzaEventi(risultati, now)
        if (esito.nuoviEventi?.length) {
            void inviaMessaggiCliente(esito.nuoviEventi).catch(err => console.warn('[allarmi] messaggi cliente:', err))
        }
        return { ...esito, configurazioni: new Map(cfgs.map(c => [c.id, c])) }
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
