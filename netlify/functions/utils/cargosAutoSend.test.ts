// 01/10/2026: cargos-auto-send risolve i luoghi dalla tabella ufficiale
// cargos_luoghi (qui finta, righe copiate dalla produzione) e non piu' da un
// elenco di ~30 comuni scritto a mano. Questi sono i 7 luoghi di nascita veri
// che tenevano ferme in coda 57 comunicazioni.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => {
  // codice, nome, provincia, valido_dal, valido_al — come in produzione.
  const righe = [
    ['100000100', 'ITALIA', 'ES', '1800-01-01', null],
    ['100000239', 'SPAGNA', 'ES', '1800-01-01', null],
    ['420091037', 'LANUSEI', 'NU', '1800-01-01', null],
    ['420092105', 'QUARTUCCIU', 'CA', '1800-01-01', null],
    ['420092536', 'GHILARZA', 'CA', '1800-01-01', '1974-07-15'],
    ['420095021', 'GHILARZA', 'OR', '1974-07-16', null],
    ['420092578', 'SIRIS', 'CA', '1800-01-01', '1974-07-15'],
    ['420095061', 'SIRIS', 'OR', '1974-07-16', null],
    ['420092037', 'MARACALAGONIS', 'CA', '1800-01-01', null],
    ['420092055', 'SAN GAVINO MONREALE', 'CA', '1800-01-01', null],
    ['420092009', 'CAGLIARI', 'CA', '1800-01-01', null],
  ].map(([codice, nome, provincia, valido_dal, valido_al]) => ({ codice, nome, provincia, valido_dal, valido_al }))
  return { righe, guasto: false, letture: 0 }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (tabella: string) => ({
      select: () => ({
        in: async (colonna: string, valori: string[]) => {
          db.letture++
          if (db.guasto) return { data: null, error: { message: 'tabella non raggiungibile' } }
          if (tabella === 'cargos_luoghi_nomi') {
            return { data: db.righe.filter(r => valori.includes(r.nome as string)).map(r => ({ nome_norm: r.nome, codice: r.codice })), error: null }
          }
          if (tabella === 'cargos_luoghi') return { data: db.righe.filter(r => valori.includes(r[colonna as 'codice'] as string)), error: null }
          return { data: [], error: null }
        },
      }),
    }),
  }),
}))
vi.mock('./systemControl', () => ({
  registraEvento: vi.fn(), accodaOperazione: vi.fn(), chiudiOperazione: vi.fn(), segnaChiamata: vi.fn(), funzioneFerma: vi.fn(),
}))

// Il risolutore vive a livello di modulo (cache fra invocazioni): un modulo nuovo per test.
async function carica() {
  vi.resetModules()
  return (await import('../cargos-auto-send')).luoghiPerInvio
}

beforeEach(() => { db.guasto = false; db.letture = 0 })

// Dati come nelle schede cliente ferme in coda (persone inventate).
const casi = [
  { luogo: 'Lanusei', prov: 'OG', nato: '2005-08-23', residenza: 'LANUSEI', codice: '420091037' },
  { luogo: 'Quartucciu', prov: 'CA', nato: '2002-10-22', residenza: 'Quartucciu', codice: '420092105' },
  { luogo: 'Ghilarza', prov: 'OR', nato: '1998-02-16', residenza: 'Ghilarza', codice: '420095021' },
  { luogo: 'Siris', prov: 'OR', nato: '1976-07-05', residenza: 'Siris', codice: '420095061' },
  { luogo: 'Maracalagonis', prov: 'Ca', nato: '1993-07-06', residenza: 'Maracalagonis', codice: '420092037' },
  { luogo: 'san gavino monreale', prov: 'SU', nato: '1975-02-12', residenza: 'Cagliari', codice: '420092055' },
  { luogo: 'España', prov: 'Gi', nato: '1982-10-11', residenza: 'Cagliari', codice: '100000239', nazione: 'Spagna' },
]

describe('cargos-auto-send: luogo di nascita dalla tabella ufficiale', () => {
  it.each(casi)('$luogo -> $codice', async ({ luogo, prov, nato, residenza, codice, nazione }) => {
    const luoghiPerInvio = await carica()
    const c = { tipo_cliente: 'persona_fisica', luogo_nascita: luogo, provincia_nascita: prov, data_nascita: nato, citta_residenza: residenza, nazione: nazione || 'Italia' }
    const l = await luoghiPerInvio(c, {})
    expect(l.errori).toEqual([])
    expect(l.nascita).toBe(codice)
    expect(l.cittadinanza).toBe(nazione ? '100000239' : '100000100')
    expect(l.rilascioDocumento).not.toBe('')
  })

  it('Ghilarza prima del 1974 (provincia di Cagliari): codice di allora', async () => {
    const luoghiPerInvio = await carica()
    const l = await luoghiPerInvio({ luogo_nascita: 'GHILARZA', data_nascita: '1960-01-01', citta_residenza: 'Ghilarza', nazione: 'Italia' }, {})
    expect(l.nascita).toBe('420092536')
  })

  it('luogo sconosciuto: rifiutato con messaggio chiaro, nessun codice', async () => {
    const luoghiPerInvio = await carica()
    const l = await luoghiPerInvio({ luogo_nascita: 'Atlantide', data_nascita: '1990-01-01', citta_residenza: 'Cagliari', nazione: 'Italia' }, {})
    expect(l.nascita).toBe('')
    expect(l.errori.join()).toMatch(/Luogo di nascita: "Atlantide" non risulta nella tabella ufficiale CARGOS/)
  })

  it('"Italia" come luogo di nascita: rifiutato, serve il comune', async () => {
    const luoghiPerInvio = await carica()
    const l = await luoghiPerInvio({ luogo_nascita: 'Italia', data_nascita: '1999-09-16', citta_residenza: 'Cagliari', nazione: 'Italia', codice_fiscale: 'RSSMRA99P16B354X' }, {})
    expect(l.nascita).toBe('')
    expect(l.errori.join()).toMatch(/serve il comune di nascita/)
  })

  it('luogo di rilascio del documento introvabile: rifiutato prima di chiamare CARGOS', async () => {
    const luoghiPerInvio = await carica()
    const l = await luoghiPerInvio({ luogo_nascita: 'Lanusei', data_nascita: '2005-08-23', citta_residenza: 'Zona Industriale', nazione: 'Italia' }, {})
    expect(l.nascita).toBe('420091037')
    expect(l.errori.join()).toMatch(/luogo di rilascio del documento/)
  })

  it('tabella non raggiungibile: si torna all elenco storico, mai un codice inventato', async () => {
    db.guasto = true
    const luoghiPerInvio = await carica()
    const lanusei = await luoghiPerInvio({ luogo_nascita: 'Lanusei', data_nascita: '2005-08-23', citta_residenza: 'Cagliari', nazione: 'Italia' }, {})
    expect(db.letture).toBeGreaterThan(0)
    expect(lanusei.nascita).toBe('420091037') // c'e' nell'elenco storico
    const quartucciu = await luoghiPerInvio({ luogo_nascita: 'Quartucciu', data_nascita: '2002-10-22', citta_residenza: 'Cagliari', nazione: 'Italia' }, {})
    expect(quartucciu.nascita).toBe('')
    expect(quartucciu.errori.join()).toMatch(/Quartucciu/)
  })
})
