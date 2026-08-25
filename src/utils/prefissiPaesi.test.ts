import { describe, it, expect } from 'vitest'
import { paeseDaNumero, separaPrefisso, componiNumero } from './prefissiPaesi'

describe('paeseDaNumero', () => {
    it('legge il prefisso esplicito con il +', () => {
        expect(paeseDaNumero('+33684697632')?.iso).toBe('FR')
        expect(paeseDaNumero('+39 340 1234567')?.iso).toBe('IT')
        expect(paeseDaNumero('+377 6 12 34 56')?.iso).toBe('MC')
        expect(paeseDaNumero('+971501234567')?.iso).toBe('AE')
    })

    it('legge il prefisso scritto con lo 00', () => {
        expect(paeseDaNumero('0033684697632')?.iso).toBe('FR')
        expect(paeseDaNumero('003684697632')?.iso).toBe('HU')
    })

    it('non inventa il paese su un numero senza prefisso', () => {
        // Il caso che sbagliava in produzione: un francese salvato senza il +
        // usciva con la bandiera italiana.
        expect(paeseDaNumero('33684697632')).toBeNull()
        expect(paeseDaNumero('4915112345678')).toBeNull()
    })

    it('riconosce il formato nazionale italiano', () => {
        expect(paeseDaNumero('3401234567')?.iso).toBe('IT')
        expect(paeseDaNumero('340 123 4567')?.iso).toBe('IT')
        expect(paeseDaNumero('070123456')?.iso).toBe('IT')
    })

    it('non restituisce niente su valori vuoti o non numerici', () => {
        expect(paeseDaNumero('')).toBeNull()
        expect(paeseDaNumero(null)).toBeNull()
        expect(paeseDaNumero('n/d')).toBeNull()
    })
})

describe('separaPrefisso', () => {
    it('spacchetta le forme salvate', () => {
        expect(separaPrefisso('+33684697632')).toEqual({ dial: '+33', numero: '684697632' })
        expect(separaPrefisso('003684697632')).toEqual({ dial: '+36', numero: '84697632' })
        expect(separaPrefisso('3401234567')).toEqual({ dial: '+39', numero: '3401234567' })
    })

    it('preferisce il prefisso piu lungo: +377 non viene letto come +37', () => {
        expect(separaPrefisso('+377612345678').dial).toBe('+377')
    })
})

describe('componiNumero', () => {
    it('toglie lo zero di tronco e i separatori', () => {
        expect(componiNumero('+33', '06 84 69 76 32')).toBe('+33684697632')
        expect(componiNumero('+39', '340-123-4567')).toBe('+393401234567')
    })

    it('restituisce null quando il numero locale e vuoto', () => {
        expect(componiNumero('+39', '')).toBeNull()
    })
})
