/**
 * WbPagesView.tsx — l'elenco delle pagine.
 *
 * Da qui si crea, si duplica, si programma, si archivia e si apre
 * l'editor. La colonna "Sul sito" e' la piu' importante: dice se il
 * builder ha davvero preso il posto della pagina React esistente, che
 * e' l'unico modo in cui questo modulo puo' cambiare cio' che vede un
 * cliente.
 */

import React from 'react'
import toast from 'react-hot-toast'
import {
  wbListPages, wbCreatePage, wbUpdatePage, wbDeletePage, wbDuplicatePage,
  wbSetHome, wbNormalizeSlug, wbListTemplates, wbSaveTemplate, wbDeleteTemplate,
  type WbPageRow, type WbSiteRow, type WbTemplateRow,
} from './wbApi'
import {
  WbCard, WbButton, WbIconButton, WbIcon, WbModal, WbConfirm, WbBadge,
  WbInput, WbField, WbSelect, WbToggle, WbEmptyState, WB_UI_ICONS,
  WB_STATUS_LABEL, wbDataOra, wbDaAllora, wbIsoAInput, wbInputAIso,
} from './WbUI'
import { wbValidatePage } from './wbValidate'

export const WbPagesView: React.FC<{
  site: WbSiteRow
  pages: WbPageRow[]
  onReload: () => void
  onOpen: (p: WbPageRow) => void
  can: (r: string) => boolean
}> = ({ site, pages, onReload, onOpen, can }) => {
  const canEdit = can('website.edit')
  const [cerca, setCerca] = React.useState('')
  const [nuova, setNuova] = React.useState(false)
  const [titolo, setTitolo] = React.useState('')
  const [slug, setSlug] = React.useState('')
  const [slugToccato, setSlugToccato] = React.useState(false)
  const [impostazioni, setImpostazioni] = React.useState<WbPageRow | null>(null)
  const [daEliminare, setDaEliminare] = React.useState<WbPageRow | null>(null)
  // Modelli di PAGINA: una pagina finita che si riusa come punto di
  // partenza per un'altra. Diversi dai modelli di sezione, che vivono
  // dentro l'editor.
  const [modelli, setModelli] = React.useState<WbTemplateRow[]>([])
  const [daModello, setDaModello] = React.useState<string>('')
  const [salvaModello, setSalvaModello] = React.useState<WbPageRow | null>(null)
  const [nomeModello, setNomeModello] = React.useState('')

  React.useEffect(() => { void wbListTemplates(site.id, 'page').then(setModelli) }, [site.id])

  const visibili = pages.filter((p) =>
    !cerca
    || p.title.toLowerCase().includes(cerca.toLowerCase())
    || p.slug.toLowerCase().includes(cerca.toLowerCase()))

  const crea = async () => {
    if (!titolo.trim()) { toast.error('Serve un titolo'); return }
    const modello = modelli.find((m) => m.id === daModello)
    const p = await wbCreatePage(site.id, {
      title: titolo.trim(),
      slug: slug || titolo,
      // Il modello e' solo un punto di partenza: da qui in poi la pagina
      // vive per conto suo, modificarla non tocca il modello.
      content: modello
        ? (JSON.parse(JSON.stringify((modello.payload as { content?: unknown }).content ?? modello.payload)) as never)
        : undefined,
    })
    if (!p) { toast.error('Creazione non riuscita'); return }
    toast.success('Pagina creata come bozza')
    setNuova(false); setTitolo(''); setSlug(''); setSlugToccato(false); setDaModello('')
    onReload()
    onOpen(p)
  }

  const salvaImpostazioni = async () => {
    if (!impostazioni) return
    try {
      await wbUpdatePage(impostazioni.id, {
        title: impostazioni.title,
        slug: impostazioni.slug,
        status: impostazioni.status,
        overrides_route: impostazioni.overrides_route,
        scheduled_at: impostazioni.scheduled_at,
        unpublish_at: impostazioni.unpublish_at,
        sort_order: impostazioni.sort_order,
      })
      toast.success('Impostazioni salvate. Vanno online alla prossima pubblicazione.')
      setImpostazioni(null)
      onReload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Salvataggio non riuscito')
    }
  }

  return (
    <div className="space-y-4">
      <WbCard
        title="Pagine del sito"
        subtitle="Una riga per pagina. Le modifiche vivono nella bozza finche' non pubblichi."
        actions={
          <>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none">
                <WbIcon path={WB_UI_ICONS.search} size={14} />
              </span>
              <input
                className="w-48 pl-8 pr-2.5 py-1.5 text-[13px] bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary"
                placeholder="Cerca pagina…"
                value={cerca}
                onChange={(e) => setCerca(e.target.value)}
              />
            </div>
            <WbButton tone="primary" size="sm" disabled={!canEdit} onClick={() => setNuova(true)}>
              <WbIcon path={WB_UI_ICONS.plus} size={14} /> Nuova pagina
            </WbButton>
          </>
        }
      >
        {visibili.length === 0 ? (
          <WbEmptyState
            title={pages.length === 0 ? 'Nessuna pagina nel builder' : 'Nessun risultato'}
            text={pages.length === 0
              ? 'Il sito continua a funzionare com\'e\'. Crea la prima pagina, oppure importa quelle esistenti dalle Impostazioni.'
              : undefined}
          />
        ) : (
          <div className="overflow-x-auto -mx-4 -mb-4">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-theme-text-muted border-b border-theme-border">
                  <th className="px-4 py-2 font-medium">Pagina</th>
                  <th className="px-3 py-2 font-medium">Indirizzo</th>
                  <th className="px-3 py-2 font-medium">Stato</th>
                  <th className="px-3 py-2 font-medium">Sul sito</th>
                  <th className="px-3 py-2 font-medium">SEO</th>
                  <th className="px-3 py-2 font-medium">Ultima modifica</th>
                  <th className="px-3 py-2 font-medium">Pubblicata</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {visibili.map((p) => {
                  const st = WB_STATUS_LABEL[p.status] || WB_STATUS_LABEL.draft
                  const problemi = wbValidatePage(p)
                  const errori = problemi.filter((i) => i.level === 'error').length
                  const avvisi = problemi.filter((i) => i.level === 'warning').length
                  const bozzaNonPubblicata =
                    JSON.stringify(p.draft_content) !== JSON.stringify(p.published_content || null)
                  return (
                    <tr key={p.id} className="border-b border-theme-border/60 hover:bg-theme-bg-hover/40">
                      <td className="px-4 py-2.5">
                        <button type="button" className="text-theme-text-primary font-medium hover:text-cyan-400 text-left" onClick={() => onOpen(p)}>
                          {p.title}
                        </button>
                        <div className="flex gap-1 mt-0.5">
                          {p.is_home && <WbBadge tone="info">home</WbBadge>}
                          {bozzaNonPubblicata && p.status === 'published' && <WbBadge tone="warning">bozza da pubblicare</WbBadge>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5"><code className="text-theme-text-muted">{p.slug}</code></td>
                      <td className="px-3 py-2.5"><WbBadge tone={st.tone}>{st.label}</WbBadge></td>
                      <td className="px-3 py-2.5">
                        {p.overrides_route
                          ? <WbBadge tone="success">attiva</WbBadge>
                          : <span className="text-theme-text-muted">pagina originale</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {errori > 0
                          ? <WbBadge tone="danger">{errori} errori</WbBadge>
                          : avvisi > 0
                            ? <WbBadge tone="warning">{avvisi} avvisi</WbBadge>
                            : <WbBadge tone="success">a posto</WbBadge>}
                      </td>
                      <td className="px-3 py-2.5 text-theme-text-muted">
                        {wbDaAllora(p.last_edited_at)}
                        {p.last_edited_by && <div className="text-[10px]">{p.last_edited_by}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-theme-text-muted">{p.published_at ? wbDataOra(p.published_at) : '—'}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <WbIconButton path={WB_UI_ICONS.settings} label="Impostazioni" disabled={!canEdit} onClick={() => setImpostazioni({ ...p })} />
                          <WbIconButton path={WB_UI_ICONS.home} label="Imposta come home" disabled={!canEdit || p.is_home}
                            onClick={async () => {
                              if (await wbSetHome(site.id, p.id)) { toast.success('Home aggiornata'); onReload() }
                              else toast.error('Operazione non riuscita')
                            }} />
                          <WbIconButton path={WB_UI_ICONS.layers} label="Salva come modello di pagina" disabled={!canEdit}
                            onClick={() => { setSalvaModello(p); setNomeModello(p.title) }} />
                          <WbIconButton path={WB_UI_ICONS.copy} label="Duplica" disabled={!canEdit}
                            onClick={async () => {
                              const copia = await wbDuplicatePage(site.id, p)
                              if (copia) { toast.success('Pagina duplicata'); onReload() }
                              else toast.error('Duplicazione non riuscita')
                            }} />
                          <WbIconButton path={WB_UI_ICONS.trash} label="Elimina" tone="danger" disabled={!canEdit} onClick={() => setDaEliminare(p)} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </WbCard>

      {/* Nuova pagina */}
      <WbModal
        open={nuova}
        onClose={() => setNuova(false)}
        title="Nuova pagina"
        subtitle="Nasce come bozza: non compare sul sito finche' non la pubblichi."
        size="sm"
        footer={<><WbButton onClick={() => setNuova(false)}>Annulla</WbButton><WbButton tone="primary" onClick={() => void crea()}>Crea e apri</WbButton></>}
      >
        {modelli.length > 0 && (
          <WbField label="Parti da un modello" help="Facoltativo: copia la struttura di una pagina gia' fatta.">
            <WbSelect
              value={daModello}
              onChange={setDaModello}
              options={[{ value: '', label: 'Pagina vuota' }, ...modelli.map((m) => ({ value: m.id, label: m.name }))]}
            />
          </WbField>
        )}
        <WbField label="Titolo">
          <WbInput
            value={titolo}
            onChange={(v) => { setTitolo(v); if (!slugToccato) setSlug(wbNormalizeSlug(v)) }}
            placeholder="Es. Offerte estate"
          />
        </WbField>
        <WbField label="Indirizzo" help="Come apparira' nella barra del browser.">
          <WbInput
            value={slug}
            onChange={(v) => { setSlugToccato(true); setSlug(v) }}
            placeholder="/offerte-estate"
          />
        </WbField>
      </WbModal>

      {/* Impostazioni della pagina */}
      <WbModal
        open={!!impostazioni}
        onClose={() => setImpostazioni(null)}
        title="Impostazioni della pagina"
        size="md"
        footer={<><WbButton onClick={() => setImpostazioni(null)}>Annulla</WbButton><WbButton tone="primary" onClick={() => void salvaImpostazioni()}>Salva</WbButton></>}
      >
        {impostazioni && (
          <div className="space-y-1">
            <WbField label="Titolo">
              <WbInput value={impostazioni.title} onChange={(v) => setImpostazioni({ ...impostazioni, title: v })} />
            </WbField>
            <WbField label="Indirizzo">
              <WbInput value={impostazioni.slug} onChange={(v) => setImpostazioni({ ...impostazioni, slug: v })} />
            </WbField>
            <WbField label="Stato" help="Solo Pubblicata e Programmata finiscono online.">
              <WbSelect
                value={impostazioni.status}
                onChange={(v) => setImpostazioni({ ...impostazioni, status: v as WbPageRow['status'] })}
                options={[
                  { value: 'draft', label: 'Bozza' },
                  { value: 'scheduled', label: 'Programmata' },
                  { value: 'published', label: 'Pubblicata' },
                  { value: 'archived', label: 'Archiviata' },
                ]}
              />
            </WbField>
            {impostazioni.status === 'scheduled' && (
              <div className="grid grid-cols-2 gap-2">
                <WbField label="Compare il">
                  <input
                    type="datetime-local"
                    className="w-full px-2.5 py-1.5 text-[13px] bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary"
                    value={wbIsoAInput(impostazioni.scheduled_at)}
                    onChange={(e) => setImpostazioni({ ...impostazioni, scheduled_at: wbInputAIso(e.target.value) })}
                  />
                </WbField>
                <WbField label="Sparisce il">
                  <input
                    type="datetime-local"
                    className="w-full px-2.5 py-1.5 text-[13px] bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary"
                    value={wbIsoAInput(impostazioni.unpublish_at)}
                    onChange={(e) => setImpostazioni({ ...impostazioni, unpublish_at: wbInputAIso(e.target.value) })}
                  />
                </WbField>
              </div>
            )}
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <WbField
                label="Questa pagina prende il posto di quella attuale del sito"
                inline
                help="Finche' e' spento, il sito continua a mostrare la pagina React esistente. E' l'interruttore che evita qualsiasi sorpresa."
              >
                <WbToggle
                  checked={impostazioni.overrides_route}
                  onChange={(v) => setImpostazioni({ ...impostazioni, overrides_route: v })}
                />
              </WbField>
            </div>
            <WbField label="Ordine nell'elenco">
              <WbInput
                value={String(impostazioni.sort_order)}
                onChange={(v) => setImpostazioni({ ...impostazioni, sort_order: Number(v) || 0 })}
              />
            </WbField>
          </div>
        )}
      </WbModal>

      <WbModal
        open={!!salvaModello}
        onClose={() => setSalvaModello(null)}
        title="Salva come modello di pagina"
        subtitle="Lo ritrovi quando crei una pagina nuova."
        size="sm"
        footer={
          <>
            <WbButton onClick={() => setSalvaModello(null)}>Annulla</WbButton>
            <WbButton tone="primary" onClick={async () => {
              if (!salvaModello) return
              try {
                await wbSaveTemplate(site.id, 'page', nomeModello || salvaModello.title, {
                  content: salvaModello.draft_content,
                  seo: salvaModello.seo,
                }, `Da "${salvaModello.title}"`)
                toast.success('Modello salvato')
                setModelli(await wbListTemplates(site.id, 'page'))
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
        {modelli.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-semibold text-theme-text-secondary mb-1.5">Modelli gia' salvati</p>
            <div className="space-y-1">
              {modelli.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-theme-border px-2.5 py-1.5">
                  <span className="text-[12px] text-theme-text-primary truncate">{m.name}</span>
                  <WbIconButton path={WB_UI_ICONS.trash} label="Elimina modello" tone="danger" onClick={async () => {
                    if (await wbDeleteTemplate(site.id, m.id, m.name)) {
                      setModelli(await wbListTemplates(site.id, 'page'))
                    }
                  }} />
                </div>
              ))}
            </div>
          </div>
        )}
      </WbModal>

      <WbConfirm
        open={!!daEliminare}
        title="Eliminare questa pagina?"
        message={`"${daEliminare?.title}" viene cancellata con tutte le sue sezioni. Le versioni gia' pubblicate restano nello storico, ma la pagina non tornera' da sola.`}
        confirmLabel="Elimina"
        onCancel={() => setDaEliminare(null)}
        onConfirm={async () => {
          if (!daEliminare) return
          const ok = await wbDeletePage(site.id, daEliminare.id, daEliminare.title)
          if (ok) { toast.success('Pagina eliminata'); setDaEliminare(null); onReload() }
          else toast.error('Eliminazione non riuscita')
        }}
      />
    </div>
  )
}

export { wbListPages }
export default WbPagesView
