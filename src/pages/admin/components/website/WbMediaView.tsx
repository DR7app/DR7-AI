/**
 * WbMediaView.tsx — la libreria media e il selettore.
 *
 * Un solo componente per due usi: la scheda "Media" del builder e la
 * finestra che si apre quando un campo chiede un'immagine. Cambiare la
 * libreria in un posto solo evita che le due divergano.
 *
 * Cosa fa davvero, oltre a caricare file:
 *  · comprime e ridimensiona le foto troppo grandi PRIMA del caricamento
 *    (in wbApi), cosi' nessuno mette in home un PNG da 6000 px;
 *  · tiene testo alternativo, titolo e didascalia accanto al file, non
 *    dentro la pagina: cambiando foto non si perde l'accessibilita';
 *  · il punto focale sposta il soggetto dentro il ritaglio invece di
 *    obbligare a ritagliare a mano.
 */

import React from 'react'
import toast from 'react-hot-toast'
import {
  wbListMedia, wbUploadMedia, wbUpdateMedia, wbDeleteMedia, wbReplaceMedia,
  wbMediaFolders, type WbMediaRow, type WbSiteRow,
} from './wbApi'
import {
  WbButton, WbIconButton, WbInput, WbModal, WbSelect, WbField, WbEmptyState,
  WbConfirm, WbBadge, WB_UI_ICONS, WbIcon, wbPeso, wbDataOra, WbSlider,
} from './WbUI'

const KIND_LABEL: Record<string, string> = {
  all: 'Tutti', image: 'Immagini', video: 'Video', icon: 'Icone', document: 'Documenti',
}

export interface WbMediaLibraryProps {
  site: WbSiteRow
  /** Se presente, la libreria e' in modalita' "scegli": mostra Seleziona. */
  onPick?: (media: WbMediaRow) => void
  /** Limita ai soli tipi utili al campo che ha aperto la finestra. */
  restrictKind?: 'image' | 'video' | 'icon' | 'document'
  canWrite: boolean
}

export const WbMediaLibrary: React.FC<WbMediaLibraryProps> = ({ site, onPick, restrictKind, canWrite }) => {
  const [items, setItems] = React.useState<WbMediaRow[]>([])
  const [folders, setFolders] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(true)
  const [kind, setKind] = React.useState<string>(restrictKind || 'all')
  const [folder, setFolder] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [uploading, setUploading] = React.useState(0)
  const [detail, setDetail] = React.useState<WbMediaRow | null>(null)
  const [daEliminare, setDaEliminare] = React.useState<WbMediaRow | null>(null)
  const [dragOver, setDragOver] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const replaceRef = React.useRef<HTMLInputElement>(null)

  const carica = React.useCallback(async () => {
    setLoading(true)
    const [rows, f] = await Promise.all([
      wbListMedia(site.id, { kind: kind as never, folder: folder || undefined, search: search || undefined }),
      wbMediaFolders(site.id),
    ])
    setItems(rows)
    setFolders(f)
    setLoading(false)
  }, [site.id, kind, folder, search])

  React.useEffect(() => { void carica() }, [carica])

  const carica_file = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return
    setUploading(list.length)
    let ok = 0
    for (const f of list) {
      const res = await wbUploadMedia(site, f, folder)
      if (res.ok) ok += 1
      else toast.error(`${f.name}: ${res.error}`)
      setUploading((n) => n - 1)
    }
    if (ok) toast.success(ok === 1 ? 'File caricato' : `${ok} file caricati`)
    void carica()
  }

  const visibili = items

  return (
    <div className="space-y-3">
      {/* Barra dei filtri */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none">
            <WbIcon path={WB_UI_ICONS.search} size={14} />
          </span>
          <input
            className="w-full pl-8 pr-2.5 py-1.5 text-[13px] bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary"
            placeholder="Cerca per nome file…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {!restrictKind && (
          <select
            className="px-2.5 py-1.5 text-[13px] bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary"
            value={kind} onChange={(e) => setKind(e.target.value)}
          >
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
        <select
          className="px-2.5 py-1.5 text-[13px] bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary"
          value={folder} onChange={(e) => setFolder(e.target.value)}
        >
          <option value="">Tutte le cartelle</option>
          {folders.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <WbIconButton path={WB_UI_ICONS.refresh} label="Aggiorna" onClick={() => void carica()} />
        {canWrite && (
          <WbButton tone="primary" size="sm" onClick={() => fileRef.current?.click()}>
            <WbIcon path={WB_UI_ICONS.plus} size={14} /> Carica
          </WbButton>
        )}
        <input
          ref={fileRef} type="file" multiple hidden
          accept="image/*,video/*,application/pdf"
          onChange={(e) => { if (e.target.files) void carica_file(e.target.files); e.target.value = '' }}
        />
      </div>

      {/* Zona di trascinamento */}
      {canWrite && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false)
            if (e.dataTransfer.files?.length) void carica_file(e.dataTransfer.files)
          }}
          className={`rounded-xl border-2 border-dashed px-4 py-3 text-center text-[12px] transition-colors ${
            dragOver ? 'border-cyan-500 bg-cyan-500/5 text-cyan-400' : 'border-theme-border text-theme-text-muted'
          }`}
        >
          {uploading > 0
            ? `Caricamento in corso… (${uploading} rimanenti)`
            : 'Trascina qui i file per caricarli' + (folder ? ` nella cartella "${folder}"` : '')}
        </div>
      )}

      {/* Griglia */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-lg bg-theme-bg-tertiary animate-pulse" />
          ))}
        </div>
      ) : visibili.length === 0 ? (
        <WbEmptyState
          title="Nessun file"
          text="Carica immagini e video: da qui li userai in tutte le pagine, senza ricaricarli ogni volta."
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {visibili.map((m) => (
            <figure key={m.id} className="group relative rounded-lg overflow-hidden border border-theme-border bg-theme-bg-tertiary">
              <div className="aspect-square relative">
                {m.kind === 'video' ? (
                  <video src={m.url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                ) : m.kind === 'document' ? (
                  <div className="w-full h-full flex items-center justify-center text-theme-text-muted">
                    <WbIcon path={WB_UI_ICONS.page} size={28} />
                  </div>
                ) : (
                  <img src={m.url} alt={m.alt?.it || m.filename} loading="lazy" className="w-full h-full object-cover" />
                )}
                <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                  {onPick && (
                    <WbButton size="sm" tone="primary" onClick={() => onPick(m)}>Seleziona</WbButton>
                  )}
                  <WbButton size="sm" onClick={() => setDetail(m)}>Dettagli</WbButton>
                </div>
                {!m.alt?.it && m.kind === 'image' && (
                  <span className="absolute top-1.5 left-1.5"><WbBadge tone="warning">alt</WbBadge></span>
                )}
              </div>
              <figcaption className="px-2 py-1.5">
                <p className="text-[11px] text-theme-text-primary truncate" title={m.filename}>{m.filename}</p>
                <p className="text-[10px] text-theme-text-muted">
                  {wbPeso(m.size_bytes)}{m.width ? ` · ${m.width}×${m.height}` : ''}
                </p>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {/* Dettagli del file */}
      <WbModal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.filename || ''}
        subtitle={detail ? `Caricato il ${wbDataOra(detail.created_at)}` : undefined}
        size="lg"
        footer={detail && canWrite ? (
          <>
            <WbButton tone="danger" onClick={() => { setDaEliminare(detail); }}>Elimina</WbButton>
            <WbButton onClick={() => replaceRef.current?.click()}>Sostituisci file</WbButton>
            <WbButton tone="primary" onClick={async () => {
              if (!detail) return
              const ok = await wbUpdateMedia(detail.id, {
                alt: detail.alt, title: detail.title, caption: detail.caption,
                folder: detail.folder, tags: detail.tags,
                focal_x: detail.focal_x, focal_y: detail.focal_y,
              })
              if (ok) { toast.success('Salvato'); setDetail(null); void carica() }
              else toast.error('Salvataggio non riuscito')
            }}>Salva</WbButton>
          </>
        ) : undefined}
      >
        {detail && (
          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <div className="relative rounded-lg overflow-hidden border border-theme-border bg-black/40 aspect-square">
                {detail.kind === 'video' ? (
                  <video src={detail.url} controls className="w-full h-full object-contain" />
                ) : (
                  <img
                    src={detail.url} alt={detail.alt?.it || ''}
                    className="w-full h-full object-cover"
                    style={{ objectPosition: `${detail.focal_x * 100}% ${detail.focal_y * 100}%` }}
                  />
                )}
                {detail.kind === 'image' && (
                  <button
                    type="button"
                    aria-label="Imposta il punto focale"
                    className="absolute inset-0 cursor-crosshair"
                    onClick={(e) => {
                      const r = (e.target as HTMLElement).getBoundingClientRect()
                      setDetail({
                        ...detail,
                        focal_x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
                        focal_y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
                      })
                    }}
                  >
                    <span
                      className="absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full border-2 border-cyan-400 bg-cyan-400/30"
                      style={{ left: `${detail.focal_x * 100}%`, top: `${detail.focal_y * 100}%` }}
                    />
                  </button>
                )}
              </div>
              {detail.kind === 'image' && (
                <p className="text-[10px] text-theme-text-muted mt-1.5">
                  Clicca sull'immagine per dire qual e' il soggetto: nei ritagli resta sempre al centro.
                </p>
              )}
              <p className="text-[10px] text-theme-text-muted mt-2 break-all">{detail.url}</p>
            </div>
            <div className="space-y-1">
              <WbField label="Testo alternativo (italiano)" help="Cosa si vede nella foto. Serve a chi non la vede e a Google.">
                <WbInput value={detail.alt?.it || ''} onChange={(v) => setDetail({ ...detail, alt: { ...detail.alt, it: v } })} />
              </WbField>
              <WbField label="Testo alternativo (inglese)">
                <WbInput value={detail.alt?.en || ''} onChange={(v) => setDetail({ ...detail, alt: { ...detail.alt, en: v } })} />
              </WbField>
              <WbField label="Titolo">
                <WbInput value={detail.title || ''} onChange={(v) => setDetail({ ...detail, title: v })} />
              </WbField>
              <WbField label="Didascalia">
                <WbInput value={detail.caption?.it || ''} onChange={(v) => setDetail({ ...detail, caption: { ...detail.caption, it: v } })} />
              </WbField>
              <WbField label="Cartella" help="Serve solo a te per ritrovare i file.">
                <WbInput value={detail.folder} onChange={(v) => setDetail({ ...detail, folder: v })} />
              </WbField>
              <WbField label="Etichette" help="Separate da virgola.">
                <WbInput
                  value={(detail.tags || []).join(', ')}
                  onChange={(v) => setDetail({ ...detail, tags: v.split(',').map((s) => s.trim()).filter(Boolean) })}
                />
              </WbField>
              <div className="pt-2 text-[11px] text-theme-text-muted space-y-0.5">
                <p>Tipo: {detail.mime || '—'}</p>
                <p>Peso: {wbPeso(detail.size_bytes)}</p>
                {detail.width ? <p>Misure: {detail.width} × {detail.height} px</p> : null}
              </div>
            </div>
          </div>
        )}
      </WbModal>

      <input
        ref={replaceRef} type="file" hidden accept="image/*,video/*,application/pdf"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f || !detail) return
          const res = await wbReplaceMedia(site, detail, f)
          if (res.ok) { toast.success('File sostituito. Le pagine che lo usano cambiano alla prossima pubblicazione.'); setDetail(null); void carica() }
          else toast.error(res.error || 'Sostituzione non riuscita')
        }}
      />

      <WbConfirm
        open={!!daEliminare}
        title="Eliminare questo file?"
        message={
          `"${daEliminare?.filename}" sparisce dalla libreria. Se e' usato da una versione pubblicata in passato il file resta al suo posto, cosi' quella versione si puo' ancora ripristinare.`
        }
        confirmLabel="Elimina"
        onCancel={() => setDaEliminare(null)}
        onConfirm={async () => {
          if (!daEliminare) return
          const res = await wbDeleteMedia(site.id, daEliminare)
          if (res.ok) {
            toast.success(res.fileTenuto ? 'Tolto dalla libreria (il file resta per le versioni precedenti)' : 'File eliminato')
            setDaEliminare(null); setDetail(null); void carica()
          } else toast.error('Eliminazione non riuscita')
        }}
      />
    </div>
  )
}

// ─── Selettore ──────────────────────────────────────────────────────────────
export const WbMediaPicker: React.FC<{
  open: boolean
  site: WbSiteRow
  kind?: 'image' | 'video' | 'icon' | 'document'
  canWrite: boolean
  onClose: () => void
  onPick: (media: WbMediaRow) => void
}> = ({ open, site, kind, canWrite, onClose, onPick }) => (
  <WbModal open={open} onClose={onClose} title="Libreria media" subtitle="Scegli un file o caricane uno nuovo" size="xl">
    <WbMediaLibrary
      site={site}
      restrictKind={kind}
      canWrite={canWrite}
      onPick={(m) => { onPick(m); onClose() }}
    />
  </WbModal>
)

/** Anteprima compatta con i pulsanti Scegli / Rimuovi, per i campi. */
export const WbMediaSlot: React.FC<{
  url?: string
  kind?: 'image' | 'video'
  onOpen: () => void
  onClear: () => void
  poster?: string
}> = ({ url, kind = 'image', onOpen, onClear, poster }) => (
  <div className="flex items-center gap-2">
    <button
      type="button"
      onClick={onOpen}
      className="relative w-16 h-16 rounded-lg overflow-hidden border border-theme-border bg-theme-bg-tertiary shrink-0 hover:border-cyan-500/60 transition-colors"
      aria-label="Scegli un file"
    >
      {url ? (
        kind === 'video'
          ? <video src={url} poster={poster} muted playsInline preload="metadata" className="w-full h-full object-cover" />
          : <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className="w-full h-full flex items-center justify-center text-theme-text-muted">
          <WbIcon path={kind === 'video' ? WB_UI_ICONS.popup : WB_UI_ICONS.image} size={20} />
        </span>
      )}
    </button>
    <div className="flex flex-col gap-1">
      <WbButton size="sm" onClick={onOpen}>{url ? 'Sostituisci' : 'Scegli'}</WbButton>
      {url && <WbButton size="sm" tone="ghost" onClick={onClear}>Rimuovi</WbButton>}
    </div>
  </div>
)

/** Impostazioni di riproduzione di un video. */
export const WbVideoOptions: React.FC<{
  value: { autoplay?: boolean; loop?: boolean; muted?: boolean; controls?: boolean; preload?: string; poster?: string }
  onChange: (v: Record<string, unknown>) => void
  onPickPoster: () => void
}> = ({ value, onChange, onPickPoster }) => (
  <div className="space-y-1 pt-1">
    <WbField label="Parte da sola" inline help="Se acceso, il video parte muto: i browser bloccano l'audio automatico.">
      <input type="checkbox" checked={!!value.autoplay} onChange={(e) => onChange({ ...value, autoplay: e.target.checked })} />
    </WbField>
    <WbField label="Si ripete" inline>
      <input type="checkbox" checked={value.loop !== false} onChange={(e) => onChange({ ...value, loop: e.target.checked })} />
    </WbField>
    <WbField label="Senza audio" inline>
      <input type="checkbox" checked={value.muted !== false} onChange={(e) => onChange({ ...value, muted: e.target.checked })} />
    </WbField>
    <WbField label="Mostra i comandi" inline>
      <input type="checkbox" checked={!!value.controls} onChange={(e) => onChange({ ...value, controls: e.target.checked })} />
    </WbField>
    <WbField label="Immagine di copertina" help="Si vede prima che il video parta.">
      <div className="flex items-center gap-2">
        <WbButton size="sm" onClick={onPickPoster}>{value.poster ? 'Cambia' : 'Scegli'}</WbButton>
        {value.poster && <WbButton size="sm" tone="ghost" onClick={() => onChange({ ...value, poster: '' })}>Togli</WbButton>}
      </div>
    </WbField>
    <WbField label="Quanto precaricare" help="Meno precarico = pagina piu' veloce.">
      <WbSelect
        value={String(value.preload || 'metadata')}
        onChange={(v) => onChange({ ...value, preload: v })}
        options={[
          { value: 'none', label: 'Niente' },
          { value: 'metadata', label: 'Solo le informazioni' },
          { value: 'auto', label: 'Tutto' },
        ]}
      />
    </WbField>
  </div>
)

export const WbFocalSlider = WbSlider
