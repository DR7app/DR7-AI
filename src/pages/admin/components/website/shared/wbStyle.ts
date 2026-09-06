/**
 * wbStyle.ts — dai valori del builder al CSS vero.
 *
 * ⚠️ FILE CONDIVISO (vedi wbSchema.ts). Si modifica in DR7-staging e si
 *    propaga con `npm run wb:sync`.
 *
 * Due uscite, e nessuna terza via:
 *   · uno stile inline per tutto cio' che vale su ogni schermo;
 *   · una regola CSS con `@media` per cio' che cambia su tablet/telefono.
 *
 * Nessuna classe Tailwind viene composta a runtime: nel sito e nel
 * gestionale girano due versioni diverse di Tailwind e una classe
 * costruita da un numero non verrebbe generata in nessuna delle due
 * (e' l'inciampo gia' visto con l'altezza del logo).
 */

import type {
  WbBlock, WbDevice, WbLayout, WbStyle, WbTypography,
  WbThemeTokens, WbTypeScaleKey, WbButton, WbButtonStyle, WbAnimation,
} from './wbSchema'
import { wbSafeUrl } from './wbSchema'

export const WB_BREAKPOINT_TABLET = 1024
export const WB_BREAKPOINT_MOBILE = 640

type CSS = Record<string, string | number | undefined>

const px = (v: number | undefined | null): string | undefined =>
  v == null || Number.isNaN(v) ? undefined : `${v}px`

// ─── Tema → variabili CSS ───────────────────────────────────────────────────
/**
 * Il tema diventa un blocco di variabili CSS su un contenitore.
 * Cambiare un colore nel Design System aggiorna ogni componente che usa
 * il token, senza toccare i blocchi — ed e' per questo che i blocchi
 * salvano `var(--wb-color-primary)` e non `#C9A96E`.
 */
export function wbThemeVars(tokens: WbThemeTokens | undefined | null): CSS {
  const vars: CSS = {}
  if (!tokens) return vars

  for (const [k, v] of Object.entries(tokens.colors || {})) {
    vars[`--wb-color-${k}`] = v
  }
  const ty = tokens.typography
  if (ty) {
    vars['--wb-font-primary'] = ty.fontPrimary
    vars['--wb-font-secondary'] = ty.fontSecondary
    vars['--wb-font-accent'] = ty.fontAccent
    for (const [k, s] of Object.entries(ty.scales || {})) {
      vars[`--wb-fs-${k}`] = `${s.size}px`
      vars[`--wb-fw-${k}`] = String(s.weight)
      vars[`--wb-lh-${k}`] = String(s.lineHeight)
    }
  }
  for (const [k, v] of Object.entries(tokens.radius || {})) vars[`--wb-radius-${k}`] = `${v}px`
  for (const [k, v] of Object.entries(tokens.spacing || {})) vars[`--wb-space-${k}`] = `${v}px`
  for (const [k, v] of Object.entries(tokens.effects || {})) vars[`--wb-effect-${k}`] = v
  if (tokens.card) {
    vars['--wb-card-bg'] = tokens.card.bg
    vars['--wb-card-border'] = tokens.card.border
    vars['--wb-card-radius'] = `${tokens.card.radius}px`
    vars['--wb-card-shadow'] = tokens.card.shadow
    vars['--wb-card-pad'] = `${tokens.card.pad}px`
  }
  return vars
}

/** Risolve il nome di una famiglia (fontPrimary/…) nel valore reale. */
export function wbFontFamily(family: string | undefined, tokens?: WbThemeTokens | null): string | undefined {
  if (!family) return undefined
  if (family === 'fontPrimary') return tokens?.typography?.fontPrimary || 'var(--wb-font-primary)'
  if (family === 'fontSecondary') return tokens?.typography?.fontSecondary || 'var(--wb-font-secondary)'
  if (family === 'fontAccent') return tokens?.typography?.fontAccent || 'var(--wb-font-accent)'
  return family
}

// ─── Tipografia ─────────────────────────────────────────────────────────────
/**
 * Stile del testo per un dispositivo.
 *
 * Il preset globale fa da base, i campi locali lo sovrascrivono uno a uno:
 * cosi' l'operatore puo' cambiare il font di tutto il sito dal Design
 * System e lasciare comunque un titolo con la sua eccezione.
 */
export function wbTypographyStyle(
  typo: WbTypography | undefined,
  tokens: WbThemeTokens | undefined | null,
  device: WbDevice = 'desktop',
): CSS {
  const out: CSS = {}
  const presetKey = typo?.preset
  const scale =
    presetKey && presetKey !== 'custom' && presetKey !== 'inherit'
      ? tokens?.typography?.scales?.[presetKey as WbTypeScaleKey]
      : undefined

  if (scale) {
    out.fontFamily = wbFontFamily(scale.family, tokens)
    out.fontSize = px(
      device === 'mobile' ? (scale.sizeMobile ?? scale.size)
      : device === 'tablet' ? (scale.sizeTablet ?? scale.size)
      : scale.size,
    )
    out.fontWeight = scale.weight
    out.lineHeight = scale.lineHeight
    out.letterSpacing = scale.letterSpacing ? `${scale.letterSpacing}px` : undefined
    out.textTransform = scale.transform !== 'none' ? scale.transform : undefined
  }

  if (typo?.family) out.fontFamily = wbFontFamily(typo.family, tokens)
  const localSize =
    device === 'mobile' ? (typo?.sizeMobile ?? typo?.size)
    : device === 'tablet' ? (typo?.sizeTablet ?? typo?.size)
    : typo?.size
  if (localSize != null) out.fontSize = px(localSize)
  if (typo?.weight != null) out.fontWeight = typo.weight
  if (typo?.lineHeight != null) out.lineHeight = typo.lineHeight
  if (typo?.letterSpacing != null) out.letterSpacing = `${typo.letterSpacing}px`
  if (typo?.transform && typo.transform !== 'none') out.textTransform = typo.transform
  if (typo?.align) out.textAlign = typo.align
  if (typo?.fontStyle && typo.fontStyle !== 'normal') out.fontStyle = typo.fontStyle

  return out
}

// ─── Sfondo, bordo, ombra ───────────────────────────────────────────────────
const SHADOWS: Record<string, string> = {
  none: 'none',
  sm: 'var(--wb-effect-shadowSm, 0 1px 3px rgba(0,0,0,.4))',
  md: 'var(--wb-effect-shadowMd, 0 8px 24px rgba(0,0,0,.45))',
  lg: 'var(--wb-effect-shadowLg, 0 24px 60px rgba(0,0,0,.55))',
}

export function wbBoxStyle(style: WbStyle | undefined, device: WbDevice = 'desktop'): CSS {
  const out: CSS = {}
  if (!style) return out

  if (style.textColor) out.color = style.textColor
  if (style.bgColor) out.backgroundColor = style.bgColor

  if (style.gradient && style.gradient.from && style.gradient.to) {
    out.backgroundImage = `linear-gradient(${style.gradient.angle ?? 180}deg, ${style.gradient.from}, ${style.gradient.to})`
  }
  const img = device === 'mobile' && style.bgImageMobile ? style.bgImageMobile : style.bgImage
  const safeImg = wbSafeUrl(img)
  if (safeImg) {
    const gradientPart = out.backgroundImage ? `${out.backgroundImage}, ` : ''
    out.backgroundImage = `${gradientPart}url("${safeImg}")`
    out.backgroundSize = style.bgSize || 'cover'
    out.backgroundPosition = style.bgPosition || 'center'
    out.backgroundRepeat = 'no-repeat'
    if (style.bgAttachment === 'fixed') out.backgroundAttachment = 'fixed'
  }

  if (style.borderWidth) {
    out.borderStyle = 'solid'
    out.borderWidth = px(style.borderWidth)
    out.borderColor = style.borderColor || 'var(--wb-color-border)'
  }
  if (style.borderRadius != null) out.borderRadius = px(style.borderRadius)
  if (style.shadow && style.shadow !== 'none') out.boxShadow = SHADOWS[style.shadow] || style.shadow
  if (style.opacity != null && style.opacity !== 1) out.opacity = style.opacity
  if (style.backdropBlur) out.backdropFilter = `blur(${style.backdropBlur}px)`
  if (style.blur) out.filter = `blur(${style.blur}px)`

  return out
}

export function wbLayoutStyle(layout: WbLayout | undefined): CSS {
  const out: CSS = {}
  if (!layout) return out
  if (layout.padTop != null) out.paddingTop = px(layout.padTop)
  if (layout.padBottom != null) out.paddingBottom = px(layout.padBottom)
  if (layout.padLeft != null) out.paddingLeft = px(layout.padLeft)
  if (layout.padRight != null) out.paddingRight = px(layout.padRight)
  if (layout.marginTop != null) out.marginTop = px(layout.marginTop)
  if (layout.marginBottom != null) out.marginBottom = px(layout.marginBottom)
  if (layout.minHeight != null) out.minHeight = px(layout.minHeight)
  if (layout.overflow) out.overflow = layout.overflow
  return out
}

/** Larghezza del contenitore interno secondo `width`. */
export function wbContainerStyle(layout: WbLayout | undefined, tokens?: WbThemeTokens | null): CSS {
  const w = layout?.width || 'contained'
  if (w === 'full') return { width: '100%' }
  const max =
    layout?.maxWidth != null ? layout.maxWidth
    : w === 'narrow' ? 820
    : (tokens?.spacing?.containerMax ?? 1280)
  return { width: '100%', maxWidth: px(max), marginLeft: 'auto', marginRight: 'auto' }
}

// ─── Regole responsive generate ─────────────────────────────────────────────
function declarations(css: CSS): string {
  return Object.entries(css)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`)
    .join(';')
}

/**
 * Come si esprimono le soglie responsive.
 *
 * `media`     il sito vero: le soglie guardano la finestra del browser.
 * `container` l'anteprima del gestionale: la finestra e' larga anche
 *             quando si sta guardando il telefono, quindi le soglie
 *             devono guardare la CORNICE. Senza questo, scegliere
 *             "telefono" nell'editor mostrerebbe il disegno da schermo
 *             grande dentro una cornice stretta — cioe' un'anteprima
 *             che mente.
 *
 * Le regole `@container` sul sito non si attivano mai (nessun antenato
 * dichiara `container-type`), quindi le due modalita' non interferiscono.
 */
export type WbQueryMode = 'media' | 'container'

const q = (mode: WbQueryMode) => (mode === 'container' ? '@container' : '@media')

/**
 * CSS di un blocco: le sole differenze tra schermo grande, tablet e
 * telefono. Cio' che non cambia resta nello stile inline, cosi' la
 * regola generata e' corta e non c'e' mai un conflitto di precedenza.
 */
export function wbBlockCss(
  block: WbBlock,
  tokens: WbThemeTokens | undefined | null,
  mode: WbQueryMode = 'media',
): string {
  const sel = `.wb-b-${block.id}`
  const at = q(mode)
  const rules: string[] = []

  const vis = block.visibility
  if (vis && !vis.desktop) {
    rules.push(`${at} (min-width:${WB_BREAKPOINT_TABLET + 1}px){${sel}{display:none!important}}`)
  }
  if (vis && !vis.tablet) {
    rules.push(`${at} (min-width:${WB_BREAKPOINT_MOBILE + 1}px) and (max-width:${WB_BREAKPOINT_TABLET}px){${sel}{display:none!important}}`)
  }
  if (vis && !vis.mobile) {
    rules.push(`${at} (max-width:${WB_BREAKPOINT_MOBILE}px){${sel}{display:none!important}}`)
  }

  const forDevice = (device: 'tablet' | 'mobile'): string => {
    const ov = block.responsive?.[device]
    const merged: CSS = {
      ...wbLayoutStyle({ ...block.layout, ...(ov?.layout || {}) }),
      ...wbBoxStyle({ ...block.style, ...(ov?.style || {}) }, device),
      ...wbTypographyStyle({ ...block.typography, ...(ov?.typography || {}) }, tokens, device),
    }
    const base: CSS = {
      ...wbLayoutStyle(block.layout),
      ...wbBoxStyle(block.style, 'desktop'),
      ...wbTypographyStyle(block.typography, tokens, 'desktop'),
    }
    // Solo cio' che cambia davvero rispetto allo schermo grande.
    const diff: CSS = {}
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== base[k]) diff[k] = v
    }
    const cols = ov?.layout?.columns
    const gap = ov?.layout?.gap
    const decl = declarations(diff)
    const gridDecl = [
      cols != null ? `grid-template-columns:repeat(${cols},minmax(0,1fr))` : '',
      gap != null ? `gap:${gap}px` : '',
    ].filter(Boolean).join(';')
    let out = ''
    if (decl) out += `${sel}{${decl}}`
    if (gridDecl) out += `${sel} .wb-grid{${gridDecl}}`
    return out
  }

  const tabletCss = forDevice('tablet')
  if (tabletCss) rules.push(`${at} (max-width:${WB_BREAKPOINT_TABLET}px){${tabletCss}}`)
  const mobileCss = forDevice('mobile')
  if (mobileCss) rules.push(`${at} (max-width:${WB_BREAKPOINT_MOBILE}px){${mobileCss}}`)

  // Su telefono una griglia a piu' colonne diventa una colonna sola, a
  // meno che l'operatore non abbia deciso diversamente: e' il difensore
  // principale contro i layout rotti.
  if (block.responsive?.mobile?.layout?.columns == null && (block.layout?.columns ?? 1) > 1) {
    rules.push(`${at} (max-width:${WB_BREAKPOINT_MOBILE}px){${sel} .wb-grid{grid-template-columns:1fr}}`)
  }
  if (block.responsive?.tablet?.layout?.columns == null && (block.layout?.columns ?? 1) > 2) {
    rules.push(`${at} (max-width:${WB_BREAKPOINT_TABLET}px){${sel} .wb-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}`)
  }
  // Il "testo + immagine" su telefono si impila sempre.
  rules.push(`${at} (max-width:${WB_BREAKPOINT_MOBILE}px){${sel} .wb-split{grid-template-columns:1fr}}`)

  if (block.customCss) {
    // Il CSS avanzato e' confinato al blocco: `&` = il blocco stesso.
    rules.push(block.customCss.replace(/&/g, sel))
  }

  return rules.join('\n')
}

/** CSS di una pagina intera: i blocchi piu' le animazioni usate. */
export function wbPageCss(
  blocks: WbBlock[],
  tokens: WbThemeTokens | undefined | null,
  mode: WbQueryMode = 'media',
): string {
  const parts: string[] = []
  const walk = (list: WbBlock[]) => {
    for (const b of list) {
      parts.push(wbBlockCss(b, tokens, mode))
      if (b.children?.length) walk(b.children)
    }
  }
  walk(blocks)
  return parts.filter(Boolean).join('\n')
}

// ─── Animazioni ─────────────────────────────────────────────────────────────
/**
 * Le animazioni sono CSS puro con `animation-timeline` assente: partono
 * al montaggio. Nessuna libreria, nessun osservatore per blocco — e
 * `prefers-reduced-motion` le spegne tutte in un colpo solo.
 */
export const WB_ANIMATION_CSS = `
@keyframes wb-fade{from{opacity:0}to{opacity:1}}
@keyframes wb-fade-up{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
@keyframes wb-fade-down{from{opacity:0;transform:translateY(-24px)}to{opacity:1;transform:none}}
@keyframes wb-slide-left{from{opacity:0;transform:translateX(32px)}to{opacity:1;transform:none}}
@keyframes wb-slide-right{from{opacity:0;transform:translateX(-32px)}to{opacity:1;transform:none}}
@keyframes wb-zoom{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
.wb-anim{animation-duration:.6s;animation-fill-mode:both;animation-timing-function:cubic-bezier(.22,.61,.36,1)}
@media (prefers-reduced-motion: reduce){
  .wb-anim{animation:none!important}
  .wb-scroller{scroll-behavior:auto!important}
}
.wb-grid{display:grid}
.wb-split{display:grid}
.wb-media-fit{display:block;width:100%;height:100%;object-fit:cover}
.wb-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;text-decoration:none;border-style:solid;border-width:1px;transition:background-color .2s,color .2s,border-color .2s}
.wb-scroller{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}
.wb-scroller::-webkit-scrollbar{display:none}
.wb-scroller>*{scroll-snap-align:start;flex:0 0 auto}
.wb-visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
.wb-focusable:focus-visible{outline:2px solid var(--wb-color-accent,#19C2D6);outline-offset:3px}
`

export function wbAnimationStyle(anim: WbAnimation | undefined): CSS {
  if (!anim || anim.type === 'none') return {}
  return {
    animationName: `wb-${anim.type}`,
    animationDuration: `${anim.duration ?? 600}ms`,
    animationDelay: anim.delay ? `${anim.delay}ms` : undefined,
  }
}

// ─── Pulsanti ───────────────────────────────────────────────────────────────
export function wbButtonStyle(btn: WbButton, tokens: WbThemeTokens | undefined | null): CSS {
  const preset: WbButtonStyle | undefined = tokens?.buttons?.[btn.variant || 'primary']
  const s = { ...(preset || {}), ...(btn.override || {}) } as Partial<WbButtonStyle>
  const scale = btn.size === 'lg' ? 1.18 : btn.size === 'sm' ? 0.82 : 1
  return {
    backgroundColor: s.bg || 'var(--wb-color-primary)',
    color: s.text || '#000',
    borderColor: s.border && s.border !== 'transparent' ? s.border : 'transparent',
    borderRadius: px(s.radius ?? 8),
    paddingLeft: px(Math.round((s.padX ?? 24) * scale)),
    paddingRight: px(Math.round((s.padX ?? 24) * scale)),
    paddingTop: px(Math.round((s.padY ?? 12) * scale)),
    paddingBottom: px(Math.round((s.padY ?? 12) * scale)),
    width: btn.fullWidth ? '100%' : undefined,
    fontFamily: tokens?.typography?.scales?.button ? wbFontFamily(tokens.typography.scales.button.family, tokens) : undefined,
    fontSize: tokens?.typography?.scales?.button ? px(tokens.typography.scales.button.size) : undefined,
    fontWeight: tokens?.typography?.scales?.button?.weight,
    letterSpacing: tokens?.typography?.scales?.button?.letterSpacing
      ? `${tokens.typography.scales.button.letterSpacing}px` : undefined,
    textTransform: tokens?.typography?.scales?.button?.transform !== 'none'
      ? tokens?.typography?.scales?.button?.transform : undefined,
  }
}

/** Regola :hover di un pulsante — non esprimibile con lo stile inline. */
export function wbButtonHoverCss(btn: WbButton, tokens: WbThemeTokens | undefined | null): string {
  const preset: WbButtonStyle | undefined = tokens?.buttons?.[btn.variant || 'primary']
  const s = { ...(preset || {}), ...(btn.override || {}) } as Partial<WbButtonStyle>
  if (!s.hoverBg && !s.hoverText) return ''
  const decl = [
    s.hoverBg ? `background-color:${s.hoverBg}` : '',
    s.hoverText ? `color:${s.hoverText}` : '',
  ].filter(Boolean).join(';')
  return `.wb-btn-${btn.id}:hover{${decl}}`
}

export function wbGridStyle(layout: WbLayout | undefined): CSS {
  return {
    gridTemplateColumns: `repeat(${Math.max(1, layout?.columns ?? 3)},minmax(0,1fr))`,
    gap: px(layout?.gap ?? 32),
    alignItems: layout?.verticalAlign === 'start' ? 'start' : layout?.verticalAlign === 'end' ? 'end' : 'stretch',
  }
}
