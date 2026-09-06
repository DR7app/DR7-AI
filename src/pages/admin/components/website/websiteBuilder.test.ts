/**
 * Test del Website Builder.
 *
 * Coprono le parti in cui un errore non si vedrebbe subito ma finirebbe
 * online: sicurezza dell'HTML e degli indirizzi, CSS responsive generato,
 * duplicazione senza id condivisi, e i controlli che bloccano una
 * pubblicazione rotta.
 */

import { describe, it, expect } from 'vitest'
import {
  wbSanitizeHtml, wbSafeUrl, wbEmbedAllowed, wbText, wbId, wbNormalizeSlug,
  type WbBlock,
} from './shared/wbSchema'
import {
  wbBlockCss, wbThemeVars, wbTypographyStyle, wbButtonStyle,
  WB_BREAKPOINT_MOBILE, WB_BREAKPOINT_TABLET,
} from './shared/wbStyle'
import { wbCreateBlock, wbCloneBlock, wbFieldsFor, WB_BLOCKS, WB_BLOCK_BY_TYPE } from './wbRegistry'
import { wbValidatePage, wbValidateSite, wbHasBlocking, wbContrasto } from './wbValidate'
import { WB_RENDERED_TYPES } from './shared/WbBlockRenderer'

// ─── Sicurezza ──────────────────────────────────────────────────────────────
describe('sanificazione HTML', () => {
  it('toglie gli script', () => {
    expect(wbSanitizeHtml('<p>ciao</p><script>alert(1)</script>')).toBe('<p>ciao</p>')
  })
  it('toglie i gestori inline', () => {
    expect(wbSanitizeHtml('<div onclick="rubaTutto()">x</div>')).toBe('<div>x</div>')
    expect(wbSanitizeHtml("<div onmouseover='x()'>y</div>")).toBe('<div>y</div>')
    expect(wbSanitizeHtml('<div onerror=x()>z</div>')).toBe('<div>z</div>')
  })
  it('toglie javascript: dai link', () => {
    expect(wbSanitizeHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:')
  })
  it('toglie i tag che possono dirottare la pagina', () => {
    expect(wbSanitizeHtml('<base href="http://male.it"><p>ok</p>')).toBe('<p>ok</p>')
    expect(wbSanitizeHtml('<form action="/x"><input></form>')).toBe('')
  })
  it('lascia in pace il contenuto normale', () => {
    const html = '<p><strong>DR7</strong> — noleggio</p><ul><li>uno</li></ul>'
    expect(wbSanitizeHtml(html)).toBe(html)
  })
})

describe('indirizzi', () => {
  it('accetta quelli buoni', () => {
    for (const u of ['/flotta', 'https://dr7.app', '#servizi', 'mailto:info@dr7.app', 'tel:+390000']) {
      expect(wbSafeUrl(u)).toBe(u)
    }
  })
  it('rifiuta javascript: e schemi sconosciuti', () => {
    expect(wbSafeUrl('javascript:alert(1)')).toBe('')
    expect(wbSafeUrl('vbscript:x')).toBe('')
    expect(wbSafeUrl('file:///etc/passwd')).toBe('')
  })
  it('accetta solo gli embed della lista', () => {
    expect(wbEmbedAllowed('https://www.youtube.com/embed/x')).toBe(true)
    expect(wbEmbedAllowed('https://player.vimeo.com/video/1')).toBe(true)
    expect(wbEmbedAllowed('https://sito-a-caso.it/x')).toBe(false)
    expect(wbEmbedAllowed('http://www.youtube.com/embed/x')).toBe(false)
  })
})

describe('indirizzi delle pagine', () => {
  it('normalizza', () => {
    expect(wbNormalizeSlug('Offerte Estate')).toBe('/offerte-estate')
    expect(wbNormalizeSlug('/Chi Siamo/')).toBe('/chi-siamo')
    expect(wbNormalizeSlug('/')).toBe('/')
    expect(wbNormalizeSlug('Città')).toBe('/citta')
    expect(wbNormalizeSlug('///')).toBe('/')
  })
})

// ─── Testi bilingui ─────────────────────────────────────────────────────────
describe('testo bilingue', () => {
  it('usa la lingua chiesta', () => {
    expect(wbText({ it: 'Ciao', en: 'Hello' }, 'en')).toBe('Hello')
  })
  it('ripiega sull altra lingua invece di lasciare il vuoto', () => {
    expect(wbText({ it: 'Ciao', en: '' }, 'en')).toBe('Ciao')
    expect(wbText({ en: 'Hello' }, 'it')).toBe('Hello')
  })
  it('accetta anche una stringa sola', () => {
    expect(wbText('Ciao', 'en')).toBe('Ciao')
  })
})

// ─── Catalogo dei blocchi ───────────────────────────────────────────────────
describe('catalogo dei blocchi', () => {
  it('ogni tipo del catalogo sa disegnarsi', () => {
    for (const def of WB_BLOCKS) {
      expect(WB_RENDERED_TYPES).toContain(def.type)
    }
  })
  it('ogni blocco nasce gia utilizzabile', () => {
    for (const def of WB_BLOCKS) {
      const b = wbCreateBlock(def.type)
      expect(b, def.type).toBeTruthy()
      expect(b!.type).toBe(def.type)
      expect(b!.layout).toBeTruthy()
      expect(b!.visibility).toEqual({ desktop: true, tablet: true, mobile: true })
    }
  })
  it('i default di layout non vengono persi da chi ne cambia uno solo', () => {
    const hero = wbCreateBlock('hero')!
    // hero dichiara solo alcune misure: il resto resta quello standard
    expect(hero.layout?.overflow).toBe('visible')
    expect(hero.layout?.width).toBe('full')
  })
  it('duplicare non condivide nessun id', () => {
    const b = wbCreateBlock('cards')!
    const c = wbCloneBlock(b)
    expect(c.id).not.toBe(b.id)
    const idsA = (b.content!.items as { id: string }[]).map((i) => i.id)
    const idsB = (c.content!.items as { id: string }[]).map((i) => i.id)
    expect(idsB.some((id) => idsA.includes(id))).toBe(false)
  })
  it('i campi degli elementi spariscono quando la sorgente e il gestionale', () => {
    const b = wbCreateBlock('cards')!
    expect(wbFieldsFor(b).some((f) => f.path === 'content.items')).toBe(true)
    b.dataSource = { kind: 'auto', collection: 'vehicles' }
    expect(wbFieldsFor(b).some((f) => f.path === 'content.items')).toBe(false)
  })
  it('ogni blocco che legge dati veri ha una sorgente di partenza', () => {
    for (const def of WB_BLOCKS.filter((d) => d.supportsData)) {
      expect(wbCreateBlock(def.type)!.dataSource, def.type).toBeTruthy()
    }
  })
})

// ─── Stile ──────────────────────────────────────────────────────────────────
const TOKENS = {
  colors: { primary: '#C9A96E', bg: '#000000', text: '#FFFFFF' },
  typography: {
    fontPrimary: 'Exo 2, sans-serif',
    fontSecondary: 'Playfair Display, serif',
    fontAccent: 'Rajdhani, sans-serif',
    scales: {
      h1: { family: 'fontSecondary', size: 56, sizeMobile: 34, weight: 700, lineHeight: 1.1, letterSpacing: -0.5, transform: 'none' as const },
      h2: { family: 'fontSecondary', size: 42, weight: 700, lineHeight: 1.15, letterSpacing: 0, transform: 'none' as const },
      h3: { family: 'fontPrimary', size: 30, weight: 700, lineHeight: 1.2, letterSpacing: 0, transform: 'none' as const },
      h4: { family: 'fontPrimary', size: 24, weight: 600, lineHeight: 1.25, letterSpacing: 0, transform: 'none' as const },
      h5: { family: 'fontPrimary', size: 20, weight: 600, lineHeight: 1.3, letterSpacing: 0, transform: 'none' as const },
      h6: { family: 'fontPrimary', size: 17, weight: 600, lineHeight: 1.35, letterSpacing: 0.4, transform: 'uppercase' as const },
      body: { family: 'fontPrimary', size: 17, weight: 400, lineHeight: 1.65, letterSpacing: 0, transform: 'none' as const },
      small: { family: 'fontPrimary', size: 14, weight: 400, lineHeight: 1.55, letterSpacing: 0, transform: 'none' as const },
      label: { family: 'fontAccent', size: 13, weight: 600, lineHeight: 1.4, letterSpacing: 1.2, transform: 'uppercase' as const },
      button: { family: 'fontPrimary', size: 15, weight: 600, lineHeight: 1, letterSpacing: 0.6, transform: 'uppercase' as const },
      menu: { family: 'fontPrimary', size: 14, weight: 500, lineHeight: 1.4, letterSpacing: 0.8, transform: 'uppercase' as const },
      caption: { family: 'fontPrimary', size: 12, weight: 400, lineHeight: 1.5, letterSpacing: 0.2, transform: 'none' as const },
    },
  },
  radius: { md: 8 },
  spacing: { containerMax: 1280 },
  buttons: {
    primary: { bg: '#C9A96E', text: '#000', border: 'transparent', hoverBg: '#D4B896', hoverText: '#000', radius: 8, padX: 28, padY: 14 },
    secondary: { bg: '#1C1C1E', text: '#FFF', border: '#2C2C2E', hoverBg: '#2C2C2E', hoverText: '#FFF', radius: 8, padX: 28, padY: 14 },
    outline: { bg: 'transparent', text: '#FFF', border: '#FFF', hoverBg: '#FFF', hoverText: '#000', radius: 8, padX: 28, padY: 14 },
    ghost: { bg: 'transparent', text: '#C9A96E', border: 'transparent', hoverBg: 'rgba(0,0,0,.1)', hoverText: '#D4B896', radius: 8, padX: 20, padY: 12 },
  },
  effects: { shadowMd: '0 8px 24px rgba(0,0,0,.45)' },
  card: { bg: '#0B0B0C', border: '#2C2C2E', radius: 10, shadow: 'none', pad: 24 },
}

describe('tema come variabili CSS', () => {
  it('espone ogni colore come token', () => {
    const v = wbThemeVars(TOKENS)
    expect(v['--wb-color-primary']).toBe('#C9A96E')
    expect(v['--wb-font-secondary']).toBe('Playfair Display, serif')
    expect(v['--wb-radius-md']).toBe('8px')
  })
})

describe('tipografia', () => {
  it('parte dal preset globale', () => {
    const s = wbTypographyStyle({ preset: 'h1' }, TOKENS, 'desktop')
    expect(s.fontSize).toBe('56px')
    expect(s.fontWeight).toBe(700)
  })
  it('usa la misura per telefono quando c e', () => {
    expect(wbTypographyStyle({ preset: 'h1' }, TOKENS, 'mobile').fontSize).toBe('34px')
    // h2 non ha una misura per telefono: resta quella normale
    expect(wbTypographyStyle({ preset: 'h2' }, TOKENS, 'mobile').fontSize).toBe('42px')
  })
  it('l eccezione locale vince sul preset', () => {
    const s = wbTypographyStyle({ preset: 'h1', size: 20, weight: 400 }, TOKENS, 'desktop')
    expect(s.fontSize).toBe('20px')
    expect(s.fontWeight).toBe(400)
  })
})

describe('pulsanti', () => {
  it('prendono lo stile dal tema', () => {
    const s = wbButtonStyle({ id: 'b', label: {}, variant: 'primary' }, TOKENS)
    expect(s.backgroundColor).toBe('#C9A96E')
    expect(s.borderRadius).toBe('8px')
  })
  it('l eccezione sul singolo pulsante vince', () => {
    const s = wbButtonStyle({ id: 'b', label: {}, variant: 'primary', override: { bg: '#FF0000' } }, TOKENS)
    expect(s.backgroundColor).toBe('#FF0000')
  })
})

describe('CSS responsive generato', () => {
  const blocco = (over: Partial<WbBlock> = {}): WbBlock => ({
    id: 'test1', type: 'cards',
    visibility: { desktop: true, tablet: true, mobile: true },
    layout: { columns: 4, gap: 24, padTop: 96, padBottom: 96 },
    style: {}, typography: {},
    ...over,
  })

  it('nasconde per schermo quando richiesto', () => {
    const css = wbBlockCss(blocco({ visibility: { desktop: true, tablet: true, mobile: false } }), TOKENS)
    expect(css).toContain(`@media (max-width:${WB_BREAKPOINT_MOBILE}px)`)
    expect(css).toContain('.wb-b-test1{display:none!important}')
  })

  it('su telefono una griglia diventa una colonna sola, di default', () => {
    const css = wbBlockCss(blocco(), TOKENS)
    expect(css).toContain('.wb-b-test1 .wb-grid{grid-template-columns:1fr}')
  })

  it('rispetta la scelta esplicita dell operatore', () => {
    const css = wbBlockCss(blocco({ responsive: { mobile: { layout: { columns: 2 } } } }), TOKENS)
    expect(css).toContain('.wb-b-test1 .wb-grid{grid-template-columns:repeat(2,minmax(0,1fr))}')
    expect(css).not.toContain('.wb-grid{grid-template-columns:1fr}')
  })

  it('su tablet quattro colonne diventano due', () => {
    const css = wbBlockCss(blocco(), TOKENS)
    expect(css).toContain(`@media (max-width:${WB_BREAKPOINT_TABLET}px)`)
    expect(css).toContain('repeat(2,minmax(0,1fr))')
  })

  it('scrive solo cio che cambia davvero', () => {
    const css = wbBlockCss(blocco({ responsive: { mobile: { layout: { padTop: 32 } } } }), TOKENS)
    expect(css).toContain('padding-top:32px')
    expect(css).not.toContain('padding-bottom:96px')
  })

  it("in anteprima le soglie guardano la cornice, non la finestra", () => {
    const css = wbBlockCss(blocco(), TOKENS, 'container')
    expect(css).toContain('@container (max-width:')
    expect(css).not.toContain('@media')
  })

  it('sul sito le soglie restano quelle della finestra', () => {
    const css = wbBlockCss(blocco(), TOKENS)
    expect(css).toContain('@media (max-width:')
    expect(css).not.toContain('@container')
  })

  it('il CSS avanzato resta confinato al blocco', () => {
    const css = wbBlockCss(blocco({ customCss: '& h2 { color: red }' }), TOKENS)
    expect(css).toContain('.wb-b-test1 h2 { color: red }')
  })
})

// ─── Controlli prima della pubblicazione ────────────────────────────────────
type Pagina = Parameters<typeof wbValidatePage>[0]

const pagina = (over: Partial<Pagina> = {}): Pagina => ({
  id: 'p1', site_id: 's1', slug: '/test', title: 'Test',
  status: 'published', is_home: false, overrides_route: false, sort_order: 0,
  seo: { title: { it: 'T' }, description: { it: 'D' } },
  draft_content: { sections: [] },
  published_content: null,
  scheduled_at: null, unpublish_at: null, published_at: null,
  last_edited_by: null, last_edited_at: null,
  created_at: '', updated_at: '',
  ...over,
} as Pagina)

describe('controlli prima della pubblicazione', () => {
  it('blocca un indirizzo non valido', () => {
    const issues = wbValidatePage(pagina({ slug: 'senza-barra' }))
    expect(wbHasBlocking(issues)).toBe(true)
  })

  it('blocca un pulsante con indirizzo pericoloso', () => {
    const b = wbCreateBlock('cta')!
    ;(b.content!.buttons as { href: string; kind: string }[])[0].href = 'javascript:alert(1)'
    const issues = wbValidatePage(pagina({ draft_content: { sections: [b] } }))
    expect(wbHasBlocking(issues)).toBe(true)
  })

  it('blocca dati strutturati non validi', () => {
    const issues = wbValidatePage(pagina({ seo: { title: { it: 'T' }, description: { it: 'D' }, structuredData: '{non json' } }))
    expect(wbHasBlocking(issues)).toBe(true)
  })

  it('blocca un tipo di sezione sconosciuto', () => {
    const issues = wbValidatePage(pagina({ draft_content: { sections: [{ id: 'x', type: 'inventato' } as WbBlock] } }))
    expect(wbHasBlocking(issues)).toBe(true)
  })

  it('avvisa (senza bloccare) su un immagine senza testo alternativo', () => {
    const b = wbCreateBlock('image')!
    b.content!.image = { url: '/foto.jpg' }
    const issues = wbValidatePage(pagina({ draft_content: { sections: [b] } }))
    expect(wbHasBlocking(issues)).toBe(false)
    expect(issues.some((i) => i.level === 'warning' && i.message.includes('testo alternativo'))).toBe(true)
  })

  it('avvisa su una descrizione SEO troppo lunga', () => {
    const issues = wbValidatePage(pagina({ seo: { title: { it: 'T' }, description: { it: 'x'.repeat(200) } } }))
    expect(issues.some((i) => i.message.includes('troppo lunga'))).toBe(true)
  })

  it('blocca due pagine con lo stesso indirizzo', () => {
    const issues = wbValidateSite([pagina(), pagina({ id: 'p2' })])
    expect(issues.some((i) => i.level === 'error' && i.message.includes('stesso indirizzo'))).toBe(true)
  })

  it('blocca due home', () => {
    const issues = wbValidateSite([pagina({ is_home: true }), pagina({ id: 'p2', slug: '/b', is_home: true })])
    expect(issues.some((i) => i.level === 'error' && i.message.includes('home'))).toBe(true)
  })

  it('avvisa su un ancora duplicata', () => {
    const a = wbCreateBlock('text')!; a.anchorId = 'servizi'
    const b = wbCreateBlock('text')!; b.anchorId = 'servizi'
    const issues = wbValidatePage(pagina({ draft_content: { sections: [a, b] } }))
    expect(issues.some((i) => i.message.includes('Ancora duplicata'))).toBe(true)
  })

  it('non guarda le pagine in bozza: non vanno online', () => {
    const issues = wbValidateSite([pagina({ status: 'draft', slug: 'rotto' })])
    expect(wbHasBlocking(issues)).toBe(false)
  })

  it('una pagina normale passa senza errori', () => {
    const hero = wbCreateBlock('hero')!
    const issues = wbValidatePage(pagina({ draft_content: { sections: [hero] } }))
    expect(wbHasBlocking(issues)).toBe(false)
  })
})

describe('contrasto', () => {
  it('bianco su nero e il massimo', () => {
    expect(wbContrasto('#FFFFFF', '#000000')!).toBeCloseTo(21, 0)
  })
  it('grigio su grigio e sotto la soglia', () => {
    expect(wbContrasto('#888888', '#777777')!).toBeLessThan(4.5)
  })
  it('i token del tema non sono calcolabili e vengono saltati', () => {
    expect(wbContrasto('var(--wb-color-text)', '#000')).toBe(null)
  })
  it('avvisa (senza bloccare) quando il testo non si legge', () => {
    const b = wbCreateBlock('cta')!
    b.style!.textColor = '#888888'
    b.style!.bgColor = '#7A7A7A'
    const issues = wbValidatePage(pagina({ draft_content: { sections: [b] } }))
    expect(wbHasBlocking(issues)).toBe(false)
    expect(issues.some((i) => i.message.includes('poco contrasto'))).toBe(true)
  })
})

describe('identificativi', () => {
  it('sono unici', () => {
    const visti = new Set<string>()
    for (let i = 0; i < 500; i += 1) visti.add(wbId())
    expect(visti.size).toBe(500)
  })
})

describe('registro dei tipi', () => {
  it('non ha doppioni', () => {
    expect(Object.keys(WB_BLOCK_BY_TYPE).length).toBe(WB_BLOCKS.length)
  })
})
