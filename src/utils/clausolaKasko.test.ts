import { describe, it, expect } from 'vitest'
import { clausolaKasko, daRisarcire, soloRca } from './clausolaKasko'

describe('daRisarcire', () => {
  it('scrive franchigia e scoperto come nel contratto', () => {
    // Exotic Cars / Fascia A / Kasko Base in Centralina il 20/09/2026.
    expect(daRisarcire('15000', '30')).toBe('da risarcire €15000 + 30% del danno')
  })
  it('regge i casi con un solo numero', () => {
    expect(daRisarcire('5000', '')).toBe('da risarcire €5000')
    expect(daRisarcire('', '30')).toBe('da risarcire il 30% del danno')
    expect(daRisarcire('', '')).toBe('nessuna franchigia')
  })
})

describe('soloRca', () => {
  it('riconosce le opzioni senza Kasko dal nome', () => {
    expect(soloRca('RCA')).toBe(true)
    expect(soloRca('RCA Compresa (no Kasko)')).toBe(true)
    expect(soloRca('Kasko Base')).toBe(false)
    expect(soloRca('Kasko DR7')).toBe(false)
  })
})

describe('clausolaKasko', () => {
  it('usa i numeri della categoria, non quelli scritti in duro', () => {
    const testo = clausolaKasko({
      etichettaCategoria: 'Hypercar',
      nomeKasko: 'Kasko Base',
      franchigiaEur: '10000',
      scopertoPerc: '30',
    })
    expect(testo).toContain('RESPONSABILITÀ PENALE DEI CLIENTI - HYPERCAR')
    expect(testo).toContain('Kasko Base:')
    expect(testo).toContain('da risarcire €10000 + 30% del danno')
    // Il vecchio testo in duro diceva 5.000 a tutti: non deve piu' comparire.
    expect(testo).not.toContain('€5.000')
    expect(testo).toContain('SOTTO EFFETTO DI STUPEFACENTI')
  })

  it('rispetta la descrizione scritta in Centralina', () => {
    const testo = clausolaKasko({
      etichettaCategoria: 'Urban',
      nomeKasko: 'Kasko Base',
      copertura: 'Incendio - furto - distruzione totale, previo preventivo in officina ufficiale',
      franchigiaEur: '2000',
      scopertoPerc: '30',
    })
    expect(testo).toContain('previo preventivo in officina ufficiale')
    expect(testo).not.toContain('agenti atmosferici')
  })

  it('sulla sola RCA dice che la Kasko non c\'e\' e riporta la cauzione', () => {
    const testo = clausolaKasko({
      etichettaCategoria: 'Supercar',
      nomeKasko: 'RCA Compresa (no Kasko)',
      franchigiaEur: '',
      scopertoPerc: '',
      depositoObbligatorio: 5000,
    })
    expect(testo).toContain('NON è attiva')
    expect(testo).toContain('cauzione obbligatoria di €5.000')
    expect(testo).not.toContain('da risarcire')
  })
})
