import { useEffect, useState } from 'react'
import { ScheletroTesto } from '../../../components/Scheletro'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'

/**
 * Gestione Multe — Centralina Pro (24/08/2026).
 *
 * La lettera "Comunicazione dati conducente" aveva tutto scritto in duro:
 * destinatario fisso "Polizia Municipale di Cagliari" (sbagliato per qualunque
 * verbale di un altro comune, e assurdo per una multa estera), indirizzo DR7,
 * telefono, PEC e rappresentante legale. Da qui si cambiano una volta per
 * tutte; sulla singola multa restano sovrascrivibili al caricamento del
 * verbale.
 *
 * Salva in `centralina_pro_config.config.multe_config` (riga 'main').
 */

export interface MulteConfigValues {
  ragione_sociale: string
  piva: string
  rappresentante_legale: string
  indirizzo: string
  telefono: string
  pec_mittente: string
  destinatario_default: string
}

export const MULTE_CONFIG_KEY = 'multe_config'

export const MULTE_CONFIG_DEFAULTS: MulteConfigValues = {
  ragione_sociale: 'DR7 S.p.A.',
  piva: '04104640927',
  rappresentante_legale: 'Campagnola Ilenia',
  indirizzo: 'Viale Marconi 229, Cagliari (CA)',
  telefono: '3472817258',
  // Nessuna PEC di fabbrica: la casella si imposta in Centralina Pro >
  // Gestione PEC & Email. Un indirizzo di un provider preciso scritto qui
  // finiva salvato in configurazione al primo Salva e prendeva il posto di
  // quello dell'azienda.
  pec_mittente: '',
  destinatario_default: '',
}

/** Lettura condivisa: la usa anche la tab Multe per precompilare l'override. */
/**
 * Config multe del business richiesto. Ogni business ha la sua riga
 * (`main` = Terra, `business_mare`, ...): la PEC e i dati azienda del Mare
 * possono essere diversi da quelli di Terra. Finche' un business non salva
 * niente eredita la riga `main`, cosi' chi non configura non resta scoperto.
 */
export async function loadMulteConfig(rowId: string = 'main'): Promise<MulteConfigValues> {
  try {
    const ids = rowId === 'main' ? ['main'] : [rowId, 'main']
    const { data } = await supabase.from('centralina_pro_config').select('id, config').in('id', ids)
    const righe = (data || []) as { id: string; config: Record<string, unknown> }[]
    const leggi = (id: string) =>
      (righe.find(r => r.id === id)?.config || {})[MULTE_CONFIG_KEY] as Partial<MulteConfigValues> | undefined
    const cfg = leggi(rowId) || (rowId === 'main' ? undefined : leggi('main'))
    return { ...MULTE_CONFIG_DEFAULTS, ...(cfg || {}) }
  } catch {
    return MULTE_CONFIG_DEFAULTS
  }
}

const CAMPI: Array<{ k: keyof MulteConfigValues; label: string; hint?: string; wide?: boolean }> = [
  { k: 'ragione_sociale', label: 'Ragione sociale' },
  { k: 'piva', label: 'P.IVA' },
  { k: 'rappresentante_legale', label: 'Rappresentante legale' },
  { k: 'telefono', label: 'Telefono' },
  { k: 'indirizzo', label: 'Indirizzo (sede)', hint: 'Compare in fondo alla lettera. Sovrascrivibile sulla singola multa.', wide: true },
  { k: 'pec_mittente', label: 'PEC mittente', hint: 'Casella da cui parte davvero la PEC (e recapito stampato nella lettera). Cambiandola serve la password della nuova casella: si imposta in Centralina Pro > Gestione PEC & Email.', wide: true },
  { k: 'destinatario_default', label: 'Destinatario di riserva', hint: 'Usato come proposta quando dal verbale non si ricava l\'ente. Puo\' essere una email normale: le multe estere non hanno PEC.', wide: true },
]

export default function MulteConfigSection({ readOnly = false, rowId = 'main' }: { readOnly?: boolean; rowId?: string }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [v, setV] = useState<MulteConfigValues>(MULTE_CONFIG_DEFAULTS)

  useEffect(() => {
    setLoading(true)
    void (async () => {
      setV(await loadMulteConfig(rowId))
      setLoading(false)
    })()
  }, [rowId])

  async function save() {
    if (!v.ragione_sociale.trim()) { toast.error('La ragione sociale non puo\' restare vuota'); return }
    setSaving(true)
    try {
      // Rilettura fresca: `config` e' un JSONB condiviso (meteo, corsie
      // calendario, numeri direzione). Si fonde SOLO la chiave delle multe.
      const { data: fresh } = await supabase.from('centralina_pro_config').select('config').eq('id', rowId).maybeSingle()
      const base = (fresh?.config as Record<string, unknown>) || {}
      // Fusione anche DENTRO multe_config: la stessa chiave ospita
      // `pec_smtp_host` / `pec_smtp_port`, scritti da Gestione PEC & Email e
      // assenti da questo form. Sostituendo l'oggetto intero, salvare i dati
      // azienda cancellava il server SMTP della PEC.
      const multeBase = (base[MULTE_CONFIG_KEY] as Record<string, unknown>) || {}
      // upsert: la riga di un business mai configurato non esiste ancora.
      // Con la sola UPDATE il salvataggio non toccava nessuna riga e usciva
      // "riga non trovata" al primo salvataggio su Mare/Aria/Soggiorni.
      const { error } = await supabase
        .from('centralina_pro_config')
        .upsert({ id: rowId, config: { ...base, [MULTE_CONFIG_KEY]: { ...multeBase, ...v } } }, { onConflict: 'id' })
      if (error) throw error
      toast.success('Dati multe aggiornati')
    } catch (e) {
      toast.error('Errore: ' + (e instanceof Error ? e.message : 'riprova'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <ScheletroTesto righe={4} className="py-4" />

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-theme-text-primary">Dati azienda per le multe</h3>
          <p className="text-xs text-theme-text-muted mt-0.5">
            Compaiono nella lettera di comunicazione dati conducente inviata all'organo accertatore.
            Il destinatario viene letto dal verbale: non e' piu' fisso su Cagliari.
          </p>
        </div>
        {!readOnly && (
          <button
            type="button" onClick={save} disabled={saving}
            className="shrink-0 px-3 h-9 rounded-lg bg-dr7-gold text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? 'Salvataggio...' : 'Salva'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {CAMPI.map(c => (
          <div key={c.k} className={c.wide ? 'sm:col-span-2' : ''}>
            <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1">{c.label}</label>
            <input
              type="text"
              disabled={readOnly}
              value={v[c.k]}
              onChange={e => setV(prev => ({ ...prev, [c.k]: e.target.value }))}
              className="w-full px-2.5 h-9 rounded-lg border border-theme-border bg-theme-bg-primary text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-dr7-gold disabled:opacity-60"
            />
            {c.hint && <p className="mt-1 text-[10px] leading-snug text-theme-text-muted">{c.hint}</p>}
          </div>
        ))}
      </div>

      <div className="rounded-lg bg-theme-bg-tertiary border border-theme-border p-3">
        <div className="text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1.5">Anteprima chiusura lettera</div>
        <pre className="text-[11px] leading-relaxed text-theme-text-secondary whitespace-pre-wrap font-sans">{`Distinti saluti,

${v.ragione_sociale}
Rappresentante Legale: ${v.rappresentante_legale}
${v.indirizzo}
Tel: ${v.telefono}
PEC: ${v.pec_mittente}`}</pre>
      </div>
    </div>
  )
}
