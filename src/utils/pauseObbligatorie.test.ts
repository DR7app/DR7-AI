import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabaseClient', () => ({ supabase: {} }))
import { pausaObbligatoriaDelGiorno, combinaPauseGiorno } from './pauseObbligatorie'

// 14/10/2026: contano solo le pause visibili (fasce, bordo giallo).
// `durata_min` non ha orario e non si vede: non deve mai essere scalata.
describe('pause: solo quelle visibili', () => {
    const dataISO = '2026-10-14' // mercoledi'

    it('durata_min non si somma alle fasce', () => {
        const p = pausaObbligatoriaDelGiorno({
            durata_min: 60, pagata: false, giorni: [1, 2, 3, 4, 5, 6], decorrenza: '2026-10-01',
            fasce: [{ da: '13:00', a: '13:10' }, { da: '14:00', a: '14:10' }],
        }, dataISO)
        expect(p.minuti).toBe(20)
        const c = combinaPauseGiorno(dataISO, [], p, '2026-10-14T17:00:00Z')
        const visibili = c.finestre.reduce((s, f) => s + (new Date(f.fine).getTime() - new Date(f.inizio).getTime()) / 60000, 0)
        expect(c.mostrateMin).toBe(visibili)
        expect(c.scalateMin).toBe(visibili)
    })

    it('solo durata_min senza fasce = nessuna pausa', () => {
        const p = pausaObbligatoriaDelGiorno({ durata_min: 155, pagata: false, fasce: [] }, dataISO)
        expect(p.vale).toBe(false)
        expect(combinaPauseGiorno(dataISO, [], p, null).scalateMin).toBe(0)
    })

    it('pausa a mano + fasce: totale = somma delle finestre mostrate', () => {
        const p = pausaObbligatoriaDelGiorno({
            durata_min: 155, pagata: false,
            fasce: [{ da: '09:50', a: '10:00' }, { da: '13:00', a: '14:30' }],
        }, dataISO)
        // pausa a mano 13:05-13:45 Roma (UTC+2) sostituisce la fascia 13:00-14:30
        const c = combinaPauseGiorno(dataISO, [{ inizio: '2026-10-14T11:05:00Z', fine: '2026-10-14T11:45:00Z' }], p, '2026-10-14T16:00:00Z')
        const visibili = c.finestre.reduce((s, f) => s + (new Date(f.fine).getTime() - new Date(f.inizio).getTime()) / 60000, 0)
        expect(visibili).toBe(50)
        expect(c.mostrateMin).toBe(50)
        expect(c.scalateMin).toBe(50)
    })
})
