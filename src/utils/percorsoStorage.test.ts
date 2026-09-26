import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { nomeFileSicuro, percorsoStorage } from './percorsoStorage'

describe('nomeFileSicuro', () => {
  it('il nome del 26/09/2026 diventa una chiave accettata dallo storage', () => {
    expect(nomeFileSicuro('Contestazione Danni Lamborghini Huracán tecnica .pdf'))
      .toBe('Contestazione_Danni_Lamborghini_Huracan_tecnica.pdf')
  })

  it('accenti, emoji, barre e virgolette', () => {
    expect(nomeFileSicuro('Perché è così.pdf')).toBe('Perche_e_cosi.pdf')
    expect(nomeFileSicuro('😀.png')).toBe('file.png')
    expect(nomeFileSicuro('a/b\\c.pdf')).toBe('a_b_c.pdf')
    expect(nomeFileSicuro('"preventivo" l\'ultimo.pdf')).toBe('preventivo_l_ultimo.pdf')
    expect(nomeFileSicuro('foto patente')).toBe('foto_patente')
  })

  it('vuoto o solo simboli: mai una chiave vuota', () => {
    expect(nomeFileSicuro('')).toBe('file')
    expect(nomeFileSicuro('   ')).toBe('file')
    expect(nomeFileSicuro('.env')).toBe('file.env')
  })

  it('nomi lunghi accorciati tenendo l estensione', () => {
    const r = nomeFileSicuro(`${'x'.repeat(300)}.pdf`)
    expect(r.length).toBeLessThanOrEqual(80)
    expect(r.endsWith('.pdf')).toBe(true)
  })

  it('identico su un nome gia sicuro: le chiavi dei file salvati non cambiano', () => {
    for (const n of ['DR7-2026-0001.pdf', 'master_contract.pdf', '1790437298510_x.pdf', 'logo_contratto.png',
      '3f2b1c4e-9a7d-4c1b-8e2f-0a1b2c3d4e5f', 'contratto_estensione_abc_1790437298510.pdf']) {
      expect(nomeFileSicuro(n)).toBe(n)
    }
  })

  it('idempotente', () => {
    for (const n of ['Huracán tecnica .pdf', '😀.png', 'a b/c', `${'é'.repeat(200)}.jpeg`]) {
      const una = nomeFileSicuro(n)
      expect(nomeFileSicuro(una)).toBe(una)
    }
  })
})

describe('percorsoStorage', () => {
  it('rende sicuro ogni segmento e non lascia // o / iniziali', () => {
    expect(percorsoStorage('documents', '1790_Huracán tecnica .pdf')).toBe('documents/1790_Huracan_tecnica.pdf')
    expect(percorsoStorage('/a//b/', 'c d.jpg')).toBe('a/b/c_d.jpg')
    expect(percorsoStorage('fornitori/abc-123/2026/09/aruba-FT_1-uuid.pdf')).toBe('fornitori/abc-123/2026/09/aruba-FT_1-uuid.pdf')
  })
})

// ── Guardia: nessun caricamento senza percorso sicuro ──────────────────────
const RADICE = join(__dirname, '..', '..')
const CARTELLE = ['src', 'netlify/functions', 'scan-watcher']
const ESCLUSE = /node_modules|\/dist\/|\.test\.|\.spec\./

function fileSorgente(dir: string): string[] {
  const out: string[] = []
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    if (ESCLUSE.test(p)) continue
    if (statSync(p).isDirectory()) out.push(...fileSorgente(p))
    else if (/\.(ts|tsx|js)$/.test(nome)) out.push(p)
  }
  return out
}

describe('guardia storage', () => {
  it('ogni file che carica sullo storage passa da percorsoStorage o nomeFileSicuro', () => {
    const scoperti = CARTELLE
      .flatMap(c => fileSorgente(join(RADICE, c)))
      .filter(p => /\.upload\(/.test(readFileSync(p, 'utf8')))
      .filter(p => !/percorsoStorage|nomeFileSicuro/.test(readFileSync(p, 'utf8')))
      .map(p => relative(RADICE, p))
    expect(
      scoperti,
      'Il 26/09/2026 un documento chiamato "Contestazione Danni Lamborghini Huracán tecnica " non si ' +
      'riusciva a firmare: il nome finiva nella chiave del file, lo storage la rifiutava e la firma falliva ' +
      'dopo l OTP. Costruisci il percorso con percorsoStorage() di src/utils/percorsoStorage.ts in:',
    ).toEqual([])
  })

  it('la copia in scan-watcher/index.js si comporta come l originale', () => {
    const sorgente = readFileSync(join(RADICE, 'scan-watcher/index.js'), 'utf8')
    const inizio = sorgente.indexOf('function nomeFileSicuro(')
    expect(inizio).toBeGreaterThan(-1)
    // corpo della funzione: fino alla prima graffa chiusa a inizio riga
    const fine = sorgente.indexOf('\n}\n', inizio)
    const copia = new Function(`${sorgente.slice(inizio, fine + 2)}; return nomeFileSicuro`)() as (n: string, m?: number) => string
    for (const n of ['Contestazione Danni Lamborghini Huracán tecnica .pdf', '😀.png', '', 'a/b c', `${'x'.repeat(300)}.pdf`, 'DR7-2026-0001.pdf']) {
      expect(copia(n)).toBe(nomeFileSicuro(n))
    }
  })
})
