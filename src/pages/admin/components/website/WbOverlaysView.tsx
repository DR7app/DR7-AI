/**
 * WbOverlaysView.tsx — Popup, Striscioni e Promozioni.
 *
 * Sono la stessa cosa con tre destinazioni diverse, quindi un solo
 * schermo: contenuto, dove appare, quando appare. La finestra temporale
 * viene valutata dal sito al momento della visita, per cui una promozione
 * scaduta sparisce da sola — nessuno deve ricordarsi di spegnerla.
 */

import React from 'react'
import toast from 'react-hot-toast'
import type { WbButton as WbBtn, WbOverlay, WbText } from './shared/wbSchema'
import { wbId } from './shared/wbSchema'
import { wbListOverlays, wbSaveOverlay, wbDeleteOverlay, type WbSiteRow, type WbMediaRow } from './wbApi'
import {
  WbCard, WbButton, WbIconButton, WbIcon, WbModal, WbConfirm, WbBadge,
  WbField, WbInput, WbTextarea, WbSelect, WbToggle, WbSlider, WbColor,
  WbEmptyState, WB_UI_ICONS, WB_STATUS_LABEL, wbIsoAInput, wbInputAIso, wbDataOra,
} from './WbUI'
import { WbMediaPicker, WbMediaSlot } from './WbMediaView'

const KIND: { id: WbOverlay['kind']; label: string; descr: string; icon: string }[] = [
  { id: 'popup', label: 'Popup', descr: 'Si apre sopra la pagina.', icon: WB_UI_ICONS.popup },
  { id: 'banner', label: 'Striscioni', descr: 'Una fascia in cima o in fondo.', icon: WB_UI_ICONS.banner },
  { id: 'promo', label: 'Promozioni', descr: 'Alimentano le sezioni "Promozioni" delle pagine.', icon: WB_UI_ICONS.promo },
]

const vuoto = (kind: WbOverlay['kind']): WbOverlay => ({
  id: '',
  kind,
  name: kind === 'popup' ? 'Nuovo popup' : kind === 'banner' ? 'Nuovo striscione' : 'Nuova promozione',
  status: 'draft',
  config: {
    title: { it: '', en: '' },
    text: { it: '', en: '' },
    buttons: [],
    position: kind === 'banner' ? 'top' : 'center',
    size: 'md',
    dismissible: true,
  },
  targeting: { pages: [], devices: ['desktop', 'tablet', 'mobile'], frequencyHours: 24, delaySeconds: 3 },
  starts_at: null,
  ends_at: null,
})

export const WbOverlaysView: React.FC<{
  site: WbSiteRow
  pages: { slug: string; title: string }[]
  can: (r: string) => boolean
}> = ({ site, pages, can }) => {
  const canEdit = can('website.edit')
  const [kind, setKind] = React.useState<WbOverlay['kind']>('popup')
  const [lista, setLista] = React.useState<WbOverlay[]>([])
  const [loading, setLoading] = React.useState(true)
  const [modifica, setModifica] = React.useState<WbOverlay | null>(null)
  const [daEliminare, setDaEliminare] = React.useState<WbOverlay | null>(null)
  const [mediaReq, setMediaReq] = React.useState<{ cb: (m: WbMediaRow) => void } | null>(null)

  const carica = React.useCallback(async () => {
    setLoading(true)
    setLista(await wbListOverlays(site.id, kind))
    setLoading(false)
  }, [site.id, kind])

  React.useEffect(() => { void carica() }, [carica])

  const salva = async () => {
    if (!modifica) return
    try {
      await wbSaveOverlay(site.id, modifica)
      toast.success('Salvato. Va online alla prossima pubblicazione.')
      setModifica(null)
      void carica()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Salvataggio non riuscito')
    }
  }

  const setCfg = (k: string, v: unknown) => modifica && setModifica({ ...modifica, config: { ...modifica.config, [k]: v } })
  const setTgt = (k: string, v: unknown) => modifica && setModifica({ ...modifica, targeting: { ...modifica.targeting, [k]: v } })
  const setTxt = (k: 'title' | 'text', lang: 'it' | 'en', v: string) =>
    modifica && setCfg(k, { ...((modifica.config[k] as WbText) || {}), [lang]: v })

  const attiva = (o: WbOverlay) => {
    const ora = Date.now()
    if (o.status !== 'published' && o.status !== 'scheduled') return false
    if (o.starts_at && new Date(o.starts_at).getTime() > ora) return false
    if (o.ends_at && new Date(o.ends_at).getTime() < ora) return false
    return true
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {KIND.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => setKind(k.id)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
              kind === k.id ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-400' : 'border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover'
            }`}
          >
            <WbIcon path={k.icon} size={16} />
            <span className="text-left">
              <span className="block text-[12px] font-medium">{k.label}</span>
              <span className="block text-[10px] text-theme-text-muted">{k.descr}</span>
            </span>
          </button>
        ))}
      </div>

      <WbCard
        title={KIND.find((k) => k.id === kind)!.label}
        actions={
          <WbButton size="sm" tone="primary" disabled={!canEdit} onClick={() => setModifica(vuoto(kind))}>
            <WbIcon path={WB_UI_ICONS.plus} size={14} /> Nuovo
          </WbButton>
        }
      >
        {loading ? (
          <p className="text-[12px] text-theme-text-muted">Carico…</p>
        ) : lista.length === 0 ? (
          <WbEmptyState title="Niente di attivo" text="Crea il primo: resta in bozza finche' non lo pubblichi." />
        ) : (
          <div className="space-y-2">
            {lista.map((o) => {
              const st = WB_STATUS_LABEL[o.status] || WB_STATUS_LABEL.draft
              return (
                <div key={o.id} className="flex items-center gap-3 rounded-lg border border-theme-border bg-theme-bg-tertiary/40 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] text-theme-text-primary truncate">{o.name}</span>
                      <WbBadge tone={st.tone}>{st.label}</WbBadge>
                      {attiva(o) && <WbBadge tone="success">visibile ora</WbBadge>}
                      {o.ends_at && new Date(o.ends_at).getTime() < Date.now() && <WbBadge tone="neutral">scaduto</WbBadge>}
                    </div>
                    <p className="text-[10px] text-theme-text-muted mt-0.5">
                      {o.starts_at ? `dal ${wbDataOra(o.starts_at)}` : 'senza data di inizio'}
                      {o.ends_at ? ` · fino al ${wbDataOra(o.ends_at)}` : ''}
                      {o.targeting?.pages?.length ? ` · solo su ${o.targeting.pages.join(', ')}` : ' · tutte le pagine'}
                    </p>
                  </div>
                  <WbIconButton path={WB_UI_ICONS.settings} label="Modifica" disabled={!canEdit} onClick={() => setModifica({ ...o })} />
                  <WbIconButton path={WB_UI_ICONS.copy} label="Duplica" disabled={!canEdit}
                    onClick={() => setModifica({ ...JSON.parse(JSON.stringify(o)), id: '', name: `${o.name} (copia)`, status: 'draft' })} />
                  <WbIconButton path={WB_UI_ICONS.trash} label="Elimina" tone="danger" disabled={!canEdit} onClick={() => setDaEliminare(o)} />
                </div>
              )
            })}
          </div>
        )}
      </WbCard>

      <WbModal
        open={!!modifica}
        onClose={() => setModifica(null)}
        title={modifica?.id ? 'Modifica' : 'Nuovo'}
        size="lg"
        footer={<><WbButton onClick={() => setModifica(null)}>Annulla</WbButton><WbButton tone="primary" onClick={() => void salva()}>Salva</WbButton></>}
      >
        {modifica && (
          <div className="grid md:grid-cols-2 gap-5">
            <div className="space-y-0.5">
              <p className="text-[11px] font-semibold text-theme-text-secondary">Contenuto</p>
              <WbField label="Nome interno" help="Solo per te, non si vede sul sito.">
                <WbInput value={modifica.name} onChange={(v) => setModifica({ ...modifica, name: v })} />
              </WbField>
              <WbField label="Titolo">
                <WbInput value={(modifica.config.title as WbText)?.it || ''} onChange={(v) => setTxt('title', 'it', v)} />
              </WbField>
              <WbField label="Titolo in inglese">
                <WbInput value={(modifica.config.title as WbText)?.en || ''} onChange={(v) => setTxt('title', 'en', v)} />
              </WbField>
              <WbField label="Testo">
                <WbTextarea rows={3} value={(modifica.config.text as WbText)?.it || ''} onChange={(v) => setTxt('text', 'it', v)} />
              </WbField>
              <WbField label="Immagine">
                <WbMediaSlot
                  url={modifica.config.image?.url}
                  onOpen={() => setMediaReq({ cb: (m) => setCfg('image', { url: m.url, alt: m.alt }) })}
                  onClear={() => setCfg('image', undefined)}
                />
              </WbField>
              <WbField label="Video">
                <WbMediaSlot
                  kind="video"
                  url={modifica.config.video?.url}
                  onOpen={() => setMediaReq({ cb: (m) => setCfg('video', { url: m.url, autoplay: true, loop: true, muted: true }) })}
                  onClear={() => setCfg('video', undefined)}
                />
              </WbField>
              <WbField label="Pulsante">
                <div className="space-y-1">
                  {(modifica.config.buttons || []).map((b: WbBtn, i: number) => (
                    <div key={b.id} className="flex gap-1">
                      <WbInput value={b.label?.it || ''} onChange={(v) => setCfg('buttons', (modifica.config.buttons || []).map((x: WbBtn, j: number) => (j === i ? { ...x, label: { ...x.label, it: v } } : x)))} />
                      <WbInput value={b.href || ''} onChange={(v) => setCfg('buttons', (modifica.config.buttons || []).map((x: WbBtn, j: number) => (j === i ? { ...x, href: v } : x)))} />
                      <WbIconButton path={WB_UI_ICONS.trash} label="Togli" tone="danger"
                        onClick={() => setCfg('buttons', (modifica.config.buttons || []).filter((_: WbBtn, j: number) => j !== i))} />
                    </div>
                  ))}
                  <WbButton size="sm" onClick={() => setCfg('buttons', [...(modifica.config.buttons || []), { id: wbId('btn'), label: { it: 'Scopri', en: 'Discover' }, href: '/', kind: 'page', variant: 'primary' }])}>
                    <WbIcon path={WB_UI_ICONS.plus} size={13} /> Aggiungi pulsante
                  </WbButton>
                </div>
              </WbField>
              <WbField label="Colore di sfondo"><WbColor value={modifica.config.bgColor} onChange={(v) => setCfg('bgColor', v)} /></WbField>
              <WbField label="Colore del testo"><WbColor value={modifica.config.textColor} onChange={(v) => setCfg('textColor', v)} /></WbField>
            </div>

            <div className="space-y-0.5">
              <p className="text-[11px] font-semibold text-theme-text-secondary">Dove e quando</p>
              <WbField label="Stato">
                <WbSelect
                  value={modifica.status}
                  onChange={(v) => setModifica({ ...modifica, status: v as WbOverlay['status'] })}
                  options={[
                    { value: 'draft', label: 'Bozza (non si vede)' },
                    { value: 'scheduled', label: 'Programmato' },
                    { value: 'published', label: 'Attivo' },
                    { value: 'archived', label: 'Archiviato' },
                  ]}
                />
              </WbField>
              <div className="grid grid-cols-2 gap-2">
                <WbField label="Comincia il">
                  <input type="datetime-local"
                    className="w-full px-2.5 py-1.5 text-[13px] bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary"
                    value={wbIsoAInput(modifica.starts_at)}
                    onChange={(e) => setModifica({ ...modifica, starts_at: wbInputAIso(e.target.value) })} />
                </WbField>
                <WbField label="Finisce il" help="Dopo questa data sparisce da solo.">
                  <input type="datetime-local"
                    className="w-full px-2.5 py-1.5 text-[13px] bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary"
                    value={wbIsoAInput(modifica.ends_at)}
                    onChange={(e) => setModifica({ ...modifica, ends_at: wbInputAIso(e.target.value) })} />
                </WbField>
              </div>
              <WbField label="Su quali pagine" help="Nessuna selezione = tutte le pagine.">
                <select
                  multiple
                  size={5}
                  className="w-full px-2 py-1.5 text-[12px] bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary"
                  value={modifica.targeting?.pages || []}
                  onChange={(e) => setTgt('pages', Array.from(e.target.selectedOptions).map((o) => o.value))}
                >
                  {pages.map((p) => <option key={p.slug} value={p.slug}>{p.title} — {p.slug}</option>)}
                </select>
              </WbField>
              <WbField label="Su quali schermi">
                <div className="flex gap-3">
                  {(['desktop', 'tablet', 'mobile'] as const).map((d) => (
                    <label key={d} className="flex items-center gap-1.5 text-[11px] text-theme-text-secondary">
                      <input
                        type="checkbox"
                        checked={(modifica.targeting?.devices || []).includes(d)}
                        onChange={(e) => {
                          const cur = new Set(modifica.targeting?.devices || [])
                          if (e.target.checked) cur.add(d); else cur.delete(d)
                          setTgt('devices', [...cur])
                        }}
                      />
                      {d === 'desktop' ? 'Schermo grande' : d === 'tablet' ? 'Tablet' : 'Telefono'}
                    </label>
                  ))}
                </div>
              </WbField>
              {kind === 'popup' && (
                <>
                  <WbField label="Dopo quanti secondi appare">
                    <WbSlider value={modifica.targeting?.delaySeconds} min={0} max={60} step={1} unit="s" onChange={(v) => setTgt('delaySeconds', v)} />
                  </WbField>
                  <WbField label="Ogni quante ore si ripresenta" help="0 = a ogni visita.">
                    <WbSlider value={modifica.targeting?.frequencyHours} min={0} max={720} step={1} unit="h" onChange={(v) => setTgt('frequencyHours', v)} />
                  </WbField>
                  <WbField label="Appare quando si sta per uscire" inline help="Solo su schermo grande: sul telefono non esiste il gesto.">
                    <WbToggle checked={!!modifica.targeting?.exitIntent} onChange={(v) => setTgt('exitIntent', v)} />
                  </WbField>
                  <WbField label="Appare dopo aver scorso" help="0 = non aspetta lo scorrimento.">
                    <WbSlider value={modifica.targeting?.scrollPercent} min={0} max={100} step={5} unit="%" onChange={(v) => setTgt('scrollPercent', v)} />
                  </WbField>
                  <WbField label="Posizione">
                    <WbSelect
                      value={modifica.config.position || 'center'}
                      onChange={(v) => setCfg('position', v)}
                      options={[
                        { value: 'center', label: 'Al centro' },
                        { value: 'bottom-right', label: 'In basso a destra' },
                        { value: 'bottom-left', label: 'In basso a sinistra' },
                      ]}
                    />
                  </WbField>
                </>
              )}
              {kind === 'banner' && (
                <WbField label="Posizione">
                  <WbSelect
                    value={modifica.config.position || 'top'}
                    onChange={(v) => setCfg('position', v)}
                    options={[{ value: 'top', label: 'In cima' }, { value: 'bottom', label: 'In fondo' }]}
                  />
                </WbField>
              )}
              <WbField label="Si puo' chiudere" inline>
                <WbToggle checked={modifica.config.dismissible !== false} onChange={(v) => setCfg('dismissible', v)} />
              </WbField>
            </div>
          </div>
        )}
      </WbModal>

      <WbConfirm
        open={!!daEliminare}
        title="Eliminare?"
        message={`"${daEliminare?.name}" viene cancellato definitivamente.`}
        confirmLabel="Elimina"
        onCancel={() => setDaEliminare(null)}
        onConfirm={async () => {
          if (!daEliminare) return
          const ok = await wbDeleteOverlay(site.id, daEliminare.id, daEliminare.name)
          if (ok) { toast.success('Eliminato'); setDaEliminare(null); void carica() }
          else toast.error('Eliminazione non riuscita')
        }}
      />

      {mediaReq && (
        <WbMediaPicker
          open site={site} canWrite={can('website.media')}
          onClose={() => setMediaReq(null)}
          onPick={(m) => { mediaReq.cb(m); setMediaReq(null) }}
        />
      )}
    </div>
  )
}

export default WbOverlaysView
