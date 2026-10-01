/**
 * Test delle rilevazioni sui danni (01/10/2026): funzioni pure, dati finti
 * in ctx.extra come li mette `carica`.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../supabaseClient', () => ({ supabase: {} }))

import { DETECTORS_DANNI_SINISTRI as D, moduloDanniSinistri } from './danniSinistri'
import type { AlarmCfgLite, DetectorContext } from '../alarmDetectors'

// 12:00 a Roma, 1 ottobre.
const ORA = new Date('2026-10-01T10:00:00.000Z')

function cfg(over: Partial<AlarmCfgLite> = {}): AlarmCfgLite {
    return {
        id: 'test', detector: null, threshold_value: 1, threshold_unit: 'days',
        priority: 'attenzione', is_enabled: true, stato_rilevamento: 'attivo', ...over,
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function danno(over: Record<string, any> = {}) {
    return {
        label: 'paraurti', amount: 500, quantity: 1, total: 500, discount: 0,
        amountPaid: 0, paymentStatus: 'pending', photos: [], date: '2026-09-30', ...over,
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctx(danni: any[], over: Record<string, any> = {}): DetectorContext {
    return {
        now: ORA, bookings: [], vehicles: [], cauzioni: [], firme: new Map(), perVeicolo: new Map(),
        extra: {
            danniSinistri_prenotazioni: [{
                id: 'b1', vehicle_id: 'v1', vehicle_name: 'Audi RS3', vehicle_plate: 'AB123CD',
                customer_name: 'Mario Rossi', pickup_date: '2026-09-25T10:00:00+02:00',
                dropoff_date: '2026-09-29T10:00:00+02:00', status: 'completata', danni, ...over,
            }],
        },
    }
}

describe('modulo danni/sinistri', () => {
    it('nomi dei detector prefissati e unici', () => {
        expect(moduloDanniSinistri.nome).toBe('danniSinistri')
        for (const k of Object.keys(moduloDanniSinistri.detectors)) expect(k.startsWith('danni_')).toBe(true)
    })

    it('senza dati caricati non suona niente', () => {
        const c = ctx([]); c.extra = {}
        for (const fn of Object.values(D)) expect(fn(cfg(), c)).toEqual([])
    })
})

describe('danni_nuovo', () => {
    it('danno di ieri con soglia 1 giorno: suona, una occorrenza per prenotazione', () => {
        const h = D.danni_nuovo(cfg(), ctx([danno(), danno({ label: 'cerchio', date: '2026-10-01' })]))
        expect(h).toHaveLength(1)
        expect(h[0].bookingId).toBe('b1')
        expect(h[0].vehicleId).toBe('v1')
        expect(h[0].entita).toContain('AB123CD')
        expect(h[0].dettaglio).toContain('paraurti')
        expect(h[0].dettaglio).toContain('cerchio')
    })
    it('danno di due giorni fa con soglia 1 giorno: tace', () => {
        expect(D.danni_nuovo(cfg(), ctx([danno({ date: '2026-09-29' })]))).toEqual([])
    })
    it('data nel futuro o mancante senza date del noleggio: tace', () => {
        expect(D.danni_nuovo(cfg(), ctx([danno({ date: '2026-10-05' })]))).toEqual([])
        expect(D.danni_nuovo(cfg(), ctx([danno({ date: undefined })], { pickup_date: null, dropoff_date: null }))).toEqual([])
    })
})

describe('danni_senza_foto', () => {
    it('registrato da 1 giorno senza foto: suona', () => {
        expect(D.danni_senza_foto(cfg(), ctx([danno()]))).toHaveLength(1)
    })
    it('con foto: tace', () => {
        expect(D.danni_senza_foto(cfg(), ctx([danno({ photos: ['https://x/y.jpg'] })]))).toEqual([])
    })
    it('registrato oggi (soglia non raggiunta): tace', () => {
        expect(D.danni_senza_foto(cfg(), ctx([danno({ date: '2026-10-01' })]))).toEqual([])
    })
    it('oltre 7 giorni non e\' piu\' un allarme', () => {
        expect(D.danni_senza_foto(cfg(), ctx([danno({ date: '2026-09-23' })]))).toEqual([])
        expect(D.danni_senza_foto(cfg(), ctx([danno({ date: '2026-09-24' })]))).toHaveLength(1)
    })
})

describe('danni_senza_importo', () => {
    it('importo zero: suona; importo presente: tace', () => {
        expect(D.danni_senza_importo(cfg(), ctx([danno({ amount: 0, total: 0 })]))).toHaveLength(1)
        expect(D.danni_senza_importo(cfg(), ctx([danno()]))).toEqual([])
    })
})

describe('danni_non_addebitato', () => {
    it('nulla incassato da 1 giorno: suona con l\'importo finale (listino - sconto)', () => {
        const h = D.danni_non_addebitato(cfg(), ctx([danno({ discount: 100 })]))
        expect(h).toHaveLength(1)
        expect(h[0].dettaglio).toContain('400,00')
    })
    it('pagato o pagato in parte: tace', () => {
        expect(D.danni_non_addebitato(cfg(), ctx([danno({ paymentStatus: 'paid', amountPaid: 500 })]))).toEqual([])
        expect(D.danni_non_addebitato(cfg(), ctx([danno({ paymentStatus: 'partial', amountPaid: 100 })]))).toEqual([])
    })
    it('segnato pagato a mano anche senza importo incassato: tace (come GestioneDanniTab)', () => {
        expect(D.danni_non_addebitato(cfg(), ctx([danno({ paymentStatus: 'paid', amountPaid: 0 })]))).toEqual([])
    })
    it('i soldi restano allarme anche dopo settimane', () => {
        expect(D.danni_non_addebitato(cfg(), ctx([danno({ date: '2026-08-01' })]))).toHaveLength(1)
    })
    it('registrato oggi con soglia 1 giorno: tace', () => {
        expect(D.danni_non_addebitato(cfg(), ctx([danno({ date: '2026-10-01' })]))).toEqual([])
    })
})

describe('danni_saldo_aperto', () => {
    it('incassato in parte: suona con quanto manca', () => {
        const h = D.danni_saldo_aperto(cfg(), ctx([danno({ paymentStatus: 'partial', amountPaid: 200 })]))
        expect(h).toHaveLength(1)
        expect(h[0].dettaglio).toContain('300,00')
    })
    it('saldato o mai incassato: tace', () => {
        expect(D.danni_saldo_aperto(cfg(), ctx([danno({ paymentStatus: 'paid', amountPaid: 500 })]))).toEqual([])
        expect(D.danni_saldo_aperto(cfg(), ctx([danno()]))).toEqual([])
    })
    it('sconto che porta il dovuto a quanto incassato: tace', () => {
        expect(D.danni_saldo_aperto(cfg(), ctx([danno({ discount: 300, amountPaid: 200, paymentStatus: 'partial' })]))).toEqual([])
    })
})
