/**
 * Allarmi operativi: ritiro, riconsegna, lavaggi, prenotazioni, scadenze
 * (01/10/2026).
 *
 * Solo le voci del catalogo per cui il gestionale scrive DAVVERO il dato da
 * guardare. Misurato sulla produzione prima di scrivere ogni rilevazione:
 *   - "Pronta" = booking_details.auto_pronta_sent_at (bottone Pronta su
 *     Prenotazioni, Prime Wash, calendario lavaggi);
 *   - estensioni = booking_details.extension_history (+ extension_contracts e
 *     il contratto ricondotto in signature_requests);
 *   - rifirma = booking_details.contratto_rifirma_richiesta (Salva con voce su
 *     "rifirma", la abbassa signature-complete);
 *   - conferma della direzione = booking_details.manually_confirmed.
 * Km, carburante, foto, video, chiavi, accessori, check-list, operatore del
 * lavaggio e stato "iniziato/completato" del lavaggio NON esistono nei dati:
 * quelle voci restano "in attesa" e non sono qui.
 *
 * Nomi con prefisso `op_`: unici in tutto il catalogo.
 */
import { supabase } from '../../supabaseClient'
import { getRomeDateComponents } from '../timezoneUtils'
import {
    isNoleggio,
    isLavaggio,
    isPagato,
    isViva,
    ritiroAt,
    riconsegnaAt,
    appuntamentoAt,
    sogliaMs,
    type AlarmHit,
    type BookingLite,
    type Detector,
    type ModuloAllarmi,
} from '../alarmDetectors'

const MIN = 60_000
const ORA_MS = 60 * MIN
const GIORNO = 24 * ORA_MS
/** Come nel registro principale: oltre una settimana e' pulizia, non allarme. */
const GIORNI_RILEVANZA = 7

/** Chiavi di `ctx.extra` caricate da questo modulo. */
export const EXTRA_ANNULLATE = 'operativo_annullate'
export const EXTRA_FIRME = 'operativo_firme'

// ─── Aiutanti locali ─────────────────────────────────────────────────────────

function tempo(v: unknown): Date | null {
    if (!v) return null
    const d = new Date(String(v))
    return Number.isFinite(d.getTime()) ? d : null
}

function entroPrima(evento: Date | null, now: Date, ms: number): boolean {
    if (!evento) return false
    const diff = evento.getTime() - now.getTime()
    return diff >= 0 && diff <= ms
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
    const cliente = b.customer_name || b.booking_details?.customer?.full || b.booking_details?.customer?.fullName || 'Cliente'
    return `${mezzo}${targa} · ${cliente}${quando ? ` · ${oraIt(quando)}` : ''}`
}

function dettagli(b: BookingLite): Record<string, unknown> {
    return (b.booking_details || {}) as Record<string, unknown>
}

function targaNorm(v: unknown): string {
    return String(v || '').replace(/\s/g, '').toUpperCase()
}

function euro(v: unknown): string {
    return (Number(v) || 0).toFixed(2)
}

/** Uscite straordinarie: record compagno di un noleggio, non un noleggio. */
function isUscita(b: BookingLite): boolean {
    return String(b.service_type || '') === 'uscita_straordinaria'
}

function inCorso(b: BookingLite): boolean {
    return ['active', 'in_corso'].includes(String(b.status || '').toLowerCase())
}

// ─── Ritiro ──────────────────────────────────────────────────────────────────

/**
 * Ritiro entro la soglia e il mezzo non e' mai stato segnato "Pronta"
 * (booking_details.auto_pronta_sent_at, bottone Pronta in Prenotazioni).
 */
const op_pickup_not_ready: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => isNoleggio(b) && !isUscita(b) && isViva(b) && !inCorso(b)
            && entroPrima(ritiroAt(b), ctx.now, ms)
            && !dettagli(b).auto_pronta_sent_at)
        .map(b => ({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, ritiroAt(b)),
            dettaglio: 'Veicolo non segnato come Pronta',
        }))
}

function indirizzoCompilato(v: unknown): boolean {
    if (!v) return false
    if (typeof v === 'string') return v.trim() !== ''
    if (typeof v === 'object') {
        const o = v as Record<string, unknown>
        return ['street', 'address', 'via', 'indirizzo', 'city', 'citta'].some(k => String(o[k] || '').trim() !== '')
    }
    return false
}

function autistaAssegnato(d: Record<string, unknown>): boolean {
    // 2026-08-27 (multi-autista): `autisti_ritiro` e' un array; vuoto = nessuno.
    const arr = d.autisti_ritiro
    if (Array.isArray(arr) && arr.length > 0) return true
    const singolo = d.autista_ritiro
    if (singolo && typeof singolo === 'object') return true
    if (typeof singolo === 'string' && singolo.trim() !== '' && singolo !== 'null') return true
    return false
}

/**
 * Consegna fuori sede entro la soglia ancora da organizzare: manca l'autista
 * o l'indirizzo. Un solo allarme che dice cosa manca.
 */
const op_pickup_offsite_todo: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || isUscita(b) || !isViva(b) || inCorso(b)) continue
        const ritiro = ritiroAt(b)
        if (!entroPrima(ritiro, ctx.now, ms)) continue
        const d = dettagli(b)
        const fuoriSede = b.delivery_enabled === true || d.delivery_enabled === true
            || String(b.pickup_location || '') === 'domicilio'
        if (!fuoriSede) continue
        const manca: string[] = []
        if (!autistaAssegnato(d)) manca.push('autista')
        if (!indirizzoCompilato(b.delivery_address) && !indirizzoCompilato(d.delivery_address) && !indirizzoCompilato(d.indirizzo_consegna)) {
            manca.push('indirizzo')
        }
        if (manca.length === 0) continue
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, ritiro),
            dettaglio: `Consegna fuori sede: manca ${manca.join(' e ')}`,
        })
    }
    return hits
}

// ─── Riconsegna: estensioni ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Estensione = Record<string, any>

function estensioni(b: BookingLite): Estensione[] {
    const arr = dettagli(b).extension_history
    return Array.isArray(arr) ? (arr as Estensione[]) : []
}

/** Stessa regola della lista "In attesa di pagamento" (UnpaidBookingsTab). */
function residuoEstensione(e: Estensione): number {
    const nonPagata = e.payment_status === 'pending' || e.payment_status === 'partial' || e.payment_status === 'nexi_pay_by_link'
    if (!nonPagata) return 0
    return (Number(e.additional_amount) || 0) - (Number(e.amount_paid) || 0)
}

/**
 * Noleggio vivo con un'estensione ancora da incassare, e la riconsegna e'
 * entro la soglia o gia' passata (soldi: nessun limite di "vecchiaia").
 */
const op_return_ext_unpaid: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b)) continue
        const fine = riconsegnaAt(b)
        if (!fine || fine.getTime() - ctx.now.getTime() > ms) continue
        const residuo = estensioni(b).reduce((s, e) => s + Math.max(0, residuoEstensione(e)), 0)
        if (residuo <= 0) continue
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, fine),
            dettaglio: `Estensione da incassare: ${euro(residuo)} EUR`,
        })
    }
    return hits
}

/**
 * Estensione registrata (da almeno la soglia, da non piu' di 30 giorni) e mai
 * formalizzata: nessun contratto di estensione generato, nessuna nuova
 * richiesta di firma e nessun contratto ricondotto dopo l'estensione.
 * Senza le firme caricate tace: meglio muto che falso.
 */
const op_return_ext_unformalized: Detector = (cfg, ctx) => {
    const firme = ctx.extra?.[EXTRA_FIRME] as Record<string, unknown>[] | undefined
    if (!firme) return []
    const ms = sogliaMs(cfg)
    const firmePerBooking = new Map<string, Record<string, unknown>[]>()
    for (const f of firme) {
        const k = String(f.booking_id || '')
        if (!k) continue
        const arr = firmePerBooking.get(k) || []
        arr.push(f)
        firmePerBooking.set(k, arr)
    }
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b)) continue
        const lista = estensioni(b)
        if (lista.length === 0) continue
        const ultima = lista[lista.length - 1]
        const quando = tempo(ultima.extended_at)
        if (!quando) continue
        const eta = ctx.now.getTime() - quando.getTime()
        if (eta < ms || eta > 30 * GIORNO) continue
        const fine = riconsegnaAt(b)
        if (fine && ctx.now.getTime() - fine.getTime() > GIORNI_RILEVANZA * GIORNO) continue
        const contratti = dettagli(b).extension_contracts
        const conContratto = Array.isArray(contratti) && contratti.some(c => {
            const g = tempo((c as Record<string, unknown>)?.generated_at)
            return !!g && g >= quando
        })
        if (conContratto) continue
        const conFirma = (firmePerBooking.get(String(b.id)) || []).some(f => {
            const creata = tempo(f.created_at)
            if (creata && creata >= quando) return true
            const agg = tempo(f.updated_at)
            return /ricondotto/i.test(String(f.signed_pdf_url || '')) && !!agg && agg >= quando
        })
        if (conFirma) continue
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, fine),
            dettaglio: `Estensione del ${oraIt(quando)} senza contratto (ne' estensione, ne' ricondotto, ne' nuova firma)`,
        })
    }
    return hits
}

// ─── Lavaggi ─────────────────────────────────────────────────────────────────

/** Durata del lavaggio in minuti; null se il gestionale non la conosce. */
function durataLavaggioMin(b: BookingLite): number | null {
    const d = dettagli(b)
    const v = Number(b.duration_minutes) || Number(d.totalDuration) || 0
    return v > 0 ? v : null
}

/** Durata standard quando la prenotazione non la porta (prenotazioni dal sito). */
const DURATA_LAVAGGIO_STANDARD_MIN = 60

function fineLavaggio(b: BookingLite): { fine: Date | null; stimata: boolean } {
    const inizio = appuntamentoAt(b)
    if (!inizio) return { fine: null, stimata: false }
    const durata = durataLavaggioMin(b)
    return {
        fine: new Date(inizio.getTime() + (durata ?? DURATA_LAVAGGIO_STANDARD_MIN) * MIN),
        stimata: durata == null,
    }
}

/** Lavaggio entro la soglia, non pagato e senza nemmeno un acconto. */
const op_wash_no_deposit: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => {
            if (!isLavaggio(b) || !isViva(b) || isPagato(b)) return false
            if ((Number(b.price_total) || 0) <= 0) return false
            if ((Number(b.amount_paid) || 0) > 0) return false
            if ((Number(dettagli(b).amountPaid) || 0) > 0) return false
            return entroPrima(appuntamentoAt(b), ctx.now, ms)
        })
        .map(b => ({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, appuntamentoAt(b)),
            dettaglio: `Nessun acconto su ${euro((Number(b.price_total) || 0) / 100)} EUR`,
        }))
}

/**
 * Fine prevista del lavaggio passata da almeno la soglia e il cliente non ha
 * ricevuto "Pronta". Solo nelle 24 ore dopo la fine: il giorno dopo non si
 * avvisa piu' nessuno.
 */
const op_wash_ready_not_notified: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isLavaggio(b) || !isViva(b)) continue
        if (dettagli(b).auto_pronta_sent_at) continue
        const { fine, stimata } = fineLavaggio(b)
        if (!fine) continue
        const passato = ctx.now.getTime() - fine.getTime()
        if (passato < ms || passato > GIORNO) continue
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, appuntamentoAt(b)),
            dettaglio: `Fine prevista ${oraIt(fine)}${stimata ? ' (durata non indicata, 60 min)' : ''}: Pronta non inviata`,
        })
    }
    return hits
}

/**
 * Lavaggio (anche di rientro) sullo stesso mezzo che finisce a ridosso del
 * ritiro successivo: la distanza tra fine lavaggio e ritiro e' sotto la soglia
 * (o il lavaggio finisce dopo il ritiro). Solo lavaggi non ancora finiti.
 */
const op_wash_near_pickup: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const noleggiPerTarga = new Map<string, BookingLite[]>()
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || isUscita(b) || !isViva(b) || inCorso(b)) continue
        const t = targaNorm(b.vehicle_plate)
        if (!t) continue
        const arr = noleggiPerTarga.get(t) || []
        arr.push(b)
        noleggiPerTarga.set(t, arr)
    }
    const hits: AlarmHit[] = []
    for (const w of ctx.bookings) {
        if (String(w.service_type || '') !== 'car_wash' || !isViva(w)) continue
        const t = targaNorm(w.vehicle_plate)
        if (!t) continue
        const inizio = appuntamentoAt(w)
        const { fine } = fineLavaggio(w)
        if (!inizio || !fine || fine < ctx.now) continue
        const prossimo = (noleggiPerTarga.get(t) || [])
            .filter(b => { const r = ritiroAt(b); return !!r && r >= inizio })
            .sort((a, b) => ritiroAt(a)!.getTime() - ritiroAt(b)!.getTime())[0]
        if (!prossimo) continue
        const ritiro = ritiroAt(prossimo)!
        const margine = ritiro.getTime() - fine.getTime()
        if (margine > ms) continue
        hits.push({
            bookingId: w.id,
            vehicleId: w.vehicle_id || prossimo.vehicle_id,
            entita: etichetta(w, inizio),
            dettaglio: margine < 0
                ? `Il lavaggio finisce alle ${oraIt(fine)}, dopo il ritiro di ${prossimo.customer_name || 'cliente'} (${oraIt(ritiro)})`
                : `Fine lavaggio ${oraIt(fine)}, ritiro di ${prossimo.customer_name || 'cliente'} alle ${oraIt(ritiro)} (${Math.round(margine / MIN)} min dopo)`,
        })
    }
    return hits
}

// ─── Prenotazioni ────────────────────────────────────────────────────────────

function chiaveCliente(b: BookingLite): string[] {
    const d = dettagli(b)
    const c = (d.customer || {}) as Record<string, unknown>
    const out: string[] = []
    const email = String(b.customer_email || c.email || '').trim().toLowerCase()
    const tel = String(b.customer_phone || c.phone || '').replace(/\D/g, '')
    const nome = String(b.customer_name || c.fullName || '').trim().toLowerCase().replace(/\s+/g, ' ')
    if (email) out.push(`e:${email}`)
    if (tel.length >= 6) out.push(`t:${tel.slice(-9)}`)
    if (nome) out.push(`n:${nome}`)
    return out
}

/**
 * Stessa prenotazione inserita due volte: stesso veicolo, stesso ritiro,
 * stessa riconsegna, stesso cliente. Le doppie volute (allow_double_booking)
 * e le uscite straordinarie (record compagno del noleggio) non contano.
 */
const op_booking_duplicate: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const hits: AlarmHit[] = []
    for (const [vehicleId, lista] of ctx.perVeicolo) {
        const vivi = lista.filter(b => isNoleggio(b) && !isUscita(b) && isViva(b)
            && dettagli(b).allow_double_booking !== true && ritiroAt(b) && riconsegnaAt(b))
        for (let i = 0; i < vivi.length; i++) {
            for (let j = i + 1; j < vivi.length; j++) {
                const a = vivi[i], b = vivi[j]
                if (ritiroAt(a)!.getTime() !== ritiroAt(b)!.getTime()) continue
                if (riconsegnaAt(a)!.getTime() !== riconsegnaAt(b)!.getTime()) continue
                const ka = new Set(chiaveCliente(a))
                if (!chiaveCliente(b).some(k => ka.has(k))) continue
                if (!entroPrima(ritiroAt(b), ctx.now, ms)) continue
                // La piu' recente e' quella da controllare/annullare.
                const [vecchia, nuova] = String(a.created_at || '') <= String(b.created_at || '') ? [a, b] : [b, a]
                hits.push({
                    bookingId: nuova.id,
                    vehicleId,
                    entita: etichetta(nuova, ritiroAt(nuova)),
                    dettaglio: `Doppione della prenotazione ${String(vecchia.id || '').slice(0, 8).toUpperCase()}`,
                })
            }
        }
    }
    return hits
}

/**
 * Prenotazione "In attesa" (pagamento non arrivato) che la direzione non ha
 * confermato a mano, ferma cosi' da almeno la soglia. Stessa regola del
 * colore giallo del calendario.
 */
const op_booking_unverified: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => {
            if (!isNoleggio(b) || isUscita(b) || !isViva(b)) return false
            const ps = String(b.payment_status || '').toLowerCase()
            const inAttesa = ps === 'pending' || ps === 'unpaid' || String(b.status || '') === 'pending_payment'
            if (!inAttesa) return false
            if (dettagli(b).manually_confirmed === true) return false
            const ritiro = ritiroAt(b)
            if (!ritiro || ritiro < ctx.now) return false
            const creata = tempo(b.created_at)
            return !!creata && ctx.now.getTime() - creata.getTime() >= ms
        })
        .map(b => ({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, ritiroAt(b)),
            dettaglio: `In attesa dal ${oraIt(tempo(b.created_at))}, non confermata dalla direzione`,
        }))
}

/**
 * Modificata dopo la firma su una voce che impone la rifirma
 * (contratto_rifirma_richiesta) e la firma nuova non e' arrivata.
 * Vale per i ritiri entro la soglia e per i noleggi gia' fuori.
 */
const op_booking_modified_recheck: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b)) continue
        const d = dettagli(b)
        if (d.contratto_rifirma_richiesta !== true) continue
        const ritiro = ritiroAt(b)
        const fine = riconsegnaAt(b)
        const imminente = entroPrima(ritiro, ctx.now, ms)
        const fuori = !!ritiro && ritiro < ctx.now && !!fine && fine > ctx.now
        if (!imminente && !fuori) continue
        const richiesta = tempo(d.contratto_rifirma_at)
        const firmata = tempo(ctx.firme.get(String(b.id))?.signed_at)
        if (richiesta && firmata && firmata > richiesta) continue
        const voci = Array.isArray(d.contratto_rifirma_voci) ? (d.contratto_rifirma_voci as unknown[]).join(', ') : ''
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, ritiro),
            dettaglio: `Modificata${voci ? ` (${voci})` : ''}${richiesta ? ` il ${oraIt(richiesta)}` : ''}: nuova firma non arrivata`,
        })
    }
    return hits
}

const FIRMA_APERTA = new Set(['pending', 'otp_sent', 'otp_verified'])

/**
 * Prenotazione annullata (da almeno la soglia, da non piu' di 7 giorni) con
 * qualcosa ancora vivo: richiesta di firma aperta, link di pagamento ancora
 * attivo, lavaggio di rientro collegato non annullato.
 */
const op_booking_cancelled_open: Detector = (cfg, ctx) => {
    const annullate = ctx.extra?.[EXTRA_ANNULLATE] as BookingLite[] | undefined
    if (!annullate) return []
    const firme = (ctx.extra?.[EXTRA_FIRME] || []) as Record<string, unknown>[]
    const ms = sogliaMs(cfg)
    const hits: AlarmHit[] = []
    for (const b of annullate) {
        const d = dettagli(b)
        const quando = tempo(d.cancelled_at) || tempo(b.updated_at)
        if (!quando) continue
        const eta = ctx.now.getTime() - quando.getTime()
        if (eta < ms || eta > GIORNI_RILEVANZA * GIORNO) continue
        const aperte: string[] = []
        const firmaAperta = firme.some(f => String(f.booking_id || '') === String(b.id)
            && FIRMA_APERTA.has(String(f.status || ''))
            && !f.signed_at && !f.revoked_at
            && (!tempo(f.token_expires_at) || tempo(f.token_expires_at)! > ctx.now))
        if (firmaAperta) aperte.push('richiesta di firma aperta')
        const scadenzaLink = tempo(d.payment_link_expires_at) || tempo(d.payment_provider_expires_at)
        if (d.nexi_payment_link && d.nexi_link_deactivated !== true && scadenzaLink && scadenzaLink > ctx.now) {
            aperte.push('link di pagamento ancora attivo')
        }
        const lavaggio = ctx.bookings.find(w => String(w.service_type || '') === 'car_wash' && isViva(w)
            && String(dettagli(w).source_booking_id || '') === String(b.id))
        if (lavaggio) aperte.push(`lavaggio del ${oraIt(appuntamentoAt(lavaggio))} ancora in calendario`)
        if (aperte.length === 0) continue
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: `${etichetta(b, ritiroAt(b))} · annullata`,
            dettaglio: `Ancora aperto: ${aperte.join(', ')}`,
        })
    }
    return hits
}

// ─── Lettura dati ────────────────────────────────────────────────────────────

async function carica(now: Date): Promise<Record<string, unknown[]>> {
    const da7 = new Date(now.getTime() - GIORNI_RILEVANZA * GIORNO).toISOString()
    const da60 = new Date(now.getTime() - 60 * GIORNO).toISOString()
    const [annRes, firmeRes] = await Promise.all([
        supabase
            .from('bookings')
            .select('id, status, service_type, customer_name, vehicle_name, vehicle_plate, vehicle_id, pickup_date, dropoff_date, updated_at, booking_details')
            .in('status', ['cancelled', 'annullata'])
            .gte('updated_at', da7)
            .range(0, 499),
        supabase
            .from('signature_requests')
            .select('id, booking_id, status, signed_at, revoked_at, token_expires_at, created_at, updated_at, signed_pdf_url')
            .gte('updated_at', da60)
            .range(0, 1999),
    ])
    const annullate = (annRes.data || []) as BookingLite[]
    const firme = new Map<string, Record<string, unknown>>()
    for (const f of (firmeRes.data || []) as Record<string, unknown>[]) firme.set(String(f.id), f)
    // Firme delle annullate anche se ferme da piu' di 60 giorni: a blocchi.
    const ids = annullate.map(b => String(b.id))
    for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase
            .from('signature_requests')
            .select('id, booking_id, status, signed_at, revoked_at, token_expires_at, created_at, updated_at, signed_pdf_url')
            .in('booking_id', ids.slice(i, i + 200))
        for (const f of (data || []) as Record<string, unknown>[]) firme.set(String(f.id), f)
    }
    // Se una delle due letture fallisce la chiave resta assente: i detector
    // che ne dipendono tacciono invece di allarmare su dati mancanti.
    const out: Record<string, unknown[]> = {}
    if (!annRes.error) out[EXTRA_ANNULLATE] = annullate
    if (!firmeRes.error) out[EXTRA_FIRME] = [...firme.values()]
    return out
}

export const DETECTORS_OPERATIVO: Record<string, Detector> = {
    op_pickup_not_ready,
    op_pickup_offsite_todo,
    op_return_ext_unpaid,
    op_return_ext_unformalized,
    op_wash_no_deposit,
    op_wash_ready_not_notified,
    op_wash_near_pickup,
    op_booking_duplicate,
    op_booking_unverified,
    op_booking_modified_recheck,
    op_booking_cancelled_open,
}

export const moduloOperativo: ModuloAllarmi = {
    nome: 'operativo',
    detectors: DETECTORS_OPERATIVO,
    carica,
}
