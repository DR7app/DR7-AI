/**
 * WbBlockRenderer.tsx — disegna i blocchi del Website Builder.
 *
 * ⚠️ FILE CONDIVISO (vedi wbSchema.ts). Si modifica in DR7-staging e si
 *    propaga con `npm run wb:sync`. E' lo stesso codice che gira nel
 *    gestionale (anteprima) e sul sito pubblico: l'anteprima non puo'
 *    divergere dal risultato perche' e' letteralmente lo stesso disegno.
 *
 * Tutto cio' che cambia tra i due repo entra dal contesto: il componente
 * per i link (react-router nel sito, <a> nel gestionale), i dati veri del
 * gestionale (veicoli, servizi, promozioni), l'invio dei form.
 *
 * 42 tipi di blocco, 22 implementazioni: i tipi che condividono la stessa
 * forma condividono anche il codice (hero/hero-video/hero-image/hero-slider
 * sono lo stesso componente con una variante). Aggiungere un tipo nuovo
 * significa aggiungere una voce al registro, non riscrivere il builder.
 */

import React from 'react'
import type {
  WbBlock, WbButton, WbDevice, WbImage, WbItem, WbLocale,
  WbThemeTokens, WbVideo, WbLink, WbText,
} from './wbSchema'
import { wbText, wbSanitizeHtml, wbSafeUrl, wbEmbedAllowed } from './wbSchema'
import {
  wbBoxStyle, wbContainerStyle, wbLayoutStyle, wbTypographyStyle,
  wbAnimationStyle, wbButtonStyle, wbButtonHoverCss, wbGridStyle,
} from './wbStyle'

// ─── Contesto ───────────────────────────────────────────────────────────────
export type WbLinkComponent = React.ComponentType<{
  to: string
  target?: string
  rel?: string
  className?: string
  style?: React.CSSProperties
  'aria-label'?: string
  children: React.ReactNode
}>

export interface WbRenderContextValue {
  lang: WbLocale
  /** Schermo simulato: nel gestionale lo decide l'anteprima, nel sito e' sempre 'desktop' (comanda il CSS). */
  device: WbDevice
  tokens: WbThemeTokens | null
  Link: WbLinkComponent
  /** Dati veri del gestionale gia' risolti, per id di blocco. */
  dynamic?: Record<string, WbItem[]>
  /** Stato di caricamento dei dati veri, per id di blocco. */
  dynamicLoading?: Record<string, boolean>
  onFormSubmit?: (block: WbBlock, values: Record<string, string>) => Promise<void> | void
  /** Solo nell'editor: selezione e contorni. */
  editor?: {
    selectedId?: string | null
    onSelect?: (id: string) => void
    showOutlines?: boolean
  }
}

const noopLink: WbLinkComponent = ({ to, children, ...rest }) =>
  React.createElement('a', { href: to, ...rest }, children)

export const WbRenderContext = React.createContext<WbRenderContextValue>({
  lang: 'it',
  device: 'desktop',
  tokens: null,
  Link: noopLink,
})

export const useWb = () => React.useContext(WbRenderContext)

// ─── Utilita' ───────────────────────────────────────────────────────────────
function itemsOf(block: WbBlock, ctx: WbRenderContextValue): WbItem[] {
  const ds = block.dataSource
  if (ds && ds.kind !== 'manual') {
    const resolved = ctx.dynamic?.[block.id]
    if (resolved) return resolved
    return []
  }
  const raw = (block.content?.items as WbItem[] | undefined) || []
  return Array.isArray(raw) ? raw : []
}

function txt(block: WbBlock, key: string, lang: WbLocale): string {
  return wbText(block.content?.[key] as never, lang)
}

function buttonsOf(block: WbBlock): WbButton[] {
  const b = block.content?.buttons as WbButton[] | undefined
  return Array.isArray(b) ? b : []
}

function hrefOf(link: WbLink | undefined): string {
  if (!link || link.kind === 'none') return ''
  return wbSafeUrl(link.href)
}

/** Immagine con punto focale: l'operatore sposta il soggetto, non ritaglia. */
const WbImg: React.FC<{
  image?: WbImage
  lang: WbLocale
  className?: string
  style?: React.CSSProperties
  loading?: 'lazy' | 'eager'
  sizes?: string
}> = ({ image, lang, className, style, loading = 'lazy', sizes }) => {
  const src = wbSafeUrl(image?.url)
  if (!src) return null
  const mobile = wbSafeUrl(image?.urlMobile)
  const objectPosition = `${Math.round((image?.focalX ?? 0.5) * 100)}% ${Math.round((image?.focalY ?? 0.5) * 100)}%`
  const img = (
    <img
      src={src}
      alt={wbText(image?.alt, lang)}
      title={image?.title || undefined}
      width={image?.width || undefined}
      height={image?.height || undefined}
      loading={loading}
      decoding="async"
      sizes={sizes}
      className={className}
      style={{ objectPosition, ...style }}
    />
  )
  if (!mobile) return img
  return (
    <picture>
      <source media="(max-width: 640px)" srcSet={mobile} />
      {img}
    </picture>
  )
}

const WbVideoTag: React.FC<{ video?: WbVideo; className?: string; style?: React.CSSProperties }> = ({ video, className, style }) => {
  const src = wbSafeUrl(video?.url)
  if (!src) return null
  const poster = wbSafeUrl(video?.poster)
  // L'autoplay senza `muted` viene bloccato da ogni browser: li teniamo
  // legati, altrimenti l'operatore accende l'autoplay e non parte niente.
  const autoPlay = !!video?.autoplay
  return (
    <video
      className={className}
      style={style}
      src={src}
      poster={poster || undefined}
      autoPlay={autoPlay}
      loop={video?.loop ?? true}
      muted={autoPlay ? true : (video?.muted ?? true)}
      controls={video?.controls ?? !autoPlay}
      playsInline
      preload={video?.preload || (autoPlay ? 'auto' : 'metadata')}
    />
  )
}

/** Pulsante: stile dal Design System, override per singolo pulsante. */
export const WbButtonEl: React.FC<{ btn: WbButton }> = ({ btn }) => {
  const { lang, tokens, Link } = useWb()
  const label = wbText(btn.label, lang)
  const href = hrefOf(btn)
  const style = wbButtonStyle(btn, tokens) as React.CSSProperties
  const cls = `wb-btn wb-focusable wb-btn-${btn.id}`
  const hover = wbButtonHoverCss(btn, tokens)
  const body = (
    <>
      {hover ? <style dangerouslySetInnerHTML={{ __html: hover }} /> : null}
      {label}
    </>
  )
  if (!href) {
    return <span className={cls} style={style}>{body}</span>
  }
  if (btn.kind === 'url' || btn.target === '_blank') {
    return (
      <a
        className={cls}
        style={style}
        href={href}
        target={btn.target || '_blank'}
        rel={btn.rel || 'noopener noreferrer'}
      >
        {body}
      </a>
    )
  }
  return <Link to={href} className={cls} style={style}>{body}</Link>
}

const WbButtons: React.FC<{ buttons: WbButton[]; align?: string; gap?: number }> = ({ buttons, align, gap }) => {
  if (!buttons.length) return null
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: gap ?? 12,
      justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
    }}>
      {buttons.map((b) => <WbButtonEl key={b.id} btn={b} />)}
    </div>
  )
}

/** Titolo + occhiello + sottotitolo: la testata condivisa da molti blocchi. */
const WbHeader: React.FC<{ block: WbBlock; center?: boolean }> = ({ block, center }) => {
  const { lang, tokens, device } = useWb()
  const eyebrow = txt(block, 'eyebrow', lang)
  const title = txt(block, 'title', lang)
  const subtitle = txt(block, 'subtitle', lang)
  if (!eyebrow && !title && !subtitle) return null
  const align = center ? 'center' : (block.typography?.align || block.layout?.align || 'left')
  const level = Number(block.settings?.headingLevel ?? 2)
  const Tag = (`h${Math.min(6, Math.max(1, level))}`) as 'h2'
  return (
    <div style={{ textAlign: align as React.CSSProperties['textAlign'], marginBottom: 24 }}>
      {eyebrow && (
        <div style={{ ...wbTypographyStyle({ preset: 'label' }, tokens, device), marginBottom: 10, color: 'var(--wb-color-primary)' }}>
          {eyebrow}
        </div>
      )}
      {title && (
        <Tag style={{ ...wbTypographyStyle({ preset: `h${level}` as never, ...block.typography, align: undefined }, tokens, device), margin: 0 }}>
          {title}
        </Tag>
      )}
      {subtitle && (
        <p style={{ ...wbTypographyStyle({ preset: 'body' }, tokens, device), marginTop: 12, opacity: 0.85, maxWidth: 780, marginLeft: align === 'center' ? 'auto' : undefined, marginRight: align === 'center' ? 'auto' : undefined }}>
          {subtitle}
        </p>
      )}
    </div>
  )
}

// ─── HERO (hero, hero-image, hero-video, hero-slider) ───────────────────────
const HeroBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const ctx = useWb()
  const { lang, tokens, device } = ctx
  const slides = itemsOf(block, ctx)
  const isSlider = block.type === 'hero-slider' && slides.length > 0
  const [idx, setIdx] = React.useState(0)
  const autoplay = Number(block.settings?.autoplaySeconds ?? 8)

  React.useEffect(() => {
    if (!isSlider || slides.length < 2 || autoplay <= 0) return
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    const t = setInterval(() => setIdx((i) => (i + 1) % slides.length), autoplay * 1000)
    return () => clearInterval(t)
  }, [isSlider, slides.length, autoplay])

  const active = isSlider ? slides[Math.min(idx, slides.length - 1)] : undefined
  const height = block.layout?.minHeight ?? 640
  const overlayOpacity = block.style?.overlayOpacity ?? 0.45
  const overlayColor = block.style?.overlayColor || '#000000'

  const bgImage = active?.image || (block.content?.image as WbImage | undefined)
  const bgVideo = active?.video || (block.content?.video as WbVideo | undefined)
  // Il titolo NASCOSTO e' quello della sezione, non della diapositiva:
  // serve a Google e ai lettori di schermo, e deve restare lo stesso
  // mentre le diapositive si alternano. Quello visibile invece segue la
  // diapositiva, com'e' naturale.
  const hiddenTitle = !!block.settings?.titleVisuallyHidden
  const title = hiddenTitle
    ? txt(block, 'title', lang)
    : (active ? wbText(active.title, lang) : txt(block, 'title', lang))
  const subtitle = active ? wbText(active.subtitle, lang) : txt(block, 'subtitle', lang)
  const eyebrow = active ? wbText(active.badge, lang) : txt(block, 'eyebrow', lang)
  const buttons = active?.buttons?.length ? active.buttons : buttonsOf(block)
  const align = block.layout?.align || 'center'
  const vAlign = block.layout?.verticalAlign || 'center'

  return (
    <div style={{ position: 'relative', minHeight: height, display: 'flex', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
        {bgVideo?.url
          ? <WbVideoTag video={{ ...bgVideo, autoplay: bgVideo.autoplay ?? true, controls: false }} className="wb-media-fit" />
          : <WbImg image={bgImage} lang={lang} className="wb-media-fit" loading="eager" sizes="100vw" />}
        {overlayOpacity > 0 && (
          <div style={{ position: 'absolute', inset: 0, background: overlayColor, opacity: overlayOpacity }} />
        )}
      </div>

      <div style={{
        position: 'relative', zIndex: 1, width: '100%', display: 'flex',
        alignItems: vAlign === 'start' ? 'flex-start' : vAlign === 'end' ? 'flex-end' : 'center',
        justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
        padding: '48px 24px',
      }}>
        <div style={{ maxWidth: 880, textAlign: align as React.CSSProperties['textAlign'] }}>
          {eyebrow && (
            <div style={{ ...wbTypographyStyle({ preset: 'label' }, tokens, device), color: 'var(--wb-color-primary)', marginBottom: 14 }}>
              {eyebrow}
            </div>
          )}
          {/* Titolo nascosto alla vista ma presente per Google e per i
              lettori di schermo: e' cosi' che la home attuale di dr7.app
              dichiara il suo argomento senza scrivere niente sul video. */}
          {title && (hiddenTitle ? (
            <h1 className="wb-visually-hidden">{title}</h1>
          ) : (
            <h1 style={{ ...wbTypographyStyle({ preset: 'h1', ...block.typography, align: undefined }, tokens, device), margin: 0 }}>
              {title}
            </h1>
          ))}
          {subtitle && (
            <p style={{ ...wbTypographyStyle({ preset: 'body' }, tokens, device), marginTop: 18, opacity: 0.9 }}>
              {subtitle}
            </p>
          )}
          {buttons.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <WbButtons buttons={buttons} align={align} />
            </div>
          )}
        </div>
      </div>

      {isSlider && slides.length > 1 && (
        <div style={{
          position: 'absolute', bottom: 24, left: 0, right: 0, zIndex: 2,
          display: 'flex', justifyContent: 'center', gap: 10,
        }}>
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className="wb-focusable"
              aria-label={`${lang === 'en' ? 'Slide' : 'Diapositiva'} ${i + 1}`}
              aria-current={i === idx}
              onClick={() => setIdx(i)}
              style={{
                width: i === idx ? 28 : 10, height: 10, borderRadius: 999, border: 'none',
                background: i === idx ? 'var(--wb-color-primary)' : 'rgba(255,255,255,.45)',
                cursor: 'pointer', transition: 'width .3s',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── TESTO (heading, subheading, text) ──────────────────────────────────────
const TextBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const { lang, tokens, device } = useWb()
  const value = txt(block, 'text', lang) || txt(block, 'title', lang)
  if (!value) return null
  const level = Number(block.settings?.headingLevel ?? (block.type === 'heading' ? 2 : 3))
  if (block.type === 'heading' || block.type === 'subheading') {
    const Tag = (`h${Math.min(6, Math.max(1, level))}`) as 'h2'
    return (
      <Tag style={{
        ...wbTypographyStyle({ preset: `h${level}` as never, ...block.typography }, tokens, device),
        margin: 0,
      }}>
        {value}
      </Tag>
    )
  }
  // Testo lungo: i ritorni a capo diventano paragrafi, cosi' l'operatore
  // scrive normalmente senza vedere HTML.
  const paragraphs = value.split(/\n{2,}/)
  const style = { ...wbTypographyStyle({ preset: 'body', ...block.typography }, tokens, device) }
  return (
    <div>
      {paragraphs.map((p, i) => (
        <p key={i} style={{ ...style, marginTop: i === 0 ? 0 : 16, marginBottom: 0, whiteSpace: 'pre-line' }}>
          {p}
        </p>
      ))}
    </div>
  )
}

// ─── IMMAGINE / VIDEO ───────────────────────────────────────────────────────
const MediaBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const { lang, tokens, device, Link } = useWb()
  const isVideo = block.type === 'video'
  const image = block.content?.image as WbImage | undefined
  const video = block.content?.video as WbVideo | undefined
  const caption = wbText(image?.caption, lang) || txt(block, 'caption', lang)
  const radius = block.style?.borderRadius ?? 0
  const ratio = String(block.settings?.aspectRatio || 'auto')
  const wrapStyle: React.CSSProperties = {
    borderRadius: radius, overflow: 'hidden',
    aspectRatio: ratio !== 'auto' ? ratio : undefined,
  }
  const media = isVideo
    ? <WbVideoTag video={video} className="wb-media-fit" />
    : <WbImg image={image} lang={lang} className={ratio !== 'auto' ? 'wb-media-fit' : undefined} style={ratio === 'auto' ? { width: '100%', height: 'auto', display: 'block' } : undefined} />
  const href = hrefOf(block.content?.link as WbLink | undefined)
  const inner = href
    ? <Link to={href} style={{ display: 'block' }}>{media}</Link>
    : media
  if (!image?.url && !video?.url) return null
  return (
    <figure style={{ margin: 0 }}>
      <div style={wrapStyle}>{inner}</div>
      {caption && (
        <figcaption style={{ ...wbTypographyStyle({ preset: 'caption' }, tokens, device), marginTop: 10, opacity: 0.75 }}>
          {caption}
        </figcaption>
      )}
    </figure>
  )
}

// ─── GALLERY / SLIDER / CAROUSEL ────────────────────────────────────────────
const CollectionBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const ctx = useWb()
  const { lang } = ctx
  const items = itemsOf(block, ctx)
  if (!items.length) return <WbEmpty block={block} />
  const scroll = block.type === 'slider' || block.type === 'carousel'
  const radius = block.style?.borderRadius ?? 8
  const gap = block.layout?.gap ?? 16

  if (scroll) {
    const per = Math.max(1, block.layout?.columns ?? 3)
    return (
      <div className="wb-scroller" style={{ gap }} tabIndex={0} role="region" aria-label={txt(block, 'title', lang) || 'Galleria'}>
        {items.map((it) => (
          <div key={it.id} style={{ width: `calc((100% - ${gap * (per - 1)}px) / ${per})`, minWidth: 220 }}>
            <div style={{ borderRadius: radius, overflow: 'hidden', aspectRatio: String(block.settings?.aspectRatio || '4/3') }}>
              <WbImg image={it.image} lang={lang} className="wb-media-fit" />
            </div>
            {wbText(it.title, lang) && (
              <div style={{ marginTop: 10 }}>{wbText(it.title, lang)}</div>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="wb-grid" style={wbGridStyle(block.layout)}>
      {items.map((it) => (
        <figure key={it.id} style={{ margin: 0 }}>
          <div style={{ borderRadius: radius, overflow: 'hidden', aspectRatio: String(block.settings?.aspectRatio || '4/3') }}>
            <WbImg image={it.image} lang={lang} className="wb-media-fit" />
          </div>
          {wbText(it.title, lang) && (
            <figcaption style={{ marginTop: 8, opacity: 0.8 }}>{wbText(it.title, lang)}</figcaption>
          )}
        </figure>
      ))}
    </div>
  )
}

// ─── TESTO + IMMAGINE ───────────────────────────────────────────────────────
const SplitBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const { lang, tokens, device } = useWb()
  const image = block.content?.image as WbImage | undefined
  const video = block.content?.video as WbVideo | undefined
  const reverse = block.type === 'image-text' ? !block.layout?.reverse : !!block.layout?.reverse
  const gap = block.layout?.gap ?? 48
  const ratio = String(block.settings?.mediaRatio || '4/3')
  const media = (
    <div style={{ borderRadius: block.style?.borderRadius ?? 10, overflow: 'hidden', aspectRatio: ratio }}>
      {video?.url
        ? <WbVideoTag video={video} className="wb-media-fit" />
        : <WbImg image={image} lang={lang} className="wb-media-fit" />}
    </div>
  )
  const body = (
    <div style={{ alignSelf: 'center' }}>
      <WbHeader block={block} />
      {txt(block, 'text', lang) && (
        <p style={{ ...wbTypographyStyle({ preset: 'body', ...block.typography }, tokens, device), whiteSpace: 'pre-line', margin: 0 }}>
          {txt(block, 'text', lang)}
        </p>
      )}
      {buttonsOf(block).length > 0 && (
        <div style={{ marginTop: 24 }}>
          <WbButtons buttons={buttonsOf(block)} align={block.layout?.align} />
        </div>
      )}
    </div>
  )
  return (
    <div className="wb-split" style={{ gridTemplateColumns: '1fr 1fr', gap, alignItems: 'center' }}>
      {reverse ? <>{body}{media}</> : <>{media}{body}</>}
    </div>
  )
}

// ─── CTA ────────────────────────────────────────────────────────────────────
const CtaBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const { lang, tokens, device } = useWb()
  const align = block.layout?.align || 'center'
  return (
    <div style={{ textAlign: align as React.CSSProperties['textAlign'] }}>
      <WbHeader block={block} center={align === 'center'} />
      {txt(block, 'text', lang) && (
        <p style={{ ...wbTypographyStyle({ preset: 'body' }, tokens, device), marginTop: 0, marginBottom: 28, opacity: 0.85 }}>
          {txt(block, 'text', lang)}
        </p>
      )}
      <WbButtons buttons={buttonsOf(block)} align={align} />
    </div>
  )
}

const ButtonsBlock: React.FC<{ block: WbBlock }> = ({ block }) => (
  <WbButtons buttons={buttonsOf(block)} align={block.layout?.align} gap={block.layout?.gap} />
)

// ─── CARD / GRIGLIA / SERVIZI / VEICOLI / PROMOZIONI ────────────────────────
/**
 * Un solo componente per tutti i blocchi a schede.
 *
 * La differenza tra "Cards" scritte a mano e "Flotta" collegata al
 * gestionale non e' il disegno, e' la SORGENTE: `dataSource.kind`.
 * Il dato resta del gestionale, il builder decide solo come mostrarlo.
 */
const CardsBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const ctx = useWb()
  const { lang, tokens, device, Link } = ctx
  const items = itemsOf(block, ctx)
  const loading = ctx.dynamicLoading?.[block.id]
  const variant = String(block.settings?.cardVariant || 'cover')
  const showPrice = block.settings?.showPrice !== false
  const ratio = String(block.settings?.aspectRatio || (variant === 'cover' ? '3/4' : '16/9'))

  if (loading) return <WbSkeleton columns={block.layout?.columns ?? 3} />
  if (!items.length) return <WbEmpty block={block} />

  return (
    <>
      <WbHeader block={block} center={block.layout?.align === 'center'} />
      <div className="wb-grid" style={wbGridStyle(block.layout)}>
        {items.map((it) => {
          const href = hrefOf(it.link)
          const title = wbText(it.title, lang)
          const subtitle = wbText(it.subtitle, lang)
          const text = wbText(it.text, lang)
          const badge = wbText(it.badge, lang)
          const card = (
            <article style={{
              position: 'relative', height: '100%', display: 'flex', flexDirection: 'column',
              background: variant === 'cover' ? undefined : 'var(--wb-card-bg)',
              border: variant === 'cover' ? undefined : '1px solid var(--wb-card-border)',
              borderRadius: block.style?.borderRadius ?? 'var(--wb-card-radius)',
              overflow: 'hidden',
              boxShadow: variant === 'cover' ? undefined : 'var(--wb-card-shadow)',
            }}>
              {(it.image?.url || it.video?.url) && (
                <div style={{ position: 'relative', aspectRatio: ratio, overflow: 'hidden' }}>
                  {it.video?.url
                    ? <WbVideoTag video={it.video} className="wb-media-fit" />
                    : <WbImg image={it.image} lang={lang} className="wb-media-fit" />}
                  {variant === 'cover' && (
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,.82), rgba(0,0,0,0) 62%)' }} />
                  )}
                  {badge && (
                    <span style={{
                      position: 'absolute', top: 12, left: 12, padding: '5px 12px',
                      borderRadius: 999, background: 'var(--wb-color-primary)', color: '#000',
                      ...wbTypographyStyle({ preset: 'label' }, tokens, device),
                    }}>{badge}</span>
                  )}
                  {variant === 'cover' && title && (
                    <div style={{ position: 'absolute', left: 0, bottom: 0, padding: 24 }}>
                      <h3 style={{ ...wbTypographyStyle({ preset: 'h4' }, tokens, device), margin: 0, color: '#fff' }}>{title}</h3>
                      {subtitle && <div style={{ marginTop: 6, opacity: 0.85, color: '#fff' }}>{subtitle}</div>}
                    </div>
                  )}
                </div>
              )}
              {variant !== 'cover' && (
                <div style={{ padding: 'var(--wb-card-pad, 24px)', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                  {title && <h3 style={{ ...wbTypographyStyle({ preset: 'h5' }, tokens, device), margin: 0 }}>{title}</h3>}
                  {subtitle && <div style={{ opacity: 0.75 }}>{subtitle}</div>}
                  {text && <p style={{ ...wbTypographyStyle({ preset: 'small' }, tokens, device), margin: 0, opacity: 0.8 }}>{text}</p>}
                  {showPrice && it.price && (
                    <div style={{ marginTop: 'auto', paddingTop: 12, ...wbTypographyStyle({ preset: 'h5' }, tokens, device), color: 'var(--wb-color-primary)' }}>
                      {it.price}
                    </div>
                  )}
                  {it.buttons?.length ? <div style={{ marginTop: 12 }}><WbButtons buttons={it.buttons} /></div> : null}
                </div>
              )}
            </article>
          )
          return href
            ? <Link key={it.id} to={href} style={{ display: 'block', height: '100%', textDecoration: 'none', color: 'inherit' }}>{card}</Link>
            : <div key={it.id} style={{ height: '100%' }}>{card}</div>
        })}
      </div>
    </>
  )
}

// ─── LISTA ──────────────────────────────────────────────────────────────────
const ListBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const ctx = useWb()
  const { lang, tokens, device } = ctx
  const items = itemsOf(block, ctx)
  if (!items.length) return <WbEmpty block={block} />
  const ordered = block.settings?.ordered === true
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <>
      <WbHeader block={block} />
      <Tag style={{ margin: 0, paddingLeft: ordered ? 22 : 0, listStyle: ordered ? 'decimal' : 'none', display: 'grid', gap: block.layout?.gap ?? 14 }}>
        {items.map((it) => (
          <li key={it.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {!ordered && (
              <span aria-hidden="true" style={{ marginTop: 9, width: 6, height: 6, borderRadius: 999, background: 'var(--wb-color-primary)', flex: '0 0 auto' }} />
            )}
            <div>
              {wbText(it.title, lang) && (
                <div style={{ ...wbTypographyStyle({ preset: 'h6' }, tokens, device) }}>{wbText(it.title, lang)}</div>
              )}
              {wbText(it.text, lang) && (
                <div style={{ ...wbTypographyStyle({ preset: 'body' }, tokens, device), opacity: 0.85 }}>{wbText(it.text, lang)}</div>
              )}
            </div>
          </li>
        ))}
      </Tag>
    </>
  )
}

// ─── STATISTICHE / CONTATORI ────────────────────────────────────────────────
const StatsBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const ctx = useWb()
  const { lang, tokens, device } = ctx
  const items = itemsOf(block, ctx)
  if (!items.length) return <WbEmpty block={block} />
  const animate = block.type === 'counters' && block.settings?.animate !== false
  return (
    <>
      <WbHeader block={block} center={block.layout?.align === 'center'} />
      <div className="wb-grid" style={wbGridStyle({ ...block.layout, columns: block.layout?.columns ?? items.length })}>
        {items.map((it) => (
          <div key={it.id} style={{ textAlign: 'center' }}>
            <div style={{ ...wbTypographyStyle({ preset: 'h2' }, tokens, device), color: 'var(--wb-color-primary)' }}>
              {animate ? <WbCounter value={it.value || ''} /> : (it.value || '')}
            </div>
            <div style={{ ...wbTypographyStyle({ preset: 'label' }, tokens, device), marginTop: 8, opacity: 0.8 }}>
              {wbText(it.title, lang)}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/** Conta fino al numero. Rispetta prefers-reduced-motion. */
const WbCounter: React.FC<{ value: string }> = ({ value }) => {
  const match = value.match(/^(\D*)([\d.,]+)(.*)$/)
  const target = match ? Number(match[2].replace(/\./g, '').replace(',', '.')) : NaN
  const [n, setN] = React.useState(Number.isNaN(target) ? null : 0)
  React.useEffect(() => {
    if (Number.isNaN(target)) return
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setN(target); return }
    const start = Date.now()
    const dur = 1400
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / dur)
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p >= 1) clearInterval(id)
    }, 40)
    return () => clearInterval(id)
  }, [target])
  if (n == null || !match) return <>{value}</>
  return <>{match[1]}{n.toLocaleString('it-IT')}{match[3]}</>
}

// ─── LOGHI / PARTNER ────────────────────────────────────────────────────────
const LogosBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const ctx = useWb()
  const { lang, Link } = ctx
  const items = itemsOf(block, ctx)
  if (!items.length) return <WbEmpty block={block} />
  const h = Number(block.settings?.logoHeight ?? 44)
  return (
    <>
      <WbHeader block={block} center />
      <div style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
        alignItems: 'center', gap: block.layout?.gap ?? 40,
      }}>
        {items.map((it) => {
          const href = hrefOf(it.link)
          const img = (
            <img
              src={wbSafeUrl(it.image?.url)}
              alt={wbText(it.image?.alt, lang) || wbText(it.title, lang)}
              loading="lazy"
              style={{ height: h, width: 'auto', objectFit: 'contain', opacity: Number(block.settings?.logoOpacity ?? 0.75) }}
            />
          )
          if (!it.image?.url) return null
          return href ? <Link key={it.id} to={href}>{img}</Link> : <div key={it.id}>{img}</div>
        })}
      </div>
    </>
  )
}

// ─── RECENSIONI / TESTIMONIANZE ─────────────────────────────────────────────
const TestimonialsBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const ctx = useWb()
  const { lang, tokens, device } = ctx
  const items = itemsOf(block, ctx)
  const loading = ctx.dynamicLoading?.[block.id]
  if (loading) return <WbSkeleton columns={block.layout?.columns ?? 3} />
  if (!items.length) return <WbEmpty block={block} />
  return (
    <>
      <WbHeader block={block} center={block.layout?.align === 'center'} />
      <div className="wb-grid" style={wbGridStyle(block.layout)}>
        {items.map((it) => {
          const stars = Number(it.meta?.rating ?? 5)
          return (
            <blockquote key={it.id} style={{
              margin: 0, padding: 'var(--wb-card-pad, 24px)',
              background: 'var(--wb-card-bg)', border: '1px solid var(--wb-card-border)',
              borderRadius: 'var(--wb-card-radius)', display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              {block.settings?.showRating !== false && (
                <div aria-label={`${stars}/5`} style={{ color: 'var(--wb-color-primary)', letterSpacing: 2 }}>
                  {'★'.repeat(Math.max(0, Math.min(5, Math.round(stars))))}
                </div>
              )}
              <p style={{ ...wbTypographyStyle({ preset: 'body' }, tokens, device), margin: 0 }}>
                {wbText(it.text, lang)}
              </p>
              <footer style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'auto' }}>
                {it.image?.url && (
                  <img src={wbSafeUrl(it.image.url)} alt="" loading="lazy" style={{ width: 36, height: 36, borderRadius: 999, objectFit: 'cover' }} />
                )}
                <div>
                  <div style={{ ...wbTypographyStyle({ preset: 'h6' }, tokens, device) }}>{wbText(it.title, lang)}</div>
                  {wbText(it.subtitle, lang) && <div style={{ opacity: 0.7, fontSize: 13 }}>{wbText(it.subtitle, lang)}</div>}
                </div>
              </footer>
            </blockquote>
          )
        })}
      </div>
    </>
  )
}

// ─── FAQ / ACCORDION ────────────────────────────────────────────────────────
const AccordionBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const ctx = useWb()
  const { lang, tokens, device } = ctx
  const items = itemsOf(block, ctx)
  // Tutti gli stati PRIMA di qualsiasi uscita anticipata: l'ordine degli
  // hook non puo' dipendere dal numero di voci.
  const [open, setOpen] = React.useState<string | null>(
    block.settings?.firstOpen !== false && items[0] ? items[0].id : null,
  )
  const [openSet, setOpenSet] = React.useState<Set<string>>(new Set())
  const single = block.settings?.multiple !== true
  if (!items.length) return <WbEmpty block={block} />
  const isOpen = (id: string) => (single ? open === id : openSet.has(id))
  const toggle = (id: string) => {
    if (single) { setOpen(open === id ? null : id); return }
    setOpenSet((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  return (
    <>
      <WbHeader block={block} center={block.layout?.align === 'center'} />
      <div style={{ display: 'grid', gap: 12, maxWidth: 900, marginLeft: block.layout?.align === 'center' ? 'auto' : undefined, marginRight: block.layout?.align === 'center' ? 'auto' : undefined }}>
        {items.map((it) => {
          const opened = isOpen(it.id)
          return (
            <div key={it.id} style={{
              border: '1px solid var(--wb-card-border)', borderRadius: 'var(--wb-card-radius)',
              background: 'var(--wb-card-bg)', overflow: 'hidden',
            }}>
              <button
                type="button"
                className="wb-focusable"
                aria-expanded={opened}
                onClick={() => toggle(it.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 16, padding: '18px 20px', background: 'transparent', border: 'none',
                  color: 'inherit', cursor: 'pointer', textAlign: 'left',
                  ...wbTypographyStyle({ preset: 'h6' }, tokens, device),
                }}
              >
                <span>{wbText(it.title, lang)}</span>
                <span aria-hidden="true" style={{ transform: opened ? 'rotate(45deg)' : 'none', transition: 'transform .2s', fontSize: 22, lineHeight: 1 }}>+</span>
              </button>
              {opened && (
                <div style={{ padding: '0 20px 20px', ...wbTypographyStyle({ preset: 'body' }, tokens, device), opacity: 0.88, whiteSpace: 'pre-line' }}>
                  {wbText(it.text, lang)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

// ─── TABS ───────────────────────────────────────────────────────────────────
const TabsBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const ctx = useWb()
  const { lang, tokens, device } = ctx
  const items = itemsOf(block, ctx)
  const [active, setActive] = React.useState(0)
  if (!items.length) return <WbEmpty block={block} />
  const current = items[Math.min(active, items.length - 1)]
  return (
    <>
      <WbHeader block={block} center={block.layout?.align === 'center'} />
      <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid var(--wb-card-border)', marginBottom: 24 }}>
        {items.map((it, i) => (
          <button
            key={it.id}
            role="tab"
            type="button"
            className="wb-focusable"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            style={{
              padding: '12px 18px', background: 'transparent', border: 'none', cursor: 'pointer',
              color: i === active ? 'var(--wb-color-primary)' : 'inherit',
              borderBottom: i === active ? '2px solid var(--wb-color-primary)' : '2px solid transparent',
              ...wbTypographyStyle({ preset: 'menu' }, tokens, device),
            }}
          >
            {wbText(it.title, lang)}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {current.image?.url && (
          <div style={{ marginBottom: 16, borderRadius: 'var(--wb-card-radius)', overflow: 'hidden', aspectRatio: '16/9' }}>
            <WbImg image={current.image} lang={lang} className="wb-media-fit" />
          </div>
        )}
        <div style={{ ...wbTypographyStyle({ preset: 'body' }, tokens, device), whiteSpace: 'pre-line' }}>
          {wbText(current.text, lang)}
        </div>
      </div>
    </>
  )
}

// ─── TIMELINE ───────────────────────────────────────────────────────────────
const TimelineBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const ctx = useWb()
  const { lang, tokens, device } = ctx
  const items = itemsOf(block, ctx)
  if (!items.length) return <WbEmpty block={block} />
  return (
    <>
      <WbHeader block={block} center={block.layout?.align === 'center'} />
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, position: 'relative' }}>
        <span aria-hidden="true" style={{ position: 'absolute', left: 7, top: 8, bottom: 8, width: 2, background: 'var(--wb-card-border)' }} />
        {items.map((it) => (
          <li key={it.id} style={{ position: 'relative', paddingLeft: 34, paddingBottom: 30 }}>
            <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 6, width: 16, height: 16, borderRadius: 999, background: 'var(--wb-color-primary)' }} />
            {it.value && (
              <div style={{ ...wbTypographyStyle({ preset: 'label' }, tokens, device), color: 'var(--wb-color-primary)' }}>{it.value}</div>
            )}
            <div style={{ ...wbTypographyStyle({ preset: 'h5' }, tokens, device), marginTop: 4 }}>{wbText(it.title, lang)}</div>
            {wbText(it.text, lang) && (
              <div style={{ ...wbTypographyStyle({ preset: 'body' }, tokens, device), marginTop: 6, opacity: 0.85 }}>{wbText(it.text, lang)}</div>
            )}
          </li>
        ))}
      </ol>
    </>
  )
}

// ─── MAPPA ──────────────────────────────────────────────────────────────────
const MapBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const { lang } = useWb()
  const query = String(block.content?.address || '')
  const embed = String(block.content?.embedUrl || '')
  const height = block.layout?.minHeight ?? 420
  const url = embed && wbEmbedAllowed(embed)
    ? embed
    : query
      ? `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`
      : ''
  if (!url) return <WbEmpty block={block} />
  return (
    <>
      <WbHeader block={block} />
      <iframe
        title={txt(block, 'title', lang) || 'Mappa'}
        src={url}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        style={{ width: '100%', height, border: 0, borderRadius: block.style?.borderRadius ?? 10 }}
      />
    </>
  )
}

// ─── FORM / NEWSLETTER / CONTATTI ───────────────────────────────────────────
interface WbField {
  id: string
  name: string
  label: WbText
  placeholder?: WbText
  type: 'text' | 'email' | 'tel' | 'textarea' | 'select' | 'checkbox' | 'date'
  required?: boolean
  options?: { value: string; label: WbText }[]
  width?: 'full' | 'half'
}

const FormBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const ctx = useWb()
  const { lang, tokens, device, onFormSubmit } = ctx
  const fields = (block.content?.fields as WbField[] | undefined) || []
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [state, setState] = React.useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [error, setError] = React.useState('')
  const privacyLabel = txt(block, 'privacyLabel', lang)
  const [privacy, setPrivacy] = React.useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (state === 'sending') return
    if (privacyLabel && !privacy) {
      setError(lang === 'en' ? 'Please accept the privacy policy.' : 'Accetta l’informativa privacy.')
      return
    }
    setError('')
    setState('sending')
    try {
      await onFormSubmit?.(block, values)
      setState('done')
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Errore')
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px',
    background: 'var(--wb-color-surface, rgba(255,255,255,.04))',
    border: '1px solid var(--wb-color-border, #2c2c2e)',
    borderRadius: tokens?.radius?.md ?? 8, color: 'inherit',
    ...wbTypographyStyle({ preset: 'body' }, tokens, device),
  }

  if (state === 'done') {
    return (
      <div style={{ textAlign: 'center', padding: 32 }}>
        <div style={{ ...wbTypographyStyle({ preset: 'h4' }, tokens, device), color: 'var(--wb-color-success)' }}>
          {txt(block, 'successMessage', lang) || (lang === 'en' ? 'Message sent.' : 'Messaggio inviato.')}
        </div>
      </div>
    )
  }

  return (
    <>
      <WbHeader block={block} center={block.layout?.align === 'center'} />
      <form onSubmit={submit} style={{ display: 'grid', gap: 16, maxWidth: 720, marginLeft: block.layout?.align === 'center' ? 'auto' : undefined, marginRight: block.layout?.align === 'center' ? 'auto' : undefined }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 16 }}>
          {fields.map((f) => {
            const label = wbText(f.label, lang)
            const ph = wbText(f.placeholder, lang)
            const common = {
              id: `${block.id}-${f.id}`,
              name: f.name,
              required: !!f.required,
              placeholder: ph || undefined,
              value: values[f.name] || '',
              onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
                setValues((v) => ({ ...v, [f.name]: e.target.value })),
              style: inputStyle,
              className: 'wb-focusable',
            }
            return (
              <div key={f.id} style={{ gridColumn: f.width === 'half' ? 'span 1' : 'span 2' }}>
                <label htmlFor={common.id} style={{ display: 'block', marginBottom: 6, ...wbTypographyStyle({ preset: 'label' }, tokens, device) }}>
                  {label}{f.required ? ' *' : ''}
                </label>
                {f.type === 'textarea' ? <textarea {...common} rows={Number(block.settings?.textareaRows ?? 5)} />
                  : f.type === 'select' ? (
                    <select {...common}>
                      <option value="">{ph || '—'}</option>
                      {(f.options || []).map((o) => (
                        <option key={o.value} value={o.value}>{wbText(o.label, lang)}</option>
                      ))}
                    </select>
                  ) : <input {...common} type={f.type} />}
              </div>
            )
          })}
        </div>

        {privacyLabel && (
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', ...wbTypographyStyle({ preset: 'small' }, tokens, device) }}>
            <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} className="wb-focusable" style={{ marginTop: 3 }} />
            <span>{privacyLabel}</span>
          </label>
        )}

        {error && <div role="alert" style={{ color: 'var(--wb-color-error)' }}>{error}</div>}

        <div>
          {buttonsOf(block).length > 0 ? (
            <button type="submit" disabled={state === 'sending'} className={`wb-btn wb-focusable wb-btn-${buttonsOf(block)[0].id}`} style={wbButtonStyle(buttonsOf(block)[0], tokens) as React.CSSProperties}>
              {state === 'sending'
                ? (lang === 'en' ? 'Sending…' : 'Invio…')
                : wbText(buttonsOf(block)[0].label, lang)}
            </button>
          ) : (
            <button type="submit" disabled={state === 'sending'} className="wb-btn wb-focusable" style={wbButtonStyle({ id: 'x', label: {}, variant: 'primary' }, tokens) as React.CSSProperties}>
              {lang === 'en' ? 'Send' : 'Invia'}
            </button>
          )}
        </div>
      </form>
    </>
  )
}

// ─── SOCIAL ─────────────────────────────────────────────────────────────────
const SocialBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const ctx = useWb()
  const { lang } = ctx
  const items = itemsOf(block, ctx)
  if (!items.length) return <WbEmpty block={block} />
  const size = Number(block.settings?.iconSize ?? 22)
  return (
    <>
      <WbHeader block={block} center={block.layout?.align === 'center'} />
      <div style={{ display: 'flex', gap: block.layout?.gap ?? 16, justifyContent: block.layout?.align === 'center' ? 'center' : 'flex-start', flexWrap: 'wrap' }}>
        {items.map((it) => {
          const href = wbSafeUrl(it.link?.href)
          if (!href) return null
          return (
            <a
              key={it.id}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={wbText(it.title, lang)}
              className="wb-focusable"
              style={{
                width: size * 2, height: size * 2, borderRadius: 999,
                border: '1px solid var(--wb-color-border)', display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center', color: 'inherit', textDecoration: 'none',
              }}
            >
              {it.image?.url
                ? <img src={wbSafeUrl(it.image.url)} alt="" style={{ width: size, height: size, objectFit: 'contain' }} />
                : <span style={{ fontSize: size * 0.7 }}>{(wbText(it.title, lang)[0] || '·').toUpperCase()}</span>}
            </a>
          )
        })}
      </div>
    </>
  )
}

// ─── BANNER ─────────────────────────────────────────────────────────────────
const BannerBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const { lang, tokens, device } = useWb()
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
      gap: 20, padding: '18px 24px',
      background: block.style?.bgColor || 'var(--wb-color-primary)',
      color: block.style?.textColor || '#000',
      borderRadius: block.style?.borderRadius ?? 0,
    }}>
      <div>
        {txt(block, 'title', lang) && (
          <div style={{ ...wbTypographyStyle({ preset: 'h6' }, tokens, device) }}>{txt(block, 'title', lang)}</div>
        )}
        {txt(block, 'text', lang) && (
          <div style={{ ...wbTypographyStyle({ preset: 'small' }, tokens, device), opacity: 0.9 }}>{txt(block, 'text', lang)}</div>
        )}
      </div>
      <WbButtons buttons={buttonsOf(block)} />
    </div>
  )
}

// ─── DIVIDER / SPAZIATORE ───────────────────────────────────────────────────
const DividerBlock: React.FC<{ block: WbBlock }> = ({ block }) => (
  <hr style={{
    border: 0, height: Number(block.settings?.thickness ?? 1),
    background: block.style?.bgColor || 'var(--wb-color-border)',
    margin: 0, opacity: block.style?.opacity ?? 1,
    width: block.settings?.dividerWidth ? `${block.settings.dividerWidth}%` : '100%',
    marginLeft: block.layout?.align === 'center' ? 'auto' : undefined,
    marginRight: block.layout?.align === 'center' ? 'auto' : undefined,
  }} />
)

const SpacerBlock: React.FC<{ block: WbBlock }> = ({ block }) => (
  <div aria-hidden="true" style={{ height: Number(block.settings?.height ?? 48) }} />
)

// ─── HTML / EMBED ───────────────────────────────────────────────────────────
const HtmlBlock: React.FC<{ block: WbBlock }> = ({ block }) => {
  const raw = String(block.content?.html || '')
  const embed = String(block.content?.embedUrl || '')
  if (embed) {
    if (!wbEmbedAllowed(embed)) {
      return <WbNotice text="Indirizzo non consentito per l'incorporamento." />
    }
    return (
      <iframe
        title={String(block.name || 'Contenuto incorporato')}
        src={embed}
        loading="lazy"
        allowFullScreen
        style={{ width: '100%', aspectRatio: String(block.settings?.aspectRatio || '16/9'), border: 0, borderRadius: block.style?.borderRadius ?? 10 }}
      />
    )
  }
  if (!raw) return <WbEmpty block={block} />
  return <div dangerouslySetInnerHTML={{ __html: wbSanitizeHtml(raw) }} />
}

// ─── Segnaposto ─────────────────────────────────────────────────────────────
const WbNotice: React.FC<{ text: string }> = ({ text }) => (
  <div style={{
    padding: 16, border: '1px dashed var(--wb-color-border, #444)',
    borderRadius: 8, opacity: 0.7, fontSize: 13, textAlign: 'center',
  }}>{text}</div>
)

/**
 * Sezione senza contenuto: nel sito pubblico non si disegna niente
 * (meglio niente che un buco), nell'editor si vede un segnaposto per
 * capire che la sezione c'e' ma e' vuota.
 */
const WbEmpty: React.FC<{ block: WbBlock }> = ({ block }) => {
  const { editor } = useWb()
  if (!editor) return null
  return <WbNotice text={`Sezione "${block.name || block.type}" senza contenuto.`} />
}

const WbSkeleton: React.FC<{ columns: number }> = ({ columns }) => (
  <div className="wb-grid" style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`, gap: 24 }}>
    {Array.from({ length: columns }).map((_, i) => (
      <div key={i} style={{
        aspectRatio: '3/4', borderRadius: 'var(--wb-card-radius, 10px)',
        background: 'var(--wb-color-surface, rgba(255,255,255,.05))',
        animation: 'wb-fade .8s ease-in-out infinite alternate',
      }} />
    ))}
  </div>
)

// ─── Registro dei tipi → componente ─────────────────────────────────────────
/**
 * 42 tipi, 22 componenti. I tipi che condividono la stessa forma
 * condividono il codice: e' quello che tiene il builder estendibile
 * senza moltiplicare i bug.
 */
const RENDERERS: Record<string, React.FC<{ block: WbBlock }>> = {
  hero: HeroBlock,
  'hero-image': HeroBlock,
  'hero-video': HeroBlock,
  'hero-slider': HeroBlock,

  heading: TextBlock,
  subheading: TextBlock,
  text: TextBlock,

  image: MediaBlock,
  video: MediaBlock,

  gallery: CollectionBlock,
  slider: CollectionBlock,
  carousel: CollectionBlock,

  'text-image': SplitBlock,
  'image-text': SplitBlock,

  cta: CtaBlock,
  buttons: ButtonsBlock,

  cards: CardsBlock,
  grid: CardsBlock,
  services: CardsBlock,
  categories: CardsBlock,
  vehicles: CardsBlock,
  fleet: CardsBlock,
  products: CardsBlock,
  promotions: CardsBlock,
  offers: CardsBlock,

  list: ListBlock,
  stats: StatsBlock,
  counters: StatsBlock,
  logos: LogosBlock,
  partners: LogosBlock,
  reviews: TestimonialsBlock,
  testimonials: TestimonialsBlock,
  faq: AccordionBlock,
  accordion: AccordionBlock,
  tabs: TabsBlock,
  timeline: TimelineBlock,
  map: MapBlock,

  form: FormBlock,
  newsletter: FormBlock,
  contact: FormBlock,

  social: SocialBlock,
  banner: BannerBlock,
  divider: DividerBlock,
  spacer: SpacerBlock,
  html: HtmlBlock,
}

export const WB_RENDERED_TYPES = Object.keys(RENDERERS)

// ─── Sezione ────────────────────────────────────────────────────────────────
/**
 * L'involucro di ogni blocco: sfondo, sovrapposizione, contenitore,
 * animazione, ancoraggio, e — solo nell'editor — la selezione.
 *
 * La classe `wb-b-<id>` e' l'aggancio del CSS responsive generato da
 * wbStyle: qui non si calcola niente per tablet o telefono.
 */
export const WbSection: React.FC<{ block: WbBlock }> = ({ block }) => {
  const ctx = useWb()
  const { tokens, device, editor } = ctx
  const Renderer = RENDERERS[block.type]

  if (block.hidden) {
    if (!editor) return null
  }

  // Finestra programmata: fuori dalle date la sezione semplicemente non c'e'.
  const now = Date.now()
  const s = block.schedule
  if (!editor && s) {
    if (s.startsAt && new Date(s.startsAt).getTime() > now) return null
    if (s.endsAt && new Date(s.endsAt).getTime() < now) return null
  }

  // Nel gestionale l'anteprima simula lo schermo: la stessa regola che
  // nel sito arriva dal CSS qui va applicata a mano.
  if (editor && block.visibility && block.visibility[device] === false) {
    return null
  }

  const outer: React.CSSProperties = {
    position: 'relative',
    ...wbLayoutStyle(block.layout),
    ...wbBoxStyle(block.style, device),
    ...wbAnimationStyle(block.animation),
  }
  const hasOverlay = (block.style?.overlayOpacity ?? 0) > 0 && block.type.indexOf('hero') !== 0
  const isHero = block.type.indexOf('hero') === 0

  const selected = editor?.selectedId === block.id
  const editorStyle: React.CSSProperties = editor
    ? {
        outline: selected ? '2px solid #19C2D6' : editor.showOutlines ? '1px dashed rgba(25,194,214,.35)' : undefined,
        outlineOffset: -2,
        opacity: block.hidden ? 0.4 : outer.opacity,
        cursor: 'pointer',
      }
    : {}

  const body = Renderer
    ? <Renderer block={block} />
    : <WbNotice text={`Tipo di sezione sconosciuto: ${block.type}`} />

  return (
    <section
      id={block.anchorId || undefined}
      className={`wb-b-${block.id}${block.animation && block.animation.type !== 'none' ? ' wb-anim' : ''}`}
      style={{ ...outer, ...editorStyle }}
      data-wb-block={block.id}
      data-wb-type={block.type}
      onClick={editor?.onSelect ? (e) => { e.stopPropagation(); editor.onSelect?.(block.id) } : undefined}
      aria-label={block.name || undefined}
    >
      {block.style?.bgVideo && (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 0 }} aria-hidden="true">
          <WbVideoTag video={{ url: block.style.bgVideo, autoplay: true, loop: true, muted: true, controls: false }} className="wb-media-fit" />
        </div>
      )}
      {hasOverlay && (
        <div aria-hidden="true" style={{
          position: 'absolute', inset: 0, zIndex: 0,
          background: block.style?.overlayColor || '#000',
          opacity: block.style?.overlayOpacity,
        }} />
      )}
      <div style={{ position: 'relative', zIndex: 1, ...(isHero ? { } : wbContainerStyle(block.layout, tokens)) }}>
        {block.children?.length
          ? block.children.map((c) => <WbSection key={c.id} block={c} />)
          : body}
      </div>
    </section>
  )
}

/** Una pagina intera: solo l'elenco delle sezioni. */
export const WbBlocks: React.FC<{ blocks: WbBlock[] }> = ({ blocks }) => (
  <>{blocks.map((b) => <WbSection key={b.id} block={b} />)}</>
)

export default WbBlocks
