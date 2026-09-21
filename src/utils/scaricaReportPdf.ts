// Scarica PDF dei Report: il PDF riporta quello che il report mostra a video,
// nello stesso ordine — titoli, schede KPI e OGNI tabella con TUTTE le righe
// (anche quelle nascoste dallo scroll interno). Si legge il DOM gia' reso,
// cosi' vale per tutti i report senza toccarli uno per uno.
// Pulsanti, campi, menu e grafici non vanno nel PDF; i filtri scelti
// (date, menu) finiscono in testa come "Filtri".

type Blocco =
  | { tipo: 'titolo'; testo: string; livello: number }
  | { tipo: 'testo'; testo: string }
  | { tipo: 'tabella'; head: string[][]; body: string[][]; foot: string[][] }

const TAG_ESCLUSI = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SVG', 'svg', 'CANVAS', 'SCRIPT', 'STYLE', 'OPTION', 'IMG', 'VIDEO'])

function escluso(el: Element): boolean {
  if (TAG_ESCLUSI.has(el.tagName)) return true
  if (el.getAttribute('role') === 'button') return true
  if (el.hasAttribute('data-pdf-skip')) return true
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

function testoCella(el: Element): string {
  return pezzi(el).join(' ')
}

function righe(sezione: Element | null): string[][] {
  if (!sezione) return []
  return Array.from(sezione.querySelectorAll(':scope > tr'))
    .map(tr => Array.from(tr.children).filter(c => !escluso(c)).map(testoCella))
    .filter(r => r.some(c => c !== ''))
}

function leggiTabella(t: HTMLTableElement): Blocco | null {
  const head = righe(t.tHead)
  const body = Array.from(t.tBodies).flatMap(b => righe(b))
  const foot = righe(t.tFoot)
  if (head.length === 0 && body.length === 0) return null
  // Colonne vuote ovunque (di solito quella dei pulsanti) si tolgono.
  const tutte = [...head, ...body, ...foot]
  const nCol = Math.max(...tutte.map(r => r.length))
  const piene = Array.from({ length: nCol }, (_, i) => tutte.some(r => (r[i] || '') !== ''))
  const taglia = (rs: string[][]) => rs.map(r => r.filter((_, i) => piene[i]))
  return { tipo: 'tabella', head: taglia(head), body: taglia(body), foot: taglia(foot) }
}

function eGriglia(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false
  const st = window.getComputedStyle(el)
  const figli = Array.from(el.children).filter(c => !escluso(c))
  if (figli.length < 2) return false
  return st.display === 'grid' || (st.display === 'flex' && st.flexWrap === 'wrap')
}

function raccogli(el: Element, out: Blocco[]) {
  if (escluso(el)) return
  if (el instanceof HTMLTableElement) {
    const b = leggiTabella(el)
    if (b) out.push(b)
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
        out.push({ tipo: 'tabella', head: [], body: conNota ? body : body.map(r => r.slice(0, 2)), foot: [] })
      }
      return
    }
    const t = pezzi(el).join(' ')
    if (t) out.push({ tipo: 'testo', testo: t })
    return
  }
  Array.from(el.children).forEach(c => raccogli(c, out))
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

export async function scaricaReportPdf(root: HTMLElement, nomeFile?: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])

  const blocchi: Blocco[] = []
  Array.from(root.children).forEach(c => raccogli(c, blocchi))

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
      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M },
        head: b.head.length ? b.head : undefined,
        body: b.body,
        foot: b.foot.length ? b.foot : undefined,
        showHead: 'everyPage',
        showFoot: 'lastPage',
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 1.5, overflow: 'linebreak', textColor: 20 },
        headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: 'bold' },
        footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 248, 248] },
      })
      y = fineTabella() + 5
    }
  }

  const pagine = doc.getNumberOfPages()
  for (let i = 1; i <= pagine; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(130)
    doc.text(`${titolo} - pagina ${i} di ${pagine}`, larg - M, alt - 5, { align: 'right' })
  }

  const slug = (nomeFile || titolo).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const oggi = new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')
  doc.save(`${slug || 'report'}-${oggi}.pdf`)
}
