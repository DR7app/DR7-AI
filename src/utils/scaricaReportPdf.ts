// Scarica PDF dei Report: il PDF riporta quello che il report mostra a video,
// nello stesso ordine — titoli, schede KPI e OGNI tabella con TUTTE le righe
// (anche quelle nascoste dallo scroll interno). Si legge il DOM gia' reso,
// cosi' vale per tutti i report senza toccarli uno per uno.
// Pulsanti, campi, menu e grafici non vanno nel PDF; i filtri scelti
// (date, menu) finiscono in testa come "Filtri".

type Blocco =
  | { tipo: 'titolo'; testo: string; livello: number }
  | { tipo: 'testo'; testo: string }
  | { tipo: 'tabella'; head: string[][]; body: string[][]; foot: string[][]; annidata?: boolean; conDettaglio?: boolean }

// Colonne con i nomi dei clienti: tolte dal PDF quando si sceglie "senza nomi".
const COLONNA_NOME = /^(cliente|clienti|nome|nome cliente|cliente \/ nome|intestatario|customer)$/i
let senzaNomiInCorso = false

const TAG_ESCLUSI = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SVG', 'svg', 'CANVAS', 'SCRIPT', 'STYLE', 'OPTION', 'IMG', 'VIDEO'])

function escluso(el: Element): boolean {
  if (TAG_ESCLUSI.has(el.tagName)) return true
  if (el.getAttribute('role') === 'button') return true
  if (el.hasAttribute('data-pdf-skip')) return true
  if (senzaNomiInCorso && el.hasAttribute('data-pdf-nome')) return true
  if (el instanceof HTMLElement) {
    const st = window.getComputedStyle(el)
    if (st.display === 'none' || st.visibility === 'hidden') return true
  }
  return false
}

// jsPDF con i font standard copre il Latin-1 e l'euro: il resto si traduce
// o si toglie, altrimenti esce come caratteri spazzatura.
function pulisci(s: string): string {
  return s
    .replace(/[→➜➡]/g, '->')
    .replace(/[←]/g, '<-')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[…]/g, '...')
    .replace(/[•·]/g, '-')
    .replace(/[↑▲]/g, '+')
    .replace(/[↓▼]/g, '-')
    .replace(/[^\u0000-ÿ€]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Pezzi di testo visibili dentro un elemento, saltando pulsanti e campi. */
function pezzi(el: Element): string[] {
  const out: string[] = []
  const giro = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = pulisci(n.textContent || '')
      if (t) out.push(t)
      return
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return
    const e = n as Element
    if (escluso(e)) return
    e.childNodes.forEach(giro)
  }
  el.childNodes.forEach(giro)
  return out
}

// Dentro una cella, cio' che a video va a capo (nome del veicolo, riga delle
// date sotto) va a capo anche nel PDF, invece di finire tutto attaccato.
function testoCella(el: Element): string {
  const righe: string[] = []
  let corrente: string[] = []
  const aCapo = () => { if (corrente.length) { righe.push(corrente.join(' ')); corrente = [] } }
  const giro = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = pulisci(n.textContent || '')
      if (t) corrente.push(t)
      return
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return
    const e = n as Element
    if (escluso(e)) return
    const blocco = e instanceof HTMLElement && ['block', 'flex', 'grid', 'list-item'].includes(window.getComputedStyle(e).display)
    if (blocco) aCapo()
    e.childNodes.forEach(giro)
    if (blocco) aCapo()
  }
  el.childNodes.forEach(giro)
  aCapo()
  return righe.join('\n')
}

function riga(tr: Element): string[] {
  return espandi([tr], false)[0] || []
}

/**
 * Righe di una tabella come griglia vera: una cella su piu' colonne (colSpan)
 * o piu' righe (rowSpan) occupa tutte le sue caselle, cosi' le colonne restano
 * allineate. Nell'intestazione la cella larga si ripete sotto ogni colonna che
 * copre (serve per unire i due livelli: "NOLEGGI - Numero").
 */
function espandi(trs: Element[], ripeti: boolean): string[][] {
  const griglia: string[][] = []
  const occupate: boolean[][] = []
  trs.forEach((tr, r) => {
    griglia[r] = griglia[r] || []
    occupate[r] = occupate[r] || []
    let c = 0
    Array.from(tr.children).filter(x => !escluso(x)).forEach(cella => {
      while (occupate[r][c]) c++
      const testo = testoCella(cella)
      const cs = Math.max(1, Number((cella as HTMLTableCellElement).colSpan) || 1)
      const rs = Math.max(1, Number((cella as HTMLTableCellElement).rowSpan) || 1)
      for (let dr = 0; dr < rs; dr++) {
        const rr = r + dr
        griglia[rr] = griglia[rr] || []
        occupate[rr] = occupate[rr] || []
        for (let dc = 0; dc < cs; dc++) {
          griglia[rr][c + dc] = dr === 0 && (dc === 0 || ripeti) ? testo : ''
          occupate[rr][c + dc] = true
        }
      }
      c += cs
    })
  })
  return griglia.slice(0, trs.length).map(r => Array.from({ length: r.length }, (_, i) => r[i] ?? ''))
}

function righe(sezione: Element | null, intestazione = false): string[][] {
  if (!sezione) return []
  const trs = Array.from(sezione.querySelectorAll(':scope > tr')).filter(tr => !escluso(tr))
  const g = espandi(trs, intestazione)
  if (intestazione && g.length > 1) {
    // Piu' livelli di intestazione: una sola riga, i livelli uniti per colonna.
    const n = Math.max(...g.map(r => r.length))
    return [Array.from({ length: n }, (_, i) => {
      const parti: string[] = []
      g.forEach(r => { const t = (r[i] || '').trim(); if (t && !parti.includes(t)) parti.push(t) })
      return parti.join(' - ')
    })]
  }
  return g.filter(r => r.some(c => c !== ''))
}

/** Colonne vuote in tutta la tabella (di solito quella dei pulsanti): si tolgono, uguali per ogni pezzo. */
function maschera(tutte: string[][]): boolean[] {
  if (tutte.length === 0) return []
  const nCol = Math.max(...tutte.map(r => r.length))
  return Array.from({ length: nCol }, (_, i) => tutte.some(r => (r[i] || '') !== ''))
}

/**
 * Tabella, anche con righe che si aprono (es. Report Noleggio: sotto ogni
 * veicolo la tabella delle sue prenotazioni). La riga aperta non si schiaccia
 * in una cella: la tabella si spezza, sotto la riga del veicolo viene il suo
 * dettaglio (clienti, date, pagamento, importi), poi si riprende col veicolo dopo.
 */
function leggiTabella(t: HTMLTableElement, annidata: boolean): Blocco[] {
  const head = righe(t.tHead, true)
  const foot = righe(t.tFoot)
  const trs = Array.from(t.tBodies).flatMap(tb => Array.from(tb.querySelectorAll(':scope > tr'))).filter(tr => !escluso(tr))
  const conDettaglio = trs.some(tr => !!tr.querySelector('table'))
  const semplici = trs.filter(tr => !tr.querySelector('table')).map(riga)
  const piene = maschera([...head, ...semplici, ...foot])
  // Senza nomi: via la colonna Cliente/Nome (riconosciuta dall'intestazione).
  if (senzaNomiInCorso && head.length > 0) {
    head[head.length - 1].forEach((h, i) => { if (COLONNA_NOME.test(h.replace(/[^A-Za-z\u00C0-\u00FF /]+/g, ' ').replace(/\s+/g, ' ').trim())) piene[i] = false })
  }
  const taglia = (rs: string[][]) => rs.map(r => r.filter((_, i) => piene[i] !== false))

  const out: Blocco[] = []
  let pezzo: string[][] = []
  const chiudi = () => {
    if (pezzo.length === 0) return
    out.push({ tipo: 'tabella', head: taglia(head), body: taglia(pezzo), foot: [], annidata, conDettaglio })
    pezzo = []
  }
  for (const tr of trs) {
    if (tr.querySelector('table')) {
      chiudi()
      tr.querySelectorAll(':scope > td, :scope > th').forEach(td => {
        Array.from(td.children).forEach(c => raccogli(c, out, true))
      })
      continue
    }
    const r = riga(tr)
    if (r.some(c => c !== '')) pezzo.push(r)
  }
  // Senza righe aperte il totale resta attaccato alla tabella; con righe aperte
  // va in fondo, con le stesse colonne della tabella.
  if (!conDettaglio && foot.length > 0 && pezzo.length > 0) {
    out.push({ tipo: 'tabella', head: taglia(head), body: taglia(pezzo), foot: taglia(foot), annidata, conDettaglio })
    pezzo = []
  } else {
    chiudi()
    if (foot.length > 0) out.push({ tipo: 'tabella', head: taglia(head), body: [], foot: taglia(foot), annidata, conDettaglio })
  }
  if (out.length === 0 && head.length > 0) out.push({ tipo: 'tabella', head: taglia(head), body: [], foot: [], annidata })
  return out
}

function eGriglia(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false
  const st = window.getComputedStyle(el)
  const figli = Array.from(el.children).filter(c => !escluso(c))
  if (figli.length < 2) return false
  return st.display === 'grid' || (st.display === 'flex' && st.flexWrap === 'wrap')
}

function raccogli(el: Element, out: Blocco[], annidata = false) {
  if (escluso(el)) return
  if (el instanceof HTMLTableElement) {
    out.push(...leggiTabella(el, annidata))
    return
  }
  const m = /^H([1-4])$/.exec(el.tagName)
  if (m) {
    const t = pezzi(el).join(' ')
    if (t) out.push({ tipo: 'titolo', testo: t, livello: Number(m[1]) })
    return
  }
  if (!el.querySelector('table') && !el.querySelector('h1, h2, h3, h4')) {
    // Griglia di schede (KPI): una riga per scheda, etichetta | valore | nota.
    if (eGriglia(el)) {
      const body = Array.from(el.children)
        .filter(c => !escluso(c))
        .map(c => pezzi(c))
        .filter(p => p.length > 0)
        .map(p => [p[0], p[1] || '', p.slice(2).join(' ')])
      if (body.length > 0) {
        const conNota = body.some(r => r[2] !== '')
        out.push({ tipo: 'tabella', head: [], body: conNota ? body : body.map(r => r.slice(0, 2)), foot: [], annidata })
      }
      return
    }
    const t = pezzi(el).join(' ')
    if (t) out.push({ tipo: 'testo', testo: t })
    return
  }
  Array.from(el.children).forEach(c => raccogli(c, out, annidata))
}

function dataIt(v: string): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(v)
  if (!m) return v
  return m[3] ? `${m[3]}/${m[2]}/${m[1]}` : `${m[2]}/${m[1]}`
}

function filtri(root: Element): string {
  const out: string[] = []
  root.querySelectorAll('input, select').forEach(n => {
    if (n instanceof HTMLSelectElement) {
      const t = pulisci(n.options[n.selectedIndex]?.text || '')
      if (t) out.push(t)
    } else if (n instanceof HTMLInputElement) {
      if (['date', 'month', 'datetime-local'].includes(n.type) && n.value) out.push(dataIt(n.value))
      else if (n.type === 'search' || (n.type === 'text' && n.value && n.placeholder?.toLowerCase().includes('cerca'))) {
        if (n.value) out.push(`"${pulisci(n.value)}"`)
      }
    }
  })
  return out.join(' - ')
}

export interface OpzioniPdf {
  /** Periodo del report: finisce in testa al PDF e nel nome del file. null = tutto. undefined = report senza periodo. */
  periodo?: { from: string; to: string } | null
  /** true = nessun nome di cliente nel PDF. */
  senzaNomi?: boolean
}

function dataIt10(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export async function scaricaReportPdf(root: HTMLElement, opz: OpzioniPdf = {}) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])

  const blocchi: Blocco[] = []
  senzaNomiInCorso = !!opz.senzaNomi
  try {
    Array.from(root.children).forEach(c => raccogli(c, blocchi))
  } finally {
    senzaNomiInCorso = false
  }

  const primoTitolo = blocchi.find(b => b.tipo === 'titolo') as { testo: string } | undefined
  const titolo = primoTitolo?.testo || 'Report'
  const quando = new Date().toLocaleString('it-IT', {
    timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const f = filtri(root)

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const larg = doc.internal.pageSize.getWidth()
  const alt = doc.internal.pageSize.getHeight()
  const M = 12
  let y = M

  const spazio = (h: number) => {
    if (y + h > alt - M) { doc.addPage(); y = M }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fineTabella = () => ((doc as any).lastAutoTable?.finalY ?? y)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(titolo, M, y + 5)
  y += 9
  // 21/09/2026 (direzione): le date del periodo SEMPRE scritte sul report.
  if (opz.periodo !== undefined) {
    doc.setFontSize(12)
    const testoPeriodo = opz.periodo
      ? `Periodo: dal ${dataIt10(opz.periodo.from)} al ${dataIt10(opz.periodo.to)}`
      : 'Periodo: tutte le date'
    doc.text(testoPeriodo, M, y + 4)
    y += 7
  }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(110)
  doc.text(`Generato il ${quando}`, M, y + 3)
  y += 5
  if (f) {
    const righeF = doc.splitTextToSize(`Filtri: ${f}`, larg - 2 * M)
    doc.text(righeF, M, y + 3)
    y += righeF.length * 4
  }
  doc.setTextColor(0)
  y += 3

  let saltatoTitolo = false
  for (const b of blocchi) {
    if (b.tipo === 'titolo') {
      if (!saltatoTitolo && b.testo === titolo) { saltatoTitolo = true; continue }
      const size = b.livello <= 2 ? 13 : 11
      spazio(12)
      y += 3
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(size)
      doc.text(doc.splitTextToSize(b.testo, larg - 2 * M), M, y + 4)
      y += size === 13 ? 7 : 6
      doc.setFont('helvetica', 'normal')
    } else if (b.tipo === 'testo') {
      doc.setFontSize(9)
      const r = doc.splitTextToSize(b.testo, larg - 2 * M)
      spazio(r.length * 4 + 2)
      doc.text(r, M, y + 3)
      y += r.length * 4 + 2
    } else {
      spazio(12)
      // Dettaglio sotto una riga (prenotazioni del veicolo): rientrato e piu'
      // leggero, attaccato alla riga a cui appartiene.
      const rientro = b.annidata ? 8 : 0
      autoTable(doc, {
        startY: y,
        margin: { left: M + rientro, right: M },
        head: b.head.length ? b.head : undefined,
        body: b.body,
        foot: b.foot.length ? b.foot : undefined,
        showHead: 'everyPage',
        showFoot: 'lastPage',
        theme: 'grid',
        styles: { fontSize: b.annidata ? 7.5 : 8, cellPadding: 1.5, overflow: 'linebreak', textColor: 20 },
        headStyles: b.annidata
          ? { fillColor: [225, 225, 225], textColor: 30, fontStyle: 'bold' }
          : { fillColor: [30, 30, 30], textColor: 255, fontStyle: 'bold' },
        bodyStyles: b.conDettaglio ? { fontStyle: 'bold' } : {},
        footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 248, 248] },
      })
      y = fineTabella() + (b.annidata ? 4 : 2)
    }
  }

  const pagine = doc.getNumberOfPages()
  for (let i = 1; i <= pagine; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(130)
    const piede = opz.periodo ? `${titolo} - ${dataIt10(opz.periodo.from)} / ${dataIt10(opz.periodo.to)}` : titolo
    doc.text(`${piede} - pagina ${i} di ${pagine}`, larg - M, alt - 5, { align: 'right' })
  }

  const slug = titolo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const oggi = new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')
  const suffisso = opz.periodo
    ? (opz.periodo.from.slice(0, 7) === opz.periodo.to.slice(0, 7) && opz.periodo.from.endsWith('-01')
        ? opz.periodo.from.slice(0, 7)
        : `${dataIt10(opz.periodo.from).replace(/\//g, '-')}_${dataIt10(opz.periodo.to).replace(/\//g, '-')}`)
    : oggi
  doc.save(`${slug || 'report'}-${suffisso}.pdf`)
}

/**
 * Stesso PDF dei Report, ma da dati gia' pronti invece che dalla pagina:
 * titolo, periodo, riepilogo e una tabella completa. Usato dove la pagina
 * mostra solo una parte delle righe (es. DR7 Trust: le ultime 100).
 */
export async function scaricaTabellaPdf(opz: {
  titolo: string
  periodo: { from: string; to: string } | null
  riepilogo: Array<[string, string]>
  head: string[]
  body: string[][]
}) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const larg = doc.internal.pageSize.getWidth()
  const alt = doc.internal.pageSize.getHeight()
  const M = 12
  let y = M
  const titolo = pulisci(opz.titolo)
  const quando = new Date().toLocaleString('it-IT', {
    timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(titolo, M, y + 5)
  y += 9
  doc.setFontSize(12)
  doc.text(opz.periodo ? `Periodo: dal ${dataIt10(opz.periodo.from)} al ${dataIt10(opz.periodo.to)}` : 'Periodo: tutte le date', M, y + 4)
  y += 7
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(110)
  doc.text(`Generato il ${quando}`, M, y + 3)
  doc.setTextColor(0)
  y += 8

  if (opz.riepilogo.length > 0) {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      body: opz.riepilogo.map(([k, v]) => [pulisci(k), pulisci(v)]),
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 1.8, textColor: 20 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
      tableWidth: 140,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 6
  }

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [opz.head.map(pulisci)],
    body: opz.body.length ? opz.body.map(r => r.map(c => pulisci(c))) : [[{ content: 'Nessuna riga nel periodo', colSpan: opz.head.length }]],
    showHead: 'everyPage',
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.5, overflow: 'linebreak', textColor: 20 },
    headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 248, 248] },
  })

  const pagine = doc.getNumberOfPages()
  for (let i = 1; i <= pagine; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(130)
    const piede = opz.periodo ? `${titolo} - ${dataIt10(opz.periodo.from)} / ${dataIt10(opz.periodo.to)}` : titolo
    doc.text(`${piede} - pagina ${i} di ${pagine}`, larg - M, alt - 5, { align: 'right' })
  }
  const slug = titolo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const suffisso = opz.periodo
    ? (opz.periodo.from.slice(0, 7) === opz.periodo.to.slice(0, 7) && opz.periodo.from.endsWith('-01')
        ? opz.periodo.from.slice(0, 7)
        : `${dataIt10(opz.periodo.from).replace(/\//g, '-')}_${dataIt10(opz.periodo.to).replace(/\//g, '-')}`)
    : 'tutto'
  doc.save(`${slug || 'export'}-${suffisso}.pdf`)
}
