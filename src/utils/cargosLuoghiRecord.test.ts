import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { leggiTabellaLuoghi, nomiDiRicerca, RisolutoreLuoghi, type RigaLuogoCargos } from './luoghiCargos'
import { luoghiRecordCargos, testiLuoghiCliente } from './cargosLuoghiRecord'

const tabella = leggiTabellaLuoghi(readFileSync(join(__dirname, '__fixtures__/cargosLuoghi.fixture.dat'), 'utf8'))
const indice = new Map<string, RigaLuogoCargos[]>()
for (const r of tabella) for (const n of nomiDiRicerca(r.nome)) indice.set(n, [...(indice.get(n) || []), r])
const cerca = async (nomi: string[]) => new Map(nomi.filter(n => indice.has(n)).map(n => [n, indice.get(n)!] as const))

// Il comportamento PRIMA del 26/09/2026, riprodotto alla lettera.
const VECCHIO_ELENCO: Record<string, string> = {
  'CAGLIARI': '420092009', 'SASSARI': '420090064', 'NUORO': '420091051',
  'ORISTANO': '420092555', "QUARTU SANT'ELENA": '420092051', 'OLBIA': '420090047',
  'ALGHERO': '420090003', 'CARBONIA': '420092012', 'IGLESIAS': '420092033',
  'SELARGIUS': '420092068', 'MONSERRATO': '420092109', 'VILLACIDRO': '420092092',
  'SANLURI': '420092057', 'LANUSEI': '420091037',
  'ROMA': '412058091', 'MILANO': '403015146', 'TORINO': '401001272',
  'NAPOLI': '415063049', 'FIRENZE': '409048017', 'BOLOGNA': '408037006',
  'PALERMO': '419082053', 'GENOVA': '407010025', 'BARI': '416072006',
  'CATANIA': '419087015', 'VENEZIA': '405027042',
  'ITALIA': '100000100', 'ITALY': '100000100', 'FRANCIA': '100000215', 'FRANCE': '100000215',
  'GERMANIA': '100000216', 'GERMANY': '100000216',
}
const vecchio = (t: unknown) => VECCHIO_ELENCO[String(t || '').toUpperCase().trim()] || ''
/* eslint-disable @typescript-eslint/no-explicit-any */
const vecchiRecord = (c: any) => ({
  nascita: vecchio(c.luogo_nascita),
  cittadinanza: vecchio(c.nazionalita || 'ITALIA'),
  residenza: vecchio(c.citta || ''),
})

// Clienti realistici (dati inventati, luoghi veri).
const CF_ITA = 'RSSMRA80A01B354X'
const clienti: { nome: string; c: any; nascita: string; residenza: string; cittadinanza: string }[] = [
  { nome: 'Cagliari', c: { luogo_nascita: 'Cagliari', data_nascita: '1985-03-02', citta_residenza: 'Cagliari', provincia_residenza: 'CA', nazione: 'Italia', codice_fiscale: CF_ITA }, nascita: '420092009', residenza: '420092009', cittadinanza: '100000100' },
  { nome: "Quartu Sant'Elena", c: { luogo_nascita: "Quartu Sant'Elena", data_nascita: '1990-01-01', citta_residenza: "Quartu Sant'Elena", nazione: 'Italia' }, nascita: '420092051', residenza: '420092051', cittadinanza: '100000100' },
  { nome: 'Quartu S. Elena', c: { luogo_nascita: 'Quartu S. Elena', data_nascita: '1990-01-01', citta_residenza: 'Quartu S. Elena', nazione: 'Italia' }, nascita: '420092051', residenza: '420092051', cittadinanza: '100000100' },
  { nome: 'Sanluri', c: { luogo_nascita: 'Sanluri', data_nascita: '1975-05-05', citta_residenza: 'Sanluri', provincia_residenza: 'SU', nazione: 'Italia' }, nascita: '420092057', residenza: '420092057', cittadinanza: '100000100' },
  { nome: 'Quartucciu', c: { luogo_nascita: 'Quartucciu', data_nascita: '1988-08-08', citta_residenza: 'Quartucciu', nazione: 'Italia' }, nascita: '420092105', residenza: '420092105', cittadinanza: '100000100' },
  { nome: 'Sant’Antioco', c: { luogo_nascita: 'Sant’Antioco', data_nascita: '1980-02-02', citta_residenza: 'Sant’Antioco', nazione: 'Italia' }, nascita: '420092063', residenza: '420092063', cittadinanza: '100000100' },
  { nome: 'nato in Francia', c: { luogo_nascita: 'Francia', data_nascita: '1992-02-02', citta_residenza: 'Cagliari', nazione: 'Francia' }, nascita: '100000215', residenza: '420092009', cittadinanza: '100000215' },
  { nome: 'Bolzano', c: { luogo_nascita: 'Bolzano', data_nascita: '1979-09-09', citta_residenza: 'Bolzano', nazione: 'Italia' }, nascita: '404021008', residenza: '404021008', cittadinanza: '100000100' },
  { nome: 'Oristano 1970', c: { luogo_nascita: 'Oristano', data_nascita: '1970-06-01', citta_residenza: 'Oristano', nazione: 'Italia' }, nascita: '420092555', residenza: '420095038', cittadinanza: '100000100' },
  { nome: 'Oristano 1980', c: { luogo_nascita: 'Oristano', data_nascita: '01/06/1980', citta_residenza: 'Oristano', nazione: 'Italia' }, nascita: '420095038', residenza: '420095038', cittadinanza: '100000100' },
]

async function risolutore(clientiDaCaricare: any[]) {
  const r = new RisolutoreLuoghi(cerca)
  await r.precarica(clientiDaCaricare.flatMap(c => testiLuoghiCliente(c, {})))
  return r
}

describe('record CARGOS: nuovo contro vecchio', () => {
  it.each(clienti)('$nome -> codici ufficiali', async ({ c, nascita, residenza, cittadinanza }) => {
    const r = await risolutore([c])
    const n = luoghiRecordCargos(r, c, {})
    expect(n.errori).toEqual([])
    expect(n.nascita).toBe(nascita)
    expect(n.residenza).toBe(residenza)
    expect(n.cittadinanza).toBe(cittadinanza)
  })

  it('nessun caso che funzionava cambia codice, tranne Oristano (codice soppresso nel 1974)', async () => {
    for (const { nome, c } of clienti) {
      const r = await risolutore([c])
      const n = luoghiRecordCargos(r, c, {})
      const v = vecchiRecord(c)
      if (v.nascita && nome !== 'Oristano 1980') expect(n.nascita, nome).toBe(v.nascita)
      if (v.cittadinanza) expect(n.cittadinanza, nome).toBe(nome === 'nato in Francia' ? '100000215' : v.cittadinanza)
      // Il vecchio campo 27 leggeva `citta` (vuota per le persone): ora c'e' la residenza.
      expect(v.residenza, nome).toBe('')
    }
  })

  it('prima i comuni fuori elenco bloccavano, ora passano', async () => {
    for (const nome of ['Quartucciu', 'Quartu S. Elena', 'Sant’Antioco']) {
      expect(vecchio(nome)).toBe('')
    }
  })
})

describe('blocchi (mai un codice inventato)', () => {
  it('luogo di nascita omonimo senza provincia', async () => {
    const c = { luogo_nascita: 'San Teodoro', data_nascita: '1990-01-01', nazione: 'Italia' }
    const n = luoghiRecordCargos(await risolutore([c]), c, {})
    expect(n.nascita).toBe('')
    expect(n.errori.join()).toMatch(/Luogo di nascita.*ME o NU/)
  })
  it('omonimo con provincia di nascita: passa', async () => {
    const c = { luogo_nascita: 'San Teodoro', provincia_nascita: 'OT', data_nascita: '1990-01-01', nazione: 'Italia' }
    expect(luoghiRecordCargos(await risolutore([c]), c, {}).nascita).toBe('420091076')
  })
  it('luogo di nascita mancante', async () => {
    const c = { data_nascita: '1990-01-01', nazione: 'Italia' }
    expect(luoghiRecordCargos(await risolutore([c]), c, {}).errori).toContain('Luogo di nascita mancante')
  })
  it('codice catastale al posto del luogo', async () => {
    const c = { luogo_nascita: 'H118', nazione: 'Italia' }
    expect(luoghiRecordCargos(await risolutore([c]), c, {}).errori.join()).toMatch(/codice catastale/)
  })
  it('cittadinanza vuota: italiana solo se il CF lo dice', async () => {
    const ita = { luogo_nascita: 'Cagliari', codice_fiscale: CF_ITA }
    expect(luoghiRecordCargos(await risolutore([ita]), ita, {}).cittadinanza).toBe('100000100')
    // Nato in Italia senza CF (es. prenotazione senza scheda cliente): come prima, ITALIA.
    const natoInItalia = { luogo_nascita: 'Cagliari' }
    expect(luoghiRecordCargos(await risolutore([natoInItalia]), natoInItalia, {}).cittadinanza).toBe('100000100')
    const natoAllEstero = { luogo_nascita: 'Francia' }
    expect(luoghiRecordCargos(await risolutore([natoAllEstero]), natoAllEstero, {}).errori).toContain('Cittadinanza mancante')
    const estero = { luogo_nascita: 'Francia', codice_fiscale: 'RSSMRA80A01Z110X' }
    expect(luoghiRecordCargos(await risolutore([estero]), estero, {}).errori).toContain('Cittadinanza mancante')
  })
  it('residenza non riconosciuta: avviso, non blocco (prima era sempre vuota)', async () => {
    const c = { luogo_nascita: 'Cagliari', citta_residenza: 'Atlantide', nazione: 'Italia' }
    const n = luoghiRecordCargos(await risolutore([c]), c, {})
    expect(n.errori).toEqual([])
    expect(n.residenza).toBe('')
    expect(n.avvisi.join()).toMatch(/Comune di residenza/)
  })
  it('azienda: il luogo del rappresentante non blocca', async () => {
    const c = { tipo_cliente: 'azienda', metadata: { rappresentante: { luogo_nascita: 'Atlantide' } } }
    const n = luoghiRecordCargos(await risolutore([c]), c, {})
    expect(n.errori).toEqual([])
    expect(n.cittadinanza).toBe('100000100')
  })
})

describe('rilascio documento e patente', () => {
  it('ente al posto del luogo ("MIT-UCO") -> comune di residenza', async () => {
    const c = { luogo_nascita: 'Cagliari', citta_residenza: 'Sanluri', nazione: 'Italia', patente_rilasciata_da: 'MIT-UCO' }
    const n = luoghiRecordCargos(await risolutore([c]), c, {})
    expect(n.rilascioPatente).toBe('420092057')
    expect(n.rilascioDocumento).toBe('420092057')
  })
  it('luogo di rilascio documento indicato', async () => {
    const c = { luogo_nascita: 'Cagliari', citta_residenza: 'Sanluri', nazione: 'Italia', luogo_rilascio_documento: 'Quartucciu' }
    expect(luoghiRecordCargos(await risolutore([c]), c, {}).rilascioDocumento).toBe('420092105')
  })
})

describe('secondo guidatore', () => {
  it('luoghi risolti, mai bloccanti', async () => {
    const bd = { second_driver: { luogo_nascita: 'Quartucciu', data_nascita: '1990-01-01', nazionalita: 'italiana' } }
    const c = { luogo_nascita: 'Cagliari', nazione: 'Italia' }
    const r = new RisolutoreLuoghi(cerca)
    await r.precarica(testiLuoghiCliente(c, bd))
    const n = luoghiRecordCargos(r, c, bd)
    expect(n.nascita2).toBe('420092105')
    expect(n.cittadinanza2).toBe('100000100')
    expect(n.patente2).toBe('420092105')
    expect(n.errori).toEqual([])
  })
})
