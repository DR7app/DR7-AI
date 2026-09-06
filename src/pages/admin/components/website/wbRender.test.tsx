/**
 * Prova di disegno: ogni tipo di sezione deve produrre HTML vero.
 *
 * E' il test che vale di piu' per questo modulo. Il renderer e' condiviso
 * tra gestionale e sito: se un blocco lancia un'eccezione, non rompe
 * l'anteprima — rompe la pagina pubblica. Qui si disegna ogni tipo del
 * catalogo con i suoi valori di partenza, piu' i casi limite (contenuto
 * vuoto, indirizzi pericolosi, dati veri assenti).
 */

import React from 'react'
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WbBlock, WbItem, WbThemeTokens } from './shared/wbSchema'
import { WbBlocks, WbRenderContext, type WbLinkComponent } from './shared/WbBlockRenderer'
import { WB_BLOCKS, wbCreateBlock } from './wbRegistry'

const Link: WbLinkComponent = ({ to, children, className, style }) =>
  React.createElement('a', { href: to, className, style }, children)

const TOKENS = {
  colors: { primary: '#C9A96E', bg: '#000', surface: '#0B0B0C', text: '#FFF', textMuted: '#AAA', border: '#2C2C2E' },
  typography: {
    fontPrimary: 'Exo 2, sans-serif',
    fontSecondary: 'Playfair Display, serif',
    fontAccent: 'Rajdhani, sans-serif',
    scales: Object.fromEntries(
      ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body', 'small', 'label', 'button', 'menu', 'caption']
        .map((k) => [k, { family: 'fontPrimary', size: 16, weight: 400, lineHeight: 1.5, letterSpacing: 0, transform: 'none' }]),
    ),
  },
  radius: { md: 8 },
  spacing: { containerMax: 1280 },
  buttons: {
    primary: { bg: '#C9A96E', text: '#000', border: 'transparent', hoverBg: '#D4B896', hoverText: '#000', radius: 8, padX: 24, padY: 12 },
    secondary: { bg: '#1C1C1E', text: '#FFF', border: '#2C2C2E', hoverBg: '#2C2C2E', hoverText: '#FFF', radius: 8, padX: 24, padY: 12 },
    outline: { bg: 'transparent', text: '#FFF', border: '#FFF', hoverBg: '#FFF', hoverText: '#000', radius: 8, padX: 24, padY: 12 },
    ghost: { bg: 'transparent', text: '#C9A96E', border: 'transparent', hoverBg: 'rgba(0,0,0,.1)', hoverText: '#D4B896', radius: 8, padX: 20, padY: 12 },
  },
  effects: {},
  card: { bg: '#0B0B0C', border: '#2C2C2E', radius: 10, shadow: 'none', pad: 24 },
} as unknown as WbThemeTokens

function disegna(blocks: WbBlock[], extra: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    React.createElement(
      WbRenderContext.Provider,
      { value: { lang: 'it', device: 'desktop', tokens: TOKENS, Link, ...extra } as never },
      React.createElement(WbBlocks, { blocks }),
    ),
  )
}

describe('disegno di tutti i tipi di sezione', () => {
  for (const def of WB_BLOCKS) {
    it(`${def.type} si disegna senza esplodere`, () => {
      const b = wbCreateBlock(def.type)!
      const html = disegna([b])
      expect(html).toContain(`wb-b-${b.id}`)
      expect(html).toContain('<section')
    })
  }
})

describe('contenuto', () => {
  it('il titolo di una copertina finisce in un H1', () => {
    const b = wbCreateBlock('hero')!
    b.content!.title = { it: 'Ciao Sardegna', en: 'Hello' }
    expect(disegna([b])).toContain('<h1')
    expect(disegna([b])).toContain('Ciao Sardegna')
  })

  it('il titolo nascosto resta nell HTML ma fuori dalla vista', () => {
    const b = wbCreateBlock('hero-slider')!
    b.content!.title = { it: 'DR7 Noleggio' }
    b.settings!.titleVisuallyHidden = true
    const html = disegna([b])
    expect(html).toContain('wb-visually-hidden')
    expect(html).toContain('DR7 Noleggio')
  })

  it('la lingua inglese viene rispettata', () => {
    const b = wbCreateBlock('heading')!
    b.content!.text = { it: 'Ciao', en: 'Hello' }
    expect(disegna([b], { lang: 'en' })).toContain('Hello')
    expect(disegna([b], { lang: 'en' })).not.toContain('Ciao')
  })

  it('un testo lungo diventa piu paragrafi', () => {
    const b = wbCreateBlock('text')!
    b.content!.text = { it: 'Primo.\n\nSecondo.' }
    const html = disegna([b])
    expect((html.match(/<p /g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('il livello del titolo cambia il tag', () => {
    const b = wbCreateBlock('heading')!
    b.settings!.headingLevel = 4
    expect(disegna([b])).toContain('<h4')
  })
})

describe('sicurezza nel disegno', () => {
  it('un pulsante con indirizzo pericoloso non diventa un link', () => {
    const b = wbCreateBlock('cta')!
    ;(b.content!.buttons as { href: string }[])[0].href = 'javascript:alert(1)'
    const html = disegna([b])
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<a href="javascript')
  })

  it("l HTML libero viene ripulito prima di finire in pagina", () => {
    const b = wbCreateBlock('html')!
    b.content!.html = '<p>ok</p><script>alert(1)</script><div onclick="x()">y</div>'
    const html = disegna([b])
    expect(html).toContain('<p>ok</p>')
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('onclick')
  })

  it('un embed fuori lista non viene incorporato', () => {
    const b = wbCreateBlock('html')!
    b.content!.embedUrl = 'https://sito-a-caso.it/x'
    expect(disegna([b])).not.toContain('<iframe')
  })

  it('un embed della lista viene incorporato', () => {
    const b = wbCreateBlock('html')!
    b.content!.embedUrl = 'https://www.youtube.com/embed/abc'
    expect(disegna([b])).toContain('<iframe')
  })

  it("un'immagine con indirizzo non valido non viene disegnata", () => {
    const b = wbCreateBlock('image')!
    b.content!.image = { url: 'javascript:x' }
    expect(disegna([b])).not.toContain('<img')
  })
})

describe('sezioni nascoste e programmate', () => {
  it('una sezione nascosta non arriva sul sito', () => {
    const b = wbCreateBlock('cta')!
    b.hidden = true
    expect(disegna([b])).toBe('')
  })

  it("una sezione nascosta resta visibile nell'editor, in trasparenza", () => {
    const b = wbCreateBlock('cta')!
    b.hidden = true
    const html = disegna([b], { editor: { selectedId: null } })
    expect(html).toContain(`wb-b-${b.id}`)
  })

  it('una sezione programmata nel futuro non compare', () => {
    const b = wbCreateBlock('cta')!
    b.schedule = { startsAt: '2099-01-01T00:00:00Z' }
    expect(disegna([b])).toBe('')
  })

  it('una sezione scaduta non compare', () => {
    const b = wbCreateBlock('cta')!
    b.schedule = { endsAt: '2020-01-01T00:00:00Z' }
    expect(disegna([b])).toBe('')
  })
})

describe('dati veri del gestionale', () => {
  const veicoli: WbItem[] = [
    { id: 'v1', title: { it: 'Lamborghini Urus' }, price: '€ 900 / giorno', image: { url: '/urus.jpg', alt: { it: 'Urus' } }, link: { href: '/supercar-luxury', kind: 'page' } },
    { id: 'v2', title: { it: 'BMW M4' }, price: '€ 350 / giorno', image: { url: '/m4.jpg' } },
  ]

  it('la flotta mostra i veicoli passati dal gestionale', () => {
    const b = wbCreateBlock('fleet')!
    const html = disegna([b], { dynamic: { [b.id]: veicoli } })
    expect(html).toContain('Lamborghini Urus')
    expect(html).toContain('BMW M4')
  })

  it('cambiare disposizione non tocca i dati', () => {
    const b = wbCreateBlock('fleet')!
    b.layout!.columns = 2
    b.settings!.cardVariant = 'boxed'
    const html = disegna([b], { dynamic: { [b.id]: veicoli } })
    expect(html).toContain('Lamborghini Urus')
    expect(html).toContain('repeat(2,minmax(0,1fr))')
  })

  it('senza dati la sezione non lascia un buco sul sito', () => {
    const b = wbCreateBlock('fleet')!
    expect(disegna([b], { dynamic: { [b.id]: [] } })).not.toContain('Sezione')
  })

  it("mentre i dati arrivano si vede un segnaposto, non il vuoto", () => {
    const b = wbCreateBlock('fleet')!
    const html = disegna([b], { dynamicLoading: { [b.id]: true } })
    expect(html).toContain('wb-grid')
  })

  it('il prezzo si puo spegnere senza toccare il dato', () => {
    const b = wbCreateBlock('fleet')!
    b.settings!.showPrice = false
    b.settings!.cardVariant = 'boxed'
    const html = disegna([b], { dynamic: { [b.id]: veicoli } })
    expect(html).toContain('Lamborghini Urus')
    expect(html).not.toContain('€ 900')
  })
})

describe('accessibilita', () => {
  it("le immagini portano sempre un attributo alt", () => {
    const b = wbCreateBlock('image')!
    b.content!.image = { url: '/foto.jpg', alt: { it: 'Una foto' } }
    expect(disegna([b])).toContain('alt="Una foto"')
  })

  it('le domande frequenti dichiarano se sono aperte', () => {
    const b = wbCreateBlock('faq')!
    expect(disegna([b])).toContain('aria-expanded')
  })

  it('le linguette usano i ruoli giusti', () => {
    const b = wbCreateBlock('tabs')!
    const html = disegna([b])
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-selected')
  })

  it('i campi di un modulo sono collegati alla loro etichetta', () => {
    const b = wbCreateBlock('form')!
    const html = disegna([b])
    const forAttr = html.match(/for="([^"]+)"/)
    expect(forAttr).toBeTruthy()
    expect(html).toContain(`id="${forAttr![1]}"`)
  })
})

describe('video', () => {
  it("un video che parte da solo e sempre muto: altrimenti il browser lo blocca", () => {
    const b = wbCreateBlock('video')!
    b.content!.video = { url: '/clip.mp4', autoplay: true, muted: false, controls: false }
    const html = disegna([b])
    // Gli attributi HTML non distinguono maiuscole e minuscole: React
    // scrive `autoPlay`, il browser legge `autoplay`.
    expect(html.toLowerCase()).toContain('muted=""')
    expect(html.toLowerCase()).toContain('autoplay=""')
  })
})

describe('una pagina intera', () => {
  it('si disegna nell ordine delle sezioni', () => {
    const hero = wbCreateBlock('hero')!
    hero.content!.title = { it: 'PRIMA' }
    const cta = wbCreateBlock('cta')!
    cta.content!.title = { it: 'DOPO' }
    const html = disegna([hero, cta])
    expect(html.indexOf('PRIMA')).toBeLessThan(html.indexOf('DOPO'))
  })

  it('un tipo sconosciuto non fa cadere il resto della pagina', () => {
    const buono = wbCreateBlock('heading')!
    buono.content!.text = { it: 'Resto in piedi' }
    const rotto = { id: 'x', type: 'inventato' } as WbBlock
    const html = disegna([rotto, buono])
    expect(html).toContain('Resto in piedi')
  })
})
