import { describe, it, expect } from 'vitest'
import { bandieraNumero, paeseDaNumero, numeroLeggibile } from './prefissiPaesi'

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

describe('numero leggibile', () => {
  it('stacca l indicativo e mette il +', () => {
    expect(numeroLeggibile('33684697632')).toBe('+33 684697632')
    expect(numeroLeggibile('393401234567')).toBe('+39 3401234567')
  })
  it('aggiunge +39 a un nazionale italiano', () => {
    expect(numeroLeggibile('3401234567')).toBe('+39 3401234567')
  })
  it('non altera le cifre', () => {
    const solo = (s: string) => s.replace(/\D/g, '')
    for (const n of ['33684697632', '393401234567', '3401234567', '+393401234567']) {
      expect(solo(numeroLeggibile(n))).toContain(solo(n).replace(/^00/, ''))
    }
  })
  it('quello che non si capisce resta identico', () => {
    expect(numeroLeggibile('12345')).toBe('12345')
    expect(numeroLeggibile('')).toBe('')
  })
})
