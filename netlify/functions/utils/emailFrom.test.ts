import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { estraiIndirizzoEmail, dominioEmail, scegliMittenteSmtp } from './emailFrom'

describe('estraiIndirizzoEmail', () => {
  it('legge l indirizzo dentro le parentesi angolari', () => {
    expect(estraiIndirizzoEmail('DR7 <info@dr7.app>')).toBe('info@dr7.app')
  })
  it('accetta anche un indirizzo nudo', () => {
    expect(estraiIndirizzoEmail('info@dr7.app')).toBe('info@dr7.app')
  })
  it('stringa vuota se non e un indirizzo', () => {
    expect(estraiIndirizzoEmail('DR7')).toBe('')
    expect(estraiIndirizzoEmail('')).toBe('')
  })
})

describe('dominioEmail', () => {
  it('prende il dominio, minuscolo', () => {
    expect(dominioEmail('DR7 <Info@DR7.App>')).toBe('dr7.app')
    expect(dominioEmail('a@b.it')).toBe('b.it')
  })
})

describe('scegliMittenteSmtp', () => {
  const FALLBACK = '"DR7" <info@dr7.app>'
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks() })

  it('usa il mittente configurato se e dello stesso dominio dell account SMTP', () => {
    expect(scegliMittenteSmtp('DR7 Contratti <contratti@dr7.app>', 'info@dr7.app', FALLBACK))
      .toBe('DR7 Contratti <contratti@dr7.app>')
  })
  it('tiene il mittente storico se il dominio non combacia (l SMTP lo rifiuterebbe)', () => {
    expect(scegliMittenteSmtp('DR7 <noreply@altrodominio.it>', 'info@dr7.app', FALLBACK)).toBe(FALLBACK)
  })
  it('senza account SMTP noto si fida della configurazione', () => {
    expect(scegliMittenteSmtp('DR7 <x@altro.it>', '', FALLBACK)).toBe('DR7 <x@altro.it>')
  })
  it('configurazione vuota o non valida: mittente storico', () => {
    expect(scegliMittenteSmtp('', 'info@dr7.app', FALLBACK)).toBe(FALLBACK)
    expect(scegliMittenteSmtp('DR7', 'info@dr7.app', FALLBACK)).toBe(FALLBACK)
  })
})
