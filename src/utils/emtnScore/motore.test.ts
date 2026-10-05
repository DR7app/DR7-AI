import { describe, expect, it } from 'vitest'
import { calcolaEMTNScore } from './motore'
import { classificaVoce, minutiDaTesto, type EventoNormalizzato, type NoleggioNormalizzato } from './normalizza'

// 05/10/2026: casi tratti dal documento della direzione "MTN — Regole di
// punteggio clienti". Ogni test cita la regola che verifica.

const OGGI = new Date('2026-10-01T12:00:00Z')

function giorniFa(g: number): string {
    return new Date(OGGI.getTime() - g * 86_400_000).toISOString().slice(0, 10)
}
/** n noleggi conclusi e pagati, il piu' vecchio per primo, uno ogni `ogni` giorni. */
function noleggi(n: number, ogni = 10, extra: Partial<NoleggioNormalizzato> = {}): NoleggioNormalizzato[] {
    return Array.from({ length: n }, (_, i) => ({
        id: `n${i}`, contratto: `DR7${1000 + i}`, inizio: giorniFa(400 - i * ogni + 1), data: giorniFa(400 - i * ogni),
        concluso: true, saldato: true, conExtra: false, ...extra,
    }))
}
function evento(p: Partial<EventoNormalizzato>): EventoNormalizzato {
    return {
        id: Math.random().toString(36).slice(2), fonte: 'dr7_prenotazione', categoria: 'danno', label: 'Danno',
        data: giorniFa(200), bookingId: null, contratto: null, importo: 0, pagato: 0, residuo: 0, statoPagamento: 'pagato',
        scadenza: null, dataSaldo: null, minutiRitardo: null, verificato: true, inRevisione: false,
        dichiaratoDalCliente: null, responsabilita: null, contestazione: null, prove: ['test'], ...p,
    }
}
const score = (eventi: EventoNormalizzato[], nol: NoleggioNormalizzato[]) =>
    calcolaEMTNScore({ eventi, noleggi: nol, identificato: true, oggi: OGGI })

describe('punteggio di base', () => {
    it('cliente nuovo: 50/100 con storico insufficiente, giallo', () => {
        const r = score([], [])
        expect(r.score).toBe(50)
        expect(r.profiloInCostruzione).toBe(true)
        expect(r.band).toBe('yellow')
    })

    it('ogni noleggio perfetto +10, massimo 100 (cliente come Massimo Runchina)', () => {
        expect(score([], noleggi(1)).score).toBe(60)
        expect(score([], noleggi(3)).score).toBe(80)
        const r = score([], noleggi(25))
        expect(r.score).toBe(100)
        expect(r.livello).toBe('Very Low')
        expect(r.band).toBe('green')
        expect(r.movimenti.filter(m => m.tipo === 'bonus')).toHaveLength(25)
    })

    it('extra pagati: mai oltre +10 per noleggio', () => {
        expect(score([], noleggi(1, 10, { conExtra: true })).score).toBe(60)
    })

    it('il +10 solo a noleggio concluso e completamente pagato', () => {
        expect(score([], noleggi(1, 10, { concluso: false })).score).toBe(50)
        expect(score([], noleggi(1, 10, { saldato: false })).score).toBe(50)
    })

    it('km extra pagati e proroga: noleggio perfetto, +10 e non +20', () => {
        const nol = noleggi(1)
        const r = score([
            evento({ categoria: 'km_extra', label: 'Sforo 69 km', importo: 120, bookingId: 'n0' }),
            evento({ categoria: 'proroga', label: 'Proroga', bookingId: 'n0' }),
        ], nol)
        expect(r.score).toBe(60)
    })
})

describe('detrazioni', () => {
    it('noleggio con eventi negativi: detrazioni e nessun bonus', () => {
        const r = score([evento({ categoria: 'carburante', label: 'Carburante mancante', importo: 40, bookingId: 'n0' })], noleggi(1))
        expect(r.score).toBe(49)
        expect(r.movimenti.some(m => m.tipo === 'bonus')).toBe(false)
    })

    it('fumo e pulizia dovuta al medesimo fumo: solo -10', () => {
        const r = score([
            evento({ categoria: 'fumo', label: "Fumo nell'auto", importo: 150, bookingId: 'n0' }),
            evento({ categoria: 'pulizia', label: 'Igienizzazione straordinaria', importo: 80, bookingId: 'n0' }),
        ], noleggi(1))
        expect(r.score).toBe(40)
    })

    it('danno e relativa fattura: una sola detrazione, sul totale dell\'incidente', () => {
        const r = score([
            evento({ categoria: 'danno', label: 'Paraurti', importo: 400, bookingId: 'n0', fonte: 'dr7_prenotazione' }),
            evento({ categoria: 'danno', label: 'Faro', importo: 300, bookingId: 'n0', fonte: 'dr7_prenotazione' }),
            evento({ categoria: 'danno', label: 'Danno prenotazione', importo: 700, bookingId: 'n0', fonte: 'dr7_fattura' }),
        ], noleggi(1))
        // 700 EUR -> scaglione 300-1.000 = -10
        expect(r.score).toBe(40)
        expect(r.movimenti.filter(m => m.tipo === 'detrazione')).toHaveLength(1)
    })

    it('scaglioni del danno', () => {
        const d = (importo: number) => score([evento({ categoria: 'danno', importo, bookingId: 'n0' })], noleggi(1)).score
        expect(d(300)).toBe(45)
        expect(d(1000)).toBe(40)
        expect(d(3000)).toBe(30)
        expect(d(10000)).toBe(15)
        expect(d(13000)).toBe(0)
    })

    it('fermo tecnico: stesso incidente, fuori dal costo del danno', () => {
        const r = score([
            evento({ categoria: 'danno', label: 'Danno carrozzeria', importo: 8129.3, bookingId: 'n0' }),
            evento({ categoria: 'danno', label: 'Fermo tecnico 7gg', importo: 4870.7, bookingId: 'n0', fermo: true }),
        ], noleggi(1))
        expect(r.score).toBe(15) // -35, non -50
    })

    it('incidente con responsabilita\' di terzi: -5; con responsabilita\' del cliente solo il danno', () => {
        expect(score([evento({ categoria: 'incidente_terzi', bookingId: 'n0' })], noleggi(1)).score).toBe(45)
        expect(score([
            evento({ categoria: 'incidente_terzi', bookingId: 'n0' }),
            evento({ categoria: 'danno', importo: 200, bookingId: 'n0' }),
        ], noleggi(1)).score).toBe(45)
    })

    it('danno non attribuibile al cliente: 0 e il noleggio resta perfetto', () => {
        const r = score([evento({ categoria: 'danno', importo: 900, bookingId: 'n0', responsabilita: 'non_attribuibile' })], noleggi(1))
        expect(r.score).toBe(60)
    })

    it('occultamento di un danno accertato: -10 aggiuntivi', () => {
        const r = score([evento({ categoria: 'danno', importo: 200, bookingId: 'n0', dichiaratoDalCliente: false })], noleggi(1))
        expect(r.score).toBe(35)
    })

    it('multe: -2 per verbale', () => {
        const r = score([
            evento({ id: 'v1', fonte: 'multa', categoria: 'multa', bookingId: 'n0', statoPagamento: 'non_applicabile' }),
            evento({ id: 'v2', fonte: 'multa', categoria: 'multa', bookingId: 'n0', statoPagamento: 'non_applicabile' }),
        ], noleggi(1))
        expect(r.score).toBe(46)
    })

    it('ritardo alla riconsegna a scaglioni; oltre 24 ore verifica immediata', () => {
        const rit = (minutiRitardo: number) => score([evento({ categoria: 'ritardo_riconsegna', minutiRitardo, bookingId: 'n0', statoPagamento: 'non_applicabile' })], noleggi(1))
        expect(rit(30).score).toBe(60) // fino a 30 minuti: 0, noleggio perfetto
        expect(rit(31).score).toBe(49)
        expect(rit(305).score).toBe(48)
        expect(rit(600).score).toBe(40)
        const oltre = rit(1500)
        expect(oltre.score).toBe(20)
        expect(oltre.flag.some(f => f.codice === 'verifica_immediata')).toBe(true)
    })

    it('ritardo autorizzato: 0', () => {
        const r = score([
            evento({ categoria: 'ritardo_riconsegna', minutiRitardo: 300, bookingId: 'n0' }),
            evento({ categoria: 'ritardo_autorizzato', bookingId: 'n0' }),
        ], noleggi(1))
        expect(r.score).toBe(60)
    })

    it('violazioni gravi', () => {
        expect(score([evento({ categoria: 'guidatore_non_autorizzato', bookingId: 'n0' })], noleggi(1)).score).toBe(25)
        expect(score([evento({ categoria: 'subnoleggio', bookingId: 'n0' })], noleggi(1)).score).toBe(10)
        const m = score([evento({ categoria: 'manomissione', bookingId: 'n0' })], noleggi(1))
        expect(m.score).toBe(0)
        expect(m.flag.some(f => f.codice === 'revisione_sicurezza')).toBe(true)
    })

    it('minimo 0', () => {
        expect(score([evento({ categoria: 'danno', importo: 50000, bookingId: 'n0' }), evento({ categoria: 'subnoleggio', bookingId: 'n0' })], noleggi(1)).score).toBe(0)
    })
})

describe('recupero', () => {
    it('dopo danni pagati ogni noleggio perfetto successivo da\' +10', () => {
        const nol = noleggi(4)
        const r = score([evento({ categoria: 'danno', importo: 200, bookingId: 'n0' })], nol)
        // 50 - 5 + 10 + 10 + 10
        expect(r.score).toBe(75)
    })

    it('problema emerso dopo la chiusura: il bonus gia\' dato sparisce', () => {
        const nol = noleggi(1)
        expect(score([], nol).score).toBe(60)
        expect(score([evento({ categoria: 'pulizia', bookingId: 'n0', data: giorniFa(10) })], nol).score).toBe(48)
    })
})

describe('debiti', () => {
    it('importo scaduto e non pagato: 0/100 e blocco; nessun aumento con nuovi noleggi', () => {
        const nol = noleggi(5)
        const r = score([evento({
            categoria: 'danno', importo: 500, residuo: 500, pagato: 0, statoPagamento: 'aperto',
            bookingId: 'n0', data: nol[0].data, scadenza: giorniFa(380),
        })], nol)
        expect(r.score).toBe(0)
        expect(r.blocco).toBe('insoluto')
        expect(r.livello).toBe('Critical')
    })

    it('importo non ancora scaduto: nessun blocco', () => {
        const r = score([evento({
            categoria: 'danno', importo: 500, residuo: 500, statoPagamento: 'aperto', bookingId: 'n0',
            data: giorniFa(5), scadenza: '2026-10-20',
        })], noleggi(1))
        expect(r.blocco).toBe(null)
        expect(r.score).toBe(40)
    })

    it('saldo integrale di un insoluto: storico - penalita\' - 10, massimo 40', () => {
        const nol = noleggi(6)
        // 5 noleggi perfetti prima (100), danno da 200 sul sesto -> 95, saldato 30 gg dopo la scadenza
        const ev = evento({
            categoria: 'danno', importo: 200, residuo: 0, pagato: 200, statoPagamento: 'pagato', bookingId: 'n5',
            data: nol[5].data, scadenza: giorniFa(340), dataSaldo: giorniFa(310),
        })
        const r = score([ev], nol)
        expect(r.score).toBe(40)
        expect(r.movimenti.some(m => m.tipo === 'rientro')).toBe(true)
    })

    it('pagamento tardivo saldato entro 7 giorni: -1 / -2, nessun tetto', () => {
        const nol = noleggi(1)
        const tardi = (g: number) => score([evento({
            categoria: 'carburante', importo: 40, statoPagamento: 'pagato', bookingId: 'n0',
            data: nol[0].data, scadenza: giorniFa(399), dataSaldo: giorniFa(399 - g),
        })], nol).score
        expect(tardi(2)).toBe(48)
        expect(tardi(5)).toBe(47)
    })

    it('debito aperto senza scadenza documentata: niente blocco, revisione, nessun aumento', () => {
        const nol = noleggi(3)
        const r = score([evento({ categoria: 'carburante', importo: 100, residuo: 100, statoPagamento: 'aperto', bookingId: 'n0', data: nol[0].data })], nol)
        expect(r.blocco).toBe(null)
        expect(r.score).toBe(49)
        expect(r.revisioni.length).toBe(1)
        expect(r.livello).not.toBe('Very Low')
    })

    it('addebito contestato: revisione umana, nessun azzeramento', () => {
        const r = score([evento({ categoria: 'danno', importo: 2000, residuo: 2000, statoPagamento: 'aperto', bookingId: 'n0', contestazione: 'aperta', scadenza: giorniFa(300) })], noleggi(1))
        expect(r.blocco).toBe(null)
        expect(r.score).toBe(50)
        expect(r.revisioneManuale).toBe(true)
    })
})

describe('sicurezza e revisione', () => {
    it('furto accertato: 0 e nessuna risalita', () => {
        const r = score([evento({ categoria: 'furto', accertato: true, bookingId: 'n0', fonte: 'emtn_evento' })], noleggi(8))
        expect(r.score).toBe(0)
        expect(r.blocco).toBe('sicurezza')
    })

    it('furto non accertato: revisione umana, nessun blocco', () => {
        const r = score([evento({ categoria: 'furto', accertato: false, bookingId: 'n0' })], noleggi(1))
        expect(r.blocco).toBe(null)
        expect(r.revisioni.length).toBe(1)
    })

    it('evento non previsto: revisione umana, nessun punto, bonus sospeso', () => {
        const r = score([evento({ categoria: 'non_previsto', label: 'Ripresa', bookingId: 'n0' })], noleggi(1))
        expect(r.score).toBe(50)
        expect(r.revisioni).toHaveLength(1)
    })

    it('segnalazione in revisione: non pesa', () => {
        const r = score([evento({ categoria: 'subnoleggio', inRevisione: true, verificato: false, bookingId: 'n0' })], noleggi(1))
        expect(r.score).toBe(60)
    })

    it('ogni movimento porta contratto, motivo, prove e stato del pagamento', () => {
        const r = score([evento({ categoria: 'fumo', bookingId: 'n0', importo: 150, prove: ['Gestionale DR7: penale "Fumo"'] })], noleggi(1))
        const m = r.movimenti.find(x => x.tipo === 'detrazione')!
        expect(m.contratto).toBe('DR71000')
        expect(m.motivo).toMatch(/Fumo/)
        expect(m.prove).toContain('Gestionale DR7: penale "Fumo"')
        expect(m.statoPagamento).toBe('pagato')
    })
})

describe('classificazione delle voci DR7', () => {
    it('nomi reali del gestionale', () => {
        expect(classificaVoce('Penale - Sforo Km', 'penale').categoria).toBe('km_extra')
        expect(classificaVoce('Carburante mancante (4 tacche)', 'penale').categoria).toBe('carburante')
        expect(classificaVoce("Fumo nell'auto", 'penale').categoria).toBe('fumo')
        expect(classificaVoce('Foro da sigaretta', 'penale').categoria).toBe('fumo')
        expect(classificaVoce('Cani / pelo di cane', 'penale').categoria).toBe('animali')
        expect(classificaVoce('Igenizzazione straordinaria', 'penale').categoria).toBe('pulizia')
        expect(classificaVoce('Uscita perimetro Sassari', 'penale').categoria).toBe('fuori_area')
        expect(classificaVoce('Ritardo check-out (> 30 min)', 'penale').categoria).toBe('ritardo_riconsegna')
        expect(classificaVoce('Pattana ant sx', 'danno').categoria).toBe('danno')
        expect(classificaVoce('Ripresa', 'penale').categoria).toBe('non_previsto')
        expect(classificaVoce('Fermo tecnico 2gg', 'penale')).toEqual({ categoria: 'danno', fermo: true })
        expect(classificaVoce('Danno strutturale paraurti + 3gg fermo tecnico', 'danno')).toEqual({ categoria: 'danno', fermo: false })
        // Furto scritto da un operatore: danno, mai blocco di sicurezza.
        expect(classificaVoce('Furto cerchi', 'danno').categoria).toBe('danno')
    })

    it('minuti di ritardo dal nome', () => {
        expect(minutiDaTesto('Ritardo 5 ore e 5 minuti')).toBe(305)
        expect(minutiDaTesto('Ritardo check-out (> 30 min)')).toBe(31)
        expect(minutiDaTesto('Ritardo check-out (per min)', 45)).toBe(45)
        expect(minutiDaTesto('Ritardo check-out (per min)', 1)).toBe(null)
    })
})
