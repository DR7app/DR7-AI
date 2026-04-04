/**
 * Centralina Unica — Main configuration panel
 * Manages ALL rental pricing, rules, and services from one place.
 * Changes here update Supabase and are automatically read by the website.
 */
import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import type { RentalConfig, InsuranceOption } from '../../../types/rentalConfig'
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
  { id: 'insurance', label: 'Assicurazioni' },
  { id: 'km', label: 'KM & Sforo' },
  { id: 'deposits', label: 'Cauzioni' },
  { id: 'services', label: 'Servizi' },
  { id: 'rates', label: 'Tariffe' },
  { id: 'tiers', label: 'Fasce Cliente' },
  { id: 'preventivi', label: 'Preventivi' },
] as const

type TabId = typeof TABS[number]['id']

const CATEGORIES = ['exotic', 'urban', 'utilitaire', 'furgone'] as const
const CATEGORY_LABELS: Record<string, string> = {
  exotic: 'Supercar',
  urban: 'Urban',
  utilitaire: 'Utilitaria',
  furgone: 'Furgone',
}

const UNIT_LABELS: Record<string, string> = {
  per_day: '/giorno',
  per_hour: '/ora',
  per_item: '/unita',
  flat: 'fisso',
}

export default function CentralinaConfig() {
  const [config, setConfig] = useState<RentalConfig>(DEFAULT_RENTAL_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('insurance')
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
        {activeTab === 'insurance' && <InsuranceTab config={config} updateConfig={updateConfig} />}
        {activeTab === 'km' && <KmSforoTab config={config} updateConfig={updateConfig} vehicles={vehicles} />}
        {activeTab === 'deposits' && <DepositsTab config={config} updateConfig={updateConfig} />}
        {activeTab === 'services' && <ServicesTab config={config} setConfig={setConfig} updateConfig={updateConfig} />}
        {activeTab === 'rates' && <RatesTab config={config} updateConfig={updateConfig} />}
        {activeTab === 'tiers' && <TiersTab config={config} updateConfig={updateConfig} />}
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
// TAB 1: ASSICURAZIONI
// ═══════════════════════════════════════════════════
function InsuranceTab({ config, updateConfig }: { config: RentalConfig; updateConfig: (p: string[], v: unknown) => void }) {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-theme-text-primary">Prezzi Assicurazioni per Categoria e Fascia</h3>

      {CATEGORIES.map(cat => {
        const catConfig = config.insurance?.[cat]
        if (!catConfig) return null

        const hasTiers = !!(catConfig as Record<string, unknown>).TIER_1 || !!(catConfig as Record<string, unknown>).TIER_2
        const allTiers = (catConfig as Record<string, InsuranceOption[]>)._all_tiers

        return (
          <div key={cat} className="border border-theme-border rounded-lg p-4">
            <input
              type="text"
              value={config.insurance?.category_labels?.[cat] || CATEGORY_LABELS[cat]}
              onChange={e => updateConfig(['insurance', 'category_labels', cat], e.target.value)}
              className="font-medium text-theme-text-primary mb-3 bg-transparent border-b border-transparent hover:border-theme-border focus:border-dr7-gold focus:outline-none px-0 py-1 text-base"
            />

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
                          <input
                            type="text"
                            value={opt.name}
                            onChange={e => {
                              const newOpts = [...options]
                              newOpts[idx] = { ...opt, name: e.target.value }
                              updateConfig(['insurance', cat, tier], newOpts)
                            }}
                            className="w-40 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
                          />
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-theme-text-muted">€</span>
                            <input
                              type="number"
                              step="0.01"
                              value={opt.daily_price}
                              onChange={e => {
                                const newOpts = [...options]
                                newOpts[idx] = { ...opt, daily_price: parseFloat(e.target.value) || 0 }
                                updateConfig(['insurance', cat, tier], newOpts)
                              }}
                              className="w-20 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
                            />
                            <span className="text-xs text-theme-text-muted">/giorno</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-amber-400">Cauz.€</span>
                            <input
                              type="number"
                              value={opt.mandatory_deposit ?? 0}
                              onChange={e => {
                                const newOpts = [...options]
                                newOpts[idx] = { ...opt, mandatory_deposit: parseInt(e.target.value) || 0 }
                                updateConfig(['insurance', cat, tier], newOpts)
                              }}
                              className="w-20 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
                            />
                          </div>
                          <button
                            onClick={() => {
                              const newOpts = options.filter((_, i) => i !== idx)
                              updateConfig(['insurance', cat, tier], newOpts)
                            }}
                            className="text-red-400 hover:text-red-300 text-sm px-1"
                            title="Rimuovi"
                          >✕</button>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          const newOpt: InsuranceOption = { id: `custom_${Date.now()}`, name: 'Nuova opzione', daily_price: 0, mandatory_deposit: 0 }
                          updateConfig(['insurance', cat, tier], [...options, newOpt])
                        }}
                        className="text-xs text-dr7-gold hover:text-[#247a6f] font-medium mt-1"
                      >+ Aggiungi opzione</button>
                    </div>
                  )
                })}
              </div>
            ) : allTiers ? (
              <div className="space-y-2">
                <p className="text-sm text-theme-text-muted">Stesse opzioni per tutte le fasce</p>
                {allTiers.map((opt, idx) => (
                  <div key={opt.id} className="flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      value={opt.name}
                      onChange={e => {
                        const newOpts = [...allTiers]
                        newOpts[idx] = { ...opt, name: e.target.value }
                        updateConfig(['insurance', cat, '_all_tiers'], newOpts)
                      }}
                      className="w-40 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
                    />
                    <span className="text-xs text-theme-text-muted">€</span>
                    <input
                      type="number"
                      step="0.01"
                      value={opt.daily_price}
                      onChange={e => {
                        const newOpts = [...allTiers]
                        newOpts[idx] = { ...opt, daily_price: parseFloat(e.target.value) || 0 }
                        updateConfig(['insurance', cat, '_all_tiers'], newOpts)
                      }}
                      className="w-20 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
                    />
                    <span className="text-xs text-theme-text-muted">/giorno</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-amber-400">Cauz.€</span>
                      <input
                        type="number"
                        value={opt.mandatory_deposit ?? 0}
                        onChange={e => {
                          const newOpts = [...allTiers]
                          newOpts[idx] = { ...opt, mandatory_deposit: parseInt(e.target.value) || 0 }
                          updateConfig(['insurance', cat, '_all_tiers'], newOpts)
                        }}
                        className="w-20 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
                      />
                    </div>
                    <button
                      onClick={() => {
                        const newOpts = allTiers.filter((_, i) => i !== idx)
                        updateConfig(['insurance', cat, '_all_tiers'], newOpts)
                      }}
                      className="text-red-400 hover:text-red-300 text-sm px-1"
                      title="Rimuovi"
                    >✕</button>
                  </div>
                ))}
                <button
                  onClick={() => {
                    const newOpt: InsuranceOption = { id: `custom_${Date.now()}`, name: 'Nuova opzione', daily_price: 0, mandatory_deposit: 0 }
                    updateConfig(['insurance', cat, '_all_tiers'], [...allTiers, newOpt])
                  }}
                  className="text-xs text-dr7-gold hover:text-[#247a6f] font-medium mt-1"
                >+ Aggiungi opzione</button>
              </div>
            ) : null}
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
                <p className="text-sm font-medium text-theme-text-secondary">{CATEGORY_LABELS[cat] || cat}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-theme-text-muted">Fisso €</span>
                  <input
                    type="number"
                    value={ded.fixed}
                    onChange={e => updateConfig(['insurance', 'deductibles', cat, 'fixed'], parseInt(e.target.value) || 0)}
                    className="w-20 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
                  />
                  <span className="text-xs text-theme-text-muted">+ %</span>
                  <input
                    type="number"
                    value={ded.percent}
                    onChange={e => updateConfig(['insurance', 'deductibles', cat, 'percent'], parseInt(e.target.value) || 0)}
                    className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
                  />
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
              <input
                type="number"
                value={km}
                onChange={e => {
                  const newTable = { ...globalKm.table, [day]: parseInt(e.target.value) || 0 }
                  updateConfig(['km_included', '_global', 'table'], newTable)
                }}
                className="w-20 px-2 py-1 text-sm text-center bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              />
              <p className="text-xs text-theme-text-muted mt-1">km</p>
            </div>
          ))}
          <div className="text-center">
            <p className="text-xs text-theme-text-muted mb-1">Extra/g</p>
            <input
              type="number"
              value={globalKm?.extra_per_day || 0}
              onChange={e => updateConfig(['km_included', '_global', 'extra_per_day'], parseInt(e.target.value) || 0)}
              className="w-20 px-2 py-1 text-sm text-center bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
            />
            <p className="text-xs text-theme-text-muted mt-1">km/g</p>
          </div>
        </div>
        <p className="text-xs text-green-400 mt-2">
          Esempio: 10 giorni = {globalKm ? (globalKm.table?.['5'] || 300) + ((10 - 5) * (globalKm.extra_per_day || 60)) : 600} km
        </p>
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
            <input
              type="number"
              step="0.01"
              value={config.sforo_km?._global || 0}
              onChange={e => updateConfig(['sforo_km', '_global'], parseFloat(e.target.value) || 0)}
              className="w-20 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
            />
            <span className="text-xs text-theme-text-muted">/km</span>
          </div>

          {/* Per category */}
          <div>
            <p className="text-sm font-medium text-theme-text-secondary mb-2">Per categoria:</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {CATEGORIES.map(cat => (
                <div key={cat} className="flex items-center gap-2">
                  <span className="text-sm text-theme-text-primary">{CATEGORY_LABELS[cat]}</span>
                  <input
                    type="number"
                    step="0.01"
                    value={config.sforo_km?.category?.[cat] ?? ''}
                    onChange={e => updateConfig(['sforo_km', 'category', cat], parseFloat(e.target.value) || 0)}
                    className="w-20 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
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
                  <input
                    type="number"
                    step="0.01"
                    value={price}
                    onChange={e => updateConfig(['sforo_km', 'vehicle_overrides', vId], parseFloat(e.target.value) || 0)}
                    className="w-20 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
                  />
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
          {CATEGORIES.filter(c => c !== 'urban').map(cat => {
            const catUk = config.unlimited_km?.[cat]
            if (!catUk) return null
            const hasTiers = !!(catUk.TIER_1 || catUk.TIER_2)
            return (
              <div key={cat} className="space-y-2">
                <p className="text-sm font-medium text-theme-text-secondary">{CATEGORY_LABELS[cat]}</p>
                {hasTiers ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-theme-text-muted w-20">Fascia B</span>
                      <span className="text-xs">€</span>
                      <input
                        type="number"
                        value={catUk.TIER_1?.per_day ?? 0}
                        onChange={e => updateConfig(['unlimited_km', cat, 'TIER_1', 'per_day'], parseFloat(e.target.value) || 0)}
                        className="w-20 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
                      />
                      <span className="text-xs text-theme-text-muted">/g</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-theme-text-muted w-20">Fascia A</span>
                      <span className="text-xs">€</span>
                      <input
                        type="number"
                        value={catUk.TIER_2?.per_day ?? 0}
                        onChange={e => updateConfig(['unlimited_km', cat, 'TIER_2', 'per_day'], parseFloat(e.target.value) || 0)}
                        className="w-20 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
                      />
                      <span className="text-xs text-theme-text-muted">/g</span>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs">€</span>
                    <input
                      type="number"
                      value={catUk._all_tiers?.flat ?? catUk._all_tiers?.per_day ?? 0}
                      onChange={e => updateConfig(['unlimited_km', cat, '_all_tiers', 'flat'], parseFloat(e.target.value) || 0)}
                      className="w-20 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
                    />
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
function DepositsTab({ config, updateConfig }: { config: RentalConfig; updateConfig: (p: string[], v: unknown) => void }) {
  const depositKeys = ['TIER_1_RESIDENT', 'TIER_2_RESIDENT', 'TIER_1_NON_RESIDENT', 'TIER_2_NON_RESIDENT'] as const
  const keyLabels: Record<string, string> = {
    TIER_1_RESIDENT: 'Fascia B — Residente',
    TIER_2_RESIDENT: 'Fascia A — Residente',
    TIER_1_NON_RESIDENT: 'Fascia B — Non Residente',
    TIER_2_NON_RESIDENT: 'Fascia A — Non Residente',
  }

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-theme-text-primary">Opzioni Cauzione per Fascia</h3>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {depositKeys.map(key => {
          const options = config.deposits?.[key] || []
          return (
            <div key={key} className="border border-theme-border rounded-lg p-4">
              <h4 className="text-sm font-medium text-theme-text-secondary mb-3">{keyLabels[key]}</h4>
              {options.map((opt, idx) => (
                <div key={opt.id} className="flex items-center gap-2 mb-2">
                  <span className="text-sm text-theme-text-primary w-40 truncate">{opt.label}</span>
                  <span className="text-xs text-theme-text-muted">€</span>
                  <input
                    type="number"
                    value={opt.amount}
                    onChange={e => {
                      const newOpts = [...options]
                      newOpts[idx] = { ...opt, amount: parseInt(e.target.value) || 0 }
                      updateConfig(['deposits', key], newOpts)
                    }}
                    className="w-20 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
                  />
                  {opt.surcharge_per_day != null && opt.surcharge_per_day > 0 && (
                    <>
                      <span className="text-xs text-amber-400">+€</span>
                      <input
                        type="number"
                        value={opt.surcharge_per_day}
                        onChange={e => {
                          const newOpts = [...options]
                          newOpts[idx] = { ...opt, surcharge_per_day: parseInt(e.target.value) || 0 }
                          updateConfig(['deposits', key], newOpts)
                        }}
                        className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
                      />
                      <span className="text-xs text-theme-text-muted">/g</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* Category defaults */}
      <div className="border border-theme-border rounded-lg p-4">
        <h4 className="font-medium text-theme-text-primary mb-3">Cauzione Default per Categoria</h4>
        <div className="grid grid-cols-3 gap-4">
          {Object.entries(config.deposits?.category_defaults || {}).map(([cat, amt]) => (
            <div key={cat} className="flex items-center gap-2">
              <span className="text-sm text-theme-text-primary">{CATEGORY_LABELS[cat] || cat}</span>
              <span className="text-xs">€</span>
              <input
                type="number"
                value={amt}
                onChange={e => updateConfig(['deposits', 'category_defaults', cat], parseInt(e.target.value) || 0)}
                className="w-24 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
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
function ServicesTab({ config, setConfig: _setConfig, updateConfig }: { config: RentalConfig; setConfig: (c: RentalConfig) => void; updateConfig: (p: string[], v: unknown) => void }) {
  void _setConfig
  return (
    <div className="space-y-6">
      {/* Experience Services */}
      <div className="border border-theme-border rounded-lg p-4">
        <h4 className="font-medium text-theme-text-primary mb-3">Servizi Experience</h4>
        <div className="space-y-2">
          {(config.experience_services || []).map((svc, idx) => (
            <div key={svc.id} className="flex items-center gap-3 p-2 rounded-md border border-theme-border/50">
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
              <span className="text-sm text-theme-text-primary w-56 truncate">{svc.name}</span>
              <span className="text-xs text-theme-text-muted">€</span>
              <input
                type="number"
                step="0.01"
                value={svc.price}
                onChange={e => {
                  const svcs = [...config.experience_services]
                  svcs[idx] = { ...svc, price: parseFloat(e.target.value) || 0 }
                  updateConfig(['experience_services'], svcs)
                }}
                className="w-20 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              />
              <span className="text-xs text-theme-text-muted">{UNIT_LABELS[svc.unit] || svc.unit}</span>
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
            <input
              type="number"
              step="0.01"
              value={config.dr7_flex?.daily_price ?? 19.90}
              onChange={e => updateConfig(['dr7_flex', 'daily_price'], parseFloat(e.target.value) || 0)}
              className="w-20 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
            />
            <span className="text-xs text-theme-text-muted">/giorno</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-theme-text-secondary">Rimborso:</span>
            <input
              type="number"
              value={config.dr7_flex?.refund_percent ?? 90}
              onChange={e => updateConfig(['dr7_flex', 'refund_percent'], parseInt(e.target.value) || 0)}
              className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
            />
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
      </div>

      {/* Simple services */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="border border-theme-border rounded-lg p-4">
          <h4 className="font-medium text-theme-text-primary mb-2">Pulizia Finale</h4>
          <div className="flex items-center gap-2">
            <span className="text-xs">€</span>
            <input
              type="number"
              step="0.01"
              value={config.lavaggio?.fee ?? 9.90}
              onChange={e => updateConfig(['lavaggio', 'fee'], parseFloat(e.target.value) || 0)}
              className="w-20 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
            />
            <span className="text-xs text-green-400">obbligatoria</span>
          </div>
        </div>

        <div className="border border-theme-border rounded-lg p-4">
          <h4 className="font-medium text-theme-text-primary mb-2">Consegna a Domicilio</h4>
          <div className="flex items-center gap-2">
            <span className="text-xs">€</span>
            <input
              type="number"
              step="0.01"
              value={config.delivery?.price_per_km ?? 3}
              onChange={e => updateConfig(['delivery', 'price_per_km'], parseFloat(e.target.value) || 0)}
              className="w-20 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
            />
            <span className="text-xs text-theme-text-muted">/km</span>
          </div>
        </div>

        <div className="border border-theme-border rounded-lg p-4">
          <h4 className="font-medium text-theme-text-primary mb-2">Secondo Guidatore</h4>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-theme-text-muted w-16">Fascia A</span>
              <span className="text-xs">€</span>
              <input
                type="number"
                value={config.second_driver?.TIER_2 ?? 10}
                onChange={e => updateConfig(['second_driver', 'TIER_2'], parseInt(e.target.value) || 0)}
                className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              />
              <span className="text-xs text-theme-text-muted">/g</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-theme-text-muted w-16">Fascia B</span>
              <span className="text-xs">€</span>
              <input
                type="number"
                value={config.second_driver?.TIER_1 ?? 20}
                onChange={e => updateConfig(['second_driver', 'TIER_1'], parseInt(e.target.value) || 0)}
                className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              />
              <span className="text-xs text-theme-text-muted">/g</span>
            </div>
          </div>
        </div>

        <div className="border border-theme-border rounded-lg p-4">
          <h4 className="font-medium text-theme-text-primary mb-2">No Cauzione</h4>
          <div className="flex items-center gap-2">
            <span className="text-xs">€</span>
            <input
              type="number"
              value={config.no_cauzione_surcharge?.per_day ?? 49}
              onChange={e => updateConfig(['no_cauzione_surcharge', 'per_day'], parseInt(e.target.value) || 0)}
              className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
            />
            <span className="text-xs text-theme-text-muted">/g</span>
            <span className="text-xs text-amber-400 ml-2">Solo Fascia A + con Kasko</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// TAB 5: TARIFFE GIORNALIERE
// ═══════════════════════════════════════════════════
function RatesTab({ config, updateConfig }: { config: RentalConfig; updateConfig: (p: string[], v: unknown) => void }) {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-theme-text-primary">Tariffe Giornaliere per Categoria</h3>

      {Object.entries(config.rental_day_rates || {}).map(([cat, rates]) => (
        <div key={cat} className="border border-theme-border rounded-lg p-4">
          <h4 className="font-medium text-theme-text-primary mb-3">{CATEGORY_LABELS[cat] || cat}</h4>

          {rates.resident && (
            <div className="mb-3">
              <p className="text-sm text-theme-text-secondary mb-2">Residente Sardegna</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(rates.resident).map(([day, price]) => (
                  <div key={day} className="text-center">
                    <p className="text-xs text-theme-text-muted">{day}g</p>
                    <input
                      type="number"
                      value={price}
                      onChange={e => updateConfig(['rental_day_rates', cat, 'resident', day], parseInt(e.target.value) || 0)}
                      className="w-20 px-1 py-1 text-sm text-center bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {rates.non_resident && (
            <div className="mb-3">
              <p className="text-sm text-theme-text-secondary mb-2">Non Residente</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(rates.non_resident).map(([day, price]) => (
                  <div key={day} className="text-center">
                    <p className="text-xs text-theme-text-muted">{day}g</p>
                    <input
                      type="number"
                      value={price}
                      onChange={e => updateConfig(['rental_day_rates', cat, 'non_resident', day], parseInt(e.target.value) || 0)}
                      className="w-20 px-1 py-1 text-sm text-center bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {rates.flat && (
            <div>
              <p className="text-sm text-theme-text-secondary mb-2">Tariffa unica</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(rates.flat).map(([day, price]) => (
                  <div key={day} className="text-center">
                    <p className="text-xs text-theme-text-muted">{day}g</p>
                    <input
                      type="number"
                      value={price}
                      onChange={e => updateConfig(['rental_day_rates', cat, 'flat', day], parseInt(e.target.value) || 0)}
                      className="w-20 px-1 py-1 text-sm text-center bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
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
              <input
                type="number"
                value={rules?.blocked?.min_age ?? 21}
                onChange={e => updateConfig(['tier_rules', 'blocked', 'min_age'], parseInt(e.target.value) || 0)}
                className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-theme-text-secondary w-32">Eta massima</span>
              <input
                type="number"
                value={rules?.blocked?.max_age ?? 70}
                onChange={e => updateConfig(['tier_rules', 'blocked', 'max_age'], parseInt(e.target.value) || 0)}
                className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-theme-text-secondary w-32">Patente min. anni</span>
              <input
                type="number"
                value={rules?.blocked?.min_license_years ?? 3}
                onChange={e => updateConfig(['tier_rules', 'blocked', 'min_license_years'], parseInt(e.target.value) || 0)}
                className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              />
            </div>
          </div>
        </div>

        {/* Fascia B */}
        <div className="border border-amber-500/30 rounded-lg p-4">
          <h4 className="font-medium text-amber-400 mb-3">Fascia B (giovane/rischio)</h4>
          <p className="text-xs text-theme-text-muted mb-2">Condizione OR: eta nel range OPPURE patente nel range</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-theme-text-secondary w-32">Eta da</span>
              <input
                type="number"
                value={rules?.TIER_1?.age_range?.[0] ?? 21}
                onChange={e => updateConfig(['tier_rules', 'TIER_1', 'age_range'], [parseInt(e.target.value) || 21, rules?.TIER_1?.age_range?.[1] ?? 25])}
                className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              />
              <span className="text-sm text-theme-text-secondary">a</span>
              <input
                type="number"
                value={rules?.TIER_1?.age_range?.[1] ?? 25}
                onChange={e => updateConfig(['tier_rules', 'TIER_1', 'age_range'], [rules?.TIER_1?.age_range?.[0] ?? 21, parseInt(e.target.value) || 25])}
                className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-theme-text-secondary w-32">Patente da</span>
              <input
                type="number"
                value={rules?.TIER_1?.license_years_range?.[0] ?? 3}
                onChange={e => updateConfig(['tier_rules', 'TIER_1', 'license_years_range'], [parseInt(e.target.value) || 3, rules?.TIER_1?.license_years_range?.[1] ?? 4])}
                className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              />
              <span className="text-sm text-theme-text-secondary">a</span>
              <input
                type="number"
                value={rules?.TIER_1?.license_years_range?.[1] ?? 4}
                onChange={e => updateConfig(['tier_rules', 'TIER_1', 'license_years_range'], [rules?.TIER_1?.license_years_range?.[0] ?? 3, parseInt(e.target.value) || 4])}
                className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              />
              <span className="text-sm text-theme-text-secondary">anni</span>
            </div>
          </div>
        </div>

        {/* Fascia A */}
        <div className="border border-green-500/30 rounded-lg p-4">
          <h4 className="font-medium text-green-400 mb-3">Fascia A (esperto)</h4>
          <p className="text-xs text-theme-text-muted mb-2">Condizione AND: eta nel range E patente sufficiente</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-theme-text-secondary w-32">Eta da</span>
              <input
                type="number"
                value={rules?.TIER_2?.min_age ?? 26}
                onChange={e => updateConfig(['tier_rules', 'TIER_2', 'min_age'], parseInt(e.target.value) || 26)}
                className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              />
              <span className="text-sm text-theme-text-secondary">a</span>
              <input
                type="number"
                value={rules?.TIER_2?.max_age ?? 69}
                onChange={e => updateConfig(['tier_rules', 'TIER_2', 'max_age'], parseInt(e.target.value) || 69)}
                className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-theme-text-secondary w-32">Patente min. anni</span>
              <input
                type="number"
                value={rules?.TIER_2?.min_license_years ?? 5}
                onChange={e => updateConfig(['tier_rules', 'TIER_2', 'min_license_years'], parseInt(e.target.value) || 5)}
                className="w-16 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary"
              />
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
    insurance: 'Assicurazioni',
    km: 'KM & Sforo',
    deposits: 'Cauzioni',
    services: 'Servizi',
    rates: 'Tariffe',
    tiers: 'Fasce Cliente',
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
