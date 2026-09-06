/**
 * WbEditor.tsx — l'editor visuale di una pagina.
 *
 * Tre colonne: l'elenco delle sezioni (si trascinano), l'anteprima vera,
 * il pannello delle proprieta' raggruppate. Niente HTML esposto, niente
 * gergo: chi usa questo schermo non programma.
 *
 * Regole che stanno qui dentro e non altrove:
 *  · SALVA BOZZA e PUBBLICA sono due gesti diversi. Modificare non manda
 *    niente online, mai.
 *  · Il salvataggio automatico tocca SOLO la bozza.
 *  · Annulla/Ripeti valgono per la sessione di lavoro corrente.
 *  · Uscire con modifiche non salvate chiede conferma (anche chiudendo
 *    la scheda del browser).
 */

import React from 'react'
import toast from 'react-hot-toast'
import type { WbBlock, WbDevice, WbItem, WbLocale, WbPageContent, WbTheme } from './shared/wbSchema'
import { wbResolveDynamic } from './shared/wbData'
import { supabase } from '../../../../supabaseClient'
import {
  WB_BLOCKS, WB_CATEGORIES, WB_BLOCK_BY_TYPE, wbCreateBlock, wbCloneBlock,
  wbFieldsFor, type WbFieldGroup,
} from './wbRegistry'
import { WbFieldControl, wbGet, wbSet, type WbFieldContext } from './WbFieldControl'
import { WbPreview, WbDeviceSwitch } from './WbPreview'
import {
  WbButton, WbIconButton, WbIcon, WbModal, WbConfirm, WbBadge, WbInput,
  WbField, WbSelect, WbToggle, WB_UI_ICONS, wbDaAllora,
} from './WbUI'
import { WbMediaPicker } from './WbMediaView'
import {
  wbSaveDraft, wbUpdatePage, wbPublish, wbSaveTemplate, wbListTemplates,
  type WbPageRow, type WbSiteRow, type WbMediaRow, type WbTemplateRow,
} from './wbApi'
import { wbValidatePage, type WbIssue } from './wbValidate'

const GROUPS: { id: WbFieldGroup; label: string }[] = [
  { id: 'content', label: 'Contenuto' },
  { id: 'layout', label: 'Disposizione' },
  { id: 'style', label: 'Aspetto' },
  { id: 'responsive', label: 'Schermi' },
  { id: 'advanced', label: 'Avanzate' },
]

const AUTOSAVE_MS = 12000

export interface WbEditorProps {
  site: WbSiteRow
  page: WbPageRow
  theme: WbTheme | null
  pages: { slug: string; title: string }[]
  can: (right: string) => boolean
  onBack: () => void
  onSaved: (page: WbPageRow) => void
}

export const WbEditor: React.FC<WbEditorProps> = ({ site, page, theme, pages, can, onBack, onSaved }) => {
  const canEdit = can('website.edit')
  const canPublish = can('website.publish')

  const [content, setContent] = React.useState<WbPageContent>(
    () => JSON.parse(JSON.stringify(page.draft_content || { sections: [] })),
  )
  const [selectedId, setSelectedId] = React.useState<string | null>(content.sections[0]?.id || null)
  const [device, setDevice] = React.useState<WbDevice>('desktop')
  const [lang, setLang] = React.useState<WbLocale>('it')
  const [group, setGroup] = React.useState<WbFieldGroup>('content')
  const [dirty, setDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [lastSaved, setLastSaved] = React.useState<string | null>(page.last_edited_at)
  const [showAdd, setShowAdd] = React.useState(false)
  const [showOutlines, setShowOutlines] = React.useState(true)
  const [dynamic, setDynamic] = React.useState<Record<string, WbItem[]>>({})
  const [dynamicLoading, setDynamicLoading] = React.useState<Record<string, boolean>>({})
  const [mediaReq, setMediaReq] = React.useState<{ kind: 'image' | 'video' | 'icon' | 'document'; cb: (m: WbMediaRow) => void } | null>(null)
  const [daEliminare, setDaEliminare] = React.useState<WbBlock | null>(null)
  const [confermaPubblica, setConfermaPubblica] = React.useState(false)
  const [salvaModello, setSalvaModello] = React.useState<WbBlock | null>(null)
  const [nomeModello, setNomeModello] = React.useState('')
  const [modelli, setModelli] = React.useState<WbTemplateRow[]>([])
  const [issues, setIssues] = React.useState<WbIssue[]>([])
  const [dragIndex, setDragIndex] = React.useState<number | null>(null)
  const [schermoIntero, setSchermoIntero] = React.useState(false)
  const [confermaUscita, setConfermaUscita] = React.useState(false)
  const [dropIndex, setDropIndex] = React.useState<number | null>(null)

  // ─── Annulla / Ripeti ─────────────────────────────────────────────────────
  // Solo la sessione corrente: la storia lunga vive nelle Versioni, che
  // sono un'altra cosa e sopravvivono alla chiusura della pagina.
  const past = React.useRef<WbPageContent[]>([])
  const future = React.useRef<WbPageContent[]>([])
  // Le pile stanno in un ref (non devono ridisegnare a ogni push), ma i due
  // pulsanti devono sapere quando accendersi: lo dice questo stato.
  const [canUndo, setCanUndo] = React.useState(false)
  const [canRedo, setCanRedo] = React.useState(false)
  const aggiornaStoria = React.useCallback(() => {
    setCanUndo(past.current.length > 0)
    setCanRedo(future.current.length > 0)
  }, [])

  const apply = React.useCallback((next: WbPageContent, registra = true) => {
    if (registra) {
      past.current.push(JSON.parse(JSON.stringify(content)))
      if (past.current.length > 60) past.current.shift()
      future.current = []
    }
    setContent(next)
    setDirty(true)
    aggiornaStoria()
  }, [content, aggiornaStoria])

  const undo = React.useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(JSON.parse(JSON.stringify(content)))
    setContent(prev)
    setDirty(true)
    aggiornaStoria()
  }, [content, aggiornaStoria])

  const redo = React.useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(JSON.parse(JSON.stringify(content)))
    setContent(next)
    setDirty(true)
    aggiornaStoria()
  }, [content, aggiornaStoria])

  // ─── Dati veri per i blocchi collegati al gestionale ──────────────────────
  const dsKey = JSON.stringify(content.sections.map((b) => [b.id, b.type, b.dataSource]))
  React.useEffect(() => {
    let vivo = true
    const target = content.sections.filter((b) => b.dataSource && b.dataSource.kind !== 'manual')
    if (!target.length) { setDynamic({}); setDynamicLoading({}); return }
    setDynamicLoading(Object.fromEntries(target.map((b) => [b.id, true])))
    void wbResolveDynamic(supabase as never, content.sections, { lang }).then((res) => {
      if (!vivo) return
      setDynamic(res)
      setDynamicLoading({})
    })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dsKey, lang])

  React.useEffect(() => { void wbListTemplates(site.id, 'section').then(setModelli) }, [site.id])

  // ─── Salvataggio ──────────────────────────────────────────────────────────
  const salva = React.useCallback(async (silenzioso = false) => {
    if (!canEdit) return false
    setSaving(true)
    try {
      await wbSaveDraft(page.id, content)
      setDirty(false)
      const ora = new Date().toISOString()
      setLastSaved(ora)
      onSaved({ ...page, draft_content: content, last_edited_at: ora })
      if (!silenzioso) toast.success('Bozza salvata. Il sito non e ancora cambiato.')
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Salvataggio non riuscito')
      return false
    } finally {
      setSaving(false)
    }
  }, [canEdit, page, content, onSaved])

  // Salvataggio automatico della sola BOZZA. Non pubblica niente.
  const dirtyRef = React.useRef(dirty)
  dirtyRef.current = dirty
  React.useEffect(() => {
    if (!canEdit) return
    const t = setInterval(() => {
      if (dirtyRef.current && !saving) void salva(true)
    }, AUTOSAVE_MS)
    return () => clearInterval(t)
  }, [canEdit, salva, saving])

  // Chiusura della scheda con modifiche non salvate.
  React.useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])

  // Scorciatoie: salvare e annullare sono i due gesti piu' frequenti.
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const tag = (e.target as HTMLElement)?.tagName
      if (e.key === 's') { e.preventDefault(); void salva() }
      if (e.key === 'z' && !e.shiftKey && tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); undo() }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [salva, undo, redo])

  // ─── Operazioni sulle sezioni ─────────────────────────────────────────────
  const sections = content.sections
  const selected = sections.find((b) => b.id === selectedId) || null

  const patchBlock = (id: string, next: WbBlock) => {
    apply({ ...content, sections: sections.map((b) => (b.id === id ? next : b)) })
  }

  const aggiungi = (type: string, dopo?: number) => {
    const nuovo = wbCreateBlock(type)
    if (!nuovo) return
    const i = dopo ?? sections.length
    apply({ ...content, sections: [...sections.slice(0, i), nuovo, ...sections.slice(i)] })
    setSelectedId(nuovo.id)
    setShowAdd(false)
    setGroup('content')
  }

  const aggiungiDaModello = (tpl: WbTemplateRow) => {
    const payload = tpl.payload as WbBlock
    const copia = wbCloneBlock(payload)
    apply({ ...content, sections: [...sections, copia] })
    setSelectedId(copia.id)
    setShowAdd(false)
  }

  const duplica = (id: string) => {
    const i = sections.findIndex((b) => b.id === id)
    if (i < 0) return
    const copia = wbCloneBlock(sections[i])
    apply({ ...content, sections: [...sections.slice(0, i + 1), copia, ...sections.slice(i + 1)] })
    setSelectedId(copia.id)
  }

  const elimina = (id: string) => {
    apply({ ...content, sections: sections.filter((b) => b.id !== id) })
    if (selectedId === id) setSelectedId(null)
    setDaEliminare(null)
  }

  const sposta = (from: number, to: number) => {
    if (to < 0 || to >= sections.length || from === to) return
    const next = [...sections]
    const [el] = next.splice(from, 1)
    next.splice(to, 0, el)
    apply({ ...content, sections: next })
  }

  // ─── Pubblicazione della sola pagina ──────────────────────────────────────
  const pubblica = async () => {
    if (dirty) {
      const ok = await salva(true)
      if (!ok) return
    }
    const pagina: WbPageRow = { ...page, draft_content: content }
    const trovati = wbValidatePage(pagina)
    setIssues(trovati)
    if (trovati.some((i) => i.level === 'error')) {
      toast.error('Ci sono errori che impediscono la pubblicazione: guarda l elenco in fondo.')
      setConfermaPubblica(false)
      return
    }
    if (page.status !== 'published') {
      await wbUpdatePage(page.id, { status: 'published' })
    }
    const res = await wbPublish(site.id, `Pagina: ${page.title}`, undefined, [page.id])
    setConfermaPubblica(false)
    if (res.ok) {
      toast.success(`Pubblicato. Versione ${res.number}.`)
      onSaved({ ...page, draft_content: content, status: 'published', published_content: content })
    } else {
      // La versione online resta quella di prima: e' la garanzia della
      // pubblicazione atomica lato database.
      toast.error(res.error || 'Pubblicazione non riuscita. Il sito non e cambiato.')
    }
  }

  // ─── Contesto dei campi ───────────────────────────────────────────────────
  const fieldCtx: WbFieldContext = {
    lang,
    onLangChange: setLang,
    openMedia: (kind, cb) => setMediaReq({ kind, cb }),
    pages,
    tokens: theme?.tokens || null,
    can,
  }

  const campi = selected ? wbFieldsFor(selected) : []
  const campiGruppo = campi.filter((f) => f.group === group)
  const gruppiPieni = new Set(campi.map((f) => f.group))

  const def = selected ? WB_BLOCK_BY_TYPE[selected.type] : null
  const supportaDati = !!def?.supportsData

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] min-h-[560px]">
      {/* Barra superiore */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-theme-border bg-theme-bg-secondary/60 flex-wrap">
        <WbIconButton
          path={WB_UI_ICONS.back}
          label="Torna alle pagine"
          onClick={() => (dirty ? setConfermaUscita(true) : onBack())}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-theme-text-primary truncate">{page.title}</h2>
            <code className="text-[11px] text-theme-text-muted">{page.slug}</code>
            {page.is_home && <WbBadge tone="info">home</WbBadge>}
          </div>
          <p className="text-[10px] text-theme-text-muted">
            {dirty ? 'Modifiche non salvate' : `Bozza salvata ${wbDaAllora(lastSaved)}`}
            {page.published_at ? ` · online dal ${wbDaAllora(page.published_at)}` : ' · mai pubblicata'}
          </p>
        </div>

        <div className="flex-1" />

        <WbIconButton path={WB_UI_ICONS.undo} label="Annulla (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
        <WbIconButton path={WB_UI_ICONS.redo} label="Ripeti (Ctrl+Maiusc+Z)" onClick={redo} disabled={!canRedo} />
        <WbIconButton path={showOutlines ? WB_UI_ICONS.eye : WB_UI_ICONS.eyeOff} label="Mostra i contorni delle sezioni" active={showOutlines} onClick={() => setShowOutlines(!showOutlines)} />
        <WbDeviceSwitch device={device} onChange={setDevice} />
        <WbIconButton
          path={schermoIntero ? 'M9 9H4v6h5zM15 9h5v6h-5M9 4v16M15 4v16' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'}
          label={schermoIntero ? 'Torna alla modifica' : 'Anteprima a schermo intero'}
          active={schermoIntero}
          onClick={() => setSchermoIntero(!schermoIntero)}
        />
        <div className="inline-flex rounded-lg border border-theme-border overflow-hidden">
          {(['it', 'en'] as WbLocale[]).map((l) => (
            <button
              key={l} type="button" onClick={() => setLang(l)}
              className={`px-2 py-1.5 text-[11px] font-semibold uppercase ${lang === l ? 'bg-cyan-600/20 text-cyan-400' : 'text-theme-text-muted hover:bg-theme-bg-hover'}`}
            >{l}</button>
          ))}
        </div>

        <WbButton size="sm" onClick={() => void salva()} disabled={!canEdit || saving || !dirty}>
          <WbIcon path={WB_UI_ICONS.save} size={14} /> {saving ? 'Salvo…' : 'Salva bozza'}
        </WbButton>
        <WbButton size="sm" tone="success" onClick={() => setConfermaPubblica(true)} disabled={!canPublish}>
          <WbIcon path={WB_UI_ICONS.publish} size={14} /> Pubblica
        </WbButton>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Colonna sinistra: sezioni */}
        {!schermoIntero && (
        <aside className="w-60 shrink-0 border-r border-theme-border flex flex-col bg-theme-bg-secondary/30">
          <div className="px-3 py-2 border-b border-theme-border flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-theme-text-muted">Sezioni</span>
            <WbButton size="sm" tone="primary" onClick={() => setShowAdd(true)} disabled={!canEdit}>
              <WbIcon path={WB_UI_ICONS.plus} size={13} /> Aggiungi
            </WbButton>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sections.length === 0 && (
              <p className="text-[11px] text-theme-text-muted p-3 text-center">
                Nessuna sezione. Premi Aggiungi per cominciare.
              </p>
            )}
            {sections.map((b, i) => {
              const d = WB_BLOCK_BY_TYPE[b.type]
              return (
                <div
                  key={b.id}
                  draggable={canEdit}
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => { e.preventDefault(); setDropIndex(i) }}
                  onDragEnd={() => { setDragIndex(null); setDropIndex(null) }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragIndex != null) sposta(dragIndex, i)
                    setDragIndex(null); setDropIndex(null)
                  }}
                  onClick={() => setSelectedId(b.id)}
                  className={`group rounded-lg border px-2 py-1.5 cursor-pointer transition-colors ${
                    selectedId === b.id
                      ? 'border-cyan-500/60 bg-cyan-500/10'
                      : dropIndex === i && dragIndex != null
                        ? 'border-cyan-500/40 bg-theme-bg-hover'
                        : 'border-transparent hover:bg-theme-bg-hover'
                  } ${b.hidden ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-theme-text-muted cursor-grab" title="Trascina per spostare">
                      <WbIcon path={WB_UI_ICONS.drag} size={13} />
                    </span>
                    <span className="text-theme-text-muted shrink-0">
                      <WbIcon path={d?.icon || WB_UI_ICONS.page} size={14} />
                    </span>
                    <span className="flex-1 min-w-0 text-[12px] text-theme-text-primary truncate">
                      {b.name || d?.label || b.type}
                    </span>
                  </div>
                  <div className="hidden group-hover:flex items-center justify-end gap-0.5 pt-1">
                    <WbIconButton path={WB_UI_ICONS.up} label="Su" disabled={i === 0 || !canEdit} onClick={() => sposta(i, i - 1)} />
                    <WbIconButton path={WB_UI_ICONS.down} label="Giu" disabled={i === sections.length - 1 || !canEdit} onClick={() => sposta(i, i + 1)} />
                    <WbIconButton
                      path={b.hidden ? WB_UI_ICONS.eyeOff : WB_UI_ICONS.eye}
                      label={b.hidden ? 'Mostra' : 'Nascondi'}
                      disabled={!canEdit}
                      onClick={() => patchBlock(b.id, { ...b, hidden: !b.hidden })}
                    />
                    <WbIconButton path={WB_UI_ICONS.copy} label="Duplica" disabled={!canEdit} onClick={() => duplica(b.id)} />
                    <WbIconButton path={WB_UI_ICONS.layers} label="Salva come modello" disabled={!canEdit}
                      onClick={() => { setSalvaModello(b); setNomeModello(b.name || d?.label || b.type) }} />
                    <WbIconButton path={WB_UI_ICONS.trash} label="Elimina" tone="danger" disabled={!canEdit} onClick={() => setDaEliminare(b)} />
                  </div>
                </div>
              )
            })}
          </div>
        </aside>
        )}

        {/* Centro: anteprima */}
        <main className="flex-1 min-w-0 bg-theme-bg-primary">
          <WbPreview
            blocks={sections}
            theme={theme}
            device={device}
            lang={lang}
            dynamic={dynamic}
            dynamicLoading={dynamicLoading}
            selectedId={schermoIntero ? null : selectedId}
            onSelect={schermoIntero ? undefined : setSelectedId}
            showOutlines={schermoIntero ? false : showOutlines}
            pageBg={content.settings?.bgColor}
            pageCss={content.settings?.customCss}
          />
        </main>

        {/* Colonna destra: proprieta' */}
        {!schermoIntero && (
        <aside className="w-80 shrink-0 border-l border-theme-border flex flex-col bg-theme-bg-secondary/30">
          {!selected ? (
            <div className="p-4 text-[12px] text-theme-text-muted">
              Scegli una sezione a sinistra, o cliccala direttamente nell'anteprima.
            </div>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-theme-border">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-theme-text-muted">
                  {def?.label || selected.type}
                </p>
                <p className="text-[10px] text-theme-text-muted mt-0.5">{def?.description}</p>
              </div>
              <div className="flex border-b border-theme-border overflow-x-auto">
                {GROUPS.filter((g) => gruppiPieni.has(g.id)).map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGroup(g.id)}
                    className={`px-2.5 py-2 text-[11px] whitespace-nowrap border-b-2 transition-colors ${
                      group === g.id ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-theme-text-muted hover:text-theme-text-primary'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
                {/* Sorgente dei dati: solo dove ha senso */}
                {group === 'content' && supportaDati && (
                  <div className="mb-3 rounded-lg border border-theme-border bg-theme-bg-tertiary/50 p-2.5 space-y-1">
                    <p className="text-[11px] font-semibold text-theme-text-secondary">Da dove arrivano gli elementi</p>
                    <p className="text-[10px] text-theme-text-muted leading-snug">
                      Con i dati del gestionale non copi niente: prezzi e foto restano quelli veri e si aggiornano da soli.
                    </p>
                    <WbSelect
                      value={selected.dataSource?.kind || 'manual'}
                      onChange={(v) => patchBlock(selected.id, {
                        ...selected,
                        dataSource: { ...(selected.dataSource || {}), kind: v as never },
                      })}
                      options={[
                        { value: 'manual', label: 'Scritti a mano qui' },
                        { value: 'auto', label: 'Tutti (dal gestionale)' },
                        { value: 'category', label: 'Una categoria' },
                        { value: 'ids', label: 'Solo quelli che scelgo' },
                        { value: 'latest', label: 'Gli ultimi inseriti' },
                        { value: 'available', label: 'Solo i disponibili' },
                      ]}
                    />
                    {selected.dataSource && selected.dataSource.kind !== 'manual' && (
                      <>
                        <WbField label="Insieme di dati">
                          <WbSelect
                            value={selected.dataSource.collection || 'vehicles'}
                            onChange={(v) => patchBlock(selected.id, {
                              ...selected, dataSource: { ...selected.dataSource!, collection: v as never },
                            })}
                            options={[
                              { value: 'vehicles', label: 'Veicoli' },
                              { value: 'categories', label: 'Categorie' },
                              { value: 'services', label: 'Servizi (lavaggio e meccanica)' },
                              { value: 'promotions', label: 'Promozioni' },
                              { value: 'reviews', label: 'Recensioni' },
                            ]}
                          />
                        </WbField>
                        {(selected.dataSource.kind === 'category') && (
                          <WbField label="Categoria" help="L'identificativo usato in Centralina Pro (es. supercars).">
                            <WbInput
                              value={selected.dataSource.categoryId || ''}
                              onChange={(v) => patchBlock(selected.id, { ...selected, dataSource: { ...selected.dataSource!, categoryId: v } })}
                            />
                          </WbField>
                        )}
                        {selected.dataSource.kind === 'ids' && (
                          <WbField label="Identificativi" help="Uno per riga: li trovi nella scheda del veicolo o del servizio.">
                            <textarea
                              rows={4}
                              className="w-full px-2.5 py-1.5 text-[12px] font-mono bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary"
                              value={(selected.dataSource.ids || []).join('\n')}
                              onChange={(e) => patchBlock(selected.id, {
                                ...selected,
                                dataSource: { ...selected.dataSource!, ids: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) },
                              })}
                            />
                          </WbField>
                        )}
                        <WbField label="Quanti al massimo">
                          <WbInput
                            value={String(selected.dataSource.limit ?? '')}
                            onChange={(v) => patchBlock(selected.id, {
                              ...selected,
                              dataSource: { ...selected.dataSource!, limit: v ? Number(v) : undefined },
                            })}
                          />
                        </WbField>
                        <p className="text-[10px] text-theme-text-muted">
                          {(dynamic[selected.id]?.length ?? 0)} elementi trovati adesso.
                        </p>
                      </>
                    )}
                  </div>
                )}

                {campiGruppo.map((f) => (
                  <WbFieldControl
                    key={f.path}
                    field={f}
                    target={selected}
                    onChange={(next) => patchBlock(selected.id, next as WbBlock)}
                    ctx={fieldCtx}
                  />
                ))}
                {campiGruppo.length === 0 && (
                  <p className="text-[11px] text-theme-text-muted py-4 text-center">Niente da configurare qui.</p>
                )}
              </div>
            </>
          )}
        </aside>
        )}
      </div>

      {/* Elenco dei problemi trovati alla pubblicazione */}
      {issues.length > 0 && (
        <div className="border-t border-theme-border bg-theme-bg-secondary/60 px-3 py-2 max-h-32 overflow-y-auto">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-semibold text-theme-text-secondary">Controllo prima della pubblicazione</span>
            <WbIconButton path="M6 6l12 12M18 6L6 18" label="Chiudi" onClick={() => setIssues([])} />
          </div>
          <ul className="space-y-0.5">
            {issues.map((i, n) => (
              <li key={n} className="flex items-start gap-1.5 text-[11px]">
                <span className={i.level === 'error' ? 'text-red-400' : 'text-amber-400'}>
                  <WbIcon path={WB_UI_ICONS.warning} size={12} />
                </span>
                <span className="text-theme-text-secondary">{i.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Aggiungi sezione */}
      <WbModal open={showAdd} onClose={() => setShowAdd(false)} title="Aggiungi una sezione" size="xl">
        {modelli.length > 0 && (
          <div className="mb-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-theme-text-muted mb-2">I tuoi modelli</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {modelli.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => aggiungiDaModello(t)}
                  className="text-left rounded-lg border border-theme-border bg-theme-bg-tertiary/50 p-2.5 hover:border-cyan-500/60 transition-colors"
                >
                  <span className="text-theme-text-muted"><WbIcon path={WB_UI_ICONS.layers} size={16} /></span>
                  <p className="text-[12px] font-medium text-theme-text-primary mt-1 truncate">{t.name}</p>
                  {t.description && <p className="text-[10px] text-theme-text-muted truncate">{t.description}</p>}
                </button>
              ))}
            </div>
          </div>
        )}
        {WB_CATEGORIES.map((cat) => {
          const blocchi = WB_BLOCKS.filter((b) => b.category === cat.id)
          if (!blocchi.length) return null
          return (
            <div key={cat.id} className="mb-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-theme-text-muted">{cat.label}</p>
              <p className="text-[10px] text-theme-text-muted mb-2">{cat.description}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {blocchi.map((b) => (
                  <button
                    key={b.type}
                    type="button"
                    onClick={() => aggiungi(b.type)}
                    className="text-left rounded-lg border border-theme-border bg-theme-bg-tertiary/50 p-2.5 hover:border-cyan-500/60 hover:bg-theme-bg-hover transition-colors"
                  >
                    <span className="text-cyan-400"><WbIcon path={b.icon} size={18} /></span>
                    <p className="text-[12px] font-medium text-theme-text-primary mt-1.5">{b.label}</p>
                    <p className="text-[10px] text-theme-text-muted leading-snug mt-0.5">{b.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </WbModal>

      {/* Libreria media */}
      {mediaReq && (
        <WbMediaPicker
          open
          site={site}
          kind={mediaReq.kind}
          canWrite={can('website.media')}
          onClose={() => setMediaReq(null)}
          onPick={(m) => { mediaReq.cb(m); setMediaReq(null) }}
        />
      )}

      <WbConfirm
        open={!!daEliminare}
        title="Eliminare questa sezione?"
        message={`"${daEliminare?.name || daEliminare?.type}" sparisce dalla bozza. Il sito non cambia finche' non pubblichi, e puoi annullare con Ctrl+Z.`}
        confirmLabel="Elimina"
        onCancel={() => setDaEliminare(null)}
        onConfirm={() => daEliminare && elimina(daEliminare.id)}
      />

      <WbConfirm
        open={confermaUscita}
        title="Uscire senza salvare?"
        message="Ci sono modifiche non salvate in questa pagina. Se esci adesso vanno perse."
        confirmLabel="Esci senza salvare"
        onCancel={() => setConfermaUscita(false)}
        onConfirm={() => { setConfermaUscita(false); onBack() }}
      />

      <WbConfirm
        open={confermaPubblica}
        title="Pubblicare questa pagina?"
        message={`Le modifiche di "${page.title}" diventano visibili su ${site.domain || 'il sito'}. Viene creata una versione, quindi si puo' tornare indietro in qualsiasi momento.`}
        confirmLabel="Pubblica"
        tone="primary"
        onCancel={() => setConfermaPubblica(false)}
        onConfirm={() => void pubblica()}
      />

      <WbModal
        open={!!salvaModello}
        onClose={() => setSalvaModello(null)}
        title="Salva come modello"
        subtitle="Lo ritrovi in Aggiungi sezione, su qualsiasi pagina."
        size="sm"
        footer={
          <>
            <WbButton onClick={() => setSalvaModello(null)}>Annulla</WbButton>
            <WbButton tone="primary" onClick={async () => {
              if (!salvaModello) return
              try {
                await wbSaveTemplate(site.id, 'section', nomeModello || 'Modello', salvaModello)
                toast.success('Modello salvato')
                setModelli(await wbListTemplates(site.id, 'section'))
                setSalvaModello(null)
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Salvataggio non riuscito')
              }
            }}>Salva</WbButton>
          </>
        }
      >
        <WbField label="Nome del modello">
          <WbInput value={nomeModello} onChange={setNomeModello} />
        </WbField>
      </WbModal>
    </div>
  )
}

/** Impostazioni della singola pagina, usate dalla scheda Pagine. */
export const WbPageSettings: React.FC<{
  content: WbPageContent
  onChange: (c: WbPageContent) => void
}> = ({ content, onChange }) => {
  const s = content.settings || {}
  const set = (k: string, v: unknown) => onChange({ ...content, settings: wbSet(s, k, v) })
  return (
    <div className="space-y-1">
      <WbField label="Nascondi il menu in alto" inline>
        <WbToggle checked={!!s.hideHeader} onChange={(v) => set('hideHeader', v)} />
      </WbField>
      <WbField label="Nascondi il pie' di pagina" inline>
        <WbToggle checked={!!s.hideFooter} onChange={(v) => set('hideFooter', v)} />
      </WbField>
    </div>
  )
}

export { wbGet }
export default WbEditor
