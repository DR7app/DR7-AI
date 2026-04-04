/**
 * Centralina Unica — Main configuration panel
 * Manages ALL rental pricing, rules, and services from one place.
 * Changes here update Supabase and are automatically read by the website.
 *
 * EVERYTHING is editable: category names, insurance option names, deposit labels, etc.
 */
import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import type { RentalConfig, InsuranceOption, ExperienceService, DepositOption } from '../../../types/rentalConfig'
import { DEFAULT_RENTAL_CONFIG } from '../../../hooks/rentalConfigDefaults'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import _Input from './Input'
import Button from './Button'

interface Vehicle {
  id: string
  display_name: string
  category?: string
  status: string
}

const TABS = [
  { id: 'categories', label: 'Categorie' },
  { id: 'insurance', label: 'Assicurazioni' },
  { id: 'km', label: 'KM & Sforo' },
  { id: 'deposits', label: 'Cauzioni' },
  { id: 'services', label: 'Servizi' },
  { id: 'rates', label: 'Tariffe' },
  { id: 'tiers', label: 'Fasce Cliente' },
  { id: 'payments', label: 'Pagamenti' },
  { id: 'preventivi', label: 'Preventivi' },
] as const

type TabId = typeof TABS[number]['id']

const UNIT_LABELS: Record<string, string> = {
  per_day: '/giorno',
  per_hour: '/ora',
  per_item: '/unita',
  flat: 'fisso',
}

/** Read categories dynamically from config */
function getCategories(config: RentalConfig): string[] {
  return Object.keys(config.vehicle_categories || {})
}

function getCategoryLabel(config: RentalConfig, cat: string): string {
  return config.vehicle_categories?.[cat]?.label || cat
}

export default function CentralinaConfig() {
  const [config, setConfig] = useState<RentalConfig>(DEFAULT_RENTAL_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('categories')
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [savedBy, setSavedBy] = useState<string | null>(null)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('rental_extras_config')
        .select('config, updated_at, updated_by')
        .limit(1)
        .single()

      if (!error && data?.config) {
        setConfig({ ...DEFAULT_RENTAL_CONFIG, ...data.config } as RentalConfig)
        setLastSaved(data.updated_at)
        setSavedBy(data.updated_by)
      }
    } catch (err) {
      console.error('Load config error:', err)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  useEffect(() => {
    supabase
      .from('vehicles')
      .select('id, display_name, category, status')
      .neq('status', 'retired')
      .order('display_name')
      .then(({ data }) => setVehicles(data || []))
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      const { data: user } = await supabase.auth.getUser()
      const email = user?.user?.email || 'admin'

      const { error } = await supabase
        .from('rental_extras_config')
        .update({
          config,
          updated_at: new Date().toISOString(),
          updated_by: email,
        })
        .not('id', 'is', null)

      if (error) throw error

      // Audit log
      await supabase.from('config_audit_log').insert({
        changed_by: email,
        section: activeTab,
        changes: { tab: activeTab },
        full_snapshot: config,
      })

      setLastSaved(new Date().toISOString())
      setSavedBy(email)
      toast.success('Configurazione salvata — il sito si aggiornera entro 30 secondi')
    } catch (err) {
      toast.error('Errore salvataggio: ' + (err instanceof Error ? err.message : 'Errore'))
    }
    setSaving(false)
  }

  // Helper to update nested config
  function updateConfig(path: string[], value: unknown) {
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      let obj = next
      for (let i = 0; i < path.length - 1; i++) {
        if (!obj[path[i]]) obj[path[i]] = {}
        obj = obj[path[i]]
      }
      obj[path[path.length - 1]] = value
      return next
    })
  }

  if (loading) {
    return <div className="text-center py-12 text-theme-text-muted">Caricamento centralina...</div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-theme-text-primary">Centralina Prezzi & Regole</h2>
          <p className="text-sm text-theme-text-muted mt-1">
            Ogni modifica si riflette automaticamente sul sito entro 30 secondi.
            {lastSaved && (
              <span className="ml-2 text-theme-text-secondary">
                Ultimo salvataggio: {new Date(lastSaved).toLocaleString('it-IT')}
                {savedBy && ` da ${savedBy}`}
              </span>
            )}
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="bg-green-600 hover:bg-green-700 text-white px-6">
          {saving ? 'Salvataggio...' : 'Salva Configurazione'}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-theme-border pb-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === tab.id
                ? 'bg-dr7-gold text-white'
                : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-tertiary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-6">
        {activeTab === 'categories' && <CategoriesTab config={config} setConfig={setConfig} />}
        {activeTab === 'insurance' && <InsuranceTab config={config} updateConfig={updateConfig} />}
        {activeTab === 'km' && <KmSforoTab config={config} updateConfig={updateConfig} vehicles={vehicles} />}
        {activeTab === 'deposits' && <DepositsTab config={config} updateConfig={updateConfig} setConfig={setConfig} />}
        {activeTab === 'services' && <ServicesTab config={config} setConfig={setConfig} updateConfig={updateConfig} />}
        {activeTab === 'rates' && <RatesTab config={config} updateConfig={updateConfig} setConfig={setConfig} />}
        {activeTab === 'tiers' && <TiersTab config={config} updateConfig={updateConfig} />}
        {activeTab === 'payments' && <PaymentsTab config={config} setConfig={setConfig} updateConfig={updateConfig} />}
        {activeTab === 'preventivi' && <PreventiviTab config={config} updateConfig={updateConfig} />}
      </div>

      {/* Bottom Save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="bg-green-600 hover:bg-green-700 text-white px-6">
          {saving ? 'Salvataggio...' : 'Salva Configurazione'}
        </Button>
      </div>

      {/* Audit Log */}
      <AuditLogSection />
    </div>
  )
}

// ═══════════════════════════════════════════════════
// SHARED: Editable inline text
// ═══════════════════════════════════════════════════
function InlineEdit({ value, onChange, className = '', placeholder = '' }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary ${className}`}
    />
  )
}

function NumInput({ value, onChange, step, className = '' }: { value: number; onChange: (v: number) => void; step?: string; className?: string }) {
  return (
    <input
      type="number"
      step={step || '1'}
      value={value}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className={`w-20 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary ${className}`}
    />
  )
}

// ═══════════════════════════════════════════════════
// TAB 0: CATEGORIE VEICOLI
// ═══════════════════════════════════════════════════
function CategoriesTab({ config, setConfig }: { config: RentalConfig; setConfig: (c: RentalConfig) => void }) {
  const categories = getCategories(config)
  const [newCatKey, setNewCatKey] = useState('')
  const [newCatLabel, setNewCatLabel] = useState('')

  function addCategory() {
    const key = newCatKey.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    if (!key || config.vehicle_categories?.[key]) {
      toast.error('Chiave categoria non valida o gia esistente')
      return
    }
    const label = newCatLabel.trim() || key
    const next = JSON.parse(JSON.stringify(config)) as RentalConfig
    next.vehicle_categories[key] = { label }
    // Initialize empty sections for the new category
    if (!next.insurance[key]) next.insurance[key] = { _all_tiers: [] }
    if (!next.km_included[key]) next.km_included[key] = { table: { '1': 100, '2': 180, '3': 240, '4': 280, '5': 300 }, extra_per_day: 60 }
    if (!next.sforo_km.category[key]) next.sforo_km.category[key] = next.sforo_km._global
    if (!next.unlimited_km[key]) next.unlimited_km[key] = { _all_tiers: { per_day: 30, flat: 0 } }
    if (!next.rental_day_rates[key]) next.rental_day_rates[key] = { flat: { '1': 100, '2': 180, '3': 250, '7': 500, '30': 1500 }, extrapolation: 'day7_average' }
    if (!next.deposits.category_defaults[key]) next.deposits.category_defaults[key] = 2000
    setConfig(next)
    setNewCatKey('')
    setNewCatLabel('')
    toast.success(`Categoria "${label}" aggiunta`)
  }

  function removeCategory(key: string) {
    if (!window.confirm(`Rimuovere la categoria "${getCategoryLabel(config, key)}"? Le configurazioni associate verranno eliminate.`)) return
    const next = JSON.parse(JSON.stringify(config)) as RentalConfig
    delete next.vehicle_categories[key]
    delete next.insurance[key]
    delete next.km_included[key]
    delete next.sforo_km.category[key]
    delete next.unlimited_km[key]
    delete next.rental_day_rates[key]
    delete next.deposits.category_defaults[key]
    if (next.insurance.deductibles) delete next.insurance.deductibles[key]
    setConfig(next)
    toast.success('Categoria rimossa')
  }

  function renameCategory(key: string, newLabel: string) {
    const next = JSON.parse(JSON.stringify(config)) as RentalConfig
    next.vehicle_categories[key] = { label: newLabel }
    setConfig(next)
  }

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-theme-text-primary">Categorie Veicoli</h3>
      <p className="text-sm text-theme-text-muted">Modifica il nome visualizzato di ogni categoria, oppure aggiungi/rimuovi categorie. La chiave interna (usata nel database) non cambia.</p>

      <div className="space-y-3">
        {categories.map(cat => (
          <div key={cat} className="flex items-center gap-3 p-3 border border-theme-border rounded-lg">
            <span className="text-xs text-theme-text-muted font-mono w-28 shrink-0">{cat}</span>
            <InlineEdit
              value={getCategoryLabel(config, cat)}
              onChange={v => renameCategory(cat, v)}
              className="flex-1 font-medium"
              placeholder="Nome categoria"
            />
            <span className="text-xs text-theme-text-muted">
              {(config.insurance?.[cat] as Record<string, unknown>)?.TIER_1 || (config.insurance?.[cat] as Record<string, unknown>)?.TIER_2 || (config.insurance?.[cat] as Record<string, unknown>)?._all_tiers ? 'assicurazioni' : 'no assicurazioni'}
            </span>
            <button
              onClick={() => removeCategory(cat)}
              className="text-red-400 hover:text-red-300 text-xs px-2 py-1 border border-red-500/30 rounded"
            >
              Rimuovi
            </button>
          </div>
        ))}
      </div>

      {/* Add new category */}
      <div className="border border-dashed border-theme-border rounded-lg p-4">
        <h4 className="text-sm font-medium text-theme-text-secondary mb-3">Aggiungi Categoria</h4>
        <div className="flex items-center gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-theme-text-muted">Chiave (inglese, senza spazi)</span>
            <input
              type="text"
              value={newCatKey}
              onChange={e => setNewCatKey(e.target.value)}
              placeholder="es. suv, berlina, moto"
              className="px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary w-48"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-theme-text-muted">Nome visualizzato</span>
            <input
              type="text"
              value={newCatLabel}
              onChange={e => setNewCatLabel(e.target.value)}
              placeholder="es. SUV / Crossover"
              className="px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary w-48"
            />
          </div>
          <button
            onClick={addCategory}
            disabled={!newCatKey.trim()}
            className="mt-4 px-4 py-1.5 text-sm bg-dr7-gold text-white rounded hover:bg-dr7-gold/80 disabled:opacity-40"
          >
            Aggiungi
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// TAB 1: ASSICURAZIONI
// ═══════════════════════════════════════════════════
function InsuranceTab({ config, updateConfig }: { config: RentalConfig; updateConfig: (p: string[], v: unknown) => void }) {
  const categories = getCategories(config)

  function addInsuranceOption(cat: string, tier: string) {
    const existing = ((config.insurance?.[cat] as Record<string, InsuranceOption[]>)?.[tier] || [])
    const newOpt: InsuranceOption = {
      id: `ins_${Date.now()}`,
      name: 'Nuova Assicurazione',
      daily_price: 0,
    }
    updateConfig(['insurance', cat, tier], [...existing, newOpt])
  }

  function removeInsuranceOption(cat: string, tier: string, idx: number) {
    const existing = [...((config.insurance?.[cat] as Record<string, InsuranceOption[]>)?.[tier] || [])]
    existing.splice(idx, 1)
    updateConfig(['insurance', cat, tier], existing)
  }

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-theme-text-primary">Prezzi Assicurazioni per Categoria e Fascia</h3>

      {categories.map(cat => {
        const catConfig = config.insurance?.[cat]
        if (!catConfig) return null

        const hasTiers = !!(catConfig as Record<string, unknown>).TIER_1 || !!(catConfig as Record<string, unknown>).TIER_2
        const allTiers = (catConfig as Record<string, InsuranceOption[]>)._all_tiers

        return (
          <div key={cat} className="border border-theme-border rounded-lg p-4">
            <h4 className="font-medium text-theme-text-primary mb-3">{getCategoryLabel(config, cat)}</h4>

            {/* Toggle between tier mode and all_tiers mode */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-theme-text-muted">Modalita:</span>
              <select
                value={hasTiers ? 'tiers' : 'all'}
                onChange={e => {
                  const mode = e.target.value
                  if (mode === 'tiers' && !hasTiers) {
                    // Convert _all_tiers to TIER_1 + TIER_2
                    const opts = allTiers || []
                    updateConfig(['insurance', cat], { TIER_1: JSON.parse(JSON.stringify(opts)), TIER_2: JSON.parse(JSON.stringify(opts)) })
                  } else if (mode === 'all' && hasTiers) {
                    const opts = (catConfig as Record<string, InsuranceOption[]>).TIER_2 || (catConfig as Record<string, InsuranceOption[]>).TIER_1 || []
                    updateConfig(['insurance', cat], { _all_tiers: JSON.parse(JSON.stringify(opts)) })
                  }
                }}
                className="text-xs px-2 py-1 bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              >
                <option value="tiers">Per fascia (A/B separate)</option>
                <option value="all">Uguale per tutte le fasce</option>
              </select>
            </div>

            {hasTiers ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {['TIER_1', 'TIER_2'].map(tier => {
                  const options = (catConfig as Record<string, InsuranceOption[]>)[tier] || []
                  return (
                    <div key={tier} className="space-y-2">
                      <p className="text-sm font-medium text-theme-text-secondary">
                        {tier === 'TIER_1' ? 'Fascia B (giovane)' : 'Fascia A (esperto)'}
                      </p>
                      {options.map((opt, idx) => (
                        <div key={opt.id} className="flex items-center gap-2 flex-wrap">
                          <InlineEdit
                            value={opt.name}
                            onChange={v => {
                              const newOpts = [...options]
                              newOpts[idx] = { ...opt, name: v }
                              updateConfig(['insurance', cat, tier], newOpts)
                            }}
                            className="w-44"
                            placeholder="Nome opzione"
                          />
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-theme-text-muted">€</span>
                            <NumInput
                              value={opt.daily_price}
                              step="0.01"
                              onChange={v => {
                                const newOpts = [...options]
                                newOpts[idx] = { ...opt, daily_price: v }
                                updateConfig(['insurance', cat, tier], newOpts)
                              }}
                            />
                            <span className="text-xs text-theme-text-muted">/g</span>
                          </div>
                          {opt.mandatory_deposit != null && (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-amber-400">Cauz.€</span>
                              <NumInput
                                value={opt.mandatory_deposit}
                                onChange={v => {
                                  const newOpts = [...options]
                                  newOpts[idx] = { ...opt, mandatory_deposit: v }
                                  updateConfig(['insurance', cat, tier], newOpts)
                                }}
                              />
                            </div>
                          )}
                          <button onClick={() => removeInsuranceOption(cat, tier, idx)} className="text-red-400 text-xs hover:text-red-300">✕</button>
                        </div>
                      ))}
                      <button
                        onClick={() => addInsuranceOption(cat, tier)}
                        className="text-xs text-dr7-gold hover:text-dr7-gold/80 mt-1"
                      >
                        + Aggiungi opzione
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : allTiers ? (
              <div className="space-y-2">
                <p className="text-sm text-theme-text-muted">Stesse opzioni per tutte le fasce</p>
                {allTiers.map((opt, idx) => (
                  <div key={opt.id} className="flex items-center gap-2">
                    <InlineEdit
                      value={opt.name}
                      onChange={v => {
                        const newOpts = [...allTiers]
                        newOpts[idx] = { ...opt, name: v }
                        updateConfig(['insurance', cat, '_all_tiers'], newOpts)
                      }}
                      className="w-44"
                      placeholder="Nome opzione"
                    />
                    <span className="text-xs text-theme-text-muted">€</span>
                    <NumInput
                      value={opt.daily_price}
                      step="0.01"
                      onChange={v => {
                        const newOpts = [...allTiers]
                        newOpts[idx] = { ...opt, daily_price: v }
                        updateConfig(['insurance', cat, '_all_tiers'], newOpts)
                      }}
                    />
                    <span className="text-xs text-theme-text-muted">/g</span>
                    <button onClick={() => removeInsuranceOption(cat, '_all_tiers', idx)} className="text-red-400 text-xs hover:text-red-300">✕</button>
                  </div>
                ))}
                <button
                  onClick={() => addInsuranceOption(cat, '_all_tiers')}
                  className="text-xs text-dr7-gold hover:text-dr7-gold/80 mt-1"
                >
                  + Aggiungi opzione
                </button>
              </div>
            ) : (
              <div className="text-sm text-theme-text-muted">
                Nessuna assicurazione configurata.{' '}
                <button onClick={() => updateConfig(['insurance', cat], { _all_tiers: [] })} className="text-dr7-gold hover:underline">Configura</button>
              </div>
            )}
          </div>
        )
      })}

      {/* Deductibles */}
      <div className="border border-theme-border rounded-lg p-4">
        <h4 className="font-medium text-theme-text-primary mb-3">Franchigie</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Object.entries(config.insurance?.deductibles || {}).map(([cat, ded]) => {
            if (typeof ded !== 'object' || !('fixed' in ded)) return null
            return (
              <div key={cat} className="space-y-2">
                <p className="text-sm font-medium text-theme-text-secondary">{getCategoryLabel(config, cat)}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-theme-text-muted">Fisso €</span>
                  <NumInput value={ded.fixed} onChange={v => updateConfig(['insurance', 'deductibles', cat, 'fixed'], v)} />
                  <span className="text-xs text-theme-text-muted">+ %</span>
                  <NumInput value={ded.percent} onChange={v => updateConfig(['insurance', 'deductibles', cat, 'percent'], v)} className="w-16" />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// TAB 2: KM & SFORO
// ═══════════════════════════════════════════════════
function KmSforoTab({ config, updateConfig, vehicles }: { config: RentalConfig; updateConfig: (p: string[], v: unknown) => void; vehicles: Vehicle[] }) {
  const categories = getCategories(config)
  const globalKm = config.km_included?._global
  const [newVehicleId, setNewVehicleId] = useState('')

  return (
    <div className="space-y-6">
      {/* KM Included Table */}
      <div className="border border-theme-border rounded-lg p-4">
        <h4 className="font-medium text-theme-text-primary mb-3">KM Inclusi per Durata Noleggio (Default)</h4>
        <p className="text-xs text-theme-text-muted mb-3">Oltre il giorno 5: ultimo valore + extra/giorno</p>
        <div className="flex flex-wrap gap-3">
          {globalKm && Object.entries(globalKm.table || {}).map(([day, km]) => (
            <div key={day} className="text-center">
              <p className="text-xs text-theme-text-muted mb-1">Giorno {day}</p>
              <NumInput
                value={km}
                onChange={v => {
                  const newTable = { ...globalKm.table, [day]: v }
                  updateConfig(['km_included', '_global', 'table'], newTable)
                }}
                className="w-20 text-center"
              />
              <p className="text-xs text-theme-text-muted mt-1">km</p>
            </div>
          ))}
          <div className="text-center">
            <p className="text-xs text-theme-text-muted mb-1">Extra/g</p>
            <NumInput
              value={globalKm?.extra_per_day || 0}
              onChange={v => updateConfig(['km_included', '_global', 'extra_per_day'], v)}
              className="w-20 text-center"
            />
            <p className="text-xs text-theme-text-muted mt-1">km/g</p>
          </div>
        </div>
        <p className="text-xs text-green-400 mt-2">
          Esempio: 10 giorni = {globalKm ? (globalKm.table?.['5'] || 300) + ((10 - 5) * (globalKm.extra_per_day || 60)) : 600} km
        </p>
      </div>

      {/* Category-specific KM overrides */}
      <div className="border border-theme-border rounded-lg p-4">
        <h4 className="font-medium text-theme-text-primary mb-3">Override KM per Categoria</h4>
        {categories.map(cat => {
          const catKm = config.km_included?.[cat]
          if (!catKm || cat === '_global') return null
          const isUnlimited = catKm && 'unlimited' in catKm && catKm.unlimited
          if (isUnlimited) {
            return (
              <div key={cat} className="flex items-center gap-2 mb-2">
                <span className="text-sm text-theme-text-primary w-32">{getCategoryLabel(config, cat)}</span>
                <span className="text-xs text-green-400">KM Illimitati</span>
              </div>
            )
          }
          if (!('table' in catKm)) return null
          return (
            <div key={cat} className="mb-3">
              <p className="text-sm font-medium text-theme-text-secondary mb-2">{getCategoryLabel(config, cat)}</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(catKm.table || {}).map(([day, km]) => (
                  <div key={day} className="text-center">
                    <p className="text-xs text-theme-text-muted">{day}g</p>
                    <NumInput
                      value={km as number}
                      onChange={v => updateConfig(['km_included', cat, 'table', day], v)}
                      className="w-16 text-center"
                    />
                  </div>
                ))}
                <div className="text-center">
                  <p className="text-xs text-theme-text-muted">+/g</p>
                  <NumInput
                    value={(catKm as { extra_per_day: number }).extra_per_day || 0}
                    onChange={v => updateConfig(['km_included', cat, 'extra_per_day'], v)}
                    className="w-16 text-center"
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Sforo KM */}
      <div className="border border-theme-border rounded-lg p-4">
        <h4 className="font-medium text-theme-text-primary mb-3">Sforo KM (costo per km extra)</h4>
        <p className="text-xs text-theme-text-muted mb-3">Priorita: Veicolo specifico {'>'} Categoria {'>'} Default globale</p>

        <div className="space-y-4">
          {/* Global default */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-theme-text-primary w-40">Default globale</span>
            <span className="text-xs text-theme-text-muted">€</span>
            <NumInput value={config.sforo_km?._global || 0} step="0.01" onChange={v => updateConfig(['sforo_km', '_global'], v)} />
            <span className="text-xs text-theme-text-muted">/km</span>
          </div>

          {/* Per category */}
          <div>
            <p className="text-sm font-medium text-theme-text-secondary mb-2">Per categoria:</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {categories.map(cat => (
                <div key={cat} className="flex items-center gap-2">
                  <span className="text-sm text-theme-text-primary">{getCategoryLabel(config, cat)}</span>
                  <NumInput
                    value={config.sforo_km?.category?.[cat] ?? 0}
                    step="0.01"
                    onChange={v => updateConfig(['sforo_km', 'category', cat], v)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Per vehicle overrides */}
          <div>
            <p className="text-sm font-medium text-theme-text-secondary mb-2">Override per veicolo:</p>
            {Object.entries(config.sforo_km?.vehicle_overrides || {}).map(([vId, price]) => {
              const veh = vehicles.find(v => v.id === vId)
              return (
                <div key={vId} className="flex items-center gap-2 mb-1">
                  <span className="text-sm text-theme-text-primary w-48">{veh?.display_name || vId}</span>
                  <NumInput value={price} step="0.01" onChange={v => updateConfig(['sforo_km', 'vehicle_overrides', vId], v)} />
                  <button
                    type="button"
                    onClick={() => {
                      const overrides = { ...config.sforo_km.vehicle_overrides }
                      delete overrides[vId]
                      updateConfig(['sforo_km', 'vehicle_overrides'], overrides)
                    }}
                    className="text-red-400 text-xs hover:text-red-300"
                  >
                    Rimuovi
                  </button>
                </div>
              )
            })}
            <div className="flex items-center gap-2 mt-2">
              <select
                value={newVehicleId}
                onChange={e => setNewVehicleId(e.target.value)}
                className="px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              >
                <option value="">Aggiungi veicolo...</option>
                {vehicles
                  .filter(v => !config.sforo_km?.vehicle_overrides?.[v.id])
                  .map(v => <option key={v.id} value={v.id}>{v.display_name}</option>)
                }
              </select>
              {newVehicleId && (
                <button
                  type="button"
                  onClick={() => {
                    updateConfig(['sforo_km', 'vehicle_overrides', newVehicleId], config.sforo_km._global)
                    setNewVehicleId('')
                  }}
                  className="px-3 py-1 text-sm bg-dr7-gold text-white rounded hover:bg-dr7-gold/80"
                >
                  Aggiungi
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Unlimited KM pricing */}
      <div className="border border-theme-border rounded-lg p-4">
        <h4 className="font-medium text-theme-text-primary mb-3">KM Illimitati — Prezzo per Fascia</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {categories.filter(c => {
            const catKm = config.km_included?.[c]
            return !(catKm && 'unlimited' in catKm && catKm.unlimited)
          }).map(cat => {
            const catUk = config.unlimited_km?.[cat]
            if (!catUk) return null
            const hasTiers = !!(catUk.TIER_1 || catUk.TIER_2)
            return (
              <div key={cat} className="space-y-2">
                <p className="text-sm font-medium text-theme-text-secondary">{getCategoryLabel(config, cat)}</p>
                {hasTiers ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-theme-text-muted w-20">Fascia B</span>
                      <span className="text-xs">€</span>
                      <NumInput value={catUk.TIER_1?.per_day ?? 0} onChange={v => updateConfig(['unlimited_km', cat, 'TIER_1', 'per_day'], v)} />
                      <span className="text-xs text-theme-text-muted">/g</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-theme-text-muted w-20">Fascia A</span>
                      <span className="text-xs">€</span>
                      <NumInput value={catUk.TIER_2?.per_day ?? 0} onChange={v => updateConfig(['unlimited_km', cat, 'TIER_2', 'per_day'], v)} />
                      <span className="text-xs text-theme-text-muted">/g</span>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs">€</span>
                    <NumInput value={catUk._all_tiers?.flat ?? catUk._all_tiers?.per_day ?? 0} onChange={v => updateConfig(['unlimited_km', cat, '_all_tiers', 'flat'], v)} />
                    <span className="text-xs text-theme-text-muted">fisso</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// TAB 3: CAUZIONI
// ═══════════════════════════════════════════════════
function DepositsTab({ config, updateConfig, setConfig }: { config: RentalConfig; updateConfig: (p: string[], v: unknown) => void; setConfig: (c: RentalConfig) => void }) {
  const categories = getCategories(config)
  const depositKeys = ['TIER_1_RESIDENT', 'TIER_2_RESIDENT', 'TIER_1_NON_RESIDENT', 'TIER_2_NON_RESIDENT'] as const
  const keyLabels: Record<string, string> = {
    TIER_1_RESIDENT: 'Fascia B — Residente',
    TIER_2_RESIDENT: 'Fascia A — Residente',
    TIER_1_NON_RESIDENT: 'Fascia B — Non Residente',
    TIER_2_NON_RESIDENT: 'Fascia A — Non Residente',
  }

  function addDepositOption(key: string) {
    const existing = config.deposits?.[key as keyof typeof config.deposits] as DepositOption[] || []
    const newOpt: DepositOption = { id: `dep_${Date.now()}`, label: 'Nuova opzione', amount: 0 }
    updateConfig(['deposits', key], [...existing, newOpt])
  }

  function removeDepositOption(key: string, idx: number) {
    const existing = [...(config.deposits?.[key as keyof typeof config.deposits] as DepositOption[] || [])]
    existing.splice(idx, 1)
    updateConfig(['deposits', key], existing)
  }

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-theme-text-primary">Opzioni Cauzione per Fascia</h3>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {depositKeys.map(key => {
          const options = (config.deposits?.[key] || []) as DepositOption[]
          return (
            <div key={key} className="border border-theme-border rounded-lg p-4">
              <h4 className="text-sm font-medium text-theme-text-secondary mb-3">{keyLabels[key]}</h4>
              {options.map((opt, idx) => (
                <div key={opt.id} className="flex items-center gap-2 mb-2 flex-wrap">
                  <InlineEdit
                    value={opt.label}
                    onChange={v => {
                      const newOpts = [...options]
                      newOpts[idx] = { ...opt, label: v }
                      updateConfig(['deposits', key], newOpts)
                    }}
                    className="w-40"
                    placeholder="Nome opzione"
                  />
                  <span className="text-xs text-theme-text-muted">€</span>
                  <NumInput
                    value={opt.amount}
                    onChange={v => {
                      const newOpts = [...options]
                      newOpts[idx] = { ...opt, amount: v }
                      updateConfig(['deposits', key], newOpts)
                    }}
                  />
                  {opt.surcharge_per_day != null && opt.surcharge_per_day > 0 && (
                    <>
                      <span className="text-xs text-amber-400">+€</span>
                      <NumInput
                        value={opt.surcharge_per_day}
                        onChange={v => {
                          const newOpts = [...options]
                          newOpts[idx] = { ...opt, surcharge_per_day: v }
                          updateConfig(['deposits', key], newOpts)
                        }}
                        className="w-16"
                      />
                      <span className="text-xs text-theme-text-muted">/g</span>
                    </>
                  )}
                  <button onClick={() => removeDepositOption(key, idx)} className="text-red-400 text-xs hover:text-red-300">✕</button>
                </div>
              ))}
              <button
                onClick={() => addDepositOption(key)}
                className="text-xs text-dr7-gold hover:text-dr7-gold/80 mt-1"
              >
                + Aggiungi opzione
              </button>
            </div>
          )
        })}
      </div>

      {/* Category defaults */}
      <div className="border border-theme-border rounded-lg p-4">
        <h4 className="font-medium text-theme-text-primary mb-3">Cauzione Default per Categoria</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {categories.map(cat => (
            <div key={cat} className="flex items-center gap-2">
              <span className="text-sm text-theme-text-primary">{getCategoryLabel(config, cat)}</span>
              <span className="text-xs">€</span>
              <NumInput
                value={config.deposits?.category_defaults?.[cat] ?? 0}
                onChange={v => updateConfig(['deposits', 'category_defaults', cat], v)}
                className="w-24"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// TAB 4: SERVIZI
// ═══════════════════════════════════════════════════
function ServicesTab({ config, setConfig, updateConfig }: { config: RentalConfig; setConfig: (c: RentalConfig) => void; updateConfig: (p: string[], v: unknown) => void }) {
  function addExperienceService() {
    const next = JSON.parse(JSON.stringify(config)) as RentalConfig
    next.experience_services.push({
      id: `exp_${Date.now()}`,
      name: 'Nuovo Servizio',
      price: 0,
      unit: 'per_day',
      is_active: true,
      tier_only: null,
    })
    setConfig(next)
  }

  function removeExperienceService(idx: number) {
    const svcs = [...config.experience_services]
    svcs.splice(idx, 1)
    updateConfig(['experience_services'], svcs)
  }

  return (
    <div className="space-y-6">
      {/* Experience Services */}
      <div className="border border-theme-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-medium text-theme-text-primary">Servizi Experience</h4>
          <button onClick={addExperienceService} className="text-xs text-dr7-gold hover:text-dr7-gold/80">+ Aggiungi servizio</button>
        </div>
        <div className="space-y-2">
          {(config.experience_services || []).map((svc, idx) => (
            <div key={svc.id} className="flex items-center gap-3 p-2 rounded-md border border-theme-border/50 flex-wrap">
              <input
                type="checkbox"
                checked={svc.is_active}
                onChange={e => {
                  const svcs = [...config.experience_services]
                  svcs[idx] = { ...svc, is_active: e.target.checked }
                  updateConfig(['experience_services'], svcs)
                }}
                className="w-4 h-4"
              />
              <InlineEdit
                value={svc.name}
                onChange={v => {
                  const svcs = [...config.experience_services]
                  svcs[idx] = { ...svc, name: v }
                  updateConfig(['experience_services'], svcs)
                }}
                className="w-56"
                placeholder="Nome servizio"
              />
              <span className="text-xs text-theme-text-muted">€</span>
              <NumInput
                value={svc.price}
                step="0.01"
                onChange={v => {
                  const svcs = [...config.experience_services]
                  svcs[idx] = { ...svc, price: v }
                  updateConfig(['experience_services'], svcs)
                }}
              />
              <select
                value={svc.unit}
                onChange={e => {
                  const svcs = [...config.experience_services]
                  svcs[idx] = { ...svc, unit: e.target.value as ExperienceService['unit'] }
                  updateConfig(['experience_services'], svcs)
                }}
                className="px-2 py-1 text-xs bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              >
                {Object.entries(UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select
                value={svc.tier_only || ''}
                onChange={e => {
                  const svcs = [...config.experience_services]
                  svcs[idx] = { ...svc, tier_only: e.target.value || null }
                  updateConfig(['experience_services'], svcs)
                }}
                className="px-2 py-1 text-xs bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              >
                <option value="">Tutte le fasce</option>
                <option value="TIER_1">Solo Fascia B</option>
                <option value="TIER_2">Solo Fascia A</option>
              </select>
              <button onClick={() => removeExperienceService(idx)} className="text-red-400 text-xs hover:text-red-300">✕</button>
            </div>
          ))}
        </div>
      </div>

      {/* DR7 Flex */}
      <div className="border border-theme-border rounded-lg p-4">
        <h4 className="font-medium text-theme-text-primary mb-3">DR7 FLEX — Cancellazione Premium</h4>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-theme-text-secondary">Prezzo:</span>
            <span className="text-xs">€</span>
            <NumInput value={config.dr7_flex?.daily_price ?? 19.90} step="0.01" onChange={v => updateConfig(['dr7_flex', 'daily_price'], v)} />
            <span className="text-xs text-theme-text-muted">/giorno</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-theme-text-secondary">Rimborso:</span>
            <NumInput value={config.dr7_flex?.refund_percent ?? 90} onChange={v => updateConfig(['dr7_flex', 'refund_percent'], v)} className="w-16" />
            <span className="text-xs text-theme-text-muted">%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-theme-text-secondary">Disponibile per:</span>
            <select
              value={config.dr7_flex?.tier_restriction || ''}
              onChange={e => updateConfig(['dr7_flex', 'tier_restriction'], e.target.value)}
              className="px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
            >
              <option value="">Tutte le fasce</option>
              <option value="TIER_1">Solo Fascia B</option>
              <option value="TIER_2">Solo Fascia A</option>
            </select>
          </div>
        </div>
        <div className="mt-2">
          <span className="text-sm text-theme-text-secondary">Descrizione:</span>
          <InlineEdit
            value={config.dr7_flex?.description ?? ''}
            onChange={v => updateConfig(['dr7_flex', 'description'], v)}
            className="w-full mt-1"
            placeholder="Descrizione DR7 Flex"
          />
        </div>
      </div>

      {/* Simple services */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="border border-theme-border rounded-lg p-4">
          <h4 className="font-medium text-theme-text-primary mb-2">Pulizia Finale</h4>
          <div className="flex items-center gap-2">
            <span className="text-xs">€</span>
            <NumInput value={config.lavaggio?.fee ?? 9.90} step="0.01" onChange={v => updateConfig(['lavaggio', 'fee'], v)} />
            <label className="flex items-center gap-1 text-xs text-theme-text-muted">
              <input
                type="checkbox"
                checked={config.lavaggio?.mandatory ?? true}
                onChange={e => updateConfig(['lavaggio', 'mandatory'], e.target.checked)}
                className="w-3.5 h-3.5"
              />
              Obbligatoria
            </label>
          </div>
        </div>

        <div className="border border-theme-border rounded-lg p-4">
          <h4 className="font-medium text-theme-text-primary mb-2">Consegna a Domicilio</h4>
          <div className="flex items-center gap-2">
            <span className="text-xs">€</span>
            <NumInput value={config.delivery?.price_per_km ?? 3} step="0.01" onChange={v => updateConfig(['delivery', 'price_per_km'], v)} />
            <span className="text-xs text-theme-text-muted">/km</span>
          </div>
        </div>

        <div className="border border-theme-border rounded-lg p-4">
          <h4 className="font-medium text-theme-text-primary mb-2">Secondo Guidatore</h4>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-theme-text-muted w-16">Fascia A</span>
              <span className="text-xs">€</span>
              <NumInput value={config.second_driver?.TIER_2 ?? 10} onChange={v => updateConfig(['second_driver', 'TIER_2'], v)} className="w-16" />
              <span className="text-xs text-theme-text-muted">/g</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-theme-text-muted w-16">Fascia B</span>
              <span className="text-xs">€</span>
              <NumInput value={config.second_driver?.TIER_1 ?? 20} onChange={v => updateConfig(['second_driver', 'TIER_1'], v)} className="w-16" />
              <span className="text-xs text-theme-text-muted">/g</span>
            </div>
          </div>
        </div>

        <div className="border border-theme-border rounded-lg p-4">
          <h4 className="font-medium text-theme-text-primary mb-2">No Cauzione</h4>
          <div className="flex items-center gap-2">
            <span className="text-xs">€</span>
            <NumInput value={config.no_cauzione_surcharge?.per_day ?? 49} onChange={v => updateConfig(['no_cauzione_surcharge', 'per_day'], v)} className="w-16" />
            <span className="text-xs text-theme-text-muted">/g</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-theme-text-muted">Restrizione:</span>
            <select
              value={config.no_cauzione_surcharge?.tier_restriction || ''}
              onChange={e => updateConfig(['no_cauzione_surcharge', 'tier_restriction'], e.target.value)}
              className="px-2 py-1 text-xs bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
            >
              <option value="">Tutte le fasce</option>
              <option value="TIER_2">Solo Fascia A</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-theme-text-muted">
              <input
                type="checkbox"
                checked={config.no_cauzione_surcharge?.requires_kasko ?? true}
                onChange={e => updateConfig(['no_cauzione_surcharge', 'requires_kasko'], e.target.checked)}
                className="w-3.5 h-3.5"
              />
              Richiede Kasko
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// TAB 5: TARIFFE GIORNALIERE
// ═══════════════════════════════════════════════════
function RatesTab({ config, updateConfig, setConfig }: { config: RentalConfig; updateConfig: (p: string[], v: unknown) => void; setConfig: (c: RentalConfig) => void }) {
  const categories = getCategories(config)

  function addDayColumn(cat: string, rateType: string) {
    const rates = config.rental_day_rates?.[cat]?.[rateType as keyof typeof config.rental_day_rates[string]] as Record<string, number> | undefined
    if (!rates) return
    const days = Object.keys(rates).map(Number).sort((a, b) => a - b)
    const nextDay = days.length > 0 ? days[days.length - 1] + 1 : 1
    const lastPrice = days.length > 0 ? rates[String(days[days.length - 1])] : 100
    updateConfig(['rental_day_rates', cat, rateType, String(nextDay)], lastPrice)
  }

  function removeDayColumn(cat: string, rateType: string, day: string) {
    const next = JSON.parse(JSON.stringify(config)) as RentalConfig
    delete (next.rental_day_rates[cat][rateType as 'resident' | 'non_resident' | 'flat'] as Record<string, number>)[day]
    setConfig(next)
  }

  function toggleRateType(cat: string, rateType: 'resident' | 'non_resident' | 'flat', enable: boolean) {
    const next = JSON.parse(JSON.stringify(config)) as RentalConfig
    if (enable) {
      // Copy from existing rate type or create default
      const existing = next.rental_day_rates[cat]?.flat || next.rental_day_rates[cat]?.resident || next.rental_day_rates[cat]?.non_resident
      next.rental_day_rates[cat][rateType] = existing ? JSON.parse(JSON.stringify(existing)) : { '1': 100, '2': 180, '3': 250 }
    } else {
      delete next.rental_day_rates[cat][rateType]
    }
    setConfig(next)
  }

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-theme-text-primary">Tariffe Giornaliere per Categoria</h3>

      {categories.map(cat => {
        const rates = config.rental_day_rates?.[cat]
        if (!rates) return null
        const hasResident = !!rates.resident
        const hasNonResident = !!rates.non_resident
        const hasFlat = !!rates.flat

        return (
          <div key={cat} className="border border-theme-border rounded-lg p-4">
            <h4 className="font-medium text-theme-text-primary mb-3">{getCategoryLabel(config, cat)}</h4>

            {/* Rate type toggles */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs text-theme-text-muted">Tipo tariffa:</span>
              <label className="flex items-center gap-1 text-xs text-theme-text-secondary">
                <input type="checkbox" checked={hasFlat} onChange={e => toggleRateType(cat, 'flat', e.target.checked)} className="w-3.5 h-3.5" />
                Unica
              </label>
              <label className="flex items-center gap-1 text-xs text-theme-text-secondary">
                <input type="checkbox" checked={hasResident} onChange={e => toggleRateType(cat, 'resident', e.target.checked)} className="w-3.5 h-3.5" />
                Residente
              </label>
              <label className="flex items-center gap-1 text-xs text-theme-text-secondary">
                <input type="checkbox" checked={hasNonResident} onChange={e => toggleRateType(cat, 'non_resident', e.target.checked)} className="w-3.5 h-3.5" />
                Non Residente
              </label>
            </div>

            {(['resident', 'non_resident', 'flat'] as const).map(rateType => {
              const rateData = rates[rateType]
              if (!rateData) return null
              const label = rateType === 'resident' ? 'Residente Sardegna' : rateType === 'non_resident' ? 'Non Residente' : 'Tariffa unica'
              return (
                <div key={rateType} className="mb-3">
                  <p className="text-sm text-theme-text-secondary mb-2">{label}</p>
                  <div className="flex flex-wrap gap-2 items-end">
                    {Object.entries(rateData).sort(([a], [b]) => Number(a) - Number(b)).map(([day, price]) => (
                      <div key={day} className="text-center">
                        <p className="text-xs text-theme-text-muted">{day}g</p>
                        <NumInput
                          value={price}
                          onChange={v => updateConfig(['rental_day_rates', cat, rateType, day], v)}
                          className="w-20 text-center"
                        />
                        <button onClick={() => removeDayColumn(cat, rateType, day)} className="text-red-400 text-[10px] hover:text-red-300 block mx-auto mt-0.5">✕</button>
                      </div>
                    ))}
                    <button
                      onClick={() => addDayColumn(cat, rateType)}
                      className="px-2 py-1 text-xs text-dr7-gold border border-dr7-gold/30 rounded hover:bg-dr7-gold/10 mb-5"
                    >
                      + giorno
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════
// TAB 6: FASCE CLIENTE
// ═══════════════════════════════════════════════════
function TiersTab({ config, updateConfig }: { config: RentalConfig; updateConfig: (p: string[], v: unknown) => void }) {
  const rules = config.tier_rules

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-theme-text-primary">Regole Classificazione Fasce</h3>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Blocked */}
        <div className="border border-red-500/30 rounded-lg p-4">
          <h4 className="font-medium text-red-400 mb-3">Bloccato (no noleggio)</h4>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-theme-text-secondary w-32">Eta minima</span>
              <NumInput value={rules?.blocked?.min_age ?? 21} onChange={v => updateConfig(['tier_rules', 'blocked', 'min_age'], v)} className="w-16" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-theme-text-secondary w-32">Eta massima</span>
              <NumInput value={rules?.blocked?.max_age ?? 70} onChange={v => updateConfig(['tier_rules', 'blocked', 'max_age'], v)} className="w-16" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-theme-text-secondary w-32">Patente min. anni</span>
              <NumInput value={rules?.blocked?.min_license_years ?? 3} onChange={v => updateConfig(['tier_rules', 'blocked', 'min_license_years'], v)} className="w-16" />
            </div>
          </div>
        </div>

        {/* Fascia B */}
        <div className="border border-amber-500/30 rounded-lg p-4">
          <h4 className="font-medium text-amber-400 mb-1">Fascia B (giovane/rischio)</h4>
          <div className="mb-2">
            <InlineEdit
              value={rules?.TIER_1?.label ?? ''}
              onChange={v => updateConfig(['tier_rules', 'TIER_1', 'label'], v)}
              className="w-full text-xs"
              placeholder="Etichetta fascia B"
            />
          </div>
          <p className="text-xs text-theme-text-muted mb-2">Condizione OR: eta nel range OPPURE patente nel range</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-theme-text-secondary w-32">Eta da</span>
              <NumInput value={rules?.TIER_1?.age_range?.[0] ?? 21} onChange={v => updateConfig(['tier_rules', 'TIER_1', 'age_range'], [v, rules?.TIER_1?.age_range?.[1] ?? 25])} className="w-16" />
              <span className="text-sm text-theme-text-secondary">a</span>
              <NumInput value={rules?.TIER_1?.age_range?.[1] ?? 25} onChange={v => updateConfig(['tier_rules', 'TIER_1', 'age_range'], [rules?.TIER_1?.age_range?.[0] ?? 21, v])} className="w-16" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-theme-text-secondary w-32">Patente da</span>
              <NumInput value={rules?.TIER_1?.license_years_range?.[0] ?? 3} onChange={v => updateConfig(['tier_rules', 'TIER_1', 'license_years_range'], [v, rules?.TIER_1?.license_years_range?.[1] ?? 4])} className="w-16" />
              <span className="text-sm text-theme-text-secondary">a</span>
              <NumInput value={rules?.TIER_1?.license_years_range?.[1] ?? 4} onChange={v => updateConfig(['tier_rules', 'TIER_1', 'license_years_range'], [rules?.TIER_1?.license_years_range?.[0] ?? 3, v])} className="w-16" />
              <span className="text-sm text-theme-text-secondary">anni</span>
            </div>
          </div>
        </div>

        {/* Fascia A */}
        <div className="border border-green-500/30 rounded-lg p-4">
          <h4 className="font-medium text-green-400 mb-1">Fascia A (esperto)</h4>
          <div className="mb-2">
            <InlineEdit
              value={rules?.TIER_2?.label ?? ''}
              onChange={v => updateConfig(['tier_rules', 'TIER_2', 'label'], v)}
              className="w-full text-xs"
              placeholder="Etichetta fascia A"
            />
          </div>
          <p className="text-xs text-theme-text-muted mb-2">Condizione AND: eta nel range E patente sufficiente</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-theme-text-secondary w-32">Eta da</span>
              <NumInput value={rules?.TIER_2?.min_age ?? 26} onChange={v => updateConfig(['tier_rules', 'TIER_2', 'min_age'], v)} className="w-16" />
              <span className="text-sm text-theme-text-secondary">a</span>
              <NumInput value={rules?.TIER_2?.max_age ?? 69} onChange={v => updateConfig(['tier_rules', 'TIER_2', 'max_age'], v)} className="w-16" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-theme-text-secondary w-32">Patente min. anni</span>
              <NumInput value={rules?.TIER_2?.min_license_years ?? 5} onChange={v => updateConfig(['tier_rules', 'TIER_2', 'min_license_years'], v)} className="w-16" />
            </div>
          </div>
        </div>
      </div>

      {/* Simulator */}
      <div className="border border-theme-border rounded-lg p-4">
        <h4 className="font-medium text-theme-text-primary mb-3">Simulatore Fascia</h4>
        <TierSimulator rules={rules} />
      </div>
    </div>
  )
}

function TierSimulator({ rules }: { rules: RentalConfig['tier_rules'] }) {
  const [age, setAge] = useState(30)
  const [licenseYears, setLicenseYears] = useState(8)

  let result = 'BLOCCATO'
  let color = 'text-red-400'

  if (age >= (rules?.blocked?.min_age ?? 21) && age < (rules?.blocked?.max_age ?? 70) && licenseYears >= (rules?.blocked?.min_license_years ?? 3)) {
    const t1 = rules?.TIER_1
    const t2 = rules?.TIER_2
    const isT1 = (age >= (t1?.age_range?.[0] ?? 21) && age <= (t1?.age_range?.[1] ?? 25)) ||
                 (licenseYears >= (t1?.license_years_range?.[0] ?? 3) && licenseYears <= (t1?.license_years_range?.[1] ?? 4))
    const isT2 = age >= (t2?.min_age ?? 26) && age <= (t2?.max_age ?? 69) && licenseYears >= (t2?.min_license_years ?? 5)

    if (isT2) { result = 'FASCIA A'; color = 'text-green-400' }
    else if (isT1) { result = 'FASCIA B'; color = 'text-amber-400' }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-theme-text-secondary">Eta:</span>
        <input type="number" value={age} onChange={e => setAge(parseInt(e.target.value) || 0)}
          className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary" />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-theme-text-secondary">Patente:</span>
        <input type="number" value={licenseYears} onChange={e => setLicenseYears(parseInt(e.target.value) || 0)}
          className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary" />
        <span className="text-sm text-theme-text-muted">anni</span>
      </div>
      <span className={`font-bold text-lg ${color}`}>{result}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// TAB 7: PAGAMENTI
// ═══════════════════════════════════════════════════
function PaymentsTab({ config, setConfig, updateConfig }: { config: RentalConfig; setConfig: (c: RentalConfig) => void; updateConfig: (p: string[], v: unknown) => void }) {
  function addPaymentMode() {
    const next = JSON.parse(JSON.stringify(config)) as RentalConfig
    if (!next.payment_modes) next.payment_modes = []
    next.payment_modes.push({ id: `pay_${Date.now()}`, label: 'Nuova modalita', surcharge_percent: 0 })
    setConfig(next)
  }

  function removePaymentMode(idx: number) {
    const modes = [...(config.payment_modes || [])]
    modes.splice(idx, 1)
    updateConfig(['payment_modes'], modes)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-theme-text-primary">Modalita di Pagamento & Maggiorazioni</h3>
        <button onClick={addPaymentMode} className="text-xs text-dr7-gold hover:text-dr7-gold/80">+ Aggiungi modalita</button>
      </div>

      <div className="space-y-2">
        {(config.payment_modes || []).map((mode, idx) => (
          <div key={mode.id} className="flex items-center gap-3 p-3 border border-theme-border rounded-lg flex-wrap">
            <InlineEdit
              value={mode.label}
              onChange={v => {
                const modes = [...(config.payment_modes || [])]
                modes[idx] = { ...mode, label: v }
                updateConfig(['payment_modes'], modes)
              }}
              className="w-48"
              placeholder="Nome modalita"
            />
            <div className="flex items-center gap-1">
              <span className="text-xs text-theme-text-muted">Maggiorazione:</span>
              <NumInput
                value={mode.surcharge_percent}
                step="0.1"
                onChange={v => {
                  const modes = [...(config.payment_modes || [])]
                  modes[idx] = { ...mode, surcharge_percent: v }
                  updateConfig(['payment_modes'], modes)
                }}
                className="w-16"
              />
              <span className="text-xs text-theme-text-muted">%</span>
            </div>
            <InlineEdit
              value={mode.description || ''}
              onChange={v => {
                const modes = [...(config.payment_modes || [])]
                modes[idx] = { ...mode, description: v }
                updateConfig(['payment_modes'], modes)
              }}
              className="flex-1"
              placeholder="Descrizione (opzionale)"
            />
            <button onClick={() => removePaymentMode(idx)} className="text-red-400 text-xs hover:text-red-300">✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// TAB 8: PREVENTIVI
// ═══════════════════════════════════════════════════
function PreventiviTab({ config, updateConfig }: { config: RentalConfig; updateConfig: (p: string[], v: unknown) => void }) {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-theme-text-primary">Impostazioni Preventivi</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-theme-border rounded-lg p-4">
          <h4 className="font-medium text-theme-text-primary mb-2">Maggiorazione</h4>
          <div className="flex items-center gap-2">
            <NumInput value={config.preventivi?.maggiorazione_pct ?? 10} onChange={v => updateConfig(['preventivi', 'maggiorazione_pct'], v)} className="w-16" />
            <span className="text-xs text-theme-text-muted">%</span>
          </div>
          <p className="text-xs text-theme-text-muted mt-1">Applicata sul totale del preventivo</p>
        </div>

        <div className="border border-theme-border rounded-lg p-4">
          <h4 className="font-medium text-theme-text-primary mb-2">Scadenza Default</h4>
          <div className="flex items-center gap-2">
            <NumInput value={config.preventivi?.default_expiry_hours ?? 24} onChange={v => updateConfig(['preventivi', 'default_expiry_hours'], v)} className="w-16" />
            <span className="text-xs text-theme-text-muted">ore</span>
          </div>
        </div>

        <div className="border border-theme-border rounded-lg p-4">
          <h4 className="font-medium text-theme-text-primary mb-2">Footer WhatsApp</h4>
          <textarea
            value={config.preventivi?.whatsapp_footer ?? ''}
            onChange={e => updateConfig(['preventivi', 'whatsapp_footer'], e.target.value)}
            className="w-full px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary h-20 resize-y"
            placeholder="Testo in fondo al messaggio WhatsApp"
          />
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// AUDIT LOG — Change History
// ═══════════════════════════════════════════════════
interface AuditEntry {
  id: string
  changed_at: string
  changed_by: string
  section: string
  description?: string
}

function AuditLogSection() {
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  async function loadLogs() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('config_audit_log')
        .select('id, changed_at, changed_by, section, description')
        .order('changed_at', { ascending: false })
        .limit(20)

      if (!error && data) {
        setLogs(data)
      }
    } catch {
      // Table might not exist yet
    }
    setLoading(false)
  }

  useEffect(() => {
    if (expanded) loadLogs()
  }, [expanded])

  const sectionLabels: Record<string, string> = {
    categories: 'Categorie',
    insurance: 'Assicurazioni',
    km: 'KM & Sforo',
    deposits: 'Cauzioni',
    services: 'Servizi',
    rates: 'Tariffe',
    tiers: 'Fasce Cliente',
    payments: 'Pagamenti',
    preventivi: 'Preventivi',
  }

  return (
    <div className="border border-theme-border rounded-lg">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-theme-bg-tertiary/50 transition-colors"
      >
        <span className="text-sm font-semibold text-theme-text-secondary">
          Cronologia Modifiche
        </span>
        <span className="text-theme-text-muted text-xs">{expanded ? 'Chiudi' : 'Apri'}</span>
      </button>

      {expanded && (
        <div className="border-t border-theme-border p-4">
          {loading ? (
            <p className="text-sm text-theme-text-muted">Caricamento...</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-theme-text-muted">Nessuna modifica registrata.</p>
          ) : (
            <div className="space-y-2">
              {logs.map(log => (
                <div key={log.id} className="flex items-center gap-3 text-sm p-2 rounded-md bg-theme-bg-tertiary/30">
                  <span className="text-theme-text-muted text-xs w-36 shrink-0">
                    {new Date(log.changed_at).toLocaleString('it-IT')}
                  </span>
                  <span className="text-theme-text-primary font-medium w-24 shrink-0">
                    {sectionLabels[log.section] || log.section}
                  </span>
                  <span className="text-theme-text-secondary truncate">
                    {log.changed_by}
                  </span>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={loadLogs}
            className="mt-3 text-xs text-dr7-gold hover:text-dr7-gold/80"
          >
            Aggiorna
          </button>
        </div>
      )}
    </div>
  )
}
