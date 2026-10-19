import { describe, it, expect } from 'vitest'
import { vociCambiate, richiedeNuovaFirma, decidiAzioneContratto } from './contrattoModifiche'

// 17/10/2026: fideiussori, estensione con cambio veicolo.
describe('contrattoModifiche', () => {
  it('aggiungere un fideiussore chiede la rifirma', () => {
    const prima = { garante_count: 0 }
    const dopo = { garante_count: 1, garante_1_nome_cognome: 'Mario Rossi', garante_1_codice_fiscale: 'RSSMRA80A01H501U' }
    const esito = decidiAzioneContratto(prima, dopo)
    expect(esito.voci).toContain('garanti')
    expect(esito.rifirma).toBe(true)
  })

  it('cambiare il codice fiscale del 3° fideiussore chiede la rifirma', () => {
    const prima = { garante_count: 3, garante_3_codice_fiscale: 'AAA' }
    const dopo = { garante_count: 3, garante_3_codice_fiscale: 'BBB' }
    expect(vociCambiate(prima, dopo)).toEqual(['garanti'])
  })

  it('il telefono del fideiussore non e\' una clausola firmata', () => {
    expect(vociCambiate({ garante_1_telefono: '1' }, { garante_1_telefono: '2' })).toEqual([])
  })

  it('estensione senza cambio veicolo resta ricondotta di default', () => {
    expect(richiedeNuovaFirma(['estensione'])).toBe(false)
  })

  it('estensione con cambio veicolo chiede la rifirma di default', () => {
    expect(richiedeNuovaFirma(['estensione', 'veicolo'])).toBe(true)
  })

  it('la direzione puo\' mettere Cambio veicolo su ricondotto', () => {
    expect(richiedeNuovaFirma(['estensione', 'veicolo'], { veicolo: 'ricondotto' })).toBe(false)
  })
})
