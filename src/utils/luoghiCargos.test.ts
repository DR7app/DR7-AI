import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  leggiTabellaLuoghi, nomiDiRicerca, normalizzaLuogo, risolviLuogo, RisolutoreLuoghi,
  DESTINAZIONI_ALIAS, spiegaLuogo, dataDaTesto, type RigaLuogoCargos, type CercaLuoghi,
} from './luoghiCargos'

// Estratto della Tabella 1 ufficiale CARGOS (V_COMUNI_STATI), stesso formato.
const tabella = leggiTabellaLuoghi(readFileSync(join(__dirname, '__fixtures__/cargosLuoghi.fixture.dat'), 'utf8'))

function cercaDaTabella(righe: RigaLuogoCargos[]): CercaLuoghi {
  const indice = new Map<string, RigaLuogoCargos[]>()
  for (const r of righe) for (const n of nomiDiRicerca(r.nome)) indice.set(n, [...(indice.get(n) || []), r])
  return async (nomi) => {
    const out = new Map<string, RigaLuogoCargos[]>()
    for (const n of nomi) if (indice.has(n)) out.set(n, indice.get(n)!)
    return out
  }
}
const cerca = cercaDaTabella(tabella)
const codice = async (testo: string, opts = {}) => {
  const e = await risolviLuogo(cerca, testo, opts)
  return e?.esito === 'trovato' ? e.codice : e?.esito
}

describe('normalizzaLuogo', () => {
  it('accenti, apostrofi tipografici, punteggiatura', () => {
    expect(normalizzaLuogo('Sant’Antioco')).toBe('SANT ANTIOCO')
    expect(normalizzaLuogo("  quartu  sant'elena ")).toBe('QUARTU SANT ELENA')
    expect(normalizzaLuogo('Città di Castello')).toBe('CITTA DI CASTELLO')
  })
})

describe('risolviLuogo — i comuni che prima davano "codice ISTAT mancante"', () => {
  it.each([
    ['Sanluri', '420092057'],
    ['Quartucciu', '420092105'],
    ['Assemini', '420092003'],
    ['Sant’Antioco', '420092063'],
    ["Sant'Antioco", '420092063'],
    ['S. Antioco', '420092063'],
    ['San Sperate', '420092059'],
    ["Quartu Sant'Elena", '420092051'],
    ['Quartu S. Elena', '420092051'],
    ['QUARTU S.ELENA', '420092051'],
    ['quartu sant elena', '420092051'],
    ['Cagliari (CA)', '420092009'],
    ['Cagliari, CA', '420092009'],
    ['Sanluri SU', '420092057'],
    ['09025 Sanluri', '420092057'],
    ['Bolzano', '404021008'],
    ['Roma', '412058091'],
  ])('%s -> %s', async (testo, atteso) => {
    expect(await codice(testo)).toBe(atteso)
  })

  it('la provincia scritta con le sigle nuove sarde non scarta un comune unico', async () => {
    expect(await codice('Sanluri', { provincia: 'SU' })).toBe('420092057')
    expect(await codice('Quartucciu', { provincia: 'CA' })).toBe('420092105')
  })
})

describe('omonimi: mai indovinare', () => {
  it.each(['San Teodoro', 'Samone', 'Livo', 'Peglio'])('%s senza provincia e ambiguo', async (nome) => {
    const e = await risolviLuogo(cerca, nome)
    expect(e?.esito).toBe('ambiguo')
  })
  it('la provincia scioglie l omonimia', async () => {
    expect(await codice('San Teodoro', { provincia: 'ME' })).toBe('419083090')
    expect(await codice('San Teodoro', { provincia: 'NU' })).toBe('420091076')
    // Gallura (OT): nella tabella CARGOS San Teodoro e' ancora sotto NU.
    expect(await codice('San Teodoro (OT)')).toBe('420091076')
  })
  it('Castro: quello di Lecce esiste solo dal 07/05/1975', async () => {
    expect(await codice('Castro', { alla: new Date(1970, 0, 1, 12) })).toBe('403016065')
    expect((await risolviLuogo(cerca, 'Castro', { alla: new Date(1990, 0, 1, 12) }))?.esito).toBe('ambiguo')
  })
  it('il messaggio elenca le province', async () => {
    const e = (await risolviLuogo(cerca, 'San Teodoro'))!
    expect(spiegaLuogo('Luogo di nascita', 'San Teodoro', e)).toMatch(/ME o NU/)
  })
})

describe('Oristano: codice diverso prima e dopo il 16/07/1974', () => {
  it('nato nel 1970 -> codice storico', async () => {
    expect(await codice('Oristano', { alla: new Date(1970, 5, 1, 12) })).toBe('420092555')
  })
  it('nato nel 1980 -> codice attuale', async () => {
    expect(await codice('Oristano', { alla: new Date(1980, 5, 1, 12) })).toBe('420095038')
  })
  it('residenza (senza data) -> codice attuale', async () => {
    expect(await codice('Oristano')).toBe('420095038')
  })
})

describe('stati e nazionalita', () => {
  it.each([
    ['Italia', '100000100'], ['italiana', '100000100'], ['ITALY', '100000100'],
    ['Francia', '100000215'], ['France', '100000215'], ['francese', '100000215'],
    ['Germania', '100000216'], ['tedesca', '100000216'],
    ['UK', '100000219'], ['Inghilterra', '100000219'], ['britannico', '100000219'],
    ['USA', '100000536'], ['Stati Uniti', '100000536'],
    ['Svizzera', '100000241'], ['Olanda', '100000232'], ['Russia', '100000245'],
    ["costa d'avorio", '100000404'],
  ])('%s -> %s', async (testo, atteso) => {
    expect(await codice(testo, { soloStati: true })).toBe(atteso)
  })

  it('ogni alias punta a un nome che esiste nella tabella ufficiale', () => {
    const nomi = new Set(tabella.flatMap(r => nomiDiRicerca(r.nome)))
    for (const d of DESTINAZIONI_ALIAS) expect(nomi.has(d), d).toBe(true)
  })
  it('San Marino come cittadinanza e lo stato', async () => {
    expect(await codice('San Marino', { soloStati: true })).toBe('100000236')
  })
})

describe('casi da non inventare', () => {
  it('codice catastale al posto del nome', async () => {
    const e = await risolviLuogo(cerca, 'H118')
    expect(e?.esito).toBe('non_trovato')
    expect(spiegaLuogo('Luogo di nascita', 'H118', e!)).toMatch(/codice catastale/)
  })
  it('nome inesistente', async () => {
    expect((await risolviLuogo(cerca, 'Atlantide'))?.esito).toBe('non_trovato')
  })
  it('vuoto', async () => {
    expect((await risolviLuogo(cerca, ''))?.esito).toBe('non_trovato')
  })
  it('database non raggiungibile -> null, non un codice', async () => {
    expect(await risolviLuogo(async () => null, 'Sanluri')).toBeNull()
  })
})

describe('RisolutoreLuoghi (cache per i record)', () => {
  it('dopo il precarica risolve in modo sincrono', async () => {
    const r = new RisolutoreLuoghi(cerca)
    await r.precarica(['Sanluri', 'Quartucciu', 'Oristano'])
    expect(r.tabellaDisponibile).toBe(true)
    expect(r.codice('Sanluri')).toBe('420092057')
    expect(r.codice('Oristano', { alla: dataDaTesto('1970-06-01') })).toBe('420092555')
    expect(r.codice('San Teodoro')).toBe('') // non precaricato: mai inventato
  })
  it('tabella vuota -> elenco storico, come prima (Oristano corretto)', async () => {
    const r = new RisolutoreLuoghi(async () => new Map())
    await r.precarica(['Cagliari'])
    expect(r.tabellaDisponibile).toBe(false)
    expect(r.codice('Cagliari')).toBe('420092009')
    expect(r.codice('Oristano')).toBe('420095038')
    expect(r.codice('Quartucciu')).toBe('')
  })
  it('database irraggiungibile -> elenco storico', async () => {
    const r = new RisolutoreLuoghi(async () => null)
    await r.precarica(['Cagliari'])
    expect(r.codice('CAGLIARI')).toBe('420092009')
  })
})

describe('dataDaTesto', () => {
  it('iso e italiano', () => {
    expect(dataDaTesto('1970-06-01')?.getFullYear()).toBe(1970)
    expect(dataDaTesto('01/06/1980')?.getMonth()).toBe(5)
    expect(dataDaTesto('')).toBeNull()
  })
})
