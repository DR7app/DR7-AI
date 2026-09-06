/**
 * WbSeoView.tsx — SEO pagina per pagina.
 *
 * Mostra anche l'anteprima di come il risultato appare su Google e
 * quando il collegamento viene condiviso: e' l'unico modo perche' chi
 * scrive capisca subito se il titolo e' troppo lungo.
 *
 * Nota importante: la sitemap e il robots.txt del sito attuale NON
 * vengono toccati. Il builder ci aggiunge soltanto le pagine che ha
 * davvero pubblicato, cosi' l'indicizzazione esistente non cambia.
 */

import React from 'react'
import toast from 'react-hot-toast'
import type { WbSeo } from './shared/wbSchema'
import { wbText } from './shared/wbSchema'
import { wbUpdatePage, type WbPageRow, type WbSiteRow, type WbMediaRow } from './wbApi'
import {
  WbCard, WbButton, WbIcon, WbField, WbInput, WbTextarea, WbSelect,
  WbToggle, WbBadge, WB_UI_ICONS,
} from './WbUI'
import { WbMediaPicker, WbMediaSlot } from './WbMediaView'
import { wbValidatePage } from './wbValidate'

export const WbSeoView: React.FC<{
  site: WbSiteRow
  pages: WbPageRow[]
  onReload: () => void
  can: (r: string) => boolean
}> = ({ site, pages, onReload, can }) => {
  const canSeo = can('website.seo')
  const [selId, setSelId] = React.useState<string | null>(pages[0]?.id || null)
  const [seo, setSeo] = React.useState<WbSeo>({})
  const [dirty, setDirty] = React.useState(false)
  const [lang, setLang] = React.useState<'it' | 'en'>('it')
  const [mediaReq, setMediaReq] = React.useState(false)

  const page = pages.find((p) => p.id === selId) || null

  React.useEffect(() => {
    setSeo(JSON.parse(JSON.stringify(page?.seo || { robotsIndex: true, robotsFollow: true })))
    setDirty(false)
  }, [page?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof WbSeo, v: unknown) => { setSeo({ ...seo, [k]: v }); setDirty(true) }

  const salva = async () => {
    if (!page) return
    try {
      await wbUpdatePage(page.id, { seo })
      toast.success('SEO salvato. Va online alla prossima pubblicazione.')
      setDirty(false)
      onReload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Salvataggio non riuscito')
    }
  }

  const dominio = site.domain || 'dr7.app'
  const titolo = wbText(seo.title, lang) || page?.title || ''
  const descr = wbText(seo.description, lang)
  const ogTitolo = wbText(seo.ogTitle, lang) || titolo
  const ogDescr = wbText(seo.ogDescription, lang) || descr
  const problemi = page ? wbValidatePage(page).filter((i) => i.message.toLowerCase().includes('seo')) : []

  return (
    <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-4">
      <WbCard title="Pagine">
        <div className="space-y-1 max-h-[70vh] overflow-y-auto">
          {pages.length === 0 && <p className="text-[12px] text-theme-text-muted">Nessuna pagina nel builder.</p>}
          {pages.map((p) => {
            const ok = !!wbText(p.seo?.title, 'it') && !!wbText(p.seo?.description, 'it')
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelId(p.id)}
                className={`w-full text-left rounded-lg px-2.5 py-2 border transition-colors ${
                  selId === p.id ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-transparent hover:bg-theme-bg-hover'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] text-theme-text-primary truncate">{p.title}</span>
                  <WbBadge tone={ok ? 'success' : 'warning'}>{ok ? 'ok' : 'da fare'}</WbBadge>
                </div>
                <code className="text-[10px] text-theme-text-muted">{p.slug}</code>
              </button>
            )
          })}
        </div>
      </WbCard>

      {!page ? (
        <WbCard><p className="text-[12px] text-theme-text-muted">Scegli una pagina.</p></WbCard>
      ) : (
        <div className="space-y-4">
          <WbCard
            title={`SEO — ${page.title}`}
            actions={
              <>
                <div className="inline-flex rounded-lg border border-theme-border overflow-hidden">
                  {(['it', 'en'] as const).map((l) => (
                    <button key={l} type="button" onClick={() => setLang(l)}
                      className={`px-2 py-1 text-[11px] font-semibold uppercase ${lang === l ? 'bg-cyan-600/20 text-cyan-400' : 'text-theme-text-muted'}`}>{l}</button>
                  ))}
                </div>
                <WbButton size="sm" tone="primary" disabled={!canSeo || !dirty} onClick={() => void salva()}>
                  <WbIcon path={WB_UI_ICONS.save} size={14} /> Salva
                </WbButton>
              </>
            }
          >
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-0.5">
                <WbField label="Titolo per Google" help="Fino a circa 60 caratteri.">
                  <WbInput value={wbText(seo.title, lang)} onChange={(v) => set('title', { ...seo.title, [lang]: v })} />
                  <p className={`text-[10px] mt-0.5 ${titolo.length > 60 ? 'text-amber-400' : 'text-theme-text-muted'}`}>{titolo.length}/60</p>
                </WbField>
                <WbField label="Descrizione" help="Fino a circa 160 caratteri.">
                  <WbTextarea rows={3} value={wbText(seo.description, lang)} onChange={(v) => set('description', { ...seo.description, [lang]: v })} />
                  <p className={`text-[10px] mt-0.5 ${descr.length > 160 ? 'text-amber-400' : 'text-theme-text-muted'}`}>{descr.length}/160</p>
                </WbField>
                <WbField label="Indirizzo canonico" help="Vuoto = l'indirizzo della pagina stessa.">
                  <WbInput value={seo.canonical || ''} onChange={(v) => set('canonical', v || undefined)} placeholder={`https://${dominio}${page.slug}`} />
                </WbField>
                <WbField label="Google puo' indicizzare questa pagina" inline>
                  <WbToggle checked={seo.robotsIndex !== false} onChange={(v) => set('robotsIndex', v)} />
                </WbField>
                <WbField label="Google puo' seguire i collegamenti" inline>
                  <WbToggle checked={seo.robotsFollow !== false} onChange={(v) => set('robotsFollow', v)} />
                </WbField>
              </div>

              <div className="space-y-0.5">
                <p className="text-[11px] font-semibold text-theme-text-secondary">Condivisione sui social</p>
                <WbField label="Titolo condiviso" help="Vuoto = usa il titolo per Google.">
                  <WbInput value={wbText(seo.ogTitle, lang)} onChange={(v) => set('ogTitle', { ...seo.ogTitle, [lang]: v })} />
                </WbField>
                <WbField label="Descrizione condivisa">
                  <WbTextarea rows={2} value={wbText(seo.ogDescription, lang)} onChange={(v) => set('ogDescription', { ...seo.ogDescription, [lang]: v })} />
                </WbField>
                <WbField label="Immagine condivisa" help="Consigliata 1200x630 px.">
                  <WbMediaSlot url={seo.ogImage} onOpen={() => setMediaReq(true)} onClear={() => set('ogImage', undefined)} />
                </WbField>
                <WbField label="Formato dell'anteprima">
                  <WbSelect
                    value={seo.twitterCard || 'summary_large_image'}
                    onChange={(v) => set('twitterCard', v)}
                    options={[
                      { value: 'summary_large_image', label: 'Immagine grande' },
                      { value: 'summary', label: 'Immagine piccola' },
                    ]}
                  />
                </WbField>
              </div>
            </div>
          </WbCard>

          <div className="grid md:grid-cols-2 gap-4">
            <WbCard title="Come appare su Google">
              <div className="rounded-lg bg-white p-3 text-left">
                <p className="text-[11px] text-[#202124] truncate">{dominio}{page.slug === '/' ? '' : page.slug}</p>
                <p className="text-[17px] text-[#1a0dab] leading-snug truncate">{titolo || 'Titolo della pagina'}</p>
                <p className="text-[12px] text-[#4d5156] leading-snug line-clamp-2">
                  {descr || 'La descrizione compare qui. Se manca, Google ne sceglie una dal testo della pagina.'}
                </p>
              </div>
            </WbCard>

            <WbCard title="Come appare condiviso">
              <div className="rounded-lg overflow-hidden border border-theme-border max-w-sm">
                {seo.ogImage
                  ? <img src={seo.ogImage} alt="" className="w-full aspect-[1200/630] object-cover" />
                  : <div className="w-full aspect-[1200/630] bg-theme-bg-tertiary flex items-center justify-center text-theme-text-muted text-[11px]">Nessuna immagine</div>}
                <div className="p-2.5 bg-theme-bg-tertiary">
                  <p className="text-[10px] text-theme-text-muted uppercase">{dominio}</p>
                  <p className="text-[13px] text-theme-text-primary font-medium truncate">{ogTitolo || 'Titolo'}</p>
                  <p className="text-[11px] text-theme-text-muted line-clamp-2">{ogDescr}</p>
                </div>
              </div>
            </WbCard>
          </div>

          <WbCard title="Dati strutturati" subtitle="Facoltativi. JSON-LD, per far capire a Google di cosa parla la pagina.">
            <WbTextarea
              mono rows={6}
              value={seo.structuredData || ''}
              onChange={(v) => set('structuredData', v || undefined)}
              placeholder='{"@context":"https://schema.org","@type":"Organization","name":"DR7"}'
            />
            {problemi.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {problemi.map((p, i) => (
                  <li key={i} className="text-[11px] text-amber-400">{p.message}</li>
                ))}
              </ul>
            )}
          </WbCard>
        </div>
      )}

      {mediaReq && (
        <WbMediaPicker
          open site={site} kind="image" canWrite={can('website.media')}
          onClose={() => setMediaReq(false)}
          onPick={(m: WbMediaRow) => { set('ogImage', m.url); setMediaReq(false) }}
        />
      )}
    </div>
  )
}

export default WbSeoView
