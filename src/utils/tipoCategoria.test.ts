import { describe, it, expect } from 'vitest'
import { tipoDaEtichetta } from './tipoCategoria'

// Le sette categorie come sono scritte in Centralina Pro il 20/09/2026, con
// l'id storico accanto: e' la ragione per cui non si legge l'id.
const CATEGORIE_REALI = [
  { id: 'supercars', label: 'Exotic Cars', atteso: 'SUPERCAR' },
  { id: 'urban', label: 'Hypercar', atteso: 'SUPERCAR' },
  { id: 'aziendali', label: 'Supercar', atteso: 'SUPERCAR' },
  { id: 'scooter', label: 'Urban', atteso: 'UTILITARIA' },
  { id: 'supercar_elit', label: 'Flotta Aziendale', atteso: 'FURGONE' },
  { id: 'hypercar_elit', label: 'Moto', atteso: null },
  { id: 'suv_luxury', label: 'Scooter', atteso: null },
] as const

describe('tipoDaEtichetta', () => {
  it('riconosce le categorie in produzione', () => {
    for (const c of CATEGORIE_REALI) {
      expect(tipoDaEtichetta(c.label), `${c.label} (id ${c.id})`).toBe(c.atteso)
    }
  })

  it('non ricade nel tipo sbagliato che dava il confronto per id', () => {
    // Il contratto sceglieva la clausola cosi': urban -> utilitarie.
    // Una Hypercar prendeva il testo delle utilitarie, con la franchigia
    // sbagliata su un documento firmato.
    expect(tipoDaEtichetta('Hypercar')).not.toBe('UTILITARIA')
    expect(tipoDaEtichetta('Supercar')).not.toBe('FURGONE')
  })

  it('etichetta vuota o sconosciuta non decide nulla', () => {
    for (const l of ['', '   ', 'Moto', 'Scooter', 'Categoria nuova']) {
      expect(tipoDaEtichetta(l)).toBeNull()
    }
  })

  it('maiuscole e plurali non cambiano il risultato', () => {
    expect(tipoDaEtichetta('EXOTIC CARS')).toBe('SUPERCAR')
    expect(tipoDaEtichetta('Utilitarie')).toBe('UTILITARIA')
    expect(tipoDaEtichetta('Furgoni')).toBe('FURGONE')
  })
})
