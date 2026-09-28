import { describe, it, expect } from 'vitest'
import { tariffaSforoKm, kmInclusiContratto, isVoceSforoKm } from './sforoKmContratto'

// Estratto reale di centralina_pro_config (riga main) del 28/09/2026.
const KM_MAIN = [
    { id: 'supercars', sforo: 4.8 },
    { id: 'urban', sforo: 2.5 },
    { id: 'aziendali', sforo: 1.8 },
    { id: 'scooter', sforo: '' },
    { id: 'suv_luxury', sforo: 0.39 },
]

describe('tariffaSforoKm', () => {
    it('usa la tariffa fissata sulla prenotazione quando c\'e\'', () => {
        expect(tariffaSforoKm({ km_overage_fee: 3 }, KM_MAIN, 'supercars')).toBe(3)
    })

    it('senza tariffa sulla prenotazione legge Centralina Pro come il contratto', () => {
        expect(tariffaSforoKm({ km_overage_fee: null }, KM_MAIN, 'aziendali')).toBe(1.8)
        expect(tariffaSforoKm({}, KM_MAIN, 'Suv_Luxury')).toBe(0.39)
    })

    it('supercar ed exotic sono la stessa categoria', () => {
        expect(tariffaSforoKm({}, KM_MAIN, 'exotic')).toBe(4.8)
        expect(tariffaSforoKm({}, KM_MAIN, 'supercar')).toBe(4.8)
    })

    it('categoria senza sforo o sconosciuta = 0', () => {
        expect(tariffaSforoKm({}, KM_MAIN, 'scooter')).toBe(0)
        expect(tariffaSforoKm({}, KM_MAIN, 'barca')).toBe(0)
        expect(tariffaSforoKm({}, null, 'supercars')).toBe(0)
        expect(tariffaSforoKm({ km_overage_fee: 0 }, KM_MAIN, '')).toBe(0)
    })
})

describe('kmInclusiContratto', () => {
    it('gestionale: km_limit gia\' comprensivo dei pacchetti', () => {
        expect(kmInclusiContratto({ km_limit: '200', km_packages: [{ total_km: 100 }] })).toEqual({ illimitati: false, totale: 200 })
        expect(kmInclusiContratto({ km_limit: 280 })).toEqual({ illimitati: false, totale: 280 })
    })

    it('sito: kmPackage.includedKm', () => {
        expect(kmInclusiContratto({ kmPackage: { includedKm: 340 } })).toEqual({ illimitati: false, totale: 340 })
    })

    it('illimitati in tutte le forme', () => {
        expect(kmInclusiContratto({ km_limit: 'Illimitati' }).illimitati).toBe(true)
        expect(kmInclusiContratto({ unlimited_km: true, km_limit: '300' }).illimitati).toBe(true)
        expect(kmInclusiContratto({ kmPackage: { type: 'unlimited' } }).illimitati).toBe(true)
        expect(kmInclusiContratto({ kmPackage: { includedKm: 9999 } }).illimitati).toBe(true)
    })

    it('formato storico o assente = 0', () => {
        expect(kmInclusiContratto({ km_limit: '100/giorno' })).toEqual({ illimitati: false, totale: 0 })
        expect(kmInclusiContratto(null)).toEqual({ illimitati: false, totale: 0 })
    })
})

describe('isVoceSforoKm', () => {
    it('riconosce la voce per etichetta anche con id casuale', () => {
        expect(isVoceSforoKm({ id: 'jet190hf', label: 'Sforo km' })).toBe(true)
        expect(isVoceSforoKm({ id: 'km_sforo', label: 'Qualsiasi' })).toBe(true)
        expect(isVoceSforoKm({ id: 'abc', label: 'Eccesso km' })).toBe(true)
    })
    it('non confonde le altre penali', () => {
        expect(isVoceSforoKm({ id: 'x1', label: 'Ritardo check-out (per min)' })).toBe(false)
        expect(isVoceSforoKm({ id: 'x2', label: 'Pulizia straordinaria' })).toBe(false)
    })
})
