/**
 * wbRegistry.ts — il catalogo dei blocchi.
 *
 * Ogni tipo di sezione e' descritto qui: come si chiama, dove sta nel
 * pannello "Aggiungi sezione", com'e' fatta appena creata, e QUALI
 * proprieta' l'operatore puo' toccare. Il pannello delle proprieta' non
 * conosce nessun tipo di blocco: legge questo elenco e disegna i campi.
 *
 * Aggiungere un blocco nuovo = aggiungere una voce qui + (se serve) un
 * componente in WbBlockRenderer. Nessuna modifica all'editor.
 *
 * I campi comuni (Layout, Stile, Responsive, Avanzate) sono definiti una
 * volta sola in fondo e valgono per tutti: e' cio' che evita "decine di
 * componenti duplicati" del capitolato.
 */

import type { WbBlock, WbItem, WbButton, WbText } from './shared/wbSchema'
import { wbId, WB_DEFAULT_LAYOUT, WB_DEFAULT_STYLE, WB_DEFAULT_TYPOGRAPHY, WB_DEFAULT_VISIBILITY } from './shared/wbSchema'

// ─── Campi ──────────────────────────────────────────────────────────────────
export type WbFieldType =
  | 'text' | 'textarea' | 'i18n' | 'i18n-long'
  | 'number' | 'slider' | 'color' | 'select' | 'toggle'
  | 'media' | 'video' | 'link' | 'items' | 'buttons' | 'form-fields'
  | 'gradient' | 'spacing' | 'anchor' | 'css' | 'html' | 'datetime'

export type WbFieldGroup = 'content' | 'layout' | 'style' | 'responsive' | 'advanced'

export interface WbFieldDef {
  /** Percorso dentro il blocco, es. `content.title` o `layout.padTop`. */
  path: string
  label: string
  type: WbFieldType
  group: WbFieldGroup
  help?: string
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  step?: number
  unit?: string
  /** Mostra il campo solo se… (evita pannelli pieni di campi inutili). */
  when?: (block: WbBlock) => boolean
  /** Forma degli elementi ripetuti, per il campo `items`. */
  itemFields?: WbFieldDef[]
  /** Diritto richiesto per vedere il campo (es. website.code). */
  requires?: string
}

export interface WbBlockDef {
  type: string
  label: string
  category: WbCategoryId
  /** `d` di un path SVG 24x24: nessuna emoji nell'interfaccia. */
  icon: string
  description: string
  /** Il blocco appena aggiunto: gia' presentabile, mai vuoto. */
  create: () => WbBlock
  fields: WbFieldDef[]
  /** Il blocco puo' leggere dati veri dal gestionale. */
  supportsData?: boolean
}

export type WbCategoryId = 'hero' | 'testo' | 'media' | 'contenuti' | 'dati' | 'interazione' | 'struttura'

export const WB_CATEGORIES: { id: WbCategoryId; label: string; description: string }[] = [
  { id: 'hero',        label: 'Copertine',        description: 'La prima cosa che si vede aprendo la pagina.' },
  { id: 'testo',       label: 'Testi',            description: 'Titoli, paragrafi, elenchi.' },
  { id: 'media',       label: 'Immagini e video', description: 'Foto singole, gallerie, caroselli.' },
  { id: 'contenuti',   label: 'Contenuti',        description: 'Schede, statistiche, recensioni, domande frequenti.' },
  { id: 'dati',        label: 'Dati dal gestionale', description: 'Flotta, servizi, promozioni: dati veri, non copiati.' },
  { id: 'interazione', label: 'Interazione',      description: 'Pulsanti, moduli, mappe, social.' },
  { id: 'struttura',   label: 'Struttura',        description: 'Separatori, spazi, contenuti incorporati.' },
]

// ─── Icone (path SVG 24x24) ─────────────────────────────────────────────────
export const WB_ICONS = {
  hero: 'M3 5h18v9H3zM3 18h10',
  text: 'M4 6h16M4 12h16M4 18h10',
  heading: 'M6 4v16M18 4v16M6 12h12',
  image: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
  video: 'M3 5h18v14H3zM10 9l5 3-5 3z',
  gallery: 'M3 4h8v8H3zM13 4h8v8h-8zM3 14h8v6H3zM13 14h8v6h-8z',
  carousel: 'M6 6h12v12H6zM2 9v6M22 9v6',
  split: 'M3 5h8v14H3zM13 7h8M13 12h8M13 17h6',
  cta: 'M4 8h16v8H4zM9 12h6',
  button: 'M4 9h16v6H4z',
  cards: 'M3 4h7v7H3zM14 4h7v7h-7zM3 13h7v7H3zM14 13h7v7h-7z',
  list: 'M4 6h.01M8 6h12M4 12h.01M8 12h12M4 18h.01M8 18h12',
  stats: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  logos: 'M4 8h4v8H4zM10 8h4v8h-4zM16 8h4v8h-4z',
  reviews: 'M12 3l2.6 5.6L21 9.5l-4.5 4.3 1.1 6.2L12 17l-5.6 3 1.1-6.2L3 9.5l6.4-.9z',
  faq: 'M12 18h.01M9.1 9a3 3 0 115.8 1c0 2-2.9 2.5-2.9 4M4 4h16v16H4z',
  tabs: 'M3 8h6V4h12v16H3zM9 8v12',
  timeline: 'M6 3v18M6 7h12M6 13h12M6 19h8',
  map: 'M9 4l6 2 6-2v14l-6 2-6-2-6 2V6z',
  form: 'M4 5h16v14H4zM7 9h10M7 13h10M7 17h5',
  social: 'M18 8a3 3 0 10-2.8-4M6 12a3 3 0 100 6 3 3 0 000-6zM18 16a3 3 0 100 6 3 3 0 000-6zM8.6 13.5l6.8-3.5M8.6 15.5l6.8 3.5',
  banner: 'M3 7h18v6H3zM7 17h10',
  divider: 'M3 12h18',
  spacer: 'M12 4v4M12 16v4M4 12h16',
  code: 'M9 8l-5 4 5 4M15 8l5 4-5 4',
  vehicles: 'M4 13l1.5-4.5A2 2 0 017.4 7h9.2a2 2 0 011.9 1.5L20 13v5h-3v-2H7v2H4zM7 16h.01M17 16h.01',
  services: 'M12 3l7 4v6c0 4-3 7-7 8-4-1-7-4-7-8V7z',
  promo: 'M4 4h9l7 7-9 9-7-7zM9 9h.01',
}

// ─── Aiutanti per creare i valori iniziali ──────────────────────────────────
const t = (it: string, en?: string): WbText => ({ it, en: en ?? it })

function item(partial: Partial<WbItem> = {}): WbItem {
  return { id: wbId('i'), ...partial }
}

function btn(label: string, href = '#', variant: WbButton['variant'] = 'primary'): WbButton {
  return { id: wbId('btn'), label: t(label), href, kind: href.startsWith('http') ? 'url' : 'page', variant, size: 'md' }
}

/**
 * Blocco nuovo: i valori di partenza piu' quelli del tipo specifico.
 * `layout` e `style` si FONDONO con i default invece di sostituirli, cosi'
 * un blocco che dichiara solo `minHeight` non perde gli spazi standard.
 */
function base(type: string, over: Partial<WbBlock> = {}): WbBlock {
  const { layout, style, ...resto } = over
  return {
    id: wbId(),
    type,
    visibility: { ...WB_DEFAULT_VISIBILITY },
    content: {},
    settings: {},
    typography: { ...WB_DEFAULT_TYPOGRAPHY },
    animation: { type: 'none' },
    ...resto,
    layout: { ...WB_DEFAULT_LAYOUT, ...(layout || {}) },
    style: { ...WB_DEFAULT_STYLE, ...(style || {}) },
  }
}

// ─── Campi riutilizzabili ───────────────────────────────────────────────────
const F = {
  title: { path: 'content.title', label: 'Titolo', type: 'i18n', group: 'content' } as WbFieldDef,
  eyebrow: { path: 'content.eyebrow', label: 'Occhiello', type: 'i18n', group: 'content', help: 'La riga piccola sopra il titolo.' } as WbFieldDef,
  subtitle: { path: 'content.subtitle', label: 'Sottotitolo', type: 'i18n', group: 'content' } as WbFieldDef,
  text: { path: 'content.text', label: 'Testo', type: 'i18n-long', group: 'content' } as WbFieldDef,
  buttons: { path: 'content.buttons', label: 'Pulsanti', type: 'buttons', group: 'content' } as WbFieldDef,
  image: { path: 'content.image', label: 'Immagine', type: 'media', group: 'content' } as WbFieldDef,
  video: { path: 'content.video', label: 'Video', type: 'video', group: 'content' } as WbFieldDef,
  link: { path: 'content.link', label: 'Collegamento', type: 'link', group: 'content' } as WbFieldDef,
  headingLevel: {
    path: 'settings.headingLevel', label: 'Livello del titolo', type: 'select', group: 'advanced',
    help: 'Conta per Google e per i lettori di schermo: una sola H1 per pagina, poi H2, H3…',
    options: [1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `H${n}` })),
  } as WbFieldDef,
  columns: { path: 'layout.columns', label: 'Colonne', type: 'slider', group: 'layout', min: 1, max: 6, step: 1 } as WbFieldDef,
  aspectRatio: {
    path: 'settings.aspectRatio', label: 'Proporzione immagine', type: 'select', group: 'layout',
    options: [
      { value: 'auto', label: 'Originale' }, { value: '1/1', label: 'Quadrata' },
      { value: '4/3', label: '4:3' }, { value: '3/2', label: '3:2' },
      { value: '16/9', label: '16:9' }, { value: '3/4', label: 'Verticale 3:4' },
      { value: '9/16', label: 'Verticale 9:16' },
    ],
  } as WbFieldDef,
}

const ITEM_CARD: WbFieldDef[] = [
  { path: 'title', label: 'Titolo', type: 'i18n', group: 'content' },
  { path: 'subtitle', label: 'Sottotitolo', type: 'i18n', group: 'content' },
  { path: 'text', label: 'Descrizione', type: 'i18n-long', group: 'content' },
  { path: 'badge', label: 'Etichetta', type: 'i18n', group: 'content' },
  { path: 'price', label: 'Prezzo', type: 'text', group: 'content' },
  { path: 'image', label: 'Immagine', type: 'media', group: 'content' },
  { path: 'video', label: 'Video', type: 'video', group: 'content' },
  { path: 'link', label: 'Collegamento', type: 'link', group: 'content' },
  { path: 'buttons', label: 'Pulsanti', type: 'buttons', group: 'content' },
]

const ITEM_SLIDE: WbFieldDef[] = [
  { path: 'badge', label: 'Occhiello', type: 'i18n', group: 'content' },
  { path: 'title', label: 'Titolo', type: 'i18n', group: 'content' },
  { path: 'subtitle', label: 'Sottotitolo', type: 'i18n', group: 'content' },
  { path: 'image', label: 'Immagine di sfondo', type: 'media', group: 'content' },
  { path: 'video', label: 'Video di sfondo', type: 'video', group: 'content' },
  { path: 'buttons', label: 'Pulsanti', type: 'buttons', group: 'content' },
]

const ITEM_SIMPLE: WbFieldDef[] = [
  { path: 'title', label: 'Titolo', type: 'i18n', group: 'content' },
  { path: 'text', label: 'Testo', type: 'i18n-long', group: 'content' },
]

const ITEM_IMAGE: WbFieldDef[] = [
  { path: 'image', label: 'Immagine', type: 'media', group: 'content' },
  { path: 'title', label: 'Didascalia', type: 'i18n', group: 'content' },
  { path: 'link', label: 'Collegamento', type: 'link', group: 'content' },
]

const ITEM_STAT: WbFieldDef[] = [
  { path: 'value', label: 'Numero', type: 'text', group: 'content', help: 'Es. "1200+" oppure "98%".' },
  { path: 'title', label: 'Etichetta', type: 'i18n', group: 'content' },
]

const ITEM_REVIEW: WbFieldDef[] = [
  { path: 'text', label: 'Recensione', type: 'i18n-long', group: 'content' },
  { path: 'title', label: 'Nome', type: 'i18n', group: 'content' },
  { path: 'subtitle', label: 'Ruolo / provenienza', type: 'i18n', group: 'content' },
  { path: 'image', label: 'Foto', type: 'media', group: 'content' },
  { path: 'meta.rating', label: 'Stelle', type: 'slider', group: 'content', min: 1, max: 5, step: 1 },
]

const ITEM_SOCIAL: WbFieldDef[] = [
  { path: 'title', label: 'Rete', type: 'i18n', group: 'content' },
  { path: 'link', label: 'Indirizzo', type: 'link', group: 'content' },
  { path: 'image', label: 'Icona', type: 'media', group: 'content' },
]

const ITEM_TIMELINE: WbFieldDef[] = [
  { path: 'value', label: 'Data / anno', type: 'text', group: 'content' },
  { path: 'title', label: 'Titolo', type: 'i18n', group: 'content' },
  { path: 'text', label: 'Descrizione', type: 'i18n-long', group: 'content' },
]

// ─── Catalogo ───────────────────────────────────────────────────────────────
export const WB_BLOCKS: WbBlockDef[] = [
  // ── Copertine ──
  {
    type: 'hero', label: 'Copertina', category: 'hero', icon: WB_ICONS.hero,
    description: 'Titolo grande su sfondo pieno o immagine.',
    create: () => base('hero', {
      name: 'Copertina',
      content: { eyebrow: t('DR7'), title: t('Un titolo che si fa ricordare'), subtitle: t('Una riga per spiegare di cosa si tratta.'), buttons: [btn('Scopri', '/flotta')] },
      layout: { ...WB_DEFAULT_LAYOUT, width: 'full', minHeight: 620, align: 'center', padTop: 0, padBottom: 0, padLeft: 0, padRight: 0 },
      style: { ...WB_DEFAULT_STYLE, bgColor: '#000000', overlayColor: '#000000', overlayOpacity: 0.45 },
    }),
    fields: [F.eyebrow, F.title, F.subtitle, F.buttons, F.image, F.video],
  },
  {
    type: 'hero-image', label: 'Copertina con immagine', category: 'hero', icon: WB_ICONS.image,
    description: 'Come la copertina, con una foto di sfondo.',
    create: () => base('hero-image', {
      name: 'Copertina con immagine',
      content: { title: t('Il tuo titolo'), subtitle: t('Sottotitolo'), image: {}, buttons: [btn('Prenota ora', '/flotta')] },
      layout: { ...WB_DEFAULT_LAYOUT, width: 'full', minHeight: 620, align: 'center', padTop: 0, padBottom: 0, padLeft: 0, padRight: 0 },
      style: { ...WB_DEFAULT_STYLE, overlayColor: '#000000', overlayOpacity: 0.5 },
    }),
    fields: [F.eyebrow, F.title, F.subtitle, F.image, F.buttons],
  },
  {
    type: 'hero-video', label: 'Copertina con video', category: 'hero', icon: WB_ICONS.video,
    description: 'Video a tutto schermo dietro al titolo.',
    create: () => base('hero-video', {
      name: 'Copertina con video',
      content: { title: t('Il tuo titolo'), video: { autoplay: true, loop: true, muted: true, controls: false }, buttons: [] },
      layout: { ...WB_DEFAULT_LAYOUT, width: 'full', minHeight: 680, align: 'center', padTop: 0, padBottom: 0, padLeft: 0, padRight: 0 },
      style: { ...WB_DEFAULT_STYLE, overlayColor: '#000000', overlayOpacity: 0.4 },
    }),
    fields: [F.eyebrow, F.title, F.subtitle, F.video, F.image, F.buttons],
  },
  {
    type: 'hero-slider', label: 'Copertina a diapositive', category: 'hero', icon: WB_ICONS.carousel,
    description: 'Piu' + ' copertine che si alternano da sole.',
    create: () => base('hero-slider', {
      name: 'Copertina a diapositive',
      content: { items: [item({ title: t('Prima diapositiva'), image: {} }), item({ title: t('Seconda diapositiva'), image: {} })] },
      settings: { autoplaySeconds: 8 },
      layout: { ...WB_DEFAULT_LAYOUT, width: 'full', minHeight: 680, align: 'center', padTop: 0, padBottom: 0, padLeft: 0, padRight: 0 },
      style: { ...WB_DEFAULT_STYLE, overlayColor: '#000000', overlayOpacity: 0.45 },
    }),
    fields: [
      { path: 'content.items', label: 'Diapositive', type: 'items', group: 'content', itemFields: ITEM_SLIDE },
      { path: 'settings.autoplaySeconds', label: 'Cambio automatico', type: 'slider', group: 'content', min: 0, max: 20, step: 1, unit: 's', help: '0 = non cambia da solo.' },
    ],
  },

  // ── Testi ──
  {
    type: 'heading', label: 'Titolo', category: 'testo', icon: WB_ICONS.heading,
    description: 'Un titolo di sezione.',
    create: () => base('heading', {
      name: 'Titolo',
      content: { text: t('Titolo di sezione') },
      settings: { headingLevel: 2 },
      layout: { ...WB_DEFAULT_LAYOUT, padTop: 48, padBottom: 16 },
    }),
    fields: [{ path: 'content.text', label: 'Testo', type: 'i18n', group: 'content' }, F.headingLevel],
  },
  {
    type: 'subheading', label: 'Sottotitolo', category: 'testo', icon: WB_ICONS.heading,
    description: 'Un titolo piu' + ' piccolo.',
    create: () => base('subheading', {
      name: 'Sottotitolo',
      content: { text: t('Sottotitolo') },
      settings: { headingLevel: 3 },
      layout: { ...WB_DEFAULT_LAYOUT, padTop: 24, padBottom: 12 },
    }),
    fields: [{ path: 'content.text', label: 'Testo', type: 'i18n', group: 'content' }, F.headingLevel],
  },
  {
    type: 'text', label: 'Testo', category: 'testo', icon: WB_ICONS.text,
    description: 'Uno o piu' + ' paragrafi.',
    create: () => base('text', {
      name: 'Testo',
      content: { text: t('Scrivi qui il tuo testo.\n\nUna riga vuota comincia un paragrafo nuovo.') },
      layout: { ...WB_DEFAULT_LAYOUT, width: 'narrow', padTop: 32, padBottom: 32 },
    }),
    fields: [F.text],
  },
  {
    type: 'list', label: 'Elenco', category: 'testo', icon: WB_ICONS.list,
    description: 'Punti elenco o numerati.',
    create: () => base('list', {
      name: 'Elenco',
      content: { items: [item({ title: t('Primo punto'), text: t('') }), item({ title: t('Secondo punto'), text: t('') })] },
      layout: { ...WB_DEFAULT_LAYOUT, width: 'narrow', padTop: 32, padBottom: 32 },
    }),
    fields: [
      F.title, F.subtitle,
      { path: 'content.items', label: 'Voci', type: 'items', group: 'content', itemFields: ITEM_SIMPLE },
      { path: 'settings.ordered', label: 'Numerato', type: 'toggle', group: 'layout' },
    ],
  },

  // ── Immagini e video ──
  {
    type: 'image', label: 'Immagine', category: 'media', icon: WB_ICONS.image,
    description: 'Una foto, con didascalia facoltativa.',
    create: () => base('image', { name: 'Immagine', content: { image: {} }, settings: { aspectRatio: 'auto' } }),
    fields: [F.image, F.link, F.aspectRatio, { path: 'content.caption', label: 'Didascalia', type: 'i18n', group: 'content' }],
  },
  {
    type: 'video', label: 'Video', category: 'media', icon: WB_ICONS.video,
    description: 'Un video caricato nella libreria.',
    create: () => base('video', { name: 'Video', content: { video: { controls: true, muted: true } }, settings: { aspectRatio: '16/9' } }),
    fields: [F.video, F.aspectRatio, { path: 'content.caption', label: 'Didascalia', type: 'i18n', group: 'content' }],
  },
  {
    type: 'gallery', label: 'Galleria', category: 'media', icon: WB_ICONS.gallery,
    description: 'Griglia di immagini.',
    create: () => base('gallery', {
      name: 'Galleria',
      content: { items: [item({ image: {} }), item({ image: {} }), item({ image: {} })] },
      layout: { ...WB_DEFAULT_LAYOUT, columns: 3, gap: 16 },
      settings: { aspectRatio: '4/3' },
    }),
    fields: [F.title, { path: 'content.items', label: 'Immagini', type: 'items', group: 'content', itemFields: ITEM_IMAGE }, F.columns, F.aspectRatio],
  },
  {
    type: 'slider', label: 'Scorrimento', category: 'media', icon: WB_ICONS.carousel,
    description: 'Immagini che scorrono in orizzontale.',
    create: () => base('slider', {
      name: 'Scorrimento',
      content: { items: [item({ image: {} }), item({ image: {} }), item({ image: {} }), item({ image: {} })] },
      layout: { ...WB_DEFAULT_LAYOUT, columns: 3, gap: 16 },
      settings: { aspectRatio: '4/3' },
    }),
    fields: [F.title, { path: 'content.items', label: 'Immagini', type: 'items', group: 'content', itemFields: ITEM_IMAGE }, { ...F.columns, label: 'Quante se ne vedono' }, F.aspectRatio],
  },
  {
    type: 'carousel', label: 'Carosello', category: 'media', icon: WB_ICONS.carousel,
    description: 'Come lo scorrimento, con schede piu' + ' grandi.',
    create: () => base('carousel', {
      name: 'Carosello',
      content: { items: [item({ image: {}, title: t('Voce 1') }), item({ image: {}, title: t('Voce 2') })] },
      layout: { ...WB_DEFAULT_LAYOUT, columns: 2, gap: 24 },
      settings: { aspectRatio: '16/9' },
    }),
    fields: [F.title, { path: 'content.items', label: 'Elementi', type: 'items', group: 'content', itemFields: ITEM_IMAGE }, { ...F.columns, label: 'Quante se ne vedono' }, F.aspectRatio],
  },
  {
    type: 'text-image', label: 'Testo + immagine', category: 'media', icon: WB_ICONS.split,
    description: 'Testo a sinistra, immagine a destra.',
    create: () => base('text-image', {
      name: 'Testo + immagine',
      content: { title: t('Un titolo'), text: t('Il testo accanto all’immagine.'), image: {}, buttons: [] },
      layout: { ...WB_DEFAULT_LAYOUT, gap: 48 },
      settings: { mediaRatio: '4/3' },
    }),
    fields: [F.eyebrow, F.title, F.text, F.image, F.video, F.buttons,
      { path: 'layout.reverse', label: 'Inverti le colonne', type: 'toggle', group: 'layout' },
      { path: 'settings.mediaRatio', label: 'Proporzione media', type: 'select', group: 'layout', options: F.aspectRatio.options },
    ],
  },
  {
    type: 'image-text', label: 'Immagine + testo', category: 'media', icon: WB_ICONS.split,
    description: 'Immagine a sinistra, testo a destra.',
    create: () => base('image-text', {
      name: 'Immagine + testo',
      content: { title: t('Un titolo'), text: t('Il testo accanto all’immagine.'), image: {}, buttons: [] },
      layout: { ...WB_DEFAULT_LAYOUT, gap: 48 },
      settings: { mediaRatio: '4/3' },
    }),
    fields: [F.eyebrow, F.title, F.text, F.image, F.video, F.buttons,
      { path: 'layout.reverse', label: 'Inverti le colonne', type: 'toggle', group: 'layout' },
      { path: 'settings.mediaRatio', label: 'Proporzione media', type: 'select', group: 'layout', options: F.aspectRatio.options },
    ],
  },

  // ── Contenuti ──
  {
    type: 'cards', label: 'Schede', category: 'contenuti', icon: WB_ICONS.cards,
    description: 'Griglia di schede con foto, titolo e pulsante.',
    supportsData: true,
    create: () => base('cards', {
      name: 'Schede',
      content: {
        items: [
          item({ title: t('Prima scheda'), text: t('Descrizione breve.'), image: {} }),
          item({ title: t('Seconda scheda'), text: t('Descrizione breve.'), image: {} }),
          item({ title: t('Terza scheda'), text: t('Descrizione breve.'), image: {} }),
        ],
      },
      dataSource: { kind: 'manual' },
      layout: { ...WB_DEFAULT_LAYOUT, columns: 3, gap: 24 },
      settings: { cardVariant: 'boxed', aspectRatio: '16/9', showPrice: true },
    }),
    fields: [
      F.eyebrow, F.title, F.subtitle,
      { path: 'content.items', label: 'Schede', type: 'items', group: 'content', itemFields: ITEM_CARD, when: (b) => !b.dataSource || b.dataSource.kind === 'manual' },
      F.columns, F.aspectRatio,
      {
        path: 'settings.cardVariant', label: 'Aspetto della scheda', type: 'select', group: 'style',
        options: [{ value: 'boxed', label: 'Con riquadro' }, { value: 'cover', label: 'Foto a tutta scheda' }],
      },
      { path: 'settings.showPrice', label: 'Mostra il prezzo', type: 'toggle', group: 'content' },
    ],
  },
  {
    type: 'grid', label: 'Griglia', category: 'contenuti', icon: WB_ICONS.cards,
    description: 'Come le schede, senza riquadro.',
    supportsData: true,
    create: () => base('grid', {
      name: 'Griglia',
      content: { items: [item({ title: t('Voce 1'), image: {} }), item({ title: t('Voce 2'), image: {} }), item({ title: t('Voce 3'), image: {} }), item({ title: t('Voce 4'), image: {} })] },
      dataSource: { kind: 'manual' },
      layout: { ...WB_DEFAULT_LAYOUT, columns: 4, gap: 20 },
      settings: { cardVariant: 'cover', aspectRatio: '3/4' },
    }),
    fields: [F.title, { path: 'content.items', label: 'Elementi', type: 'items', group: 'content', itemFields: ITEM_CARD, when: (b) => !b.dataSource || b.dataSource.kind === 'manual' }, F.columns, F.aspectRatio],
  },
  {
    type: 'stats', label: 'Statistiche', category: 'contenuti', icon: WB_ICONS.stats,
    description: 'Numeri grandi con etichetta.',
    create: () => base('stats', {
      name: 'Statistiche',
      content: { items: [item({ value: '250+', title: t('Veicoli') }), item({ value: '15', title: t('Anni') }), item({ value: '4.9', title: t('Valutazione') })] },
      layout: { ...WB_DEFAULT_LAYOUT, columns: 3, align: 'center' },
    }),
    fields: [F.title, { path: 'content.items', label: 'Numeri', type: 'items', group: 'content', itemFields: ITEM_STAT }, F.columns],
  },
  {
    type: 'counters', label: 'Contatori', category: 'contenuti', icon: WB_ICONS.stats,
    description: 'Statistiche che contano fino al numero.',
    create: () => base('counters', {
      name: 'Contatori',
      content: { items: [item({ value: '1200', title: t('Clienti') }), item({ value: '98', title: t('Soddisfatti %') })] },
      settings: { animate: true },
      layout: { ...WB_DEFAULT_LAYOUT, columns: 2, align: 'center' },
    }),
    fields: [F.title, { path: 'content.items', label: 'Numeri', type: 'items', group: 'content', itemFields: ITEM_STAT }, F.columns, { path: 'settings.animate', label: 'Anima il conteggio', type: 'toggle', group: 'style' }],
  },
  {
    type: 'logos', label: 'Loghi', category: 'contenuti', icon: WB_ICONS.logos,
    description: 'Una fila di loghi.',
    create: () => base('logos', {
      name: 'Loghi',
      content: { items: [item({ image: {} }), item({ image: {} }), item({ image: {} })] },
      settings: { logoHeight: 44, logoOpacity: 0.75 },
    }),
    fields: [F.title, { path: 'content.items', label: 'Loghi', type: 'items', group: 'content', itemFields: ITEM_IMAGE },
      { path: 'settings.logoHeight', label: 'Altezza logo', type: 'slider', group: 'layout', min: 20, max: 140, step: 2, unit: 'px' },
      { path: 'settings.logoOpacity', label: 'Trasparenza', type: 'slider', group: 'style', min: 0.2, max: 1, step: 0.05 },
    ],
  },
  {
    type: 'partners', label: 'Partner', category: 'contenuti', icon: WB_ICONS.logos,
    description: 'Loghi dei partner con collegamento.',
    create: () => base('partners', {
      name: 'Partner',
      content: { title: t('I nostri partner'), items: [item({ image: {} }), item({ image: {} })] },
      settings: { logoHeight: 52, logoOpacity: 1 },
    }),
    fields: [F.title, { path: 'content.items', label: 'Partner', type: 'items', group: 'content', itemFields: ITEM_IMAGE },
      { path: 'settings.logoHeight', label: 'Altezza logo', type: 'slider', group: 'layout', min: 20, max: 140, step: 2, unit: 'px' },
    ],
  },
  {
    type: 'reviews', label: 'Recensioni', category: 'contenuti', icon: WB_ICONS.reviews,
    description: 'Recensioni dei clienti.',
    supportsData: true,
    create: () => base('reviews', {
      name: 'Recensioni',
      content: { title: t('Cosa dicono di noi'), items: [item({ text: t('Servizio impeccabile.'), title: t('Marco R.'), meta: { rating: 5 } })] },
      dataSource: { kind: 'manual', collection: 'reviews' },
      layout: { ...WB_DEFAULT_LAYOUT, columns: 3, align: 'center' },
      settings: { showRating: true },
    }),
    fields: [F.title, F.subtitle, { path: 'content.items', label: 'Recensioni', type: 'items', group: 'content', itemFields: ITEM_REVIEW, when: (b) => !b.dataSource || b.dataSource.kind === 'manual' }, F.columns, { path: 'settings.showRating', label: 'Mostra le stelle', type: 'toggle', group: 'style' }],
  },
  {
    type: 'testimonials', label: 'Testimonianze', category: 'contenuti', icon: WB_ICONS.reviews,
    description: 'Citazioni con foto e ruolo.',
    create: () => base('testimonials', {
      name: 'Testimonianze',
      content: { title: t('Testimonianze'), items: [item({ text: t('Una citazione.'), title: t('Nome Cognome'), subtitle: t('Ruolo'), meta: { rating: 5 } })] },
      layout: { ...WB_DEFAULT_LAYOUT, columns: 2, align: 'center' },
      settings: { showRating: false },
    }),
    fields: [F.title, { path: 'content.items', label: 'Testimonianze', type: 'items', group: 'content', itemFields: ITEM_REVIEW }, F.columns, { path: 'settings.showRating', label: 'Mostra le stelle', type: 'toggle', group: 'style' }],
  },
  {
    type: 'faq', label: 'Domande frequenti', category: 'contenuti', icon: WB_ICONS.faq,
    description: 'Domande che si aprono al clic.',
    create: () => base('faq', {
      name: 'Domande frequenti',
      content: { title: t('Domande frequenti'), items: [item({ title: t('Prima domanda?'), text: t('La risposta.') }), item({ title: t('Seconda domanda?'), text: t('La risposta.') })] },
      settings: { firstOpen: true, multiple: false },
      layout: { ...WB_DEFAULT_LAYOUT, align: 'center' },
    }),
    fields: [F.title, F.subtitle, { path: 'content.items', label: 'Domande', type: 'items', group: 'content', itemFields: ITEM_SIMPLE },
      { path: 'settings.firstOpen', label: 'Prima domanda gia' + ' aperta', type: 'toggle', group: 'style' },
      { path: 'settings.multiple', label: 'Piu' + ' risposte aperte insieme', type: 'toggle', group: 'style' },
    ],
  },
  {
    type: 'accordion', label: 'Fisarmonica', category: 'contenuti', icon: WB_ICONS.faq,
    description: 'Sezioni richiudibili.',
    create: () => base('accordion', {
      name: 'Fisarmonica',
      content: { items: [item({ title: t('Sezione 1'), text: t('Contenuto.') })] },
      settings: { firstOpen: false, multiple: true },
    }),
    fields: [F.title, { path: 'content.items', label: 'Sezioni', type: 'items', group: 'content', itemFields: ITEM_SIMPLE },
      { path: 'settings.multiple', label: 'Piu' + ' sezioni aperte insieme', type: 'toggle', group: 'style' },
    ],
  },
  {
    type: 'tabs', label: 'Schede a linguette', category: 'contenuti', icon: WB_ICONS.tabs,
    description: 'Contenuti che si alternano con le linguette.',
    create: () => base('tabs', {
      name: 'Linguette',
      content: { items: [item({ title: t('Prima'), text: t('Contenuto della prima.') }), item({ title: t('Seconda'), text: t('Contenuto della seconda.') })] },
    }),
    fields: [F.title, { path: 'content.items', label: 'Linguette', type: 'items', group: 'content', itemFields: [...ITEM_SIMPLE, { path: 'image', label: 'Immagine', type: 'media', group: 'content' }] }],
  },
  {
    type: 'timeline', label: 'Cronologia', category: 'contenuti', icon: WB_ICONS.timeline,
    description: 'Tappe in ordine di tempo.',
    create: () => base('timeline', {
      name: 'Cronologia',
      content: { title: t('La nostra storia'), items: [item({ value: '2019', title: t('Nascita'), text: t('') }), item({ value: '2024', title: t('Oggi'), text: t('') })] },
      layout: { ...WB_DEFAULT_LAYOUT, width: 'narrow' },
    }),
    fields: [F.title, { path: 'content.items', label: 'Tappe', type: 'items', group: 'content', itemFields: ITEM_TIMELINE }],
  },

  // ── Dati dal gestionale ──
  {
    type: 'fleet', label: 'Flotta', category: 'dati', icon: WB_ICONS.vehicles,
    description: 'I veicoli veri del gestionale. Il builder sceglie quali e come mostrarli.',
    supportsData: true,
    create: () => base('fleet', {
      name: 'Flotta',
      content: { title: t('La nostra flotta') },
      dataSource: { kind: 'auto', collection: 'vehicles', business: 'terra', limit: 6 },
      layout: { ...WB_DEFAULT_LAYOUT, columns: 3, gap: 24, align: 'center' },
      settings: { cardVariant: 'cover', aspectRatio: '3/4', showPrice: true },
    }),
    fields: [
      F.eyebrow, F.title, F.subtitle, F.columns, F.aspectRatio,
      { path: 'settings.cardVariant', label: 'Aspetto della scheda', type: 'select', group: 'style', options: [{ value: 'cover', label: 'Foto a tutta scheda' }, { value: 'boxed', label: 'Con riquadro' }] },
      { path: 'settings.showPrice', label: 'Mostra il prezzo', type: 'toggle', group: 'content' },
    ],
  },
  {
    type: 'vehicles', label: 'Veicoli scelti', category: 'dati', icon: WB_ICONS.vehicles,
    description: 'Solo i veicoli che scegli tu, presi dal gestionale.',
    supportsData: true,
    create: () => base('vehicles', {
      name: 'Veicoli scelti',
      content: { title: t('In evidenza') },
      dataSource: { kind: 'ids', collection: 'vehicles', business: 'terra', ids: [] },
      layout: { ...WB_DEFAULT_LAYOUT, columns: 3, gap: 24 },
      settings: { cardVariant: 'cover', aspectRatio: '3/4', showPrice: true },
    }),
    fields: [F.title, F.subtitle, F.columns, F.aspectRatio, { path: 'settings.showPrice', label: 'Mostra il prezzo', type: 'toggle', group: 'content' }],
  },
  {
    type: 'categories', label: 'Categorie', category: 'dati', icon: WB_ICONS.cards,
    description: 'Le categorie della Centralina Pro.',
    supportsData: true,
    create: () => base('categories', {
      name: 'Categorie',
      content: { title: t('Esplora') },
      dataSource: { kind: 'auto', collection: 'categories' },
      layout: { ...WB_DEFAULT_LAYOUT, columns: 2, gap: 32 },
      settings: { cardVariant: 'cover', aspectRatio: '16/9', showPrice: false },
    }),
    fields: [F.title, F.subtitle, F.columns, F.aspectRatio, { path: 'settings.cardVariant', label: 'Aspetto della scheda', type: 'select', group: 'style', options: [{ value: 'cover', label: 'Foto a tutta scheda' }, { value: 'boxed', label: 'Con riquadro' }] }],
  },
  {
    type: 'services', label: 'Servizi', category: 'dati', icon: WB_ICONS.services,
    description: 'Il listino di Lavaggio & Meccanica.',
    supportsData: true,
    create: () => base('services', {
      name: 'Servizi',
      content: { title: t('I nostri servizi') },
      dataSource: { kind: 'auto', collection: 'services', limit: 9 },
      layout: { ...WB_DEFAULT_LAYOUT, columns: 3, gap: 24 },
      settings: { cardVariant: 'boxed', aspectRatio: '16/9', showPrice: true },
    }),
    fields: [F.title, F.subtitle, F.columns, { path: 'settings.showPrice', label: 'Mostra il prezzo', type: 'toggle', group: 'content' }],
  },
  {
    type: 'products', label: 'Prodotti', category: 'dati', icon: WB_ICONS.cards,
    description: 'Schede prodotto con prezzo.',
    supportsData: true,
    create: () => base('products', {
      name: 'Prodotti',
      content: { title: t('Prodotti'), items: [item({ title: t('Prodotto'), price: '€ 0', image: {} })] },
      dataSource: { kind: 'manual' },
      layout: { ...WB_DEFAULT_LAYOUT, columns: 4, gap: 20 },
      settings: { cardVariant: 'boxed', aspectRatio: '1/1', showPrice: true },
    }),
    fields: [F.title, { path: 'content.items', label: 'Prodotti', type: 'items', group: 'content', itemFields: ITEM_CARD, when: (b) => !b.dataSource || b.dataSource.kind === 'manual' }, F.columns, F.aspectRatio],
  },
  {
    type: 'promotions', label: 'Promozioni', category: 'dati', icon: WB_ICONS.promo,
    description: 'Le promozioni attive in questo momento.',
    supportsData: true,
    create: () => base('promotions', {
      name: 'Promozioni',
      content: { title: t('Promozioni') },
      dataSource: { kind: 'auto', collection: 'promotions', limit: 3 },
      layout: { ...WB_DEFAULT_LAYOUT, columns: 3, gap: 24 },
      settings: { cardVariant: 'boxed', aspectRatio: '16/9', showPrice: false },
    }),
    fields: [F.title, F.subtitle, F.columns],
  },
  {
    type: 'offers', label: 'Offerte', category: 'dati', icon: WB_ICONS.promo,
    description: 'Offerte scritte a mano, con etichetta e scadenza.',
    create: () => base('offers', {
      name: 'Offerte',
      content: { title: t('Offerte'), items: [item({ title: t('Offerta'), badge: t('-20%'), image: {} })] },
      dataSource: { kind: 'manual' },
      layout: { ...WB_DEFAULT_LAYOUT, columns: 3, gap: 24 },
      settings: { cardVariant: 'boxed', aspectRatio: '16/9' },
    }),
    fields: [F.title, { path: 'content.items', label: 'Offerte', type: 'items', group: 'content', itemFields: ITEM_CARD }, F.columns],
  },

  // ── Interazione ──
  {
    type: 'cta', label: 'Invito all’azione', category: 'interazione', icon: WB_ICONS.cta,
    description: 'Titolo, frase e pulsanti al centro.',
    create: () => base('cta', {
      name: 'Invito all’azione',
      content: { title: t('Pronto a partire?'), text: t('Prenota in meno di due minuti.'), buttons: [btn('Prenota ora', '/flotta'), btn('Contattaci', '/contact', 'outline')] },
      layout: { ...WB_DEFAULT_LAYOUT, align: 'center', padTop: 80, padBottom: 80 },
      style: { ...WB_DEFAULT_STYLE, bgColor: 'var(--wb-color-surface)' },
    }),
    fields: [F.eyebrow, F.title, F.text, F.buttons],
  },
  {
    type: 'buttons', label: 'Pulsanti', category: 'interazione', icon: WB_ICONS.button,
    description: 'Solo pulsanti.',
    create: () => base('buttons', {
      name: 'Pulsanti',
      content: { buttons: [btn('Pulsante', '/')] },
      layout: { ...WB_DEFAULT_LAYOUT, align: 'center', padTop: 24, padBottom: 24 },
    }),
    fields: [F.buttons],
  },
  {
    type: 'form', label: 'Modulo', category: 'interazione', icon: WB_ICONS.form,
    description: 'Modulo di contatto configurabile.',
    create: () => base('form', {
      name: 'Modulo',
      content: {
        title: t('Scrivici'),
        fields: [
          { id: wbId('f'), name: 'nome', label: t('Nome'), type: 'text', required: true, width: 'half' },
          { id: wbId('f'), name: 'email', label: t('Email'), type: 'email', required: true, width: 'half' },
          { id: wbId('f'), name: 'telefono', label: t('Telefono'), type: 'tel', width: 'half' },
          { id: wbId('f'), name: 'messaggio', label: t('Messaggio'), type: 'textarea', required: true, width: 'full' },
        ],
        privacyLabel: t('Ho letto e accetto l’informativa privacy.'),
        successMessage: t('Grazie, ti risponderemo presto.'),
        buttons: [btn('Invia', '#')],
      },
      layout: { ...WB_DEFAULT_LAYOUT, width: 'narrow', align: 'center' },
    }),
    fields: [
      F.title, F.subtitle,
      { path: 'content.fields', label: 'Campi del modulo', type: 'form-fields', group: 'content' },
      { path: 'content.privacyLabel', label: 'Testo della spunta privacy', type: 'i18n', group: 'content', help: 'Lascia vuoto per non chiedere il consenso (sconsigliato).' },
      { path: 'content.successMessage', label: 'Messaggio di conferma', type: 'i18n', group: 'content' },
      F.buttons,
      { path: 'settings.destinationEmail', label: 'Email di destinazione', type: 'text', group: 'advanced', help: 'Vuoto = l’indirizzo delle Impostazioni globali.' },
    ],
  },
  {
    type: 'newsletter', label: 'Newsletter', category: 'interazione', icon: WB_ICONS.form,
    description: 'Iscrizione con la sola email.',
    create: () => base('newsletter', {
      name: 'Newsletter',
      content: {
        title: t('Resta aggiornato'),
        fields: [{ id: wbId('f'), name: 'email', label: t('Email'), type: 'email', required: true, width: 'full' }],
        privacyLabel: t('Acconsento a ricevere comunicazioni commerciali.'),
        successMessage: t('Iscrizione registrata.'),
        buttons: [btn('Iscrivimi', '#')],
      },
      layout: { ...WB_DEFAULT_LAYOUT, width: 'narrow', align: 'center' },
    }),
    fields: [F.title, F.subtitle, { path: 'content.fields', label: 'Campi', type: 'form-fields', group: 'content' }, { path: 'content.privacyLabel', label: 'Testo del consenso', type: 'i18n', group: 'content' }, { path: 'content.successMessage', label: 'Messaggio di conferma', type: 'i18n', group: 'content' }, F.buttons],
  },
  {
    type: 'contact', label: 'Contatti', category: 'interazione', icon: WB_ICONS.form,
    description: 'Modulo contatti con i dati aziendali.',
    create: () => base('contact', {
      name: 'Contatti',
      content: {
        title: t('Contattaci'),
        fields: [
          { id: wbId('f'), name: 'nome', label: t('Nome'), type: 'text', required: true, width: 'half' },
          { id: wbId('f'), name: 'email', label: t('Email'), type: 'email', required: true, width: 'half' },
          { id: wbId('f'), name: 'messaggio', label: t('Messaggio'), type: 'textarea', required: true, width: 'full' },
        ],
        privacyLabel: t('Ho letto e accetto l’informativa privacy.'),
        successMessage: t('Messaggio inviato.'),
        buttons: [btn('Invia', '#')],
      },
      layout: { ...WB_DEFAULT_LAYOUT, width: 'narrow' },
    }),
    fields: [F.title, F.subtitle, { path: 'content.fields', label: 'Campi', type: 'form-fields', group: 'content' }, { path: 'content.privacyLabel', label: 'Testo della spunta privacy', type: 'i18n', group: 'content' }, F.buttons],
  },
  {
    type: 'map', label: 'Mappa', category: 'interazione', icon: WB_ICONS.map,
    description: 'Mappa di un indirizzo.',
    create: () => base('map', {
      name: 'Mappa',
      content: { address: 'Cagliari, Italia' },
      layout: { ...WB_DEFAULT_LAYOUT, minHeight: 420 },
    }),
    fields: [F.title, { path: 'content.address', label: 'Indirizzo', type: 'text', group: 'content' },
      { path: 'content.embedUrl', label: 'Indirizzo mappa da incorporare', type: 'text', group: 'advanced', help: 'Solo Google Maps o OpenStreetMap.' },
      { path: 'layout.minHeight', label: 'Altezza', type: 'slider', group: 'layout', min: 200, max: 800, step: 20, unit: 'px' },
    ],
  },
  {
    type: 'social', label: 'Social', category: 'interazione', icon: WB_ICONS.social,
    description: 'Collegamenti ai profili social.',
    create: () => base('social', {
      name: 'Social',
      content: { items: [item({ title: t('Instagram'), link: { href: 'https://instagram.com', kind: 'url' } })] },
      settings: { iconSize: 22 },
      layout: { ...WB_DEFAULT_LAYOUT, align: 'center', padTop: 32, padBottom: 32 },
    }),
    fields: [F.title, { path: 'content.items', label: 'Profili', type: 'items', group: 'content', itemFields: ITEM_SOCIAL },
      { path: 'settings.iconSize', label: 'Dimensione icona', type: 'slider', group: 'layout', min: 14, max: 40, step: 1, unit: 'px' },
    ],
  },

  // ── Struttura ──
  {
    type: 'banner', label: 'Striscia', category: 'struttura', icon: WB_ICONS.banner,
    description: 'Una fascia colorata con testo e pulsante.',
    create: () => base('banner', {
      name: 'Striscia',
      content: { title: t('Offerta speciale'), text: t('Valida fino a fine mese.'), buttons: [btn('Scopri', '/')] },
      layout: { ...WB_DEFAULT_LAYOUT, padTop: 0, padBottom: 0 },
      style: { ...WB_DEFAULT_STYLE, bgColor: 'var(--wb-color-primary)', textColor: '#000000' },
    }),
    fields: [F.title, F.text, F.buttons],
  },
  {
    type: 'divider', label: 'Separatore', category: 'struttura', icon: WB_ICONS.divider,
    description: 'Una linea.',
    create: () => base('divider', {
      name: 'Separatore',
      settings: { thickness: 1, dividerWidth: 100 },
      layout: { ...WB_DEFAULT_LAYOUT, padTop: 24, padBottom: 24 },
    }),
    fields: [
      { path: 'settings.thickness', label: 'Spessore', type: 'slider', group: 'style', min: 1, max: 12, step: 1, unit: 'px' },
      { path: 'settings.dividerWidth', label: 'Larghezza', type: 'slider', group: 'layout', min: 10, max: 100, step: 5, unit: '%' },
    ],
  },
  {
    type: 'spacer', label: 'Spazio', category: 'struttura', icon: WB_ICONS.spacer,
    description: 'Uno spazio vuoto.',
    create: () => base('spacer', {
      name: 'Spazio',
      settings: { height: 48 },
      layout: { ...WB_DEFAULT_LAYOUT, padTop: 0, padBottom: 0, padLeft: 0, padRight: 0 },
    }),
    fields: [{ path: 'settings.height', label: 'Altezza', type: 'slider', group: 'layout', min: 8, max: 240, step: 4, unit: 'px' }],
  },
  {
    type: 'html', label: 'HTML / incorporato', category: 'struttura', icon: WB_ICONS.code,
    description: 'Codice o contenuto incorporato. Riservato a chi ha il diritto avanzato.',
    create: () => base('html', { name: 'HTML', content: { html: '' }, settings: { aspectRatio: '16/9' } }),
    fields: [
      { path: 'content.embedUrl', label: 'Indirizzo da incorporare', type: 'text', group: 'content', help: 'YouTube, Vimeo, Google Maps, Spotify, SoundCloud.' },
      { path: 'content.html', label: 'HTML', type: 'html', group: 'advanced', requires: 'website.code', help: 'Ripulito prima della pubblicazione: script e gestori inline vengono tolti.' },
      F.aspectRatio,
    ],
  },
]

export const WB_BLOCK_BY_TYPE: Record<string, WbBlockDef> = Object.fromEntries(
  WB_BLOCKS.map((b) => [b.type, b]),
)

// ─── Campi comuni a tutti i blocchi ─────────────────────────────────────────
/**
 * Aggiunti in coda a quelli specifici del blocco. Sono la parte del
 * pannello che non cambia mai, quindi l'operatore la impara una volta.
 */
export const WB_COMMON_FIELDS: WbFieldDef[] = [
  // Layout
  {
    path: 'layout.width', label: 'Larghezza', type: 'select', group: 'layout',
    options: [
      { value: 'contained', label: 'Normale' },
      { value: 'narrow', label: 'Stretta (testo)' },
      { value: 'full', label: 'Tutto schermo' },
    ],
  },
  { path: 'layout.maxWidth', label: 'Larghezza massima', type: 'number', group: 'layout', min: 320, max: 2400, step: 20, unit: 'px' },
  { path: 'layout.minHeight', label: 'Altezza minima', type: 'number', group: 'layout', min: 0, max: 1200, step: 10, unit: 'px' },
  { path: 'layout.align', label: 'Allineamento', type: 'select', group: 'layout', options: [{ value: 'left', label: 'Sinistra' }, { value: 'center', label: 'Centro' }, { value: 'right', label: 'Destra' }] },
  { path: 'layout.gap', label: 'Spazio tra gli elementi', type: 'slider', group: 'layout', min: 0, max: 96, step: 4, unit: 'px' },
  { path: 'layout.padTop', label: 'Spazio sopra', type: 'slider', group: 'layout', min: 0, max: 240, step: 4, unit: 'px' },
  { path: 'layout.padBottom', label: 'Spazio sotto', type: 'slider', group: 'layout', min: 0, max: 240, step: 4, unit: 'px' },
  { path: 'layout.padLeft', label: 'Spazio a sinistra', type: 'slider', group: 'layout', min: 0, max: 160, step: 4, unit: 'px' },
  { path: 'layout.padRight', label: 'Spazio a destra', type: 'slider', group: 'layout', min: 0, max: 160, step: 4, unit: 'px' },

  // Stile
  { path: 'style.bgColor', label: 'Colore di sfondo', type: 'color', group: 'style' },
  { path: 'style.textColor', label: 'Colore del testo', type: 'color', group: 'style' },
  { path: 'style.gradient', label: 'Sfumatura', type: 'gradient', group: 'style' },
  { path: 'style.bgImage', label: 'Immagine di sfondo', type: 'media', group: 'style' },
  { path: 'style.bgImageMobile', label: 'Immagine di sfondo (telefono)', type: 'media', group: 'style', help: 'Facoltativa: se manca si usa quella normale.' },
  { path: 'style.bgVideo', label: 'Video di sfondo', type: 'video', group: 'style' },
  { path: 'style.overlayColor', label: 'Colore della velatura', type: 'color', group: 'style' },
  { path: 'style.overlayOpacity', label: 'Intensita’ della velatura', type: 'slider', group: 'style', min: 0, max: 1, step: 0.05 },
  { path: 'style.borderWidth', label: 'Spessore del bordo', type: 'slider', group: 'style', min: 0, max: 12, step: 1, unit: 'px' },
  { path: 'style.borderColor', label: 'Colore del bordo', type: 'color', group: 'style' },
  { path: 'style.borderRadius', label: 'Angoli arrotondati', type: 'slider', group: 'style', min: 0, max: 48, step: 1, unit: 'px' },
  { path: 'style.shadow', label: 'Ombra', type: 'select', group: 'style', options: [{ value: 'none', label: 'Nessuna' }, { value: 'sm', label: 'Leggera' }, { value: 'md', label: 'Media' }, { value: 'lg', label: 'Forte' }] },
  { path: 'style.opacity', label: 'Trasparenza', type: 'slider', group: 'style', min: 0.1, max: 1, step: 0.05 },
  { path: 'style.backdropBlur', label: 'Sfocatura dietro', type: 'slider', group: 'style', min: 0, max: 24, step: 1, unit: 'px' },

  // Tipografia
  { path: 'typography.preset', label: 'Stile del testo', type: 'select', group: 'style', options: [
    { value: 'inherit', label: 'Dal tema' },
    { value: 'h1', label: 'Titolo H1' }, { value: 'h2', label: 'Titolo H2' }, { value: 'h3', label: 'Titolo H3' },
    { value: 'h4', label: 'Titolo H4' }, { value: 'h5', label: 'Titolo H5' }, { value: 'h6', label: 'Titolo H6' },
    { value: 'body', label: 'Corpo del testo' }, { value: 'small', label: 'Testo piccolo' },
    { value: 'label', label: 'Etichetta' }, { value: 'caption', label: 'Didascalia' },
  ] },
  { path: 'typography.family', label: 'Carattere', type: 'select', group: 'style', options: [
    { value: '', label: 'Dal tema' },
    { value: 'fontPrimary', label: 'Principale' },
    { value: 'fontSecondary', label: 'Secondario' },
    { value: 'fontAccent', label: 'Accento' },
  ] },
  { path: 'typography.size', label: 'Dimensione del testo', type: 'number', group: 'style', min: 10, max: 140, step: 1, unit: 'px' },
  { path: 'typography.weight', label: 'Spessore', type: 'select', group: 'style', options: [300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: String(w), label: String(w) })) },
  { path: 'typography.lineHeight', label: 'Interlinea', type: 'slider', group: 'style', min: 0.9, max: 2.2, step: 0.05 },
  { path: 'typography.letterSpacing', label: 'Spaziatura lettere', type: 'slider', group: 'style', min: -2, max: 8, step: 0.2, unit: 'px' },
  { path: 'typography.transform', label: 'Maiuscole/minuscole', type: 'select', group: 'style', options: [
    { value: 'none', label: 'Come scritto' }, { value: 'uppercase', label: 'TUTTO MAIUSCOLO' },
    { value: 'lowercase', label: 'tutto minuscolo' }, { value: 'capitalize', label: 'Iniziali Maiuscole' },
  ] },
  { path: 'typography.align', label: 'Allineamento testo', type: 'select', group: 'style', options: [
    { value: 'left', label: 'Sinistra' }, { value: 'center', label: 'Centro' },
    { value: 'right', label: 'Destra' }, { value: 'justify', label: 'Giustificato' },
  ] },

  // Responsive
  { path: 'visibility.desktop', label: 'Visibile su schermo grande', type: 'toggle', group: 'responsive' },
  { path: 'visibility.tablet', label: 'Visibile su tablet', type: 'toggle', group: 'responsive' },
  { path: 'visibility.mobile', label: 'Visibile su telefono', type: 'toggle', group: 'responsive' },
  { path: 'responsive.tablet.layout.columns', label: 'Colonne su tablet', type: 'slider', group: 'responsive', min: 1, max: 6, step: 1 },
  { path: 'responsive.mobile.layout.columns', label: 'Colonne su telefono', type: 'slider', group: 'responsive', min: 1, max: 4, step: 1 },
  { path: 'responsive.tablet.layout.padTop', label: 'Spazio sopra (tablet)', type: 'slider', group: 'responsive', min: 0, max: 200, step: 4, unit: 'px' },
  { path: 'responsive.mobile.layout.padTop', label: 'Spazio sopra (telefono)', type: 'slider', group: 'responsive', min: 0, max: 200, step: 4, unit: 'px' },
  { path: 'responsive.mobile.layout.padBottom', label: 'Spazio sotto (telefono)', type: 'slider', group: 'responsive', min: 0, max: 200, step: 4, unit: 'px' },
  { path: 'responsive.mobile.typography.size', label: 'Dimensione testo (telefono)', type: 'number', group: 'responsive', min: 10, max: 96, step: 1, unit: 'px' },
  { path: 'responsive.mobile.layout.minHeight', label: 'Altezza minima (telefono)', type: 'number', group: 'responsive', min: 0, max: 900, step: 10, unit: 'px' },

  // Avanzate
  { path: 'name', label: 'Nome della sezione', type: 'text', group: 'advanced', help: 'Solo per te: serve a ritrovarla nell’elenco.' },
  { path: 'anchorId', label: 'Ancora (#nome)', type: 'anchor', group: 'advanced', help: 'Permette di collegarsi a questa sezione da un menu.' },
  { path: 'animation.type', label: 'Animazione all’ingresso', type: 'select', group: 'advanced', options: [
    { value: 'none', label: 'Nessuna' }, { value: 'fade', label: 'Comparsa' },
    { value: 'fade-up', label: 'Dal basso' }, { value: 'fade-down', label: 'Dall’alto' },
    { value: 'slide-left', label: 'Da destra' }, { value: 'slide-right', label: 'Da sinistra' },
    { value: 'zoom', label: 'Ingrandimento' },
  ], help: 'Chi ha attivato la riduzione dei movimenti non la vede: e’ voluto.' },
  { path: 'animation.duration', label: 'Durata animazione', type: 'slider', group: 'advanced', min: 200, max: 1600, step: 50, unit: 'ms' },
  { path: 'animation.delay', label: 'Ritardo animazione', type: 'slider', group: 'advanced', min: 0, max: 1200, step: 50, unit: 'ms' },
  { path: 'schedule.startsAt', label: 'Mostra a partire da', type: 'datetime', group: 'advanced' },
  { path: 'schedule.endsAt', label: 'Nascondi dopo il', type: 'datetime', group: 'advanced' },
  { path: 'customCss', label: 'CSS della sezione', type: 'css', group: 'advanced', requires: 'website.code', help: 'Usa & per indicare la sezione. Es: & h2 { color: red }' },
]

/** I campi da mostrare per un blocco: i suoi, poi quelli comuni. */
export function wbFieldsFor(block: WbBlock): WbFieldDef[] {
  const def = WB_BLOCK_BY_TYPE[block.type]
  const own = def?.fields || []
  return [...own, ...WB_COMMON_FIELDS].filter((f) => !f.when || f.when(block))
}

/** Crea un blocco nuovo del tipo richiesto. */
export function wbCreateBlock(type: string): WbBlock | null {
  const def = WB_BLOCK_BY_TYPE[type]
  return def ? def.create() : null
}

/** Copia profonda con id nuovi: duplicare non deve mai condividere un id. */
export function wbCloneBlock(block: WbBlock): WbBlock {
  const clone = JSON.parse(JSON.stringify(block)) as WbBlock
  const rewrite = (b: WbBlock) => {
    b.id = wbId()
    const items = (b.content?.items as WbItem[] | undefined)
    if (Array.isArray(items)) items.forEach((i) => { i.id = wbId('i') })
    const buttons = (b.content?.buttons as WbButton[] | undefined)
    if (Array.isArray(buttons)) buttons.forEach((i) => { i.id = wbId('btn') })
    b.children?.forEach(rewrite)
  }
  rewrite(clone)
  return clone
}
