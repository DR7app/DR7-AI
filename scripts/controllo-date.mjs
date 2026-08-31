#!/usr/bin/env node
/**
 * Controllo date e fuso orario.
 *
 * PERCHE' ESISTE (31/08/2026). Nel portafoglio del cliente si leggeva
 * "Noleggio BMW ... - 2026-09-03T15:30:00.000Z to 2026-09-04T14:00:00.000Z":
 * formato ISO grezzo E ora UTC invece delle 17:30 di Roma. Nello stesso giro
 * sono usciti sei punti con l'offset "+02:00" scritto a mano (l'ora legale:
 * d'inverno Roma sta a +01:00, quindi da novembre a marzo erano sbagliati di
 * un'ora).
 *
 * Un errore di fuso non si vede leggendo il codice: si vede a novembre, in
 * produzione, su un contratto. Quindi lo cerca una macchina.
 *
 *   node scripts/controllo-date.mjs            # questo repo
 *   node scripts/controllo-date.mjs ~/Sito     # anche il sito
 *
 * Esce con codice 1 se trova qualcosa: si puo' agganciare alla CI.
 *
 * REGOLE (tutte e tre nate da un bug vero):
 *  1. niente offset scritto a mano: l'ora legale la decide la data, non chi
 *     scrive il codice. Usare `romeDateFromParts` / `romeIsoFromParts`
 *     (gestionale) o `dataRoma` / `isoRoma` (sito).
 *  2. niente orologio a 12 ore: l'Italia scrive 17:30, mai 5:30 PM.
 *  3. niente data mostrata senza lingua: `toLocaleDateString()` senza locale
 *     segue la lingua del BROWSER, quindi su un computer in inglese diventa
 *     8/31/2026. Sempre 'it-IT'.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

const RADICI = process.argv.slice(2)
if (RADICI.length === 0) RADICI.push(process.cwd())

const ESTENSIONI = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])
const SALTA_CARTELLE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.netlify', 'coverage'])
/** File di appoggio lasciati accanto all'originale: non finiscono in produzione. */
const SALTA_FILE = /\.(platefix|dupdetect|debugclean|final|debug\d*|unused\d*|barcolor|transparent|dayheader|holidaydot|todayfix)\d*$/

const REGOLE = [
  {
    nome: 'offset scritto a mano',
    // "+02:00" / "+01:00" dentro una stringa. L'unico posto dove ci puo'
    // stare e' la funzione che CALCOLA l'offset dalla data.
    cerca: /['"`+][^'"`\n]*\+0[12]:00/,
    spiega: "l'ora legale dipende dalla data: usa romeIsoFromParts / isoRoma",
  },
  {
    nome: 'orologio a 12 ore',
    cerca: /hour12:\s*true/,
    spiega: 'in Italia si scrive 17:30, mai 5:30 PM',
  },
  {
    nome: 'data senza lingua',
    // toLocaleDateString() / toLocaleTimeString() senza argomenti su una data.
    cerca: /\.toLocale(Date|Time)String\(\s*\)/,
    spiega: "senza 'it-IT' segue la lingua del browser: su un PC in inglese diventa 8/31/2026",
  },
  {
    nome: 'data ISO incollata in un testo',
    // "... ${x.pickup_date} ..." dentro una stringa mostrata/salvata, o una
    // concatenazione SQL con ->>'pickup_date'.
    cerca: /->>'(pickup_date|dropoff_date|appointment_date)'\s*\|\|/,
    spiega: 'formatta in ora di Roma (to_char(... AT TIME ZONE \'Europe/Rome\', \'DD/MM/YYYY HH24:MI\'))',
    estensioni: ['.sql'],
  },
]

function* file(dir) {
  for (const voce of readdirSync(dir)) {
    if (SALTA_CARTELLE.has(voce)) continue
    const p = join(dir, voce)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) { yield* file(p); continue }
    const ext = extname(p)
    if (!ESTENSIONI.has(ext) && ext !== '.sql') continue
    if (SALTA_FILE.test(p)) continue
    yield p
  }
}

let trovati = 0
for (const radice of RADICI) {
  for (const percorso of file(radice)) {
    const ext = extname(percorso)
    let righe
    try { righe = readFileSync(percorso, 'utf8').split('\n') } catch { continue }
    righe.forEach((riga, i) => {
      // Una riga marcata resta com'e': serve per la funzione che l'offset lo calcola.
      if (/controllo-date:\s*ok/.test(riga)) return
      // I commenti spiegano il problema, non lo contengono.
      const nuda = riga.trim()
      if (nuda.startsWith('//') || nuda.startsWith('*') || nuda.startsWith('/*') || nuda.startsWith('--')) return
      for (const regola of REGOLE) {
        const soloPer = regola.estensioni || ESTENSIONI
        const vale = Array.isArray(soloPer) ? soloPer.includes(ext) : soloPer.has(ext)
        if (!vale) continue
        if (!regola.cerca.test(riga)) continue
        trovati++
        console.log(`${relative(process.cwd(), percorso)}:${i + 1}  [${regola.nome}] ${regola.spiega}`)
        console.log(`    ${riga.trim().slice(0, 140)}`)
      }
    })
  }
}

if (trovati === 0) {
  console.log('Date e fuso: nessun problema trovato.')
  process.exit(0)
}
console.log(`\n${trovati} punto/i da sistemare.`)
process.exit(1)
