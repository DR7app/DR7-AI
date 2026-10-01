/**
 * Test delle rilevazioni multe + officina (01/10/2026): dentro la soglia e
 * appena fuori, sui dati nella forma in cui il database li scrive davvero.
 */
import { describe, it, expect, vi } from 'vitest'

// I detector non usano la rete: il client serve solo a `carica`.
vi.mock('../../supabaseClient', () => ({ supabase: {} }))
import type { AlarmCfgLite, BookingLite, DetectorContext } from '../alarmDetectors'
import { moduloMulteOfficina, CHIAVI_EXTRA as K, appuntamentoOfficinaAt, inOfficina } from './multeOfficina'

const ORA = new Date('2026-10-01T10:00:00.000Z') // 12:00 a Roma
const MIN = 60_000
const ORE = 60 * MIN
const GIORNO = 24 * ORE
const D = moduloMulteOfficina.detectors

function cfg(threshold_value: number, threshold_unit: AlarmCfgLite['threshold_unit'] = 'days'): AlarmCfgLite {
    return { id: 't', detector: 'x', threshold_value, threshold_unit, priority: 'attenzione', is_enabled: true, stato_rilevamento: 'attivo' }
}

function ctx(over: { bookings?: BookingLite[]; extra?: Record<string, unknown[]> } = {}): DetectorContext {
    return { now: ORA, bookings: over.bookings || [], vehicles: [], cauzioni: [], firme: new Map(), perVeicolo: new Map(), extra: over.extra || {} }
}

const fa = (ms: number) => new Date(ORA.getTime() - ms).toISOString()

describe('multe_da_riaddebitare', () => {
    const pec = (over = {}) => ({ id: 'p1', created_at: fa(2 * GIORNO), numero_verbale: 'V1', targa: 'AA111BB', booking_id: 'b1', ...over })
    const bk = (over = {}) => ({ id: 'b1', status: 'completata', customer_name: 'Mario Rossi', vehicle_name: 'BMW', vehicle_plate: 'AA111BB', penalties: null, ...over })

    it('PEC inviata da oltre la soglia e nessuna penale multe: suona', () => {
        const h = D.multe_da_riaddebitare(cfg(1), ctx({ extra: { [K.K_PEC]: [pec(), pec({ id: 'p2', numero_verbale: 'V2' })], [K.K_PEC_BOOKINGS]: [bk()] } }))
        expect(h).toHaveLength(1)
        expect(h[0].bookingId).toBe('b1')
        expect(h[0].dettaglio).toContain('V1')
        expect(h[0].dettaglio).toContain('V2')
    })
    it('penale "Multe e sanzioni" presente: tace', () => {
        const h = D.multe_da_riaddebitare(cfg(1), ctx({ extra: { [K.K_PEC]: [pec()], [K.K_PEC_BOOKINGS]: [bk({ penalties: [{ label: 'Multe e sanzioni', paymentStatus: 'pending' }] })] } }))
        expect(h).toHaveLength(0)
    })
    it('PEC piu recente della soglia, troppo vecchia o senza noleggio: tace', () => {
        const extra = (p: object) => ({ [K.K_PEC]: [pec(p)], [K.K_PEC_BOOKINGS]: [bk()] })
        expect(D.multe_da_riaddebitare(cfg(1), ctx({ extra: extra({ created_at: fa(12 * ORE) }) }))).toHaveLength(0)
        expect(D.multe_da_riaddebitare(cfg(1), ctx({ extra: extra({ created_at: fa(120 * GIORNO) }) }))).toHaveLength(0)
        expect(D.multe_da_riaddebitare(cfg(1), ctx({ extra: extra({ booking_id: null }) }))).toHaveLength(0)
    })
})

describe('multe_spesa_da_recuperare', () => {
    const noleggio = (over: Partial<BookingLite> = {}): BookingLite => ({
        id: 'b1', service_type: null, status: 'completata', customer_name: 'Mario Rossi', vehicle_name: 'BMW', vehicle_id: 'v1',
        pickup_date: fa(5 * GIORNO), dropoff_date: fa(2 * GIORNO),
        booking_details: { penalties: [{ label: 'Igienizzazione', total: 100, paymentStatus: 'pending' }] }, ...over,
    })
    it('penale non pagata dopo la riconsegna: suona', () => {
        const h = D.multe_spesa_da_recuperare(cfg(1), ctx({ bookings: [noleggio()] }))
        expect(h).toHaveLength(1)
        expect(h[0].dettaglio).toContain('Igienizzazione')
    })
    it('pagata (anche con sconto: total > amountPaid) o riconsegna troppo recente: tace', () => {
        const pagata = noleggio({ booking_details: { danni: [{ label: 'Paraurti', total: 425, amountPaid: 325, paymentStatus: 'paid' }] } })
        expect(D.multe_spesa_da_recuperare(cfg(1), ctx({ bookings: [pagata] }))).toHaveLength(0)
        expect(D.multe_spesa_da_recuperare(cfg(1), ctx({ bookings: [noleggio({ dropoff_date: fa(6 * ORE) })] }))).toHaveLength(0)
        expect(D.multe_spesa_da_recuperare(cfg(1), ctx({ bookings: [noleggio({ status: 'cancelled' })] }))).toHaveLength(0)
    })
    it('addebito su carta fallito: suona; in corso: tace', () => {
        const a = { id: 'a1', created_at: fa(2 * GIORNO), booking_id: 'b9', customer_name: 'Luca', amount_cents: 5000, status: 'charge_failed' }
        expect(D.multe_spesa_da_recuperare(cfg(1), ctx({ extra: { [K.K_ADDEBITI]: [a] } }))).toHaveLength(1)
        expect(D.multe_spesa_da_recuperare(cfg(1), ctx({ extra: { [K.K_ADDEBITI]: [{ ...a, status: 'email_sent' }] } }))).toHaveLength(0)
    })
})

describe('multe_pratica_post_noleggio_aperta', () => {
    const a = (over = {}) => ({ id: 'a1', created_at: fa(2 * GIORNO), booking_id: 'b1', customer_name: 'Luca', amount_cents: 5000, status: 'second_email_sent', ...over })
    it('addebito in corso da oltre la soglia: suona', () => {
        expect(D.multe_pratica_post_noleggio_aperta(cfg(1), ctx({ extra: { [K.K_ADDEBITI]: [a()] } }))).toHaveLength(1)
    })
    it('appena creato o chiuso: tace', () => {
        expect(D.multe_pratica_post_noleggio_aperta(cfg(1), ctx({ extra: { [K.K_ADDEBITI]: [a({ created_at: fa(ORE) })] } }))).toHaveLength(0)
        expect(D.multe_pratica_post_noleggio_aperta(cfg(1), ctx({ extra: { [K.K_ADDEBITI]: [a({ status: 'charged' })] } }))).toHaveLength(0)
    })
})

describe('officina_appuntamento_lead', () => {
    // Come in produzione: giorno a mezzanotte di Roma, ora a parte.
    const mecc = (over: Partial<BookingLite> = {}): BookingLite => ({
        id: 'm1', service_type: 'mechanical_service', status: 'confirmed', customer_name: 'Davide', vehicle_name: 'Ford Cmax',
        appointment_date: '2026-10-01T00:00:00+02:00', appointment_time: '12:45', ...over,
    })
    it('legge l\'ora da appointment_time', () => {
        expect(appuntamentoOfficinaAt(mecc())?.toISOString()).toBe('2026-10-01T10:45:00.000Z')
    })
    it('entro 60 minuti suona, a 75 minuti no', () => {
        expect(D.officina_appuntamento_lead(cfg(60, 'minutes_before'), ctx({ bookings: [mecc()] }))).toHaveLength(1)
        expect(D.officina_appuntamento_lead(cfg(60, 'minutes_before'), ctx({ bookings: [mecc({ appointment_time: '13:15' })] }))).toHaveLength(0)
    })
    it('un lavaggio o un appuntamento chiuso non e\' officina', () => {
        expect(D.officina_appuntamento_lead(cfg(60, 'minutes_before'), ctx({ bookings: [mecc({ service_type: 'car_wash' })] }))).toHaveLength(0)
        expect(D.officina_appuntamento_lead(cfg(60, 'minutes_before'), ctx({ bookings: [mecc({ status: 'completed' })] }))).toHaveLength(0)
    })
})

describe('officina: fermi veicolo', () => {
    // Date come le scrive la tab Veicoli: giorno + ora separati (Roma).
    const v = (meta: Record<string, unknown>, status = 'unavailable') => ({
        id: 'v1', display_name: 'Audi RS6', plate: 'GW865LG', status,
        metadata: { unavailable_reason: 'Officina meccanica', unavailable_from_time: '09:00', unavailable_until_time: '18:00', ...meta },
    })
    const con = (...vs: object[]) => ctx({ extra: { [K.K_VEICOLI]: vs } })

    it('"Viaggio" non e\' officina; Manutenzione si', () => {
        expect(inOfficina(v({ unavailable_reason: 'Viaggio' }))).toBe(false)
        expect(inOfficina(v({}, 'maintenance'))).toBe(true)
        expect(inOfficina(v({ unavailable_reason: 'Gommista' }))).toBe(true)
    })
    it('da portare: fermo che inizia domani suona, tra 3 giorni no', () => {
        expect(D.officina_veicolo_da_portare(cfg(1), con(v({ unavailable_from: '2026-10-02', unavailable_until: '2026-10-05' })))).toHaveLength(1)
        expect(D.officina_veicolo_da_portare(cfg(1), con(v({ unavailable_from: '2026-10-04', unavailable_until: '2026-10-05' })))).toHaveLength(0)
    })
    it('da ritirare: fermo che finisce oggi alle 18 suona, dopodomani no', () => {
        expect(D.officina_veicolo_da_ritirare(cfg(1), con(v({ unavailable_from: '2026-09-28', unavailable_until: '2026-10-01' })))).toHaveLength(1)
        expect(D.officina_veicolo_da_ritirare(cfg(1), con(v({ unavailable_from: '2026-09-28', unavailable_until: '2026-10-03' })))).toHaveLength(0)
    })
    it('oltre data prevista: fine passata da 2 giorni suona; da 1 ora o da 2 mesi no', () => {
        expect(D.officina_oltre_data_prevista(cfg(1), con(v({ unavailable_from: '2026-09-20', unavailable_until: '2026-09-29' })))).toHaveLength(1)
        expect(D.officina_oltre_data_prevista(cfg(1), con(v({ unavailable_from: '2026-09-20', unavailable_until: '2026-10-01', unavailable_until_time: '11:00' })))).toHaveLength(0)
        expect(D.officina_oltre_data_prevista(cfg(1), con(v({ unavailable_from: '2026-07-01', unavailable_until: '2026-07-30' })))).toHaveLength(0)
    })
    it('veicolo fermo: in officina da 3 giorni suona; iniziato oggi, finito o in viaggio no', () => {
        const h = D.officina_veicolo_fermo(cfg(1), con(v({ unavailable_from: '2026-09-28', unavailable_until: '2026-10-05' })))
        expect(h).toHaveLength(1)
        expect(h[0].vehicleId).toBe('v1')
        expect(D.officina_veicolo_fermo(cfg(1), con(v({ unavailable_from: '2026-10-01', unavailable_until: '2026-10-05' })))).toHaveLength(0)
        expect(D.officina_veicolo_fermo(cfg(1), con(v({ unavailable_from: '2026-09-20', unavailable_until: '2026-09-29' })))).toHaveLength(0)
        expect(D.officina_veicolo_fermo(cfg(1), con(v({ unavailable_reason: 'Viaggio', unavailable_from: '2026-09-20', unavailable_until: '2026-10-29' })))).toHaveLength(0)
        expect(D.officina_veicolo_fermo(cfg(1), con(v({}, 'maintenance')))).toHaveLength(1)
    })
})

describe('officina_ricambio_ordinato', () => {
    const o = (over: Record<string, unknown> = {}) => ({
        id: 'o1', stato: 'inviato', quantita: 2, sent_at: fa(3 * ORE), received_at: null,
        articolo: { nome: 'Pastiglie freno GLE', categoria_codice: 'FRE' }, ...over,
    })
    const con = (...os: object[]) => ctx({ extra: { [K.K_ORDINI]: os } })
    it('ricambio inviato da poco: una sola occorrenza con l\'elenco', () => {
        const h = D.officina_ricambio_ordinato(cfg(1), con(o(), o({ id: 'o2', articolo: { nome: 'Filtro olio', categoria_codice: 'FIL' } })))
        expect(h).toHaveLength(1)
        expect(h[0].entita).toBe('2 ricambi ordinati')
    })
    it('non ricambio, ricevuto, bozza o inviato oltre la soglia: tace', () => {
        expect(D.officina_ricambio_ordinato(cfg(1), con(o({ articolo: { nome: 'Caffe', categoria_codice: 'CAF' } })))).toHaveLength(0)
        expect(D.officina_ricambio_ordinato(cfg(1), con(o({ received_at: fa(ORE) })))).toHaveLength(0)
        expect(D.officina_ricambio_ordinato(cfg(1), con(o({ stato: 'bozza' })))).toHaveLength(0)
        expect(D.officina_ricambio_ordinato(cfg(1), con(o({ sent_at: fa(2 * GIORNO) })))).toHaveLength(0)
    })
})

