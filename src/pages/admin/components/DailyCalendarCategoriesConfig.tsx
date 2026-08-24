import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import {
  resolveDailyCategories, DAILY_PALETTE, DAILY_PALETTE_KEYS, DAILY_CATEGORIES_CONFIG_KEY,
  customCategoryId, isCustomCategory,
  type DailyCategory, type DailyCategoryConfig,
} from '../../../utils/dailyCalendarCategories'

/**
 * Calendario Giornaliero — corsie (24/08/2026).
 *
 * Le corsie erano scritte in duro: 4 colonne fisse, con Lavaggio e Meccanica
 * separati (in realta' sono UNA cosa, Prime Wash) e una corsia "Varie" che
 * nell'operativita' non esiste. Qui si decide quali corsie esistono, come si
 * chiamano, di che colore sono e in che ordine appaiono.
 *
 * Salva in `centralina_pro_config.config.daily_calendar_categories` (riga
 * 'main', globale — non per business): la leggono sia la tab Calendario
 * Giornaliero sia la finestra a comparsa.
 */
export default function DailyCalendarCategoriesConfig({ readOnly = false }: { readOnly?: boolean }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState<DailyCategory[]>([])
  const [nuovaLabel, setNuovaLabel] = useState('')
  // Corsie di fabbrica eliminate: vanno ricordate, altrimenti il catalogo di
  // fabbrica le riaggiunge al ricaricamento.
  const [removedIds, setRemovedIds] = useState<string[]>([])

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true)
    try {
      const { data } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
      const cfg = (data?.config as Record<string, unknown>) || {}
      const saved = cfg[DAILY_CATEGORIES_CONFIG_KEY]
      const list = Array.isArray(saved) ? saved as DailyCategoryConfig[] : null
      setRows(resolveDailyCategories(list))
      setRemovedIds((list || []).filter(x => x.removed).map(x => x.id))
    } catch (e) {
      toast.error('Errore nel caricamento: ' + (e instanceof Error ? e.message : 'riprova'))
      setRows(resolveDailyCategories(null))
    } finally {
      setLoading(false)
    }
  }

  function patch(id: string, p: Partial<DailyCategory>) {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r
      const next = { ...r, ...p }
      if (p.colorKey) {
        const pal = DAILY_PALETTE[p.colorKey] || DAILY_PALETTE.slate
        return { ...next, ...pal, id: r.id, label: next.label, enabled: next.enabled, colorKey: pal.key }
      }
      return next
    }))
  }

  function aggiungi() {
    const label = nuovaLabel.trim()
    if (!label) { toast.error('Dai un nome alla corsia'); return }
    const id = customCategoryId(label)
    if (rows.some(r => r.id === id)) { toast.error('Esiste gia una corsia con questo nome'); return }
    const pal = DAILY_PALETTE.slate
    setRows(prev => [...prev, {
      ...pal, id, label, enabled: true, colorKey: pal.key, custom: true, serviceTypes: [],
    }])
    setNuovaLabel('')
    toast.success('Corsia aggiunta — scegli i tipi di servizio che deve raccogliere, poi Salva')
  }

  function rimuovi(id: string) {
    const r = rows.find(x => x.id === id)
    if (!window.confirm(`Eliminare la corsia "${r?.label || id}"? Le prenotazioni non vengono toccate.`)) return
    setRows(prev => prev.filter(x => x.id !== id))
    // Le corsie di fabbrica tornerebbero da sole: le si segna come eliminate.
    if (!isCustomCategory(id)) setRemovedIds(prev => prev.includes(id) ? prev : [...prev, id])
  }

  function ripristinaEliminate() {
    setRemovedIds([])
    setRows(resolveDailyCategories(rows.map(r => ({
      id: r.id, label: r.label, colorKey: r.colorKey, enabled: r.enabled,
      ...(r.custom ? { custom: true, serviceTypes: r.serviceTypes || [] } : {}),
    }))))
    toast.success('Corsie di fabbrica ripristinate — ricordati di salvare')
  }

  function move(id: string, dir: -1 | 1) {
    setRows(prev => {
      const i = prev.findIndex(r => r.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      const [it] = next.splice(i, 1)
      next.splice(j, 0, it)
      return next
    })
  }

  async function save() {
    if (rows.every(r => !r.enabled)) {
      toast.error('Almeno una corsia deve restare attiva.')
      return
    }
    setSaving(true)
    try {
      // Rilettura FRESCA prima di scrivere: la config e' un JSONB condiviso da
      // piu' pannelli (meteo, cauzioni, numeri direzione). Si fonde SOLO la
      // chiave delle corsie, altrimenti un salvataggio concorrente sparisce.
      const { data: fresh } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
      const base = (fresh?.config as Record<string, unknown>) || {}
      const payload: DailyCategoryConfig[] = [
        ...rows.map(r => ({
          id: r.id, label: r.label, colorKey: r.colorKey, enabled: r.enabled,
          ...(r.custom ? { custom: true, serviceTypes: r.serviceTypes || [] } : {}),
        })),
        // Le corsie di fabbrica eliminate restano scritte, con removed: true.
        ...removedIds.filter(id => !rows.some(r => r.id === id)).map(id => ({ id, removed: true })),
      ]
      const { data, error } = await supabase
        .from('centralina_pro_config')
        .update({ config: { ...base, [DAILY_CATEGORIES_CONFIG_KEY]: payload } })
        .eq('id', 'main')
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) {
        toast.error('Riga di configurazione non trovata (centralina_pro_config id=main).')
        return
      }
      toast.success('Corsie del calendario aggiornate')
    } catch (e) {
      toast.error('Errore: ' + (e instanceof Error ? e.message : 'riprova'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-sm text-theme-text-muted py-4">Caricamento corsie...</div>

  const attive = rows.filter(r => r.enabled).length

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-theme-text-primary">Corsie del Calendario Giornaliero</h3>
          <p className="text-xs text-theme-text-muted mt-0.5">
            Quali colonne compaiono nella giornata, come si chiamano, di che colore e in che ordine.
            Una corsia spenta sparisce da legenda e griglia, ma le prenotazioni restano nel sistema.
          </p>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="shrink-0 px-3 h-9 rounded-lg bg-dr7-gold text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? 'Salvataggio...' : 'Salva'}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {rows.map((r, idx) => (
          <div
            key={r.id}
            className={`flex flex-wrap items-center gap-2 rounded-xl border border-theme-border bg-theme-bg-secondary p-2.5 ${r.enabled ? '' : 'opacity-55'}`}
          >
            {/* Ordine */}
            <div className="flex flex-col gap-0.5">
              <button
                type="button" disabled={readOnly || idx === 0} onClick={() => move(r.id, -1)}
                className="w-6 h-4 rounded border border-theme-border text-theme-text-muted hover:bg-theme-bg-hover disabled:opacity-30 leading-none text-[10px]"
                title="Sposta su"
              >&#9650;</button>
              <button
                type="button" disabled={readOnly || idx === rows.length - 1} onClick={() => move(r.id, 1)}
                className="w-6 h-4 rounded border border-theme-border text-theme-text-muted hover:bg-theme-bg-hover disabled:opacity-30 leading-none text-[10px]"
                title="Sposta giu"
              >&#9660;</button>
            </div>

            <div className={`w-3.5 h-3.5 rounded-full shrink-0 ${r.swatch}`} />

            <input
              type="text"
              disabled={readOnly}
              value={r.label}
              onChange={e => patch(r.id, { label: e.target.value })}
              placeholder="Nome corsia"
              className="flex-1 min-w-[9rem] px-2.5 h-9 rounded-lg border border-theme-border bg-theme-bg-primary text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-dr7-gold disabled:opacity-60"
            />

            {/* Colore */}
            <div className="flex flex-wrap gap-1 items-center">
              {DAILY_PALETTE_KEYS.map(k => {
                const pal = DAILY_PALETTE[k]
                const active = r.colorKey === k
                return (
                  <button
                    key={k}
                    type="button"
                    disabled={readOnly}
                    onClick={() => patch(r.id, { colorKey: k })}
                    title={pal.label}
                    className={`w-5 h-5 rounded-full ${pal.swatch} transition-transform disabled:opacity-60 ${
                      active ? 'ring-2 ring-offset-1 ring-dr7-gold ring-offset-theme-bg-secondary scale-110' : 'hover:scale-110'
                    }`}
                  />
                )
              })}
            </div>

            {r.custom && (
              <>
                <input
                  type="text"
                  disabled={readOnly}
                  value={(r.serviceTypes || []).join(', ')}
                  onChange={e => patch(r.id, { serviceTypes: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })}
                  placeholder="service_type raccolti (es. varie, tour)"
                  title="Quali service_type finiscono in questa corsia. Separali con virgola."
                  className="w-full sm:w-64 px-2.5 h-9 rounded-lg border border-theme-border bg-theme-bg-primary text-xs font-mono text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-dr7-gold disabled:opacity-60"
                />
              </>
            )}
            <button
              type="button"
              disabled={readOnly}
              onClick={() => rimuovi(r.id)}
              title="Elimina corsia"
              className="shrink-0 w-8 h-8 rounded-full border border-red-300 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-60"
            >
              &times;
            </button>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => patch(r.id, { enabled: !r.enabled })}
              className={`shrink-0 px-2.5 h-8 rounded-full border text-[11px] font-semibold transition-colors disabled:opacity-60 ${
                r.enabled
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'border-theme-border text-theme-text-muted hover:bg-theme-bg-hover'
              }`}
            >
              {r.enabled ? 'Attiva' : 'Spenta'}
            </button>
          </div>
        ))}
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-theme-border p-2.5">
          <input
            type="text"
            value={nuovaLabel}
            onChange={e => setNuovaLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); aggiungi() } }}
            placeholder="Nome di una corsia nuova (es. Transfer, Eventi...)"
            className="flex-1 min-w-[12rem] px-2.5 h-9 rounded-lg border border-theme-border bg-theme-bg-primary text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-1 focus:ring-dr7-gold"
          />
          <button
            type="button"
            onClick={aggiungi}
            className="px-3 h-9 rounded-lg border border-theme-border text-theme-text-primary text-xs font-semibold hover:bg-theme-bg-hover transition-colors"
          >
            + Aggiungi corsia
          </button>
        </div>
      )}

      {rows.some(r => r.custom && r.enabled && (r.serviceTypes || []).length === 0) && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          Una corsia personalizzata senza <code>service_type</code> resta sempre vuota: indica quali tipi di
          prenotazione deve raccogliere, altrimenti occupa una colonna senza mai mostrare nulla.
        </p>
      )}

      {removedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-theme-text-muted">
          <span>{removedIds.length} corsia/e di fabbrica eliminate.</span>
          {!readOnly && (
            <button
              type="button"
              onClick={ripristinaEliminate}
              className="px-2 h-7 rounded-lg border border-theme-border text-theme-text-primary font-semibold hover:bg-theme-bg-hover transition-colors"
            >Ripristina corsie di fabbrica</button>
          )}
        </div>
      )}

      <p className="text-[11px] text-theme-text-muted">
        {attive} corsie attive. Ogni corsia attiva compare nella giornata anche quando e' vuota. Lavaggio e Meccanica condividono la corsia <strong>Prime Wash</strong>:
        sono lo stesso reparto, non due colonne separate.
      </p>
    </div>
  )
}
