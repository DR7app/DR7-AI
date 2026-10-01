/**
 * Test delle rilevazioni dei gruppi lead e preparazione (01/10/2026).
 * Funzioni pure: dati dentro, occorrenze fuori. Si provano i confini.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../supabaseClient', () => ({ supabase: {} }))

import { moduloLeadPreparazione, K_PREVENTIVI, K_CARRELLI, K_INVITI } from './leadPreparazione'
import type { AlarmCfgLite, BookingLite, DetectorContext } from '../alarmDetectors'

const D = moduloLeadPreparazione.detectors
const ORA = new Date('2026-10-01T10:00:00.000Z')
const MIN = 60_000
const ORE = 60 * MIN
const GIORNO = 24 * ORE
const t = (ms: number) => new Date(ORA.getTime() + ms).toISOString()

function cfg(over: Partial<AlarmCfgLite> = {}): AlarmCfgLite {
    return {
        id: 'test',
        detector: null,
        threshold_value: 60,
        threshold_unit: 'minutes_after',
        priority: 'attenzione',
        is_enabled: true,
        stato_rilevamento: 'attivo',
        ...over,
    }
}

function ctx(bookings: BookingLite[] = [], extra: Record<string, unknown[]> = {}): DetectorContext {
    return { now: ORA, bookings, vehicles: [], cauzioni: [], firme: new Map(), perVeicolo: new Map(), extra }
}

function noleggio(over: Partial<BookingLite> = {}): BookingLite {
    return {
        id: 'r1',
        service_type: null,
        status: 'confirmed',
        payment_status: 'paid',
        customer_name: 'Mario Rossi',
        vehicle_name: 'Audi RS3',
        vehicle_plate: 'PA B3550',
        vehicle_id: 'v1',
        pickup_date: t(30 * MIN),
        dropoff_date: t(3 * GIORNO),
        booking_details: {},
        ...over,
    }
}

function lavaggio(over: Partial<BookingLite> = {}): BookingLite {
    return {
        id: 'w1',
        service_type: 'car_wash',
        status: 'confirmed',
        customer_name: 'Lavaggio rientro',
        vehicle_plate: 'PAB3550',
        appointment_date: t(0),
        booking_details: {},
        ...over,
    }
}

describe('lead: preventivi', () => {
    const richiesta = (over: Record<string, unknown> = {}) => ({
        id: 'p1', status: 'bozza', source: 'website', booking_id: null, customer_name: 'Anna',
        vehicle_name: 'Ferrari 296', pickup_date: t(5 * GIORNO), created_at: t(-2 * ORE), updated_at: t(-2 * ORE),
        whatsapp_sent_at: null, expires_at: t(5 * GIORNO), ...over,
    })

    it('richiesta dal sito non inviata: suona dopo la soglia, non prima, non per le bozze dell ufficio', () => {
        const hits = D.lead_preventivo_richiesto(cfg(), ctx([], { [K_PREVENTIVI]: [
            richiesta(),
            richiesta({ id: 'p2', created_at: t(-10 * MIN), updated_at: t(-10 * MIN) }),
            richiesta({ id: 'p3', source: 'admin' }),
            richiesta({ id: 'p4', source: 'website_aviation' }),
        ] }))
        expect(hits.map(h => h.bookingId)).toEqual(['p1', 'p4'])
    })

    it('richiesta vecchia oltre 7 giorni o con ritiro passato: niente', () => {
        const hits = D.lead_preventivo_richiesto(cfg(), ctx([], { [K_PREVENTIVI]: [
            richiesta({ created_at: t(-8 * GIORNO), updated_at: t(-8 * GIORNO) }),
            richiesta({ id: 'p2', pickup_date: t(-ORE) }),
        ] }))
        expect(hits).toHaveLength(0)
    })

    it('inviato senza risposta: dopo la soglia e finche non scade', () => {
        const base = { status: 'inviato', source: 'admin', whatsapp_sent_at: t(-2 * ORE), expires_at: t(22 * ORE) }
        const hits = D.lead_preventivo_senza_risposta(cfg(), ctx([], { [K_PREVENTIVI]: [
            richiesta(base),
            richiesta({ ...base, id: 'p2', whatsapp_sent_at: t(-30 * MIN) }),
            richiesta({ ...base, id: 'p3', expires_at: t(-MIN) }),
            richiesta({ ...base, id: 'p4', status: 'accettato' }),
        ] }))
        expect(hits.map(h => h.bookingId)).toEqual(['p1'])
    })

    it('in scadenza: solo se la scadenza e dentro la finestra', () => {
        const c = cfg({ threshold_value: 7, threshold_unit: 'days' })
        const hits = D.lead_preventivo_in_scadenza(c, ctx([], { [K_PREVENTIVI]: [
            richiesta({ status: 'inviato', expires_at: t(20 * ORE) }),
            richiesta({ id: 'p2', status: 'inviato', expires_at: t(8 * GIORNO), pickup_date: t(20 * GIORNO) }),
            richiesta({ id: 'p3', status: 'inviato', expires_at: t(-ORE) }),
            richiesta({ id: 'p4', status: 'bozza', expires_at: t(20 * ORE) }),
        ] }))
        expect(hits.map(h => h.bookingId)).toEqual(['p1'])
    })

    it('prezzo bloccato scaduto: dopo la soglia, anche se lo stato e gia scaduto, mai se convertito', () => {
        const hits = D.lead_prezzo_bloccato_scaduto(cfg(), ctx([], { [K_PREVENTIVI]: [
            richiesta({ status: 'inviato', expires_at: t(-2 * ORE) }),
            richiesta({ id: 'p2', status: 'scaduto', expires_at: t(-3 * ORE) }),
            richiesta({ id: 'p3', status: 'inviato', expires_at: t(-10 * MIN) }),
            richiesta({ id: 'p4', status: 'inviato', expires_at: t(-2 * ORE), booking_id: 'b9' }),
            richiesta({ id: 'p5', status: 'inviato', expires_at: t(-9 * GIORNO) }),
        ] }))
        expect(hits.map(h => h.bookingId)).toEqual(['p1', 'p2'])
    })
})

describe('lead: pagamento richiesto', () => {
    const conLink = (over: Partial<BookingLite> = {}) => noleggio({
        payment_status: 'pending',
        booking_details: { nexi_payment_link: 'https://x', payment_link_created_at: t(-2 * ORE) },
        ...over,
    })

    it('suona dopo la soglia dall invio e non se pagato o annullato', () => {
        const hits = D.lead_pagamento_richiesto(cfg(), ctx([
            conLink(),
            conLink({ id: 'r2', booking_details: { nexi_payment_link: 'https://x', payment_link_created_at: t(-10 * MIN) } }),
            conLink({ id: 'r3', payment_status: 'paid' }),
            conLink({ id: 'r4', status: 'cancelled' }),
            noleggio({ id: 'r5', payment_status: 'pending' }),
        ]))
        expect(hits.map(h => h.bookingId)).toEqual(['r1'])
    })

    it('un link rigenerato riparte da capo', () => {
        const hits = D.lead_pagamento_richiesto(cfg(), ctx([conLink({
            booking_details: { nexi_payment_link: 'https://x', payment_link_created_at: t(-5 * ORE), nexi_link_regenerated_at: t(-5 * MIN) },
        })]))
        expect(hits).toHaveLength(0)
    })

    it('ignora i lavaggi rientro interni', () => {
        const hits = D.lead_pagamento_richiesto(cfg(), ctx([lavaggio({
            payment_status: 'pending', booking_details: { nexi_payment_link: 'x', payment_link_created_at: t(-2 * ORE) },
        })]))
        expect(hits).toHaveLength(0)
    })
})

describe('lead: prenotazione iniziata sul sito', () => {
    const carrello = (over: Record<string, unknown> = {}) => ({
        id: 'c1', nexi_order_id: 'ORD1', created_at: t(-2 * ORE), customer_name: 'Pamela', customer_email: 'p@x.it',
        service_type: 'car_wash', appointment_date: t(GIORNO), pickup_date: null, price_total: '3000', ...over,
    })

    it('piu tentativi della stessa email sullo stesso orario sono una sola occorrenza', () => {
        const hits = D.lead_prenotazione_abbandonata(cfg(), ctx([], { [K_CARRELLI]: [
            carrello(),
            carrello({ id: 'c2', nexi_order_id: 'ORD2', created_at: t(-90 * MIN) }),
        ] }))
        expect(hits.map(h => h.bookingId)).toEqual(['c2'])
    })

    it('non suona se la prenotazione e nata: stesso ordine o stessa email e orario', () => {
        const nata = { ...lavaggio({ id: 'b1', customer_name: 'Pamela', customer_email: 'P@x.it', appointment_date: t(GIORNO) }) }
        const perOrdine = noleggio({ id: 'b2', nexi_order_id: 'ORD3' })
        const hits = D.lead_prenotazione_abbandonata(cfg(), ctx([nata, perOrdine], { [K_CARRELLI]: [
            carrello(),
            carrello({ id: 'c3', nexi_order_id: 'ORD3', customer_email: 'altro@x.it' }),
        ] }))
        expect(hits).toHaveLength(0)
    })

    it('stesso telefono ma email diverse restano due lead', () => {
        const hits = D.lead_prenotazione_abbandonata(cfg(), ctx([], { [K_CARRELLI]: [
            carrello({ customer_phone: '333' }),
            carrello({ id: 'c2', nexi_order_id: 'ORD2', customer_email: 'altra@x.it', customer_phone: '333' }),
        ] }))
        expect(hits).toHaveLength(2)
    })

    it('niente prima della soglia o se l orario chiesto e passato', () => {
        const hits = D.lead_prenotazione_abbandonata(cfg(), ctx([], { [K_CARRELLI]: [
            carrello({ created_at: t(-10 * MIN) }),
            carrello({ id: 'c2', appointment_date: t(-ORE) }),
        ] }))
        expect(hits).toHaveLength(0)
    })
})

describe('lead: dati e documenti richiesti', () => {
    it('invito aperto dopo la soglia; non se compilato, revocato o scaduto', () => {
        const inv = (over: Record<string, unknown> = {}) => ({
            id: 'i1', note: 'Mario', created_at: t(-2 * ORE), expires_at: t(5 * GIORNO), used_at: null, revoked_at: null, ...over,
        })
        const hits = D.lead_invito_non_compilato(cfg(), ctx([], { [K_INVITI]: [
            inv(),
            inv({ id: 'i2', created_at: t(-10 * MIN) }),
            inv({ id: 'i3', used_at: t(-MIN) }),
            inv({ id: 'i4', revoked_at: t(-MIN) }),
            inv({ id: 'i5', expires_at: t(-MIN) }),
        ] }))
        expect(hits.map(h => h.bookingId)).toEqual(['i1'])
    })
})

describe('preparazione', () => {
    const prima = cfg({ threshold_unit: 'minutes_before' })

    it('Pronta mancante: ritiro nella finestra e bottone non premuto', () => {
        const hits = D.prep_pronta_mancante(prima, ctx([
            noleggio(),
            noleggio({ id: 'r2', booking_details: { auto_pronta_sent_at: t(-MIN) } }),
            noleggio({ id: 'r3', pickup_date: t(2 * ORE) }),
            noleggio({ id: 'r4', service_type: 'boat_rental' }),
            noleggio({ id: 'r5', status: 'active' }),
        ]))
        expect(hits.map(h => h.bookingId)).toEqual(['r1'])
    })

    it('rientro senza lavaggio programmato; il lavaggio rientro lo spegne', () => {
        const rientrato = noleggio({ id: 'r1', status: 'completata', pickup_date: t(-3 * GIORNO), dropoff_date: t(-ORE) })
        const inArrivo = noleggio({ id: 'r2', vehicle_plate: 'XX111YY', pickup_date: t(-GIORNO), dropoff_date: t(30 * MIN) })
        const lontano = noleggio({ id: 'r3', vehicle_plate: 'ZZ111YY', pickup_date: t(-GIORNO), dropoff_date: t(5 * ORE) })
        const vecchio = noleggio({ id: 'r4', vehicle_plate: 'KK111YY', status: 'completata', pickup_date: t(-12 * GIORNO), dropoff_date: t(-9 * GIORNO) })
        expect(D.prep_rientro_senza_lavaggio(prima, ctx([rientrato, inArrivo, lontano, vecchio])).map(h => h.bookingId))
            .toEqual(['r1', 'r2'])
        const conLavaggio = D.prep_rientro_senza_lavaggio(prima, ctx([rientrato, lavaggio({ appointment_date: t(-50 * MIN) })]))
        expect(conLavaggio).toHaveLength(0)
    })

    it('uscita imminente senza lavaggio dopo il rientro precedente', () => {
        const prec = noleggio({ id: 'prec', status: 'completata', pickup_date: t(-3 * GIORNO), dropoff_date: t(-5 * ORE) })
        const prossimo = noleggio({ id: 'r1', pickup_date: t(30 * MIN), dropoff_date: t(2 * GIORNO) })
        expect(D.prep_lavaggio_mancante_prima_uscita(prima, ctx([prec, prossimo])).map(h => h.bookingId)).toEqual(['r1'])
        // lavaggio messo tra rientro e ritiro: pronto
        expect(D.prep_lavaggio_mancante_prima_uscita(prima, ctx([prec, prossimo, lavaggio({ appointment_date: t(-4 * ORE) })]))).toHaveLength(0)
        // lavaggio programmato DOPO il ritiro: il mezzo esce sporco
        expect(D.prep_lavaggio_mancante_prima_uscita(prima, ctx([prec, prossimo, lavaggio({ appointment_date: t(2 * ORE) })]))).toHaveLength(1)
        // nessun noleggio precedente noto: non si allarma
        expect(D.prep_lavaggio_mancante_prima_uscita(prima, ctx([prossimo]))).toHaveLength(0)
    })

    it('prossima uscita a 7 giorni usa la stessa rilevazione con un altro anticipo', () => {
        const prec = noleggio({ id: 'prec', status: 'completata', pickup_date: t(-3 * GIORNO), dropoff_date: t(-5 * ORE) })
        const traTreGiorni = noleggio({ id: 'r1', pickup_date: t(3 * GIORNO), dropoff_date: t(5 * GIORNO) })
        const c = cfg({ threshold_value: 7, threshold_unit: 'days' })
        expect(D.prep_lavaggio_mancante_prima_uscita(c, ctx([prec, traTreGiorni])).map(h => h.bookingId)).toEqual(['r1'])
        expect(D.prep_lavaggio_mancante_prima_uscita(prima, ctx([prec, traTreGiorni]))).toHaveLength(0)
    })
})
