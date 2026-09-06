/**
 * wbSchema.ts — la forma dei dati del Website Builder.
 *
 * ⚠️ FILE CONDIVISO. Esiste identico in due repo:
 *      ~/DR7-staging/src/pages/admin/components/website/shared/wbSchema.ts
 *      ~/Sito/components/website/wbSchema.ts
 *    Si modifica QUI e si propaga con `npm run wb:sync` (in DR7-staging).
 *    `npm run wb:check` fallisce se le due copie divergono.
 *
 * Perche' condiviso: il gestionale deve mostrare in anteprima ESATTAMENTE
 * cio' che il sito rendera'. Due implementazioni separate divergono al
 * primo ritocco e l'anteprima diventa una bugia.
 *
 * Perche' nessuna dipendenza: questo file importa SOLO React nei file
 * fratelli. Nessun router, nessun Tailwind, nessun contesto: i due repo
 * hanno versioni diverse di Tailwind (3 nel sito, 4 nel gestionale) e
 * router diversi. Tutto cio' che varia entra dal `WbRenderContext`.
 *
 * Regola di stile: lo stile guidato dal builder e' SEMPRE inline o in una
 * regola CSS generata. Mai una classe Tailwind composta a runtime — non
 * verrebbe generata in nessuno dei due repo.
 */

// ─── Lingue e schermi ───────────────────────────────────────────────────────
export type WbLocale = 'it' | 'en'
export type WbDevice = 'desktop' | 'tablet' | 'mobile'

/** Testo bilingue. Campo assente = si ripiega sull'altra lingua. */
export interface WbText {
  it?: string
  en?: string
}

export function wbText(t: WbText | string | undefined | null, lang: WbLocale): string {
  if (t == null) return ''
  if (typeof t === 'string') return t
  const primary = lang === 'en' ? t.en : t.it
  if (primary && primary.trim()) return primary
  const fallback = lang === 'en' ? t.it : t.en
  return (fallback || '').trim()
}

// ─── Proprieta' di un blocco ────────────────────────────────────────────────
export interface WbLayout {
  /** contained = dentro il contenitore centrale, full = a tutta larghezza. */
  width?: 'contained' | 'narrow' | 'full'
  maxWidth?: number
  minHeight?: number
  columns?: number
  align?: 'left' | 'center' | 'right'
  justify?: 'start' | 'center' | 'end' | 'between'
  verticalAlign?: 'start' | 'center' | 'end'
  gap?: number
  padTop?: number
  padRight?: number
  padBottom?: number
  padLeft?: number
  marginTop?: number
  marginBottom?: number
  /** Inverte l'ordine delle due colonne (testo+immagine). */
  reverse?: boolean
  overflow?: 'visible' | 'hidden'
}

export interface WbGradient {
  from: string
  to: string
  angle: number
}

export interface WbStyle {
  textColor?: string
  bgColor?: string
  gradient?: WbGradient | null
  bgImage?: string
  bgImageMobile?: string
  bgVideo?: string
  bgSize?: 'cover' | 'contain' | 'auto'
  bgPosition?: string
  bgAttachment?: 'scroll' | 'fixed'
  overlayColor?: string
  overlayOpacity?: number
  opacity?: number
  borderColor?: string
  borderWidth?: number
  borderRadius?: number
  shadow?: 'none' | 'sm' | 'md' | 'lg'
  blur?: number
  backdropBlur?: number
}

export type WbTypeScaleKey =
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'body' | 'small' | 'label' | 'button' | 'menu' | 'caption'

export interface WbTypography {
  /** Stile globale ereditato dal Design System. 'custom' = tutto locale. */
  preset?: WbTypeScaleKey | 'custom' | 'inherit'
  family?: string
  size?: number
  sizeTablet?: number
  sizeMobile?: number
  weight?: number
  lineHeight?: number
  letterSpacing?: number
  transform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  align?: 'left' | 'center' | 'right' | 'justify'
  fontStyle?: 'normal' | 'italic'
}

export interface WbVisibility {
  desktop: boolean
  tablet: boolean
  mobile: boolean
}

export type WbAnimationType =
  | 'none' | 'fade' | 'fade-up' | 'fade-down'
  | 'slide-left' | 'slide-right' | 'zoom'

export interface WbAnimation {
  type: WbAnimationType
  duration?: number
  delay?: number
}

/**
 * Da dove arrivano gli elementi ripetuti di un blocco.
 *
 * `manual` = scritti a mano nel builder (contenuto editoriale).
 * Tutto il resto legge i DATI VERI del gestionale: il builder decide
 * quali mostrare e come, mai cosa contengono. Vedi WbRenderContext.
 */
export interface WbDataSource {
  kind: 'manual' | 'auto' | 'category' | 'ids' | 'latest' | 'featured' | 'available' | 'custom'
  /** Quale insieme di dati: veicoli, servizi, categorie, promozioni... */
  collection?: 'vehicles' | 'categories' | 'services' | 'promotions' | 'reviews' | 'posts'
  business?: 'terra' | 'mare' | 'aria' | 'stay' | 'lavaggio'
  categoryId?: string
  ids?: string[]
  limit?: number
  orderBy?: string
  filter?: Record<string, unknown>
}

export interface WbLink {
  href?: string
  /** 'page' = slug interno, 'url' = indirizzo esterno, 'anchor' = #id. */
  kind?: 'page' | 'url' | 'anchor' | 'none'
  target?: '_self' | '_blank'
  rel?: string
}

export interface WbButton extends WbLink {
  id: string
  label: WbText
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  icon?: string
  fullWidth?: boolean
  /** Sovrascrive il preset globale del pulsante solo per questo pulsante. */
  override?: Partial<WbButtonStyle>
}

export interface WbButtonStyle {
  bg: string
  text: string
  border: string
  hoverBg: string
  hoverText: string
  radius: number
  padX: number
  padY: number
}

/** Immagine con tutto cio' che serve a renderla accessibile e responsive. */
export interface WbImage {
  url?: string
  urlMobile?: string
  alt?: WbText
  title?: string
  caption?: WbText
  focalX?: number
  focalY?: number
  width?: number
  height?: number
}

export interface WbVideo {
  url?: string
  poster?: string
  autoplay?: boolean
  loop?: boolean
  muted?: boolean
  controls?: boolean
  preload?: 'none' | 'metadata' | 'auto'
}

/** Elemento ripetuto: card, slide, voce FAQ, statistica, logo... */
export interface WbItem {
  id: string
  title?: WbText
  subtitle?: WbText
  text?: WbText
  image?: WbImage
  video?: WbVideo
  icon?: string
  badge?: WbText
  price?: string
  value?: string
  link?: WbLink
  buttons?: WbButton[]
  meta?: Record<string, unknown>
}

export interface WbResponsiveOverride {
  layout?: Partial<WbLayout>
  style?: Partial<WbStyle>
  typography?: Partial<WbTypography>
}

export interface WbBlock {
  id: string
  type: string
  /** Nome dato dall'operatore, per ritrovarla nell'elenco delle sezioni. */
  name?: string
  hidden?: boolean
  visibility?: WbVisibility
  content?: Record<string, unknown>
  settings?: Record<string, unknown>
  layout?: WbLayout
  style?: WbStyle
  typography?: WbTypography
  animation?: WbAnimation
  dataSource?: WbDataSource
  responsive?: { tablet?: WbResponsiveOverride; mobile?: WbResponsiveOverride }
  /** Finestra di visibilita' programmata (ISO). */
  schedule?: { startsAt?: string | null; endsAt?: string | null }
  children?: WbBlock[]
  /** CSS avanzato: solo per chi ha il diritto website.code. */
  customCss?: string
  anchorId?: string
}

export interface WbPageContent {
  sections: WbBlock[]
  /** Impostazioni della singola pagina (tema locale, header/footer nascosti). */
  settings?: {
    hideHeader?: boolean
    hideFooter?: boolean
    themeId?: string | null
    bgColor?: string
    customCss?: string
  }
}

// ─── SEO ────────────────────────────────────────────────────────────────────
export interface WbSeo {
  title?: WbText
  description?: WbText
  canonical?: string
  robotsIndex?: boolean
  robotsFollow?: boolean
  ogTitle?: WbText
  ogDescription?: WbText
  ogImage?: string
  twitterCard?: 'summary' | 'summary_large_image'
  structuredData?: string
}

// ─── Tema / Design System ───────────────────────────────────────────────────
export interface WbTypeScale {
  family: 'fontPrimary' | 'fontSecondary' | 'fontAccent' | string
  size: number
  sizeTablet?: number
  sizeMobile?: number
  weight: number
  lineHeight: number
  letterSpacing: number
  transform: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
}

export interface WbThemeTokens {
  colors: Record<string, string>
  typography: {
    fontPrimary: string
    fontSecondary: string
    fontAccent: string
    /** Font Google da caricare (oltre a quelli gia' presenti nel sito). */
    googleFonts?: string[]
    scales: Record<WbTypeScaleKey, WbTypeScale>
  }
  radius: Record<string, number>
  spacing: Record<string, number>
  buttons: Record<'primary' | 'secondary' | 'outline' | 'ghost', WbButtonStyle>
  effects: Record<string, string>
  card: { bg: string; border: string; radius: number; shadow: string; pad: number }
  /** CSS libero applicato a tutto il sito (diritto website.code). */
  customCss?: string
}

export interface WbTheme {
  id: string
  name: string
  tokens: WbThemeTokens
}

// ─── Navigazione ────────────────────────────────────────────────────────────
export interface WbMenuItem {
  id: string
  label: WbText
  kind: 'page' | 'url' | 'anchor' | 'group' | 'cta'
  href?: string
  target?: '_self' | '_blank'
  icon?: string
  children?: WbMenuItem[]
  /** Il gruppo si apre come mega menu invece che come tendina semplice. */
  mega?: boolean
  visible?: boolean
}

export interface WbHeaderConfig {
  items: WbMenuItem[]
  settings?: {
    logo?: string
    logoDark?: string
    logoLight?: string
    logoHeight?: number
    logoHeightMobile?: number
    align?: 'left' | 'center' | 'right'
    sticky?: boolean
    transparent?: boolean
    bgColor?: string
    textColor?: string
    height?: number
    showLanguage?: boolean
    showLogin?: boolean
    showSocial?: boolean
    cta?: WbButton | null
    mobileMode?: 'drawer' | 'fullscreen'
  }
}

export interface WbFooterColumn {
  id: string
  title: WbText
  items: WbMenuItem[]
}

export interface WbFooterConfig {
  columns: WbFooterColumn[]
  settings?: {
    logo?: string
    logoHeight?: number
    text?: WbText
    copyright?: WbText
    bgColor?: string
    textColor?: string
    showNewsletter?: boolean
    newsletterTitle?: WbText
    showSocial?: boolean
    badges?: WbImage[]
    cta?: WbButton | null
    legalLinks?: WbMenuItem[]
  }
}

// ─── Popup / Banner / Promozioni ────────────────────────────────────────────
export interface WbOverlayTargeting {
  /** Vuoto = tutte le pagine. */
  pages?: string[]
  excludePages?: string[]
  devices?: WbDevice[]
  /** Ogni quante ore ripresentarlo allo stesso visitatore. 0 = sempre. */
  frequencyHours?: number
  delaySeconds?: number
  exitIntent?: boolean
  scrollPercent?: number
}

export interface WbOverlayConfig {
  title?: WbText
  text?: WbText
  image?: WbImage
  video?: WbVideo
  buttons?: WbButton[]
  position?: 'center' | 'bottom-right' | 'bottom-left' | 'top' | 'bottom'
  size?: 'sm' | 'md' | 'lg'
  bgColor?: string
  textColor?: string
  dismissible?: boolean
  blocks?: WbBlock[]
}

export interface WbOverlay {
  id: string
  kind: 'popup' | 'banner' | 'promo'
  name: string
  status: 'draft' | 'scheduled' | 'published' | 'archived'
  config: WbOverlayConfig
  targeting: WbOverlayTargeting
  starts_at?: string | null
  ends_at?: string | null
  sort_order?: number
}

// ─── Istantanea pubblicata ──────────────────────────────────────────────────
export interface WbSnapshotPage {
  id: string
  slug: string
  title: string
  status: 'draft' | 'scheduled' | 'published' | 'archived'
  is_home: boolean
  overrides_route: boolean
  sort_order: number
  seo: WbSeo
  scheduled_at?: string | null
  unpublish_at?: string | null
  published_at?: string | null
  content: WbPageContent
}

export interface WbScript {
  id: string
  name: string
  provider?: string
  placement: 'head' | 'body_start' | 'body_end'
  code: string
  consent_category: 'necessary' | 'analytics' | 'marketing'
}

export interface WbSnapshot {
  schema_version: number
  source: 'published' | 'draft'
  generated_at: string
  site: {
    id: string
    key: string
    tenant_id: string
    name: string
    domain?: string | null
    favicon_url?: string | null
    default_locale: WbLocale
    locales: string[]
    settings: Record<string, unknown>
  }
  theme: WbTheme | null
  navigation: { header?: WbHeaderConfig; footer?: WbFooterConfig }
  pages: WbSnapshotPage[]
  overlays: WbOverlay[]
  scripts: WbScript[]
}

// ─── Valori di partenza ─────────────────────────────────────────────────────
export const WB_DEFAULT_VISIBILITY: WbVisibility = { desktop: true, tablet: true, mobile: true }

export const WB_DEFAULT_LAYOUT: WbLayout = {
  width: 'contained',
  align: 'left',
  justify: 'start',
  verticalAlign: 'center',
  columns: 3,
  gap: 32,
  padTop: 96,
  padBottom: 96,
  padLeft: 24,
  padRight: 24,
  overflow: 'visible',
}

export const WB_DEFAULT_STYLE: WbStyle = {
  bgSize: 'cover',
  bgPosition: 'center',
  overlayOpacity: 0,
  opacity: 1,
  shadow: 'none',
}

export const WB_DEFAULT_TYPOGRAPHY: WbTypography = { preset: 'inherit', align: 'left' }

/** Id stabile e leggibile: si ritrova negli ancoraggi e nel CSS generato. */
export function wbId(prefix = 'b'): string {
  const rnd = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${rnd}`
}

// ─── Sicurezza ──────────────────────────────────────────────────────────────
/**
 * Ripulisce l'HTML libero prima di stamparlo.
 *
 * Il builder NON salva HTML arbitrario per le pagine (blocco 52 del
 * capitolato): l'unico punto in cui dell'HTML scritto a mano finisce nel
 * sito e' il blocco "HTML/embed". Qui cadono script, gestori inline
 * (`onclick`), `javascript:` e i tag che possono rubare la pagina.
 * L'operatore normale non ha nemmeno questo blocco: serve website.code.
 */
export function wbSanitizeHtml(html: string): string {
  if (!html) return ''
  let out = html
  out = out.replace(/<\s*(script|object|embed|link|meta|base|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
  out = out.replace(/<\s*(script|object|embed|link|meta|base)\b[^>]*\/?>/gi, '')
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
  out = out.replace(/javascript\s*:/gi, '')
  out = out.replace(/\sstyle\s*=\s*"[^"]*expression\([^"]*"/gi, '')
  return out
}

const WB_SAFE_URL = /^(https?:\/\/|\/|#|mailto:|tel:|data:image\/)/i

/** Indirizzi accettati in un link o in un media. Blocca `javascript:`. */
export function wbSafeUrl(url: string | undefined | null): string {
  if (!url) return ''
  const trimmed = String(url).trim()
  if (!trimmed) return ''
  return WB_SAFE_URL.test(trimmed) ? trimmed : ''
}

/** Domini ammessi negli embed (mappe, video). */
export const WB_EMBED_ALLOWLIST = [
  'www.google.com', 'maps.google.com', 'www.openstreetmap.org',
  'www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com',
  'player.vimeo.com', 'open.spotify.com', 'w.soundcloud.com',
]

export function wbEmbedAllowed(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && WB_EMBED_ALLOWLIST.includes(u.hostname)
  } catch {
    return false
  }
}

// ─── Indirizzi delle pagine ─────────────────────────────────────────────────
/**
 * `/chi-siamo`, sempre: minuscolo, senza spazi, senza accenti.
 *
 * Sta qui e non nel livello dati perche' e' una regola pura e va provata
 * senza tirarsi dietro il client Supabase.
 */
export function wbNormalizeSlug(input: string): string {
  const s = (input || '').trim().toLowerCase()
  if (!s || s === '/') return '/'
  const clean = s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9/\-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^-|-$/g, '')
    // Niente barra finale: `paginaPerPercorso` confronta gli indirizzi
    // senza, quindi `/chi-siamo/` non troverebbe mai la sua pagina.
    .replace(/\/+$/, '')
  if (!clean || clean === '/') return '/'
  return clean.startsWith('/') ? clean : `/${clean}`
}
