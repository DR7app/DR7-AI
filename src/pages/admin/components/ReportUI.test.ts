import { describe, it, expect } from 'vitest'
import { serieDelPeriodo } from './ReportUI'

describe('serieDelPeriodo', () => {
  it('un mese: un punto per giorno, giorni vuoti a zero', () => {
    const r = serieDelPeriodo([{ data: '2026-09-03', valore: 100 }, { data: '2026-09-03', valore: 50 }], '2026-09-01', '2026-09-30')
    expect(r.passo).toBe('giorno')
    expect(r.gruppi).toHaveLength(30)
    expect(r.gruppi[2]).toEqual({ inizio: '2026-09-03', valore: 150 })
    expect(r.gruppi[0].valore).toBe(0)
  })
  it('sei mesi: per settimana, lunedi come inizio', () => {
    const r = serieDelPeriodo([{ data: '2026-09-23', valore: 1 }], '2026-04-01', '2026-09-30')
    expect(r.passo).toBe('settimana')
    expect(r.gruppi.find(g => g.inizio === '2026-09-21')?.valore).toBe(1)
  })
  it('un anno: per mese, fuori periodo ignorato', () => {
    const r = serieDelPeriodo([{ data: '2026-02-10', valore: 5 }, { data: '2027-02-10', valore: 9 }], '2025-10-01', '2026-09-30')
    expect(r.passo).toBe('mese')
    expect(r.gruppi).toHaveLength(12)
    expect(r.gruppi.find(g => g.inizio === '2026-02-01')?.valore).toBe(5)
  })
  it('ISO con ora: giorno in ora italiana', () => {
    const r = serieDelPeriodo([{ data: '2026-09-02T23:30:00Z', valore: 1 }], '2026-09-01', '2026-09-05')
    expect(r.gruppi.find(g => g.inizio === '2026-09-03')?.valore).toBe(1)
  })
  it('massimo invece di somma', () => {
    const r = serieDelPeriodo([{ data: '2026-09-01', valore: 3 }, { data: '2026-09-02', valore: 7 }], '2026-01-01', '2026-12-31', 'massimo')
    expect(r.gruppi.find(g => g.inizio === '2026-09-01')?.valore).toBe(7)
  })
})
