/**
 * Test delle rilevazioni Manutenzione / Pneumatici / Chilometraggio (01/10/2026).
 * Dati presi dalla forma vera di produzione: km a 0 = mai inseriti,
 * penali "Sforo Km" con paymentStatus, danni con label libera.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../supabaseClient', () => ({ supabase: {} }))

import { moduloManutenzione } from './manutenzione'
import type { AlarmCfgLite, DetectorContext } from '../alarmDetectors'

const D = moduloManutenzione.detectors
const ORA = new Date('2026-10-01T10:00:00.000Z')
const GIORNO = 24 * 60 * 60_000

function cfg(over: Partial<AlarmCfgLite> = {}): AlarmCfgLite {
    return {
        id: 't', detector: null, threshold_value: 1000, threshold_unit: 'km',
        priority: 'attenzione', is_enabled: true, stato_rilevamento: 'attivo', ...over,
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctx(extra: Record<string, any[]> = {}, bookings: any[] = []): DetectorContext {
    return { now: ORA, bookings, vehicles: [], cauzioni: [], firme: new Map(), perVeicolo: new Map(), extra }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function veicolo(over: Record<string, any> = {}) {
    return {
        id: 'v1', display_name: 'Audi RS3', plate: 'PAB3550', status: 'available', current_km: 60000,
        last_service_km: 50000, maintenance_service_interval_km: 15000,
        last_tire_change_km: 0, last_tire_change_front_km: 0, last_tire_change_rear_km: 0,
        maintenance_tires_interval_km: 30000, maintenance_tires_front_interval_km: null, maintenance_tires_rear_interval_km: null,
        last_brake_change_km: 0, last_brake_change_front_km: 0, last_brake_change_rear_km: 0,
        maintenance_brake_interval_km: 0, maintenance_brake_front_interval_km: null, maintenance_brake_rear_interval_km: null,
        ...over,
    }
}

describe('manut_tagliando', () => {
    it('vicino: dentro la soglia in km, non prima', () => {
        expect(D.manut_tagliando(cfg(), ctx({ manutenzione_veicoli: [veicolo({ current_km: 64100 })] }), 'vicino')).toHaveLength(1)
        expect(D.manut_tagliando(cfg(), ctx({ manutenzione_veicoli: [veicolo({ current_km: 63900 })] }), 'vicino')).toHaveLength(0)
        expect(D.manut_tagliando(cfg(), ctx({ manutenzione_veicoli: [veicolo({ current_km: 65000 })] }), 'vicino')).toHaveLength(0)
    })
    it('scaduto: km superati', () => {
        const h = D.manut_tagliando(cfg(), ctx({ manutenzione_veicoli: [veicolo({ current_km: 65200 })] }), 'scaduto')
        expect(h).toHaveLength(1)
        expect(h[0].vehicleId).toBe('v1')
        expect(h[0].dettaglio).toContain('Superato')
    })
    it('ultimo tagliando a 0 = mai inserito: nessun allarme', () => {
        expect(D.manut_tagliando(cfg(), ctx({ manutenzione_veicoli: [veicolo({ last_service_km: 0, current_km: 99000 })] }), 'scaduto')).toHaveLength(0)
    })
    it('un tagliando piu\' recente a registro sposta la scadenza', () => {
        const c = ctx({
            manutenzione_veicoli: [veicolo({ current_km: 65200 })],
            manutenzione_log: [{ vehicle_id: 'v1', tipo: 'Tagliando', km: 64000 }],
        })
        expect(D.manut_tagliando(cfg(), c, 'scaduto')).toHaveLength(0)
    })
    it('unita\' in giorni: usa 1.000 km', () => {
        const h = D.manut_tagliando(cfg({ threshold_value: 7, threshold_unit: 'days' }), ctx({ manutenzione_veicoli: [veicolo({ current_km: 64500 })] }), 'vicino')
        expect(h).toHaveLength(1)
    })
    it('veicoli ritirati esclusi', () => {
        expect(D.manut_tagliando(cfg(), ctx({ manutenzione_veicoli: [veicolo({ status: 'retired', current_km: 70000 })] }), 'scaduto')).toHaveLength(0)
    })
})

describe('manut_freni', () => {
    it('entro: anteriori e posteriori separati, scaduti compresi', () => {
        const v = veicolo({ current_km: 40000, last_brake_change_front_km: 25000, last_brake_change_rear_km: 30000, maintenance_brake_front_interval_km: 15000, maintenance_brake_rear_interval_km: 20000 })
        const h = D.manut_freni(cfg(), ctx({ manutenzione_veicoli: [v] }), 'entro')
        expect(h).toHaveLength(1)
        expect(h[0].entita).toContain('Freni anteriori')
    })
    it('intervallo assurdo (111 km) ignorato', () => {
        const v = veicolo({ current_km: 157650, last_brake_change_front_km: 10000, maintenance_brake_front_interval_km: 111 })
        expect(D.manut_freni(cfg(), ctx({ manutenzione_veicoli: [v] }), 'entro')).toHaveLength(0)
    })
})

describe('gomme_cambio', () => {
    const v = veicolo({ current_km: 61300, last_tire_change_front_km: 59000, last_tire_change_rear_km: 51000, maintenance_tires_interval_km: 10000 })
    it('vicino = programmato, scaduto = da sostituire', () => {
        const vicino = D.gomme_cambio(cfg(), ctx({ manutenzione_veicoli: [veicolo({ current_km: 60500, last_tire_change_front_km: 51000, last_tire_change_rear_km: 59000, maintenance_tires_interval_km: 10000 })] }), 'vicino')
        expect(vicino).toHaveLength(1)
        expect(vicino[0].entita).toContain('anteriori')
        const scad = D.gomme_cambio(cfg(), ctx({ manutenzione_veicoli: [v] }), 'scaduto')
        expect(scad).toHaveLength(1)
        expect(scad[0].entita).toContain('posteriori')
    })
    it('gomme a 0 km = mai inserite (Vito): nessun allarme', () => {
        expect(D.gomme_cambio(cfg(), ctx({ manutenzione_veicoli: [veicolo({ current_km: 54000 })] }), 'scaduto')).toHaveLength(0)
    })
})

describe('gomme_non_idonee_uscita', () => {
    const v = veicolo({ current_km: 61300, last_tire_change_front_km: 50000, last_tire_change_rear_km: 59000, maintenance_tires_interval_km: 10000 })
    const noleggio = (giorni: number, over = {}) => ({
        id: 'b1', vehicle_id: 'v1', vehicle_name: 'Audi RS3', customer_name: 'Rossi', status: 'confirmed',
        service_type: 'car_rental', pickup_date: new Date(ORA.getTime() + giorni * GIORNO).toISOString(), ...over,
    })
    it('noleggio entro la soglia su gomme scadute', () => {
        const h = D.gomme_non_idonee_uscita(cfg({ threshold_value: 7, threshold_unit: 'days' }), ctx({ manutenzione_veicoli: [v] }, [noleggio(3)]))
        expect(h).toHaveLength(1)
        expect(h[0].bookingId).toBe('b1')
    })
    it('noleggio oltre la soglia, cancellato o gia\' partito: niente', () => {
        const c = cfg({ threshold_value: 7, threshold_unit: 'days' })
        expect(D.gomme_non_idonee_uscita(c, ctx({ manutenzione_veicoli: [v] }, [noleggio(10)]))).toHaveLength(0)
        expect(D.gomme_non_idonee_uscita(c, ctx({ manutenzione_veicoli: [v] }, [noleggio(-1)]))).toHaveLength(0)
        expect(D.gomme_non_idonee_uscita(c, ctx({ manutenzione_veicoli: [v] }, [noleggio(2, { status: 'completata' })]))).toHaveLength(0)
    })
})

describe('km_anomalo', () => {
    it('contachilometri sotto un km gia\' registrato', () => {
        const h = D.km_anomalo(cfg(), ctx({ manutenzione_veicoli: [veicolo({ current_km: 48000 })] }))
        expect(h).toHaveLength(1)
        expect(h[0].dettaglio).toContain('ultimo tagliando')
    })
    it('anche contro il registro interventi', () => {
        const h = D.km_anomalo(cfg(), ctx({ manutenzione_veicoli: [veicolo()], manutenzione_log: [{ vehicle_id: 'v1', tipo: 'Riparazione', km: 61000 }] }))
        expect(h).toHaveLength(1)
    })
    it('dati coerenti o km mai inseriti: niente', () => {
        expect(D.km_anomalo(cfg(), ctx({ manutenzione_veicoli: [veicolo()] }))).toHaveLength(0)
        expect(D.km_anomalo(cfg(), ctx({ manutenzione_veicoli: [veicolo({ current_km: 0 })] }))).toHaveLength(0)
    })
})

describe('km_sforo', () => {
    const giorni = (n: number) => new Date(ORA.getTime() - n * GIORNO).toISOString().slice(0, 10)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pren = (penalties: any[], over = {}) => ({ id: 'b1', vehicle_id: 'v1', vehicle_name: 'Audi RS3', customer_name: 'Rossi', status: 'confirmed', dropoff_date: ORA.toISOString(), penalties, ...over })
    const c1 = cfg({ threshold_value: 1, threshold_unit: 'days' })

    it('da_calcolare: km scritti, importo 0', () => {
        const h = D.km_sforo(c1, ctx({ manutenzione_addebiti: [pren([{ label: 'Sforo Km', quantity: 80, amount: 0, total: 0, paymentStatus: 'pending', date: giorni(0) }])] }), 'da_calcolare')
        expect(h).toHaveLength(1)
        expect(h[0].dettaglio).toContain('tariffa')
    })
    it('non_pagato: dopo la soglia, non se pagato o se di oggi', () => {
        const p = { label: 'Sforo km', quantity: 100, amount: 2.5, total: 250, paymentStatus: 'pending', date: giorni(2) }
        expect(D.km_sforo(c1, ctx({ manutenzione_addebiti: [pren([p])] }), 'non_pagato')).toHaveLength(1)
        expect(D.km_sforo(c1, ctx({ manutenzione_addebiti: [pren([{ ...p, paymentStatus: 'paid', amountPaid: 250 }])] }), 'non_pagato')).toHaveLength(0)
        expect(D.km_sforo(c1, ctx({ manutenzione_addebiti: [pren([{ ...p, date: giorni(0) }])] }), 'non_pagato')).toHaveLength(0)
        expect(D.km_sforo(c1, ctx({ manutenzione_addebiti: [pren([p], { status: 'cancelled' })] }), 'non_pagato')).toHaveLength(0)
    })
    it('parziale = ancora da incassare', () => {
        const p = { label: 'Sforo Km', quantity: 100, amount: 2.5, total: 250, amountPaid: 100, paymentStatus: 'partial', date: giorni(3) }
        const h = D.km_sforo(c1, ctx({ manutenzione_addebiti: [pren([p])] }), 'non_pagato')
        expect(h[0].dettaglio).toContain('150.00')
    })
    it('registrato: solo se recente, e solo voci di sforo', () => {
        const recente = { label: 'sforo 69 km', quantity: 69, amount: 3, total: 207, paymentStatus: 'paid', date: giorni(0) }
        expect(D.km_sforo(c1, ctx({ manutenzione_addebiti: [pren([recente])] }), 'registrato')).toHaveLength(1)
        expect(D.km_sforo(c1, ctx({ manutenzione_addebiti: [pren([{ ...recente, date: giorni(5) }])] }), 'registrato')).toHaveLength(0)
        expect(D.km_sforo(c1, ctx({ manutenzione_addebiti: [pren([{ ...recente, label: 'Carburante mancante' }])] }), 'registrato')).toHaveLength(0)
    })
})

describe('gomme_danno', () => {
    const giorni = (n: number) => new Date(ORA.getTime() - n * GIORNO).toISOString().slice(0, 10)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pren = (danni: any[]) => ({ id: 'b1', vehicle_id: 'v1', vehicle_name: 'Audi RS3', customer_name: 'Rossi', status: 'confirmed', dropoff_date: ORA.toISOString(), danni, penalties: [] })
    const c7 = cfg({ threshold_value: 7, threshold_unit: 'days' })

    it('danno: foro gomma recente, non l\'usura, non il gonfiatore', () => {
        const c = ctx({ manutenzione_addebiti: [pren([
            { label: 'Foro Gomma', date: giorni(2) },
            { label: 'Gomme bruciate 50%', date: giorni(2) },
            { label: 'gonfiatore gomme', date: giorni(2) },
        ])] })
        const h = D.gomme_danno(c7, c, 'danno')
        expect(h).toHaveLength(1)
        expect(h[0].dettaglio).toContain('Foro Gomma')
    })
    it('usura: consumo e gomme bruciate', () => {
        const c = ctx({ manutenzione_addebiti: [pren([{ label: 'Gomme bruciate 50%', date: giorni(1) }, { label: 'Consumo gomma ant sx', date: giorni(1) }])] })
        expect(D.gomme_danno(c7, c, 'usura')).toHaveLength(2)
    })
    it('fatto vecchio oltre la soglia: niente', () => {
        const c = ctx({ manutenzione_addebiti: [pren([{ label: 'Foro Gomma', date: giorni(20) }])] })
        expect(D.gomme_danno(c7, c, 'danno')).toHaveLength(0)
    })
})
