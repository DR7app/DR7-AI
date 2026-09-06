/**
 * wbValidate.ts — controlli prima della pubblicazione.
 *
 * Due livelli, come chiede il capitolato: gli ERRORI bloccano (manderebbero
 * online una pagina rotta), gli AVVISI no — sono suggerimenti, e un
 * operatore deve poter pubblicare anche una pagina non perfetta.
 *
 * Nessun controllo qui e' cosmetico: ognuno corrisponde a qualcosa che si
 * vedrebbe davvero sul sito.
 */

import type { WbBlock, WbButton, WbItem, WbPageContent } from './shared/wbSchema'
import { wbSafeUrl, wbText } from './shared/wbSchema'
import { WB_BLOCK_BY_TYPE } from './wbRegistry'
import type { WbPageRow } from './wbApi'

export interface WbIssue {
  level: 'error' | 'warning'
  pageId?: string
  pageTitle?: string
  blockId?: string
  message: string
}

const BLOCCHI_SENZA_CONTENUTO = new Set(['spacer', 'divider'])

// ─── Contrasto ──────────────────────────────────────────────────────────────
/**
 * Rapporto di contrasto secondo WCAG. Si applica solo quando l'operatore
 * ha scelto A MANO sia il colore del testo sia quello dello sfondo: sui
 * colori del tema decide il Design System, e avvisare li' sarebbe rumore.
 * I token (`var(--wb-color-…)`) non sono calcolabili qui e vengono saltati.
 */
function luminanza(hex: string): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const canale = (v: number) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  const r = canale(parseInt(h.slice(0, 2), 16))
  const g = canale(parseInt(h.slice(2, 4), 16))
  const b = canale(parseInt(h.slice(4, 6), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function wbContrasto(testo: string, sfondo: string): number | null {
  const a = luminanza(testo)
  const b = luminanza(sfondo)
  if (a == null || b == null) return null
  const chiaro = Math.max(a, b)
  const scuro = Math.min(a, b)
  return (chiaro + 0.05) / (scuro + 0.05)
}

function controllaPulsanti(buttons: WbButton[] | undefined, ctx: { pageId: string; pageTitle: string; blockId: string; nome: string }, issues: WbIssue[]) {
  for (const b of buttons || []) {
    if (!wbText(b.label, 'it') && !wbText(b.label, 'en')) {
      issues.push({ level: 'warning', ...ctx, message: `${ctx.nome}: un pulsante non ha etichetta.` })
    }
    if (b.kind !== 'none' && b.href && !wbSafeUrl(b.href)) {
      issues.push({ level: 'error', ...ctx, message: `${ctx.nome}: indirizzo del pulsante non valido ("${b.href}").` })
    }
    if (b.kind !== 'none' && !b.href) {
      issues.push({ level: 'warning', ...ctx, message: `${ctx.nome}: un pulsante non porta da nessuna parte.` })
    }
  }
}

function controllaBlocco(block: WbBlock, page: WbPageRow, issues: WbIssue[], headings: number[]) {
  const def = WB_BLOCK_BY_TYPE[block.type]
  const ctx = { pageId: page.id, pageTitle: page.title, blockId: block.id, nome: block.name || def?.label || block.type }

  if (!def) {
    issues.push({ level: 'error', ...ctx, message: `Sezione di tipo sconosciuto: "${block.type}". Non verrebbe disegnata.` })
    return
  }
  if (block.hidden) return

  // Gerarchia dei titoli: conta per Google e per i lettori di schermo.
  if (block.type === 'heading' || block.type === 'subheading') {
    headings.push(Number(block.settings?.headingLevel ?? 2))
  }
  if (block.type.indexOf('hero') === 0) headings.push(1)

  const items = (block.content?.items as WbItem[] | undefined) || []
  const dinamico = block.dataSource && block.dataSource.kind !== 'manual'

  // Sezione vuota: sul sito si vedrebbe uno spazio bianco.
  if (!BLOCCHI_SENZA_CONTENUTO.has(block.type) && !dinamico) {
    const haTesto = ['title', 'text', 'subtitle', 'eyebrow', 'address', 'html', 'embedUrl']
      .some((k) => {
        const v = block.content?.[k]
        return typeof v === 'string' ? !!v.trim() : !!(wbText(v as never, 'it') || wbText(v as never, 'en'))
      })
    const haMedia = !!(block.content?.image as { url?: string } | undefined)?.url
      || !!(block.content?.video as { url?: string } | undefined)?.url
    const haCampi = Array.isArray(block.content?.fields) && (block.content!.fields as unknown[]).length > 0
    if (!items.length && !haTesto && !haMedia && !haCampi) {
      issues.push({ level: 'warning', ...ctx, message: `${ctx.nome}: sezione senza contenuto, sul sito resterebbe uno spazio vuoto.` })
    }
  }

  // Immagini: indirizzo valido e testo alternativo.
  const immagini: { url?: string; alt?: unknown }[] = []
  const img = block.content?.image as { url?: string; alt?: unknown } | undefined
  if (img) immagini.push(img)
  for (const it of items) if (it.image) immagini.push(it.image)
  for (const im of immagini) {
    if (im.url && !wbSafeUrl(im.url)) {
      issues.push({ level: 'error', ...ctx, message: `${ctx.nome}: indirizzo immagine non valido.` })
    }
    if (im.url && !wbText(im.alt as never, 'it') && !wbText(im.alt as never, 'en')) {
      issues.push({ level: 'warning', ...ctx, message: `${ctx.nome}: un'immagine non ha testo alternativo (serve per l'accessibilita' e per Google).` })
    }
  }

  const vid = block.content?.video as { url?: string } | undefined
  if (vid?.url && !wbSafeUrl(vid.url)) {
    issues.push({ level: 'error', ...ctx, message: `${ctx.nome}: indirizzo video non valido.` })
  }

  controllaPulsanti(block.content?.buttons as WbButton[] | undefined, ctx, issues)
  for (const it of items) controllaPulsanti(it.buttons, ctx, issues)

  // Contrasto: un testo grigio su fondo grigio si legge in redazione e
  // non si legge sul telefono in pieno sole.
  if (block.style?.textColor && block.style?.bgColor) {
    const r = wbContrasto(block.style.textColor, block.style.bgColor)
    if (r !== null && r < 4.5) {
      issues.push({
        level: 'warning', ...ctx,
        message: `${ctx.nome}: testo e sfondo hanno poco contrasto (${r.toFixed(1)}:1, il minimo consigliato e' 4,5:1).`,
      })
    }
  }

  // Nascosta su tutti gli schermi = non la vedra' mai nessuno.
  const v = block.visibility
  if (v && !v.desktop && !v.tablet && !v.mobile) {
    issues.push({ level: 'warning', ...ctx, message: `${ctx.nome}: nascosta su tutti gli schermi.` })
  }

  // Ancora duplicata o con caratteri non validi.
  if (block.anchorId && !/^[a-zA-Z][\w-]*$/.test(block.anchorId)) {
    issues.push({ level: 'error', ...ctx, message: `${ctx.nome}: l'ancora "${block.anchorId}" contiene caratteri non ammessi.` })
  }

  block.children?.forEach((c) => controllaBlocco(c, page, issues, headings))
}

/** Controlla una pagina. Le pagine in bozza non vengono pubblicate: si saltano. */
export function wbValidatePage(page: WbPageRow): WbIssue[] {
  const issues: WbIssue[] = []
  const base = { pageId: page.id, pageTitle: page.title }

  if (!page.slug || !page.slug.startsWith('/')) {
    issues.push({ level: 'error', ...base, message: `Indirizzo della pagina non valido: "${page.slug}".` })
  }
  const content = (page.draft_content || { sections: [] }) as WbPageContent
  if (!Array.isArray(content.sections)) {
    issues.push({ level: 'error', ...base, message: 'Struttura della pagina non valida.' })
    return issues
  }
  if (content.sections.length === 0 && page.status !== 'draft') {
    issues.push({ level: 'warning', ...base, message: 'Pagina senza sezioni: online si vedrebbe una pagina vuota.' })
  }

  const seo = page.seo || {}
  if (!wbText(seo.title, 'it') && !wbText(seo.title, 'en')) {
    issues.push({ level: 'warning', ...base, message: 'Manca il titolo SEO: Google userebbe il titolo della pagina.' })
  }
  const desc = wbText(seo.description, 'it')
  if (!desc) {
    issues.push({ level: 'warning', ...base, message: 'Manca la descrizione SEO.' })
  } else if (desc.length > 165) {
    issues.push({ level: 'warning', ...base, message: `Descrizione SEO troppo lunga (${desc.length} caratteri): Google ne mostra circa 160.` })
  }
  if (seo.canonical && !wbSafeUrl(seo.canonical)) {
    issues.push({ level: 'error', ...base, message: 'Indirizzo canonico non valido.' })
  }
  if (seo.structuredData) {
    try { JSON.parse(seo.structuredData) } catch {
      issues.push({ level: 'error', ...base, message: 'I dati strutturati non sono JSON valido.' })
    }
  }

  const headings: number[] = []
  const ancore = new Set<string>()
  for (const b of content.sections) {
    if (b.anchorId) {
      if (ancore.has(b.anchorId)) {
        issues.push({ level: 'error', ...base, blockId: b.id, message: `Ancora duplicata: "${b.anchorId}".` })
      }
      ancore.add(b.anchorId)
    }
    controllaBlocco(b, page, issues, headings)
  }

  const h1 = headings.filter((h) => h === 1).length
  if (h1 > 1) {
    issues.push({ level: 'warning', ...base, message: `${h1} titoli H1 nella stessa pagina: Google si aspetta un titolo principale solo.` })
  }
  if (h1 === 0 && content.sections.length > 0) {
    issues.push({ level: 'warning', ...base, message: 'Nessun titolo H1: la pagina non dichiara il suo argomento principale.' })
  }

  return issues
}

/** Controlla tutto cio' che sta per andare online. */
export function wbValidateSite(pages: WbPageRow[]): WbIssue[] {
  const issues: WbIssue[] = []
  const daPubblicare = pages.filter((p) => p.status === 'published' || p.status === 'scheduled')

  const slugs = new Map<string, number>()
  for (const p of daPubblicare) slugs.set(p.slug, (slugs.get(p.slug) || 0) + 1)
  for (const [slug, n] of slugs) {
    if (n > 1) issues.push({ level: 'error', message: `Due pagine con lo stesso indirizzo: "${slug}".` })
  }

  const home = daPubblicare.filter((p) => p.is_home)
  if (home.length > 1) issues.push({ level: 'error', message: 'Piu di una pagina e impostata come home.' })

  for (const p of daPubblicare) issues.push(...wbValidatePage(p))

  // Collegamenti interni che puntano a pagine non pubblicate.
  const disponibili = new Set(daPubblicare.map((p) => p.slug))
  const noti = new Set(pages.map((p) => p.slug))
  for (const p of daPubblicare) {
    const json = JSON.stringify(p.draft_content || {})
    const rotte = json.match(/"href":"(\/[^"]*)"/g) || []
    for (const raw of rotte) {
      const href = raw.slice(9, -1).split('#')[0].split('?')[0]
      if (!href || href === '/') continue
      // Solo le rotte che il builder conosce: quelle del sito React
      // esistente non sono in questo elenco ed e' giusto cosi'.
      if (noti.has(href) && !disponibili.has(href)) {
        issues.push({ level: 'warning', pageId: p.id, pageTitle: p.title, message: `Un collegamento porta a "${href}", che non e ancora pubblicata.` })
      }
    }
  }

  return issues
}

export function wbHasBlocking(issues: WbIssue[]): boolean {
  return issues.some((i) => i.level === 'error')
}
