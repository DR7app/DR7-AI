/**
 * WbSettingsView.tsx — Impostazioni globali del sito.
 *
 * Nome, logo, favicon, contatti, social: si scrivono qui una volta e i
 * componenti collegati (footer, moduli, schede contatto) li riusano. Da
 * qui passa anche l'importazione del sito attuale e i due interruttori
 * che decidono se il builder disegna header e footer.
 */

import React from 'react'
import toast from 'react-hot-toast'
import { wbUpdateSite, type WbSiteRow, type WbMediaRow } from './wbApi'
import { wbImportSitoAttuale } from './wbImport'
import {
  WbCard, WbButton, WbIcon, WbIconButton, WbField, WbInput, WbToggle,
  WbConfirm, WbBadge, WB_UI_ICONS,
} from './WbUI'
import { WbMediaPicker, WbMediaSlot } from './WbMediaView'

interface Social { label: string; url: string; icon?: string }

export const WbSettingsView: React.FC<{
  site: WbSiteRow
  onReload: () => void
  can: (r: string) => boolean
}> = ({ site, onReload, can }) => {
  const canSettings = can('website.settings')
  const [s, setS] = React.useState<Record<string, unknown>>(() => ({ ...(site.settings || {}) }))
  const [nome, setNome] = React.useState(site.name)
  const [dominio, setDominio] = React.useState(site.domain || '')
  const [favicon, setFavicon] = React.useState(site.favicon_url || '')
  const [dirty, setDirty] = React.useState(false)
  const [mediaReq, setMediaReq] = React.useState<{ cb: (m: WbMediaRow) => void } | null>(null)
  const [importa, setImporta] = React.useState(false)
  const [importando, setImportando] = React.useState(false)
  const [esito, setEsito] = React.useState<{ create: string[]; saltate: string[] } | null>(null)

  const set = (k: string, v: unknown) => { setS({ ...s, [k]: v }); setDirty(true) }
  const social: Social[] = Array.isArray(s.social) ? (s.social as Social[]) : []

  const salva = async () => {
    const ok = await wbUpdateSite(site.id, {
      name: nome, domain: dominio || null, favicon_url: favicon || null, settings: s,
    })
    if (ok) { toast.success('Impostazioni salvate'); setDirty(false); onReload() }
    else toast.error('Salvataggio non riuscito')
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <WbCard
        title="Identita' del sito"
        actions={
          <WbButton size="sm" tone="primary" disabled={!canSettings || !dirty} onClick={() => void salva()}>
            <WbIcon path={WB_UI_ICONS.save} size={14} /> Salva
          </WbButton>
        }
      >
        <div className="space-y-0.5">
          <WbField label="Nome del sito">
            <WbInput value={nome} onChange={(v) => { setNome(v); setDirty(true) }} />
          </WbField>
          <WbField label="Dominio" help="Serve agli indirizzi canonici e all'anteprima social.">
            <WbInput value={dominio} onChange={(v) => { setDominio(v); setDirty(true) }} placeholder="dr7.app" />
          </WbField>
          <WbField label="Favicon" help="L'icona nella scheda del browser.">
            <WbMediaSlot
              url={favicon}
              onOpen={() => setMediaReq({ cb: (m) => { setFavicon(m.url); setDirty(true) } })}
              onClear={() => { setFavicon(''); setDirty(true) }}
            />
          </WbField>
          <WbField label="Logo">
            <WbMediaSlot
              url={String(s.logo || '')}
              onOpen={() => setMediaReq({ cb: (m) => set('logo', m.url) })}
              onClear={() => set('logo', '')}
            />
          </WbField>
          <WbField label="Lingua principale">
            <WbInput value={site.default_locale} onChange={() => undefined} disabled />
          </WbField>
        </div>
      </WbCard>

      <WbCard title="Contatti e dati aziendali" subtitle="Riusati dal footer, dai moduli e dalle sezioni contatto.">
        <div className="space-y-0.5">
          <WbField label="Email">
            <WbInput value={String(s.email || '')} onChange={(v) => set('email', v)} />
          </WbField>
          <WbField label="Telefono">
            <WbInput value={String(s.phone || '')} onChange={(v) => set('phone', v)} />
          </WbField>
          <WbField label="WhatsApp">
            <WbInput value={String(s.whatsapp || '')} onChange={(v) => set('whatsapp', v)} />
          </WbField>
          <WbField label="Indirizzo operativo">
            <WbInput value={String(s.address || '')} onChange={(v) => set('address', v)} />
          </WbField>
          <WbField label="Sede legale">
            <WbInput value={String(s.legal_address || '')} onChange={(v) => set('legal_address', v)} />
          </WbField>
          <WbField label="Partita IVA">
            <WbInput value={String(s.piva || '')} onChange={(v) => set('piva', v)} />
          </WbField>
          <WbField label="Riga di copyright">
            <WbInput value={String(s.copyright || '')} onChange={(v) => set('copyright', v)} />
          </WbField>
          <WbField label="Social">
            <div className="space-y-1">
              {social.map((so, i) => (
                <div key={i} className="flex gap-1">
                  <WbInput value={so.label} onChange={(v) => set('social', social.map((x, j) => (j === i ? { ...x, label: v } : x)))} />
                  <WbInput value={so.url} onChange={(v) => set('social', social.map((x, j) => (j === i ? { ...x, url: v } : x)))} />
                  <WbIconButton path={WB_UI_ICONS.trash} label="Togli" tone="danger"
                    onClick={() => set('social', social.filter((_, j) => j !== i))} />
                </div>
              ))}
              <WbButton size="sm" onClick={() => set('social', [...social, { label: 'Instagram', url: '' }])}>
                <WbIcon path={WB_UI_ICONS.plus} size={13} /> Aggiungi social
              </WbButton>
            </div>
          </WbField>
        </div>
      </WbCard>

      <WbCard
        title="Cosa disegna il builder"
        subtitle="Spenti, il sito continua a usare l'header e il footer scritti nel codice. Sono l'interruttore di sicurezza."
      >
        <div className="space-y-1">
          <WbField
            label="Usa l'header del Website Builder"
            inline
            help="Da accendere solo dopo aver controllato il menu in anteprima."
          >
            <WbToggle checked={!!s.use_builder_header} onChange={(v) => set('use_builder_header', v)} />
          </WbField>
          <WbField label="Usa il footer del Website Builder" inline>
            <WbToggle checked={!!s.use_builder_footer} onChange={(v) => set('use_builder_footer', v)} />
          </WbField>
          <p className="text-[11px] text-theme-text-muted pt-2 leading-relaxed">
            Le singole pagine hanno il loro interruttore separato ("prende il posto della pagina attuale"),
            in Pagine &gt; Impostazioni. Nessuna rotta del sito viene sostituita senza che qualcuno lo decida.
          </p>
        </div>
      </WbCard>

      <WbCard title="Importa il sito attuale" subtitle="Il passo con cui si comincia.">
        <p className="text-[12px] text-theme-text-secondary leading-relaxed">
          Legge i contenuti gia' amministrati in <strong>Sito</strong> e li trasforma in pagine del builder:
          la home con il suo scorrimento di video e la griglia delle categorie, Chi Siamo, le domande
          frequenti e i contatti. Prepara anche il menu e il footer.
        </p>
        <ul className="mt-3 space-y-1 text-[11px] text-theme-text-muted">
          <li>· Tutte le pagine nascono come <strong>bozza</strong>.</li>
          <li>· L'interruttore "prende il posto della pagina attuale" resta <strong>spento</strong>.</li>
          <li>· Il sito pubblico non cambia di una virgola finche' non lo decidi tu.</li>
          <li>· Le pagine gia' presenti nel builder non vengono toccate.</li>
        </ul>
        <div className="mt-4">
          <WbButton tone="primary" disabled={!canSettings || importando} onClick={() => setImporta(true)}>
            <WbIcon path={WB_UI_ICONS.refresh} size={14} /> {importando ? 'Importo…' : 'Importa il sito attuale'}
          </WbButton>
        </div>
        {esito && (
          <div className="mt-3 space-y-1">
            {esito.create.length > 0 && (
              <p className="text-[11px] text-emerald-400">Create: {esito.create.join(', ')}</p>
            )}
            {esito.saltate.length > 0 && (
              <p className="text-[11px] text-theme-text-muted">Saltate: {esito.saltate.join(' · ')}</p>
            )}
          </div>
        )}
      </WbCard>

      <WbCard title="Multi-azienda" subtitle="Come sono separati i dati.">
        <div className="space-y-1.5 text-[12px] text-theme-text-secondary">
          <p className="flex items-center gap-2">
            <WbBadge tone="info">tenant</WbBadge> <code>{site.tenant_id}</code>
            <WbBadge tone="info">sito</WbBadge> <code>{site.key}</code>
          </p>
          <p className="text-[11px] text-theme-text-muted leading-relaxed">
            Pagine, media, temi, menu, popup e versioni sono legati a questo sito. I file caricati finiscono
            sotto <code>{site.tenant_id}/{site.key}/</code> nello storage. Un'altra azienda sulla stessa
            piattaforma non vede nulla di tutto questo, nemmeno i nomi dei file.
          </p>
        </div>
      </WbCard>

      <WbConfirm
        open={importa}
        title="Importare il sito attuale?"
        message="Vengono create le pagine mancanti come bozze, e preparati menu e footer. Il sito pubblico non cambia: le pagine restano spente finche' non le attivi tu."
        confirmLabel="Importa"
        tone="primary"
        onCancel={() => setImporta(false)}
        onConfirm={async () => {
          setImporta(false)
          setImportando(true)
          const res = await wbImportSitoAttuale(site)
          setImportando(false)
          if (res.ok) {
            setEsito({ create: res.create, saltate: res.saltate })
            toast.success(res.create.length
              ? `Importate ${res.create.length} pagine, tutte in bozza.`
              : 'Niente di nuovo da importare.')
            onReload()
          } else {
            toast.error(res.errore || 'Importazione non riuscita')
          }
        }}
      />

      {mediaReq && (
        <WbMediaPicker
          open site={site} kind="image" canWrite={can('website.media')}
          onClose={() => setMediaReq(null)}
          onPick={(m) => { mediaReq.cb(m); setMediaReq(null) }}
        />
      )}
    </div>
  )
}

export default WbSettingsView
