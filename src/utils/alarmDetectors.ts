/**
 * Rilevazioni degli allarmi — il codice che guarda i dati e dice "questa
 * condizione c'e'".
 *
 * 2026-08-21. Il catalogo (19 gruppi, oltre 300 voci) vive in
 * `public.system_alarms`; qui c'e' il CODICE che rileva. La riga del catalogo
 * dice quale rilevazione usare nella colonna `detector`, e con quale soglia:
 * per questo "Ritiro tra 60 minuti", "tra 30" e "tra 10" sono tre righe del
 * catalogo ma UNA sola funzione — cambia solo l'anticipo. E' il motivo per cui
 * 300 allarmi sono gestibili senza scrivere 300 funzioni.
 *
 * Un detector puo' avere un parametro dopo i due punti:
 *   'pickup_missing:indirizzo'  ->  chiave 'pickup_missing', argomento 'indirizzo'
 *
 * Regole di questo file:
 *   - nessuna scrittura, nessuna chiamata di rete: si ricevono i dati gia'
 *     caricati e si restituiscono le occorrenze. Cosi' e' testabile a mano.
 *   - una rilevazione che non e' SICURA non si scrive: meglio una riga "in
 *     attesa" nel gestionale che un allarme che suona a caso. Le voci del
 *     catalogo senza detector restano dichiarate mute.
 */
import { getRomeDateComponents } from './timezoneUtils'
import type { AlarmPriority, AlarmThresholdUnit } from '../data/alarmCatalog'

// ─── Tipi ────────────────────────────────────────────────────────────────────

export interface AlarmCfgLite {
    id: string
    detector: string | null
    threshold_value: number
    threshold_unit: AlarmThresholdUnit
    priority: AlarmPriority
    is_enabled: boolean
    stato_rilevamento: 'attivo' | 'in_attesa'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BookingLite = Record<string, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VehicleLite = Record<string, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CauzioneLite = Record<string, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FirmaLite = Record<string, any>

export interface DetectorContext {
    now: Date
    /** Noleggi non cancellati nella finestra caricata dal motore. */
    bookings: BookingLite[]
    vehicles: VehicleLite[]
    cauzioni: CauzioneLite[]
    /** Ultima richiesta di firma per prenotazione. */
    firme: Map<string, FirmaLite>
    /** Noleggi per veicolo, ordinati per ritiro: serve a sovrapposizioni e code. */
    perVeicolo: Map<string, BookingLite[]>
}

export interface AlarmHit {
    bookingId?: string
    vehicleId?: string
    /** Riga leggibile salvata nello storico: deve restare chiara tra un mese. */
    entita: string
    dettaglio?: string
}

export type Detector = (cfg: AlarmCfgLite, ctx: DetectorContext, arg?: string) => AlarmHit[]

// ─── Aiutanti ────────────────────────────────────────────────────────────────

const MIN = 60_000
const GIORNO = 24 * 60 * MIN

const PAGATO = new Set(['paid', 'completed', 'succeeded'])
const CHIUSI = new Set(['completata', 'completed', 'cancelled', 'annullata', 'expired'])
const SERVIZI_NON_NOLEGGIO = new Set(['car_wash', 'mechanical_service', 'mechanical', 'varie'])

/** Un noleggio vero: non un lavaggio, non una meccanica, non un blocco interno. */
export function isNoleggio(b: BookingLite): boolean {
    if (SERVIZI_NON_NOLEGGIO.has(String(b.service_type || ''))) return false
    if (b.booking_details?.is_courtesy_block) return false
    return true
}

export function isLavaggio(b: BookingLite): boolean {
    if (String(b.service_type || '') !== 'car_wash') return false
    // I rientri sono lavaggi interni creati dal sistema: non hanno un cliente
    // che aspetta, quindi non generano allarmi da front office.
    if (String(b.customer_name || '').trim().toLowerCase() === 'lavaggio rientro') return false
    if (b.booking_details?.internal === true) return false
    if (b.booking_details?.createdBy === 'automatic_system') return false
    return true
}

export function isPagato(b: BookingLite): boolean {
    return PAGATO.has(String(b.payment_status || '').toLowerCase())
}

export function isChiuso(b: BookingLite): boolean {
    return CHIUSI.has(String(b.status || '').toLowerCase())
}

/** Prenotazione ancora "viva": conta per gli allarmi operativi. */
export function isViva(b: BookingLite): boolean {
    return !isChiuso(b)
}

function tempo(v: unknown): Date | null {
    if (!v) return null
    const d = new Date(String(v))
    return Number.isFinite(d.getTime()) ? d : null
}

export function ritiroAt(b: BookingLite): Date | null {
    return tempo(b.pickup_date) || tempo(b.pickupDate)
}

export function riconsegnaAt(b: BookingLite): Date | null {
    return tempo(b.dropoff_date) || tempo(b.returnDate) || tempo(b.return_date)
}

export function appuntamentoAt(b: BookingLite): Date | null {
    return tempo(b.appointment_date) || tempo(b.pickup_date)
}

/** Soglia in millisecondi, qualunque sia l'unita' scelta nel gestionale. */
export function sogliaMs(cfg: AlarmCfgLite): number {
    const v = Number(cfg.threshold_value) || 0
    return cfg.threshold_unit === 'days' ? v * GIORNO : v * MIN
}

/**
 * "Manca meno di X all'evento": vero da quando l'evento entra nella finestra
 * fino a quando arriva. Volutamente a LIVELLO e non a fronte d'onda: un
 * controllo ogni 60 secondi che cerca il minuto esatto perde l'allarme se il
 * giro salta quel minuto — errore gia' fatto e gia' corretto una volta.
 */
function entroPrima(evento: Date | null, now: Date, ms: number): boolean {
    if (!evento) return false
    const diff = evento.getTime() - now.getTime()
    return diff >= 0 && diff <= ms
}

/** "Sono passati almeno X dall'evento". */
function passatoDa(evento: Date | null, now: Date, ms: number): boolean {
    if (!evento) return false
    return now.getTime() - evento.getTime() >= ms
}

function oraIt(d: Date | null): string {
    if (!d) return '—'
    const c = getRomeDateComponents(d.toISOString())
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(c.day)}/${p(c.month)} ${p(c.hour)}:${p(c.minute)}`
}

function etichetta(b: BookingLite, quando?: Date | null): string {
    const mezzo = b.vehicle_name || b.itemName || 'Veicolo'
    const targa = b.vehicle_plate ? ` (${b.vehicle_plate})` : ''
    const cliente = b.customer_name || b.booking_details?.customer?.full || 'Cliente'
    return `${mezzo}${targa} · ${cliente}${quando ? ` · ${oraIt(quando)}` : ''}`
}

function etichettaVeicolo(v: VehicleLite): string {
    return `${v.display_name || 'Veicolo'}${v.plate ? ` (${v.plate})` : ''}`
}

/** Legge un campo cercando tutti gli alias che il DB si porta dietro. */
function primo(obj: Record<string, unknown> | null | undefined, chiavi: string[]): unknown {
    if (!obj) return undefined
    for (const k of chiavi) {
        const v = obj[k]
        if (v !== undefined && v !== null && v !== '') return v
    }
    return undefined
}

// ─── Rilevazioni: ritiro ─────────────────────────────────────────────────────

const pickup_lead: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => isNoleggio(b) && isViva(b) && entroPrima(ritiroAt(b), ctx.now, ms))
        .map(b => ({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)) }))
}

/** Ora del ritiro passata e il noleggio non e' ancora partito. */
const pickup_overdue: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => {
            if (!isNoleggio(b) || !isViva(b)) return false
            if (['active', 'in_corso'].includes(String(b.status || '').toLowerCase())) return false
            return passatoDa(ritiroAt(b), ctx.now, ms)
        })
        .map(b => ({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)) }))
}

/** Il veicolo e' impegnato da un altro noleggio che finisce dopo questo ritiro. */
const pickup_vehicle_busy: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b) || !b.vehicle_id) continue
        const ritiro = ritiroAt(b)
        if (!entroPrima(ritiro, ctx.now, ms)) continue
        const altri = ctx.perVeicolo.get(b.vehicle_id) || []
        const bloccante = altri.find(o => {
            if (o.id === b.id || !isNoleggio(o) || !isViva(o)) return false
            const fine = riconsegnaAt(o)
            const inizio = ritiroAt(o)
            return !!fine && !!inizio && !!ritiro && inizio <= ritiro && fine > ritiro
        })
        if (bloccante) {
            hits.push({
                bookingId: b.id,
                vehicleId: b.vehicle_id,
                entita: etichetta(b, ritiro),
                dettaglio: `Ancora impegnato da ${bloccante.customer_name || 'altro noleggio'} fino alle ${oraIt(riconsegnaAt(bloccante))}`,
            })
        }
    }
    return hits
}

/** Il noleggio precedente doveva rientrare e non e' rientrato. */
const pickup_prev_not_returned: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b) || !b.vehicle_id) continue
        const ritiro = ritiroAt(b)
        if (!entroPrima(ritiro, ctx.now, ms)) continue
        const altri = ctx.perVeicolo.get(b.vehicle_id) || []
        const inRitardo = altri.find(o => {
            if (o.id === b.id || !isNoleggio(o) || !isViva(o)) return false
            const fine = riconsegnaAt(o)
            return !!fine && fine < ctx.now
        })
        if (inRitardo) {
            hits.push({
                bookingId: b.id,
                vehicleId: b.vehicle_id,
                entita: etichetta(b, ritiro),
                dettaglio: `Il noleggio precedente (${inRitardo.customer_name || 'cliente'}) doveva rientrare alle ${oraIt(riconsegnaAt(inRitardo))}`,
            })
        }
    }
    return hits
}

/** Lavaggio programmato sullo stesso mezzo, prima del ritiro, non completato. */
const pickup_wash_pending: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const lavaggiPerTarga = new Map<string, BookingLite[]>()
    for (const w of ctx.bookings) {
        if (String(w.service_type || '') !== 'car_wash') continue
        const targa = String(w.vehicle_plate || '').replace(/\s/g, '').toUpperCase()
        if (!targa) continue
        const arr = lavaggiPerTarga.get(targa) || []
        arr.push(w)
        lavaggiPerTarga.set(targa, arr)
    }
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b)) continue
        const ritiro = ritiroAt(b)
        if (!entroPrima(ritiro, ctx.now, ms)) continue
        const targa = String(b.vehicle_plate || '').replace(/\s/g, '').toUpperCase()
        if (!targa) continue
        const pendente = (lavaggiPerTarga.get(targa) || []).find(w => {
            const quando = appuntamentoAt(w)
            return !!quando && !!ritiro && quando < ritiro && !isChiuso(w)
        })
        if (pendente) {
            hits.push({
                bookingId: b.id,
                vehicleId: b.vehicle_id,
                entita: etichetta(b, ritiro),
                dettaglio: `Lavaggio delle ${oraIt(appuntamentoAt(pendente))} non ancora completato`,
            })
        }
    }
    return hits
}

/**
 * Manca un dato necessario alla consegna.
 * arg: 'indirizzo' | 'autista' | 'operatore'
 */
const pickup_missing: Detector = (cfg, ctx, arg) => {
    const ms = sogliaMs(cfg)
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b)) continue
        const ritiro = ritiroAt(b)
        if (!entroPrima(ritiro, ctx.now, ms)) continue
        const d = (b.booking_details || {}) as Record<string, unknown>
        const fuoriSede = b.delivery_enabled === true || String(b.pickup_location || '') === 'domicilio'
        let manca = false
        let cosa = ''
        if (arg === 'indirizzo') {
            if (!fuoriSede) continue
            manca = !primo(b, ['delivery_address', 'pickup_address']) && !primo(d, ['delivery_address', 'indirizzo_consegna'])
            cosa = 'Indirizzo di consegna non compilato'
        } else if (arg === 'autista') {
            if (!fuoriSede) continue
            manca = !primo(d, ['autista_ritiro', 'autistaRitiro', 'autista_id', 'autistaId'])
            cosa = 'Consegna fuori sede senza autista assegnato'
        } else if (arg === 'operatore') {
            manca = !primo(d, ['operatore', 'operatore_id', 'operatoreId', 'operatore_nome'])
            cosa = 'Nessun operatore assegnato alla consegna'
        }
        if (manca) hits.push({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiro), dettaglio: cosa })
    }
    return hits
}

// ─── Rilevazioni: contratto ──────────────────────────────────────────────────

const contract_missing: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => isNoleggio(b) && isViva(b)
            && entroPrima(ritiroAt(b), ctx.now, ms)
            && !b.contract_url && !ctx.firme.get(b.id))
        .map(b => ({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)), dettaglio: 'Nessun contratto generato' }))
}

const contract_not_sent: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => isNoleggio(b) && isViva(b)
            && entroPrima(ritiroAt(b), ctx.now, ms)
            && !!b.contract_url && !ctx.firme.get(b.id))
        .map(b => ({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)), dettaglio: 'Contratto pronto ma mai inviato alla firma' }))
}

/**
 * Richiesta di firma partita, firma non arrivata.
 * L'anticipo lo decide la riga del catalogo: 120, 60, 30, 10 minuti prima del
 * ritiro sono quattro righe con questa stessa rilevazione. Con
 * `minutes_after` diventa "orario del ritiro raggiunto e ancora non firmato".
 */
const contract_unsigned: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const dopo = cfg.threshold_unit === 'minutes_after'
    return ctx.bookings
        .filter(b => {
            if (!isNoleggio(b) || !isViva(b)) return false
            const firma = ctx.firme.get(b.id)
            if (!firma || firma.signed_at) return false
            return dopo ? passatoDa(ritiroAt(b), ctx.now, ms) : entroPrima(ritiroAt(b), ctx.now, ms)
        })
        .map(b => ({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)), dettaglio: 'Contratto inviato ma non ancora firmato' }))
}

const contract_second_signature_missing: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => {
            if (!isNoleggio(b) || !isViva(b)) return false
            if (!entroPrima(ritiroAt(b), ctx.now, ms)) return false
            const d = (b.booking_details || {}) as Record<string, unknown>
            const haSecondo = !!primo(d, ['second_driver_name', 'second_driver', 'secondo_guidatore'])
            if (!haSecondo) return false
            const firma = ctx.firme.get(b.id)
            return !!firma?.signed_at && !firma.signature_image_2
        })
        .map(b => ({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)), dettaglio: 'Secondo conducente dichiarato, firma sua assente' }))
}

/** La prenotazione e' cambiata dopo che il cliente aveva firmato. */
const contract_changed_after_sign: Detector = (_cfg, ctx) => {
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b)) continue
        const firma = ctx.firme.get(b.id)
        if (!firma?.signed_at) continue
        const modificata = tempo(b.updated_at)
        const firmata = tempo(firma.signed_at)
        if (!modificata || !firmata) continue
        // Un minuto di tolleranza: il salvataggio del contratto tocca la riga
        // subito dopo la firma e non e' una modifica del noleggio.
        if (modificata.getTime() - firmata.getTime() > MIN) {
            hits.push({
                bookingId: b.id,
                vehicleId: b.vehicle_id,
                entita: etichetta(b, ritiroAt(b)),
                dettaglio: `Firmato il ${oraIt(firmata)}, modificato il ${oraIt(modificata)}`,
            })
        }
    }
    return hits
}

// ─── Rilevazioni: documenti e dati cliente ───────────────────────────────────

/** arg: nome della colonna immagine su bookings. */
const doc_missing: Detector = (cfg, ctx, arg) => {
    const ms = sogliaMs(cfg)
    const campi: Record<string, string[]> = {
        identita: ['idCardImage', 'driverIdImage'],
        patente: ['driverLicenseImage', 'license_file_url'],
    }
    const chiavi = campi[String(arg)] || []
    return ctx.bookings
        .filter(b => isNoleggio(b) && isViva(b)
            && entroPrima(ritiroAt(b), ctx.now, ms)
            && !primo(b, chiavi))
        .map(b => ({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)), dettaglio: arg === 'patente' ? 'Patente non caricata' : 'Documento di identita’ non caricato' }))
}

/** arg: 'codice_fiscale' | 'email' | 'telefono' | 'indirizzo' */
const customer_missing: Detector = (cfg, ctx, arg) => {
    const ms = sogliaMs(cfg)
    const alias: Record<string, { top: string[]; cust: string[]; testo: string }> = {
        codice_fiscale: { top: [], cust: ['codice_fiscale', 'codiceFiscale', 'cf'], testo: 'Codice fiscale mancante' },
        email: { top: ['customer_email', 'guest_email'], cust: ['email'], testo: 'Email mancante' },
        telefono: { top: ['customer_phone', 'guest_phone'], cust: ['phone', 'telefono'], testo: 'Numero di telefono mancante' },
        indirizzo: { top: [], cust: ['indirizzo', 'address', 'residenza'], testo: 'Indirizzo di residenza mancante' },
    }
    const spec = alias[String(arg)]
    if (!spec) return []
    return ctx.bookings
        .filter(b => {
            if (!isNoleggio(b) || !isViva(b)) return false
            if (!entroPrima(ritiroAt(b), ctx.now, ms)) return false
            if (primo(b, spec.top)) return false
            return !primo((b.booking_details?.customer || {}) as Record<string, unknown>, spec.cust)
        })
        .map(b => ({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)), dettaglio: spec.testo }))
}

// ─── Rilevazioni: pagamenti ──────────────────────────────────────────────────

/** arg: 'totale' (nulla incassato) | 'parziale' (acconto ma non saldo) */
const payment_open: Detector = (cfg, ctx, arg) => {
    const ms = sogliaMs(cfg)
    const dopo = cfg.threshold_unit === 'minutes_after'
    return ctx.bookings
        .filter(b => {
            if (!isNoleggio(b) || !isViva(b)) return false
            if (isPagato(b)) return false
            const totale = Number(b.price_total) || 0
            const pagato = Number(b.amount_paid) || 0
            if (totale <= 0) return false
            if (arg === 'parziale' && !(pagato > 0 && pagato < totale)) return false
            if (arg === 'totale' && pagato > 0) return false
            return dopo ? passatoDa(ritiroAt(b), ctx.now, ms) : entroPrima(ritiroAt(b), ctx.now, ms)
        })
        .map(b => ({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, ritiroAt(b)),
            dettaglio: `Pagati ${(Number(b.amount_paid) || 0).toFixed(2)} di ${(Number(b.price_total) || 0).toFixed(2)}`,
        }))
}

/** arg: 'scaduto' | 'inviato' | 'mancante' */
const payment_link: Detector = (cfg, ctx, arg) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => {
            if (!isNoleggio(b) || !isViva(b) || isPagato(b)) return false
            if (!entroPrima(ritiroAt(b), ctx.now, ms)) return false
            const d = (b.booking_details || {}) as Record<string, unknown>
            const link = primo(d, ['nexi_payment_link', 'payment_link'])
            const scadenza = tempo(primo(d, ['payment_link_expires_at']))
            const perLink = /link/i.test(String(b.payment_method || ''))
            if (arg === 'mancante') return perLink && !link
            if (arg === 'inviato') return !!link && (!scadenza || scadenza > ctx.now)
            if (arg === 'scaduto') return !!link && !!scadenza && scadenza <= ctx.now
            return false
        })
        .map(b => ({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)) }))
}

/** arg: 'fallito' | 'rifiutato' */
const payment_failed: Detector = (cfg, ctx, arg) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => {
            if (!isNoleggio(b) || !isViva(b) || isPagato(b)) return false
            if (!entroPrima(ritiroAt(b), ctx.now, ms)) return false
            const errore = String(primo(b, ['payment_error_message', 'payment_error', 'nexi_error_message']) || '')
            if (!errore) return false
            const rifiutato = /rifiut|denied|refus|declin/i.test(errore)
            return arg === 'rifiutato' ? rifiutato : !rifiutato
        })
        .map(b => ({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, ritiroAt(b)),
            dettaglio: String(primo(b, ['payment_error_message', 'payment_error', 'nexi_error_message']) || ''),
        }))
}

/** Bonifico annunciato e non ancora visto sul conto. */
const payment_bonifico_pending: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => isNoleggio(b) && isViva(b) && !isPagato(b)
            && /bonifico/i.test(String(b.payment_method || ''))
            && entroPrima(ritiroAt(b), ctx.now, ms))
        .map(b => ({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)) }))
}

// ─── Rilevazioni: cauzione ───────────────────────────────────────────────────

/** Cauzione prevista sul noleggio e nessuna riga incassata in Cauzioni. */
const deposit_uncollected: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const dopo = cfg.threshold_unit === 'minutes_after'
    const perContratto = new Set(
        ctx.cauzioni
            .filter(c => !['Restituita', 'Sbloccata'].includes(String(c.stato || '')))
            .map(c => String(c.riferimento_contratto_id || '')),
    )
    return ctx.bookings
        .filter(b => {
            if (!isNoleggio(b) || !isViva(b)) return false
            const importo = Number(primo(b, ['security_deposit_amount', 'deposit_amount']) || 0)
            if (importo <= 0) return false
            if (String(b.security_deposit_status || '').toLowerCase() === 'collected') return false
            if (perContratto.has(String(b.id))) return false
            return dopo ? passatoDa(ritiroAt(b), ctx.now, ms) : entroPrima(ritiroAt(b), ctx.now, ms)
        })
        .map(b => ({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, ritiroAt(b)),
            dettaglio: `Cauzione prevista ${Number(primo(b, ['security_deposit_amount', 'deposit_amount']) || 0).toFixed(2)}`,
        }))
}

/** arg: 'vicina' | 'raggiunta' | 'superata' — sul termine di restituzione. */
const deposit_return_due: Detector = (cfg, ctx, arg) => {
    const ms = sogliaMs(cfg)
    return ctx.cauzioni
        .filter(c => {
            if (['Restituita', 'Sbloccata'].includes(String(c.stato || ''))) return false
            if (String(c.stato_restituzione || '') === 'RESTITUITA') return false
            const scad = tempo(c.scadenza_cauzione)
            if (!scad) return false
            if (arg === 'vicina') return entroPrima(scad, ctx.now, ms)
            if (arg === 'raggiunta') return scad <= ctx.now && ctx.now.getTime() - scad.getTime() < GIORNO
            if (arg === 'superata') return ctx.now.getTime() - scad.getTime() >= GIORNO
            return false
        })
        .map(c => ({
            vehicleId: c.veicolo_id || undefined,
            entita: `Cauzione ${Number(c.importo || 0).toFixed(2)} · scadenza ${oraIt(tempo(c.scadenza_cauzione))}`,
            dettaglio: `Stato: ${c.stato || '—'}`,
        }))
}

/** arg: 'restituire' | 'sbloccare' */
const deposit_action_due: Detector = (_cfg, ctx, arg) => {
    return ctx.cauzioni
        .filter(c => {
            if (arg === 'restituire') return String(c.stato_restituzione || '') === 'DA_RESTITUIRE'
            if (arg === 'sbloccare') return String(c.stato || '') === 'Bloccata'
            return false
        })
        .map(c => ({
            vehicleId: c.veicolo_id || undefined,
            entita: `Cauzione ${Number(c.importo || 0).toFixed(2)} · ${c.stato || '—'}`,
        }))
}

// ─── Rilevazioni: riconsegna ─────────────────────────────────────────────────

const return_lead: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => isNoleggio(b) && isViva(b) && entroPrima(riconsegnaAt(b), ctx.now, ms))
        .map(b => ({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, riconsegnaAt(b)) }))
}

const return_overdue: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => isNoleggio(b) && isViva(b) && passatoDa(riconsegnaAt(b), ctx.now, ms))
        .map(b => ({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, riconsegnaAt(b)),
            dettaglio: `Doveva rientrare alle ${oraIt(riconsegnaAt(b))}`,
        }))
}

/** In ritardo e c'e' gia' qualcuno in coda per quel veicolo. */
const return_blocks_next: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b) || !b.vehicle_id) continue
        const fine = riconsegnaAt(b)
        if (!fine || fine > ctx.now) continue
        const successivo = (ctx.perVeicolo.get(b.vehicle_id) || []).find(o => {
            if (o.id === b.id || !isNoleggio(o) || !isViva(o)) return false
            const inizio = ritiroAt(o)
            return !!inizio && inizio >= fine && inizio.getTime() - ctx.now.getTime() <= ms
        })
        if (successivo) {
            hits.push({
                bookingId: b.id,
                vehicleId: b.vehicle_id,
                entita: etichetta(b, fine),
                dettaglio: `${successivo.customer_name || 'Prossimo cliente'} ritira alle ${oraIt(ritiroAt(successivo))}`,
            })
        }
    }
    return hits
}

/** Data di fine passata ma il noleggio risulta ancora in corso. */
const return_contract_expired: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => isNoleggio(b)
            && ['active', 'in_corso'].includes(String(b.status || '').toLowerCase())
            && passatoDa(riconsegnaAt(b), ctx.now, ms))
        .map(b => ({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, riconsegnaAt(b)) }))
}

/** Rientrato ma la pratica non e' stata chiusa. */
const return_practice_open: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => isNoleggio(b)
            && ['confirmed', 'confermata'].includes(String(b.status || '').toLowerCase())
            && passatoDa(riconsegnaAt(b), ctx.now, ms))
        .map(b => ({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, riconsegnaAt(b)), dettaglio: 'Ancora in stato confermata dopo la riconsegna' }))
}

// ─── Rilevazioni: lavaggi ────────────────────────────────────────────────────

const wash_lead: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => isLavaggio(b) && isViva(b) && entroPrima(appuntamentoAt(b), ctx.now, ms))
        .map(b => ({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, appuntamentoAt(b)) }))
}

const wash_late: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => {
            if (!isLavaggio(b) || !isViva(b)) return false
            if (['active', 'in_corso'].includes(String(b.status || '').toLowerCase())) return false
            return passatoDa(appuntamentoAt(b), ctx.now, ms)
        })
        .map(b => ({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, appuntamentoAt(b)) }))
}

const wash_unpaid: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => isLavaggio(b) && isViva(b) && !isPagato(b)
            && (Number(b.price_total) || 0) > 0
            && entroPrima(appuntamentoAt(b), ctx.now, ms))
        .map(b => ({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, appuntamentoAt(b)) }))
}

// ─── Rilevazioni: prenotazioni e calendario ──────────────────────────────────

const booking_no_vehicle: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => isNoleggio(b) && isViva(b) && !b.vehicle_id && !b.vehicle_plate
            && entroPrima(ritiroAt(b), ctx.now, ms))
        .map(b => ({ bookingId: b.id, entita: etichetta(b, ritiroAt(b)), dettaglio: 'Nessun veicolo assegnato' }))
}

/** Due noleggi vivi sullo stesso veicolo che si accavallano. */
const booking_overlap: Detector = (_cfg, ctx) => {
    const hits: AlarmHit[] = []
    for (const [vehicleId, lista] of ctx.perVeicolo) {
        const vivi = lista.filter(b => isNoleggio(b) && isViva(b) && ritiroAt(b) && riconsegnaAt(b))
        for (let i = 0; i < vivi.length; i++) {
            for (let j = i + 1; j < vivi.length; j++) {
                const a = vivi[i], b = vivi[j]
                const ia = ritiroAt(a)!, fa = riconsegnaAt(a)!
                const ib = ritiroAt(b)!, fb = riconsegnaAt(b)!
                if (ia < fb && ib < fa) {
                    // Solo se almeno uno dei due non e' gia' passato: una
                    // sovrapposizione archiviata non e' un allarme di oggi.
                    if (fa < ctx.now && fb < ctx.now) continue
                    hits.push({
                        bookingId: b.id,
                        vehicleId,
                        entita: etichetta(b, ib),
                        dettaglio: `Si accavalla con ${a.customer_name || 'altro noleggio'} (${oraIt(ia)} - ${oraIt(fa)})`,
                    })
                }
            }
        }
    }
    return hits
}

/** Troppo poco tempo tra un rientro e la partenza successiva. */
const booking_gap_short: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const hits: AlarmHit[] = []
    for (const [vehicleId, lista] of ctx.perVeicolo) {
        const vivi = lista
            .filter(b => isNoleggio(b) && isViva(b) && ritiroAt(b) && riconsegnaAt(b))
            .sort((a, b) => ritiroAt(a)!.getTime() - ritiroAt(b)!.getTime())
        for (let i = 1; i < vivi.length; i++) {
            const prima = vivi[i - 1], dopo = vivi[i]
            const fine = riconsegnaAt(prima)!, inizio = ritiroAt(dopo)!
            if (inizio < fine) continue // e' una sovrapposizione, la vede l'altro allarme
            if (inizio < ctx.now) continue
            const buco = inizio.getTime() - fine.getTime()
            if (buco < ms) {
                hits.push({
                    bookingId: dopo.id,
                    vehicleId,
                    entita: etichetta(dopo, inizio),
                    dettaglio: `Solo ${Math.round(buco / MIN)} minuti dal rientro precedente`,
                })
            }
        }
    }
    return hits
}

/** arg: 'pagamento' | 'contratto' | 'cauzione' | 'documenti' | 'tutto' */
const booking_missing: Detector = (cfg, ctx, arg) => {
    const ms = sogliaMs(cfg)
    const cauzioniPerBooking = new Set(ctx.cauzioni.map(c => String(c.riferimento_contratto_id || '')))
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b)) continue
        if (!entroPrima(ritiroAt(b), ctx.now, ms)) continue
        const mancanze: string[] = []
        const senzaPagamento = !isPagato(b) && (Number(b.price_total) || 0) > 0
        const senzaContratto = !b.contract_url && !ctx.firme.get(b.id)
        const importoCauzione = Number(primo(b, ['security_deposit_amount', 'deposit_amount']) || 0)
        const senzaCauzione = importoCauzione > 0 && !cauzioniPerBooking.has(String(b.id))
        const senzaDocumenti = !primo(b, ['idCardImage', 'driverIdImage']) || !primo(b, ['driverLicenseImage', 'license_file_url'])
        if (senzaPagamento) mancanze.push('pagamento')
        if (senzaContratto) mancanze.push('contratto')
        if (senzaCauzione) mancanze.push('cauzione')
        if (senzaDocumenti) mancanze.push('documenti')
        const vuole = String(arg || 'tutto')
        if (vuole === 'tutto') {
            if (mancanze.length === 0) continue
            hits.push({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)), dettaglio: `Manca: ${mancanze.join(', ')}` })
        } else if (mancanze.includes(vuole)) {
            hits.push({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)), dettaglio: `Manca ${vuole}` })
        }
    }
    return hits
}

/** arg: 'indisponibile' | 'officina' — veicolo non noleggiabile ma prenotato. */
const booking_vehicle_unavailable: Detector = (cfg, ctx, arg) => {
    const ms = sogliaMs(cfg)
    const perId = new Map(ctx.vehicles.map(v => [String(v.id), v]))
    const stati = arg === 'officina'
        ? ['maintenance', 'officina', 'in_manutenzione', 'repair']
        : ['unavailable', 'non_disponibile', 'retired', 'out_of_service']
    return ctx.bookings
        .filter(b => {
            if (!isNoleggio(b) || !isViva(b) || !b.vehicle_id) return false
            if (!entroPrima(ritiroAt(b), ctx.now, ms)) return false
            const v = perId.get(String(b.vehicle_id))
            return !!v && stati.includes(String(v.status || '').toLowerCase())
        })
        .map(b => ({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, ritiroAt(b)),
            dettaglio: `Veicolo in stato "${perId.get(String(b.vehicle_id))?.status}"`,
        }))
}

// ─── Rilevazioni: fatturazione ───────────────────────────────────────────────

/** Incassato ma nessuna fattura collegata. */
const invoice_missing: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => isPagato(b) && !b.invoice_url
            && (Number(b.price_total) || 0) > 0
            && passatoDa(tempo(b.payment_completed_at) || riconsegnaAt(b) || ritiroAt(b), ctx.now, ms))
        .map(b => ({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)), dettaglio: 'Pagato, fattura non generata' }))
}

// ─── Rilevazioni: veicolo ────────────────────────────────────────────────────

/** arg: nome della colonna data su vehicles. Soglia in giorni PRIMA. */
const vehicle_expiry: Detector = (cfg, ctx, arg) => {
    const ms = sogliaMs(cfg)
    return ctx.vehicles
        .filter(v => {
            if (String(v.status || '').toLowerCase() === 'retired') return false
            const d = tempo(v[String(arg)])
            return entroPrima(d, ctx.now, ms)
        })
        .map(v => ({ vehicleId: v.id, entita: etichettaVeicolo(v), dettaglio: `Scade il ${oraIt(tempo(v[String(arg)]))}` }))
}

/** arg: nome della colonna data su vehicles. Gia' scaduta. */
const vehicle_expired: Detector = (_cfg, ctx, arg) => {
    return ctx.vehicles
        .filter(v => {
            if (String(v.status || '').toLowerCase() === 'retired') return false
            const d = tempo(v[String(arg)])
            return !!d && d < ctx.now
        })
        .map(v => ({ vehicleId: v.id, entita: etichettaVeicolo(v), dettaglio: `Scaduta il ${oraIt(tempo(v[String(arg)]))}` }))
}

/** Il contachilometri non viene aggiornato da troppo tempo. */
const vehicle_km_stale: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.vehicles
        .filter(v => {
            if (String(v.status || '').toLowerCase() === 'retired') return false
            if (!v.current_km) return false
            return passatoDa(tempo(v.updated_at), ctx.now, ms)
        })
        .map(v => ({ vehicleId: v.id, entita: etichettaVeicolo(v), dettaglio: `Ultimo aggiornamento ${oraIt(tempo(v.updated_at))}` }))
}

// ─── Registro ────────────────────────────────────────────────────────────────

export const DETECTORS: Record<string, Detector> = {
    pickup_lead,
    pickup_overdue,
    pickup_vehicle_busy,
    pickup_prev_not_returned,
    pickup_wash_pending,
    pickup_missing,
    contract_missing,
    contract_not_sent,
    contract_unsigned,
    contract_second_signature_missing,
    contract_changed_after_sign,
    doc_missing,
    customer_missing,
    payment_open,
    payment_link,
    payment_failed,
    payment_bonifico_pending,
    deposit_uncollected,
    deposit_return_due,
    deposit_action_due,
    return_lead,
    return_overdue,
    return_blocks_next,
    return_contract_expired,
    return_practice_open,
    wash_lead,
    wash_late,
    wash_unpaid,
    booking_no_vehicle,
    booking_overlap,
    booking_gap_short,
    booking_missing,
    booking_vehicle_unavailable,
    invoice_missing,
    vehicle_expiry,
    vehicle_expired,
    vehicle_km_stale,
}

/**
 * Esegue le rilevazioni per gli allarmi accesi e con rilevazione disponibile.
 * I detector `legacy_*` restano fuori: quelli li fa gia' VehicleAlarmContext
 * con il suo popup sonoro, e farli due volte significherebbe due allarmi per
 * lo stesso fatto.
 */
export function eseguiRilevazioni(
    cfgs: AlarmCfgLite[],
    ctx: DetectorContext,
): { cfg: AlarmCfgLite; hit: AlarmHit }[] {
    const out: { cfg: AlarmCfgLite; hit: AlarmHit }[] = []
    for (const cfg of cfgs) {
        if (!cfg.is_enabled || !cfg.detector) continue
        if (cfg.detector.startsWith('legacy_')) continue
        const [chiave, arg] = cfg.detector.split(':')
        const fn = DETECTORS[chiave]
        if (!fn) continue
        let hits: AlarmHit[] = []
        try {
            hits = fn(cfg, ctx, arg)
        } catch (e) {
            // Una rilevazione che esplode non deve zittire tutte le altre.
            console.error(`[allarmi] rilevazione ${cfg.detector} fallita:`, e)
            continue
        }
        for (const hit of hits) out.push({ cfg, hit })
    }
    return out
}
