import { describe, it, expect } from 'vitest'
import {
  inFasciaInvio, prossimaApertura, stimaFineInvio, romaLocaleAUtc, partiRoma,
  LIMITE_MESSAGGI_ORA, INVII_PER_GIRO,
} from './campagneFrequenza'

describe('fascia di invio 9-21 ora di Roma', () => {
  it('estate (ora legale, UTC+2): 07:00 UTC = 09:00 Roma, dentro', () => {
    expect(inFasciaInvio(new Date('2026-07-10T07:00:00Z'))).toBe(true)
    expect(inFasciaInvio(new Date('2026-07-10T06:59:00Z'))).toBe(false)
    expect(inFasciaInvio(new Date('2026-07-10T18:59:00Z'))).toBe(true)
    expect(inFasciaInvio(new Date('2026-07-10T19:00:00Z'))).toBe(false)
  })
  it('inverno (ora solare, UTC+1): 08:00 UTC = 09:00 Roma', () => {
    expect(inFasciaInvio(new Date('2026-12-10T07:59:00Z'))).toBe(false)
    expect(inFasciaInvio(new Date('2026-12-10T08:00:00Z'))).toBe(true)
    expect(inFasciaInvio(new Date('2026-12-10T20:00:00Z'))).toBe(false)
  })
})

describe('prossimaApertura', () => {
  it('di notte prima delle 9: le 9 dello stesso giorno', () => {
    expect(prossimaApertura(new Date('2026-12-10T05:00:00Z')).toISOString()).toBe('2026-12-10T08:00:00.000Z')
  })
  it('dopo le 21: le 9 del giorno dopo', () => {
    expect(prossimaApertura(new Date('2026-12-10T21:30:00Z')).toISOString()).toBe('2026-12-11T08:00:00.000Z')
  })
  it('a cavallo del cambio ora (24-25/10/2026): le 9 ora solare', () => {
    // 24/10 sera ancora ora legale, il 25 si passa all'ora solare.
    expect(prossimaApertura(new Date('2026-10-24T20:00:00Z')).toISOString()).toBe('2026-10-25T08:00:00.000Z')
  })
  it('fine mese / fine anno', () => {
    expect(prossimaApertura(new Date('2026-12-31T21:00:00Z')).toISOString()).toBe('2027-01-01T08:00:00.000Z')
  })
})

describe('romaLocaleAUtc', () => {
  it('andata e ritorno', () => {
    const d = romaLocaleAUtc(2026, 7, 1, 9, 30)
    expect(d.toISOString()).toBe('2026-07-01T07:30:00.000Z')
    expect(partiRoma(d)).toMatchObject({ anno: 2026, mese: 7, giorno: 1, ora: 9, minuto: 30 })
  })
})

describe('stimaFineInvio', () => {
  it('niente da inviare = nessuna stima', () => {
    expect(stimaFineInvio(0)).toBeNull()
  })
  it('50 messaggi alle 10:00 finiscono entro le 11:00', () => {
    const fine = stimaFineInvio(LIMITE_MESSAGGI_ORA, new Date('2026-12-10T09:00:00Z'))!
    expect(fine.getTime()).toBeLessThan(new Date('2026-12-10T10:00:00Z').getTime())
    expect(fine.getTime()).toBeGreaterThan(new Date('2026-12-10T09:55:00Z').getTime())
  })
  it('oltre la capienza del giorno (12 ore x 50 = 600) si continua domani alle 9', () => {
    // Inizio alle 9:00 Roma: 600 stanno nel giorno, il 601esimo domani alle 9.
    const fine = stimaFineInvio(601, new Date('2026-12-10T08:00:00Z'))!
    expect(fine.toISOString()).toBe('2026-12-11T08:00:00.000Z')
  })
  it('lanciata alle 23: parte domani alle 9', () => {
    const fine = stimaFineInvio(1, new Date('2026-12-10T22:00:00Z'))!
    expect(fine.toISOString()).toBe('2026-12-11T08:00:00.000Z')
  })
})

it('i 50 dell\'ora sono distribuiti: 2 per giro di cron ogni 2 minuti', () => {
  expect(INVII_PER_GIRO).toBe(2)
})
