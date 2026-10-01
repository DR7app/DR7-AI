/**
 * Allarmi dei gruppi `multe` (Amministrazione) e `officina` (01/10/2026).
 *
 * Ogni rilevazione qui sotto legge un dato che il gestionale scrive davvero:
 *
 *   - multe_pec_log        -> una riga per ogni PEC di comunicazione conducente
 *                             inviata dalla tab Multe (prima dell'invio NON
 *                             resta nulla in database: caricamento, lettura e
 *                             abbinamento vivono solo nella schermata).
 *   - bookings.booking_details.penalties / danni
 *                          -> righe di penali e danni con il loro paymentStatus.
 *                             Attenzione: `total` e' il listino PRIMA dello
 *                             sconto, `amountPaid` il netto: confrontarli
 *                             darebbe "non pagato" su ogni penale scontata.
 *                             Fa fede solo paymentStatus.
 *   - pending_addebiti     -> addebiti post-noleggio su carta (MIT Nexi):
 *                             email_sent / second_email_sent = in corso,
 *                             charged / stopped = chiusi, charge_failed /
 *                             error / no_contract_id = falliti.
 *   - vehicles (status 'unavailable' + metadata.unavailable_*) -> il fermo
 *                             del veicolo scritto dalla tab Veicoli, con il
 *                             motivo (Tagliando, Gommista, Officina meccanica,
 *                             Elettrauto, Viaggio). 'maintenance' = Manutenzione.
 *   - bookings 'mechanical_service' -> appuntamenti della Meccanica Prime Wash
 *                             (giorno in appointment_date, ora in appointment_time).
 *   - inv_ordini + inv_articoli -> ordini del Magazzino; i ricambi sono le
 *                             categorie RIC, FRE, FIL.
 *
 * Nessuna chiamata di rete nei detector: legge tutto `carica`, una volta per giro.
 */
import { supabase } from '../../supabaseClient'
import { getRomeDateComponents, romeDateFromParts } from '../timezoneUtils'
import {
    sogliaMs,
    isViva,
    isNoleggio,
    riconsegnaAt,
    type AlarmHit,
    type BookingLite,
    type Detector,
    type ModuloAllarmi,
} from '../alarmDetectors'

// ─── Costanti ────────────────────────────────────────────────────────────────

const MIN = 60_000
const GIORNO = 24 * 60 * MIN

/** Una PEC di multa piu' vecchia di cosi' non apre piu' un "da riaddebitare". */
export const GIORNI_MULTE = 90
/** Un fermo officina scaduto da piu' di cosi' e' un veicolo dimenticato, non un allarme. */
export const GIORNI_OFFICINA = 30
/** Addebiti post-noleggio considerati. */
export const GIORNI_ADDEBITI = 60

const PAGATO = new Set(['paid', 'completed', 'succeeded'])
/** Categorie del Magazzino che sono ricambi veicolo. */
export const CATEGORIE_RICAMBI = new Set(['RIC', 'FRE', 'FIL'])
const ADDEBITO_IN_CORSO = new Set(['email_sent', 'second_email_sent'])
const ADDEBITO_FALLITO = new Set(['charge_failed', 'error', 'no_contract_id'])
const SERVIZI_OFFICINA = new Set(['mechanical_service', 'mechanical'])

/** Motivi di fermo della tab Veicoli che significano officina (non "Viaggio"). */
const MOTIVO_OFFICINA = /offic|taglian|gomm|elettr|carrozz|meccan|manuten|revision|ripar/i

// Chiavi in ctx.extra (prefisso del modulo).
const K_PEC = 'multeOfficina_pec'
const K_PEC_BOOKINGS = 'multeOfficina_pecBookings'
const K_ADDEBITI = 'multeOfficina_addebiti'
const K_VEICOLI = 'multeOfficina_veicoliFermi'
const K_ORDINI = 'multeOfficina_ordiniRicambi'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Riga = Record<string, any>

// ─── Aiutanti ────────────────────────────────────────────────────────────────

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

function giornoIt(d: Date | null): string {
    if (!d) return '—'
    const c = getRomeDateComponents(d.toISOString())
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(c.day)}/${p(c.month)}/${c.year}`
}

function euro(n: unknown): string {
    const v = Number(n)
    return Number.isFinite(v) ? `€${v.toFixed(2).replace('.', ',')}` : ''
}

function righe(ctx: { extra?: Record<string, unknown[]> }, k: string): Riga[] {
    return ((ctx.extra && ctx.extra[k]) || []) as Riga[]
}

function etichettaBooking(b: Riga): string {
    const mezzo = b.vehicle_name || 'Veicolo'
    const targa = b.vehicle_plate ? ` (${b.vehicle_plate})` : ''
    const cliente = b.customer_name || b.booking_details?.customer?.fullName || 'Cliente'
    return `${mezzo}${targa} · ${cliente}`
}

function etichettaVeicolo(v: Riga): string {
    return `${v.display_name || 'Veicolo'}${v.plate ? ` (${v.plate})` : ''}`
}

/** Appuntamento meccanica: il giorno sta in appointment_date, l'ora in appointment_time. */
export function appuntamentoOfficinaAt(b: BookingLite): Date | null {
    const giorno = tempo(b.appointment_date)
    if (!giorno) return null
    const hm = String(b.appointment_time || '').trim()
    if (!/^\d{1,2}:\d{2}/.test(hm)) return giorno
    const c = getRomeDateComponents(giorno.toISOString())
    const p = (n: number) => String(n).padStart(2, '0')
    const d = romeDateFromParts(`${c.year}-${p(c.month)}-${p(c.day)}`, hm.slice(0, 5))
    return Number.isFinite(d.getTime()) ? d : giorno
}

/** Inizio e fine del fermo scritto nella tab Veicoli (ora di default come il calendario: 09:00 / 18:00). */
export function fermoVeicolo(v: Riga): { da: Date | null; a: Date | null; motivo: string } {
    const m = v.metadata || {}
    const da = m.unavailable_from ? romeDateFromParts(String(m.unavailable_from).slice(0, 10), m.unavailable_from_time || '09:00') : null
    const a = m.unavailable_until ? romeDateFromParts(String(m.unavailable_until).slice(0, 10), m.unavailable_until_time || '18:00') : null
    return {
        da: da && Number.isFinite(da.getTime()) ? da : null,
        a: a && Number.isFinite(a.getTime()) ? a : null,
        motivo: String(m.unavailable_reason || '').trim(),
    }
}

/** Veicolo fermo per officina: stato Manutenzione, oppure Non disponibile con motivo da officina. */
export function inOfficina(v: Riga): boolean {
    const stato = String(v.status || '').toLowerCase()
    if (['maintenance', 'officina', 'in_manutenzione', 'repair'].includes(stato)) return true
    if (stato !== 'unavailable') return false
    return MOTIVO_OFFICINA.test(fermoVeicolo(v).motivo)
}

/** Voci (penali + danni) di una prenotazione ancora da incassare. */
function vociNonPagate(b: BookingLite): Riga[] {
    const d = b.booking_details || {}
    const tutte = [
        ...(Array.isArray(d.penalties) ? d.penalties : []),
        ...(Array.isArray(d.danni) ? d.danni : []),
    ] as Riga[]
    return tutte.filter(v => v && !PAGATO.has(String(v.paymentStatus || '').toLowerCase()))
}

const MULTA_ADDEBITATA = /mult|sanzion|verbal/i

// ─── Rilevazioni: multe ──────────────────────────────────────────────────────

/**
 * Multa da riaddebitare: e' partita la PEC di comunicazione conducente per un
 * noleggio, ma su quel noleggio non c'e' ancora la penale "Multe e sanzioni"
 * (Centralina Pro, campo contratto PenaleSpeseMulta). Soglia = tempo dalla PEC.
 */
const multe_da_riaddebitare: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const perId = new Map(righe(ctx, K_PEC_BOOKINGS).map(b => [String(b.id), b]))
    const visti = new Map<string, AlarmHit>()
    for (const l of righe(ctx, K_PEC)) {
        if (!l.booking_id) continue
        const inviata = tempo(l.created_at)
        if (!passatoDa(inviata, ctx.now, ms)) continue
        if (ctx.now.getTime() - inviata!.getTime() > GIORNI_MULTE * GIORNO) continue
        const b = perId.get(String(l.booking_id))
        if (!b) continue
        if (['cancelled', 'annullata'].includes(String(b.status || '').toLowerCase())) continue
        const penali = Array.isArray(b.penalties) ? b.penalties as Riga[] : []
        if (penali.some(p => MULTA_ADDEBITATA.test(String(p?.label || '')))) continue
        const id = String(b.id)
        const verbale = l.numero_verbale ? `verbale ${l.numero_verbale}` : 'verbale senza numero'
        const prec = visti.get(id)
        if (prec) { prec.dettaglio += `, ${verbale}`; continue }
        visti.set(id, {
            bookingId: id,
            vehicleId: b.vehicle_id || undefined,
            entita: `${etichettaBooking(b)} · multa ${l.targa || ''}`.trim(),
            dettaglio: `PEC inviata il ${giornoIt(inviata)}, nessuna penale "Multe e sanzioni" sul noleggio: ${verbale}`,
        })
    }
    return [...visti.values()]
}

/**
 * Spesa post-noleggio da recuperare: penali o danni ancora non pagati su un
 * noleggio riconsegnato da almeno la soglia, oppure un addebito su carta
 * post-noleggio fallito. Sono soldi: nessun limite di 7 giorni.
 */
const multe_spesa_da_recuperare: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const hits = new Map<string, AlarmHit>()
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || ['cancelled', 'annullata'].includes(String(b.status || '').toLowerCase())) continue
        if (!passatoDa(riconsegnaAt(b), ctx.now, ms)) continue
        const voci = vociNonPagate(b)
        if (voci.length === 0) continue
        const totale = voci.reduce((s, v) => s + (Number(v.total ?? v.amount) || 0), 0)
        hits.set(String(b.id), {
            bookingId: b.id,
            vehicleId: b.vehicle_id || undefined,
            entita: etichettaBooking(b),
            dettaglio: `Da incassare ${euro(totale)}: ${voci.map(v => v.label || v.description || 'voce').join(', ')}`,
        })
    }
    for (const a of righe(ctx, K_ADDEBITI)) {
        if (!ADDEBITO_FALLITO.has(String(a.status || ''))) continue
        if (!a.booking_id || !passatoDa(tempo(a.created_at), ctx.now, ms)) continue
        const id = String(a.booking_id)
        const testo = `Addebito su carta fallito (${a.status}) ${euro((Number(a.amount_cents) || 0) / 100)}${a.causale ? ` · ${a.causale}` : ''}`
        const prec = hits.get(id)
        if (prec) { prec.dettaglio = `${prec.dettaglio}; ${testo}`; continue }
        hits.set(id, {
            bookingId: id,
            entita: `${a.customer_name || 'Cliente'}${a.contract_number ? ` · contratto ${a.contract_number}` : ''}`,
            dettaglio: testo,
        })
    }
    return [...hits.values()]
}

/**
 * Pratica post-noleggio ancora aperta: un addebito post-noleggio su carta
 * (email al cliente, poi addebito MIT) e' in corso da almeno la soglia e non e'
 * ne' incassato ne' fermato.
 */
const multe_pratica_post_noleggio_aperta: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const hits = new Map<string, AlarmHit>()
    for (const a of righe(ctx, K_ADDEBITI)) {
        if (!ADDEBITO_IN_CORSO.has(String(a.status || ''))) continue
        const creato = tempo(a.created_at)
        if (!a.booking_id || !passatoDa(creato, ctx.now, ms)) continue
        const id = String(a.booking_id)
        if (hits.has(id)) continue
        hits.set(id, {
            bookingId: id,
            entita: `${a.customer_name || 'Cliente'}${a.contract_number ? ` · contratto ${a.contract_number}` : ''}`,
            dettaglio: `Addebito ${euro((Number(a.amount_cents) || 0) / 100)} aperto dal ${giornoIt(creato)} (${a.status === 'email_sent' ? 'prima email inviata' : 'seconda email inviata'})${a.causale ? ` · ${a.causale}` : ''}`,
        })
    }
    return [...hits.values()]
}

// ─── Rilevazioni: officina ───────────────────────────────────────────────────

/** Appuntamento in Meccanica entro la soglia (24 ore, 60 minuti...). */
const officina_appuntamento_lead: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return ctx.bookings
        .filter(b => SERVIZI_OFFICINA.has(String(b.service_type || '')) && isViva(b)
            && entroPrima(appuntamentoOfficinaAt(b), ctx.now, ms))
        .map(b => ({
            bookingId: b.id,
            vehicleId: b.vehicle_id || undefined,
            entita: `${etichettaBooking(b)} · ${oraIt(appuntamentoOfficinaAt(b))}`,
            dettaglio: b.service_name ? String(b.service_name) : undefined,
        }))
}

/** Fermo officina che comincia entro la soglia: il veicolo va portato. */
const officina_veicolo_da_portare: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return righe(ctx, K_VEICOLI)
        .filter(v => String(v.status) === 'unavailable' && inOfficina(v) && entroPrima(fermoVeicolo(v).da, ctx.now, ms))
        .map(v => {
            const f = fermoVeicolo(v)
            return {
                vehicleId: String(v.id),
                entita: `${etichettaVeicolo(v)} · ${oraIt(f.da)}`,
                dettaglio: `${f.motivo} dal ${oraIt(f.da)}${f.a ? ` al ${oraIt(f.a)}` : ''}`,
            }
        })
}

/** Fermo officina che finisce entro la soglia: il veicolo va ritirato. */
const officina_veicolo_da_ritirare: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return righe(ctx, K_VEICOLI)
        .filter(v => String(v.status) === 'unavailable' && inOfficina(v) && entroPrima(fermoVeicolo(v).a, ctx.now, ms))
        .map(v => {
            const f = fermoVeicolo(v)
            return {
                vehicleId: String(v.id),
                entita: `${etichettaVeicolo(v)} · ${oraIt(f.a)}`,
                dettaglio: `${f.motivo}: pronto previsto ${oraIt(f.a)}`,
            }
        })
}

/**
 * Data di fine fermo passata da almeno la soglia e il veicolo e' ancora segnato
 * in officina. Oltre GIORNI_OFFICINA e' un fermo dimenticato in gestionale.
 */
const officina_oltre_data_prevista: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    return righe(ctx, K_VEICOLI)
        .filter(v => {
            if (String(v.status) !== 'unavailable' || !inOfficina(v)) return false
            const fine = fermoVeicolo(v).a
            if (!passatoDa(fine, ctx.now, ms)) return false
            return ctx.now.getTime() - fine!.getTime() <= GIORNI_OFFICINA * GIORNO
        })
        .map(v => {
            const f = fermoVeicolo(v)
            return {
                vehicleId: String(v.id),
                entita: etichettaVeicolo(v),
                dettaglio: `${f.motivo}: rientro previsto ${oraIt(f.a)}, ancora Non disponibile`,
            }
        })
}

/**
 * Veicolo fermo: in officina da almeno la soglia (fermo iniziato e non ancora
 * finito), oppure in stato Manutenzione (senza date: conta lo stato).
 */
const officina_veicolo_fermo: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const hits: AlarmHit[] = []
    for (const v of righe(ctx, K_VEICOLI)) {
        if (!inOfficina(v)) continue
        const stato = String(v.status || '').toLowerCase()
        if (stato !== 'unavailable') {
            hits.push({ vehicleId: String(v.id), entita: etichettaVeicolo(v), dettaglio: 'In stato Manutenzione' })
            continue
        }
        const f = fermoVeicolo(v)
        if (!passatoDa(f.da, ctx.now, ms)) continue
        if (f.a && f.a.getTime() <= ctx.now.getTime()) continue // finito: lo dice "oltre data prevista"
        const giorni = Math.floor((ctx.now.getTime() - f.da!.getTime()) / GIORNO)
        hits.push({
            vehicleId: String(v.id),
            entita: etichettaVeicolo(v),
            dettaglio: `${f.motivo} da ${giorni} ${giorni === 1 ? 'giorno' : 'giorni'} (dal ${oraIt(f.da)})${f.a ? `, rientro previsto ${oraIt(f.a)}` : ''}`,
        })
    }
    return hits
}

/**
 * Ricambi ordinati dal Magazzino (inviati al fornitore, non ancora ricevuti)
 * negli ultimi giorni di soglia. Gli ordini non hanno un veicolo: una sola
 * occorrenza con l'elenco.
 */
const officina_ricambio_ordinato: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const ordini = righe(ctx, K_ORDINI).filter(o => {
        if (String(o.stato || '') !== 'inviato' || o.received_at) return false
        if (!CATEGORIE_RICAMBI.has(String(o.articolo?.categoria_codice || ''))) return false
        const inviato = tempo(o.sent_at || o.created_at)
        return !!inviato && inviato.getTime() <= ctx.now.getTime() && !passatoDa(inviato, ctx.now, ms)
    })
    if (ordini.length === 0) return []
    const nomi = ordini.map(o => `${o.articolo?.nome || 'Ricambio'}${o.quantita ? ` x${Number(o.quantita)}` : ''} (${oraIt(tempo(o.sent_at || o.created_at))})`)
    return [{
        entita: ordini.length === 1 ? `Ricambio ordinato: ${ordini[0].articolo?.nome || 'Ricambio'}` : `${ordini.length} ricambi ordinati`,
        dettaglio: nomi.join(', '),
    }]
}

// ─── Lettura ─────────────────────────────────────────────────────────────────

async function carica(now: Date): Promise<Record<string, unknown[]>> {
    const giorniFa = (g: number) => new Date(now.getTime() - g * GIORNO).toISOString()
    const [pec, addebiti, veicoli, ordini] = await Promise.all([
        supabase.from('multe_pec_log')
            .select('id, created_at, numero_verbale, targa, booking_id')
            .gte('created_at', giorniFa(GIORNI_MULTE))
            .order('created_at', { ascending: false })
            .range(0, 499),
        supabase.from('pending_addebiti')
            .select('id, created_at, booking_id, customer_name, contract_number, amount_cents, causale, status')
            .in('status', [...ADDEBITO_IN_CORSO, ...ADDEBITO_FALLITO])
            .gte('created_at', giorniFa(GIORNI_ADDEBITI))
            .range(0, 499),
        supabase.from('vehicles')
            .select('id, display_name, plate, status, metadata')
            .in('status', ['unavailable', 'maintenance', 'officina', 'in_manutenzione', 'repair'])
            .range(0, 499),
        supabase.from('inv_ordini')
            .select('id, stato, quantita, sent_at, received_at, created_at, articolo:inv_articoli(nome, categoria_codice)')
            .eq('stato', 'inviato')
            .is('received_at', null)
            .range(0, 499),
    ])
    for (const r of [pec, addebiti, veicoli, ordini]) if (r.error) throw r.error

    const pecRighe = (pec.data || []) as Riga[]
    const ids = Array.from(new Set(pecRighe.map(l => l.booking_id).filter(Boolean).map(String)))
    let pecBookings: Riga[] = []
    if (ids.length > 0) {
        const { data, error } = await supabase.from('bookings')
            .select('id, status, customer_name, vehicle_name, vehicle_plate, vehicle_id, penalties:booking_details->penalties')
            .in('id', ids.slice(0, 200))
        if (error) throw error
        pecBookings = (data || []) as Riga[]
    }
    return {
        [K_PEC]: pecRighe,
        [K_PEC_BOOKINGS]: pecBookings,
        [K_ADDEBITI]: (addebiti.data || []) as Riga[],
        [K_VEICOLI]: (veicoli.data || []) as Riga[],
        [K_ORDINI]: (ordini.data || []) as Riga[],
    }
}

export const moduloMulteOfficina: ModuloAllarmi = {
    nome: 'multeOfficina',
    detectors: {
        multe_da_riaddebitare,
        multe_spesa_da_recuperare,
        multe_pratica_post_noleggio_aperta,
        officina_appuntamento_lead,
        officina_veicolo_da_portare,
        officina_veicolo_da_ritirare,
        officina_oltre_data_prevista,
        officina_veicolo_fermo,
        officina_ricambio_ordinato,
    },
    carica,
}

/** Per i test: nomi delle chiavi in ctx.extra. */
export const CHIAVI_EXTRA = { K_PEC, K_PEC_BOOKINGS, K_ADDEBITI, K_VEICOLI, K_ORDINI }
