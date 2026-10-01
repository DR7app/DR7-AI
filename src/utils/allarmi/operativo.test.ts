/**
 * Test degli allarmi operativi (01/10/2026): per ogni rilevazione il caso che
 * deve suonare e quello appena fuori, che non deve.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../supabaseClient', () => ({ supabase: {} }))

import { DETECTORS_OPERATIVO as D, EXTRA_ANNULLATE, EXTRA_FIRME } from './operativo'
import type { AlarmCfgLite, BookingLite, DetectorContext } from '../alarmDetectors'

const ORA = new Date('2026-10-01T10:00:00.000Z')
const MIN = 60_000
const ORE = 60 * MIN
const iso = (ms: number) => new Date(ORA.getTime() + ms).toISOString()

function cfg(over: Partial<AlarmCfgLite> = {}): AlarmCfgLite {
    return {
        id: 'test', detector: null, threshold_value: 120, threshold_unit: 'minutes_before',
        priority: 'attenzione', is_enabled: true, stato_rilevamento: 'attivo', ...over,
    }
}

function noleggio(over: Partial<BookingLite> = {}): BookingLite {
    return {
        id: 'b1', service_type: 'car_rental', status: 'confirmed', payment_status: 'paid',
        price_total: 50000, amount_paid: 50000, customer_name: 'Mario Rossi',
        vehicle_name: 'BMW M8', vehicle_plate: 'AA111BB', vehicle_id: 'v1',
        pickup_date: iso(60 * MIN), dropoff_date: iso(3 * 24 * ORE),
        created_at: iso(-3 * 24 * ORE), booking_details: {}, ...over,
    }
}

function lavaggio(over: Partial<BookingLite> = {}): BookingLite {
    return {
        id: 'w1', service_type: 'car_wash', status: 'confirmed', payment_status: 'pending',
        price_total: 2500, amount_paid: 0, customer_name: 'Luca Bianchi',
        vehicle_plate: 'CC222DD', appointment_date: iso(30 * MIN),
        booking_details: { totalDuration: 40 }, ...over,
    }
}

function ctx(bookings: BookingLite[], extra?: Record<string, unknown[]>, firme = new Map<string, Record<string, unknown>>()): DetectorContext {
    const perVeicolo = new Map<string, BookingLite[]>()
    for (const b of bookings) {
        if (!b.vehicle_id) continue
        const arr = perVeicolo.get(String(b.vehicle_id)) || []
        arr.push(b)
        perVeicolo.set(String(b.vehicle_id), arr)
    }
    return { now: ORA, bookings, vehicles: [], cauzioni: [], firme, perVeicolo, extra }
}

describe('op_pickup_photos_missing', () => {
    it('suona se il ritiro e entro la soglia e le foto non sono state inviate', () => {
        expect(D.op_pickup_photos_missing(cfg(), ctx([noleggio()]))).toHaveLength(1)
    })
    it('tace se le foto sono state inviate, il ritiro e fuori soglia o il noleggio e gia in corso', () => {
        expect(D.op_pickup_photos_missing(cfg(), ctx([noleggio({ booking_details: { foto_pre_consegna_inviata_at: iso(-10 * MIN) } })]))).toHaveLength(0)
        expect(D.op_pickup_photos_missing(cfg(), ctx([noleggio({ pickup_date: iso(3 * ORE) })]))).toHaveLength(0)
        expect(D.op_pickup_photos_missing(cfg(), ctx([noleggio({ status: 'active' })]))).toHaveLength(0)
    })
    it('non riguarda i lavaggi', () => {
        expect(D.op_pickup_photos_missing(cfg(), ctx([lavaggio()]))).toHaveLength(0)
    })
})

describe('op_pickup_not_ready', () => {
    it('suona se il ritiro e entro la soglia e Pronta non e stata inviata', () => {
        expect(D.op_pickup_not_ready(cfg(), ctx([noleggio()]))).toHaveLength(1)
    })
    it('tace se Pronta e stata inviata o il ritiro e fuori soglia', () => {
        expect(D.op_pickup_not_ready(cfg(), ctx([noleggio({ booking_details: { auto_pronta_sent_at: iso(-10 * MIN) } })]))).toHaveLength(0)
        expect(D.op_pickup_not_ready(cfg(), ctx([noleggio({ pickup_date: iso(3 * ORE) })]))).toHaveLength(0)
    })
})

describe('op_pickup_offsite_todo', () => {
    it('suona per consegna fuori sede senza autista', () => {
        const b = noleggio({ delivery_enabled: true, delivery_address: { street: 'Via Roma 1', city: 'Cagliari' } })
        const h = D.op_pickup_offsite_todo(cfg(), ctx([b]))
        expect(h).toHaveLength(1)
        expect(h[0].dettaglio).toContain('autista')
    })
    it('segnala anche un indirizzo vuoto', () => {
        const b = noleggio({ delivery_enabled: true, delivery_address: { street: '', city: '' }, booking_details: { autisti_ritiro: [{ id: 'a' }] } })
        expect(D.op_pickup_offsite_todo(cfg(), ctx([b]))[0].dettaglio).toContain('indirizzo')
    })
    it('tace se tutto e organizzato o il ritiro e in sede', () => {
        const ok = noleggio({ delivery_enabled: true, delivery_address: { street: 'Via Roma 1' }, booking_details: { autista_ritiro: { id: 'a' } } })
        expect(D.op_pickup_offsite_todo(cfg(), ctx([ok]))).toHaveLength(0)
        expect(D.op_pickup_offsite_todo(cfg(), ctx([noleggio()]))).toHaveLength(0)
    })
})

describe('op_return_ext_unpaid', () => {
    const ext = (ps: string, amt = 70) => ({ extension_history: [{ extended_at: iso(-ORE), payment_status: ps, additional_amount: amt }] })
    it('suona se un estensione ha un residuo e la riconsegna e vicina', () => {
        const b = noleggio({ pickup_date: iso(-2 * 24 * ORE), dropoff_date: iso(30 * MIN), booking_details: ext('pending') })
        expect(D.op_return_ext_unpaid(cfg({ threshold_value: 60 }), ctx([b]))).toHaveLength(1)
    })
    it('tace se pagata, a zero o con riconsegna lontana', () => {
        const base = { pickup_date: iso(-2 * 24 * ORE), dropoff_date: iso(30 * MIN) }
        expect(D.op_return_ext_unpaid(cfg({ threshold_value: 60 }), ctx([noleggio({ ...base, booking_details: ext('paid') })]))).toHaveLength(0)
        expect(D.op_return_ext_unpaid(cfg({ threshold_value: 60 }), ctx([noleggio({ ...base, booking_details: ext('pending', 0) })]))).toHaveLength(0)
        expect(D.op_return_ext_unpaid(cfg({ threshold_value: 60 }), ctx([noleggio({ dropoff_date: iso(5 * ORE), booking_details: ext('pending') })]))).toHaveLength(0)
    })
})

describe('op_return_ext_unformalized', () => {
    const b = noleggio({ pickup_date: iso(-2 * 24 * ORE), dropoff_date: iso(24 * ORE), booking_details: { extension_history: [{ extended_at: iso(-3 * ORE), payment_status: 'paid' }] } })
    it('suona se dopo l estensione non c e contratto ne firma', () => {
        expect(D.op_return_ext_unformalized(cfg({ threshold_value: 60 }), ctx([b], { [EXTRA_FIRME]: [] }))).toHaveLength(1)
    })
    it('tace con contratto ricondotto o nuova firma o contratto di estensione', () => {
        const ricondotto = { booking_id: 'b1', created_at: iso(-5 * 24 * ORE), updated_at: iso(-2 * ORE), signed_pdf_url: 'x/signed/DR71_ricondotto_1.pdf' }
        expect(D.op_return_ext_unformalized(cfg({ threshold_value: 60 }), ctx([b], { [EXTRA_FIRME]: [ricondotto] }))).toHaveLength(0)
        const nuova = { booking_id: 'b1', created_at: iso(-2 * ORE), updated_at: iso(-2 * ORE) }
        expect(D.op_return_ext_unformalized(cfg({ threshold_value: 60 }), ctx([b], { [EXTRA_FIRME]: [nuova] }))).toHaveLength(0)
        const conContratto = noleggio({ ...b, booking_details: { ...b.booking_details, extension_contracts: [{ generated_at: iso(-2 * ORE) }] } })
        expect(D.op_return_ext_unformalized(cfg({ threshold_value: 60 }), ctx([conContratto], { [EXTRA_FIRME]: [] }))).toHaveLength(0)
    })
    it('tace se le firme non sono state caricate', () => {
        expect(D.op_return_ext_unformalized(cfg({ threshold_value: 60 }), ctx([b]))).toHaveLength(0)
    })
})

describe('op_wash_no_deposit', () => {
    it('suona per lavaggio vicino senza acconto', () => {
        expect(D.op_wash_no_deposit(cfg({ threshold_value: 60 }), ctx([lavaggio()]))).toHaveLength(1)
    })
    it('tace con acconto, pagato o rientro interno', () => {
        expect(D.op_wash_no_deposit(cfg({ threshold_value: 60 }), ctx([lavaggio({ amount_paid: 1000 })]))).toHaveLength(0)
        expect(D.op_wash_no_deposit(cfg({ threshold_value: 60 }), ctx([lavaggio({ payment_status: 'succeeded' })]))).toHaveLength(0)
        expect(D.op_wash_no_deposit(cfg({ threshold_value: 60 }), ctx([lavaggio({ customer_name: 'Lavaggio Rientro' })]))).toHaveLength(0)
    })
})

describe('op_wash_ready_not_notified', () => {
    it('suona se il lavaggio e finito da oltre la soglia senza Pronta', () => {
        const w = lavaggio({ appointment_date: iso(-2 * ORE) }) // fine -1h20
        expect(D.op_wash_ready_not_notified(cfg({ threshold_value: 60 }), ctx([w]))).toHaveLength(1)
    })
    it('tace con Pronta, prima della soglia o dopo 24 ore', () => {
        expect(D.op_wash_ready_not_notified(cfg({ threshold_value: 60 }), ctx([lavaggio({ appointment_date: iso(-2 * ORE), booking_details: { totalDuration: 40, auto_pronta_sent_at: iso(-ORE) } })]))).toHaveLength(0)
        expect(D.op_wash_ready_not_notified(cfg({ threshold_value: 60 }), ctx([lavaggio({ appointment_date: iso(-ORE) })]))).toHaveLength(0)
        expect(D.op_wash_ready_not_notified(cfg({ threshold_value: 60 }), ctx([lavaggio({ appointment_date: iso(-30 * ORE) })]))).toHaveLength(0)
    })
})

describe('op_wash_near_pickup', () => {
    const w = lavaggio({ vehicle_plate: 'AA 111 BB', appointment_date: iso(ORE) }) // fine +1h40
    it('suona se il ritiro dello stesso mezzo e entro la soglia dalla fine', () => {
        const b = noleggio({ pickup_date: iso(2 * ORE) })
        const h = D.op_wash_near_pickup(cfg({ threshold_value: 60, threshold_unit: 'minutes_before' }), ctx([w, b]))
        expect(h).toHaveLength(1)
        expect(h[0].bookingId).toBe('w1')
    })
    it('tace se il ritiro e lontano o il mezzo e un altro', () => {
        expect(D.op_wash_near_pickup(cfg({ threshold_value: 60 }), ctx([w, noleggio({ pickup_date: iso(5 * ORE) })]))).toHaveLength(0)
        expect(D.op_wash_near_pickup(cfg({ threshold_value: 60 }), ctx([w, noleggio({ vehicle_plate: 'ZZ999ZZ', pickup_date: iso(2 * ORE) })]))).toHaveLength(0)
    })
})

describe('op_booking_duplicate', () => {
    it('suona sulla copia piu recente', () => {
        const a = noleggio({ id: 'a', created_at: iso(-2 * ORE) })
        const b = noleggio({ id: 'b', created_at: iso(-ORE) })
        const h = D.op_booking_duplicate(cfg(), ctx([a, b]))
        expect(h).toHaveLength(1)
        expect(h[0].bookingId).toBe('b')
    })
    it('tace se la doppia e voluta, il cliente e diverso o e un uscita', () => {
        const a = noleggio({ id: 'a' })
        expect(D.op_booking_duplicate(cfg(), ctx([a, noleggio({ id: 'b', booking_details: { allow_double_booking: true } })]))).toHaveLength(0)
        expect(D.op_booking_duplicate(cfg(), ctx([a, noleggio({ id: 'b', customer_name: 'Altro Cliente' })]))).toHaveLength(0)
        expect(D.op_booking_duplicate(cfg(), ctx([a, noleggio({ id: 'b', service_type: 'uscita_straordinaria' })]))).toHaveLength(0)
    })
})

describe('op_booking_unverified', () => {
    it('suona se in attesa di pagamento e non confermata da oltre la soglia', () => {
        expect(D.op_booking_unverified(cfg(), ctx([noleggio({ payment_status: 'pending' })]))).toHaveLength(1)
    })
    it('tace se confermata a mano, pagata o appena creata', () => {
        expect(D.op_booking_unverified(cfg(), ctx([noleggio({ payment_status: 'pending', booking_details: { manually_confirmed: true } })]))).toHaveLength(0)
        expect(D.op_booking_unverified(cfg(), ctx([noleggio()]))).toHaveLength(0)
        expect(D.op_booking_unverified(cfg(), ctx([noleggio({ payment_status: 'pending', created_at: iso(-30 * MIN) })]))).toHaveLength(0)
    })
})

describe('op_booking_modified_recheck', () => {
    const d = { contratto_rifirma_richiesta: true, contratto_rifirma_voci: ['veicolo'], contratto_rifirma_at: iso(-ORE) }
    it('suona se la rifirma e richiesta e il ritiro e vicino', () => {
        const h = D.op_booking_modified_recheck(cfg(), ctx([noleggio({ booking_details: d })]))
        expect(h).toHaveLength(1)
        expect(h[0].dettaglio).toContain('veicolo')
    })
    it('tace se la firma nuova e arrivata o il ritiro e lontano', () => {
        const firme = new Map([['b1', { signed_at: iso(-10 * MIN) }]])
        expect(D.op_booking_modified_recheck(cfg(), ctx([noleggio({ booking_details: d })], undefined, firme))).toHaveLength(0)
        expect(D.op_booking_modified_recheck(cfg(), ctx([noleggio({ pickup_date: iso(24 * ORE), booking_details: d })]))).toHaveLength(0)
    })
})

describe('op_booking_cancelled_open', () => {
    const ann = noleggio({ id: 'x1', status: 'cancelled', booking_details: { cancelled_at: iso(-3 * ORE) } })
    it('suona per firma ancora aperta su prenotazione annullata', () => {
        const firma = { booking_id: 'x1', status: 'pending', signed_at: null }
        const h = D.op_booking_cancelled_open(cfg(), ctx([], { [EXTRA_ANNULLATE]: [ann], [EXTRA_FIRME]: [firma] }))
        expect(h).toHaveLength(1)
        expect(h[0].dettaglio).toContain('firma')
    })
    it('suona per lavaggio di rientro ancora in calendario', () => {
        const w = lavaggio({ customer_name: 'Lavaggio Rientro', booking_details: { source_booking_id: 'x1' } })
        expect(D.op_booking_cancelled_open(cfg(), ctx([w], { [EXTRA_ANNULLATE]: [ann], [EXTRA_FIRME]: [] }))).toHaveLength(1)
    })
    it('tace se tutto e chiuso, se e troppo recente o troppo vecchia', () => {
        const chiusa = { booking_id: 'x1', status: 'cancelled' }
        expect(D.op_booking_cancelled_open(cfg(), ctx([], { [EXTRA_ANNULLATE]: [ann], [EXTRA_FIRME]: [chiusa] }))).toHaveLength(0)
        const firma = { booking_id: 'x1', status: 'pending' }
        const recente = noleggio({ id: 'x1', status: 'cancelled', booking_details: { cancelled_at: iso(-30 * MIN) } })
        expect(D.op_booking_cancelled_open(cfg(), ctx([], { [EXTRA_ANNULLATE]: [recente], [EXTRA_FIRME]: [firma] }))).toHaveLength(0)
        const vecchia = noleggio({ id: 'x1', status: 'cancelled', booking_details: { cancelled_at: iso(-10 * 24 * ORE) } })
        expect(D.op_booking_cancelled_open(cfg(), ctx([], { [EXTRA_ANNULLATE]: [vecchia], [EXTRA_FIRME]: [firma] }))).toHaveLength(0)
    })
})
