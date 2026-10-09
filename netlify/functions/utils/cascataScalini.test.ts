import { describe, it, expect } from 'vitest'
import { cascataScalini, normalizzaScalini } from './cascataScalini'

const EUR = (n: number) => n * 100

// Carta finta: accetta ogni addebito finche' resta disponibilita'.
function carte(disponibile: Record<string, number>) {
    const saldo = { ...disponibile }
    const log: string[] = []
    const charge = async (cid: string, cents: number) => {
        const ok = cents <= (saldo[cid] ?? 0)
        if (ok) saldo[cid] -= cents
        log.push(`${cid}:${cents / 100}:${ok ? 'si' : 'no'}`)
        return ok ? { ok } : { ok, error: 'DECLINED' }
    }
    return { charge, log, saldo }
}

const base = { minAmountCents: 50, maxAttempts: Infinity }

describe('cascataScalini', () => {
    it('esempio direzione: 100k, scalini 10k/5k/2k, carta con 9k', async () => {
        const c = carte({ A: EUR(9000) })
        const r = await cascataScalini({ ...base, cards: ['A'], amountCents: EUR(100000), stepsCents: [EUR(10000), EUR(5000), EUR(2000)], charge: c.charge })
        expect(r.collectedCents).toBe(EUR(9000))
        expect(r.remainingCents).toBe(EUR(91000))
        expect(r.attempts).toBe(15)
        expect(c.log.slice(10)).toEqual(['A:5000:si', 'A:5000:no', 'A:4000:si', 'A:4000:no', 'A:2000:no'])
    })

    it('due carte: finita la prima passa alla seconda per il resto', async () => {
        const c = carte({ A: EUR(9000), B: EUR(3000) })
        const r = await cascataScalini({ ...base, cards: ['A', 'B'], amountCents: EUR(100000), stepsCents: [EUR(10000), EUR(5000), EUR(2000)], charge: c.charge })
        // B: 91k, 81k, ... 11k no, 1k si tre volte = carta svuotata
        expect(r.collectedCents).toBe(EUR(12000))
        expect(r.usedCards).toEqual(['A', 'B'])
        expect(c.saldo).toEqual({ A: 0, B: 0 })
    })

    it('incassa tutto e si ferma quando il debito e coperto', async () => {
        const c = carte({ A: EUR(50000) })
        const r = await cascataScalini({ ...base, cards: ['A', 'B'], amountCents: EUR(12000), stepsCents: [EUR(10000), EUR(5000)], charge: c.charge })
        expect(r.collectedCents).toBe(EUR(12000))
        expect(r.remainingCents).toBe(0)
        expect(r.attempts).toBe(1)
        expect(c.log).toEqual(['A:12000:si'])
    })

    it('rimanente piu basso dello scalino: prova il rimanente esatto', async () => {
        const c = carte({ A: EUR(20000) })
        const r = await cascataScalini({ ...base, cards: ['A'], amountCents: EUR(10700), stepsCents: [EUR(10000), EUR(5000)], charge: c.charge })
        expect(c.log).toEqual(['A:10700:si'])
        expect(r.remainingCents).toBe(0)
    })

    it('dopo un si non chiede mai piu del rimanente', async () => {
        const c = carte({ A: EUR(100000) })
        const r = await cascataScalini({ ...base, cards: ['A'], amountCents: EUR(25000), stepsCents: [EUR(10000)], charge: c.charge })
        expect(c.log).toEqual(['A:25000:si'])
        expect(r.collectedCents).toBe(EUR(25000))
    })

    it('ogni scalino nuovo riparte sotto l ultimo importo rifiutato', async () => {
        const c = carte({ A: EUR(9000) })
        await cascataScalini({ ...base, cards: ['A'], amountCents: EUR(100000), stepsCents: [EUR(10000), EUR(5000), EUR(2000)], charge: c.charge })
        let minimoRifiutato = Infinity
        for (const l of c.log) {
            const [, imp, esito] = l.split(':')
            const n = Number(imp)
            if (esito === 'no') {
                minimoRifiutato = Math.min(minimoRifiutato, n)
            } else {
                expect(n).toBeLessThan(minimoRifiutato)
            }
        }
        expect(c.log.filter(l => l === 'A:10000:no')).toHaveLength(1)
    })

    it('rispetta il tetto tentativi', async () => {
        const c = carte({ A: 0 })
        const r = await cascataScalini({ ...base, maxAttempts: 5, cards: ['A', 'B'], amountCents: EUR(100000), stepsCents: [EUR(10000)], charge: c.charge })
        expect(r.attempts).toBe(5)
        expect(r.collectedCents).toBe(0)
    })

    it('carta vuota: zero incassato, lastError valorizzato', async () => {
        const c = carte({ A: 0 })
        const r = await cascataScalini({ ...base, cards: ['A'], amountCents: EUR(1000), stepsCents: [EUR(500)], charge: c.charge })
        expect(r.collectedCents).toBe(0)
        expect(r.lastError).toBe('DECLINED')
    })

    it('un errore di rete conta come rifiuto e la cascata continua', async () => {
        let n = 0
        const charge = async () => { n++; if (n === 1) throw new Error('timeout'); return { ok: true } }
        const r = await cascataScalini({ ...base, cards: ['A'], amountCents: EUR(1000), stepsCents: [EUR(500)], charge })
        // 1000 errore, 500 si, 500 si
        expect(r.collectedCents).toBe(EUR(1000))
        expect(r.attempts).toBe(3)
    })

    it('senza scalini non addebita nulla', async () => {
        const c = carte({ A: EUR(100) })
        const r = await cascataScalini({ ...base, cards: ['A'], amountCents: EUR(100), stepsCents: [], charge: c.charge })
        expect(r.attempts).toBe(0)
    })

    it('normalizzaScalini ordina, toglie doppioni e valori non validi', () => {
        expect(normalizzaScalini([200000, 1000000, 500000, 500000, 0, -5, 'x', '300000'])).toEqual([1000000, 500000, 300000, 200000])
        expect(normalizzaScalini(null)).toEqual([])
    })
})
