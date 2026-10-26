import { describe, it, expect } from 'vitest'
import { chiaviPersona } from './gadgetOmaggio'

describe('chiaviPersona', () => {
  it('stesso numero con o senza prefisso', () => {
    expect(chiaviPersona('+39 333 123 4567')).toEqual(chiaviPersona('3331234567'))
  })
  it('email in minuscolo', () => {
    expect(chiaviPersona('Mario.Rossi@Gmail.com')).toEqual(['e:mario.rossi@gmail.com'])
  })
  it('valori vuoti non riconoscono nessuno', () => {
    expect(chiaviPersona('', null, undefined, '   ', '12')).toEqual([])
  })
  it('telefono ed email insieme', () => {
    expect(chiaviPersona('3331234567', 'a@b.it').sort()).toEqual(['e:a@b.it', 't:331234567'])
  })
})
