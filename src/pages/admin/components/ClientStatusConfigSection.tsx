// Centralina Pro > Status Clienti — personalizzazione completa.
//
// Prima qui c'era solo un avviso "applica la migration": la sezione leggeva la
// tabella `client_status_config`, mai creata sul DB (verifica direzione 29/07:
// nessun modo di cambiare nomi, colori o avvertenze). Ora la configurazione sta
// in centralina_pro_config (vedi utils/clientStatusConfig.ts), quindi funziona
// senza migration, e nome/colore/avvertenza sono usati davvero dai badge in
// tutto l'admin (ClientStatusBadge legge la stessa config).
//
// Le CHIAVI restano fisse: le usano filtri campagne, report e logica interna.
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useClientStatus } from '../../../contexts/ClientStatusContext'
import {
  AVVISO_LIVELLI,
  CLIENT_STATUS_COLORS,
  DEFAULT_CLIENT_STATUS,
  avvisoClasses,
  clientStatusColor,
  loadClientStatusConfig,
  normalizeClientStatus,
  saveClientStatusConfig,
  type AvvisoLivello,
  type ClientStatusDef,
} from '../../../utils/clientStatusConfig'

const INPUT_CLS = 'w-full min-w-0 px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary'

export default function ClientStatusConfigSection() {
  const { refreshStatusConfig } = useClientStatus()
  const [rows, setRows] = useState<ClientStatusDef[]>([])
  const [saved, setSaved] = useState<ClientStatusDef[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    loadClientStatusConfig().then(defs => {
      if (!alive) return
      setRows(defs)
      setSaved(defs)
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  const dirty = useMemo(() => JSON.stringify(rows) !== JSON.stringify(saved), [rows, saved])

  const setField = (key: string, patch: Partial<ClientStatusDef>) =>
    setRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r))

  async function save() {
    const vuoto = rows.find(r => !r.label.trim())
    if (vuoto) { toast.error('Ogni status deve avere un nome'); return }
    setSaving(true)
    try {
      const normalized = normalizeClientStatus(rows)
      await saveClientStatusConfig(normalized)
      setRows(normalized)
      setSaved(normalized)
      // I badge in giro per l'admin leggono dal contesto: ricaricalo subito.
      await refreshStatusConfig()
      toast.success('Status clienti salvati')
    } catch (e) {
      toast.error('Errore: ' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function resetDefaults() {
    if (!window.confirm('Ripristinare nomi, colori e avvertenze di fabbrica? Dovrai comunque salvare.')) return
    setRows(normalizeClientStatus(DEFAULT_CLIENT_STATUS))
  }

  if (loading) {
    return (
      <div className="bg-theme-bg-secondary rounded-2xl border border-theme-border p-5">
        <p className="text-theme-text-muted py-6 text-center text-sm">Caricamento…</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-theme-bg-secondary rounded-2xl border border-theme-border p-5">
        <div className="text-[15px] font-semibold text-theme-text-primary">Status clienti</div>
        <p className="text-[13px] text-theme-text-muted mt-0.5">
          Nome, descrizione, colore e avvertenza di ogni status. Le modifiche valgono ovunque nell&apos;admin:
          badge nelle liste, scheda cliente, ricerca cliente. Gli status disponibili restano questi quattro
          perché li usano i filtri delle campagne e i report.
        </p>
      </div>

      {rows.map(r => {
        const colore = clientStatusColor(r.colore)
        const isDefault = DEFAULT_CLIENT_STATUS.find(d => d.key === r.key)
        return (
          <div key={r.key} className="bg-theme-bg-secondary rounded-2xl border border-theme-border p-5 space-y-4">
            {/* Anteprima dal vivo: esattamente il badge che vedra' lo staff. */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`inline-flex items-center rounded font-bold border px-2 py-0.5 text-xs ${colore.badge}`}>
                  {r.label || 'Senza nome'}
                </span>
                {!r.badge_visibile && (
                  <span className="text-[11px] text-theme-text-muted">badge nascosto nelle liste</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-mono uppercase text-theme-text-muted">{r.key}</span>
                {isDefault && r.label !== isDefault.label && (
                  <span className="text-[11px] text-theme-text-muted">(di fabbrica: {isDefault.label})</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-theme-text-muted">Nome mostrato</label>
                <input
                  value={r.label}
                  onChange={e => setField(r.key, { label: e.target.value })}
                  placeholder="Nome status"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted">Descrizione (scheda cliente)</label>
                <input
                  value={r.descrizione}
                  onChange={e => setField(r.key, { descrizione: e.target.value })}
                  placeholder="A cosa corrisponde questo status"
                  className={INPUT_CLS}
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-theme-text-muted">Colore</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {CLIENT_STATUS_COLORS.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setField(r.key, { colore: c.id })}
                    title={c.label}
                    aria-label={`Colore ${c.label}`}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
                      r.colore === c.id
                        ? 'border-[#007aff] bg-[#007aff]/10 text-theme-text-primary'
                        : 'border-theme-border bg-theme-bg-tertiary/40 text-theme-text-muted hover:bg-theme-bg-hover'
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-theme-text-muted">
                Avvertenza per lo staff <span className="text-theme-text-muted/70">(vuota = nessun avviso)</span>
              </label>
              <textarea
                value={r.avviso}
                onChange={e => setField(r.key, { avviso: e.target.value })}
                rows={2}
                placeholder="Es. Cliente in blacklist: non procedere senza autorizzazione della direzione."
                className={`${INPUT_CLS} resize-y`}
              />
              {r.avviso.trim() && (
                <>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {AVVISO_LIVELLI.map(l => (
                      <button
                        key={l.id}
                        onClick={() => setField(r.key, { avviso_livello: l.id as AvvisoLivello })}
                        className={`px-2.5 py-1 rounded-lg border text-xs transition-colors ${
                          r.avviso_livello === l.id
                            ? 'border-[#007aff] bg-[#007aff]/10 text-theme-text-primary'
                            : 'border-theme-border bg-theme-bg-tertiary/40 text-theme-text-muted hover:bg-theme-bg-hover'
                        }`}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                  <div className={`mt-2 rounded-lg border px-3 py-2 text-[12px] ${avvisoClasses(r.avviso_livello)}`}>
                    {r.avviso}
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-1 border-t border-theme-border/60">
              <div className="min-w-0">
                <p className="text-sm text-theme-text-primary">Mostra il badge nelle liste</p>
                <p className="text-[11px] text-theme-text-muted">Spento: lo status resta assegnabile ma non compare accanto al nome del cliente.</p>
              </div>
              <button
                role="switch"
                aria-checked={r.badge_visibile}
                onClick={() => setField(r.key, { badge_visibile: !r.badge_visibile })}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${r.badge_visibile ? 'bg-emerald-500' : 'bg-theme-bg-tertiary border border-theme-border'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${r.badge_visibile ? 'translate-x-[18px]' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>
        )
      })}

      <div className="flex items-center justify-between gap-3">
        <button
          onClick={resetDefaults}
          className="px-4 py-2 rounded-lg border border-theme-border text-theme-text-secondary text-sm hover:bg-theme-bg-hover"
        >
          Ripristina predefiniti
        </button>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-[12px] text-amber-500">Modifiche non salvate</span>}
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="px-4 py-2 rounded-lg bg-[#007aff] hover:bg-[#0071eb] text-white text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Salvataggio…' : 'Salva status'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Helper storico: mappa color id -> classi badge. Restava usato dalla scheda
// cliente; ora delega alla tavolozza condivisa.
export function statusColorClasses(color: string): { text: string; bg: string } {
  const c = clientStatusColor(color)
  return { text: c.text, bg: c.banner }
}
