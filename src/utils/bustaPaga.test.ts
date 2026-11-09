import { describe, it, expect, vi, beforeEach } from 'vitest'

// Finto PostgREST: applica i filtri usati da caricaTimbraturePeriodo e, come
// quello vero, non restituisce MAI piu' di 1000 righe per richiesta.
type Riga = { id: string; operatore_id: string; tipo: string; timestamp: string; data: string }
const db: { righe: Riga[]; richieste: number } = { righe: [], richieste: 0 }
const MAX_RIGHE = 1000

function query() {
    let rows = [...db.righe]
    let range: [number, number] | null = null
    const q = {
        select: () => q,
        gte: (col: keyof Riga, v: string) => { rows = rows.filter(r => r[col] >= v); return q },
        lte: (col: keyof Riga, v: string) => { rows = rows.filter(r => r[col] <= v); return q },
        in: (col: keyof Riga, vs: string[]) => { rows = rows.filter(r => vs.includes(r[col])); return q },
        order: () => q,
        range: (a: number, b: number) => { range = [a, b]; return q },
        then: (res: (v: { data: Riga[]; error: null }) => unknown) => {
            db.richieste++
            rows.sort((x, y) => x.timestamp.localeCompare(y.timestamp) || x.id.localeCompare(y.id))
            const [a, b] = range ?? [0, rows.length - 1]
            return Promise.resolve(res({ data: rows.slice(a, Math.min(b + 1, a + MAX_RIGHE)), error: null }))
        },
    }
    return q
}
vi.mock('../supabaseClient', () => ({ supabase: { from: () => query() } }))

import { caricaTimbraturePeriodo, costruisciGiornate, calcolaBustaPaga, giorniDelPeriodo, type TimbraturaBustaPaga } from './bustaPaga'
import type { PauseConfig } from './pauseObbligatorie'

// Ottobre 2026 (ora legale fino al 25: Roma = UTC+2, poi UTC+1).
// 12 operatori, lun-sab, entrata 08:30 / pausa 13:00-14:00 / uscita 18:00 Roma
// = 4 timbrature a giornata -> 12 x 27 x 4 = 1296 righe nel mese: oltre il tetto.
const OPERATORI = Array.from({ length: 12 }, (_, i) => `op-${String(i + 1).padStart(2, '0')}`)
function romaISO(data: string, hhmm: string): string {
    const off = data < '2026-10-25' ? 2 : 1
    const [h, m] = hhmm.split(':').map(Number)
    const d = new Date(`${data}T00:00:00Z`)
    d.setUTCHours(h - off, m)
    return d.toISOString()
}
function seminaOttobre(): Riga[] {
    const out: Riga[] = []
    let n = 0
    for (const data of giorniDelPeriodo('2026-10-01', '2026-10-31')) {
        if (new Date(`${data}T12:00:00Z`).getUTCDay() === 0) continue // domenica chiuso
        for (const op of OPERATORI) {
            for (const [tipo, ora] of [['entrata', '08:30'], ['pausa_inizio', '13:00'], ['pausa_fine', '14:00'], ['uscita', '18:00']] as const) {
                out.push({ id: `t-${String(n++).padStart(6, '0')}`, operatore_id: op, tipo, timestamp: romaISO(data, ora), data })
            }
        }
    }
    return out
}

// Contratto tipico: 40h/settimana, 12 euro/h ordinaria, 15 euro/h straordinario.
const CONTRATTO = {
    paga_oraria_eur: 12,
    paga_straordinario_eur: 15,
    straordinario_abilitato: true,
    ore_soglia_straordinario: null,
    ore_target_giornaliere: null,
    ore_target_settimanali: 40,
    ore_target_mensili: null,
    stipendio_mensile_eur: null,
    stipendio_frequenza: null,
}
const PAUSE: PauseConfig | null = null

/** Come leggeva la lista fino al 09/11: UNA richiesta per tutti, senza range. */
async function vecchiaLetturaLista(from: string, to: string): Promise<TimbraturaBustaPaga[]> {
    const q = query().select().gte('data', from).lte('data', to).order()
    return await new Promise<Riga[]>(ok => q.then(r => ok(r.data)))
}

describe('Buste Paga: lista e dettaglio danno lo stesso numero', () => {
    beforeEach(() => { db.righe = seminaOttobre(); db.richieste = 0 })

    it('il mese supera le 1000 timbrature (caso reale del 09/11)', () => {
        expect(db.righe.length).toBe(1296)
    })

    it('PRIMA: la lettura unica della lista perdeva gli ultimi giorni del mese per tutti', async () => {
        const giorni = giorniDelPeriodo('2026-10-01', '2026-10-31')
        const tutte = await vecchiaLetturaLista('2026-10-01', '2026-10-31')
        expect(tutte.length).toBe(1000)
        const op = 'op-01'
        const lista = calcolaBustaPaga(costruisciGiornate(tutte.filter(e => e.operatore_id === op), giorni, PAUSE), CONTRATTO, 0)
        const proprie = await caricaTimbraturePeriodo('2026-10-01', '2026-10-31', [op])
        const dettaglio = calcolaBustaPaga(costruisciGiornate(proprie.data, giorni, PAUSE), CONTRATTO, 0)
        // Dettaglio: 27 giornate x 8h30 = 229h30
        expect(dettaglio.minLavorati).toBe(27 * 510)
        expect(lista.minLavorati).toBeLessThan(dettaglio.minLavorati)
        expect(lista.totale).toBeLessThan(dettaglio.totale)
    })

    it('ORA: la lista legge tutte le righe (paginate) e coincide col dettaglio per ogni operatore', async () => {
        const giorni = giorniDelPeriodo('2026-10-01', '2026-10-31')
        const res = await caricaTimbraturePeriodo('2026-10-01', '2026-10-31', OPERATORI)
        expect(res.error).toBeNull()
        expect(res.data.length).toBe(1296)
        expect(db.richieste).toBeGreaterThan(1)
        for (const op of OPERATORI) {
            const lista = calcolaBustaPaga(costruisciGiornate(res.data.filter(e => e.operatore_id === op), giorni, PAUSE), CONTRATTO, 0)
            const proprie = await caricaTimbraturePeriodo('2026-10-01', '2026-10-31', [op])
            const dettaglio = calcolaBustaPaga(costruisciGiornate(proprie.data, giorni, PAUSE), CONTRATTO, 0)
            expect(lista).toEqual(dettaglio)
        }
    })

    it('numeri attesi del mese (40h/sett, settimana spezzata a fine mese)', async () => {
        const giorni = giorniDelPeriodo('2026-10-01', '2026-10-31')
        const res = await caricaTimbraturePeriodo('2026-10-01', '2026-10-31', ['op-05'])
        const c = calcolaBustaPaga(costruisciGiornate(res.data, giorni, PAUSE), CONTRATTO, 0)
        // Settimane dentro ottobre: 1-4 (3gg, 25h30), 5-11, 12-18, 19-25 (6gg, 51h
        // = 11h straord ciascuna), 26-31 (6gg, 51h -> 11h). Totale straord 44h.
        expect(c.minStraord).toBe(44 * 60)
        expect(c.minOrdinari).toBe(27 * 510 - 44 * 60)
        expect(c.pagaOrd).toBeCloseTo((c.minOrdinari / 60) * 12, 6)
        expect(c.pagaStraord).toBeCloseTo(44 * 15, 6)
        expect(c.totale).toBeCloseTo(c.pagaOrd + c.pagaStraord, 6)
    })
})

describe('costruisciGiornate', () => {
    it('minuti per difetto (floor) e giornata senza uscita = 0', () => {
        const e: TimbraturaBustaPaga[] = [
            { operatore_id: 'x', tipo: 'entrata', timestamp: '2026-10-14T06:30:40Z', data: '2026-10-14' },
            { operatore_id: 'x', tipo: 'uscita', timestamp: '2026-10-14T15:00:10Z', data: '2026-10-14' },
            { operatore_id: 'x', tipo: 'entrata', timestamp: '2026-10-15T06:30:00Z', data: '2026-10-15' },
        ]
        const g = costruisciGiornate(e, ['2026-10-14', '2026-10-15', '2026-10-16'], null)
        expect(g.map(d => d.minutiLavorati)).toEqual([509, 0, 0])
    })

    it('pausa per fascia di contratto: si scala solo quella mostrata', () => {
        const e: TimbraturaBustaPaga[] = [
            { operatore_id: 'x', tipo: 'entrata', timestamp: romaISO('2026-10-14', '08:00'), data: '2026-10-14' },
            { operatore_id: 'x', tipo: 'uscita', timestamp: romaISO('2026-10-14', '17:00'), data: '2026-10-14' },
        ]
        const cfg: PauseConfig = { durata_min: 120, pagata: false, fasce: [{ da: '13:00', a: '13:30' }] }
        const [g] = costruisciGiornate(e, ['2026-10-14'], cfg)
        expect(g.minutiPausa).toBe(30)
        expect(g.minutiLavorati).toBe(9 * 60 - 30)
    })
})

describe('giorniDelPeriodo', () => {
    it('include gli estremi e attraversa il cambio ora', () => {
        const g = giorniDelPeriodo('2026-10-24', '2026-10-27')
        expect(g).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'])
    })
})
