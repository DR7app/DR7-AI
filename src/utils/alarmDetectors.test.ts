/**
 * Test delle rilevazioni allarmi.
 *
 * Le rilevazioni sono funzioni pure (dati dentro, occorrenze fuori): si
 * possono provare senza database, ed e' il motivo per cui sono state
 * separate dal motore. Qui si controllano i confini — dentro la finestra e
 * appena fuori — perche' e' li' che un allarme sbaglia: o non suona quando
 * serve, o suona per sempre.
 */
import { describe, it, expect } from 'vitest'
import {
    DETECTORS,
    eseguiRilevazioni,
    type AlarmCfgLite,
    type BookingLite,
    type DetectorContext,
} from './alarmDetectors'

const ORA = new Date('2026-08-21T10:00:00.000Z')
const MIN = 60_000

function cfg(over: Partial<AlarmCfgLite> = {}): AlarmCfgLite {
    return {
        id: 'test',
        detector: 'pickup_lead',
        threshold_value: 60,
        threshold_unit: 'minutes_before',
        priority: 'attenzione',
        is_enabled: true,
        stato_rilevamento: 'attivo',
        ...over,
    }
}

function noleggio(over: Partial<BookingLite> = {}): BookingLite {
    return {
        id: over.id || 'b1',
        service_type: null,
        status: 'confirmed',
        payment_status: 'paid',
        price_total: 500,
        amount_paid: 500,
        customer_name: 'Mario Rossi',
        vehicle_name: 'BMW M8',
        vehicle_plate: 'AA111BB',
        vehicle_id: 'v1',
        pickup_date: new Date(ORA.getTime() + 30 * MIN).toISOString(),
        dropoff_date: new Date(ORA.getTime() + 3 * 24 * 60 * MIN).toISOString(),
        booking_details: {},
        ...over,
    }
}

function contesto(over: Partial<DetectorContext> = {}): DetectorContext {
    const bookings = over.bookings || []
    const perVeicolo = new Map<string, BookingLite[]>()
    for (const b of bookings) {
        if (!b.vehicle_id) continue
        const arr = perVeicolo.get(String(b.vehicle_id)) || []
        arr.push(b)
        perVeicolo.set(String(b.vehicle_id), arr)
    }
    return {
        now: ORA,
        bookings,
        vehicles: [],
        cauzioni: [],
        firme: new Map(),
        perVeicolo,
        ...over,
        ...(over.perVeicolo ? {} : { perVeicolo }),
    }
}

describe('ritiro', () => {
    it('suona quando il ritiro entra nella finestra, non prima', () => {
        const dentro = noleggio({ pickup_date: new Date(ORA.getTime() + 30 * MIN).toISOString() })
        const fuori = noleggio({ id: 'b2', pickup_date: new Date(ORA.getTime() + 90 * MIN).toISOString() })
        const hits = DETECTORS.pickup_lead(cfg({ threshold_value: 60 }), contesto({ bookings: [dentro, fuori] }))
        expect(hits.map(h => h.bookingId)).toEqual(['b1'])
    })

    it('non suona per un ritiro gia passato', () => {
        const passato = noleggio({ pickup_date: new Date(ORA.getTime() - 5 * MIN).toISOString() })
        expect(DETECTORS.pickup_lead(cfg(), contesto({ bookings: [passato] }))).toHaveLength(0)
    })

    it('orario raggiunto: suona dopo la soglia e non se il noleggio e gia partito', () => {
        const tardi = noleggio({ pickup_date: new Date(ORA.getTime() - 20 * MIN).toISOString() })
        const partito = noleggio({ id: 'b2', status: 'active', pickup_date: new Date(ORA.getTime() - 20 * MIN).toISOString() })
        const c = cfg({ threshold_value: 15, threshold_unit: 'minutes_after' })
        const hits = DETECTORS.pickup_overdue(c, contesto({ bookings: [tardi, partito] }))
        expect(hits.map(h => h.bookingId)).toEqual(['b1'])
    })

    it('veicolo ancora impegnato dal noleggio precedente', () => {
        const inCorso = noleggio({
            id: 'prec',
            pickup_date: new Date(ORA.getTime() - 2 * 24 * 60 * MIN).toISOString(),
            dropoff_date: new Date(ORA.getTime() + 5 * 60 * MIN).toISOString(),
        })
        const prossimo = noleggio({ id: 'next', pickup_date: new Date(ORA.getTime() + 30 * MIN).toISOString() })
        const hits = DETECTORS.pickup_vehicle_busy(cfg({ threshold_value: 60 }), contesto({ bookings: [inCorso, prossimo] }))
        expect(hits.map(h => h.bookingId)).toEqual(['next'])
    })

    it('consegna fuori sede senza indirizzo', () => {
        const senza = noleggio({ delivery_enabled: true, delivery_address: null })
        const con = noleggio({ id: 'b2', delivery_enabled: true, delivery_address: 'Via Roma 1' })
        const inSede = noleggio({ id: 'b3', delivery_enabled: false })
        const hits = DETECTORS.pickup_missing(cfg({ threshold_value: 120 }), contesto({ bookings: [senza, con, inSede] }), 'indirizzo')
        expect(hits.map(h => h.bookingId)).toEqual(['b1'])
    })
})

describe('contratto', () => {
    it('non generato solo se non c e ne contratto ne richiesta di firma', () => {
        const senza = noleggio()
        const con = noleggio({ id: 'b2', contract_url: 'https://x/y.pdf' })
        const hits = DETECTORS.contract_missing(cfg({ threshold_value: 120 }), contesto({ bookings: [senza, con] }))
        expect(hits.map(h => h.bookingId)).toEqual(['b1'])
    })

    it('non firmato: prima del ritiro con minutes_before, dopo con minutes_after', () => {
        const b = noleggio({ pickup_date: new Date(ORA.getTime() - 10 * MIN).toISOString() })
        const firme = new Map([['b1', { booking_id: 'b1', signed_at: null }]])
        const prima = DETECTORS.contract_unsigned(cfg({ threshold_value: 60 }), contesto({ bookings: [b], firme }))
        const dopo = DETECTORS.contract_unsigned(
            cfg({ threshold_value: 0, threshold_unit: 'minutes_after' }),
            contesto({ bookings: [b], firme }),
        )
        expect(prima).toHaveLength(0)   // il ritiro e' passato: non e' piu' "tra poco"
        expect(dopo).toHaveLength(1)
    })

    it('firmato: nessun allarme', () => {
        const b = noleggio()
        const firme = new Map([['b1', { booking_id: 'b1', signed_at: ORA.toISOString() }]])
        expect(DETECTORS.contract_unsigned(cfg({ threshold_value: 120 }), contesto({ bookings: [b], firme }))).toHaveLength(0)
    })

    it('modificato dopo la firma, con un minuto di tolleranza', () => {
        const firmato = ORA.getTime() - 60 * MIN
        const appena = noleggio({ id: 'ok', updated_at: new Date(firmato + 30_000).toISOString() })
        const dopo = noleggio({ id: 'ko', updated_at: new Date(firmato + 10 * MIN).toISOString() })
        const firme = new Map([
            ['ok', { signed_at: new Date(firmato).toISOString() }],
            ['ko', { signed_at: new Date(firmato).toISOString() }],
        ])
        const hits = DETECTORS.contract_changed_after_sign(cfg(), contesto({ bookings: [appena, dopo], firme }))
        expect(hits.map(h => h.bookingId)).toEqual(['ko'])
    })
})

describe('pagamenti', () => {
    it('distingue non pagato da parzialmente pagato', () => {
        const zero = noleggio({ id: 'zero', payment_status: 'pending', amount_paid: 0 })
        const meta = noleggio({ id: 'meta', payment_status: 'pending', amount_paid: 200 })
        const ctx = contesto({ bookings: [zero, meta] })
        const totale = DETECTORS.payment_open(cfg({ threshold_value: 120 }), ctx, 'totale')
        const parziale = DETECTORS.payment_open(cfg({ threshold_value: 120 }), ctx, 'parziale')
        expect(totale.map(h => h.bookingId)).toEqual(['zero'])
        expect(parziale.map(h => h.bookingId)).toEqual(['meta'])
    })

    it('un noleggio saldato non genera nulla', () => {
        const ok = noleggio({ payment_status: 'succeeded' })
        expect(DETECTORS.payment_open(cfg({ threshold_value: 120 }), contesto({ bookings: [ok] }), 'totale')).toHaveLength(0)
    })

    it('link di pagamento scaduto', () => {
        const scaduto = noleggio({
            id: 'scaduto', payment_status: 'pending', amount_paid: 0,
            booking_details: {
                nexi_payment_link: 'https://pay/x',
                payment_link_expires_at: new Date(ORA.getTime() - MIN).toISOString(),
            },
        })
        const valido = noleggio({
            id: 'valido', payment_status: 'pending', amount_paid: 0,
            booking_details: {
                nexi_payment_link: 'https://pay/y',
                payment_link_expires_at: new Date(ORA.getTime() + 30 * MIN).toISOString(),
            },
        })
        const ctx = contesto({ bookings: [scaduto, valido] })
        expect(DETECTORS.payment_link(cfg({ threshold_value: 120 }), ctx, 'scaduto').map(h => h.bookingId)).toEqual(['scaduto'])
        expect(DETECTORS.payment_link(cfg({ threshold_value: 120 }), ctx, 'inviato').map(h => h.bookingId)).toEqual(['valido'])
    })
})

describe('cauzione', () => {
    it('non suona se la cauzione e gia registrata sul contratto', () => {
        const b = noleggio({ security_deposit_amount: 3000 })
        const senza = DETECTORS.deposit_uncollected(cfg({ threshold_value: 120 }), contesto({ bookings: [b] }))
        const con = DETECTORS.deposit_uncollected(
            cfg({ threshold_value: 120 }),
            contesto({ bookings: [b], cauzioni: [{ riferimento_contratto_id: 'b1', stato: 'Attiva' }] }),
        )
        expect(senza).toHaveLength(1)
        expect(con).toHaveLength(0)
    })

    it('termine di restituzione: vicina, raggiunta, superata', () => {
        const fra3giorni = { id: 'c1', importo: 3000, stato: 'Attiva', scadenza_cauzione: new Date(ORA.getTime() + 3 * 24 * 60 * MIN).toISOString() }
        const oggi = { id: 'c2', importo: 3000, stato: 'Attiva', scadenza_cauzione: new Date(ORA.getTime() - 60 * MIN).toISOString() }
        const vecchia = { id: 'c3', importo: 3000, stato: 'Attiva', scadenza_cauzione: new Date(ORA.getTime() - 5 * 24 * 60 * MIN).toISOString() }
        const ctx = contesto({ cauzioni: [fra3giorni, oggi, vecchia] })
        const c = cfg({ threshold_value: 7, threshold_unit: 'days' })
        expect(DETECTORS.deposit_return_due(c, ctx, 'vicina')).toHaveLength(1)
        expect(DETECTORS.deposit_return_due(c, ctx, 'raggiunta')).toHaveLength(1)
        expect(DETECTORS.deposit_return_due(c, ctx, 'superata')).toHaveLength(1)
    })

    it('una cauzione restituita non genera piu nulla', () => {
        const restituita = { id: 'c1', importo: 3000, stato: 'Restituita', scadenza_cauzione: new Date(ORA.getTime() - 5 * 24 * 60 * MIN).toISOString() }
        expect(DETECTORS.deposit_return_due(cfg({ threshold_unit: 'days' }), contesto({ cauzioni: [restituita] }), 'superata')).toHaveLength(0)
    })
})

describe('riconsegna', () => {
    it('in ritardo oltre la soglia', () => {
        const tardi = noleggio({ id: 'tardi', dropoff_date: new Date(ORA.getTime() - 40 * MIN).toISOString() })
        const poco = noleggio({ id: 'poco', dropoff_date: new Date(ORA.getTime() - 5 * MIN).toISOString() })
        const c = cfg({ threshold_value: 30, threshold_unit: 'minutes_after' })
        expect(DETECTORS.return_overdue(c, contesto({ bookings: [tardi, poco] })).map(h => h.bookingId)).toEqual(['tardi'])
    })

    it('il ritardo blocca il cliente successivo sullo stesso veicolo', () => {
        const inRitardo = noleggio({ id: 'ritardo', dropoff_date: new Date(ORA.getTime() - 30 * MIN).toISOString() })
        const successivo = noleggio({
            id: 'next',
            pickup_date: new Date(ORA.getTime() + 45 * MIN).toISOString(),
            dropoff_date: new Date(ORA.getTime() + 2 * 24 * 60 * MIN).toISOString(),
        })
        const hits = DETECTORS.return_blocks_next(cfg({ threshold_value: 120 }), contesto({ bookings: [inRitardo, successivo] }))
        expect(hits.map(h => h.bookingId)).toEqual(['ritardo'])
    })
})

describe('calendario', () => {
    it('rileva due noleggi sovrapposti sullo stesso veicolo', () => {
        const a = noleggio({ id: 'a', pickup_date: new Date(ORA.getTime() + 60 * MIN).toISOString(), dropoff_date: new Date(ORA.getTime() + 5 * 60 * MIN).toISOString() })
        const b = noleggio({ id: 'b', pickup_date: new Date(ORA.getTime() + 2 * 60 * MIN).toISOString(), dropoff_date: new Date(ORA.getTime() + 8 * 60 * MIN).toISOString() })
        expect(DETECTORS.booking_overlap(cfg(), contesto({ bookings: [a, b] }))).toHaveLength(1)
    })

    it('ignora una sovrapposizione tutta nel passato', () => {
        const g = 24 * 60 * MIN
        const a = noleggio({ id: 'a', pickup_date: new Date(ORA.getTime() - 5 * g).toISOString(), dropoff_date: new Date(ORA.getTime() - 3 * g).toISOString() })
        const b = noleggio({ id: 'b', pickup_date: new Date(ORA.getTime() - 4 * g).toISOString(), dropoff_date: new Date(ORA.getTime() - 2 * g).toISOString() })
        expect(DETECTORS.booking_overlap(cfg(), contesto({ bookings: [a, b] }))).toHaveLength(0)
    })

    it('troppo poco tempo tra un rientro e la partenza successiva', () => {
        const a = noleggio({ id: 'a', pickup_date: new Date(ORA.getTime() + 60 * MIN).toISOString(), dropoff_date: new Date(ORA.getTime() + 5 * 60 * MIN).toISOString() })
        const b = noleggio({ id: 'b', pickup_date: new Date(ORA.getTime() + 5 * 60 * MIN + 20 * MIN).toISOString(), dropoff_date: new Date(ORA.getTime() + 20 * 60 * MIN).toISOString() })
        const hits = DETECTORS.booking_gap_short(cfg({ threshold_value: 60 }), contesto({ bookings: [a, b] }))
        expect(hits.map(h => h.bookingId)).toEqual(['b'])
    })
})

describe('veicolo', () => {
    const veicolo = (over: Record<string, unknown> = {}) => ({
        id: 'v1', display_name: 'BMW M8', plate: 'AA111BB', status: 'available', ...over,
    })

    it('scadenza vicina e scadenza superata sono due cose diverse', () => {
        const g = 24 * 60 * MIN
        const traTre = veicolo({ id: 'v1', insurance_expiry: new Date(ORA.getTime() + 3 * g).toISOString() })
        const gia = veicolo({ id: 'v2', insurance_expiry: new Date(ORA.getTime() - g).toISOString() })
        const ctx = contesto({ vehicles: [traTre, gia] })
        const c = cfg({ threshold_value: 7, threshold_unit: 'days' })
        expect(DETECTORS.vehicle_expiry(c, ctx, 'insurance_expiry').map(h => h.vehicleId)).toEqual(['v1'])
        expect(DETECTORS.vehicle_expired(c, ctx, 'insurance_expiry').map(h => h.vehicleId)).toEqual(['v2'])
    })

    it('i veicoli ritirati dalla flotta non generano scadenze', () => {
        const g = 24 * 60 * MIN
        const fuori = veicolo({ status: 'retired', insurance_expiry: new Date(ORA.getTime() - g).toISOString() })
        expect(DETECTORS.vehicle_expired(cfg(), contesto({ vehicles: [fuori] }), 'insurance_expiry')).toHaveLength(0)
    })
})

describe('esecuzione', () => {
    it('salta gli allarmi spenti, quelli senza rilevazione e quelli storici', () => {
        const b = noleggio()
        const ctx = contesto({ bookings: [b] })
        const cfgs: AlarmCfgLite[] = [
            cfg({ id: 'acceso', detector: 'pickup_lead' }),
            cfg({ id: 'spento', detector: 'pickup_lead', is_enabled: false }),
            cfg({ id: 'senza', detector: null }),
            cfg({ id: 'storico', detector: 'legacy_car_wash' }),
            cfg({ id: 'inesistente', detector: 'detector_che_non_esiste' }),
        ]
        const out = eseguiRilevazioni(cfgs, ctx)
        expect(out.map(o => o.cfg.id)).toEqual(['acceso'])
    })

    it('una rilevazione che esplode non ferma le altre', () => {
        const originale = DETECTORS.pickup_lead
        try {
            DETECTORS.detector_rotto = () => { throw new Error('boom') }
            const ctx = contesto({ bookings: [noleggio()] })
            const out = eseguiRilevazioni([
                cfg({ id: 'rotto', detector: 'detector_rotto' }),
                cfg({ id: 'sano', detector: 'pickup_lead' }),
            ], ctx)
            expect(out.map(o => o.cfg.id)).toEqual(['sano'])
        } finally {
            delete DETECTORS.detector_rotto
            DETECTORS.pickup_lead = originale
        }
    })
})
