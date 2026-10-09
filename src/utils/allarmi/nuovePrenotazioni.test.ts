/**
 * Allarme "Nuova prenotazione <servizio>" (09/10/2026): suona per le
 * prenotazioni del servizio giusto create da meno della soglia, e solo agli
 * operatori scelti.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../supabaseClient', () => ({ supabase: {} }))

import { moduloNuovePrenotazioni, servizioDellaPrenotazione, EXTRA_NUOVE_PRENOTAZIONI } from './nuovePrenotazioni'
import { allarmePerOperatore } from '../motoreAllarmi'
import type { AlarmCfgLite, BookingLite, DetectorContext } from '../alarmDetectors'

const ORA = new Date('2026-10-09T10:00:00.000Z')
const MIN = 60_000
const iso = (ms: number) => new Date(ORA.getTime() + ms).toISOString()
const D = moduloNuovePrenotazioni.detectors

const cfg = (over: Partial<AlarmCfgLite> = {}): AlarmCfgLite => ({
    id: 'test', detector: null, threshold_value: 1440, threshold_unit: 'minutes_after',
    priority: 'attenzione', is_enabled: true, stato_rilevamento: 'attivo', ...over,
})

const ctx = (righe: BookingLite[]): DetectorContext => ({
    now: ORA, bookings: [], vehicles: [], cauzioni: [], firme: new Map(), perVeicolo: new Map(),
    extra: { [EXTRA_NUOVE_PRENOTAZIONI]: righe },
})

const pren = (over: Partial<BookingLite> = {}): BookingLite => ({
    id: 'b1', service_type: 'car_wash', status: 'confirmed', customer_name: 'Luca Bianchi',
    service_name: 'Lavaggio Completo', appointment_date: iso(60 * MIN), created_at: iso(-5 * MIN),
    booking_details: {}, ...over,
})

describe('servizioDellaPrenotazione', () => {
    it('riconosce ogni servizio', () => {
        expect(servizioDellaPrenotazione(pren())).toBe('lavaggio')
        expect(servizioDellaPrenotazione(pren({ service_type: null }))).toBe('noleggio')
        expect(servizioDellaPrenotazione(pren({ service_type: 'car_rental' }))).toBe('noleggio')
        expect(servizioDellaPrenotazione(pren({ service_type: 'mechanical_service' }))).toBe('meccanica')
        expect(servizioDellaPrenotazione(pren({ service_type: 'boat_rental' }))).toBe('mare')
        expect(servizioDellaPrenotazione(pren({ service_type: 'heli_rental' }))).toBe('aria')
        expect(servizioDellaPrenotazione(pren({ service_type: 'stay_rental' }))).toBe('soggiorni')
    })
    it('ignora lavaggi rientro, uscite straordinarie e blocchi', () => {
        expect(servizioDellaPrenotazione(pren({ customer_name: 'Lavaggio Rientro' }))).toBeNull()
        expect(servizioDellaPrenotazione(pren({ service_type: 'uscita_straordinaria' }))).toBeNull()
        expect(servizioDellaPrenotazione(pren({ service_type: null, booking_details: { is_courtesy_block: true } }))).toBeNull()
    })
})

describe('booking_creata', () => {
    it('suona per una prenotazione del servizio appena creata', () => {
        const h = D.booking_creata(cfg(), ctx([pren()]), 'lavaggio')
        expect(h).toHaveLength(1)
        expect(h[0].bookingId).toBe('b1')
        expect(h[0].entita).toContain('Luca Bianchi')
    })
    it('tace per un altro servizio, oltre la soglia o se annullata', () => {
        expect(D.booking_creata(cfg(), ctx([pren()]), 'noleggio')).toHaveLength(0)
        expect(D.booking_creata(cfg(), ctx([pren({ created_at: iso(-1441 * MIN) })]), 'lavaggio')).toHaveLength(0)
        expect(D.booking_creata(cfg(), ctx([pren({ status: 'cancelled' })]), 'lavaggio')).toHaveLength(0)
    })
})

describe('allarmePerOperatore', () => {
    it('lista vuota = tutti; altrimenti solo gli spuntati', () => {
        expect(allarmePerOperatore({ riceventi: [] }, 'u1')).toBe(true)
        expect(allarmePerOperatore(undefined, 'u1')).toBe(true)
        expect(allarmePerOperatore({ riceventi: ['u1'] }, 'u1')).toBe(true)
        expect(allarmePerOperatore({ riceventi: ['u1'] }, 'u2')).toBe(false)
        expect(allarmePerOperatore({ riceventi: ['u1'] }, null)).toBe(false)
    })
})
