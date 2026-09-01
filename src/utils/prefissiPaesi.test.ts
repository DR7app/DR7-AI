import { describe, it, expect } from 'vitest'
import { bandieraNumero, paeseDaNumero } from './prefissiPaesi'

describe('bandiera del numero', () => {
  it('numero italiano scritto senza + (39...) ha la bandiera italiana', () => {
    expect(paeseDaNumero('393401234567')?.iso).toBe('IT')
    expect(paeseDaNumero('39 340 123 4567')?.iso).toBe('IT')
    expect(bandieraNumero('393401234567')).not.toBe('')
  })
  it('cellulare italiano nazionale resta italiano', () => {
    expect(paeseDaNumero('3401234567')?.iso).toBe('IT')
    expect(paeseDaNumero('3368469763')?.iso).toBe('IT')
  })
  it('numero francese senza + non diventa italiano', () => {
    expect(paeseDaNumero('33684697632')?.iso).toBe('FR')
  })
  it('con il + funziona come prima', () => {
    expect(paeseDaNumero('+393401234567')?.iso).toBe('IT')
    expect(paeseDaNumero('+33684697632')?.iso).toBe('FR')
  })
  it('cio che non si capisce resta senza bandiera', () => {
    expect(paeseDaNumero('12345')).toBeNull()
    expect(bandieraNumero('')).toBe('')
  })
})
