/**
 * Test delle rilevazioni Pagamenti / Cauzione / Contratto (01/10/2026).
 * Ogni rilevazione: un caso che deve suonare e almeno un caso vicino che non
 * deve (gia' pagato, fuori finestra, dato mancante = silenzio).
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../supabaseClient', () => ({ supabase: {} }))

import { moduloPagamentiCauzioniContratti as M, K, residuoCent } from './pagamentiCauzioniContratti'
import { DETECTORS, type AlarmCfgLite, type BookingLite, type DetectorContext } from '../alarmDetectors'

const ORA = new Date('2026-10-01T10:00:00.000Z')
const MIN = 60_000
const GIORNO = 24 * 60 * MIN
const D = M.detectors

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
        pickup_date: new Date(ORA.getTime() + 30 * MIN).toISOString(),
        dropoff_date: new Date(ORA.getTime() + 2 * GIORNO).toISOString(),
        booking_details: {}, ...over,
    }
}

function ctx(over: Partial<DetectorContext> = {}, extra: Record<string, unknown[]> = {}): DetectorContext {
    return {
        now: ORA, bookings: [], vehicles: [], cauzioni: [], firme: new Map(), perVeicolo: new Map(),
        ...over, extra,
    }
}

const rientrato = { pickup_date: new Date(ORA.getTime() - 3 * GIORNO).toISOString(), dropoff_date: new Date(ORA.getTime() - 2 * 60 * MIN).toISOString(), status: 'completata' }

describe('pagamenti', () => {
    it('addebito aperto: separa sforo km dagli altri addebiti', () => {
        const b = noleggio({
            ...rientrato,
            booking_details: {
                penalties: [
                    { label: 'Sforo Km', total: 147.5, discount: 7.5, amountPaid: 100, paymentStatus: 'partial' },
                    { label: 'Carburante mancante', total: 50, amountPaid: 0, paymentStatus: 'pending' },
                ],
                danni: [{ label: 'Graffio', total: 300, amountPaid: 300, paymentStatus: 'paid' }],
            },
        })
        const km = D.pag_x_addebito_aperto(cfg(), ctx({ bookings: [b] }), 'km')
        expect(km).toHaveLength(1)
        expect(km[0].dettaglio).toContain('40,00')
        const altri = D.pag_x_addebito_aperto(cfg(), ctx({ bookings: [b] }), 'danni')
        expect(altri).toHaveLength(1)
        expect(altri[0].dettaglio).toContain('Carburante')
        expect(altri[0].dettaglio).not.toContain('Graffio')
    })

    it('addebito aperto: tace se saldato con lo sconto o se il rientro e\' troppo vecchio', () => {
        const saldato = noleggio({ ...rientrato, booking_details: { penalties: [{ label: 'Sforo km', total: 487.5, discount: 37.5, amountPaid: 450, paymentStatus: 'partial' }] } })
        expect(D.pag_x_addebito_aperto(cfg(), ctx({ bookings: [saldato] }), 'km')).toHaveLength(0)
        const vecchio = noleggio({ dropoff_date: new Date(ORA.getTime() - 40 * GIORNO).toISOString(), booking_details: { penalties: [{ label: 'Sforo km', total: 100, paymentStatus: 'pending' }] } })
        expect(D.pag_x_addebito_aperto(cfg(), ctx({ bookings: [vecchio] }), 'km')).toHaveLength(0)
    })

    it('estensione non pagata solo se resta un residuo sulla prenotazione', () => {
        const ext = { extension_history: [{ payment_status: 'nexi_pay_by_link', additional_amount: 60, new_dropoff: rientrato.dropoff_date }] }
        const aperta = noleggio({ ...rientrato, price_total: 80700, amount_paid: 74700, booking_details: ext })
        expect(D.pag_x_estensione_non_pagata(cfg(), ctx({ bookings: [aperta] }))).toHaveLength(1)
        const coperta = noleggio({ ...rientrato, price_total: 80700, amount_paid: 80700, booking_details: ext })
        expect(D.pag_x_estensione_non_pagata(cfg(), ctx({ bookings: [coperta] }))).toHaveLength(0)
    })

    it('saldo residuo: acconto versato, prenotazione non coperta; usa il pagato piu\' alto', () => {
        const b = noleggio({ ...rientrato, price_total: 75000, amount_paid: 60000 })
        const hits = D.pag_x_saldo_residuo(cfg(), ctx({ bookings: [b] }))
        expect(hits).toHaveLength(1)
        expect(hits[0].dettaglio).toContain('150,00')
        const pagatoNeiDettagli = noleggio({ ...rientrato, price_total: 32900, amount_paid: 32900, booking_details: { amountPaid: 0 } })
        expect(residuoCent(pagatoNeiDettagli)).toBe(0)
        expect(D.pag_x_saldo_residuo(cfg(), ctx({ bookings: [noleggio({ ...rientrato, payment_status: 'pending', amount_paid: 0 })] }))).toHaveLength(0)
    })

    it('pagamento in scadenza: soglia in giorni prima del ritiro', () => {
        const c7 = cfg({ threshold_value: 7, threshold_unit: 'days' })
        const tra5 = noleggio({ payment_status: 'pending', amount_paid: 0, pickup_date: new Date(ORA.getTime() + 5 * GIORNO).toISOString() })
        const tra9 = noleggio({ id: 'b2', payment_status: 'pending', amount_paid: 0, pickup_date: new Date(ORA.getTime() + 9 * GIORNO).toISOString() })
        const pagato = noleggio({ id: 'b3', pickup_date: new Date(ORA.getTime() + 5 * GIORNO).toISOString() })
        const hits = D.pag_x_scadenza(c7, ctx({ bookings: [tra5, tra9, pagato] }))
        expect(hits.map(h => h.bookingId)).toEqual(['b1'])
    })
})

describe('cauzione', () => {
    it('importo inferiore al richiesto (booking_details.deposit in euro)', () => {
        const b = noleggio({ booking_details: { deposit: '2000' } })
        const c = { id: 'c1', riferimento_contratto_id: 'b1', importo: 1000, stato: 'Attiva' }
        expect(D.cauz_inferiore_richiesta(cfg(), ctx({ bookings: [b], cauzioni: [c] }))).toHaveLength(1)
        expect(D.cauz_inferiore_richiesta(cfg(), ctx({ bookings: [b], cauzioni: [{ ...c, importo: 2000 }] }))).toHaveLength(0)
        // Nessuna cauzione: e' un altro allarme.
        expect(D.cauz_inferiore_richiesta(cfg(), ctx({ bookings: [b], cauzioni: [] }))).toHaveLength(0)
    })

    it('formula senza cauzione: solo richieste ancora in attesa', () => {
        const attesa = noleggio({ booking_details: { no_cauzione_request: true } })
        const approvata = noleggio({ id: 'b2', booking_details: { no_cauzione_request: true, no_cauzione_status: 'approved' } })
        const hits = D.cauz_formula_senza_non_autorizzata(cfg(), ctx({ bookings: [attesa, approvata] }))
        expect(hits.map(h => h.bookingId)).toEqual(['b1'])
    })

    it('garanzia alternativa: garante senza dati, veicolo a garanzia senza targa', () => {
        const vuoto = noleggio({ booking_details: { garante_count: 1, guarantors: [{ index: 1, garante_1_nome_cognome: '', garante_1_codice_fiscale: '', garante_1_telefono: '' }] } })
        const completo = noleggio({ id: 'b2', booking_details: { garante_count: 1, guarantors: [{ index: 1, garante_1_nome_cognome: 'Nicola Mossa', garante_1_codice_fiscale: 'MSSNCL02C13B354L', garante_1_telefono: '393663398955' }] } })
        const auto = noleggio({ id: 'b3', booking_details: { cauzione_auto: true, cauzione_veicolo: { targa: '' } } })
        const hits = D.cauz_garanzia_alternativa(cfg(), ctx({ bookings: [vuoto, completo, auto] }))
        expect(hits.map(h => h.bookingId)).toEqual(['b1', 'b3'])
    })

    it('pre-autorizzazione: conta l\'ultimo tentativo e distingue rifiuto da errore', () => {
        const b = noleggio()
        const c = { id: 'c1', riferimento_contratto_id: 'b1', importo: 2000, stato: 'Attiva', metodo: 'carta', data_incasso: null }
        const rifiutata = [{ cauzione_id: 'c1', order_id: 'o1', status: 'failed', esito: 'DECLINED', created_at: '2026-10-01T09:00:00Z' }]
        const ex = (tx: unknown[]) => ctx({ bookings: [b] }, { [K.cauzioni]: [c], [K.preauth]: tx })
        expect(D.cauz_preauth(cfg(), ex(rifiutata), 'rifiutata')).toHaveLength(1)
        expect(D.cauz_preauth(cfg(), ex(rifiutata), 'fallita')).toHaveLength(0)
        const tre = [{ cauzione_id: 'c1', status: 'failed', esito: 'THREEDS_FAILED', created_at: '2026-10-01T09:00:00Z' }]
        expect(D.cauz_preauth(cfg(), ex(tre), 'fallita')).toHaveLength(1)
        const pendente = [...rifiutata, { cauzione_id: 'c1', status: 'pending_preauth', created_at: '2026-10-01T09:30:00Z' }]
        expect(D.cauz_preauth(cfg(), ex(pendente), 'rifiutata')).toHaveLength(0)
        expect(D.cauz_preauth(cfg(), ex(pendente), 'non_effettuata')).toHaveLength(1)
        // Pre-autorizzazione riuscita (cauzione passata a metodo preautorizzazione): silenzio.
        const coperta = ctx({ bookings: [b] }, { [K.cauzioni]: [{ ...c, metodo: 'preautorizzazione' }], [K.preauth]: pendente })
        expect(D.cauz_preauth(cfg(), coperta, 'non_effettuata')).toHaveLength(0)
        // Senza la lettura Nexi non si dice niente.
        expect(D.cauz_preauth(cfg(), ctx({ bookings: [b], cauzioni: [c] }), 'rifiutata')).toHaveLength(0)
    })

    it('storno da verificare: sbloccata in gestionale ma ancora bloccata su Nexi', () => {
        const c1 = cfg({ threshold_value: 1, threshold_unit: 'days' })
        const c = { id: 'c1', riferimento_contratto_id: 'b1', importo: 1000, stato: 'Sbloccata', metodo: 'preautorizzazione', nexi_order_id: 'o1', data_sblocco: new Date(ORA.getTime() - 2 * GIORNO).toISOString() }
        const held = [{ order_id: 'o1', status: 'preauth_held', created_at: '2026-09-20T09:00:00Z' }]
        expect(D.cauz_storno_da_verificare(c1, ctx({}, { [K.cauzioni]: [c], [K.preauth]: held }))).toHaveLength(1)
        const voided = [{ order_id: 'o1', status: 'preauth_voided', created_at: '2026-09-20T09:00:00Z' }]
        expect(D.cauz_storno_da_verificare(c1, ctx({}, { [K.cauzioni]: [c], [K.preauth]: voided }))).toHaveLength(0)
        // Stornata su Nexi, cauzione ancora attiva da piu' di un giorno.
        const aperta = { ...c, stato: 'Attiva', data_sblocco: null }
        const voidedVecchio = [{ order_id: 'o1', status: 'preauth_voided', created_at: '2026-09-20T09:00:00Z', updated_at: '2026-09-28T09:00:00Z' }]
        expect(D.cauz_storno_da_verificare(c1, ctx({}, { [K.cauzioni]: [aperta], [K.preauth]: voidedVecchio }))).toHaveLength(1)
        // Sbloccata da poche ore: ancora nella soglia.
        const recente = { ...c, data_sblocco: new Date(ORA.getTime() - 3 * 60 * MIN).toISOString() }
        expect(D.cauz_storno_da_verificare(c1, ctx({}, { [K.cauzioni]: [recente], [K.preauth]: held }))).toHaveLength(0)
    })

    it('pratica aperta dopo la chiusura: mai incassata a noleggio rientrato', () => {
        const c1 = cfg({ threshold_value: 1, threshold_unit: 'days' })
        const b = noleggio({ ...rientrato, dropoff_date: new Date(ORA.getTime() - 3 * GIORNO).toISOString() })
        const mai = { id: 'c1', riferimento_contratto_id: 'b1', importo: 2000, stato: 'Attiva', metodo: 'carta', data_incasso: null }
        expect(D.cauz_aperta_dopo_chiusura(c1, ctx({ bookings: [b] }, { [K.cauzioni]: [mai] }))).toHaveLength(1)
        expect(D.cauz_aperta_dopo_chiusura(c1, ctx({ bookings: [b] }, { [K.cauzioni]: [{ ...mai, data_incasso: '2026-09-27T10:00:00Z' }] }))).toHaveLength(0)
        // Prenotazione fuori dalla finestra del motore: letta dal modulo.
        expect(D.cauz_aperta_dopo_chiusura(c1, ctx({}, { [K.cauzioni]: [mai], [K.prenotazioni]: [b] }))).toHaveLength(1)
    })

    it('da trattenere: cauzione in restituzione e penale non pagata', () => {
        const c1 = cfg({ threshold_value: 1, threshold_unit: 'days' })
        const b = noleggio({ ...rientrato, booking_details: { penalties: [{ label: 'Sforo Km', total: 120, paymentStatus: 'pending' }] } })
        const c = { id: 'c1', riferimento_contratto_id: 'b1', importo: 2000, stato: 'In scadenza', metodo: 'carta', data_incasso: '2026-09-27T10:00:00Z', stato_restituzione: 'DA_RESTITUIRE', scadenza_cauzione: '2026-10-02' }
        expect(D.cauz_da_trattenere(c1, ctx({ bookings: [b] }, { [K.cauzioni]: [c] }))).toHaveLength(1)
        expect(D.cauz_da_trattenere(c1, ctx({ bookings: [b] }, { [K.cauzioni]: [{ ...c, scadenza_cauzione: '2026-10-20' }] }))).toHaveLength(0)
        expect(D.cauz_da_trattenere(c1, ctx({ bookings: [noleggio(rientrato)] }, { [K.cauzioni]: [c] }))).toHaveLength(0)
    })
})

describe('contratto', () => {
    const firma = (over: Record<string, unknown> = {}) => ({ id: 'r1', booking_id: 'b1', status: 'pending', signed_at: null, created_at: '2026-09-30T10:00:00Z', ...over })

    it('inviato ma non aperto: tace se c\'e\' un evento di apertura o se mancano gli eventi', () => {
        const b = noleggio()
        expect(D.contr_inviato_non_aperto(cfg(), ctx({ bookings: [b] }, { [K.firme]: [firma()], [K.eventiFirma]: [] }))).toHaveLength(1)
        const aperto = [{ signature_request_id: 'r1', event_type: 'document_viewed' }]
        expect(D.contr_inviato_non_aperto(cfg(), ctx({ bookings: [b] }, { [K.firme]: [firma()], [K.eventiFirma]: aperto }))).toHaveLength(0)
        expect(D.contr_inviato_non_aperto(cfg(), ctx({ bookings: [b] }, { [K.firme]: [firma()] }))).toHaveLength(0)
        // Una richiesta piu' recente firmata prevale su quella vecchia.
        const firmata = firma({ id: 'r2', status: 'signed', signed_at: '2026-09-30T12:00:00Z', created_at: '2026-09-30T11:00:00Z' })
        expect(D.contr_inviato_non_aperto(cfg(), ctx({ bookings: [b] }, { [K.firme]: [firma(), firmata], [K.eventiFirma]: [] }))).toHaveLength(0)
    })

    it('firma incompleta: OTP verificato e firma non apposta', () => {
        const b = noleggio()
        expect(D.contr_firma_incompleta(cfg(), ctx({ bookings: [b] }, { [K.firme]: [firma({ status: 'otp_verified' })] }))).toHaveLength(1)
        expect(D.contr_firma_incompleta(cfg(), ctx({ bookings: [b] }, { [K.firme]: [firma()], [K.eventiFirma]: [] }))).toHaveLength(0)
        expect(D.contr_firma_incompleta(cfg(), ctx({ bookings: [b] }, { [K.firme]: [firma({ status: 'superseded', otp_verified_at: '2026-09-30T10:05:00Z' })] }))).toHaveLength(0)
    })

    it('dati mancanti nel contratto stampato (ultima versione)', () => {
        const b = noleggio()
        const vecchio = { booking_id: 'b1', customer_name: 'Mario', customer_tax_code: '', customer_address: '', customer_license_number: '', updated_at: '2026-09-29T10:00:00Z' }
        const nuovo = { booking_id: 'b1', customer_name: 'Mario', customer_tax_code: 'RSSMRA80A01H501U', customer_address: 'Via Roma 1', customer_license_number: '', updated_at: '2026-09-30T10:00:00Z' }
        const hits = D.contr_dati_mancanti(cfg(), ctx({ bookings: [b] }, { [K.contratti]: [vecchio, nuovo] }))
        expect(hits).toHaveLength(1)
        expect(hits[0].dettaglio).toBe('Contratto senza: numero patente')
    })

    it('da rigenerare: rifirma richiesta e nessuna richiesta di firma dopo la modifica', () => {
        const dettagli = { contratto_rifirma_richiesta: true, contratto_rifirma_at: '2026-10-01T08:00:00Z', contratto_rifirma_voci: ['veicolo'] }
        const b = noleggio({ booking_details: dettagli })
        expect(D.contr_da_rigenerare(cfg(), ctx({ bookings: [b] }, { [K.firme]: [firma({ created_at: '2026-09-25T10:00:00Z' })] }))).toHaveLength(1)
        expect(D.contr_da_rigenerare(cfg(), ctx({ bookings: [b] }, { [K.firme]: [firma({ created_at: '2026-10-01T08:00:12Z' })] }))).toHaveLength(0)
        // Noleggio in corso (rifirma per estensione): suona anche dopo il ritiro.
        const inCorso = noleggio({ booking_details: dettagli, pickup_date: '2026-09-28T10:00:00Z' })
        expect(D.contr_da_rigenerare(cfg(), ctx({ bookings: [inCorso] }, { [K.firme]: [] }))).toHaveLength(1)
    })
})

describe('correzioni ai detector condivisi', () => {
    it('cauzione mancante legge booking_details.deposit quando security_deposit_amount e\' 0', () => {
        const b = noleggio({ security_deposit_amount: 0, deposit_amount: null, booking_details: { deposit: '2000' } })
        expect(DETECTORS.deposit_uncollected(cfg(), ctx({ bookings: [b] }))).toHaveLength(1)
    })

    it('cauzione da restituire: non suona su una cauzione gia\' restituita o mai incassata', () => {
        const base = { id: 'c1', importo: 1000, stato_restituzione: 'DA_RESTITUIRE' }
        const hits = DETECTORS.deposit_action_due(cfg(), ctx({
            cauzioni: [
                { ...base, stato: 'Restituita', data_incasso: '2026-09-01T10:00:00Z' },
                { ...base, id: 'c2', stato: 'Attiva', metodo: 'carta', data_incasso: null },
                { ...base, id: 'c3', stato: 'In scadenza', metodo: 'carta', data_incasso: '2026-09-01T10:00:00Z', veicolo_id: 'v3' },
            ],
        }), 'restituire')
        expect(hits.map(h => h.vehicleId)).toEqual(['v3'])
    })
})
