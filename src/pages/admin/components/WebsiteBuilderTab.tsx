/**
 * WebsiteBuilderTab.tsx — la nuova area "Website Builder".
 *
 * Cruscotto piu' un pannello per ogni area. Tre cose che vale la pena
 * sapere leggendo solo questo file:
 *
 *  1. Non sostituisce l'onglet "Sito". Quello continua a gestire i TESTI
 *     delle pagine React esistenti (`site_copy`) e resta la via piu'
 *     rapida per correggere una frase. Il Website Builder gestisce la
 *     STRUTTURA: pagine, sezioni, tema, media, versioni.
 *  2. Niente qui va online da solo. Si lavora sulle bozze; la
 *     pubblicazione e' un gesto separato e crea sempre una versione.
 *  3. Se la migrazione del database non e' ancora stata eseguita, la tab
 *     lo dice in chiaro invece di riempirsi di errori.
 */

import React from 'react'
import toast from 'react-hot-toast'
import { useAdminRole } from '../../../hooks/useAdminRole'
import type { WbTheme } from './website/shared/wbSchema'
import {
  wbMigrazioneEseguita, wbGetSite, wbListPages, wbListThemes, wbListVersions,
  wbListMedia, wbListOverlays, wbPublish,
  type WbSiteRow, type WbPageRow, type WbVersionRow,
} from './website/wbApi'
import { wbValidateSite, type WbIssue } from './website/wbValidate'
import {
  WbCard, WbButton, WbIcon, WbBadge, WbModal, WbEmptyState, WbField,
  WbInput, WB_UI_ICONS, wbDataOra, wbDaAllora,
} from './website/WbUI'
import { WbPagesView } from './website/WbPagesView'
import { WbEditor } from './website/WbEditor'
import { WbMediaLibrary } from './website/WbMediaView'
import { WbThemeView } from './website/WbThemeView'
import { WbNavView } from './website/WbNavView'
import { WbSeoView } from './website/WbSeoView'
import { WbOverlaysView } from './website/WbOverlaysView'
import { WbScriptsView } from './website/WbScriptsView'
import { WbVersionsView } from './website/WbVersionsView'
import { WbSettingsView } from './website/WbSettingsView'

type Vista =
  | 'dashboard' | 'pagine' | 'editor' | 'struttura' | 'media'
  | 'design' | 'seo' | 'popup' | 'script' | 'versioni' | 'impostazioni'

const MENU: { id: Vista; label: string; icon: string; right?: string }[] = [
  { id: 'dashboard', label: 'Panoramica', icon: WB_UI_ICONS.layers },
  { id: 'pagine', label: 'Pagine', icon: WB_UI_ICONS.page },
  { id: 'struttura', label: 'Header, menu e footer', icon: WB_UI_ICONS.menu },
  { id: 'design', label: 'Design System e temi', icon: WB_UI_ICONS.palette, right: 'website.theme' },
  { id: 'media', label: 'Media', icon: WB_UI_ICONS.image, right: 'website.media' },
  { id: 'seo', label: 'SEO', icon: WB_UI_ICONS.seo, right: 'website.seo' },
  { id: 'popup', label: 'Popup, banner e promozioni', icon: WB_UI_ICONS.popup },
  { id: 'script', label: 'Script e integrazioni', icon: WB_UI_ICONS.code, right: 'website.code' },
  { id: 'versioni', label: 'Versioni e registro', icon: WB_UI_ICONS.history },
  { id: 'impostazioni', label: 'Impostazioni globali', icon: WB_UI_ICONS.settings, right: 'website.settings' },
]

export default function WebsiteBuilderTab() {
  const { hasPermission, hasRole, permissions, loading: ruoloInCorso } = useAdminRole()

  /**
   * Diritti granulari. Chi ha il diritto generico sulla tab (`website`)
   * o e' direzione/developer/superadmin li ha tutti; gli altri li hanno
   * uno per uno, come chiede il capitolato (modificare senza pubblicare
   * dev'essere possibile).
   */
  const can = React.useCallback((right: string): boolean => {
    if (hasRole('direzione') || hasRole('developer')) return true
    if (permissions.includes('*')) return true
    if (permissions.includes(right)) return true
    if (right === 'website.view' && permissions.includes('website.edit')) return true
    // `website` come permesso di tab da' tutto tranne il codice: inserire
    // JavaScript nel sito resta un diritto che si concede a parte.
    if (permissions.includes('website')) return right !== 'website.code'
    return hasPermission('website') && right !== 'website.code'
  }, [hasRole, hasPermission, permissions])

  const [vista, setVista] = React.useState<Vista>('dashboard')
  const [migrazione, setMigrazione] = React.useState<boolean | null>(null)
  const [site, setSite] = React.useState<WbSiteRow | null>(null)
  const [pages, setPages] = React.useState<WbPageRow[]>([])
  const [themes, setThemes] = React.useState<WbTheme[]>([])
  const [versioni, setVersioni] = React.useState<WbVersionRow[]>([])
  const [conteggi, setConteggi] = React.useState({ media: 0, popup: 0 })
  const [loading, setLoading] = React.useState(true)
  const [editing, setEditing] = React.useState<WbPageRow | null>(null)
  const [pubblica, setPubblica] = React.useState(false)
  const [etichetta, setEtichetta] = React.useState('')
  const [problemi, setProblemi] = React.useState<WbIssue[]>([])
  const [pubblicando, setPubblicando] = React.useState(false)

  const carica = React.useCallback(async () => {
    setLoading(true)
    const ok = await wbMigrazioneEseguita()
    setMigrazione(ok)
    if (!ok) { setLoading(false); return }
    const s = await wbGetSite()
    setSite(s)
    if (s) {
      const [p, t, v, m, o] = await Promise.all([
        wbListPages(s.id),
        wbListThemes(s.id),
        wbListVersions(s.id, 10),
        wbListMedia(s.id, { limit: 1000 }),
        wbListOverlays(s.id),
      ])
      setPages(p)
      setThemes(t)
      setVersioni(v)
      setConteggi({ media: m.length, popup: o.length })
    }
    setLoading(false)
  }, [])

  React.useEffect(() => { void carica() }, [carica])

  // La pagina che si sta modificando deve restare aggiornata quando
  // l'elenco viene ricaricato, altrimenti l'editor mostra dati vecchi.
  React.useEffect(() => {
    if (!editing) return
    const fresca = pages.find((p) => p.id === editing.id)
    if (fresca && fresca.updated_at !== editing.updated_at) setEditing(fresca)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages])

  const temaAttivo = themes.find((t) => t.id === site?.active_theme_id) || themes[0] || null
  const elencoPagine = pages.map((p) => ({ slug: p.slug, title: p.title }))

  const bozzeNonPubblicate = pages.filter(
    (p) => JSON.stringify(p.draft_content) !== JSON.stringify(p.published_content || null),
  )
  const pagineAttive = pages.filter((p) => p.status === 'published' && p.overrides_route)
  const versioneOnline = versioni.find((v) => v.id === site?.published_version_id) || null

  // ─── Stati speciali ───────────────────────────────────────────────────────
  if (ruoloInCorso || loading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-theme-bg-secondary animate-pulse" />
        ))}
      </div>
    )
  }

  if (!can('website.view')) {
    return (
      <div className="p-4">
        <WbCard title="Website Builder">
          <WbEmptyState
            title="Non hai accesso a questa sezione"
            text="Chiedi alla direzione il permesso website.view (per guardare) o website.edit (per modificare)."
          />
        </WbCard>
      </div>
    )
  }

  if (migrazione === false) {
    return (
      <div className="p-4">
        <WbCard title="Website Builder — migrazione da eseguire">
          <p className="text-[13px] text-theme-text-secondary leading-relaxed">
            Le tabelle del Website Builder non esistono ancora sul database. Finche' non vengono create il
            gestionale e il sito continuano a funzionare esattamente come prima: questa e' l'unica schermata
            che se ne accorge.
          </p>
          <p className="text-[12px] text-theme-text-muted mt-3">
            Da eseguire nel SQL editor di Supabase:
          </p>
          <pre className="mt-1 p-3 rounded-lg bg-theme-bg-tertiary border border-theme-border text-[11px] font-mono text-theme-text-secondary overflow-x-auto">
supabase/migrations/20260904_website_builder.sql
          </pre>
          <p className="text-[11px] text-theme-text-muted mt-2">
            La migrazione e' additiva e si puo' rieseguire senza danni: non tocca nessuna tabella esistente.
          </p>
          <div className="mt-4">
            <WbButton onClick={() => void carica()}>
              <WbIcon path={WB_UI_ICONS.refresh} size={14} /> Ho eseguito la migrazione, ricontrolla
            </WbButton>
          </div>
        </WbCard>
      </div>
    )
  }

  if (!site) {
    return (
      <div className="p-4">
        <WbCard title="Website Builder">
          <WbEmptyState
            title="Nessun sito configurato"
            text="La migrazione crea il sito DR7 in automatico. Se questa schermata resta cosi', rieseguila."
            action={<WbButton onClick={() => void carica()}>Ricontrolla</WbButton>}
          />
        </WbCard>
      </div>
    )
  }

  // ─── Editor a tutta pagina ────────────────────────────────────────────────
  if (vista === 'editor' && editing) {
    return (
      <WbEditor
        site={site}
        page={editing}
        theme={temaAttivo}
        pages={elencoPagine}
        can={can}
        onBack={() => { setVista('pagine'); setEditing(null); void carica() }}
        onSaved={(p) => {
          setEditing(p)
          setPages((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...p } : x)))
        }}
      />
    )
  }

  const apriEditor = (p: WbPageRow) => { setEditing(p); setVista('editor') }

  // ─── Pubblicazione di tutto il sito ───────────────────────────────────────
  const avviaPubblicazione = () => {
    setProblemi(wbValidateSite(pages))
    setEtichetta('')
    setPubblica(true)
  }

  const eseguiPubblicazione = async () => {
    setPubblicando(true)
    const res = await wbPublish(site.id, etichetta || undefined)
    setPubblicando(false)
    if (res.ok) {
      toast.success(`Pubblicato. Versione ${res.number}, ${res.pages} pagine aggiornate.`)
      setPubblica(false)
      void carica()
    } else {
      // Il puntatore del sito non si e' mosso: online resta l'ultima
      // versione valida.
      toast.error(res.error || 'Pubblicazione non riuscita. Online resta la versione precedente.')
    }
  }

  const bloccanti = problemi.filter((i) => i.level === 'error')
  const avvisi = problemi.filter((i) => i.level === 'warning')

  return (
    <div className="p-4 space-y-4">
      {/* Testata */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">Website Builder</h1>
          <p className="text-sm text-theme-text-muted mt-1 max-w-3xl">
            Da qui si cambiano testi, foto, video, colori, caratteri, sezioni e pagine del sito pubblico.
            Si lavora sempre su una bozza: il sito cambia solo quando premi <strong>Pubblica</strong>,
            e ogni pubblicazione lascia una versione da cui si puo' tornare indietro.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {site.domain && (
            <WbButton onClick={() => window.open(`https://${site.domain}`, '_blank', 'noopener')}>
              <WbIcon path={WB_UI_ICONS.external} size={14} /> Apri il sito
            </WbButton>
          )}
          <WbButton tone="success" disabled={!can('website.publish')} onClick={avviaPubblicazione}>
            <WbIcon path={WB_UI_ICONS.publish} size={14} /> Pubblica il sito
          </WbButton>
        </div>
      </div>

      {/* Barra delle aree */}
      <div className="flex flex-wrap gap-1 border-b border-theme-border pb-2">
        {MENU.filter((m) => !m.right || can(m.right)).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setVista(m.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] transition-colors ${
              vista === m.id
                ? 'bg-cyan-600/20 text-cyan-400'
                : 'text-theme-text-secondary hover:bg-theme-bg-hover'
            }`}
          >
            <WbIcon path={m.icon} size={14} /> {m.label}
          </button>
        ))}
      </div>

      {/* ── Panoramica ── */}
      {vista === 'dashboard' && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <WbCard title="Versione online">
              {versioneOnline ? (
                <>
                  <p className="text-2xl font-bold text-theme-text-primary">v{versioneOnline.number}</p>
                  <p className="text-[11px] text-theme-text-muted mt-1">
                    {wbDataOra(versioneOnline.created_at)}<br />
                    da {versioneOnline.author || '—'}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[13px] text-theme-text-primary">Mai pubblicato</p>
                  <p className="text-[11px] text-theme-text-muted mt-1">
                    Il sito mostra ancora le pagine originali.
                  </p>
                </>
              )}
            </WbCard>

            <WbCard title="Bozze da pubblicare">
              <p className="text-2xl font-bold text-theme-text-primary">{bozzeNonPubblicate.length}</p>
              <p className="text-[11px] text-theme-text-muted mt-1">
                {bozzeNonPubblicate.length === 0
                  ? 'Tutto quello che hai scritto e gia online.'
                  : bozzeNonPubblicate.slice(0, 3).map((p) => p.title).join(', ')}
              </p>
            </WbCard>

            <WbCard title="Pagine gestite dal builder">
              <p className="text-2xl font-bold text-theme-text-primary">{pagineAttive.length}<span className="text-sm text-theme-text-muted"> / {pages.length}</span></p>
              <p className="text-[11px] text-theme-text-muted mt-1">
                Le altre restano le pagine originali del sito.
              </p>
            </WbCard>

            <WbCard title="Ultima modifica">
              <p className="text-[13px] text-theme-text-primary">
                {pages.length
                  ? wbDaAllora(pages.map((p) => p.last_edited_at || p.updated_at).sort().reverse()[0])
                  : '—'}
              </p>
              <p className="text-[11px] text-theme-text-muted mt-1">
                {pages.length ? (pages.slice().sort((a, b) => (b.last_edited_at || '').localeCompare(a.last_edited_at || ''))[0]?.last_edited_by || '—') : ''}
              </p>
            </WbCard>
          </div>

          {pages.length === 0 && (
            <WbCard title="Si comincia da qui">
              <WbEmptyState
                title="Il builder e' vuoto, e il sito funziona normalmente"
                text="Importa il sito attuale: le pagine di oggi diventano modificabili, in bozza, senza che il sito pubblico cambi. Poi le attivi una alla volta quando sei pronto."
                action={
                  <WbButton tone="primary" onClick={() => setVista('impostazioni')}>
                    Vai a Importa il sito attuale
                  </WbButton>
                }
              />
            </WbCard>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            <WbCard title="Scorciatoie">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { v: 'pagine' as Vista, label: 'Pagine', icon: WB_UI_ICONS.page, descr: 'Crea, duplica, programma' },
                  { v: 'design' as Vista, label: 'Colori e caratteri', icon: WB_UI_ICONS.palette, descr: 'Cambia il look di tutto' },
                  { v: 'media' as Vista, label: 'Media', icon: WB_UI_ICONS.image, descr: `${conteggi.media} file` },
                  { v: 'struttura' as Vista, label: 'Menu e footer', icon: WB_UI_ICONS.menu, descr: 'Navigazione del sito' },
                  { v: 'popup' as Vista, label: 'Popup e promo', icon: WB_UI_ICONS.popup, descr: `${conteggi.popup} configurati` },
                  { v: 'versioni' as Vista, label: 'Versioni', icon: WB_UI_ICONS.history, descr: 'Torna indietro quando vuoi' },
                ].filter((s) => MENU.find((m) => m.id === s.v)?.right ? can(MENU.find((m) => m.id === s.v)!.right!) : true)
                  .map((s) => (
                    <button
                      key={s.v}
                      type="button"
                      onClick={() => setVista(s.v)}
                      className="text-left rounded-lg border border-theme-border bg-theme-bg-tertiary/40 p-3 hover:border-cyan-500/60 transition-colors"
                    >
                      <span className="text-cyan-400"><WbIcon path={s.icon} size={18} /></span>
                      <p className="text-[12px] font-medium text-theme-text-primary mt-1.5">{s.label}</p>
                      <p className="text-[10px] text-theme-text-muted">{s.descr}</p>
                    </button>
                  ))}
              </div>
            </WbCard>

            <WbCard title="Ultime pubblicazioni">
              {versioni.length === 0 ? (
                <p className="text-[12px] text-theme-text-muted">Nessuna pubblicazione.</p>
              ) : (
                <div className="space-y-1.5">
                  {versioni.slice(0, 6).map((v) => (
                    <div key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-theme-border bg-theme-bg-tertiary/40 px-2.5 py-1.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] text-theme-text-primary">v{v.number}</span>
                          {v.id === site.published_version_id && <WbBadge tone="success">online</WbBadge>}
                        </div>
                        <p className="text-[10px] text-theme-text-muted truncate">{v.label || '—'} · {v.author || '—'}</p>
                      </div>
                      <span className="text-[10px] text-theme-text-muted shrink-0">{wbDaAllora(v.created_at)}</span>
                    </div>
                  ))}
                  <WbButton size="sm" onClick={() => setVista('versioni')}>Vedi tutte</WbButton>
                </div>
              )}
            </WbCard>
          </div>

          <WbCard title="Come si divide il lavoro" subtitle="Perche' esistono due schede che parlano del sito.">
            <div className="grid md:grid-cols-2 gap-3 text-[12px] text-theme-text-secondary leading-relaxed">
              <div className="rounded-lg border border-theme-border p-3">
                <p className="font-semibold text-theme-text-primary mb-1">Sito</p>
                <p>I <strong>testi</strong> delle pagine che il sito ha gia': una frase da correggere, un prezzo scritto, una domanda frequente. Resta la via piu' rapida e non cambia niente della struttura.</p>
              </div>
              <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/5 p-3">
                <p className="font-semibold text-theme-text-primary mb-1">Website Builder</p>
                <p>La <strong>struttura</strong>: sezioni, ordine, colori, caratteri, pagine nuove, media, popup, versioni. Serve quando vuoi cambiare com'e' fatta una pagina, non solo cosa dice.</p>
              </div>
            </div>
          </WbCard>
        </div>
      )}

      {vista === 'pagine' && (
        <WbPagesView site={site} pages={pages} onReload={carica} onOpen={apriEditor} can={can} />
      )}
      {vista === 'struttura' && <WbNavView site={site} pages={elencoPagine} can={can} />}
      {vista === 'media' && (
        <WbCard title="Libreria media" subtitle="Immagini, video e documenti del sito.">
          <WbMediaLibrary site={site} canWrite={can('website.media')} />
        </WbCard>
      )}
      {vista === 'design' && (
        <WbThemeView site={site} themes={themes} activeThemeId={site.active_theme_id} onReload={carica} can={can} />
      )}
      {vista === 'seo' && <WbSeoView site={site} pages={pages} onReload={carica} can={can} />}
      {vista === 'popup' && <WbOverlaysView site={site} pages={elencoPagine} can={can} />}
      {vista === 'script' && <WbScriptsView site={site} can={can} />}
      {vista === 'versioni' && <WbVersionsView site={site} onReload={carica} can={can} />}
      {vista === 'impostazioni' && <WbSettingsView site={site} onReload={carica} can={can} />}

      {/* Pubblicazione */}
      <WbModal
        open={pubblica}
        onClose={() => setPubblica(false)}
        title="Pubblicare il sito?"
        subtitle="Tutte le pagine in stato Pubblicata o Programmata passano dalla bozza al sito."
        size="lg"
        footer={
          <>
            <WbButton onClick={() => setPubblica(false)}>Annulla</WbButton>
            <WbButton
              tone="success"
              disabled={bloccanti.length > 0 || pubblicando}
              onClick={() => void eseguiPubblicazione()}
            >
              {pubblicando ? 'Pubblico…' : 'Pubblica adesso'}
            </WbButton>
          </>
        }
      >
        <div className="space-y-3">
          <WbField label="Nome della versione" help="Facoltativo. Aiuta a ritrovarla nello storico.">
            <WbInput value={etichetta} onChange={setEtichetta} placeholder="Es. Nuova home estate" />
          </WbField>

          <div className="rounded-lg border border-theme-border p-3 text-[12px] text-theme-text-secondary">
            <p>{pages.filter((p) => p.status === 'published' || p.status === 'scheduled').length} pagine andranno online.</p>
            <p className="text-theme-text-muted mt-1">
              La pubblicazione e' un'operazione unica: o riesce tutta, o il sito resta esattamente com'e' adesso.
            </p>
          </div>

          {bloccanti.length > 0 && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3">
              <p className="text-[12px] font-semibold text-red-400 mb-1.5">
                {bloccanti.length} problemi da risolvere prima di pubblicare
              </p>
              <ul className="space-y-1">
                {bloccanti.map((i, n) => (
                  <li key={n} className="text-[11px] text-theme-text-secondary">
                    {i.pageTitle ? <strong>{i.pageTitle}: </strong> : null}{i.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {avvisi.length > 0 && (
            <details className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <summary className="text-[12px] font-semibold text-amber-400 cursor-pointer">
                {avvisi.length} avvisi (non bloccano la pubblicazione)
              </summary>
              <ul className="space-y-1 mt-2">
                {avvisi.map((i, n) => (
                  <li key={n} className="text-[11px] text-theme-text-secondary">
                    {i.pageTitle ? <strong>{i.pageTitle}: </strong> : null}{i.message}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {bloccanti.length === 0 && avvisi.length === 0 && (
            <p className="text-[12px] text-emerald-400">Nessun problema trovato.</p>
          )}
        </div>
      </WbModal>
    </div>
  )
}
