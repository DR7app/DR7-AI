import { describe, it, expect } from 'vitest'
import {
    CATEGORIE_EMTN, AREE_EMTN, normalizzaRisultato, residuoEvento, calcolaRitardo, giudiziVietati, terminiPenali,
    documentiMinimiMancanti, motiviRevisioneManuale,
} from './emtnMobilityRisk'

describe('catalogo', () => {
    it('66 categorie numerate 1..66, ciascuna in una delle 8 aree', () => {
        expect(CATEGORIE_EMTN.map(x => x.codice)).toEqual(Array.from({ length: 66 }, (_, i) => i + 1))
        expect(CATEGORIE_EMTN.every(x => AREE_EMTN[x.area])).toBe(true)
    })
})

describe('regola dell\'accordo transattivo', () => {
    it('2.000 richiesti, 1.500 concordati e pagati = residuo 0, non 500', () => {
        expect(residuoEvento({ importo_richiesto: 2000, importo_dovuto: 1500, importo_pagato: 1500 })).toBe(0)
    })
    it('senza accordo il residuo e\' richiesto meno pagato', () => {
        expect(residuoEvento({ importo_richiesto: 750, importo_pagato: 500 })).toBe(250)
    })
    it('senza pagamento resta il residuo dichiarato', () => {
        expect(residuoEvento({ importo_richiesto: 400, importo_residuo: 400 })).toBe(400)
    })
})

describe('ritardo', () => {
    it('esempio della specifica: 12/09 10:00 -> 13/09 16:30 = 30 ore e 30 minuti', () => {
        const r = calcolaRitardo('2026-09-12T10:00:00+02:00', '2026-09-13T16:30:00+02:00')
        expect(r?.minuti).toBe(30 * 60 + 30)
        expect(r?.testo).toBe('1 giorno, 6 ore, 30 minuti')
    })
    it('nessun ritardo se riconsegnato prima o se manca un dato', () => {
        expect(calcolaRitardo('2026-09-12T10:00', '2026-09-12T09:00')).toBeNull()
        expect(calcolaRitardo(null, '2026-09-12T09:00')).toBeNull()
    })
})

describe('linguaggio', () => {
    it('blocca i giudizi sulla persona', () => {
        expect(giudiziVietati('Cliente problematico, da evitare').length).toBeGreaterThan(0)
        expect(giudiziVietati('Dal documento risulta un residuo di €250.')).toEqual([])
    })
    it('riconosce le qualificazioni penali', () => {
        expect(terminiPenali('Il cliente e\' stato denunciato per furto').length).toBeGreaterThan(0)
        expect(terminiPenali('Riconsegna con 26 ore di ritardo')).toEqual([])
    })
})

describe('normalizzaRisultato', () => {
    const base = {
        titolo: 'RITARDO NELLA RICONSEGNA – PAGAMENTO PARZIALE',
        report: 'Dal documento caricato risulta riconsegna prevista il 12/09/2026.',
        stato_posizione: 'CONTESTATO',
        informazioni_legali: [],
    }
    it('scarta categorie inesistenti, pulisce i "non risulta", corregge il residuo', () => {
        const { risultato, errori, avvisi } = normalizzaRisultato({
            ...base,
            eventi: [
                { codice: 99, stato: 'VERIFICATO', dati: {} },
                { codice: 2, stato: 'CONTESTATO', dati: { importo_richiesto: '€ 750,00', importo_pagato: 500, importo_residuo: 300, targa: 'NON RISULTA DALLA DOCUMENTAZIONE' }, fonti: ['ricevuta.pdf'] },
            ],
        })
        expect(errori).toEqual([])
        expect(risultato.eventi).toHaveLength(1)
        expect(risultato.eventi[0].dati.importo_richiesto).toBe(750)
        expect(risultato.eventi[0].dati.importo_residuo).toBe(250)
        expect(risultato.eventi[0].dati.targa).toBeNull()
        expect(avvisi.some(a => a.includes('scartato'))).toBe(true)
        expect(avvisi.some(a => a.includes('residuo corretto'))).toBe(true)
    })
    it('stato sconosciuto torna DA_VERIFICARE', () => {
        const { risultato } = normalizzaRisultato({ ...base, stato_posizione: 'CATTIVO', eventi: [{ codice: 1, stato: 'X', dati: {} }] })
        expect(risultato.stato_posizione).toBe('DA_VERIFICARE')
        expect(risultato.eventi[0].stato).toBe('DA_VERIFICARE')
    })
    it('blocca la pubblicazione con termini penali o giudizi nel report', () => {
        const penale = normalizzaRisultato({ ...base, report: 'Il cliente risulta denunciato.', eventi: [{ codice: 1, dati: {} }] })
        expect(penale.errori.some(e => e.includes('penale'))).toBe(true)
        const giudizio = normalizzaRisultato({ ...base, report: 'Cliente inaffidabile.', eventi: [{ codice: 1, dati: {} }] })
        expect(giudizio.errori.some(e => e.includes('giudizi'))).toBe(true)
    })
})

describe('documentazione minima e revisione manuale', () => {
    it('senza contratto la pratica va in revisione', () => {
        expect(documentiMinimiMancanti([34], ['foto', 'preventivo'])).toEqual(['Contratto di noleggio (rapporto contrattuale non verificabile)'])
    })
    it('danno: servono stato del veicolo e quantificazione', () => {
        const m = documentiMinimiMancanti([34], ['contratto'])
        expect(m.some(x => x.includes('stato del veicolo'))).toBe(true)
        expect(m.some(x => x.includes('quantificazione'))).toBe(true)
        expect(documentiMinimiMancanti([34], ['contratto', 'checkin', 'preventivo'])).toEqual([])
    })
    it('incongruenza economica, reati e gestionale diverso bloccano', () => {
        const { risultato } = normalizzaRisultato({
            titolo: 'INSOLUTO', report: 'Dal documento risulta un importo di €1.500.', stato_posizione: 'DA_VERIFICARE',
            eventi: [{ codice: 1, dati: { importo_richiesto: 1500 } }],
            documenti: [{ nome: 'c.pdf', tipo: 'contratto' }, { nome: 'f.pdf', tipo: 'fattura' }],
            incongruenze: ['INCONGRUENZA ECONOMICA RILEVATA – contratto €1.500, contestazione €2.000'],
            informazioni_legali: [], esito_verifica: 'INCONGRUENZA_RILEVATA',
        })
        const motivi = motiviRevisioneManuale(risultato, [{ controllo: 'Targa', esito: 'diverso', documento: 'AB123CD', gestionale: 'EF456GH' }])
        expect(motivi.some(x => x.startsWith('Incongruenza'))).toBe(true)
        expect(motivi.some(x => x.startsWith('Gestionale: Targa'))).toBe(true)
    })
    it('pratica completa e coerente: nessun motivo', () => {
        const { risultato } = normalizzaRisultato({
            titolo: 'INSOLUTO', report: 'Dal documento risulta un residuo di €300.', stato_posizione: 'VERIFICATO',
            eventi: [{ codice: 1, dati: { importo_richiesto: 300, importo_residuo: 300 } }],
            documenti: [{ nome: 'c.pdf', tipo: 'contratto' }, { nome: 'f.pdf', tipo: 'fattura' }],
            incongruenze: [], non_supportate: [], informazioni_legali: [], esito_verifica: 'DOCUMENTAZIONE_COERENTE',
        })
        expect(motiviRevisioneManuale(risultato, [{ controllo: 'Targa', esito: 'ok' }])).toEqual([])
    })
    it('posizione pagata presentata come insoluta', () => {
        const { risultato } = normalizzaRisultato({
            titolo: 'INSOLUTO', report: 'Dal documento risulta pagato.', eventi: [{ codice: 1, dati: { importo_richiesto: 300, importo_pagato: 300 } }],
            documenti: [{ nome: 'c.pdf', tipo: 'contratto' }, { nome: 'f.pdf', tipo: 'fattura' }], esito_verifica: 'DOCUMENTAZIONE_COERENTE',
        })
        expect(motiviRevisioneManuale(risultato).some(x => x.includes('integralmente pagata'))).toBe(true)
    })
})
