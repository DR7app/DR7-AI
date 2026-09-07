/**
 * sitoGaps.mjs — cosa di dr7.app NON si riesce ancora a modificare dall'onglet.
 *
 *   node scripts/sitoGaps.mjs
 *
 * Non fa fallire la build: e' un rapporto, non un divieto. Serve a sapere
 * quanto e' onesto l'onglet, perche' il modo peggiore di rompere un CMS e'
 * mostrare una casella che non cambia niente sul sito.
 *
 * Riporta due cose:
 *   1. CAMPI SENZA CASELLA — esistono nei default del sito ma nell'onglet
 *      non c'e' nessun input: il testo si vede su dr7.app e non si tocca.
 *   2. CAMPI SCRITTI NELLA LINGUA SBAGLIATA — il sito legge il campo con
 *      `bilingual()`, che preferisce `_it`/`_en`, mentre l'onglet scrive il
 *      vecchio campo unilingue. L'operatore modifica, salva, e il sito
 *      resta identico. Questo e' un bug, non una mancanza.
 */
import fs from 'fs'
import path from 'path'
import os from 'os'

const ADMIN = process.cwd()
const SITO = process.env.SITO_REPO || path.join(os.homedir(), 'Sito')
const tab = fs.readFileSync(path.join(ADMIN, 'src/pages/admin/components/SitoTab.tsx'), 'utf8')
const gen = fs.readFileSync(path.join(ADMIN, 'src/pages/admin/components/sito/siteCopyDefaults.ts'), 'utf8')

// ─── Come l'onglet raggiunge un campo ────────────────────────────────────
// Non basta cercare `copy.campo`: certi editor passano la chiave come
// stringa (`update('pickup_locations', …)`) o la ricavano da un elenco di
// literal. Contarli come mancanti darebbe falsi allarmi.
const reachable = new Set([
    ...[...tab.matchAll(/copy\.([a-zA-Z0-9_]+)/g)].map(m => m[1]),
    ...[...tab.matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]),
])

// Alcuni editor scrivono la coppia con un gabarit: `[`${key}_${lang}`]`, dove
// `key` viene da un'unione di literal. Senza questa regola quei campi
// risulterebbero "senza casella" pur essendo perfettamente modificabili.
const bilingualByTemplate = new Set()
if (/\[`\$\{key\}_\$\{lang\}`\]|`\$\{key\}_\$\{lang\}`/.test(tab)) {
    for (const m of tab.matchAll(/^\s*type\s+\w+\s*=\s*((?:'[a-z0-9_]+'\s*\|?\s*)+)$/gm)) {
        for (const k of m[1].matchAll(/'([a-z0-9_]+)'/g)) {
            bilingualByTemplate.add(k[1])
            reachable.add(`${k[1]}_it`)
            reachable.add(`${k[1]}_en`)
        }
    }
}

/** Chiavi di primo livello di ogni costante INITIAL_*. */
function topLevelKeys(constName) {
    const re = new RegExp(`^export const ${constName}[^=]*=\\s*\\{`, 'm')
    const m = re.exec(gen)
    if (!m) return []
    const start = gen.indexOf('{', m.index)
    let depth = 0, i = start, str = null, esc = false
    for (; i < gen.length; i++) {
        const c = gen[i]
        if (str) { if (esc) { esc = false; continue } if (c === '\\') { esc = true; continue } if (c === str) str = null; continue }
        if (c === "'" || c === '"' || c === '`') { str = c; continue }
        if (c === '{') depth++
        else if (c === '}') { depth--; if (!depth) { i++; break } }
    }
    return [...gen.slice(start, i).matchAll(/^  ([a-zA-Z0-9_]+):/gm)].map(x => x[1])
}

const constNames = [...gen.matchAll(/^export const (INITIAL_[A-Z0-9_]+)/gm)].map(m => m[1])

let missingTotal = 0
const missingReport = []
for (const c of constNames) {
    const keys = topLevelKeys(c)
    // Un campo unilingue ereditato non e' "mancante" se la sua coppia
    // `_it`/`_en` e' modificabile: resta solo come ripiego per i vecchi
    // override salvati in centralina_pro_config.
    const miss = keys.filter(k =>
        !reachable.has(k) && !(reachable.has(`${k}_it`) && reachable.has(`${k}_en`)))
    if (miss.length) { missingTotal += miss.length; missingReport.push([c, miss]) }
}

// ─── Campi che il sito legge in bilingue ─────────────────────────────────
const siteFiles = []
const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue
        const f = path.join(d, e.name)
        if (e.isDirectory()) walk(f)
        else if (/\.tsx?$/.test(e.name)) siteFiles.push(f)
    }
}
for (const d of ['pages', 'components', 'utils', 'hooks', 'sections', 'layouts', 'contexts', 'services', 'data']) {
    const p = path.join(SITO, d)
    if (fs.existsSync(p)) walk(p)
}
// I file alla radice del sito contano: App.tsx legge gli interruttori
// dell'Aspetto (chatbot, popup), e senza questa riga risultavano caselle
// "che non cambiano niente" pur essendo perfettamente collegate.
for (const e of fs.readdirSync(SITO, { withFileTypes: true })) {
    if (e.isFile() && /\.tsx?$/.test(e.name)) siteFiles.push(path.join(SITO, e.name))
}
const readBilingual = new Set()
const readDirect = new Set()
for (const f of siteFiles) {
    const s = fs.readFileSync(f, 'utf8')
    for (const m of s.matchAll(/bilingual(?:List)?\(\s*[A-Za-z_$][\w$.]*\s*,\s*'([a-z0-9_]+)'/g)) readBilingual.add(m[1])
    if (!f.endsWith('siteCopy.ts')) {
        for (const m of s.matchAll(/copy\.([a-z0-9_]+)(?![_a-z0-9])/g)) readDirect.add(m[1])
    }
}

const writtenUnilingual = new Set([...tab.matchAll(/\bupdate[A-Za-z]*\(\s*'([a-z0-9_]+)'/g)].map(m => m[1]))
const wrongLang = [...writtenUnilingual].filter(f =>
    readBilingual.has(f) &&
    // scritto col gabarit `_it`/`_en`: la chiave base compare solo come
    // argomento dell'helper, non come campo scritto
    !bilingualByTemplate.has(f) &&
    // se una pagina lo legge anche in diretto, il campo unilingue serve ancora
    !readDirect.has(f) &&
    new RegExp(`^\\s+${f}_it:`, 'm').test(gen)
).sort()

console.log('CAMPI SCRITTI NELLA LINGUA SBAGLIATA (modifiche senza effetto sul sito)')
if (!wrongLang.length) console.log('  nessuno')
for (const f of wrongLang) console.log('  -', f)

console.log(`\nCAMPI SENZA CASELLA NELL'ONGLET: ${missingTotal}`)
for (const [c, miss] of missingReport) {
    console.log(`  ${c.replace('INITIAL_', '')}: ${miss.join(', ')}`)
}

// ─── 3. Caselle che non cambiano niente ──────────────────────────────────
// Il contrario del punto 2: la casella nell'onglet c'e', ma sul sito NESSUNA
// pagina legge quella chiave. L'operatore scrive, salva, e dr7.app resta
// identico — e non ha modo di accorgersene. Sono i resti delle pagine
// rifatte: la pagina cambia, la casella no.
//
// Una chiave conta come letta anche se il sito usa il nome BASE (`hero_h2`
// per `hero_h2_it`), perche' e' cosi' che funziona `bilingual()`.
const testoSito = siteFiles
    .filter(f => !f.endsWith('siteCopy.ts'))
    .map(f => fs.readFileSync(f, 'utf8'))
    .join('\n')

const chiaviDefault = new Set(
    [...gen.matchAll(/^\s{2}([a-z][a-zA-Z0-9_]*)\??:\s*(?:string|number|boolean|string\[\])/gm)].map(m => m[1]),
)
const morte = [...chiaviDefault]
    .filter(k => {
        if (!reachable.has(k)) return false            // nessuna casella: e' il punto 2
        const base = k.replace(/_(it|en)$/, '')
        return !testoSito.includes(k) && !testoSito.includes(base)
    })
    .sort()

console.log(`\nCASELLE CHE NON CAMBIANO NIENTE (il sito non legge la chiave): ${morte.length}`)
for (const k of morte) console.log('  -', k)

if (wrongLang.length) process.exitCode = 1
