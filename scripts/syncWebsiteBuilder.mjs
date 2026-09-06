#!/usr/bin/env node
/**
 * syncWebsiteBuilder.mjs — tiene identici i file condivisi tra i due repo.
 *
 * Il Website Builder disegna le pagine con lo STESSO codice nel gestionale
 * (anteprima) e sul sito pubblico. Se le due copie divergono, l'anteprima
 * comincia a mentire: e' il guaio gia' visto con i default dell'onglet
 * Sito (1063 campi su 1272 fuori posto).
 *
 *   npm run wb:sync     copia i file dal gestionale al sito
 *   npm run wb:check     esce con errore se le copie sono diverse
 *
 * La sorgente e' SEMPRE il gestionale: si modifica li'.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const qui = dirname(fileURLToPath(import.meta.url))
const ADMIN = resolve(qui, '..')
const SITO = process.env.DR7_SITO_PATH || join(homedir(), 'Sito')

const FILE = [
  'wbSchema.ts',
  'wbStyle.ts',
  'wbData.ts',
  'WbBlockRenderer.tsx',
]

const sorgente = (f) => join(ADMIN, 'src/pages/admin/components/website/shared', f)
const destinazione = (f) => join(SITO, 'components/website', f)

const check = process.argv.includes('--check')

if (!existsSync(SITO)) {
  console.error(`[wb] repo del sito non trovato in ${SITO}.`)
  console.error('     Imposta DR7_SITO_PATH se sta altrove.')
  process.exit(1)
}

mkdirSync(join(SITO, 'components/website'), { recursive: true })

let diversi = 0
for (const f of FILE) {
  const src = readFileSync(sorgente(f), 'utf8')
  const dst = existsSync(destinazione(f)) ? readFileSync(destinazione(f), 'utf8') : null
  if (src === dst) {
    console.log(`[wb] ${f}: identico`)
    continue
  }
  diversi += 1
  if (check) {
    console.error(`[wb] ${f}: DIVERSO tra gestionale e sito`)
  } else {
    writeFileSync(destinazione(f), src)
    console.log(`[wb] ${f}: copiato nel sito`)
  }
}

if (check && diversi > 0) {
  console.error(`\n[wb] ${diversi} file condivisi non allineati. Esegui: npm run wb:sync`)
  process.exit(1)
}
if (!check) console.log(`\n[wb] ${diversi === 0 ? 'niente da copiare' : `${diversi} file aggiornati nel sito`}.`)
