import { describe, it, expect } from 'vitest'
import { settimanaDiTurno } from '../../netlify/functions/utils/settimanaDiTurno'

describe('settimanaDiTurno', () => {
  it('ogni 2 settimane dal lunedi 26/10/2026', () => {
    expect(settimanaDiTurno('2026-10-26', '2026-10-26', 2)).toBe(true)
    expect(settimanaDiTurno('2026-10-26', '2026-11-02', 2)).toBe(false)
    expect(settimanaDiTurno('2026-10-26', '2026-11-09', 2)).toBe(true)
  })
  it('conta la settimana, non il giorno: inizio di mercoledi, invio di lunedi', () => {
    // 28/10 e' mercoledi: la settimana 0 va da lunedi 26/10, ma prima dell'inizio non parte.
    expect(settimanaDiTurno('2026-10-28', '2026-10-26', 2)).toBe(false)
    expect(settimanaDiTurno('2026-10-28', '2026-11-02', 2)).toBe(false)
    expect(settimanaDiTurno('2026-10-28', '2026-11-09', 2)).toBe(true)
    expect(settimanaDiTurno('2026-10-28', '2026-10-30', 2)).toBe(true)
  })
  it('attraversa il cambio dell\'ora e l\'anno', () => {
    expect(settimanaDiTurno('2026-10-19', '2026-11-02', 2)).toBe(true)
    expect(settimanaDiTurno('2026-12-21', '2027-01-04', 2)).toBe(true)
    expect(settimanaDiTurno('2026-12-21', '2026-12-28', 2)).toBe(false)
  })
  it('senza data di inizio non parte', () => {
    expect(settimanaDiTurno(null, '2026-10-26', 2)).toBe(false)
  })
})
