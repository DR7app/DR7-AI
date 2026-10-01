import { describe, expect, it } from 'vitest'
import { calcolaEMTNScore } from './motore'
import { classificaVoce, type EventoNormalizzato, type NoleggioNormalizzato } from './normalizza'

const OGGI = new Date('2026-10-01T12:00:00Z')

function mesiFa(m: number): string {
    return new Date(OGGI.getTime() - m * 30.44 * 86_400_000).toISOString().slice(0, 10)
}
function noleggi(n: number, ogniMesi = 1, regolare = true): NoleggioNormalizzato[] {
    return Array.from({ length: n }, (_, i) => ({ id: `n${i}`, data: mesiFa(1 + i * ogniMesi), concluso: true, regolare, prezzoGiorno: 120 }))
}
function evento(p: Partial<EventoNormalizzato>): EventoNormalizzato {
    return {
        id: Math.random().toString(36).slice(2), fonte: 'dr7_prenotazione', famiglia: 'danno', label: 'Danno',
        data: mesiFa(8), importo: 0, pagato: 0, residuo: 0, statoPagamento: 'pagato', giorniAlSaldo: null,
        verificato: true, inRevisione: false, dichiaratoDalCliente: null, responsabilita: null,
        gravitaIndicata: null, contestazione: null, prezzoGiornoVeicolo: null, bookingId: null, ...p,
    }
}
const score = (eventi: EventoNormalizzato[], nol: NoleggioNormalizzato[]) =>
    calcolaEMTNScore({ eventi, noleggi: nol, identificato: true, oggi: OGGI })

describe('EMTN Score', () => {
    it('cliente nuovo: non 100, profilo in costruzione, confidence bassa', () => {
        const r = score([], [])
        expect(r.score).toBe(70)
        expect(r.profiloInCostruzione).toBe(true)
        expect(r.confidence).toBeLessThan(30)
    })

    it('1 noleggio pulito vs 50 noleggi puliti: stesso giudizio, confidence molto diversa', () => {
        const uno = score([], noleggi(1))
        const cinquanta = score([], noleggi(50, 0.5))
        expect(uno.confidence).toBeLessThan(35)
        expect(cinquanta.confidence).toBeGreaterThan(90)
        expect(cinquanta.score).toBeGreaterThan(90)
        expect(uno.score).toBeLessThan(cinquanta.score)
    })

    it('un danno pagato abbassa lo score: mai piu\' 100', () => {
        const r = score([evento({ importo: 200, pagato: 200 })], noleggi(17))
        expect(r.score).toBeLessThan(90)
        expect(r.score).toBeGreaterThan(70)
        expect(r.band).not.toBe('red')
    })

    it('200 EUR e 13.000 EUR pagati non pesano uguale', () => {
        const piccolo = score([evento({ importo: 200, pagato: 200 })], noleggi(20))
        const grande = score([evento({ importo: 13_000, pagato: 13_000 })], noleggi(20))
        expect(grande.score).toBeLessThan(piccolo.score - 5)
    })

    it('danno non pagato pesa molto piu\' di uno pagato', () => {
        const pagato = score([evento({ importo: 1000, pagato: 1000 })], noleggi(5))
        const aperto = score([evento({ importo: 1000, residuo: 1000, statoPagamento: 'aperto' })], noleggi(5))
        expect(aperto.score).toBeLessThan(pagato.score - 20)
        expect(aperto.band).toBe('red')
    })

    it('dichiarato subito vs nascosto', () => {
        const dichiarato = score([evento({ importo: 800, pagato: 800, dichiaratoDalCliente: true, giorniAlSaldo: 2 })], noleggi(10))
        const nascosto = score([evento({ importo: 800, pagato: 800, dichiaratoDalCliente: false, giorniAlSaldo: 60 })], noleggi(10))
        expect(dichiarato.score).toBeGreaterThan(nascosto.score)
    })

    it('recidiva non lineare: 3 penali carburante pesano piu\' di 3 volte la prima', () => {
        const pen = (m: number) => evento({ famiglia: 'carburante', label: 'Penale carburante', importo: 50, pagato: 50, data: mesiFa(m) })
        const una = score([pen(3)], noleggi(10))
        const tre = score([pen(3), pen(5), pen(7)], noleggi(10))
        expect(tre.dettaglio.rischioTotale).toBeGreaterThan(una.dettaglio.rischioTotale * 3)
        expect(tre.score).toBeLessThan(una.score)
        expect(tre.rischi.some(r => r.includes('recidiva'))).toBe(true)
    })

    it('evento lieve non distrugge anni di storico corretto', () => {
        const r = score([evento({ famiglia: 'carburante', label: 'Penale carburante', importo: 50, pagato: 50, data: mesiFa(20) })], noleggi(40, 0.8))
        expect(r.score).toBeGreaterThanOrEqual(88)
        expect(r.livello === 'Very Low' || r.livello === 'Low').toBe(true)
    })

    it('recovery: noleggi regolari dopo un evento fanno risalire lo score', () => {
        const ev = evento({ importo: 600, pagato: 600, data: mesiFa(14) })
        const subito = calcolaEMTNScore({ eventi: [ev], noleggi: noleggi(3, 1).map(n => ({ ...n, data: mesiFa(15 + Number(n.id.slice(1))) })), identificato: true, oggi: OGGI })
        const dopo = calcolaEMTNScore({ eventi: [ev], noleggi: [...noleggi(12, 1), ...noleggi(3, 1).map(n => ({ ...n, id: 'v' + n.id, data: mesiFa(15 + Number(n.id.slice(1))) }))], identificato: true, oggi: OGGI })
        expect(dopo.score).toBeGreaterThan(subito.score)
    })

    it('segnalazione in revisione non pesa sullo score', () => {
        const r = score([evento({ importo: 5000, residuo: 5000, statoPagamento: 'aperto', inRevisione: true, verificato: false })], noleggi(10))
        const pulito = score([], noleggi(10))
        expect(r.score).toBe(pulito.score)
        expect(r.dettaglio.eventiInRevisione).toBe(1)
    })

    it('flag critico: mancata restituzione limita a 10 anche con storico lungo', () => {
        const r = score([evento({ famiglia: 'mancata_restituzione', fonte: 'emtn_pratica', label: 'Mancata restituzione', statoPagamento: 'non_applicabile' })], noleggi(40))
        expect(r.score).toBeLessThanOrEqual(10)
        expect(r.livello).toBe('Critical')
        expect(r.revisioneManuale).toBe(true)
    })

    it('furto accertato = 0; furto non accertato non fa scattare il flag', () => {
        const accertato = score([evento({ famiglia: 'furto', accertato: true, label: 'Furto', statoPagamento: 'non_applicabile' })], noleggi(10))
        expect(accertato.score).toBe(0)
        const accusa = score([evento({ famiglia: 'furto', label: 'Furto', statoPagamento: 'non_applicabile', inRevisione: true, verificato: false })], noleggi(10))
        expect(accusa.flag).toHaveLength(0)
    })

    it('override della direzione tracciato', () => {
        const r = calcolaEMTNScore({ eventi: [], noleggi: noleggi(20), identificato: true, oggi: OGGI, override: { tipo: 'limite_massimo', valore: 50, motivo: 'verifica in corso', operatore: 'x', creato_il: OGGI.toISOString() } })
        expect(r.score).toBe(50)
        expect(r.scoreCalcolato).toBeGreaterThan(50)
        expect(r.spiegazione).toContain('verifica in corso')
    })

    it('deterministico', () => {
        const ev = [evento({ id: 'a', importo: 300, pagato: 300 })]
        expect(score(ev, noleggi(8))).toEqual(score(ev, noleggi(8)))
    })

    it('trend: deteriora con un evento recente', () => {
        const r = score([evento({ importo: 1500, residuo: 1500, statoPagamento: 'aperto', data: mesiFa(1) })], noleggi(15, 1))
        expect(r.trend).toBe('Deteriorating')
    })

    it('un incidente = un evento: danno + fermo + pratica EMTN sulla stessa prenotazione', () => {
        const bk = { bookingId: 'b1', data: mesiFa(1) }
        const voci = [
            evento({ ...bk, id: 'd', label: 'danni vari carrozzeria', importo: 8129.3, pagato: 8129.3 }),
            evento({ ...bk, id: 'f', label: 'Fermo veicolo incidente/danni', importo: 4870.7, pagato: 4870.7 }),
            evento({ ...bk, id: 'p', fonte: 'emtn_pratica', label: 'DANNO - ACCORDO TRANSATTIVO', importo: 13000, pagato: 13000 }),
        ]
        const r = score(voci, noleggi(3))
        const solo = score([evento({ ...bk, importo: 13000, pagato: 13000 })], noleggi(3))
        expect(r.dettaglio.eventiConsiderati).toBe(1)
        expect(r.rischi.join(' ')).not.toContain('recidiva')
        expect(r.score).toBe(solo.score)
    })

    it('classifica le voci DR7', () => {
        expect(classificaVoce('Fermo veicolo incidente/danni', 'penale')).toBe('danno')
        expect(classificaVoce('Penale - Carburante mancante', 'penale')).toBe('carburante')
        expect(classificaVoce('Penale per guidatore non citato nel contratto', 'penale')).toBe('guida_non_autorizzata')
        expect(classificaVoce('Danno prenotazione 88CDFF9D - distrutta macchina', 'danno')).toBe('danno')
        expect(classificaVoce('Igienizzazione', 'penale')).toBe('pulizia')
        expect(classificaVoce('Penale fumo', 'penale')).toBe('fumo')
        expect(classificaVoce('Voce generica', 'penale')).toBe('penale')
    })
})
