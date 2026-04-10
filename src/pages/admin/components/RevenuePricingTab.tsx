import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import Input from './Input'
import Select from './Select'
import Button from './Button'
import {
  type RevenueConfig,
  type RevenueMode,
  type CoefficientRow,
  type PricingTrace,
  type ValidationError,
  getDefaultConfig,
  parseConfigFromDB,
  calculateDynamicPrice,
  validateConfig,
} from '../../../utils/revenuePricingEngine'
import CentralinaConfig from './CentralinaConfig'

interface Vehicle {
  id: string; display_name: string; daily_rate: number
  category?: string; status: string
}

// ─── Extras Config Types ───
interface ExtraItem {
  id: string
  name: string
  price: number
  price_unit: 'per_day' | 'per_hour' | 'per_km' | 'per_unit' | 'one_time' | 'included'
  unit_label?: string
  is_active: boolean
  display_order: number
  description?: string
  deposit_required?: number
}

type ExtraCategory = 'insurance' | 'km_packages' | 'deposit_options' | 'driver_extras' | 'delivery' | 'experience' | 'cancellation'

interface ExtrasConfig {
  insurance: ExtraItem[]
  km_packages: ExtraItem[]
  deposit_options: ExtraItem[]
  driver_extras: ExtraItem[]
  delivery: ExtraItem[]
  experience: ExtraItem[]
  cancellation: ExtraItem[]
}

const EXTRA_CATEGORY_LABELS: Record<ExtraCategory, string> = {
  insurance: 'Assicurazioni',
  km_packages: 'Pacchetti KM',
  deposit_options: 'Opzioni Cauzione',
  driver_extras: 'Guidatore & Pulizia',
  delivery: 'Consegna',
  experience: 'Esperienze',
  cancellation: 'Cancellazione',
}

const PRICE_UNIT_LABELS: Record<string, string> = {
  per_day: '/giorno',
  per_hour: '/ora',
  per_km: '/km',
  per_unit: '/unità',
  one_time: 'una tantum',
  included: 'incluso',
}

const DEFAULT_EXTRAS_CONFIG: ExtrasConfig = {
  insurance: [
    // Supercar (Fascia A = Tier 2)
    { id: 'rca_inclusa', name: 'RCA Compresa', price: 0, price_unit: 'included', deposit_required: 10000, is_active: true, display_order: 1, description: 'Supercar — Assicurazione base inclusa. Cauzione €10.000' },
    { id: 'kasko_base_supercar_t2', name: 'Kasko Base (Supercar Fascia A)', price: 89, price_unit: 'per_day', is_active: true, display_order: 2 },
    { id: 'kasko_base_supercar_t1', name: 'Kasko Base (Supercar Fascia B)', price: 119, price_unit: 'per_day', is_active: true, display_order: 3 },
    { id: 'kasko_black', name: 'Kasko Black (Supercar)', price: 149, price_unit: 'per_day', is_active: true, display_order: 4 },
    { id: 'kasko_signature', name: 'Kasko Signature (Supercar)', price: 189, price_unit: 'per_day', is_active: true, display_order: 5 },
    { id: 'kasko_dr7_supercar', name: 'Kasko DR7 (Supercar)', price: 289, price_unit: 'per_day', is_active: true, display_order: 6, description: 'Massima protezione' },
    // Urban
    { id: 'rca_urban', name: 'RCA Compresa (Urban)', price: 0, price_unit: 'included', is_active: true, display_order: 10 },
    { id: 'kasko_base_urban', name: 'Kasko Base (Urban)', price: 15, price_unit: 'per_day', is_active: true, display_order: 11 },
    { id: 'kasko_black_urban', name: 'Kasko Black (Urban)', price: 25, price_unit: 'per_day', is_active: true, display_order: 12 },
    { id: 'kasko_signature_urban', name: 'Kasko Signature (Urban)', price: 35, price_unit: 'per_day', is_active: true, display_order: 13 },
    { id: 'kasko_dr7_urban', name: 'Kasko DR7 (Urban)', price: 45, price_unit: 'per_day', is_active: true, display_order: 14 },
    // Furgone / NCC — solo RCA e Kasko Base
    { id: 'rca_furgone', name: 'RCA Compresa (Furgone/NCC)', price: 0, price_unit: 'included', is_active: true, display_order: 20 },
    { id: 'kasko_base_furgone', name: 'Kasko Base (Furgone/NCC)', price: 45, price_unit: 'per_day', is_active: true, display_order: 21 },
  ],
  km_packages: [
    { id: 'supercar_50km', name: '50 km/giorno (Supercar)', price: 199, price_unit: 'per_day', is_active: true, display_order: 0, description: 'Pacchetto 50km al giorno per supercar' },
    { id: 'unlimited_km_supercar_t1', name: 'KM Illimitati (Supercar Fascia B)', price: 289, price_unit: 'per_day', is_active: true, display_order: 1 },
    { id: 'unlimited_km_supercar_t2', name: 'KM Illimitati (Supercar Fascia A)', price: 189, price_unit: 'per_day', is_active: true, display_order: 2 },
    { id: 'unlimited_km_furgone', name: 'KM Illimitati (Ducato)', price: 94.50, price_unit: 'per_day', is_active: true, display_order: 3 },
    { id: 'unlimited_km_ncc', name: 'KM Illimitati (Vito/NCC)', price: 189, price_unit: 'per_day', is_active: true, display_order: 4 },
  ],
  deposit_options: [
    { id: 'no_deposit', name: 'Senza Cauzione', price: 49, price_unit: 'per_day', is_active: true, display_order: 1 },
    { id: 'deposit_2020_plus', name: 'Cauzione Auto 2020+', price: 20, price_unit: 'per_day', is_active: true, display_order: 2 },
  ],
  driver_extras: [
    { id: 'second_driver', name: 'Secondo Guidatore', price: 10, price_unit: 'per_day', is_active: true, display_order: 1 },
    { id: 'final_cleaning', name: 'Pulizia Finale', price: 9.90, price_unit: 'one_time', is_active: true, display_order: 2 },
  ],
  delivery: [
    { id: 'delivery', name: 'Consegna / Ritiro', price: 3, price_unit: 'per_km', is_active: true, display_order: 1 },
  ],
  experience: [
    { id: 'bouquet_rose', name: 'Bouquet Rose', price: 7.90, price_unit: 'per_unit', unit_label: 'rosa', is_active: true, display_order: 1 },
    { id: 'wedding_decoration', name: 'Allestimento Matrimonio', price: 150, price_unit: 'one_time', is_active: true, display_order: 2 },
    { id: 'chauffeur', name: 'Chauffeur', price: 150, price_unit: 'per_hour', is_active: true, display_order: 3 },
    { id: 'restaurant_booking', name: 'Prenotazione Ristorante', price: 10, price_unit: 'one_time', is_active: true, display_order: 4 },
    { id: 'video_drone', name: 'Video Maker + Drone', price: 200, price_unit: 'per_hour', is_active: true, display_order: 5 },
    { id: 'premium_assistance', name: 'Assistenza Premium', price: 19.90, price_unit: 'per_day', is_active: true, display_order: 6 },
    { id: 'vehicle_replacement', name: 'Sostituzione Veicolo', price: 19.90, price_unit: 'per_day', is_active: true, display_order: 7 },
    { id: 'vip_chauffeur', name: 'VIP Chauffeur', price: 189, price_unit: 'per_hour', is_active: true, display_order: 8 },
  ],
  cancellation: [
    { id: 'dr7_flex', name: 'DR7 FLEX', price: 19.90, price_unit: 'per_day', is_active: true, display_order: 1, description: '90% rimborso in credito DR7 Wallet' },
  ],
}

const SECTION = 'bg-theme-bg-secondary border border-theme-border rounded-lg p-4 sm:p-6'
const SECTION_TITLE = 'text-lg font-semibold text-theme-text-primary mb-4'

const MODE_OPTIONS: { value: RevenueMode; label: string }[] = [
  { value: 'disabled', label: 'Disattivato' },
  { value: 'suggestion', label: 'Suggerimento (manuale)' },
  { value: 'auto_apply', label: 'Automatico (applica prezzo)' },
]

const SOURCE_LABELS: Record<string, string> = {
  vehicle_override: 'Override veicolo',
  category_override: 'Override categoria',
  vehicle_daily_rate: 'Tariffa base veicolo',
}

export default function RevenuePricingTab() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])

  // Config state
  const [config, setConfig] = useState<RevenueConfig>(getDefaultConfig())

  // Extras config state
  const [extrasConfig, setExtrasConfig] = useState<ExtrasConfig>(DEFAULT_EXTRAS_CONFIG)
  const [extrasSaving, setExtrasSaving] = useState(false)
  const [extrasCollapsed, setExtrasCollapsed] = useState<Record<string, boolean>>({})

  // Simulator state
  const [simVehicleId, setSimVehicleId] = useState('')
  const [simPickup, setSimPickup] = useState('')
  const [simDropoff, setSimDropoff] = useState('')
  const [simResult, setSimResult] = useState<PricingTrace | null>(null)
  const [simLoading, setSimLoading] = useState(false)

  useEffect(() => { loadConfig(); loadVehicles(); loadExtrasConfig() }, [])

  async function loadVehicles() {
    const { data } = await supabase
      .from('vehicles')
      .select('id, display_name, daily_rate, category, status')
      .neq('status', 'retired')
      .order('display_name')
    setVehicles(data || [])
  }

  async function loadExtrasConfig() {
    try {
      const { data, error } = await supabase
        .from('rental_extras_config')
        .select('*')
        .limit(1)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No row yet, use defaults
          setExtrasConfig(DEFAULT_EXTRAS_CONFIG)
          return
        }
        throw error
      }

      if (data?.config) {
        const c = data.config as Record<string, ExtraItem[]>
        // Merge: keep DB items + add any missing defaults (by id)
        const merge = (dbItems: ExtraItem[] | undefined, defaults: ExtraItem[]): ExtraItem[] => {
          const existing = dbItems || []
          const existingIds = new Set(existing.map(i => i.id))
          const missing = defaults.filter(d => !existingIds.has(d.id))
          return [...existing, ...missing]
        }
        setExtrasConfig({
          insurance: merge(c.insurance, DEFAULT_EXTRAS_CONFIG.insurance),
          km_packages: merge(c.km_packages, DEFAULT_EXTRAS_CONFIG.km_packages),
          deposit_options: merge(c.deposit_options, DEFAULT_EXTRAS_CONFIG.deposit_options),
          driver_extras: merge(c.driver_extras, DEFAULT_EXTRAS_CONFIG.driver_extras),
          delivery: merge(c.delivery, DEFAULT_EXTRAS_CONFIG.delivery),
          experience: merge(c.experience, DEFAULT_EXTRAS_CONFIG.experience),
          cancellation: merge(c.cancellation, DEFAULT_EXTRAS_CONFIG.cancellation),
        })
      }
    } catch (err: unknown) {
      console.error('Error loading extras config:', err)
      // Use defaults if table doesn't exist yet
    }
  }

  async function saveExtrasConfig() {
    setExtrasSaving(true)
    try {
      const dbPayload = {
        config: extrasConfig,
        updated_at: new Date().toISOString(),
      }

      const { data: existing } = await supabase.from('rental_extras_config').select('id').limit(1).single()

      if (existing) {
        const { error } = await supabase
          .from('rental_extras_config')
          .update(dbPayload)
          .eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('rental_extras_config')
          .insert(dbPayload)
        if (error) throw error
      }

      toast.success('Prezzi servizi extra salvati')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Errore sconosciuto'
      toast.error('Errore salvataggio extras: ' + message)
    }
    setExtrasSaving(false)
  }

  // ─── Extras update helpers ───
  function updateExtraItem(category: ExtraCategory, index: number, updates: Partial<ExtraItem>) {
    setExtrasConfig(prev => {
      const items = [...prev[category]]
      items[index] = { ...items[index], ...updates }
      return { ...prev, [category]: items }
    })
  }

  function addExtraItem(category: ExtraCategory) {
    setExtrasConfig(prev => {
      const items = prev[category]
      const newItem: ExtraItem = {
        id: `new_${category}_${Date.now()}`,
        name: '',
        price: 0,
        price_unit: 'per_day',
        is_active: true,
        display_order: items.length + 1,
      }
      return { ...prev, [category]: [...items, newItem] }
    })
  }

  function removeExtraItem(category: ExtraCategory, index: number) {
    setExtrasConfig(prev => ({
      ...prev,
      [category]: prev[category].filter((_, i) => i !== index),
    }))
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
          setConfig(getDefaultConfig())
          setLoading(false)
          return
        }
        throw error
      }

      setConfig(parseConfigFromDB(data))
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      const message = err instanceof Error ? _errMsg : 'Errore sconosciuto'
      toast.error('Errore caricamento config: ' + message)
    }
    setLoading(false)
  }

  async function saveConfig() {
    // Validate before saving
    const errors = validateConfig(config)
    setValidationErrors(errors)
    if (errors.length > 0) {
      toast.error(`${errors.length} errori di validazione. Correggi prima di salvare.`)
      return
    }

    setSaving(true)
    try {
      const dbPayload = {
        enabled: config.enabled,
        mode: config.mode,
        config: {
          base_prices: config.base_prices,
          min_prices: config.min_prices,
          max_prices: config.max_prices,
          occupation_coefficients: config.occupation_coefficients,
          advance_coefficients: config.advance_coefficients,
          duration_coefficients: config.duration_coefficients,
          season_rules: config.season_rules,
        },
        updated_at: new Date().toISOString()
      }

      const { data: existing } = await supabase.from('revenue_config').select('id').limit(1).single()

      if (existing) {
        const { error } = await supabase
          .from('revenue_config')
          .update(dbPayload)
          .eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('revenue_config')
          .insert(dbPayload)
        if (error) throw error
      }

      toast.success('Configurazione salvata')
      setValidationErrors([])
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      const message = err instanceof Error ? _errMsg : 'Errore sconosciuto'
      toast.error('Errore salvataggio: ' + message)
    }
    setSaving(false)
  }

  // ─── Simulation using the REAL backend endpoint ───
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
      if (!data.enabled) {
        toast('Revenue Management non attivo. Il simulatore mostra una preview locale.')
        // Fallback: local preview using the current UI config
        runLocalPreview()
        return
      }
      setSimResult(data as PricingTrace)
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      const message = err instanceof Error ? _errMsg : 'Errore sconosciuto'
      toast.error('Errore simulazione backend: ' + message + ' — uso preview locale')
      runLocalPreview()
    }
    setSimLoading(false)
  }

  function runLocalPreview() {
    const vehicle = vehicles.find(v => v.id === simVehicleId)
    if (!vehicle) return
    const trace = calculateDynamicPrice(
      { ...config, enabled: true }, // force enabled for preview
      {
        vehicleId: vehicle.id,
        vehicleName: vehicle.display_name,
        vehicleDailyRateCents: vehicle.daily_rate * 100,
        vehicleCategory: vehicle.category || 'urban',
        pickupDate: simPickup,
        dropoffDate: simDropoff,
        occupancyPct: 50, // estimate for local preview
      }
    )
    setSimResult({ ...trace, enabled: true })
    setSimLoading(false)
  }

  // ─── Config update helpers ───
  const updateConfig = useCallback((partial: Partial<RevenueConfig>) => {
    setConfig(prev => ({ ...prev, ...partial }))
  }, [])

  function setBasePrice(key: string, value: string) {
    const next = { ...config.base_prices }
    if (value) next[key] = Number(value); else delete next[key]
    updateConfig({ base_prices: next })
  }

  function setMinPrice(key: string, value: string) {
    const next = { ...config.min_prices }
    if (value) next[key] = Number(value); else delete next[key]
    updateConfig({ min_prices: next })
  }

  function setMaxPrice(key: string, value: string) {
    const next = { ...config.max_prices }
    if (value) next[key] = Number(value); else delete next[key]
    updateConfig({ max_prices: next })
  }

  // ─── Coefficient table renderer ───
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
              onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
              className="text-red-400 hover:text-red-300 text-sm px-2"
            >✕</button>
          </div>
        ))}
        <button
          onClick={() => {
            const newRow: CoefficientRow = { coeff: 1.0, label: '' }
            if (type === 'pct') { newRow.min_pct = 0; newRow.max_pct = 0 }
            else { newRow.min_days = 0; newRow.max_days = 0 }
            setRows([...rows, newRow])
          }}
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
      {/* ═══ CENTRALINA PREZZI & REGOLE ═══ */}
      <CentralinaConfig />

      {/* ═══ REVENUE ENGINE (Dynamic Pricing) ═══ */}
      <div className="border-t-2 border-theme-border pt-6 mt-8">
        <h2 className="text-xl font-bold text-theme-text-primary mb-4">Revenue Engine — Pricing Dinamico</h2>
      </div>

      {/* ─── Header: Enable + Mode + Save ─── */}
      <div className={SECTION}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox" checked={config.enabled} onChange={e => updateConfig({ enabled: e.target.checked })}
                className="w-5 h-5 rounded border-theme-border text-blue-500 focus:ring-blue-500"
              />
              <span className="text-theme-text-primary font-semibold">Revenue Management Attivo</span>
            </label>
            {config.enabled && (
              <span className={`text-xs px-2 py-1 rounded ${
                config.mode === 'auto_apply' ? 'bg-green-500/20 text-green-400' :
                config.mode === 'suggestion' ? 'bg-amber-500/20 text-amber-400' :
                'bg-gray-500/20 text-gray-400'
              }`}>
                {MODE_OPTIONS.find(m => m.value === config.mode)?.label || config.mode}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Select
              label="Modalita'"
              value={config.mode}
              onChange={e => updateConfig({ mode: e.target.value as RevenueMode })}
              options={MODE_OPTIONS.map(m => ({ value: m.value, label: m.label }))}
            />
            <Button onClick={saveConfig} disabled={saving} className="whitespace-nowrap">
              {saving ? 'Salvando...' : 'Salva Configurazione'}
            </Button>
          </div>
        </div>

        {/* Mode explanation */}
        <div className="mt-3 text-xs text-theme-text-muted">
          {config.mode === 'disabled' && 'Il sistema usa solo la tariffa giornaliera base del veicolo. Nessun prezzo dinamico.'}
          {config.mode === 'suggestion' && 'Il sistema calcola un prezzo suggerito, ma l\'operatore deve applicarlo manualmente.'}
          {config.mode === 'auto_apply' && 'Il sistema applica automaticamente il prezzo dinamico nel flusso di prenotazione.'}
        </div>

        {/* Validation errors */}
        {validationErrors.length > 0 && (
          <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 space-y-1">
            <div className="text-sm font-semibold text-red-400">Errori di validazione:</div>
            {validationErrors.map((err, i) => (
              <div key={i} className="text-xs text-red-300">
                <span className="font-mono text-red-400">{err.field}</span>: {err.message}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Prezzi Base (EUR/giorno) ─── */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Prezzi Base (EUR/giorno)</h3>
        <p className="text-sm text-theme-text-muted mb-4">
          Override per veicolo o categoria. Priorita': override veicolo {'>'} override categoria {'>'} tariffa base veicolo.
          <br/>Valori in <strong>EURO</strong> (non centesimi).
        </p>

        <div className="mb-4">
          <h4 className="text-sm font-semibold text-theme-text-secondary mb-2">Per Categoria</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {['exotic', 'urban', 'aziendali'].map(cat => (
              <div key={cat} className="flex items-center gap-2">
                <span className="text-sm text-theme-text-secondary capitalize w-20">{cat}</span>
                <input
                  type="number" step="0.01" placeholder="-- (usa tariffa veicolo)"
                  className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                  value={config.base_prices[`category:${cat}`] ?? ''}
                  onChange={e => setBasePrice(`category:${cat}`, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>

        <h4 className="text-sm font-semibold text-theme-text-secondary mb-2">Per Veicolo</h4>
        <div className="max-h-64 overflow-y-auto space-y-2">
          {vehicles.map(v => (
            <div key={v.id} className="grid grid-cols-[2fr_1fr_1fr] gap-2 items-center">
              <span className="text-sm text-theme-text-primary truncate">{v.display_name}</span>
              <span className="text-xs text-theme-text-muted">Base: EUR {v.daily_rate.toFixed(2)}</span>
              <input
                type="number" step="0.01" placeholder="Override EUR"
                className="px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                value={config.base_prices[v.id] ?? ''}
                onChange={e => setBasePrice(v.id, e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ─── Coefficienti Occupazione ─── */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Coefficienti Occupazione</h3>
        <p className="text-sm text-theme-text-muted mb-2">
          Moltiplicatore basato sulla % di occupazione della flotta per categoria.
          Range [min, max). Per includere 100%, usa max=101.
        </p>
        {renderCoefficientTable(
          config.occupation_coefficients,
          rows => updateConfig({ occupation_coefficients: rows }),
          'pct'
        )}
      </div>

      {/* ─── Coefficienti Anticipo ─── */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Coefficienti Anticipo Prenotazione</h3>
        <p className="text-sm text-theme-text-muted mb-2">
          Moltiplicatore basato su quanti giorni prima viene effettuata la prenotazione.
        </p>
        {renderCoefficientTable(
          config.advance_coefficients,
          rows => updateConfig({ advance_coefficients: rows }),
          'days'
        )}
      </div>

      {/* ─── Coefficienti Durata ─── */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Coefficienti Durata Noleggio</h3>
        <p className="text-sm text-theme-text-muted mb-2">
          Moltiplicatore basato sulla durata del noleggio in giorni.
        </p>
        {renderCoefficientTable(
          config.duration_coefficients,
          rows => updateConfig({ duration_coefficients: rows }),
          'days'
        )}
      </div>

      {/* ─── Regole Stagionali ─── */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Regole Stagionali</h3>
        <div className="space-y-2">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 text-xs font-semibold text-theme-text-muted uppercase">
            <span>Nome</span><span>Inizio (MM-GG)</span><span>Fine (MM-GG)</span><span>Coeff.</span><span>Tipo</span><span></span>
          </div>
          {config.season_rules.map((rule, i) => (
            <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 items-center">
              <input
                type="text" className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                value={rule.name} onChange={e => {
                  const updated = [...config.season_rules]; updated[i] = { ...updated[i], name: e.target.value }
                  updateConfig({ season_rules: updated })
                }}
              />
              <input
                type="text" placeholder="MM-DD" className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                value={rule.start_date} onChange={e => {
                  const updated = [...config.season_rules]; updated[i] = { ...updated[i], start_date: e.target.value }
                  updateConfig({ season_rules: updated })
                }}
              />
              <input
                type="text" placeholder="MM-DD" className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                value={rule.end_date} onChange={e => {
                  const updated = [...config.season_rules]; updated[i] = { ...updated[i], end_date: e.target.value }
                  updateConfig({ season_rules: updated })
                }}
              />
              <input
                type="number" step="0.01" className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                value={rule.coeff} onChange={e => {
                  const updated = [...config.season_rules]; updated[i] = { ...updated[i], coeff: Number(e.target.value) }
                  updateConfig({ season_rules: updated })
                }}
              />
              <select
                className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                value={rule.type} onChange={e => {
                  const updated = [...config.season_rules]; updated[i] = { ...updated[i], type: e.target.value }
                  updateConfig({ season_rules: updated })
                }}
              >
                <option value="bassa">Bassa</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="picco">Picco</option>
              </select>
              <button
                onClick={() => updateConfig({ season_rules: config.season_rules.filter((_, idx) => idx !== i) })}
                className="text-red-400 hover:text-red-300 text-sm px-2"
              >✕</button>
            </div>
          ))}
          <button
            onClick={() => updateConfig({
              season_rules: [...config.season_rules, { name: '', start_date: '', end_date: '', coeff: 1.0, type: 'media' }]
            })}
            className="text-sm text-blue-400 hover:text-blue-300"
          >+ Aggiungi regola stagionale</button>
        </div>
      </div>

      {/* ─── Limiti Prezzo ─── */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Limiti Prezzo (EUR/giorno)</h3>
        <p className="text-sm text-theme-text-muted mb-4">
          Il prezzo dinamico giornaliero non scende sotto il minimo e non supera il massimo.
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
                    value={config.min_prices[`category:${cat}`] ?? ''}
                    onChange={e => setMinPrice(`category:${cat}`, e.target.value)}
                  />
                  <input
                    type="number" step="0.01" placeholder="Max"
                    className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                    value={config.max_prices[`category:${cat}`] ?? ''}
                    onChange={e => setMaxPrice(`category:${cat}`, e.target.value)}
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
                value={config.min_prices[v.id] ?? ''}
                onChange={e => setMinPrice(v.id, e.target.value)}
              />
              <input
                type="number" step="0.01" placeholder="Max"
                className="px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                value={config.max_prices[v.id] ?? ''}
                onChange={e => setMaxPrice(v.id, e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ─── Simulatore + Debug/Preview ─── */}
      <div className={`${SECTION} border-amber-500/30`}>
        <h3 className={SECTION_TITLE}>Simulatore e Debug Prezzo</h3>
        <p className="text-sm text-theme-text-muted mb-4">
          Simula il prezzo dinamico per un veicolo. Usa lo stesso motore del backend.
        </p>
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
          <Input label="Data Ritiro" type="date" value={simPickup} onChange={e => setSimPickup(e.target.value)} />
          <Input label="Data Riconsegna" type="date" value={simDropoff} onChange={e => setSimDropoff(e.target.value)} />
          <div className="flex items-end">
            <Button onClick={runSimulation} disabled={simLoading} className="w-full">
              {simLoading ? 'Calcolo...' : 'Simula Prezzo'}
            </Button>
          </div>
        </div>

        {/* ─── Trace/Audit Result ─── */}
        {simResult && (
          <div className="border border-amber-500/40 bg-amber-500/5 rounded-lg p-4 space-y-4">
            {/* Header with price */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-theme-text-muted">Veicolo: </span>
                <span className="text-theme-text-primary font-medium">{simResult.vehicleName}</span>
                <span className="text-xs text-theme-text-muted ml-2">({simResult.category})</span>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-amber-400">EUR {simResult.finalTotalEur.toFixed(2)}</div>
                <div className="text-xs text-theme-text-muted">
                  EUR {simResult.finalDailyRateEur.toFixed(2)}/giorno x {simResult.rentalDays} giorni
                </div>
              </div>
            </div>

            {/* Audit trace table */}
            <div className="border-t border-theme-border pt-3">
              <h4 className="text-sm font-semibold text-theme-text-secondary mb-2">Trace di Calcolo (Audit)</h4>
              <div className="space-y-1.5 text-sm">
                <TraceRow label="Modalita'" value={MODE_OPTIONS.find(m => m.value === simResult.mode)?.label || simResult.mode} />
                <TraceRow label="Tariffa base veicolo" value={`EUR ${simResult.vehicleBaseRateEur.toFixed(2)}/giorno (da DB, in centesimi: ${Math.round(simResult.vehicleBaseRateEur * 100)})`} />
                <TraceRow label="Override categoria" value={simResult.categoryOverrideEur != null ? `EUR ${simResult.categoryOverrideEur.toFixed(2)}` : '-- (non impostato)'} />
                <TraceRow label="Override veicolo" value={simResult.vehicleOverrideEur != null ? `EUR ${simResult.vehicleOverrideEur.toFixed(2)}` : '-- (non impostato)'} />
                <TraceRow
                  label="Tariffa selezionata"
                  value={`EUR ${simResult.selectedBaseRateEur.toFixed(2)} (${SOURCE_LABELS[simResult.selectedBaseRateSource]})`}
                  highlight
                />

                <div className="border-t border-theme-border my-2" />

                <TraceRow label="Occupazione flotta" value={`${simResult.occupancyPct}%`} />
                {simResult.breakdown.map((item, i) => (
                  <TraceRow
                    key={i}
                    label={item.label}
                    value={`x${item.coeff.toFixed(2)} (${item.description})`}
                    coeffColor={item.coeff > 1 ? 'text-red-400' : item.coeff < 1 ? 'text-green-400' : undefined}
                  />
                ))}

                <div className="border-t border-theme-border my-2" />

                <TraceRow label="Prezzo giornaliero calcolato" value={`EUR ${simResult.rawDailyRate.toFixed(2)}`} />
                {simResult.minPrice != null && <TraceRow label="Prezzo minimo" value={`EUR ${simResult.minPrice.toFixed(2)} ${simResult.minHit ? '(RAGGIUNTO)' : ''}`} />}
                {simResult.maxPrice != null && <TraceRow label="Prezzo massimo" value={`EUR ${simResult.maxPrice.toFixed(2)} ${simResult.maxHit ? '(RAGGIUNTO)' : ''}`} />}
                <TraceRow label="Prezzo giornaliero finale" value={`EUR ${simResult.finalDailyRateEur.toFixed(2)}`} highlight />
                <TraceRow label="Totale" value={`EUR ${simResult.finalTotalEur.toFixed(2)} (${simResult.rentalDays} giorni)`} highlight />
              </div>
            </div>

            {/* Formula display */}
            <div className="border-t border-theme-border pt-3">
              <div className="text-xs font-mono text-theme-text-muted bg-theme-bg-primary p-2 rounded">
                finalDailyRate = {simResult.selectedBaseRateEur.toFixed(2)} x {simResult.occupancyCoefficient.toFixed(2)} x {simResult.advanceCoefficient.toFixed(2)} x {simResult.durationCoefficient.toFixed(2)} x {simResult.seasonalityCoefficient.toFixed(2)} = {simResult.rawDailyRate.toFixed(2)}
                {(simResult.minHit || simResult.maxHit) && ` → clamped to ${simResult.finalDailyRateEur.toFixed(2)}`}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Servizi Extra & Prezzi ─── */}
      <div className={`${SECTION} border-green-500/30`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-theme-text-primary">Servizi Extra & Prezzi</h3>
          <Button onClick={saveExtrasConfig} disabled={extrasSaving} className="whitespace-nowrap">
            {extrasSaving ? 'Salvando...' : 'Salva Extras'}
          </Button>
        </div>
        <p className="text-sm text-theme-text-muted mb-6">
          Gestisci i prezzi dei servizi aggiuntivi. Il sito web legge questi valori in tempo reale.
          <br/>Prezzi in <strong>EURO</strong>. Disattiva un servizio per nasconderlo dal sito.
        </p>

        {(Object.keys(EXTRA_CATEGORY_LABELS) as ExtraCategory[]).map(category => {
          const items = extrasConfig[category]
          const isCollapsed = extrasCollapsed[category]
          return (
            <div key={category} className="mb-4 border border-theme-border rounded-lg overflow-hidden">
              {/* Category header */}
              <button
                onClick={() => setExtrasCollapsed(prev => ({ ...prev, [category]: !prev[category] }))}
                className="w-full flex items-center justify-between px-4 py-3 bg-theme-bg-primary hover:bg-theme-bg-secondary transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={`text-xs transform transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>&#9654;</span>
                  <span className="font-semibold text-theme-text-primary">{EXTRA_CATEGORY_LABELS[category]}</span>
                  <span className="text-xs text-theme-text-muted">({items.length} {items.length === 1 ? 'servizio' : 'servizi'})</span>
                </div>
                <div className="flex items-center gap-2">
                  {items.filter(i => i.is_active).length < items.length && (
                    <span className="text-xs text-amber-400">{items.filter(i => !i.is_active).length} disattivati</span>
                  )}
                </div>
              </button>

              {/* Category items */}
              {!isCollapsed && (
                <div className="px-4 py-3 space-y-2 bg-theme-bg-secondary">
                  {/* Header row */}
                  <div className="grid grid-cols-[auto_2fr_1fr_1fr_1fr_auto_auto] gap-2 text-xs font-semibold text-theme-text-muted uppercase">
                    <span className="w-8">On</span>
                    <span>Nome</span>
                    <span>Prezzo (EUR)</span>
                    <span>Unità</span>
                    <span>Note</span>
                    <span className="w-8"></span>
                    <span className="w-8"></span>
                  </div>

                  {items.map((item, idx) => (
                    <div
                      key={item.id}
                      className={`grid grid-cols-[auto_2fr_1fr_1fr_1fr_auto_auto] gap-2 items-center ${
                        !item.is_active ? 'opacity-50' : ''
                      }`}
                    >
                      {/* Active toggle */}
                      <input
                        type="checkbox"
                        checked={item.is_active}
                        onChange={e => updateExtraItem(category, idx, { is_active: e.target.checked })}
                        className="w-4 h-4 rounded"
                      />
                      {/* Name */}
                      <input
                        type="text"
                        value={item.name}
                        onChange={e => updateExtraItem(category, idx, { name: e.target.value })}
                        className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                        placeholder="Nome servizio"
                      />
                      {/* Price */}
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-theme-text-muted">EUR</span>
                        <input
                          type="number"
                          step="0.01"
                          value={item.price}
                          onChange={e => updateExtraItem(category, idx, { price: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                        />
                      </div>
                      {/* Unit */}
                      <select
                        value={item.price_unit}
                        onChange={e => updateExtraItem(category, idx, { price_unit: e.target.value as ExtraItem['price_unit'] })}
                        className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                      >
                        <option value="per_day">/giorno</option>
                        <option value="per_hour">/ora</option>
                        <option value="per_km">/km</option>
                        <option value="per_unit">/unità</option>
                        <option value="one_time">una tantum</option>
                        <option value="included">incluso</option>
                      </select>
                      {/* Description / notes */}
                      <input
                        type="text"
                        value={item.description || ''}
                        onChange={e => updateExtraItem(category, idx, { description: e.target.value })}
                        className="w-full px-2 py-1.5 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                        placeholder="Descrizione"
                      />
                      {/* Move up */}
                      <button
                        onClick={() => {
                          if (idx === 0) return
                          setExtrasConfig(prev => {
                            const arr = [...prev[category]]
                            ;[arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]
                            return { ...prev, [category]: arr }
                          })
                        }}
                        className="text-theme-text-muted hover:text-theme-text-primary text-sm px-1"
                        title="Sposta su"
                      >{idx > 0 ? '\u2191' : ''}</button>
                      {/* Delete */}
                      <button
                        onClick={() => removeExtraItem(category, idx)}
                        className="text-red-400 hover:text-red-300 text-sm px-1"
                        title="Rimuovi"
                      >\u2715</button>
                    </div>
                  ))}

                  {/* Special fields for insurance items (deposit_required) */}
                  {category === 'insurance' && items.some(i => i.deposit_required != null) && (
                    <div className="mt-2 pt-2 border-t border-theme-border">
                      <p className="text-xs text-theme-text-muted mb-1">Cauzione richiesta per assicurazione (EUR):</p>
                      {items.map((item, idx) => (
                        item.deposit_required != null && (
                          <div key={item.id} className="flex items-center gap-2 mb-1">
                            <span className="text-sm text-theme-text-secondary w-32">{item.name}</span>
                            <input
                              type="number"
                              step="100"
                              value={item.deposit_required}
                              onChange={e => updateExtraItem(category, idx, { deposit_required: Number(e.target.value) })}
                              className="w-32 px-2 py-1 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                            />
                            <span className="text-xs text-theme-text-muted">EUR</span>
                          </div>
                        )
                      ))}
                    </div>
                  )}

                  {/* Special field for per_unit items (unit_label) */}
                  {items.some(i => i.price_unit === 'per_unit') && (
                    <div className="mt-2 pt-2 border-t border-theme-border">
                      <p className="text-xs text-theme-text-muted mb-1">Etichetta unità:</p>
                      {items.map((item, idx) => (
                        item.price_unit === 'per_unit' && (
                          <div key={item.id} className="flex items-center gap-2 mb-1">
                            <span className="text-sm text-theme-text-secondary w-32">{item.name}</span>
                            <input
                              type="text"
                              value={item.unit_label || ''}
                              onChange={e => updateExtraItem(category, idx, { unit_label: e.target.value })}
                              className="w-32 px-2 py-1 rounded border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm"
                              placeholder="es. rosa"
                            />
                          </div>
                        )
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => addExtraItem(category)}
                    className="text-sm text-green-400 hover:text-green-300 mt-2"
                  >+ Aggiungi servizio</button>
                </div>
              )}
            </div>
          )
        })}

        {/* Price summary */}
        <div className="mt-6 bg-theme-bg-primary rounded-lg p-4 border border-theme-border">
          <h4 className="text-sm font-semibold text-theme-text-secondary mb-3">Riepilogo Prezzi Attivi</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {(Object.keys(EXTRA_CATEGORY_LABELS) as ExtraCategory[]).flatMap(cat =>
              extrasConfig[cat]
                .filter(item => item.is_active)
                .map(item => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <span className="text-theme-text-muted truncate">{item.name}</span>
                    <span className="text-theme-text-primary font-mono ml-2">
                      {item.price_unit === 'included'
                        ? 'Incluso'
                        : `EUR ${item.price.toFixed(2)}${PRICE_UNIT_LABELS[item.price_unit] || ''}`
                      }
                    </span>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Helper component ───
function TraceRow({ label, value, highlight, coeffColor }: {
  label: string; value: string; highlight?: boolean; coeffColor?: string
}) {
  return (
    <div className="flex justify-between">
      <span className="text-theme-text-muted">{label}</span>
      <span className={`${highlight ? 'font-semibold text-amber-400' : coeffColor || 'text-theme-text-primary'}`}>
        {value}
      </span>
    </div>
  )
}
