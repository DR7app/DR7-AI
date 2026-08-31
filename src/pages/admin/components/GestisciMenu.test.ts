/**
 * Geometria del menu "Gestisci" — il punto che si rompeva su telefono.
 *
 * Il menu di una prenotazione Noleggio arriva a nove voci (Modifica,
 * Estendi, Cancella, Contratto, Invia Contratto, Fattura, Link Pagamento,
 * Pronta, Danni & Penali) piu' quattro intestazioni: oltre 400px.
 *
 * 2026-08-31: il pannello non va piu' schiacciato nello spazio libero sotto
 * al bottone. Deve vedersi INTERO, senza scorrerlo: se sotto non ci sta si
 * apre sopra, e se non basta nemmeno sopra si alza quanto serve.
 */
import { describe, it, expect } from 'vitest'
import { computeCoords } from './GestisciMenu'

// iPhone in verticale, area visibile tipica con le barre di Safari.
const VW = 390
const VH = 664
const PANEL = 220
// Altezza reale del menu Noleggio: nove voci piu' le intestazioni.
const ALTEZZA = 420

const rect = (top: number, height = 32, right = VW - 16) =>
    ({ top, bottom: top + height, right })

describe('computeCoords', () => {
    it('apre sotto al bottone quando sotto ci sta tutto', () => {
        const c = computeCoords(rect(120), VW, VH, PANEL, ALTEZZA)
        expect(c.top).toBe(160)
    })

    it('apre sopra quando sotto non ci sta tutto il pannello', () => {
        const c = computeCoords(rect(560), VW, VH, PANEL, ALTEZZA)
        // 560 - 8 (margine) - 420 (altezza) = 132: finisce sopra al bottone,
        // con tutte le voci visibili.
        expect(c.top).toBe(132)
    })

    it('nessuna voce tagliata e nessuno scroll, a qualunque altezza del bottone', () => {
        for (let top = 0; top <= VH - 32; top += 8) {
            const c = computeCoords(rect(top), VW, VH, PANEL, ALTEZZA)
            expect(c.top).toBeGreaterThanOrEqual(0)
            expect(c.top + ALTEZZA).toBeLessThanOrEqual(VH)
            // maxHeight non taglia il contenuto: niente barra di scorrimento.
            expect(c.maxHeight).toBeGreaterThanOrEqual(ALTEZZA)
        }
    })

    it('schermo piu\' basso del pannello: si ancora al viewport e li\' si scorre', () => {
        const c = computeCoords(rect(150), 844, 320, PANEL, ALTEZZA)
        expect(c.top).toBe(8)
        expect(c.maxHeight).toBe(320 - 16)
    })

    it('non sborda a sinistra quando il trigger e\' sul bordo sinistro', () => {
        const c = computeCoords(rect(200, 32, 90), VW, VH, PANEL, ALTEZZA)
        const left = VW - c.right - PANEL
        expect(left).toBeGreaterThanOrEqual(8)
    })

    it('non sborda a destra: resta almeno il margine dal bordo', () => {
        const c = computeCoords(rect(200, 32, VW), VW, VH, PANEL, ALTEZZA)
        expect(c.right).toBeGreaterThanOrEqual(8)
    })

    it('pannello piu\' largo dello schermo: viene limitato dal maxWidth', () => {
        const c = computeCoords(rect(200), 320, VH, 400, ALTEZZA)
        expect(c.maxWidth).toBe(320 - 16)
        expect(c.right).toBeGreaterThanOrEqual(8)
    })
})
