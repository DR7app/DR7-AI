import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabaseClient', () => ({ supabase: {} }))

import { normalizzaFidelityLavaggio, FIDELITY_LAVAGGIO_DEFAULT, euroFidelity } from './fidelityLavaggio'

describe('normalizzaFidelityLavaggio (gemella di dr7_fidelity_lavaggio_norm)', () => {
  it('config assente = regole di sempre', () => {
    expect(normalizzaFidelityLavaggio(undefined)).toEqual(FIDELITY_LAVAGGIO_DEFAULT)
    expect(normalizzaFidelityLavaggio(null)).toEqual(FIDELITY_LAVAGGIO_DEFAULT)
    expect(normalizzaFidelityLavaggio([])).toEqual(FIDELITY_LAVAGGIO_DEFAULT)
  })

  it('zero, negativi e testo tornano al default', () => {
    expect(normalizzaFidelityLavaggio({
      euro_per_punto: -1, soglia_punti: 0, importo_premio: 'abc', validita_giorni: 0, tipo_premio: 'x', attivo: 'no',
    })).toEqual(FIDELITY_LAVAGGIO_DEFAULT)
  })

  it('valori validi passano, anche con la virgola', () => {
    expect(normalizzaFidelityLavaggio({
      attivo: false, euro_per_punto: '1,5', soglia_punti: '100', importo_premio: 10, validita_giorni: 30, tipo_premio: 'codice_sconto',
    })).toEqual({
      attivo: false, euro_per_punto: 1.5, soglia_punti: 100, importo_premio: 10, validita_giorni: 30, tipo_premio: 'codice_sconto',
    })
  })

  it('soglia e giorni interi, importi a due decimali', () => {
    const c = normalizzaFidelityLavaggio({ soglia_punti: 120.7, validita_giorni: 7.9, importo_premio: 12.345, euro_per_punto: 0.004 })
    expect(c.soglia_punti).toBe(120)
    expect(c.validita_giorni).toBe(7)
    expect(c.importo_premio).toBe(12.35)
    expect(c.euro_per_punto).toBe(1)
  })

  it('importo leggibile', () => {
    expect(euroFidelity(25)).toBe('25')
    expect(euroFidelity(12.5)).toBe('12,50')
  })
})
