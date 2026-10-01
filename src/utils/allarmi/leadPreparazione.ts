/**
 * Allarmi dei gruppi `lead` (reparto Commerciale) e `preparazione` (reparto
 * Lavaggio) — 01/10/2026.
 *
 * Da dove vengono i dati, misurati in produzione prima di scrivere il codice:
 *
 *  - `preventivi`: la richiesta dal sito arriva come riga `bozza` con
 *    source 'website' / 'website_no_cauzione' / 'website_aviation'; l'ufficio
 *    la spedisce su WhatsApp (status 'inviato', whatsapp_sent_at, expires_at =
 *    invio + 24h). Il messaggio al cliente dice "Prezzo bloccato a € X solo per
 *    conferme entro 24h": la scadenza del preventivo E' il prezzo bloccato.
 *    Lo stato 'scaduto' lo scrive solo la tab quando viene aperta, quindi qui
 *    la scadenza si legge da expires_at e non dallo stato.
 *  - `pending_nexi_bookings`: il sito salva la prenotazione QUI quando il
 *    cliente va a pagare; nexi-callback la cancella sia a pagamento riuscito
 *    sia fallito. Una riga che resta = prenotazione iniziata e abbandonata.
 *    Alcune righe restano anche se la prenotazione poi e' nata (stesso ordine
 *    Nexi o stessa email sullo stesso orario): quelle si scartano.
 *  - `customer_invites`: link "compila i tuoi dati e carica i documenti"
 *    mandato dalla tab Lead; used_at resta vuoto finche' il cliente non invia.
 *  - prenotazioni (`ctx.bookings`): link di pagamento in booking_details,
 *    bottone "Pronta" (booking_details.auto_pronta_sent_at) e i lavaggi —
 *    compreso il "Lavaggio rientro" creato a ogni riconsegna, legato per targa.
 *
 * Le occorrenze di preventivi, carrelli abbandonati e inviti non sono
 * prenotazioni: il loro id va comunque in `bookingId` perche' e' la chiave
 * della singola pratica nel motore (alarm_events.booking_id non ha vincoli
 * verso bookings, e senza un id tutte le occorrenze di un allarme
 * collasserebbero in una sola riga).
 */
import { supabase } from '../../supabaseClient'
import { getRomeDateComponents } from '../timezoneUtils'
import {
    sogliaMs,
    isNoleggio,
    isViva,
    isPagato,
    isLavaggio,
    ritiroAt,
    riconsegnaAt,
    appuntamentoAt,
    type AlarmHit,
    type BookingLite,
    type Detector,
    type ModuloAllarmi,
} from '../alarmDetectors'

// ─── Chiavi in ctx.extra ─────────────────────────────────────────────────────

export const K_PREVENTIVI = 'leadPreparazione_preventivi'
export const K_CARRELLI = 'leadPreparazione_carrelli'
export const K_INVITI = 'leadPreparazione_inviti'

// ─── Aiutanti ────────────────────────────────────────────────────────────────

const MIN = 60_000
const GIORNO = 24 * 60 * MIN
/** Oltre una settimana un fatto commerciale o di piazzale non e' un allarme. */
const GIORNI_RILEVANZA = 7
/** Il lavaggio rientro e' messo all'ora della riconsegna o poco dopo. */
const TOLLERANZA_LAVAGGIO = 30 * MIN

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Riga = Record<string, any>

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

function passatoDaMaRecente(evento: Date | null, now: Date, ms: number): boolean {
    if (!evento) return false
    const trascorso = now.getTime() - evento.getTime()
    return trascorso >= ms && trascorso <= GIORNI_RILEVANZA * GIORNO
}

function oraIt(d: Date | null): string {
    if (!d) return '—'
    const c = getRomeDateComponents(d.toISOString())
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(c.day)}/${p(c.month)} ${p(c.hour)}:${p(c.minute)}`
}

function targaNorm(v: unknown): string {
    return String(v || '').replace(/\s/g, '').toUpperCase()
}

function righe(ctx: { extra?: Record<string, unknown[]> }, chiave: string): Riga[] {
    return ((ctx.extra && ctx.extra[chiave]) || []) as Riga[]
}

function etichettaPrenotazione(b: BookingLite, quando?: Date | null): string {
    const mezzo = b.vehicle_name || 'Veicolo'
    const targa = b.vehicle_plate ? ` (${b.vehicle_plate})` : ''
    const cliente = b.customer_name || b.booking_details?.customer?.full || 'Cliente'
    return `${mezzo}${targa} · ${cliente}${quando ? ` · ${oraIt(quando)}` : ''}`
}

function etichettaPreventivo(p: Riga): string {
    const cliente = p.customer_name || p.customer_phone || 'Cliente senza nome'
    const mezzo = p.vehicle_name ? ` · ${p.vehicle_name}` : ''
    const ritiro = tempo(p.pickup_date)
    return `Preventivo · ${cliente}${mezzo}${ritiro ? ` · ritiro ${oraIt(ritiro)}` : ''}`
}

/** Il preventivo riguarda un ritiro gia' passato: non c'e' piu' niente da vendere. */
function preventivoSuperato(p: Riga, now: Date): boolean {
    const ritiro = tempo(p.pickup_date)
    return !!ritiro && ritiro < now
}

function preventivoAperto(p: Riga): boolean {
    return !p.booking_id && !['accettato', 'rifiutato'].includes(String(p.status || '').toLowerCase())
}

/** Noleggio auto (Terra): il bottone "Pronta" e il lavaggio rientro esistono solo li'. */
function isNoleggioTerra(b: BookingLite): boolean {
    if (!isNoleggio(b)) return false
    return ['', 'rental', 'car_rental'].includes(String(b.service_type || ''))
}

function annullata(b: BookingLite): boolean {
    return ['cancelled', 'annullata'].includes(String(b.status || '').toLowerCase())
}

/** Lavaggi (anche i rientri automatici) per targa, ordinati per appuntamento. */
function lavaggiPerTarga(bookings: BookingLite[]): Map<string, Date[]> {
    const out = new Map<string, Date[]>()
    for (const w of bookings) {
        if (String(w.service_type || '') !== 'car_wash' || annullata(w)) continue
        const targa = targaNorm(w.vehicle_plate)
        const quando = appuntamentoAt(w)
        if (!targa || !quando) continue
        const arr = out.get(targa) || []
        arr.push(quando)
        out.set(targa, arr)
    }
    return out
}

function lavaggioTra(lavaggi: Date[] | undefined, da: Date, a: Date): boolean {
    return (lavaggi || []).some(d => d >= da && d <= a)
}

// ─── Lead: preventivi ────────────────────────────────────────────────────────

/**
 * Richiesta di preventivo arrivata dal sito e non ancora spedita al cliente.
 * Serve sia "Preventivo richiesto ma non inviato" sia "Lead senza risposta da
 * X minuti": la richiesta dal sito e' la lead che aspetta una risposta.
 */
const lead_preventivo_richiesto: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return righe(ctx, K_PREVENTIVI)
        .filter(p => {
            if (!String(p.source || '').startsWith('website')) return false
            if (String(p.status || '').toLowerCase() !== 'bozza') return false
            if (p.whatsapp_sent_at || !preventivoAperto(p)) return false
            if (preventivoSuperato(p, ctx.now)) return false
            // Il sito rimette in bozza (e aggiorna updated_at) quando il
            // cliente modifica la richiesta: conta l'ultima versione.
            return passatoDaMaRecente(tempo(p.updated_at) || tempo(p.created_at), ctx.now, ms)
        })
        .map(p => ({
            bookingId: p.id,
            vehicleId: p.vehicle_id || undefined,
            entita: etichettaPreventivo(p),
            dettaglio: `Richiesto dal sito il ${oraIt(tempo(p.updated_at) || tempo(p.created_at))}, non ancora inviato`,
        }))
}

/** Preventivo spedito, ancora valido, il cliente non ha accettato ne' rifiutato. */
const lead_preventivo_senza_risposta: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return righe(ctx, K_PREVENTIVI)
        .filter(p => {
            if (String(p.status || '').toLowerCase() !== 'inviato' || !preventivoAperto(p)) return false
            if (preventivoSuperato(p, ctx.now)) return false
            const scade = tempo(p.expires_at)
            if (scade && scade <= ctx.now) return false // e' un'altra voce: prezzo scaduto
            return passatoDaMaRecente(tempo(p.whatsapp_sent_at), ctx.now, ms)
        })
        .map(p => ({
            bookingId: p.id,
            vehicleId: p.vehicle_id || undefined,
            entita: etichettaPreventivo(p),
            dettaglio: `Inviato il ${oraIt(tempo(p.whatsapp_sent_at))}${p.sent_by ? ` da ${p.sent_by}` : ''}, nessuna risposta`,
        }))
}

/**
 * Preventivo inviato che scade entro la soglia. Serve anche "Prezzo bloccato
 * prossimo alla scadenza": il prezzo e' bloccato fino a expires_at.
 */
const lead_preventivo_in_scadenza: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return righe(ctx, K_PREVENTIVI)
        .filter(p => String(p.status || '').toLowerCase() === 'inviato' && preventivoAperto(p)
            && !preventivoSuperato(p, ctx.now)
            && entroPrima(tempo(p.expires_at), ctx.now, ms))
        .map(p => ({
            bookingId: p.id,
            vehicleId: p.vehicle_id || undefined,
            entita: etichettaPreventivo(p),
            dettaglio: `Prezzo bloccato fino al ${oraIt(tempo(p.expires_at))}`,
        }))
}

/** Prezzo bloccato scaduto senza conferma: il preventivo va rifatto o chiuso. */
const lead_prezzo_bloccato_scaduto: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return righe(ctx, K_PREVENTIVI)
        .filter(p => ['inviato', 'scaduto'].includes(String(p.status || '').toLowerCase())
            && preventivoAperto(p)
            && !preventivoSuperato(p, ctx.now)
            && passatoDaMaRecente(tempo(p.expires_at), ctx.now, ms))
        .map(p => ({
            bookingId: p.id,
            vehicleId: p.vehicle_id || undefined,
            entita: etichettaPreventivo(p),
            dettaglio: `Prezzo bloccato scaduto il ${oraIt(tempo(p.expires_at))}, nessuna conferma`,
        }))
}

// ─── Lead: pagamento e prenotazione dal sito ────────────────────────────────

/** Link di pagamento mandato al cliente e non pagato dopo la soglia. */
const lead_pagamento_richiesto: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isViva(b) || isPagato(b)) continue
        if (!isNoleggio(b) && !isLavaggio(b)) continue
        const d = (b.booking_details || {}) as Riga
        if (!d.nexi_payment_link && !d.payment_link) continue
        if (d.nexi_link_deactivated) continue
        // L'ultimo invio conta: un link rigenerato riparte da capo.
        const invii = [d.payment_link_sent_at, d.payment_link_created_at, d.nexi_link_regenerated_at]
            .map(tempo).filter((x): x is Date => !!x)
        if (invii.length === 0) continue
        const inviato = new Date(Math.max(...invii.map(x => x.getTime())))
        if (!passatoDaMaRecente(inviato, ctx.now, ms)) continue
        const quando = isLavaggio(b) ? appuntamentoAt(b) : ritiroAt(b)
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id || undefined,
            entita: etichettaPrenotazione(b, quando),
            dettaglio: `Link di pagamento inviato il ${oraIt(inviato)}, non ancora pagato`,
        })
    }
    return hits
}

/**
 * Prenotazione iniziata sul sito (cliente arrivato al pagamento Nexi) e mai
 * completata. Piu' tentativi della stessa email sullo stesso orario sono UNA
 * prenotazione abbandonata (si tiene l'ultimo); se la prenotazione poi e'
 * nata — stesso ordine Nexi, o stessa email sullo stesso orario — non e'
 * abbandonata. Mai per telefono o nome: due lead possono condividerli.
 */
const lead_prenotazione_abbandonata: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const ordiniNati = new Set<string>()
    const nateEmailOrario = new Set<string>()
    for (const b of ctx.bookings) {
        const d = (b.booking_details || {}) as Riga
        for (const o of [b.nexi_order_id, d.nexi_order_id]) if (o) ordiniNati.add(String(o))
        const email = String(b.customer_email || '').trim().toLowerCase()
        // appointment_date per i lavaggi, altrimenti il ritiro: come il carrello.
        const quando = appuntamentoAt(b)
        if (email && quando && !annullata(b)) nateEmailOrario.add(`${email}|${quando.getTime()}`)
    }

    const ultimoPerChiave = new Map<string, Riga>()
    for (const c of righe(ctx, K_CARRELLI)) {
        if (c.nexi_order_id && ordiniNati.has(String(c.nexi_order_id))) continue
        const creato = tempo(c.created_at)
        if (!passatoDaMaRecente(creato, ctx.now, ms)) continue
        const quando = tempo(c.appointment_date) || tempo(c.pickup_date)
        if (quando && quando < ctx.now) continue // l'orario chiesto e' passato
        const email = String(c.customer_email || '').trim().toLowerCase()
        if (email && quando && nateEmailOrario.has(`${email}|${quando.getTime()}`)) continue
        const chi = email || String(c.user_id || '') || String(c.id)
        const k = `${chi}|${quando ? quando.getTime() : ''}|${c.service_type || ''}`
        const prec = ultimoPerChiave.get(k)
        if (!prec || (tempo(prec.created_at)?.getTime() || 0) < (creato?.getTime() || 0)) ultimoPerChiave.set(k, c)
    }

    return [...ultimoPerChiave.values()].map(c => {
        const quando = tempo(c.appointment_date) || tempo(c.pickup_date)
        const cliente = c.customer_name || c.customer_email || 'Cliente'
        const importo = Number(c.price_total)
        return {
            bookingId: c.id,
            entita: `${c.vehicle_name || 'Prenotazione dal sito'} · ${cliente}${quando ? ` · ${oraIt(quando)}` : ''}`,
            dettaglio: `Arrivato al pagamento il ${oraIt(tempo(c.created_at))} e non ha completato`
                + (Number.isFinite(importo) && importo > 0 ? ` (${(importo / 100).toFixed(2)} €)` : '')
                + (c.customer_phone ? ` · tel. ${c.customer_phone}` : ''),
        }
    })
}

/** Link "compila dati e documenti" mandato dalla tab Lead e non ancora compilato. */
const lead_invito_non_compilato: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return righe(ctx, K_INVITI)
        .filter(i => {
            if (i.used_at || i.revoked_at) return false
            const scade = tempo(i.expires_at)
            if (scade && scade <= ctx.now) return false
            const inviato = tempo(i.created_at)
            return !!inviato && ctx.now.getTime() - inviato.getTime() >= ms
        })
        .map(i => ({
            bookingId: i.id,
            entita: `Dati e documenti richiesti${i.note ? ` · ${i.note}` : ''}`,
            dettaglio: `Link inviato il ${oraIt(tempo(i.created_at))}${i.created_by_name ? ` da ${i.created_by_name}` : ''}, scade il ${oraIt(tempo(i.expires_at))}`,
        }))
}

// ─── Preparazione ────────────────────────────────────────────────────────────

/** Ritiro vicino e nessuno ha premuto "Pronta" sul noleggio. */
const prep_pronta_mancante: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => {
            if (!isNoleggioTerra(b) || !isViva(b)) return false
            if (['active', 'in_corso'].includes(String(b.status || '').toLowerCase())) return false
            if (!b.vehicle_id && !b.vehicle_plate) return false
            if (b.booking_details?.auto_pronta_sent_at) return false
            return entroPrima(ritiroAt(b), ctx.now, ms)
        })
        .map(b => ({
            bookingId: b.id,
            vehicleId: b.vehicle_id || undefined,
            entita: etichettaPrenotazione(b, ritiroAt(b)),
            dettaglio: 'Mezzo non segnato "Pronta"',
        }))
}

/**
 * Il veicolo e' rientrato (o rientra entro la soglia) e non c'e' nessun
 * lavaggio programmato dopo la riconsegna. Il "Lavaggio rientro" nasce da
 * solo a ogni noleggio: se manca e' stato annullato o la targa non torna.
 */
const prep_rientro_senza_lavaggio: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const lavaggi = lavaggiPerTarga(ctx.bookings)
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggioTerra(b) || annullata(b)) continue
        const targa = targaNorm(b.vehicle_plate)
        const rientro = riconsegnaAt(b)
        if (!targa || !rientro) continue
        const inArrivo = entroPrima(rientro, ctx.now, ms)
        const rientrato = passatoDaMaRecente(rientro, ctx.now, 0)
        if (!inArrivo && !rientrato) continue
        const da = new Date(rientro.getTime() - TOLLERANZA_LAVAGGIO)
        const a = new Date(rientro.getTime() + GIORNI_RILEVANZA * GIORNO)
        if (lavaggioTra(lavaggi.get(targa), da, a)) continue
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id || undefined,
            entita: etichettaPrenotazione(b, rientro),
            dettaglio: `Rientro ${oraIt(rientro)}: nessun lavaggio programmato`,
        })
    }
    return hits
}

/**
 * Prossima uscita entro la soglia e, dal rientro del noleggio precedente
 * sullo stesso mezzo, nessun lavaggio programmato prima del ritiro: il mezzo
 * esce com'e' rientrato. Serve "Veicolo sporco con prenotazione imminente"
 * (60 minuti) e "Veicolo non pronto per prossima uscita" (7 giorni).
 */
const prep_lavaggio_mancante_prima_uscita: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const lavaggi = lavaggiPerTarga(ctx.bookings)
    const noleggiPerTarga = new Map<string, BookingLite[]>()
    for (const b of ctx.bookings) {
        if (!isNoleggioTerra(b) || annullata(b)) continue
        const targa = targaNorm(b.vehicle_plate)
        if (!targa) continue
        const arr = noleggiPerTarga.get(targa) || []
        arr.push(b)
        noleggiPerTarga.set(targa, arr)
    }
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggioTerra(b) || !isViva(b)) continue
        if (['active', 'in_corso'].includes(String(b.status || '').toLowerCase())) continue
        const ritiro = ritiroAt(b)
        if (!entroPrima(ritiro, ctx.now, ms) || !ritiro) continue
        const targa = targaNorm(b.vehicle_plate)
        if (!targa) continue
        // Noleggio precedente: l'ultimo che rientra prima di questo ritiro.
        let prec: BookingLite | null = null
        for (const o of noleggiPerTarga.get(targa) || []) {
            if (o.id === b.id) continue
            const fine = riconsegnaAt(o)
            if (!fine || fine > ritiro) continue
            if (!prec || riconsegnaAt(prec)! < fine) prec = o
        }
        if (!prec) continue // nessun rientro noto: non si puo' dire che sia sporco
        const rientro = riconsegnaAt(prec)!
        if (lavaggioTra(lavaggi.get(targa), new Date(rientro.getTime() - TOLLERANZA_LAVAGGIO), ritiro)) continue
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id || undefined,
            entita: etichettaPrenotazione(b, ritiro),
            dettaglio: `Rientrato il ${oraIt(rientro)} (${prec.customer_name || 'noleggio precedente'}), nessun lavaggio prima del ritiro`,
        })
    }
    return hits
}

// ─── Lettura dati ────────────────────────────────────────────────────────────

async function carica(now: Date): Promise<Record<string, unknown[]>> {
    const da = new Date(now.getTime() - 30 * GIORNO).toISOString()
    const daCarrelli = new Date(now.getTime() - (GIORNI_RILEVANZA + 1) * GIORNO).toISOString()
    const [prev, carrelli, inviti] = await Promise.all([
        supabase
            .from('preventivi')
            .select('id, status, source, booking_id, vehicle_id, vehicle_name, customer_name, customer_phone, pickup_date, created_at, updated_at, whatsapp_sent_at, expires_at, sent_by')
            .in('status', ['bozza', 'inviato', 'scaduto'])
            .is('booking_id', null)
            .or(`created_at.gte.${da},updated_at.gte.${da},expires_at.gte.${da},whatsapp_sent_at.gte.${da}`)
            .order('created_at', { ascending: false })
            .range(0, 999),
        supabase
            .from('pending_nexi_bookings')
            .select('id, nexi_order_id, created_at, customer_name:booking_data->>customer_name, customer_email:booking_data->>customer_email, customer_phone:booking_data->>customer_phone, user_id:booking_data->>user_id, service_type:booking_data->>service_type, vehicle_name:booking_data->>vehicle_name, pickup_date:booking_data->>pickup_date, appointment_date:booking_data->>appointment_date, price_total:booking_data->>price_total')
            .gte('created_at', daCarrelli)
            .order('created_at', { ascending: false })
            .range(0, 499),
        supabase
            .from('customer_invites')
            .select('id, note, created_by_name, created_at, expires_at, used_at, revoked_at')
            .is('used_at', null)
            .is('revoked_at', null)
            .gte('expires_at', now.toISOString())
            .range(0, 199),
    ])
    for (const [nome, r] of [['preventivi', prev], ['pending_nexi_bookings', carrelli], ['customer_invites', inviti]] as const) {
        if (r.error) console.warn(`[allarmi] ${nome} non letta:`, r.error.message)
    }
    return {
        [K_PREVENTIVI]: prev.data || [],
        [K_CARRELLI]: carrelli.data || [],
        [K_INVITI]: inviti.data || [],
    }
}

export const moduloLeadPreparazione: ModuloAllarmi = {
    nome: 'leadPreparazione',
    detectors: {
        lead_preventivo_richiesto,
        lead_preventivo_senza_risposta,
        lead_preventivo_in_scadenza,
        lead_prezzo_bloccato_scaduto,
        lead_pagamento_richiesto,
        lead_prenotazione_abbandonata,
        lead_invito_non_compilato,
        prep_pronta_mancante,
        prep_rientro_senza_lavaggio,
        prep_lavaggio_mancante_prima_uscita,
    },
    carica,
}
