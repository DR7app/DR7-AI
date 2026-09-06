/**
 * WbNavView.tsx — Header, Menu e Footer.
 *
 * Tre schede sulla stessa struttura perche' sono la stessa cosa: una
 * lista di voci con dei collegamenti, piu' delle impostazioni di aspetto.
 * Le voci si trascinano; una voce puo' contenerne altre (tendina o mega
 * menu) e il trascinamento funziona anche dentro un gruppo.
 *
 * Come per le pagine: quello che si scrive qui e' la BOZZA. Va online
 * con la pubblicazione, insieme a tutto il resto.
 */

import React from 'react'
import toast from 'react-hot-toast'
import type { WbFooterConfig, WbHeaderConfig, WbMenuItem, WbText } from './shared/wbSchema'
import { wbId } from './shared/wbSchema'
import { wbGetNavigation, wbSaveNavigation, type WbSiteRow, type WbMediaRow } from './wbApi'
import {
  WbCard, WbButton, WbIconButton, WbIcon, WbField, WbInput, WbSelect,
  WbToggle, WbSlider, WbColor, WbEmptyState, WB_UI_ICONS,
} from './WbUI'
import { WbMediaPicker, WbMediaSlot } from './WbMediaView'

const t = (it: string): WbText => ({ it, en: it })

// ─── Una voce di menu ───────────────────────────────────────────────────────
const VoceMenu: React.FC<{
  item: WbMenuItem
  index: number
  totale: number
  livello: number
  pages: { slug: string; title: string }[]
  onChange: (v: WbMenuItem) => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
  onDuplicate: () => void
  onDrag?: (from: number, to: number) => void
  dragState: { from: number | null; set: (n: number | null) => void }
}> = ({ item, index, totale, livello, pages, onChange, onDelete, onMove, onDuplicate, onDrag, dragState }) => {
  const [aperto, setAperto] = React.useState(false)
  const figli = item.children || []

  return (
    <div
      draggable
      onDragStart={(e) => { e.stopPropagation(); dragState.set(index) }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation()
        if (dragState.from != null && onDrag) onDrag(dragState.from, index)
        dragState.set(null)
      }}
      className="rounded-lg border border-theme-border bg-theme-bg-tertiary/40"
      style={{ marginLeft: livello * 14 }}
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <span className="text-theme-text-muted cursor-grab" title="Trascina per riordinare">
          <WbIcon path={WB_UI_ICONS.drag} size={13} />
        </span>
        <button type="button" className="flex-1 text-left text-[12px] text-theme-text-primary truncate" onClick={() => setAperto(!aperto)}>
          {item.label?.it || item.label?.en || '(senza nome)'}
          {item.kind === 'group' && <span className="text-theme-text-muted ml-1.5">({figli.length})</span>}
          {item.visible === false && <span className="text-amber-400 ml-1.5 text-[10px]">nascosta</span>}
        </button>
        <WbIconButton path={WB_UI_ICONS.up} label="Su" disabled={index === 0} onClick={() => onMove(-1)} />
        <WbIconButton path={WB_UI_ICONS.down} label="Giu" disabled={index === totale - 1} onClick={() => onMove(1)} />
        <WbIconButton path={WB_UI_ICONS.copy} label="Duplica" onClick={onDuplicate} />
        <WbIconButton path={WB_UI_ICONS.trash} label="Elimina" tone="danger" onClick={onDelete} />
      </div>

      {aperto && (
        <div className="px-2.5 pb-2.5 border-t border-theme-border space-y-1">
          <WbField label="Testo della voce">
            <WbInput value={item.label?.it || ''} onChange={(v) => onChange({ ...item, label: { ...item.label, it: v } })} />
          </WbField>
          <WbField label="Testo in inglese">
            <WbInput value={item.label?.en || ''} onChange={(v) => onChange({ ...item, label: { ...item.label, en: v } })} />
          </WbField>
          <WbField label="Tipo">
            <WbSelect
              value={item.kind}
              onChange={(v) => onChange({ ...item, kind: v as WbMenuItem['kind'], children: v === 'group' ? (item.children || []) : undefined })}
              options={[
                { value: 'page', label: 'Pagina del sito' },
                { value: 'url', label: 'Indirizzo esterno' },
                { value: 'anchor', label: 'Sezione di una pagina' },
                { value: 'group', label: 'Gruppo (apre una tendina)' },
                { value: 'cta', label: 'Pulsante in evidenza' },
              ]}
            />
          </WbField>
          {item.kind !== 'group' && (
            <>
              {item.kind === 'page' && (
                <WbField label="Pagina">
                  <WbSelect
                    value={pages.some((p) => p.slug === item.href) ? String(item.href) : ''}
                    onChange={(v) => onChange({ ...item, href: v })}
                    options={[{ value: '', label: 'Scrivi un indirizzo…' }, ...pages.map((p) => ({ value: p.slug, label: `${p.title} — ${p.slug}` }))]}
                  />
                </WbField>
              )}
              <WbField label="Indirizzo">
                <WbInput value={item.href || ''} onChange={(v) => onChange({ ...item, href: v })} placeholder={item.kind === 'url' ? 'https://…' : '/flotta'} />
              </WbField>
              <WbField label="Apri in una nuova scheda" inline>
                <WbToggle checked={item.target === '_blank'} onChange={(v) => onChange({ ...item, target: v ? '_blank' : '_self' })} />
              </WbField>
            </>
          )}
          {item.kind === 'group' && (
            <>
              <WbField label="Apri come mega menu" inline help="Piu' largo, adatto a molte voci.">
                <WbToggle checked={!!item.mega} onChange={(v) => onChange({ ...item, mega: v })} />
              </WbField>
              <div className="pt-1 space-y-1">
                {figli.map((c, ci) => (
                  <VoceMenu
                    key={c.id}
                    item={c}
                    index={ci}
                    totale={figli.length}
                    livello={0}
                    pages={pages}
                    dragState={dragState}
                    onChange={(v) => onChange({ ...item, children: figli.map((x, i) => (i === ci ? v : x)) })}
                    onDelete={() => onChange({ ...item, children: figli.filter((_, i) => i !== ci) })}
                    onDuplicate={() => {
                      const copia = { ...JSON.parse(JSON.stringify(c)), id: wbId('m') } as WbMenuItem
                      onChange({ ...item, children: [...figli.slice(0, ci + 1), copia, ...figli.slice(ci + 1)] })
                    }}
                    onMove={(d) => {
                      const to = ci + d
                      if (to < 0 || to >= figli.length) return
                      const n = [...figli]
                      const [el] = n.splice(ci, 1)
                      n.splice(to, 0, el)
                      onChange({ ...item, children: n })
                    }}
                  />
                ))}
                <WbButton size="sm" onClick={() => onChange({
                  ...item,
                  children: [...figli, { id: wbId('m'), label: t('Nuova voce'), kind: 'page', href: '/', visible: true }],
                })}>
                  <WbIcon path={WB_UI_ICONS.plus} size={13} /> Aggiungi voce nella tendina
                </WbButton>
              </div>
            </>
          )}
          <WbField label="Visibile" inline>
            <WbToggle checked={item.visible !== false} onChange={(v) => onChange({ ...item, visible: v })} />
          </WbField>
        </div>
      )}
    </div>
  )
}

// ─── La vista ───────────────────────────────────────────────────────────────
export const WbNavView: React.FC<{
  site: WbSiteRow
  pages: { slug: string; title: string }[]
  can: (r: string) => boolean
}> = ({ site, pages, can }) => {
  const canEdit = can('website.edit')
  const [scheda, setScheda] = React.useState<'header' | 'footer'>('header')
  const [header, setHeader] = React.useState<WbHeaderConfig>({ items: [], settings: {} })
  const [footer, setFooter] = React.useState<WbFooterConfig>({ columns: [], settings: {} })
  const [dirty, setDirty] = React.useState(false)
  const [caricato, setCaricato] = React.useState(false)
  const [mediaReq, setMediaReq] = React.useState<{ cb: (m: WbMediaRow) => void } | null>(null)
  const [dragFrom, setDragFrom] = React.useState<number | null>(null)

  React.useEffect(() => {
    let vivo = true
    void Promise.all([
      wbGetNavigation(site.id, 'header'),
      wbGetNavigation(site.id, 'footer'),
    ]).then(([h, f]) => {
      if (!vivo) return
      // Una riga salvata prima che un campo esistesse non deve lasciare
      // `items`/`columns` a undefined: si fonde SOPRA la forma minima.
      if (h?.draft) {
        const d = h.draft as Partial<WbHeaderConfig>
        setHeader({ ...d, items: d.items || [], settings: d.settings || {} })
      }
      if (f?.draft) {
        const d = f.draft as Partial<WbFooterConfig>
        setFooter({ ...d, columns: d.columns || [], settings: d.settings || {} })
      }
      setCaricato(true)
    })
    return () => { vivo = false }
  }, [site.id])

  const salva = async () => {
    try {
      await wbSaveNavigation(site.id, scheda, scheda === 'header' ? header : footer)
      toast.success('Salvato. Va online alla prossima pubblicazione.')
      setDirty(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Salvataggio non riuscito')
    }
  }

  const hs = header.settings || {}
  const setHs = (k: string, v: unknown) => { setHeader({ ...header, settings: { ...hs, [k]: v } }); setDirty(true) }
  const fs = footer.settings || {}
  const setFs = (k: string, v: unknown) => { setFooter({ ...footer, settings: { ...fs, [k]: v } }); setDirty(true) }

  if (!caricato) return <WbCard><p className="text-[12px] text-theme-text-muted">Carico…</p></WbCard>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-theme-border overflow-hidden">
          {([['header', 'Header e menu'], ['footer', 'Footer']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setScheda(id)}
              className={`px-3 py-1.5 text-[12px] ${scheda === id ? 'bg-cyan-600/20 text-cyan-400' : 'text-theme-text-muted hover:bg-theme-bg-hover'}`}
            >{label}</button>
          ))}
        </div>
        <div className="flex-1" />
        <WbButton tone="primary" size="sm" disabled={!canEdit || !dirty} onClick={() => void salva()}>
          <WbIcon path={WB_UI_ICONS.save} size={14} /> Salva
        </WbButton>
      </div>

      {scheda === 'header' ? (
        <div className="grid lg:grid-cols-2 gap-4">
          <WbCard title="Voci del menu" subtitle="Trascina per riordinare. Un gruppo apre una tendina.">
            <div className="space-y-1.5">
              {header.items.length === 0 && (
                <WbEmptyState
                  title="Nessuna voce"
                  text="Finche' resta vuoto, il sito continua a usare il menu attuale scritto nel codice."
                />
              )}
              {header.items.map((it, i) => (
                <VoceMenu
                  key={it.id}
                  item={it}
                  index={i}
                  totale={header.items.length}
                  livello={0}
                  pages={pages}
                  dragState={{ from: dragFrom, set: setDragFrom }}
                  onChange={(v) => { setHeader({ ...header, items: header.items.map((x, j) => (j === i ? v : x)) }); setDirty(true) }}
                  onDelete={() => { setHeader({ ...header, items: header.items.filter((_, j) => j !== i) }); setDirty(true) }}
                  onDuplicate={() => {
                    const copia = { ...JSON.parse(JSON.stringify(it)), id: wbId('m') } as WbMenuItem
                    setHeader({ ...header, items: [...header.items.slice(0, i + 1), copia, ...header.items.slice(i + 1)] })
                    setDirty(true)
                  }}
                  onMove={(d) => {
                    const to = i + d
                    if (to < 0 || to >= header.items.length) return
                    const n = [...header.items]
                    const [el] = n.splice(i, 1)
                    n.splice(to, 0, el)
                    setHeader({ ...header, items: n }); setDirty(true)
                  }}
                  onDrag={(from, to) => {
                    const n = [...header.items]
                    const [el] = n.splice(from, 1)
                    n.splice(to, 0, el)
                    setHeader({ ...header, items: n }); setDirty(true)
                  }}
                />
              ))}
              <WbButton size="sm" disabled={!canEdit} onClick={() => {
                setHeader({ ...header, items: [...header.items, { id: wbId('m'), label: t('Nuova voce'), kind: 'page', href: '/', visible: true }] })
                setDirty(true)
              }}>
                <WbIcon path={WB_UI_ICONS.plus} size={13} /> Aggiungi voce
              </WbButton>
            </div>
          </WbCard>

          <WbCard title="Aspetto dell'header">
            <div className="space-y-0.5">
              <WbField label="Logo">
                <WbMediaSlot url={hs.logo} onOpen={() => setMediaReq({ cb: (m) => setHs('logo', m.url) })} onClear={() => setHs('logo', undefined)} />
              </WbField>
              <WbField label="Posizione del logo">
                <WbSelect
                  value={hs.align || 'left'}
                  onChange={(v) => setHs('align', v)}
                  options={[{ value: 'left', label: 'Sinistra' }, { value: 'center', label: 'Centro' }, { value: 'right', label: 'Destra' }]}
                />
              </WbField>
              <WbField label="Altezza del logo">
                <WbSlider value={hs.logoHeight} min={16} max={140} step={2} unit="px" onChange={(v) => setHs('logoHeight', v)} />
              </WbField>
              <WbField label="Altezza del logo su telefono">
                <WbSlider value={hs.logoHeightMobile} min={16} max={100} step={2} unit="px" onChange={(v) => setHs('logoHeightMobile', v)} />
              </WbField>
              <WbField label="Altezza della barra">
                <WbSlider value={hs.height} min={44} max={140} step={2} unit="px" onChange={(v) => setHs('height', v)} />
              </WbField>
              <WbField label="Resta in alto scorrendo" inline>
                <WbToggle checked={hs.sticky !== false} onChange={(v) => setHs('sticky', v)} />
              </WbField>
              <WbField label="Trasparente in cima alla pagina" inline>
                <WbToggle checked={!!hs.transparent} onChange={(v) => setHs('transparent', v)} />
              </WbField>
              <WbField label="Colore di sfondo"><WbColor value={hs.bgColor} onChange={(v) => setHs('bgColor', v)} /></WbField>
              <WbField label="Colore del testo"><WbColor value={hs.textColor} onChange={(v) => setHs('textColor', v)} /></WbField>
              <WbField label="Mostra il cambio lingua" inline>
                <WbToggle checked={hs.showLanguage !== false} onChange={(v) => setHs('showLanguage', v)} />
              </WbField>
              <WbField label="Mostra l'accesso cliente" inline>
                <WbToggle checked={hs.showLogin !== false} onChange={(v) => setHs('showLogin', v)} />
              </WbField>
              <WbField label="Menu su telefono">
                <WbSelect
                  value={hs.mobileMode || 'drawer'}
                  onChange={(v) => setHs('mobileMode', v)}
                  options={[{ value: 'drawer', label: 'Pannello laterale' }, { value: 'fullscreen', label: 'A tutto schermo' }]}
                />
              </WbField>
            </div>
          </WbCard>
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          <WbCard title="Colonne del footer">
            <div className="space-y-2">
              {footer.columns.length === 0 && (
                <WbEmptyState title="Nessuna colonna" text="Finche' resta vuoto, il sito usa il footer attuale." />
              )}
              {footer.columns.map((col, ci) => (
                <div key={col.id} className="rounded-lg border border-theme-border bg-theme-bg-tertiary/40 p-2.5 space-y-1">
                  <div className="flex items-center gap-1">
                    <WbInput value={col.title?.it || ''} onChange={(v) => {
                      setFooter({ ...footer, columns: footer.columns.map((c, i) => (i === ci ? { ...c, title: { ...c.title, it: v } } : c)) })
                      setDirty(true)
                    }} />
                    <WbIconButton path={WB_UI_ICONS.up} label="Su" disabled={ci === 0} onClick={() => {
                      const n = [...footer.columns]; const [e] = n.splice(ci, 1); n.splice(ci - 1, 0, e)
                      setFooter({ ...footer, columns: n }); setDirty(true)
                    }} />
                    <WbIconButton path={WB_UI_ICONS.down} label="Giu" disabled={ci === footer.columns.length - 1} onClick={() => {
                      const n = [...footer.columns]; const [e] = n.splice(ci, 1); n.splice(ci + 1, 0, e)
                      setFooter({ ...footer, columns: n }); setDirty(true)
                    }} />
                    <WbIconButton path={WB_UI_ICONS.trash} label="Elimina" tone="danger" onClick={() => {
                      setFooter({ ...footer, columns: footer.columns.filter((_, i) => i !== ci) }); setDirty(true)
                    }} />
                  </div>
                  <div className="space-y-1 pl-1">
                    {(col.items || []).map((it, ii) => (
                      <VoceMenu
                        key={it.id}
                        item={it}
                        index={ii}
                        totale={col.items.length}
                        livello={0}
                        pages={pages}
                        dragState={{ from: dragFrom, set: setDragFrom }}
                        onChange={(v) => {
                          setFooter({ ...footer, columns: footer.columns.map((c, i) => (i === ci ? { ...c, items: c.items.map((x, j) => (j === ii ? v : x)) } : c)) })
                          setDirty(true)
                        }}
                        onDelete={() => {
                          setFooter({ ...footer, columns: footer.columns.map((c, i) => (i === ci ? { ...c, items: c.items.filter((_, j) => j !== ii) } : c)) })
                          setDirty(true)
                        }}
                        onDuplicate={() => {
                          const copia = { ...JSON.parse(JSON.stringify(it)), id: wbId('m') } as WbMenuItem
                          setFooter({ ...footer, columns: footer.columns.map((c, i) => (i === ci ? { ...c, items: [...c.items.slice(0, ii + 1), copia, ...c.items.slice(ii + 1)] } : c)) })
                          setDirty(true)
                        }}
                        onMove={(d) => {
                          const to = ii + d
                          if (to < 0 || to >= col.items.length) return
                          const n = [...col.items]; const [e] = n.splice(ii, 1); n.splice(to, 0, e)
                          setFooter({ ...footer, columns: footer.columns.map((c, i) => (i === ci ? { ...c, items: n } : c)) })
                          setDirty(true)
                        }}
                      />
                    ))}
                    <WbButton size="sm" onClick={() => {
                      setFooter({ ...footer, columns: footer.columns.map((c, i) => (i === ci ? { ...c, items: [...(c.items || []), { id: wbId('m'), label: t('Nuovo collegamento'), kind: 'page', href: '/', visible: true }] } : c)) })
                      setDirty(true)
                    }}>
                      <WbIcon path={WB_UI_ICONS.plus} size={13} /> Aggiungi collegamento
                    </WbButton>
                  </div>
                </div>
              ))}
              <WbButton size="sm" disabled={!canEdit} onClick={() => {
                setFooter({ ...footer, columns: [...footer.columns, { id: wbId('col'), title: t('Nuova colonna'), items: [] }] })
                setDirty(true)
              }}>
                <WbIcon path={WB_UI_ICONS.plus} size={13} /> Aggiungi colonna
              </WbButton>
            </div>
          </WbCard>

          <WbCard title="Aspetto del footer">
            <div className="space-y-0.5">
              <WbField label="Logo">
                <WbMediaSlot url={fs.logo} onOpen={() => setMediaReq({ cb: (m) => setFs('logo', m.url) })} onClear={() => setFs('logo', undefined)} />
              </WbField>
              <WbField label="Altezza del logo">
                <WbSlider value={fs.logoHeight} min={16} max={120} step={2} unit="px" onChange={(v) => setFs('logoHeight', v)} />
              </WbField>
              <WbField label="Testo introduttivo">
                <WbInput value={fs.text?.it || ''} onChange={(v) => setFs('text', { ...fs.text, it: v })} />
              </WbField>
              <WbField label="Riga di copyright">
                <WbInput value={fs.copyright?.it || ''} onChange={(v) => setFs('copyright', { ...fs.copyright, it: v })} />
              </WbField>
              <WbField label="Colore di sfondo"><WbColor value={fs.bgColor} onChange={(v) => setFs('bgColor', v)} /></WbField>
              <WbField label="Colore del testo"><WbColor value={fs.textColor} onChange={(v) => setFs('textColor', v)} /></WbField>
              <WbField label="Mostra l'iscrizione alla newsletter" inline>
                <WbToggle checked={!!fs.showNewsletter} onChange={(v) => setFs('showNewsletter', v)} />
              </WbField>
              <WbField label="Mostra i social" inline>
                <WbToggle checked={fs.showSocial !== false} onChange={(v) => setFs('showSocial', v)} />
              </WbField>
              <p className="text-[10px] text-theme-text-muted pt-2">
                Indirizzo, telefono, email e social vengono dalle Impostazioni globali: si scrivono una volta sola.
              </p>
            </div>
          </WbCard>
        </div>
      )}

      {mediaReq && (
        <WbMediaPicker
          open
          site={site}
          kind="image"
          canWrite={can('website.media')}
          onClose={() => setMediaReq(null)}
          onPick={(m) => { mediaReq.cb(m); setMediaReq(null); setDirty(true) }}
        />
      )}
    </div>
  )
}

export default WbNavView
