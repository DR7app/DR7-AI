import { describe, it, expect } from 'vitest'
import { validaCodiceFiscale, validaPartitaIva, carattereControlloCF } from './codiceFiscaleValido'
import { validateCheckDigit } from './codiceFiscale'

// 01/10/2026: i due CF reali che lo SDI ha scartato (DR7-2026-2102 e le
// fatture Saia 1908-1913), con il carattere di controllo giusto accanto.
const CF_SCARTATI = [
  { cf: 'LRASFN01E25Z138I', atteso: 'J' },
  { cf: 'SIAVLR91E18B354A', atteso: 'G' },
]

describe('validaCodiceFiscale', () => {
  it('rifiuta i CF reali scartati dallo SDI e indica il carattere atteso', () => {
    for (const { cf, atteso } of CF_SCARTATI) {
      const esito = validaCodiceFiscale(cf)
      expect(esito.valido, cf).toBe(false)
      if (!esito.valido) {
        expect(esito.atteso).toBe(atteso)
        expect(esito.motivo).toContain(cf)
        expect(esito.motivo).toContain(`sarebbe ${atteso}`)
      }
    }
  })

  it('accetta gli stessi CF con il carattere di controllo corretto', () => {
    expect(validaCodiceFiscale('LRASFN01E25Z138J').valido).toBe(true)
    expect(validaCodiceFiscale('SIAVLR91E18B354G').valido).toBe(true)
  })

  it('accetta CF validi noti, minuscole e spazi compresi', () => {
    expect(validaCodiceFiscale('RSSMRA85T10A562S').valido).toBe(true)
    expect(validaCodiceFiscale('rssmra85t10a562s').valido).toBe(true)
    expect(validaCodiceFiscale(' RSS MRA 85T10 A562S ').valido).toBe(true)
  })

  it('accetta i CF omocodici (cifre sostituite da L..V) con il loro controllo', () => {
    // RSSMRA85T10A562S con l'ultima cifra del comune omocodizzata (2 -> N)
    expect(carattereControlloCF('RSSMRA85T10A56N')).toBe('H')
    expect(validaCodiceFiscale('RSSMRA85T10A56NH').valido).toBe(true)
    // giorno omocodizzato (0 -> L)
    expect(validaCodiceFiscale('RSSMRA85T1LA562V').valido).toBe(true)
    // omocodico ma col controllo sbagliato
    expect(validaCodiceFiscale('RSSMRA85T10A56NS').valido).toBe(false)
  })

  it('rifiuta formato, lunghezza e data impossibili', () => {
    expect(validaCodiceFiscale('').valido).toBe(false)
    expect(validaCodiceFiscale('XXXXXXXXXXXXXXXX').valido).toBe(false)
    expect(validaCodiceFiscale('0000000000000011').valido).toBe(false)
    expect(validaCodiceFiscale('RSSMRA85T10A562').valido).toBe(false)
    // giorno 00 e mese inesistente (F), anche col controllo "giusto"
    const giornoZero = 'RSSMRA85T00A562'
    expect(validaCodiceFiscale(giornoZero + carattereControlloCF(giornoZero)).valido).toBe(false)
    const meseF = 'RSSMRA85F10A562'
    expect(validaCodiceFiscale(meseF + carattereControlloCF(meseF)).valido).toBe(false)
  })

  it('valida il CF numerico a 11 cifre delle aziende con il suo checksum', () => {
    expect(validaCodiceFiscale('04104640927').valido).toBe(true)
    expect(validaCodiceFiscale('00743110157').valido).toBe(true)
    const errato = validaCodiceFiscale('01440000920')
    expect(errato.valido).toBe(false)
    if (!errato.valido) expect(errato.motivo).toMatch(/^Codice fiscale numerico "01440000920" non valido/)
  })
})

describe('validaPartitaIva', () => {
  it('accetta P.IVA valide e rifiuta checksum, lunghezza, prefisso e zeri', () => {
    expect(validaPartitaIva('04104640927').valido).toBe(true)
    expect(validaPartitaIva('12345678903').valido).toBe(true)
    expect(validaPartitaIva('12345678901').valido).toBe(false)
    expect(validaPartitaIva('IT04104640927').valido).toBe(false)
    expect(validaPartitaIva('0410464092').valido).toBe(false)
    expect(validaPartitaIva('00000000000').valido).toBe(false)
  })
})

describe('validateCheckDigit (calcolatore CF del gestionale)', () => {
  it('segue la stessa regola del server', () => {
    expect(validateCheckDigit('LRASFN01E25Z138I')).toBe(false)
    expect(validateCheckDigit('LRASFN01E25Z138J')).toBe(true)
    expect(validateCheckDigit('RSSMRA85T10A56NH')).toBe(true)
  })
})
