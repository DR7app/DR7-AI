/**
 * genTestiCatalogo.mjs — l'elenco di TUTTI i testi del sito, pagina per pagina.
 *
 * L'onglet Sito copre con un editor dedicato le pagine migrate a
 * `siteCopy.ts`. Le altre (account, partner, login, conferme, listini)
 * restavano "nel codice": per cambiare una parola serviva uno sviluppatore.
 *
 * Questo script legge il repo del sito e raccoglie ogni stringa che passa da
 * `useTranslation().t(...)`:
 *   - `t('Sign_In')`   -> chiave `k:Sign_In`, testi presi da translations.ts
 *   - `t({ it, en })`  -> chiave `s:<impronta dell'italiano>`
 * L'impronta e' la stessa FNV-1a di Sito/utils/testiSito.ts: se le due
 * implementazioni divergono, gli override smettono di applicarsi.
 *
 * Le stringhe con interpolazione (`${...}`) restano fuori: non sono un testo
 * fisso e riscriverle dal gestionale romperebbe i valori dentro.
 *
 *   node scripts/genTestiCatalogo.mjs           rigenera
 *   node scripts/genTestiCatalogo.mjs --check   fallisce se disallineato
 */
import fs from 'fs'
import path from 'path'

const SITE = process.env.DR7_SITE_PATH || path.join(process.env.HOME, 'Sito')
const OUT = path.join(process.cwd(), 'src/pages/admin/components/sito/testiCatalogo.ts')
const MAP = path.join(process.cwd(), 'src/pages/admin/components/sito/sitoSiteMap.ts')
const CARTELLE = ['pages', 'components', 'sections', 'layouts']

if (!fs.existsSync(SITE)) {
    console.error(`[testi] repo del sito non trovato in ${SITE} (DR7_SITE_PATH per cambiarlo)`)
    process.exit(1)
}

// ─── impronta: identica a Sito/utils/testiSito.ts ────────────────────────
function chiaveTesto(testoIt) {
    const s = String(testoIt).trim().replace(/\s+/g, ' ')
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return 's:' + (h >>> 0).toString(16).padStart(8, '0')
}

// ─── quali file appartengono a quale schermata ───────────────────────────
const mapSrc = fs.readFileSync(MAP, 'utf8')
const schermate = [...mapSrc.matchAll(/\{ id: '([^']+)'[^\n]*?file: '([^']+)'/g)]
    .map(m => ({ id: m[1], file: m[2] }))

/** La schermata il cui `file` combacia meglio con questo percorso. */
function schermataPer(rel) {
    let vinta = null
    for (const s of schermate) {
        const f = s.file.replace(/\/$/, '')
        if (rel === f || (f.endsWith('/') === false && rel.startsWith(f + '/')) || rel.startsWith(s.file)) {
            if (!vinta || f.length > vinta.file.length) vinta = s
        }
    }
    return vinta ? vinta.id : null
}

// ─── dizionario translations.ts ──────────────────────────────────────────
const dizSrc = fs.readFileSync(path.join(SITE, 'translations.ts'), 'utf8')
const dizionario = {}
for (const m of dizSrc.matchAll(/^\s*([A-Za-z0-9_]+)\s*:\s*\{\s*en:\s*(".*?"|'.*?')\s*,\s*it:\s*(".*?"|'.*?')\s*\}/gm)) {
    dizionario[m[1]] = { en: sciogli(m[2]), it: sciogli(m[3]) }
}

function sciogli(letterale) {
    const corpo = letterale.slice(1, -1)
    return corpo.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n')
}

// ─── scansione dei file ──────────────────────────────────────────────────
function fileDelSito() {
    const out = []
    const visita = (dir) => {
        for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
            if (voce.name === 'node_modules' || voce.name === 'dist' || voce.name.startsWith('.')) continue
            const p = path.join(dir, voce.name)
            if (voce.isDirectory()) visita(p)
            else if (/\.tsx?$/.test(voce.name)) out.push(p)
        }
    }
    for (const c of CARTELLE) {
        const d = path.join(SITE, c)
        if (fs.existsSync(d)) visita(d)
    }
    const app = path.join(SITE, 'App.tsx')
    if (fs.existsSync(app)) out.push(app)
    return out
}

/** Legge un letterale di stringa a partire dall'apice iniziale. */
function leggiStringa(src, i) {
    const apice = src[i]
    if (apice !== "'" && apice !== '"' && apice !== '`') return null
    let out = ''
    let j = i + 1
    while (j < src.length) {
        const c = src[j]
        if (c === '\\') { out += src[j + 1] === 'n' ? '\n' : src[j + 1]; j += 2; continue }
        if (c === apice) return { valore: out, fine: j + 1 }
        if (apice === '`' && c === '$' && src[j + 1] === '{') return null // interpolata
        out += c
        j++
    }
    return null
}

/** Estrae `it:` / `en:` da un oggetto `t({ ... })` bilanciato. */
function leggiOggetto(src, apertura) {
    let profondita = 0
    let j = apertura
    for (; j < src.length; j++) {
        const c = src[j]
        if (c === '{') profondita++
        else if (c === '}') { profondita--; if (profondita === 0) break }
        else if (c === "'" || c === '"' || c === '`') {
            const s = leggiStringa(src, j)
            if (s) { j = s.fine - 1; continue }
            return null
        }
    }
    if (profondita !== 0) return null
    const corpo = src.slice(apertura, j + 1)
    const valori = {}
    for (const lingua of ['it', 'en']) {
        const m = corpo.match(new RegExp(`(^|[{,\\s])${lingua}\\s*:\\s*`))
        if (!m) return null
        const inizio = m.index + m[0].length
        const s = leggiStringa(corpo, inizio)
        if (!s) return null
        valori[lingua] = s.valore
    }
    return valori
}

const voci = new Map()

for (const file of fileDelSito()) {
    const rel = path.relative(SITE, file)
    const src = fs.readFileSync(file, 'utf8')
    const schermata = schermataPer(rel)

    // t('Chiave') / t("Chiave")
    for (const m of src.matchAll(/\bt\(\s*(['"])([A-Za-z0-9_]+)\1\s*\)/g)) {
        const nome = m[2]
        const voce = dizionario[nome]
        if (!voce) continue
        const chiave = 'k:' + nome
        if (!voci.has(chiave)) voci.set(chiave, { chiave, it: voce.it, en: voce.en, file: rel, schermata })
    }

    // t({ it: '...', en: '...' })
    for (const m of src.matchAll(/\bt\(\s*\{/g)) {
        const valori = leggiOggetto(src, m.index + m[0].length - 1)
        if (!valori || !valori.it) continue
        const chiave = chiaveTesto(valori.it)
        if (!voci.has(chiave)) voci.set(chiave, { chiave, it: valori.it, en: valori.en || '', file: rel, schermata })
    }
}

const elenco = [...voci.values()].sort((a, b) => (a.schermata || 'zzz').localeCompare(b.schermata || 'zzz') || a.it.localeCompare(b.it))

const testo = `// GENERATO da scripts/genTestiCatalogo.mjs — non modificare a mano.
// Rigenera con: npm run testi:gen
//
// Ogni voce e' una stringa che il sito mostra passando da useTranslation().
// L'onglet Sito le elenca per schermata e ne salva la riscrittura in
// centralina_pro_config.config.site_copy.testi.

export interface VoceTesto {
    /** \`k:<voce del dizionario>\` oppure \`s:<impronta del testo italiano>\`. */
    chiave: string
    /** Testo come sta nel codice del sito, in italiano. */
    it: string
    /** Testo come sta nel codice del sito, in inglese. */
    en: string
    /** File del repo Sito da cui arriva. */
    file: string
    /** Schermata dell'onglet Sito (null = componente condiviso). */
    schermata: string | null
}

export const TESTI_CATALOGO: VoceTesto[] = ${JSON.stringify(elenco, null, 4)}

/** Le stringhe di una schermata, piu' quelle dei componenti condivisi che usa. */
export function testiDiSchermata(id: string): VoceTesto[] {
    return TESTI_CATALOGO.filter(v => v.schermata === id)
}

export const TESTI_TOTALI = TESTI_CATALOGO.length
`

if (process.argv.includes('--check')) {
    const attuale = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
    if (attuale !== testo) {
        console.error('[testi] catalogo disallineato dal sito: esegui `npm run testi:gen`')
        process.exit(1)
    }
    console.log(`[testi] OK — ${elenco.length} testi allineati con ${SITE}`)
} else {
    fs.writeFileSync(OUT, testo)
    const senzaSchermata = elenco.filter(v => !v.schermata).length
    console.log(`[testi] scritto ${OUT}`)
    console.log(`[testi] ${elenco.length} testi, ${elenco.length - senzaSchermata} associati a una schermata, ${senzaSchermata} in componenti condivisi`)
}
