/**
 * checkSitoSiteMap.mjs — l'onglet Sito deve restare la fotografia di dr7.app.
 *
 * Due modi silenziosi di rompere il tab, entrambi gia' capitati:
 *   1. un editor scritto ma mai montato  -> campi salvati in DB e
 *      irraggiungibili (era il caso di PaymentEditor / pagina /pay);
 *   2. una voce in mappa senza editor montato -> pannello vuoto.
 * Qui si verifica la corrispondenza esatta fra i due elenchi.
 *
 *   node scripts/checkSitoSiteMap.mjs
 */
import fs from 'fs'
import path from 'path'

const root = process.cwd()
const tab = fs.readFileSync(path.join(root, 'src/pages/admin/components/SitoTab.tsx'), 'utf8')
const map = fs.readFileSync(path.join(root, 'src/pages/admin/components/sito/sitoSiteMap.ts'), 'utf8')

const mounted = new Set([...tab.matchAll(/section === '([a-z0-9-]+)'/g)].map(m => m[1]))
const mapped = new Set([...map.matchAll(/editor: '([a-z0-9-]+)'/g)].map(m => m[1]))

const unreachable = [...mounted].filter(x => !mapped.has(x)).sort()
const empty = [...mapped].filter(x => !mounted.has(x)).sort()

if (unreachable.length) {
    console.error('Editor montati ma assenti dalla mappa (nessuno puo\' aprirli):')
    for (const x of unreachable) console.error(`  - ${x}`)
}
if (empty.length) {
    console.error('Voci di mappa senza editor montato (pannello vuoto):')
    for (const x of empty) console.error(`  - ${x}`)
}
if (unreachable.length || empty.length) process.exit(1)

// solo le voci di SITO_SCREENS: quelle di SITO_AREAS non hanno `area:`.
const screens = [...map.matchAll(/^\s*\{ id: '[^\n]*\barea: '/gm)].length
console.log(`[sito] OK — ${screens} schermate mappate, ${mounted.size} editor tutti raggiungibili`)
