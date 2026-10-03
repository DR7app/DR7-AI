/**
 * Cuore del motore allarmi, senza browser.
 *
 * 02/10/2026. Prima tutto stava in `alarmEngine.ts`, che importa il client
 * Supabase del gestionale: il giro poteva girare SOLO in una scheda aperta.
 * Nessuna postazione accesa = nessuna rilevazione e nessun messaggio al
 * cliente ("contratto non firmato" alle 9 con il primo operatore alle 9:15 =
 * promemoria mai partito). Ora il giro vive qui, con il client passato da
 * fuori, e lo usano in due:
 *   - `netlify/functions/alarm-engine-cron.ts`, ogni minuto, chiave di servizio:
 *     e' il motore principale, apre e chiude le occorrenze e invia i messaggi;
 *   - `alarmEngine.ts` nel browser, come riserva quando il battito del server
 *     manca da troppo (cron fermo, deploy, Netlify giu').
 *
 * Qui niente import da supabaseClient, authFetch o window: il file deve
 * caricarsi anche in Node.
 */
import {
    eseguiRilevazioni,
    type AlarmCfgLite,
    type AlarmHit,
    type BookingLite,
    type ClienteAllarmi,
    type DetectorContext,
} from './alarmDetectors'
import type { AlarmPriority } from '../data/alarmCatalog'
import { MODULI_ALLARMI, detectorsDeiModuli } from './allarmi'

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

export function isColonnaMancante(err: { code?: string; message?: string } | null): boolean {
    if (!err) return false
    // PGRST204: colonna assente nello schema cache. 42703: colonna inesistente.
    // 42P01 / PGRST205: tabella inesistente.
    return err.code === 'PGRST204' || err.code === '42703' || err.code === '42P01' || err.code === 'PGRST205' ||
        /column .* does not exist|could not find the .* column|relation .* does not exist|could not find the table/i.test(String(err.message || ''))
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
    /** true = il suono continua finche' la finestra non si chiude; false = una volta. */
    suono_continuo?: boolean | null
    notifica_gestionale?: boolean | null
    ripeti_finche_non_risolto?: boolean | null
    ripeti_ogni_minuti?: number | null
}

/** Le righe del catalogo che oggi possono davvero suonare. */
export async function caricaConfigurazioni(sb: ClienteAllarmi): Promise<AlarmCfgMotore[]> {
    let { data, error }: { data: unknown[] | null; error: { code?: string; message?: string } | null } = await sb
        .from('system_alarms')
        .select('id, label, detector, threshold_value, threshold_unit, priority, is_enabled, stato_rilevamento, sound_key, suono_continuo, notifica_gestionale, ripeti_finche_non_risolto, ripeti_ogni_minuti')
        .eq('is_enabled', true)
        .eq('stato_rilevamento', 'attivo')
    // 03/10/2026: `suono_continuo` arriva con la migration 20261003 (a mano).
    // Finche' non c'e', si rilegge senza: gli allarmi non devono tacere per
    // una colonna mancante.
    if (error && isColonnaMancante(error)) {
        ;({ data, error } = await sb
            .from('system_alarms')
            .select('id, label, detector, threshold_value, threshold_unit, priority, is_enabled, stato_rilevamento, sound_key, notifica_gestionale, ripeti_finche_non_risolto, ripeti_ogni_minuti')
            .eq('is_enabled', true)
            .eq('stato_rilevamento', 'attivo'))
    }
    if (error) {
        if (isColonnaMancante(error)) throw new CatalogoNonInstallato()
        throw error
    }
    return (data || []) as AlarmCfgMotore[]
}

/**
 * La finestra di lavoro. Una lettura sola, riusata da tutte le rilevazioni.
 * I noleggi si prendono per sovrapposizione con la finestra, esattamente come
 * fa il calendario: un noleggio lungo iniziato tre settimane fa e ancora fuori
 * deve esserci, altrimenti "veicolo ancora fuori" non lo vedrebbe mai.
 */
export async function caricaContesto(sb: ClienteAllarmi, now: Date): Promise<DetectorContext> {
    const da = new Date(now.getTime() - GIORNI_INDIETRO * GIORNO).toISOString()
    const a = new Date(now.getTime() + GIORNI_AVANTI * GIORNO).toISOString()

    // 01/10/2026: le prenotazioni a pagine da 1000. PostgREST ne restituisce
    // al massimo 1000 per richiesta: con `.range(0, 1999)` in ordine di ritiro
    // le PROSSIME (quelle per cui suonano gli allarmi) sarebbero state le prime
    // a sparire oltre quella soglia.
    const leggiPrenotazioni = async (): Promise<{ data: BookingLite[]; error: unknown }> => {
        const tutte: BookingLite[] = []
        for (let da0 = 0; da0 < 5000; da0 += 1000) {
            const { data, error } = await sb
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
                .order('id', { ascending: true })
                .range(da0, da0 + 999)
            if (error) return { data: [], error }
            tutte.push(...((data || []) as BookingLite[]))
            if (!data || data.length < 1000) break
        }
        return { data: tutte, error: null }
    }

    const [bookingsRes, vehiclesRes, cauzioniRes] = await Promise.all([
        leggiPrenotazioni(),
        sb
            .from('vehicles')
            .select('id, display_name, plate, status, current_km, updated_at, insurance_expiry, tax_expiry, inspection_expiry, leasing_expiry')
            .neq('status', 'retired')
            .range(0, 999),
        sb
            .from('cauzioni')
            .select('id, veicolo_id, riferimento_contratto_id, importo, stato, stato_restituzione, scadenza_cauzione, data_restituzione, metodo, data_incasso')
            .range(0, 999),
    ])

    // 01/10/2026: una lettura fallita (rete, timeout) NON e' "nessuna
    // prenotazione". Prima diventava una lista vuota: il giro chiudeva tutte
    // le occorrenze aperte come "condizione rientrata" e il minuto dopo le
    // riapriva facendole risuonare. Ora il giro si ferma e riprova al prossimo.
    if (bookingsRes.error) throw bookingsRes.error
    if (vehiclesRes.error) throw vehiclesRes.error
    const bookings = bookingsRes.data
    const vehicles = vehiclesRes.data || []
    // Le cauzioni passano dalla RLS: se l'operatore non le vede, le rilevazioni
    // sulle cauzioni semplicemente non scattano — meglio che far esplodere il
    // giro intero.
    const cauzioni = cauzioniRes.data || []

    // Firme: una sola query per tutte le prenotazioni della finestra.
    const firme = new Map<string, Record<string, unknown>>()
    const ids = bookings.filter(b => b.id).map(b => String(b.id))
    // 02/09/2026: i blocchi partono insieme; l'ordine di scrittura nella
    // mappa resta quello dei blocchi, che sono disgiunti per booking_id.
    const blocchi: string[][] = []
    for (let i = 0; i < ids.length; i += 200) blocchi.push(ids.slice(i, i + 200))
    const risposte = await Promise.all(blocchi.map(chunk => sb
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
        try { return await m.carica!(now, sb) } catch (e) {
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
export function chiave(alarmId: string, hit: AlarmHit): string {
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
    /** Occorrenze aperte da QUESTO giro (insert senza doppioni). */
    nuoviEventi?: AlarmEventRow[]
}

/**
 * Le occorrenze non risolte, a pagine da 1000.
 * 02/10/2026: prima una sola lettura senza range: oltre 1000 occorrenze
 * aperte (la demo ne ha avute 944) le altre restavano fuori, non si
 * chiudevano mai da sole e non suonavano.
 */
export async function leggiNonRisolti(sb: ClienteAllarmi): Promise<AlarmEventRow[]> {
    const tutti: AlarmEventRow[] = []
    for (let da = 0; da < 20000; da += 1000) {
        const { data, error } = await sb
            .from('alarm_events')
            .select('*')
            .neq('stato', 'risolto')
            .order('id', { ascending: true })
            .range(da, da + 999)
        if (error) {
            if (isColonnaMancante(error)) throw new CatalogoNonInstallato()
            throw error
        }
        tutti.push(...((data || []) as AlarmEventRow[]))
        if (!data || data.length < 1000) break
    }
    return tutti
}

/** Chi chiude un'occorrenza in automatico. Tutto il resto e' una persona. */
const CHIUSO_DAL_SISTEMA = 'Sistema — condizione rientrata'

/** Un veicolo risolto a mano torna a suonare solo dopo un giorno. */
const RISOLTO_VEICOLO_MS = 24 * 60 * 60 * 1000

/**
 * 03/10/2026 (direzione): "risolto ca veut dire que ca doit plus sonner".
 * Prima "Risolto" chiudeva l'occorrenza, ma al giro dopo (1 minuto) la
 * condizione era ancora vera (es. "ritiro tra 30 minuti") e se ne apriva una
 * nuova: suonava di nuovo ogni 1-2 minuti, e un messaggio al cliente collegato
 * sarebbe ripartito a ogni riapertura.
 * Ora le occorrenze risolte da una PERSONA bloccano la riapertura:
 *   - su una prenotazione: mai piu' per quella prenotazione;
 *   - su un veicolo: per 24 ore (una scadenza ancora aperta deve tornare).
 * La chiusura automatica ("condizione rientrata") non blocca niente.
 */
export async function leggiRisoltiAMano(sb: ClienteAllarmi, now: Date): Promise<Map<string, number>> {
    const mappa = new Map<string, number>()
    const da = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString()
    for (let i = 0; i < 20000; i += 1000) {
        const { data, error } = await sb
            .from('alarm_events')
            .select('alarm_id, booking_id, vehicle_id, risolto_at, risolto_da_nome')
            .eq('stato', 'risolto')
            .gte('risolto_at', da)
            .order('id', { ascending: true })
            .range(i, i + 999)
        if (error) return mappa // nel dubbio si torna al comportamento di prima
        for (const e of (data || []) as Pick<AlarmEventRow, 'alarm_id' | 'booking_id' | 'vehicle_id' | 'risolto_at' | 'risolto_da_nome'>[]) {
            if (e.risolto_da_nome === CHIUSO_DAL_SISTEMA) continue
            const k = chiave(e.alarm_id, { bookingId: e.booking_id || undefined, vehicleId: e.vehicle_id || undefined, entita: '' })
            const t = e.risolto_at ? new Date(e.risolto_at).getTime() : 0
            if (t > (mappa.get(k) || 0)) mappa.set(k, t)
        }
        if (!data || data.length < 1000) break
    }
    return mappa
}

/**
 * Allinea `alarm_events` a quello che le rilevazioni vedono adesso.
 *
 * Nota sulle occorrenze posticipate: restano posticipate. Un allarme rimandato
 * a piu' tardi non deve riaprirsi al giro successivo — sarebbe l'esatto
 * contrario di quello che l'operatore ha chiesto premendo "Posticipa".
 */
export async function sincronizzaEventi(
    sb: ClienteAllarmi,
    risultati: { cfg: AlarmCfgLite; hit: AlarmHit }[],
    now: Date,
): Promise<EsitoGiro> {
    const [aperti, risoltiAMano] = await Promise.all([leggiNonRisolti(sb), leggiRisoltiAMano(sb, now)])
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
        const risoltoAlle = risoltiAMano.get(k)
        if (!esistente && risoltoAlle !== undefined
            && (hit.bookingId || now.getTime() - risoltoAlle < RISOLTO_VEICOLO_MS)) {
            continue // risolto da una persona: non si riapre (vedi leggiRisoltiAMano)
        }
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

    // Nuove occorrenze, una riga alla volta (01/10/2026). L'upsert di gruppo
    // diventava ON CONFLICT (id) e lasciava attivi gli indici unici parziali:
    // se un altro giro aveva gia' aperto UNA delle occorrenze, il 23505
    // respingeva l'intero lotto. Per riga: 23505 = gia' aperta, si va avanti.
    const inseriti: AlarmEventRow[] = []
    if (daInserire.length > 0) {
        const esiti = await Promise.all(daInserire.map(riga => sb
            .from('alarm_events')
            .insert(riga)
            .select('*')
            .maybeSingle()))
        for (const { data: riga, error: errIns } of esiti) {
            if (errIns) {
                if ((errIns as { code?: string }).code !== '23505') console.warn('[allarmi] apertura occorrenza fallita:', errIns)
                continue
            }
            if (riga) inseriti.push(riga as AlarmEventRow)
        }
    }

    // Ripetizioni: UNA richiesta per tutte le occorrenze ancora aperte. Il +1
    // lo fa il database (`incrementa_ripetizioni_allarmi`), cosi' due giri
    // nello stesso istante non si sovrascrivono. Se la funzione non esiste
    // ancora, si torna alle UPDATE una per una.
    if (daRipetere.length > 0) {
        const { error: errRpc } = await sb.rpc('incrementa_ripetizioni_allarmi', {
            ids: daRipetere.map(r => r.id),
        })
        if (errRpc) {
            for (const r of daRipetere) {
                await sb
                    .from('alarm_events')
                    .update({ ripetizioni: r.ripetizioni })
                    .eq('id', r.id)
            }
        }
    }

    // Chiusura automatica: la condizione non c'e' piu'. Tranne gli allarmi
    // aperti dal SERVER (es. pagamento Nexi da verificare): nessun detector
    // li rivede, si chiudono solo a mano.
    const daChiudere = aperti.filter(e => e.stato === 'aperto' && !ALLARMI_APERTI_DAL_SERVER.has(e.alarm_id) && !visti.has(
        chiave(e.alarm_id, { bookingId: e.booking_id || undefined, vehicleId: e.vehicle_id || undefined, entita: '' }),
    ))
    // A blocchi di 200: una sola `.in()` con centinaia di UUID supera la
    // lunghezza della query string e PostgREST risponde 400.
    for (let i = 0; i < daChiudere.length; i += 200) {
        const { error: errChiusura } = await sb
            .from('alarm_events')
            .update({
                stato: 'risolto',
                risolto_at: now.toISOString(),
                risolto_da_nome: CHIUSO_DAL_SISTEMA,
            })
            .in('id', daChiudere.slice(i, i + 200).map(e => e.id))
        if (errChiusura) console.warn('[allarmi] chiusura automatica fallita:', errChiusura)
    }

    // I posticipi scaduti tornano aperti: e' il senso di "posticipa".
    await sb
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
 * Esclusioni sulla singola pratica. Un allarme spento QUI vale solo per quella
 * prenotazione (o quel veicolo): la regola generale resta accesa per le altre.
 */
export async function caricaEsclusioni(sb: ClienteAllarmi): Promise<Set<string>> {
    const { data, error } = await sb
        .from('alarm_overrides')
        .select('alarm_id, booking_id, vehicle_id, is_enabled')
        .eq('is_enabled', false)
    if (error) return new Set()
    return new Set(((data || []) as { alarm_id: string; booking_id: string | null; vehicle_id: string | null }[]).map(o =>
        `${o.alarm_id}|${o.booking_id || ''}|${o.booking_id ? '' : (o.vehicle_id || '')}`))
}

/**
 * Un giro completo: rilevazioni + allineamento di `alarm_events`.
 * Lancia CatalogoNonInstallato se la migration non e' passata; chi chiama
 * decide cosa farne. `contesto` permette al browser di riusare la sua cache.
 */
export async function eseguiGiro(
    sb: ClienteAllarmi,
    now: Date,
    contesto: (now: Date) => Promise<DetectorContext> = n => caricaContesto(sb, n),
): Promise<EsitoGiro> {
    const cfgs = await caricaConfigurazioni(sb)
    if (cfgs.length === 0) return { aperti: 0, nuovi: 0, richiusi: 0, configurazioni: new Map() }
    const [ctx, esclusi] = await Promise.all([contesto(now), caricaEsclusioni(sb)])
    const risultati = eseguiRilevazioni(cfgs, ctx, detectorsDeiModuli())
        .filter(({ cfg, hit }) => !esclusi.has(chiave(cfg.id, hit)))
    const esito = await sincronizzaEventi(sb, risultati, now)
    return { ...esito, configurazioni: new Map(cfgs.map(c => [c.id, c])) }
}

/**
 * Messaggio al cliente collegato all'allarme (01/10/2026, direzione): quando
 * un allarme si apre su una pratica e in Centralina Pro > Allarmi ha un
 * messaggio scelto, il cliente lo riceve. Solo per le occorrenze NUOVE: chi
 * accende l'invio non deve scatenare un invio di massa sulle gia' aperte.
 * La "prenotazione" atomica su alarm_events.messaggio_cliente_at la fa chi
 * spedisce (utils/messaggioAllarme): un messaggio per occorrenza.
 */
export async function messaggiDaInviare(
    sb: ClienteAllarmi,
    nuovi: AlarmEventRow[],
): Promise<{ alarmId: string; entityId: string; templateKey: string; eventId: string }[]> {
    const conPratica = nuovi.filter(e => e.booking_id)
    if (conPratica.length === 0) return []
    const ids = Array.from(new Set(conPratica.map(e => e.alarm_id)))
    const { data, error } = await sb
        .from('system_alarms')
        .select('id, message_key, messaggio_cliente_auto')
        .in('id', ids)
    if (error || !data) return []
    const messaggi = new Map<string, string>()
    for (const r of data as { id: string; message_key: string | null; messaggio_cliente_auto: boolean | null }[]) {
        if (r.messaggio_cliente_auto && r.message_key) messaggi.set(r.id, r.message_key)
    }
    return conPratica
        .filter(e => messaggi.has(e.alarm_id))
        .map(e => ({ alarmId: e.alarm_id, entityId: String(e.booking_id), templateKey: messaggi.get(e.alarm_id)!, eventId: e.id }))
}

// ─── Battito del motore sul server ───────────────────────────────────────────

/** Oltre questo il server si considera fermo e il browser fa il giro da se'. */
export const BATTITO_VALIDO_MS = 150_000

export interface BattitoMotore {
    fonte: string
    ultimo_giro: string
    durata_ms: number | null
    errore: string | null
}

/**
 * Il server sta facendo il giro? Si' se il suo ultimo giro riuscito e'
 * recente. Tabella assente (migration non passata) o lettura fallita = no:
 * nel dubbio il browser fa il giro, come prima.
 */
export async function serverAttivo(sb: ClienteAllarmi, now: Date): Promise<boolean> {
    const { data, error } = await sb
        .from('alarm_engine_battito')
        .select('fonte, ultimo_giro, durata_ms, errore')
        .eq('fonte', 'server')
        .maybeSingle()
    if (error || !data) return false
    const b = data as BattitoMotore
    if (b.errore) return false
    const t = new Date(b.ultimo_giro).getTime()
    return Number.isFinite(t) && now.getTime() - t < BATTITO_VALIDO_MS
}
