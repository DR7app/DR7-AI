/**
 * WbVersionsView.tsx — storico delle pubblicazioni e ripristino.
 *
 * Ogni pubblicazione lascia un'istantanea COMPLETA del sito. Ripristinare
 * non "annulla" nulla: crea una nuova versione con il contenuto di quella
 * scelta, quindi lo storico non si riscrive mai e si puo' tornare avanti.
 *
 * Le bozze non vengono toccate dal ripristino: chi stava lavorando su una
 * pagina non perde il suo lavoro.
 */

import React from 'react'
import toast from 'react-hot-toast'
import type { WbSnapshot, WbTheme } from './shared/wbSchema'
import {
  wbListVersions, wbGetVersionSnapshot, wbRestore, wbListAudit,
  type WbSiteRow, type WbVersionRow, type WbAuditRow,
} from './wbApi'
import {
  WbCard, WbButton, WbIcon, WbModal, WbConfirm, WbBadge, WbSelect,
  WbEmptyState, WB_UI_ICONS, wbDataOra, wbDaAllora,
} from './WbUI'
import { WbPreview, WbDeviceSwitch } from './WbPreview'
import type { WbDevice } from './shared/wbSchema'

const AZIONE_LABEL: Record<string, string> = {
  publish: 'Pubblicazione',
  restore: 'Ripristino',
  'page.create': 'Pagina creata',
  'page.delete': 'Pagina eliminata',
  'page.set_home': 'Home cambiata',
  'theme.create': 'Tema creato',
  'theme.activate': 'Tema attivato',
  'theme.delete': 'Tema eliminato',
  'media.delete': 'Media eliminato',
  'media.replace': 'Media sostituito',
  'overlay.create': 'Popup/banner creato',
  'overlay.update': 'Popup/banner modificato',
  'overlay.delete': 'Popup/banner eliminato',
  'script.create': 'Integrazione aggiunta',
  'script.update': 'Integrazione modificata',
  'script.delete': 'Integrazione rimossa',
  'template.create': 'Modello salvato',
  'template.delete': 'Modello eliminato',
  'settings.update': 'Impostazioni cambiate',
  'import.site': 'Sito attuale importato',
}

export const WbVersionsView: React.FC<{
  site: WbSiteRow
  onReload: () => void
  can: (r: string) => boolean
}> = ({ site, onReload, can }) => {
  const canPublish = can('website.publish')
  const [versioni, setVersioni] = React.useState<WbVersionRow[]>([])
  const [audit, setAudit] = React.useState<WbAuditRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [anteprima, setAnteprima] = React.useState<{ v: WbVersionRow; snap: WbSnapshot } | null>(null)
  const [pagina, setPagina] = React.useState<string>('')
  const [device, setDevice] = React.useState<WbDevice>('desktop')
  const [daRipristinare, setDaRipristinare] = React.useState<WbVersionRow | null>(null)

  const carica = React.useCallback(async () => {
    setLoading(true)
    const [v, a] = await Promise.all([wbListVersions(site.id), wbListAudit(site.id)])
    setVersioni(v)
    setAudit(a)
    setLoading(false)
  }, [site.id])

  React.useEffect(() => { void carica() }, [carica])

  const apri = async (v: WbVersionRow) => {
    const snap = await wbGetVersionSnapshot(v.id)
    if (!snap) { toast.error('Non riesco a leggere questa versione'); return }
    setAnteprima({ v, snap })
    setPagina(snap.pages?.[0]?.slug || '')
  }

  const pageSnap = anteprima?.snap.pages?.find((p) => p.slug === pagina) || anteprima?.snap.pages?.[0]
  const temaSnap: WbTheme | null = anteprima?.snap.theme || null

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
      <WbCard
        title="Versioni pubblicate"
        subtitle="Ogni riga e' il sito com'era in quel momento. La prima e' quella online adesso."
        actions={<WbButton size="sm" onClick={() => void carica()}><WbIcon path={WB_UI_ICONS.refresh} size={14} /> Aggiorna</WbButton>}
      >
        {loading ? (
          <p className="text-[12px] text-theme-text-muted">Carico…</p>
        ) : versioni.length === 0 ? (
          <WbEmptyState title="Nessuna pubblicazione" text="La prima versione nasce quando pubblichi per la prima volta." />
        ) : (
          <div className="overflow-x-auto -mx-4 -mb-4">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-theme-text-muted border-b border-theme-border">
                  <th className="px-4 py-2 font-medium">Versione</th>
                  <th className="px-3 py-2 font-medium">Quando</th>
                  <th className="px-3 py-2 font-medium">Chi</th>
                  <th className="px-3 py-2 font-medium">Cosa conteneva</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {versioni.map((v, i) => (
                  <tr key={v.id} className="border-b border-theme-border/60 hover:bg-theme-bg-hover/40">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-theme-text-primary font-medium">v{v.number}</span>
                        {v.id === site.published_version_id && <WbBadge tone="success">online</WbBadge>}
                        {v.restored_from && <WbBadge tone="info">ripristino</WbBadge>}
                        {i === 0 && v.id !== site.published_version_id && <WbBadge tone="warning">non attiva</WbBadge>}
                      </div>
                      {v.label && <p className="text-[10px] text-theme-text-muted mt-0.5">{v.label}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-theme-text-muted">
                      {wbDataOra(v.created_at)}
                      <div className="text-[10px]">{wbDaAllora(v.created_at)}</div>
                    </td>
                    <td className="px-3 py-2.5 text-theme-text-muted">{v.author || '—'}</td>
                    <td className="px-3 py-2.5 text-theme-text-muted">
                      {String(v.summary?.pagine ?? 0)} pagine
                      {v.summary?.overlay ? ` · ${v.summary.overlay} popup/banner` : ''}
                      {v.summary?.script ? ` · ${v.summary.script} integrazioni` : ''}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <WbButton size="sm" onClick={() => void apri(v)}>Guarda</WbButton>
                        <WbButton
                          size="sm"
                          tone="primary"
                          disabled={!canPublish || v.id === site.published_version_id}
                          onClick={() => setDaRipristinare(v)}
                        >Ripristina</WbButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </WbCard>

      <WbCard title="Registro operazioni" subtitle="Chi ha fatto cosa, e quando.">
        <div className="space-y-1.5 max-h-[64vh] overflow-y-auto">
          {audit.length === 0 && <p className="text-[12px] text-theme-text-muted">Nessuna operazione registrata.</p>}
          {audit.map((a) => (
            <div key={a.id} className="rounded-lg border border-theme-border bg-theme-bg-tertiary/40 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-theme-text-primary">{AZIONE_LABEL[a.action] || a.action}</span>
                <span className="text-[10px] text-theme-text-muted">{wbDaAllora(a.created_at)}</span>
              </div>
              {a.object_label && <p className="text-[11px] text-theme-text-secondary truncate">{a.object_label}</p>}
              <p className="text-[10px] text-theme-text-muted">{a.author || '—'}</p>
            </div>
          ))}
        </div>
      </WbCard>

      <WbModal
        open={!!anteprima}
        onClose={() => setAnteprima(null)}
        title={anteprima ? `Versione ${anteprima.v.number} — ${wbDataOra(anteprima.v.created_at)}` : ''}
        subtitle="Il sito com'era in quel momento."
        size="xl"
        footer={
          anteprima && (
            <>
              <WbButton onClick={() => setAnteprima(null)}>Chiudi</WbButton>
              <WbButton
                tone="primary"
                disabled={!canPublish || anteprima.v.id === site.published_version_id}
                onClick={() => { setDaRipristinare(anteprima.v); setAnteprima(null) }}
              >Riporta online questa versione</WbButton>
            </>
          )
        }
      >
        {anteprima && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <WbSelect
                value={pagina}
                onChange={setPagina}
                options={(anteprima.snap.pages || []).map((p) => ({ value: p.slug, label: `${p.title} — ${p.slug}` }))}
              />
              <WbDeviceSwitch device={device} onChange={setDevice} />
            </div>
            <div className="h-[58vh] border border-theme-border rounded-lg overflow-hidden">
              {pageSnap ? (
                <WbPreview blocks={pageSnap.content?.sections || []} theme={temaSnap} device={device} lang="it" />
              ) : (
                <p className="p-4 text-[12px] text-theme-text-muted">Questa versione non conteneva pagine.</p>
              )}
            </div>
          </div>
        )}
      </WbModal>

      <WbConfirm
        open={!!daRipristinare}
        title="Riportare online questa versione?"
        message={
          `Il sito torna a mostrare la versione ${daRipristinare?.number} del ${wbDataOra(daRipristinare?.created_at)}. `
          + 'Viene creata una nuova versione, quindi anche questo passo si puo\' annullare. Le bozze su cui stai lavorando non vengono toccate.'
        }
        confirmLabel="Ripristina"
        tone="primary"
        onCancel={() => setDaRipristinare(null)}
        onConfirm={async () => {
          if (!daRipristinare) return
          const res = await wbRestore(daRipristinare.id)
          if (res.ok) {
            toast.success(`Versione ${daRipristinare.number} riportata online (nuova versione ${res.number}).`)
            setDaRipristinare(null)
            void carica()
            onReload()
          } else {
            toast.error(res.error || 'Ripristino non riuscito. Il sito non e cambiato.')
          }
        }}
      />
    </div>
  )
}

export default WbVersionsView
