import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import Input from './Input'
import Select from './Select'
import Button from './Button'

interface CoefficientRow {
  min_pct?: number; max_pct?: number
  min_days?: number; max_days?: number
  coeff: number; label: string
}

interface SeasonRule {
  name: string; start_date: string; end_date: string
  coeff: number; type: string
}

interface Vehicle {
  id: string; display_name: string; daily_rate: number
  category?: string; status: string
}

interface BreakdownItem {
  label: string; coeff: number; description: string
}

interface SimulationResult {
  enabled: boolean
  suggestedPrice: number; dailyRate: number; rentalDays: number
  basePrice: number; breakdown: BreakdownItem[]
  occupationPct: number; daysAhead: number
  limits: { minHit: boolean; maxHit: boolean; minPrice: number; maxPrice: number | null }
  vehicleName: string; category: string
}

const SECTION_CLASS = 'bg-theme-bg-secondary border border-theme-border rounded-lg p-4 sm:p-6'
const SECTION_TITLE = 'text-lg font-semibold text-theme-text-primary mb-4'

export default function RevenuePricingTab() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])

  // Config state
  const [enabled, setEnabled] = useState(false)
  const [mode, setMode] = useState<string>('suggestion')
  const [basePrices, setBasePrices] = useState<Record<string, number>>({})
  const [minPrices, setMinPrices] = useState<Record<string, number>>({})
  const [maxPrices, setMaxPrices] = useState<Record<string, number>>({})
  const [occupationCoeffs, setOccupationCoeffs] = useState<CoefficientRow[]>([])
  const [advanceCoeffs, setAdvanceCoeffs] = useState<CoefficientRow[]>([])
  const [durationCoeffs, setDurationCoeffs] = useState<CoefficientRow[]>([])
  const [seasonRules, setSeasonRules] = useState<SeasonRule[]>([])

  // Simulator state
  const [simVehicleId, setSimVehicleId] = useState('')
  const [simPickup, setSimPickup] = useState('')
  const [simDropoff, setSimDropoff] = useState('')
  const [simResult, setSimResult] = useState<SimulationResult | null>(null)
  const [simLoading, setSimLoading] = useState(false)

  useEffect(() => { loadConfig(); loadVehicles() }, [])

  async function loadVehicles() {
    const { data } = await supabase
      .from('vehicles')
      .select('id, display_name, daily_rate, category, status')
      .neq('status', 'retired')
      .order('display_name')
    setVehicles(data || [])
  }

  async function loadConfig() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('revenue_config')
        .select('*')
        .limit(1)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No row exists yet — use defaults
          setLoading(false)
          return
        }
        throw error
      }

      if (data) {
        setEnabled(data.enabled)
        setMode(data.mode)
        const c = data.config || {}
        setBasePrices(c.base_prices || {})
        setMinPrices(c.min_prices || {})
        setMaxPrices(c.max_prices || {})
        setOccupationCoeffs(c.occupation_coefficients || [])
        setAdvanceCoeffs(c.advance_coefficients || [])
        setDurationCoeffs(c.duration_coefficients || [])
        setSeasonRules(c.season_rules || [])
      }
    } catch (err: any) {
      toast.error('Errore caricamento config: ' + err.message)
    }
    setLoading(false)
  }

  async function saveConfig() {
    setSaving(true)
    try {
      const config = {
        base_prices: basePrices,
        min_prices: minPrices,
        max_prices: maxPrices,
        occupation_coefficients: occupationCoeffs,
        advance_coefficients: advanceCoeffs,
        duration_coefficients: durationCoeffs,
        season_rules: seasonRules
      }

      // Upsert the single row
      const { data: existing } = await supabase.from('revenue_config').select('id').limit(1).single()

      if (existing) {
        const { error } = await supabase
          .from('revenue_config')
          .update({ enabled, mode, config, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('revenue_config')
          .insert({ enabled, mode, config })
        if (error) throw error
      }

      toast.success('Configurazione salvata')
    } catch (err: any) {
      toast.error('Errore salvataggio: ' + err.message)
    }
    setSaving(false)
  }

  async function runSimulation() {
    if (!simVehicleId || !simPickup || !simDropoff) {
      toast.error('Seleziona veicolo e date per la simulazione')
      return
    }
    setSimLoading(true)
    setSimResult(null)
    try {
      const res = await fetch('/.netlify/functions/calculate-dynamic-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: simVehicleId, pickup_date: simPickup, dropoff_date: simDropoff })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setSimResult(data)
    } catch (err: any) {
      toast.error('Errore simulazione: ' + err.message)
    }
    setSimLoading(false)
  }

  // --- Generic coefficient table helpers ---
  function renderCoefficientTable(
    rows: CoefficientRow[],
    setRows: (rows: CoefficientRow[]) => void,
    type: 'pct' | 'days'
  ) {
    const minKey = type === 'pct' ? 'min_pct' : 'min_days'
    const maxKey = type === 'pct' ? 'max_pct' : 'max_days'
    const minLabel = type === 'pct' ? 'Min %' : 'Min Giorni'
    const maxLabel = type === 'pct' ? 'Max %' : 'Max Giorni'

    return (
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_1fr_1fr_2fr_auto] gap-2 text-xs font-semibold text-theme-text-muted uppercase">
          <span>{minLabel}</span><span>{maxLabel}</span><span>Coeff.</span><span>Etichetta</span><span></span>
        </div>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_2fr_auto] gap-2 items-center">
            <input
              type="number" className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
              value={row[minKey] ?? ''} onChange={e => {
                const updated = [...rows]; updated[i] = { ...updated[i], [minKey]: Number(e.target.value) }; setRows(updated)
              }}
            />
            <input
              type="number" className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
              value={row[maxKey] ?? ''} onChange={e => {
                const updated = [...rows]; updated[i] = { ...updated[i], [maxKey]: Number(e.target.value) }; setRows(updated)
              }}
            />
            <input
              type="number" step="0.01" className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
              value={row.coeff} onChange={e => {
                const updated = [...rows]; updated[i] = { ...updated[i], coeff: Number(e.target.value) }; setRows(updated)
              }}
            />
            <input
              type="text" className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
              value={row.label} onChange={e => {
                const updated = [...rows]; updated[i] = { ...updated[i], label: e.target.value }; setRows(updated)
              }}
            />
            <button
              onClick={() => { const updated = rows.filter((_, idx) => idx !== i); setRows(updated) }}
              className="text-red-400 hover:text-red-300 text-sm px-2"
            >✕</button>
          </div>
        ))}
        <button
          onClick={() => setRows([...rows, { [minKey]: 0, [maxKey]: 0, coeff: 1.0, label: '' } as any])}
          className="text-sm text-blue-400 hover:text-blue-300"
        >+ Aggiungi riga</button>
      </div>
    )
  }

  if (loading) {
    return <div className="text-center py-12 text-theme-text-muted">Caricamento configurazione...</div>
  }

  return (
    <div className="space-y-6">
      {/* Header — Enable + Mode + Save */}
      <div className={SECTION_CLASS}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}
                className="w-5 h-5 rounded border-theme-border text-blue-500 focus:ring-blue-500"
              />
              <span className="text-theme-text-primary font-semibold">Revenue Management Attivo</span>
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Select
              label="Modalità"
              value={mode}
              onChange={e => setMode(e.target.value)}
              options={[
                { value: 'suggestion', label: 'Suggerimento' },
                { value: 'auto_with_approval', label: 'Auto con approvazione' },
                { value: 'auto', label: 'Automatico' }
              ]}
            />
            <Button onClick={saveConfig} disabled={saving} className="whitespace-nowrap">
              {saving ? 'Salvando...' : 'Salva Configurazione'}
            </Button>
          </div>
        </div>
      </div>

      {/* Prezzi Base */}
      <div className={SECTION_CLASS}>
        <h3 className={SECTION_TITLE}>Prezzi Base (€/giorno)</h3>
        <p className="text-sm text-theme-text-muted mb-4">
          Override per veicolo o categoria. Se vuoto, usa la tariffa giornaliera del veicolo.
        </p>

        {/* Category defaults */}
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-theme-text-secondary mb-2">Per Categoria</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {['exotic', 'urban', 'aziendali'].map(cat => (
              <div key={cat} className="flex items-center gap-2">
                <span className="text-sm text-theme-text-secondary capitalize w-20">{cat}</span>
                <input
                  type="number" step="0.01" placeholder="—"
                  className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                  value={basePrices[`category:${cat}`] ?? ''}
                  onChange={e => {
                    const val = e.target.value
                    setBasePrices(prev => {
                      const next = { ...prev }
                      if (val) next[`category:${cat}`] = Number(val); else delete next[`category:${cat}`]
                      return next
                    })
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Per-vehicle overrides */}
        <h4 className="text-sm font-semibold text-theme-text-secondary mb-2">Per Veicolo</h4>
        <div className="max-h-64 overflow-y-auto space-y-2">
          {vehicles.map(v => (
            <div key={v.id} className="grid grid-cols-[2fr_1fr_1fr] gap-2 items-center">
              <span className="text-sm text-theme-text-primary truncate">{v.display_name}</span>
              <span className="text-xs text-theme-text-muted">Tariffa: €{(v.daily_rate / 100).toFixed(2)}</span>
              <input
                type="number" step="0.01" placeholder="Override"
                className="px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                value={basePrices[v.id] ?? ''}
                onChange={e => {
                  const val = e.target.value
                  setBasePrices(prev => {
                    const next = { ...prev }
                    if (val) next[v.id] = Number(val); else delete next[v.id]
                    return next
                  })
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Coefficienti Occupazione */}
      <div className={SECTION_CLASS}>
        <h3 className={SECTION_TITLE}>Coefficienti Occupazione</h3>
        <p className="text-sm text-theme-text-muted mb-4">
          Moltiplicatore basato sulla percentuale di occupazione della flotta per categoria.
        </p>
        {renderCoefficientTable(occupationCoeffs, setOccupationCoeffs, 'pct')}
      </div>

      {/* Coefficienti Anticipo */}
      <div className={SECTION_CLASS}>
        <h3 className={SECTION_TITLE}>Coefficienti Anticipo Prenotazione</h3>
        <p className="text-sm text-theme-text-muted mb-4">
          Moltiplicatore basato su quanti giorni prima viene effettuata la prenotazione.
        </p>
        {renderCoefficientTable(advanceCoeffs, setAdvanceCoeffs, 'days')}
      </div>

      {/* Coefficienti Durata */}
      <div className={SECTION_CLASS}>
        <h3 className={SECTION_TITLE}>Coefficienti Durata Noleggio</h3>
        <p className="text-sm text-theme-text-muted mb-4">
          Moltiplicatore basato sulla durata del noleggio in giorni.
        </p>
        {renderCoefficientTable(durationCoeffs, setDurationCoeffs, 'days')}
      </div>

      {/* Regole Stagionali */}
      <div className={SECTION_CLASS}>
        <h3 className={SECTION_TITLE}>Regole Stagionali</h3>
        <div className="space-y-2">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 text-xs font-semibold text-theme-text-muted uppercase">
            <span>Nome</span><span>Inizio (MM-GG)</span><span>Fine (MM-GG)</span><span>Coeff.</span><span>Tipo</span><span></span>
          </div>
          {seasonRules.map((rule, i) => (
            <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 items-center">
              <input
                type="text" className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                value={rule.name} onChange={e => {
                  const updated = [...seasonRules]; updated[i] = { ...updated[i], name: e.target.value }; setSeasonRules(updated)
                }}
              />
              <input
                type="text" placeholder="MM-DD" className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                value={rule.start_date} onChange={e => {
                  const updated = [...seasonRules]; updated[i] = { ...updated[i], start_date: e.target.value }; setSeasonRules(updated)
                }}
              />
              <input
                type="text" placeholder="MM-DD" className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                value={rule.end_date} onChange={e => {
                  const updated = [...seasonRules]; updated[i] = { ...updated[i], end_date: e.target.value }; setSeasonRules(updated)
                }}
              />
              <input
                type="number" step="0.01" className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                value={rule.coeff} onChange={e => {
                  const updated = [...seasonRules]; updated[i] = { ...updated[i], coeff: Number(e.target.value) }; setSeasonRules(updated)
                }}
              />
              <select
                className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                value={rule.type} onChange={e => {
                  const updated = [...seasonRules]; updated[i] = { ...updated[i], type: e.target.value }; setSeasonRules(updated)
                }}
              >
                <option value="bassa">Bassa</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="picco">Picco</option>
              </select>
              <button
                onClick={() => setSeasonRules(seasonRules.filter((_, idx) => idx !== i))}
                className="text-red-400 hover:text-red-300 text-sm px-2"
              >✕</button>
            </div>
          ))}
          <button
            onClick={() => setSeasonRules([...seasonRules, { name: '', start_date: '', end_date: '', coeff: 1.0, type: 'media' }])}
            className="text-sm text-blue-400 hover:text-blue-300"
          >+ Aggiungi regola stagionale</button>
        </div>
      </div>

      {/* Limiti Prezzo */}
      <div className={SECTION_CLASS}>
        <h3 className={SECTION_TITLE}>Limiti Prezzo (€/giorno)</h3>
        <p className="text-sm text-theme-text-muted mb-4">
          Prezzo minimo e massimo per veicolo o categoria. Il prezzo dinamico non supererà questi limiti.
        </p>

        <div className="mb-4">
          <h4 className="text-sm font-semibold text-theme-text-secondary mb-2">Per Categoria</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {['exotic', 'urban', 'aziendali'].map(cat => (
              <div key={cat} className="space-y-1">
                <span className="text-sm text-theme-text-secondary capitalize">{cat}</span>
                <div className="flex gap-2">
                  <input
                    type="number" step="0.01" placeholder="Min"
                    className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                    value={minPrices[`category:${cat}`] ?? ''}
                    onChange={e => {
                      const val = e.target.value
                      setMinPrices(prev => {
                        const next = { ...prev }
                        if (val) next[`category:${cat}`] = Number(val); else delete next[`category:${cat}`]
                        return next
                      })
                    }}
                  />
                  <input
                    type="number" step="0.01" placeholder="Max"
                    className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                    value={maxPrices[`category:${cat}`] ?? ''}
                    onChange={e => {
                      const val = e.target.value
                      setMaxPrices(prev => {
                        const next = { ...prev }
                        if (val) next[`category:${cat}`] = Number(val); else delete next[`category:${cat}`]
                        return next
                      })
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <h4 className="text-sm font-semibold text-theme-text-secondary mb-2">Per Veicolo</h4>
        <div className="max-h-64 overflow-y-auto space-y-2">
          {vehicles.map(v => (
            <div key={v.id} className="grid grid-cols-[2fr_1fr_1fr] gap-2 items-center">
              <span className="text-sm text-theme-text-primary truncate">{v.display_name}</span>
              <input
                type="number" step="0.01" placeholder="Min"
                className="px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                value={minPrices[v.id] ?? ''}
                onChange={e => {
                  const val = e.target.value
                  setMinPrices(prev => {
                    const next = { ...prev }
                    if (val) next[v.id] = Number(val); else delete next[v.id]
                    return next
                  })
                }}
              />
              <input
                type="number" step="0.01" placeholder="Max"
                className="px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                value={maxPrices[v.id] ?? ''}
                onChange={e => {
                  const val = e.target.value
                  setMaxPrices(prev => {
                    const next = { ...prev }
                    if (val) next[v.id] = Number(val); else delete next[v.id]
                    return next
                  })
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Simulatore Prezzo */}
      <div className={`${SECTION_CLASS} border-amber-500/30`}>
        <h3 className={SECTION_TITLE}>Simulatore Prezzo</h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
          <Select
            label="Veicolo"
            value={simVehicleId}
            onChange={e => setSimVehicleId(e.target.value)}
            options={[
              { value: '', label: 'Seleziona veicolo...' },
              ...vehicles.map(v => ({ value: v.id, label: v.display_name }))
            ]}
          />
          <Input
            label="Data Ritiro"
            type="date"
            value={simPickup}
            onChange={e => setSimPickup(e.target.value)}
          />
          <Input
            label="Data Riconsegna"
            type="date"
            value={simDropoff}
            onChange={e => setSimDropoff(e.target.value)}
          />
          <div className="flex items-end">
            <Button onClick={runSimulation} disabled={simLoading} className="w-full">
              {simLoading ? 'Calcolo...' : 'Simula Prezzo'}
            </Button>
          </div>
        </div>

        {simResult && simResult.enabled && (
          <div className="border border-amber-500/40 bg-amber-500/5 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-theme-text-muted">Veicolo: </span>
                <span className="text-theme-text-primary font-medium">{simResult.vehicleName}</span>
                <span className="text-xs text-theme-text-muted ml-2">({simResult.category})</span>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-amber-400">€{simResult.suggestedPrice.toFixed(2)}</div>
                <div className="text-xs text-theme-text-muted">
                  €{simResult.dailyRate.toFixed(2)}/giorno × {simResult.rentalDays} giorni
                </div>
              </div>
            </div>

            <div className="border-t border-theme-border pt-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-theme-text-muted">Prezzo base</span>
                <span className="text-theme-text-primary">€{simResult.basePrice.toFixed(2)}/giorno</span>
              </div>
              {simResult.breakdown.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-theme-text-muted">
                    {item.label} <span className="text-xs">({item.description})</span>
                  </span>
                  <span className={`font-mono ${item.coeff > 1 ? 'text-red-400' : item.coeff < 1 ? 'text-green-400' : 'text-theme-text-primary'}`}>
                    ×{item.coeff.toFixed(2)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between text-xs text-theme-text-muted pt-1 border-t border-theme-border">
                <span>Occupazione flotta: {simResult.occupationPct}% | Anticipo: {simResult.daysAhead} giorni</span>
                <span>
                  {simResult.limits.minHit && '⚠️ Min raggiunto'}
                  {simResult.limits.maxHit && '⚠️ Max raggiunto'}
                </span>
              </div>
            </div>
          </div>
        )}

        {simResult && !simResult.enabled && (
          <div className="text-center py-4 text-theme-text-muted">
            Revenue Management non attivo. Attivalo per vedere i suggerimenti.
          </div>
        )}
      </div>
    </div>
  )
}
