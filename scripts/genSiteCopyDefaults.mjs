/**
 * genSiteCopyDefaults.mjs — genera i default del CMS Sito dal sito live.
 *
 * L'onglet admin > Sito mostrava valori scritti a mano, copiati una volta
 * da `Sito/utils/siteCopy.ts` e mai piu' risincronizzati: al 26/08/2026
 * 1063 campi su 1272 non corrispondevano piu' a dr7.app (in gran parte
 * caselle vuote nel gestionale dove il sito mostra testo reale).
 *
 * Questo script elimina la duplicazione: legge il file del sito, estrae le
 * interfacce e le costanti `DEFAULT_*` e le riscrive in
 * `src/pages/admin/components/sito/siteCopyDefaults.ts` come `INITIAL_*`.
 * SitoTab importa da li'. Rigenerare dopo ogni modifica ai testi del sito:
 *
 *   node scripts/genSiteCopyDefaults.mjs            # rigenera
 *   node scripts/genSiteCopyDefaults.mjs --check    # fallisce se disallineato
 *
 * Sorgente: variabile d'ambiente SITO_REPO, default ~/Sito.
 */
import fs from 'fs'
import path from 'path'
import os from 'os'

const SITO = process.env.SITO_REPO || path.join(os.homedir(), 'Sito')
const SRC = path.join(SITO, 'utils', 'siteCopy.ts')
const OUT = path.join(process.cwd(), 'src/pages/admin/components/sito/siteCopyDefaults.ts')
const CHECK = process.argv.includes('--check')

if (!fs.existsSync(SRC)) {
    console.error(`[gen] sorgente non trovata: ${SRC}\n     imposta SITO_REPO se il repo del sito e' altrove.`)
    process.exit(2)
}

const src = fs.readFileSync(SRC, 'utf8')
const lines = src.split('\n')

// Un'istruzione top-level inizia a colonna 0 con una parola chiave TS.
const DECL = /^(export\s+)?(declare\s+)?(interface|type|const|let|var|function|async\s+function|enum|class|abstract\s+class)\s/
const isDecl = (l) => DECL.test(l)
// Righe che non aprono una dichiarazione ma chiudono il file logico
const isImport = (l) => /^import\s|^export\s+\{|^export\s+\*/.test(l)

/** Raccoglie i blocchi top-level con il commento che li precede. */
function collectBlocks() {
    const blocks = []
    let i = 0
    let pendingComment = []
    while (i < lines.length) {
        const line = lines[i]
        if (isImport(line)) { pendingComment = []; i++; continue }
        // commento top-level: lo tengo in sospeso per la prossima dichiarazione
        if (/^\s*\/\//.test(line) || /^\s*\/\*/.test(line)) {
            const start = i
            if (/^\s*\/\*/.test(line)) {
                while (i < lines.length && !/\*\//.test(lines[i])) i++
                i++
            } else {
                while (i < lines.length && /^\s*\/\//.test(lines[i])) i++
            }
            pendingComment = lines.slice(start, i)
            continue
        }
        if (line.trim() === '') { i++; continue }
        if (!isDecl(line)) { pendingComment = []; i++; continue }
        // dichiarazione: leggo fino alla prossima dichiarazione top-level
        const start = i
        i++
        while (i < lines.length && !isDecl(lines[i]) && !isImport(lines[i])) {
            // fermati su un commento top-level che introduce la dichiarazione seguente
            if ((/^\s*\/\//.test(lines[i]) || /^\s*\/\*/.test(lines[i])) && /^[/ ]/.test(lines[i][0] || '')) {
                // guarda avanti: se dopo il commento c'e' una dichiarazione, chiudi qui
                let j = i
                if (/^\s*\/\*/.test(lines[j])) { while (j < lines.length && !/\*\//.test(lines[j])) j++; j++ }
                else { while (j < lines.length && /^\s*\/\//.test(lines[j])) j++ }
                while (j < lines.length && lines[j].trim() === '') j++
                if (j < lines.length && isDecl(lines[j])) break
            }
            i++
        }
        let body = lines.slice(start, i)
        // togli le righe vuote in coda
        while (body.length && body[body.length - 1].trim() === '') body.pop()
        blocks.push({ head: line, comment: pendingComment, body })
        pendingComment = []
    }
    return blocks
}

const blocks = collectBlocks()

const KEEP_TYPE = /^(export\s+)?(interface|type)\s/
const KEEP_CONST = /^(export\s+)?const\s+DEFAULT_[A-Z0-9_]*\s*[:=]/

const kept = blocks.filter(b => KEEP_TYPE.test(b.head) || KEEP_CONST.test(b.head))
const types = kept.filter(b => KEEP_TYPE.test(b.head))
const consts = kept.filter(b => KEEP_CONST.test(b.head))

if (!consts.length) {
    console.error('[gen] nessuna costante DEFAULT_* estratta — formato del sorgente cambiato?')
    process.exit(2)
}

/** DEFAULT_X -> INITIAL_X, con gli alias storici gia' usati da SitoTab. */
const ALIAS = { DEFAULT_JET_SEARCH_RESULTS: 'INITIAL_JET_SEARCH' }
const renameConst = (name) => ALIAS[name] || name.replace(/^DEFAULT_/, 'INITIAL_')

const constNames = consts.map(b => b.head.match(/const\s+(DEFAULT_[A-Z0-9_]*)/)[1])
const renameAll = (text) => {
    let out = text
    for (const n of constNames) out = out.replace(new RegExp(`\\b${n}\\b`, 'g'), renameConst(n))
    return out
}

const render = (b) => {
    const comment = b.comment.length ? b.comment.join('\n') + '\n' : ''
    let body = b.body.join('\n')
    if (!/^export\s/.test(body)) body = 'export ' + body
    return comment + renameAll(body)
}

const header = `/**
 * siteCopyDefaults.ts — GENERATO AUTOMATICAMENTE. NON MODIFICARE A MANO.
 *
 * Sorgente: Sito/utils/siteCopy.ts (repo del sito live dr7.app).
 * Rigenera con:  node scripts/genSiteCopyDefaults.mjs
 * Verifica con:  node scripts/genSiteCopyDefaults.mjs --check
 *
 * Ogni \`DEFAULT_X\` del sito diventa \`INITIAL_X\` qui: cosi' l'onglet Sito
 * parte esattamente dai testi che dr7.app mostra quando non c'e' override
 * salvato in centralina_pro_config. Modificare questi valori a mano fa
 * ricomparire il disallineamento che questo file esiste per eliminare.
 *
 * Sezioni generate: ${consts.length} — interfacce: ${types.length}
 */

`

const out = header + [...types.map(render), ...consts.map(render)].join('\n\n') + '\n'

fs.mkdirSync(path.dirname(OUT), { recursive: true })
const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null

if (CHECK) {
    if (prev !== out) {
        console.error('[gen] siteCopyDefaults.ts e\' disallineato dal sito. Esegui: node scripts/genSiteCopyDefaults.mjs')
        process.exit(1)
    }
    console.log(`[gen] OK — ${consts.length} sezioni allineate con ${SRC}`)
    process.exit(0)
}

fs.writeFileSync(OUT, out)
console.log(`[gen] scritto ${OUT}`)
console.log(`[gen] ${types.length} interfacce, ${consts.length} costanti INITIAL_*`)
console.log(`[gen] ${consts.map(b => renameConst(b.head.match(/const\s+(DEFAULT_[A-Z0-9_]*)/)[1])).join(', ')}`)
