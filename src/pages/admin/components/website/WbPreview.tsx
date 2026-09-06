/**
 * WbPreview.tsx — l'anteprima.
 *
 * Usa lo STESSO renderer del sito pubblico (shared/WbBlockRenderer): non
 * e' una riproduzione approssimata, e' il disegno vero dentro una cornice
 * che simula lo schermo scelto.
 *
 * La simulazione dello schermo e' fatta con una larghezza fissa e una
 * scala, non con un iframe: l'iframe costringerebbe a ricaricare tutto a
 * ogni tasto premuto e a duplicare il tema. Il CSS generato per tablet e
 * telefono usa `@media`, che dentro la pagina del gestionale risponde
 * alla finestra vera; per questo la cornice imposta anche
 * `container-type` e il renderer riceve il dispositivo simulato.
 */

import React from 'react'
import type { WbBlock, WbDevice, WbItem, WbLocale, WbTheme } from './shared/wbSchema'
import { WbBlocks, WbRenderContext, type WbLinkComponent } from './shared/WbBlockRenderer'
import { wbThemeVars, wbPageCss, WB_ANIMATION_CSS, WB_BREAKPOINT_MOBILE, WB_BREAKPOINT_TABLET } from './shared/wbStyle'

/** Nell'anteprima i link non navigano: si sta modificando, non visitando. */
const PreviewLink: WbLinkComponent = ({ to, children, className, style }) => (
  <span className={className} style={{ ...style, cursor: 'default' }} title={`Collegamento: ${to}`}>
    {children}
  </span>
)

export const WB_DEVICE_WIDTH: Record<WbDevice, number> = {
  desktop: 1440,
  tablet: WB_BREAKPOINT_TABLET,
  mobile: 390,
}

export interface WbPreviewProps {
  blocks: WbBlock[]
  theme: WbTheme | null
  device: WbDevice
  lang: WbLocale
  dynamic?: Record<string, WbItem[]>
  dynamicLoading?: Record<string, boolean>
  selectedId?: string | null
  onSelect?: (id: string) => void
  showOutlines?: boolean
  pageBg?: string
  pageCss?: string
}

export const WbPreview: React.FC<WbPreviewProps> = ({
  blocks, theme, device, lang, dynamic, dynamicLoading,
  selectedId, onSelect, showOutlines, pageBg, pageCss,
}) => {
  const hostRef = React.useRef<HTMLDivElement>(null)
  const [scale, setScale] = React.useState(1)
  const width = WB_DEVICE_WIDTH[device]

  // La pagina simulata sta sempre dentro lo spazio disponibile: si
  // rimpicciolisce, non si taglia.
  React.useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const misura = () => {
      const disponibile = el.clientWidth - 24
      setScale(Math.min(1, disponibile / width))
    }
    misura()
    const ro = new ResizeObserver(misura)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])

  // 'container': nell'anteprima le soglie responsive guardano la
  // cornice, non la finestra del gestionale (che e' sempre larga).
  const css = React.useMemo(() => wbPageCss(blocks, theme?.tokens || null, 'container'), [blocks, theme])
  const vars = React.useMemo(() => wbThemeVars(theme?.tokens || null) as React.CSSProperties, [theme])

  const ctx = React.useMemo(() => ({
    lang,
    device,
    tokens: theme?.tokens || null,
    Link: PreviewLink,
    dynamic,
    dynamicLoading,
    editor: { selectedId, onSelect, showOutlines },
  }), [lang, device, theme, dynamic, dynamicLoading, selectedId, onSelect, showOutlines])

  return (
    <div ref={hostRef} className="w-full h-full overflow-auto flex justify-center p-3">
      <div
        style={{
          width,
          transform: scale < 1 ? `scale(${scale})` : undefined,
          transformOrigin: 'top center',
          // Senza questo, la pagina rimpicciolita lascia sotto di se' lo
          // spazio della dimensione originale.
          marginBottom: scale < 1 ? `calc(-1 * (1 - ${scale}) * 100%)` : undefined,
        }}
      >
        <div
          className="rounded-xl overflow-hidden shadow-2xl"
          style={{
            ...vars,
            background: pageBg || (theme?.tokens?.colors?.bg ?? '#000'),
            color: theme?.tokens?.colors?.text ?? '#fff',
            fontFamily: theme?.tokens?.typography?.fontPrimary,
            // La cornice diventa il riferimento delle soglie responsive:
            // e' questo che rende vera l'anteprima su tablet e telefono.
            containerType: 'inline-size',
          } as React.CSSProperties}
        >
          <style dangerouslySetInnerHTML={{ __html: WB_ANIMATION_CSS }} />
          <style dangerouslySetInnerHTML={{ __html: css }} />
          {pageCss ? <style dangerouslySetInnerHTML={{ __html: pageCss }} /> : null}
          {theme?.tokens?.customCss ? <style dangerouslySetInnerHTML={{ __html: theme.tokens.customCss }} /> : null}
          <WbRenderContext.Provider value={ctx}>
            {blocks.length === 0 ? (
              <div className="py-24 text-center text-sm" style={{ color: theme?.tokens?.colors?.textMuted }}>
                Pagina vuota. Aggiungi la prima sezione dal pannello a sinistra.
              </div>
            ) : (
              <WbBlocks blocks={blocks} />
            )}
          </WbRenderContext.Provider>
        </div>
      </div>
    </div>
  )
}

/** La barra con i tre schermi. */
export const WbDeviceSwitch: React.FC<{
  device: WbDevice
  onChange: (d: WbDevice) => void
}> = ({ device, onChange }) => {
  const items: { id: WbDevice; label: string; path: string }[] = [
    { id: 'desktop', label: 'Schermo grande', path: 'M3 5h18v11H3zM8 20h8M12 16v4' },
    { id: 'tablet', label: 'Tablet', path: 'M6 3h12v18H6zM11 18h2' },
    { id: 'mobile', label: 'Telefono', path: 'M8 3h8v18H8zM11 18.5h2' },
  ]
  return (
    <div className="inline-flex rounded-lg border border-theme-border overflow-hidden">
      {items.map((i) => (
        <button
          key={i.id}
          type="button"
          onClick={() => onChange(i.id)}
          title={i.label}
          aria-label={i.label}
          aria-pressed={device === i.id}
          className={`px-2.5 py-1.5 transition-colors ${
            device === i.id ? 'bg-cyan-600/20 text-cyan-400' : 'text-theme-text-muted hover:bg-theme-bg-hover'
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d={i.path} />
          </svg>
        </button>
      ))}
    </div>
  )
}

export { WB_BREAKPOINT_MOBILE, WB_BREAKPOINT_TABLET }
export default WbPreview
