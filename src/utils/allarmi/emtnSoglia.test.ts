/**
 * Allarme "Cliente sotto la soglia EMTN" e soglie di Centralina Pro (07/11/2026).
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../supabaseClient', () => ({ supabase: {} }))

import { moduloEmtnSoglia, idClientePrenotazione, EXTRA_EMTN_SOTTO_SOGLIA } from './emtnSoglia'
import { detectorsDeiModuli } from './index'
import { normalizzaSoglieEmtn, sogliaEmtnValida, sottoSoglia } from '../emtnSoglie'
import type { AlarmCfgLite, BookingLite, DetectorContext } from '../alarmDetectors'

const ORA = new Date('2026-11-07T10:00:00.000Z')
const D = moduloEmtnSoglia.detectors
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'

const cfg: AlarmCfgLite = {
    id: 'cli_emtn_sotto_soglia', detector: 'emtn_sotto_soglia', threshold_value: 0, threshold_unit: 'minutes_before',
    priority: 'urgente', is_enabled: true, stato_rilevamento: 'attivo',
}

const ctx = (righe: BookingLite[]): DetectorContext => ({
    now: ORA, bookings: [], vehicles: [], cauzioni: [], firme: new Map(), perVeicolo: new Map(),
    extra: { [EXTRA_EMTN_SOTTO_SOGLIA]: righe },
})

const pren = (over: Partial<BookingLite> = {}): BookingLite => ({
    id: 'b1', service_type: 'car_rental', status: 'confirmed', customer_name: 'Mario Rossi', vehicle_name: 'Fiat 500',
    pickup_date: '2026-11-10T09:30:00.000Z', dropoff_date: '2026-11-12T09:30:00.000Z',
    user_id: U1, booking_details: {}, _emtn_score: 30, _emtn_soglia: 50, ...over,
})

describe('soglie EMTN', () => {
    it('vuote, zero, fuori scala o non numeriche = spente', () => {
        expect(normalizzaSoglieEmtn(undefined)).toEqual({ soglia_allarme: null, soglia_blocco: null, messaggio_blocco: null })
        expect(sogliaEmtnValida('')).toBeNull()
        expect(sogliaEmtnValida(0)).toBeNull()
        expect(sogliaEmtnValida(101)).toBeNull()
        expect(sogliaEmtnValida('abc')).toBeNull()
        expect(sogliaEmtnValida(12.5)).toBeNull()
        expect(sogliaEmtnValida(' 50 ')).toBe(50)
        expect(normalizzaSoglieEmtn({ soglia_allarme: 50, soglia_blocco: '20', messaggio_blocco: '  ' }))
            .toEqual({ soglia_allarme: 50, soglia_blocco: 20, messaggio_blocco: null })
    })
    it('sotto = strettamente minore', () => {
        expect(sottoSoglia(19, 20)).toBe(true)
        expect(sottoSoglia(20, 20)).toBe(false)
        expect(sottoSoglia(10, null)).toBe(false)
        expect(sottoSoglia(null, 20)).toBe(false)
    })
})

describe('emtn_sotto_soglia', () => {
    it('e registrato nel catalogo dei detector', () => {
        expect(typeof detectorsDeiModuli().emtn_sotto_soglia).toBe('function')
    })
    it('suona per un noleggio vivo del cliente sotto soglia', () => {
        const h = D.emtn_sotto_soglia(cfg, ctx([pren()]))
        expect(h).toHaveLength(1)
        expect(h[0].bookingId).toBe('b1')
        expect(h[0].entita).toContain('EMTN 30%')
        expect(h[0].dettaglio).toContain('soglia di allarme 50%')
    })
    it('tace per annullate, lavaggi, mare e punteggi non sotto soglia', () => {
        expect(D.emtn_sotto_soglia(cfg, ctx([pren({ status: 'cancelled' })]))).toHaveLength(0)
        expect(D.emtn_sotto_soglia(cfg, ctx([pren({ service_type: 'car_wash' })]))).toHaveLength(0)
        expect(D.emtn_sotto_soglia(cfg, ctx([pren({ service_type: 'boat_rental' })]))).toHaveLength(0)
        expect(D.emtn_sotto_soglia(cfg, ctx([pren({ _emtn_score: 50 })]))).toHaveLength(0)
    })
    it('aggancia il cliente solo per id', () => {
        expect(idClientePrenotazione(pren({ user_id: null, booking_details: { customer: { customerId: U2, fullName: 'X' } } }))).toEqual([U2])
        expect(idClientePrenotazione(pren({ user_id: 'non-un-id', booking_details: { customer_id: U2 } }))).toEqual([U2])
        expect(idClientePrenotazione(pren({ user_id: null, customer_name: 'Mario Rossi', booking_details: {} }))).toEqual([])
    })
})
