/**
 * Test delle rilevazioni "documenti" e "fatturazione" (01/10/2026).
 * Funzioni pure: dati dentro, occorrenze fuori. Per ogni voce si prova il
 * caso che deve suonare e quello, appena accanto, che deve tacere.
 */
import { describe, it, expect, vi } from 'vitest'

// Le rilevazioni non toccano la rete: il client serve solo a `carica`.
vi.mock('../../supabaseClient', () => ({ supabase: {} }))

import type { AlarmCfgLite, BookingLite, DetectorContext } from '../alarmDetectors'
import {
    DETECTORS_DOCUMENTI_FATTURE as D,
    K_CLIENTI,
    K_DOCUMENTI,
    K_DOCUMENTI_SITO,
    K_FATTURE,
    K_INCASSI,
    K_METODI,
    K_PRENOTAZIONI_FATTURE,
    anniCompiutiAl,
    campiMancantiContratto,
    codiceFiscaleValido,
    latoDocumentoSito,
} from './documentiFatture'
import { detectorsDeiModuli } from './index'

const ORA = new Date('2026-10-01T10:00:00.000Z')
const MIN = 60_000
const GIORNO = 24 * 60 * MIN

function cfg(over: Partial<AlarmCfgLite> = {}): AlarmCfgLite {
    return {
        id: 'test', detector: null, threshold_value: 120, threshold_unit: 'minutes_before',
        priority: 'attenzione', is_enabled: true, stato_rilevamento: 'attivo', ...over,
    }
}
const UN_GIORNO = cfg({ threshold_value: 1, threshold_unit: 'days' })

function noleggio(over: Partial<BookingLite> = {}): BookingLite {
    return {
        id: 'b1', service_type: null, status: 'confirmed', payment_status: 'paid', payment_method: 'Contanti',
        price_total: 500, amount_paid: 500, customer_name: 'Mario Rossi', vehicle_name: 'BMW M8',
        vehicle_plate: 'AA111BB', vehicle_id: 'v1', user_id: null,
        pickup_date: new Date(ORA.getTime() + 60 * MIN).toISOString(),
        dropoff_date: new Date(ORA.getTime() + 3 * GIORNO).toISOString(),
        booking_details: { customer: { customerId: 'c1' } },
        ...over,
    }
}

function cliente(over: Record<string, unknown> = {}) {
    return {
        id: 'c1', user_id: 'u1', tipo_cliente: 'persona_fisica', nome: 'Mario', cognome: 'Rossi',
        codice_fiscale: 'RSSMRA80A01B354X', telefono: '3331112222', data_nascita: '1980-01-01',
        luogo_nascita: 'Cagliari', sesso: 'M', numero_patente: 'CA123', emessa_da: 'MC-CA',
        data_rilascio_patente: '2000-05-05', scadenza_patente: '2030-05-05', indirizzo: 'Via Roma 1',
        citta_residenza: 'Cagliari', provincia_residenza: 'CA', codice_postale: '09100',
        ...over,
    }
}

function ctx(bookings: BookingLite[], extra: Record<string, unknown[]> = {}): DetectorContext {
    return { now: ORA, bookings, vehicles: [], cauzioni: [], firme: new Map(), perVeicolo: new Map(), extra }
}

describe('registro', () => {
    it('tutte le rilevazioni del modulo sono registrate e hanno nomi del gruppo', () => {
        const reg = detectorsDeiModuli()
        for (const k of Object.keys(D)) {
            expect(reg[k]).toBeTypeOf('function')
            expect(k.startsWith('doc_x_') || k.startsWith('fatt_')).toBe(true)
        }
    })
})

describe('aiutanti', () => {
    it('anni compiuti al giorno di riferimento', () => {
        expect(anniCompiutiAl('2005-10-02', ORA)).toBe(20)
        expect(anniCompiutiAl('2005-10-01', ORA)).toBe(21)
        expect(anniCompiutiAl('', ORA)).toBeNull()
    })
    it('codice fiscale: persona, azienda e segnaposto', () => {
        expect(codiceFiscaleValido('LRASFN01E25Z138I')).toBe(true)
        expect(codiceFiscaleValido('03947310920')).toBe(true)
        expect(codiceFiscaleValido('XXXXXXXXXXXXXXXX')).toBe(false)
        expect(codiceFiscaleValido('0000000000000000')).toBe(false)
        expect(codiceFiscaleValido('')).toBe(false)
    })
    it('tipi dei documenti del sito: nomi storici si, nomi di file no', () => {
        expect(latoDocumentoSito('patenteFront')).toEqual({ tipo: 'patente', lato: 'fronte' })
        expect(latoDocumentoSito('cartaIdentitaBack')).toEqual({ tipo: 'identita', lato: 'retro' })
        expect(latoDocumentoSito('id_back')).toEqual({ tipo: 'identita', lato: 'retro' })
        expect(latoDocumentoSito('license')).toEqual({ tipo: 'patente', lato: 'completo' })
        expect(latoDocumentoSito('1766049848892.jpg')).toBeNull()
        expect(latoDocumentoSito('drivers_license_1770368567103')).toBeNull()
    })
    it('dati per il contratto: persona fisica completa e azienda', () => {
        expect(campiMancantiContratto(cliente())).toEqual([])
        expect(campiMancantiContratto(cliente({ scadenza_patente: null, telefono: '' }))).toEqual(['telefono', 'scadenza patente'])
        expect(campiMancantiContratto({ tipo_cliente: 'azienda', sede_legale: 'Via X', ragione_sociale: 'ACME', telefono: '1' }))
            .toEqual(['partita IVA'])
    })
})

describe('documenti', () => {
    it('anzianità patente: sotto i 3 anni suona, con OTP o fuori finestra no', () => {
        const giovane = cliente({ data_rilascio_patente: '2024-06-01' })
        const b = noleggio()
        const lontano = noleggio({ id: 'b2', pickup_date: new Date(ORA.getTime() + 5 * 60 * MIN).toISOString() })
        const autorizzato = noleggio({ id: 'b3', booking_details: { customer: { customerId: 'c1' }, limitation_overrides: [{ limitationCode: 'license_too_recent' }] } })
        const hits = D.doc_x_anzianita_patente(cfg(), ctx([b, lontano, autorizzato], { [K_CLIENTI]: [giovane] }))
        expect(hits.map(h => h.bookingId)).toEqual(['b1'])
        expect(D.doc_x_anzianita_patente(cfg(), ctx([b], { [K_CLIENTI]: [cliente()] }))).toEqual([])
    })

    it('età conducente: 20 o 70 anni suona, 30 no, autorizzato no', () => {
        expect(D.doc_x_eta_conducente(cfg(), ctx([noleggio()], { [K_CLIENTI]: [cliente({ data_nascita: '2006-01-01' })] }))).toHaveLength(1)
        expect(D.doc_x_eta_conducente(cfg(), ctx([noleggio()], { [K_CLIENTI]: [cliente({ data_nascita: '1950-01-01' })] }))).toHaveLength(1)
        expect(D.doc_x_eta_conducente(cfg(), ctx([noleggio()], { [K_CLIENTI]: [cliente()] }))).toHaveLength(0)
        const ok = noleggio({ booking_details: { customer: { customerId: 'c1' }, limitation_overrides: [{ limitationCode: 'driver_blocked' }] } })
        expect(D.doc_x_eta_conducente(cfg(), ctx([ok], { [K_CLIENTI]: [cliente({ data_nascita: '1950-01-01' })] }))).toHaveLength(0)
    })

    it('età: senza scheda si usa la data della prenotazione, mai un nome', () => {
        const b = noleggio({ booking_details: {}, date_of_birth: '2007-01-01' })
        expect(D.doc_x_eta_conducente(cfg(), ctx([b]))).toHaveLength(1)
        expect(D.doc_x_eta_conducente(cfg(), ctx([noleggio({ booking_details: {} })]))).toHaveLength(0)
    })

    it('pratica da confermare: solo lo stato pending', () => {
        const hits = D.doc_x_pratica_da_confermare(cfg(), ctx([noleggio({ status: 'pending' }), noleggio({ id: 'b2' })]))
        expect(hits.map(h => h.bookingId)).toEqual(['b1'])
    })

    it('dati cliente incompleti: elenca i campi, scheda non trovata tace', () => {
        const hits = D.doc_x_dati_incompleti(cfg(), ctx([noleggio()], { [K_CLIENTI]: [cliente({ luogo_nascita: '' })] }))
        expect(hits[0].dettaglio).toContain('luogo di nascita')
        expect(D.doc_x_dati_incompleti(cfg(), ctx([noleggio()], { [K_CLIENTI]: [] }))).toEqual([])
    })

    it('documento rifiutato: suona finché non c’è un caricamento più recente', () => {
        const b = noleggio({ user_id: 'u1' })
        const rif = { user_id: 'u1', document_type: 'patenteFront', status: 'rejected', rejection_reason: 'illeggibile', created_at: '2026-09-01T10:00:00Z' }
        const hits = D.doc_x_documento_rifiutato(cfg(), ctx([b], { [K_DOCUMENTI_SITO]: [rif] }))
        expect(hits[0].dettaglio).toContain('illeggibile')
        const nuovo = { ...rif, status: 'pending_verification', created_at: '2026-09-10T10:00:00Z' }
        expect(D.doc_x_documento_rifiutato(cfg(), ctx([b], { [K_DOCUMENTI_SITO]: [rif, nuovo] }))).toEqual([])
    })

    it('verifica non completata: documenti ancora da verificare', () => {
        const b = noleggio({ user_id: 'u1' })
        const doc = { user_id: 'u1', document_type: 'cartaIdentitaFront', status: 'pending_verification', created_at: '2026-09-29T10:00:00Z' }
        expect(D.doc_x_verifica_in_sospeso(cfg(), ctx([b], { [K_DOCUMENTI_SITO]: [doc] }))).toHaveLength(1)
        expect(D.doc_x_verifica_in_sospeso(cfg(), ctx([b], { [K_DOCUMENTI_SITO]: [{ ...doc, status: 'verified' }] }))).toHaveLength(0)
    })

    it('lato mancante: solo quando c’è l’altro lato', () => {
        const soloFronte = [{ customer_id: 'c1', document_type: 'identity_document_front' }]
        const hits = D.doc_x_lato_mancante(cfg(), ctx([noleggio()], { [K_CLIENTI]: [cliente()], [K_DOCUMENTI]: soloFronte }), 'retro')
        expect(hits[0].dettaglio).toContain('documento')
        expect(D.doc_x_lato_mancante(cfg(), ctx([noleggio()], { [K_CLIENTI]: [cliente()], [K_DOCUMENTI]: soloFronte }), 'fronte')).toEqual([])
        // Niente di caricato: e' "documento mancante", non "lato mancante".
        expect(D.doc_x_lato_mancante(cfg(), ctx([noleggio()], { [K_CLIENTI]: [cliente()], [K_DOCUMENTI]: [] }), 'retro')).toEqual([])
        // Formato vecchio a file unico: completo.
        expect(D.doc_x_lato_mancante(cfg(), ctx([noleggio()], { [K_CLIENTI]: [cliente()], [K_DOCUMENTI]: [...soloFronte, { customer_id: 'c1', document_type: 'identity_document' }] }), 'retro')).toEqual([])
        // Retro sulla prenotazione stessa.
        const conRetro = noleggio({ booking_details: { customer: { customerId: 'c1' }, driverIdImageBack: 'x.jpg' } })
        expect(D.doc_x_lato_mancante(cfg(), ctx([conRetro], { [K_CLIENTI]: [cliente()], [K_DOCUMENTI]: soloFronte }), 'retro')).toEqual([])
    })

    it('secondo conducente: senza patente in archivio suona', () => {
        const b = noleggio({ booking_details: { customer: { customerId: 'c1' }, second_driver: { name: 'Anna', surname: 'Bianchi', customer_id: 'c2' } } })
        const solo = [{ customer_id: 'c2', document_type: 'identity_document_front' }]
        const hits = D.doc_x_secondo_conducente(cfg(), ctx([b], { [K_DOCUMENTI]: solo }))
        expect(hits[0].dettaglio).toBe('Anna Bianchi: manca patente in archivio')
        const tutti = [...solo, { customer_id: 'c2', document_type: 'drivers_license_front' }]
        expect(D.doc_x_secondo_conducente(cfg(), ctx([b], { [K_DOCUMENTI]: tutti }))).toEqual([])
        expect(D.doc_x_secondo_conducente(cfg(), ctx([noleggio()]))).toEqual([])
    })

    it('patente scaduta al ritiro: cliente e secondo conducente; OTP la spegne per il cliente', () => {
        const scaduta = cliente({ scadenza_patente: '2026-09-30' })
        expect(D.doc_x_patente_scaduta(cfg(), ctx([noleggio()], { [K_CLIENTI]: [scaduta] }))).toHaveLength(1)
        expect(D.doc_x_patente_scaduta(cfg(), ctx([noleggio()], { [K_CLIENTI]: [cliente({ scadenza_patente: '2026-10-01' })] }))).toHaveLength(0)
        const auth = noleggio({ booking_details: { customer: { customerId: 'c1' }, limitation_overrides: [{ limitationCode: 'license_expired' }] } })
        expect(D.doc_x_patente_scaduta(cfg(), ctx([auth], { [K_CLIENTI]: [scaduta] }))).toHaveLength(0)
        const sd = noleggio({ booking_details: { customer: { customerId: 'c1' }, second_driver: { name: 'Anna', license_expiry: '2026-01-01' } } })
        expect(D.doc_x_patente_scaduta(cfg(), ctx([sd], { [K_CLIENTI]: [cliente()] }))[0].dettaglio).toContain('Anna')
    })

    it('patente in scadenza: entro la soglia o prima della riconsegna', () => {
        const sette = cfg({ threshold_value: 7, threshold_unit: 'days' })
        const lontano = noleggio({ pickup_date: new Date(ORA.getTime() + 10 * GIORNO).toISOString(), dropoff_date: new Date(ORA.getTime() + 20 * GIORNO).toISOString() })
        expect(D.doc_x_patente_in_scadenza(sette, ctx([lontano], { [K_CLIENTI]: [cliente({ scadenza_patente: '2026-10-05' })] }))).toHaveLength(1)
        expect(D.doc_x_patente_in_scadenza(sette, ctx([lontano], { [K_CLIENTI]: [cliente({ scadenza_patente: '2026-10-15' })] }))).toHaveLength(1)
        expect(D.doc_x_patente_in_scadenza(sette, ctx([lontano], { [K_CLIENTI]: [cliente({ scadenza_patente: '2026-12-15' })] }))).toHaveLength(0)
        // Gia' scaduta: e' l'altra voce.
        expect(D.doc_x_patente_in_scadenza(sette, ctx([lontano], { [K_CLIENTI]: [cliente({ scadenza_patente: '2026-09-01' })] }))).toHaveLength(0)
    })
})

function fattura(over: Record<string, unknown> = {}) {
    return {
        id: 'f1', numero_fattura: 'DR7-2026-0001', booking_id: 'b1', tipo_fattura: 'standard', stato: 'paid',
        sdi_status: 'accepted', sdi_sent_at: '2026-09-20T10:00:00Z', created_at: '2026-09-20T10:00:00Z',
        related_invoice_id: null, customer_name: 'Mario Rossi', customer_tax_code: 'RSSMRA80A01B354X',
        customer_vat: '', importo_totale: 500, note: null, auto_send_error: null, ...over,
    }
}

describe('fatturazione', () => {
    it('scartata dallo SdI: suona; riemessa o stornata no; senza pratica in una riga sola', () => {
        const scart = fattura({ sdi_status: 'rejected' })
        expect(D.fatt_scartata_sdi(UN_GIORNO, ctx([], { [K_FATTURE]: [scart] }))).toHaveLength(1)
        const riemessa = fattura({ id: 'f2', created_at: '2026-09-25T10:00:00Z' })
        expect(D.fatt_scartata_sdi(UN_GIORNO, ctx([], { [K_FATTURE]: [scart, riemessa] }))).toHaveLength(0)
        const nc = fattura({ id: 'n1', tipo_fattura: 'nota_di_credito', related_invoice_id: 'f1' })
        expect(D.fatt_scartata_sdi(UN_GIORNO, ctx([], { [K_FATTURE]: [scart, nc] }))).toHaveLength(0)
        const orfane = [fattura({ id: 'w1', booking_id: null, sdi_status: 'rejected' }), fattura({ id: 'w2', booking_id: null, sdi_status: 'rejected' })]
        const hits = D.fatt_scartata_sdi(UN_GIORNO, ctx([], { [K_FATTURE]: orfane }))
        expect(hits).toHaveLength(1)
        expect(hits[0].bookingId).toBeUndefined()
        expect(hits[0].entita).toContain('2 fatture')
        // Scartata da meno della soglia: non ancora.
        expect(D.fatt_scartata_sdi(UN_GIORNO, ctx([], { [K_FATTURE]: [fattura({ sdi_status: 'rejected', sdi_sent_at: '2026-10-01T08:00:00Z' })] }))).toHaveLength(0)
    })

    it('bozza bloccata: solo con il motivo e non per le note di credito', () => {
        const bozza = fattura({ sdi_status: 'draft', auto_send_error: 'Indirizzo cliente incompleto' })
        expect(D.fatt_bozza_bloccata(UN_GIORNO, ctx([], { [K_FATTURE]: [bozza] }))[0].dettaglio).toContain('Indirizzo')
        expect(D.fatt_bozza_bloccata(UN_GIORNO, ctx([], { [K_FATTURE]: [{ ...bozza, auto_send_error: null }] }))).toHaveLength(0)
        expect(D.fatt_bozza_bloccata(UN_GIORNO, ctx([], { [K_FATTURE]: [{ ...bozza, tipo_fattura: 'nota_di_credito' }] }))).toHaveLength(0)
    })

    it('codice fiscale in fattura: segnaposto su fattura non accettata', () => {
        const f = fattura({ sdi_status: 'rejected', customer_tax_code: 'XXXXXXXXXXXXXXXX' })
        expect(D.fatt_cf_non_valido(UN_GIORNO, ctx([], { [K_FATTURE]: [f] }))).toHaveLength(1)
        expect(D.fatt_cf_non_valido(UN_GIORNO, ctx([], { [K_FATTURE]: [{ ...f, sdi_status: 'accepted' }] }))).toHaveLength(0)
        expect(D.fatt_cf_non_valido(UN_GIORNO, ctx([], { [K_FATTURE]: [{ ...f, customer_vat: '01234567890' }] }))).toHaveLength(0)
    })

    it('azienda: P.IVA o SDI/PEC mancanti sulla pratica da fatturare', () => {
        const az = { id: 'c1', tipo_cliente: 'azienda', ragione_sociale: 'ACME', partita_iva: '', codice_destinatario: '0000000', pec: '' }
        const b = noleggio({ pickup_date: new Date(ORA.getTime() + 12 * 60 * MIN).toISOString() })
        expect(D.fatt_dato_azienda(UN_GIORNO, ctx([b], { [K_CLIENTI]: [az] }), 'partita_iva')).toHaveLength(1)
        expect(D.fatt_dato_azienda(UN_GIORNO, ctx([b], { [K_CLIENTI]: [az] }), 'sdi_pec')).toHaveLength(1)
        const ok = { ...az, partita_iva: '01234567890', codice_destinatario: 'M5UXCR1' }
        expect(D.fatt_dato_azienda(UN_GIORNO, ctx([b], { [K_CLIENTI]: [ok] }), 'partita_iva')).toHaveLength(0)
        expect(D.fatt_dato_azienda(UN_GIORNO, ctx([b], { [K_CLIENTI]: [ok] }), 'sdi_pec')).toHaveLength(0)
        expect(D.fatt_dato_azienda(UN_GIORNO, ctx([b], { [K_CLIENTI]: [cliente()] }), 'sdi_pec')).toHaveLength(0)
        // Gia' partita e gia' fatturata: non serve piu'.
        const partita = noleggio({ pickup_date: new Date(ORA.getTime() - 2 * GIORNO).toISOString() })
        expect(D.fatt_dato_azienda(UN_GIORNO, ctx([partita], { [K_CLIENTI]: [az], [K_FATTURE]: [fattura()] }), 'sdi_pec')).toHaveLength(0)
        expect(D.fatt_dato_azienda(UN_GIORNO, ctx([partita], { [K_CLIENTI]: [az] }), 'sdi_pec')).toHaveLength(1)
    })

    it('fattura senza pagamento: viva -> emessa senza incasso, annullata -> nota di credito', () => {
        const nonPagata = { id: 'b1', status: 'confirmed', payment_status: 'unpaid', amount_paid: 0, booking_details: {} }
        const annullata = { ...nonPagata, status: 'cancelled' }
        const f = fattura()
        expect(D.fatt_senza_pagamento(UN_GIORNO, ctx([], { [K_FATTURE]: [f], [K_PRENOTAZIONI_FATTURE]: [nonPagata] }), 'attiva')).toHaveLength(1)
        expect(D.fatt_senza_pagamento(UN_GIORNO, ctx([], { [K_FATTURE]: [f], [K_PRENOTAZIONI_FATTURE]: [nonPagata] }), 'annullata')).toHaveLength(0)
        expect(D.fatt_senza_pagamento(UN_GIORNO, ctx([], { [K_FATTURE]: [f], [K_PRENOTAZIONI_FATTURE]: [annullata] }), 'annullata')).toHaveLength(1)
        const nc = fattura({ id: 'n1', tipo_fattura: 'nota_di_credito', related_invoice_id: 'f1' })
        expect(D.fatt_senza_pagamento(UN_GIORNO, ctx([], { [K_FATTURE]: [f, nc], [K_PRENOTAZIONI_FATTURE]: [annullata] }), 'annullata')).toHaveLength(0)
        // Penale: conta il pagamento della penale, non quello del noleggio.
        const pen = fattura({ tipo_fattura: 'penale' })
        const conPenalePagata = { ...annullata, booking_details: { penalties: [{ paymentStatus: 'paid', amountPaid: 100 }] } }
        expect(D.fatt_senza_pagamento(UN_GIORNO, ctx([], { [K_FATTURE]: [pen], [K_PRENOTAZIONI_FATTURE]: [conPenalePagata] }), 'annullata')).toHaveLength(0)
        // Scartata: fiscalmente non esiste, non serve la nota di credito.
        expect(D.fatt_senza_pagamento(UN_GIORNO, ctx([], { [K_FATTURE]: [{ ...f, sdi_status: 'rejected' }], [K_PRENOTAZIONI_FATTURE]: [annullata] }), 'annullata')).toHaveLength(0)
    })

    const metodi = [{ id: 'main', pm: [{ key: 'contanti', label: 'Contanti', auto_invoice: true }, { key: 'carta_punti', label: 'Carta Punti', auto_invoice: false }] }]
    const pagata = (over: Partial<BookingLite> = {}) => noleggio({
        pickup_date: new Date(ORA.getTime() - 5 * GIORNO).toISOString(),
        dropoff_date: new Date(ORA.getTime() - 3 * GIORNO).toISOString(),
        payment_completed_at: new Date(ORA.getTime() - 5 * GIORNO).toISOString(),
        ...over,
    })

    it('pagata senza fattura: suona; wallet, metodo senza fattura o fattura presente no', () => {
        expect(D.fatt_senza_fattura(UN_GIORNO, ctx([pagata()], { [K_METODI]: metodi }))).toHaveLength(1)
        expect(D.fatt_senza_fattura(UN_GIORNO, ctx([pagata({ payment_method: 'Credit Wallet' })], { [K_METODI]: metodi }))).toHaveLength(0)
        expect(D.fatt_senza_fattura(UN_GIORNO, ctx([pagata({ payment_method: 'Carta Punti' })], { [K_METODI]: metodi }))).toHaveLength(0)
        expect(D.fatt_senza_fattura(UN_GIORNO, ctx([pagata()], { [K_METODI]: metodi, [K_FATTURE]: [fattura()] }))).toHaveLength(0)
        expect(D.fatt_senza_fattura(UN_GIORNO, ctx([pagata({ payment_status: 'pending' })], { [K_METODI]: metodi }))).toHaveLength(0)
        // La fattura stornata da nota di credito non conta.
        const nc = fattura({ id: 'n1', tipo_fattura: 'nota_di_credito', related_invoice_id: 'f1' })
        expect(D.fatt_senza_fattura(UN_GIORNO, ctx([pagata()], { [K_METODI]: metodi, [K_FATTURE]: [fattura(), nc] }))).toHaveLength(1)
    })

    it('prolungamenti e penali pagati senza la loro fattura', () => {
        const b = pagata({
            booking_details: {
                extension_history: [{ payment_status: 'paid', additional_amount: 200, paid_at: '2026-09-20T10:00:00Z', payment_method: 'Contanti' }],
                penalties: [{ paymentStatus: 'paid', amountPaid: 100, paidAt: '2026-09-20T10:00:00Z' }],
            },
        })
        const hits = D.fatt_extra_senza_fattura(UN_GIORNO, ctx([b], { [K_METODI]: metodi, [K_FATTURE]: [fattura()] }))
        expect(hits[0].dettaglio).toContain('prolungamento')
        expect(hits[0].dettaglio).toContain('penali')
        const coperte = [fattura(), fattura({ id: 'f2', tipo_fattura: 'estensione' }), fattura({ id: 'f3', tipo_fattura: 'penale' })]
        expect(D.fatt_extra_senza_fattura(UN_GIORNO, ctx([b], { [K_METODI]: metodi, [K_FATTURE]: coperte }))).toHaveLength(0)
        const wallet = pagata({ booking_details: { extension_history: [{ payment_status: 'paid', additional_amount: 200, paid_at: '2026-09-20T10:00:00Z', payment_method: 'Credit Wallet' }] } })
        expect(D.fatt_extra_senza_fattura(UN_GIORNO, ctx([wallet], { [K_METODI]: metodi }))).toHaveLength(0)
    })

    it('incassi Nexi senza pratica: una riga riassuntiva; cauzioni e ricariche escluse', () => {
        const incassi = [
            { status: 'completed', booking_id: null, created_at: '2026-09-16T10:00:00Z', amount_cents: 239000, description: 'NOLEGGIO FERRARI' },
            { status: 'completed', booking_id: null, created_at: '2026-09-17T10:00:00Z', amount_cents: 38000, description: 'Ricarica Wallet' },
            { status: 'completed', booking_id: null, created_at: '2026-09-17T10:00:00Z', amount_cents: 200000, description: 'Cauzione Audi', cauzione_id: 'x' },
            { status: 'completed', booking_id: null, created_at: '2026-10-01T09:00:00Z', amount_cents: 1000, description: 'Pagamento di oggi' },
        ]
        const hits = D.fatt_incasso_senza_pratica(UN_GIORNO, ctx([], { [K_INCASSI]: incassi }))
        expect(hits).toHaveLength(1)
        expect(hits[0].entita).toContain('1 incasso Nexi')
        expect(hits[0].dettaglio).toContain('FERRARI')
        expect(D.fatt_incasso_senza_pratica(UN_GIORNO, ctx([], { [K_INCASSI]: [] }))).toEqual([])
    })

    it('documento senza pratica: le ricariche wallet non contano', () => {
        const orfana = fattura({ booking_id: null })
        const ricarica = fattura({ id: 'f2', booking_id: null, note: 'wallet_purchase:abc' })
        expect(D.fatt_documento_senza_pratica(UN_GIORNO, ctx([], { [K_FATTURE]: [orfana, ricarica] }))[0].entita).toContain('1 fattura')
        expect(D.fatt_documento_senza_pratica(UN_GIORNO, ctx([], { [K_FATTURE]: [ricarica] }))).toEqual([])
    })
})

describe('pratiche interne', () => {
    it('uscite straordinarie non chiedono fattura', () => {
        const metodi = [{ id: 'main', pm: [{ key: 'contanti', label: 'Contanti', auto_invoice: true }] }]
        const uscita = {
            id: 'u1', service_type: 'uscita_straordinaria', status: 'pending', payment_status: 'paid', payment_method: 'contanti',
            price_total: 2000, customer_name: 'Uscita: transfer cliente', payment_completed_at: '2026-09-11T10:00:00Z', booking_details: {},
        }
        expect(D.fatt_senza_fattura(UN_GIORNO, ctx([uscita], { [K_METODI]: metodi }))).toEqual([])
        expect(D.fatt_senza_fattura(UN_GIORNO, ctx([{ ...uscita, service_type: null }], { [K_METODI]: metodi }))).toHaveLength(1)
    })
})
