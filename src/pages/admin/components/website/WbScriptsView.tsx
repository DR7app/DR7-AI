/**
 * WbScriptsView.tsx — integrazioni di terze parti.
 *
 * Analytics, pixel, tag manager, chat. Ogni integrazione dichiara a quale
 * CATEGORIA DI CONSENSO appartiene: il sito la carica solo se il
 * visitatore ha accettato quella categoria nel banner cookie gia'
 * esistente. Nessuna scorciatoia — il consenso attuale resta l'autorita'.
 *
 * Solo chi ha il diritto website.code entra qui: e' l'unico punto del
 * builder in cui si puo' scrivere JavaScript.
 */

import React from 'react'
import toast from 'react-hot-toast'
import type { WbScript } from './shared/wbSchema'
import { wbListScripts, wbSaveScript, wbDeleteScript, type WbSiteRow } from './wbApi'
import {
  WbCard, WbButton, WbIconButton, WbIcon, WbModal, WbConfirm, WbBadge,
  WbField, WbInput, WbTextarea, WbSelect, WbToggle, WbEmptyState, WB_UI_ICONS,
} from './WbUI'

type Riga = WbScript & { enabled: boolean }

const MODELLI: { label: string; provider: string; placement: WbScript['placement']; consent: WbScript['consent_category']; code: string }[] = [
  {
    label: 'Google Analytics 4', provider: 'google-analytics', placement: 'head', consent: 'analytics',
    code: '<!-- Sostituisci G-XXXXXXX con il tuo identificativo -->\n<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag(\'js\',new Date());gtag(\'config\',\'G-XXXXXXX\')</script>',
  },
  {
    label: 'Google Tag Manager', provider: 'gtm', placement: 'head', consent: 'analytics',
    code: '<!-- Sostituisci GTM-XXXXXX -->\n<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({\'gtm.start\':new Date().getTime(),event:\'gtm.js\'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src=\'https://www.googletagmanager.com/gtm.js?id=\'+i;f.parentNode.insertBefore(j,f)})(window,document,\'script\',\'dataLayer\',\'GTM-XXXXXX\')</script>',
  },
  {
    label: 'Meta Pixel', provider: 'meta', placement: 'head', consent: 'marketing',
    code: '<!-- Sostituisci 000000000000000 con l\'ID del pixel -->\n<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version=\'2.0\';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,\'script\',\'https://connect.facebook.net/en_US/fbevents.js\');fbq(\'init\',\'000000000000000\');fbq(\'track\',\'PageView\')</script>',
  },
  {
    label: 'Verifica proprieta\' del sito', provider: 'verification', placement: 'head', consent: 'necessary',
    code: '<meta name="google-site-verification" content="CODICE" />',
  },
]

export const WbScriptsView: React.FC<{ site: WbSiteRow; can: (r: string) => boolean }> = ({ site, can }) => {
  const canCode = can('website.code')
  const [lista, setLista] = React.useState<Riga[]>([])
  const [loading, setLoading] = React.useState(true)
  const [modifica, setModifica] = React.useState<Partial<Riga> | null>(null)
  const [daEliminare, setDaEliminare] = React.useState<Riga | null>(null)

  const carica = React.useCallback(async () => {
    setLoading(true)
    setLista(await wbListScripts(site.id))
    setLoading(false)
  }, [site.id])

  React.useEffect(() => { void carica() }, [carica])

  if (!canCode) {
    return (
      <WbCard title="Script e integrazioni">
        <WbEmptyState
          title="Serve il diritto avanzato"
          text="Questa sezione permette di inserire codice di terze parti nel sito. Chiedi alla direzione il diritto website.code."
        />
      </WbCard>
    )
  }

  const salva = async () => {
    if (!modifica) return
    try {
      await wbSaveScript(site.id, modifica as never)
      toast.success('Salvato. Va online alla prossima pubblicazione.')
      setModifica(null)
      void carica()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Salvataggio non riuscito')
    }
  }

  return (
    <div className="space-y-4">
      <WbCard
        title="Script e integrazioni"
        subtitle="Ogni integrazione parte solo se il visitatore ha accettato la sua categoria di cookie."
        actions={
          <WbButton size="sm" tone="primary" onClick={() => setModifica({ name: '', placement: 'body_end', consent_category: 'marketing', code: '', enabled: false })}>
            <WbIcon path={WB_UI_ICONS.plus} size={14} /> Nuova integrazione
          </WbButton>
        }
      >
        {loading ? (
          <p className="text-[12px] text-theme-text-muted">Carico…</p>
        ) : lista.length === 0 ? (
          <WbEmptyState title="Nessuna integrazione" text="Aggiungi Analytics, un pixel o un tag di verifica." />
        ) : (
          <div className="space-y-2">
            {lista.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border border-theme-border bg-theme-bg-tertiary/40 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-theme-text-primary truncate">{s.name}</span>
                    <WbBadge tone={s.enabled ? 'success' : 'neutral'}>{s.enabled ? 'attiva' : 'spenta'}</WbBadge>
                    <WbBadge tone={s.consent_category === 'necessary' ? 'info' : 'warning'}>
                      consenso: {s.consent_category === 'necessary' ? 'non richiesto' : s.consent_category === 'analytics' ? 'statistiche' : 'marketing'}
                    </WbBadge>
                  </div>
                  <p className="text-[10px] text-theme-text-muted">
                    {s.placement === 'head' ? 'nella testata' : s.placement === 'body_start' ? 'a inizio pagina' : 'a fine pagina'}
                  </p>
                </div>
                <WbToggle checked={s.enabled} onChange={async (v) => {
                  await wbSaveScript(site.id, { ...s, enabled: v })
                  void carica()
                }} />
                <WbIconButton path={WB_UI_ICONS.settings} label="Modifica" onClick={() => setModifica({ ...s })} />
                <WbIconButton path={WB_UI_ICONS.trash} label="Elimina" tone="danger" onClick={() => setDaEliminare(s)} />
              </div>
            ))}
          </div>
        )}
      </WbCard>

      <WbModal
        open={!!modifica}
        onClose={() => setModifica(null)}
        title={modifica?.id ? 'Modifica integrazione' : 'Nuova integrazione'}
        size="lg"
        footer={<><WbButton onClick={() => setModifica(null)}>Annulla</WbButton><WbButton tone="primary" onClick={() => void salva()}>Salva</WbButton></>}
      >
        {modifica && (
          <div className="space-y-1">
            {!modifica.id && (
              <WbField label="Parti da un modello">
                <div className="flex flex-wrap gap-1.5">
                  {MODELLI.map((m) => (
                    <WbButton key={m.label} size="sm" onClick={() => setModifica({
                      ...modifica, name: m.label, provider: m.provider,
                      placement: m.placement, consent_category: m.consent, code: m.code,
                    })}>{m.label}</WbButton>
                  ))}
                </div>
              </WbField>
            )}
            <WbField label="Nome">
              <WbInput value={modifica.name || ''} onChange={(v) => setModifica({ ...modifica, name: v })} />
            </WbField>
            <WbField label="Dove va inserito">
              <WbSelect
                value={modifica.placement || 'body_end'}
                onChange={(v) => setModifica({ ...modifica, placement: v as WbScript['placement'] })}
                options={[
                  { value: 'head', label: 'Nella testata (prima di tutto)' },
                  { value: 'body_start', label: 'A inizio pagina' },
                  { value: 'body_end', label: 'A fine pagina (piu\' veloce)' },
                ]}
              />
            </WbField>
            <WbField
              label="Categoria di consenso"
              help="Determina se lo script parte prima o dopo l'accettazione dei cookie. Scegliere 'non richiesto' per uno script di marketing viola il consenso."
            >
              <WbSelect
                value={modifica.consent_category || 'marketing'}
                onChange={(v) => setModifica({ ...modifica, consent_category: v as WbScript['consent_category'] })}
                options={[
                  { value: 'necessary', label: 'Non richiede consenso (solo tecnici)' },
                  { value: 'analytics', label: 'Statistiche' },
                  { value: 'marketing', label: 'Marketing' },
                ]}
              />
            </WbField>
            <WbField label="Codice">
              <WbTextarea mono rows={12} value={modifica.code || ''} onChange={(v) => setModifica({ ...modifica, code: v })} />
            </WbField>
            <WbField label="Attiva" inline help="Puoi salvarla spenta e accenderla quando sei pronto.">
              <WbToggle checked={!!modifica.enabled} onChange={(v) => setModifica({ ...modifica, enabled: v })} />
            </WbField>
          </div>
        )}
      </WbModal>

      <WbConfirm
        open={!!daEliminare}
        title="Eliminare questa integrazione?"
        message={`"${daEliminare?.name}" smette di essere caricata dal sito alla prossima pubblicazione.`}
        confirmLabel="Elimina"
        onCancel={() => setDaEliminare(null)}
        onConfirm={async () => {
          if (!daEliminare) return
          const ok = await wbDeleteScript(site.id, daEliminare.id, daEliminare.name)
          if (ok) { toast.success('Eliminata'); setDaEliminare(null); void carica() }
          else toast.error('Eliminazione non riuscita')
        }}
      />
    </div>
  )
}

export default WbScriptsView
