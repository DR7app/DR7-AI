import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

interface PriceOption {
  label: string
  price: number
}

interface CarWashService {
  id: string
  name: string
  name_en: string
  price: number
  duration: string
  description: string
  description_en: string
  features: string[]
  features_en: string[]
  display_order: number
  is_active: boolean
  category: string
  main_tab: string
  price_unit?: string
  price_options?: PriceOption[]
}

const CATEGORY_LABELS: Record<string, string> = {
  urban: 'Urban',
  maxi: 'Maxi',
  extra: 'Extra',
  moto: 'Moto',
  experience: 'Experience',
  tech: 'Tech',
}

const LAVAGGIO_ORDER = ['urban', 'maxi', 'extra', 'moto', 'experience']
const MECCANICA_ORDER = ['tech']

export default function CarWashCatalogTab() {
  const [services, setServices] = useState<CarWashService[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTab, setSelectedTab] = useState<'lavaggio' | 'meccanica'>('lavaggio')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPrice, setEditPrice] = useState('')
  const [editPriceOptions, setEditPriceOptions] = useState<PriceOption[]>([])
  const [editName, setEditName] = useState('')
  const [editDuration, setEditDuration] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editFeatures, setEditFeatures] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadServices()
  }, [])

  async function loadServices() {
    setLoading(true)
    const { data, error } = await supabase
      .from('car_wash_services')
      .select('*')
      .order('display_order', { ascending: true })

    if (!error && data) {
      setServices(data)
    }
    setLoading(false)
  }

  function startEditing(service: CarWashService) {
    setEditingId(service.id)
    setEditPrice(service.price.toString())
    setEditPriceOptions(service.price_options ? [...service.price_options] : [])
    setEditName(service.name)
    setEditDuration(service.duration || '')
    setEditDescription(service.description || '')
    setEditFeatures((service.features || []).join('\n'))
  }

  function cancelEditing() {
    setEditingId(null)
    setEditPrice('')
    setEditPriceOptions([])
    setEditName('')
    setEditDuration('')
    setEditDescription('')
    setEditFeatures('')
  }

  async function saveEditing(service: CarWashService) {
    setSaving(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: Record<string, any> = {
        price: parseFloat(editPrice) || service.price,
        name: editName.trim() || service.name,
        duration: editDuration.trim() || service.duration,
        description: editDescription.trim() || service.description,
        features: editFeatures.split('\n').filter(f => f.trim()),
      }

      if (service.price_options && service.price_options.length > 0) {
        updates.price_options = editPriceOptions
      }

      const { error } = await supabase
        .from('car_wash_services')
        .update(updates)
        .eq('id', service.id)

      if (error) throw error

      cancelEditing()
      await loadServices()
    } catch (err: unknown) {
      alert('Errore nel salvataggio: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const filteredServices = services.filter(s => s.main_tab === selectedTab)
  const categoryOrder = selectedTab === 'lavaggio' ? LAVAGGIO_ORDER : MECCANICA_ORDER
  const groupedServices: Record<string, CarWashService[]> = {}
  for (const cat of categoryOrder) {
    const items = filteredServices.filter(s => s.category === cat)
    if (items.length > 0) {
      groupedServices[cat] = items
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-dr7-gold" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-2xl font-bold text-theme-text-primary">Catalogo Servizi</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSelectedTab('lavaggio')}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
              selectedTab === 'lavaggio'
                ? 'bg-theme-text-primary text-theme-bg-primary border-theme-text-primary'
                : 'bg-theme-bg-primary text-theme-text-primary border-white hover:bg-theme-text-primary hover:text-theme-bg-primary'
            }`}
          >
            LAVAGGIO
          </button>
          <button
            type="button"
            onClick={() => setSelectedTab('meccanica')}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
              selectedTab === 'meccanica'
                ? 'bg-theme-text-primary text-theme-bg-primary border-theme-text-primary'
                : 'bg-theme-bg-primary text-theme-text-primary border-white hover:bg-theme-text-primary hover:text-theme-bg-primary'
            }`}
          >
            MECCANICA
          </button>
        </div>
      </div>

      {Object.keys(groupedServices).length === 0 && (
        <p className="text-theme-text-muted text-center py-10">Nessun servizio trovato.</p>
      )}

      {categoryOrder.map(cat => {
        const items = groupedServices[cat]
        if (!items) return null
        return (
          <div key={cat}>
            <h3 className="text-lg font-bold text-dr7-gold mb-3 uppercase tracking-wider">
              {CATEGORY_LABELS[cat] || cat}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {items.map(service => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  isEditing={editingId === service.id}
                  editPrice={editPrice}
                  editPriceOptions={editPriceOptions}
                  editName={editName}
                  editDuration={editDuration}
                  editDescription={editDescription}
                  editFeatures={editFeatures}
                  saving={saving}
                  onStartEdit={() => startEditing(service)}
                  onCancel={cancelEditing}
                  onSave={() => saveEditing(service)}
                  onEditPrice={setEditPrice}
                  onEditPriceOptions={setEditPriceOptions}
                  onEditName={setEditName}
                  onEditDuration={setEditDuration}
                  onEditDescription={setEditDescription}
                  onEditFeatures={setEditFeatures}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface ServiceCardProps {
  service: CarWashService
  isEditing: boolean
  editPrice: string
  editPriceOptions: PriceOption[]
  editName: string
  editDuration: string
  editDescription: string
  editFeatures: string
  saving: boolean
  onStartEdit: () => void
  onCancel: () => void
  onSave: () => void
  onEditPrice: (v: string) => void
  onEditPriceOptions: (v: PriceOption[]) => void
  onEditName: (v: string) => void
  onEditDuration: (v: string) => void
  onEditDescription: (v: string) => void
  onEditFeatures: (v: string) => void
}

function ServiceCard({
  service,
  isEditing,
  editPrice,
  editPriceOptions,
  editName,
  editDuration,
  editDescription,
  editFeatures,
  saving,
  onStartEdit,
  onCancel,
  onSave,
  onEditPrice,
  onEditPriceOptions,
  onEditName,
  onEditDuration,
  onEditDescription,
  onEditFeatures,
}: ServiceCardProps) {
  const inactive = !service.is_active

  if (isEditing) {
    return (
      <div className="rounded-2xl border-2 border-dr7-gold p-5 bg-theme-bg-secondary">
        {/* Name */}
        <div className="mb-3">
          <label className="block text-xs text-theme-text-muted mb-1">Nome</label>
          <input
            type="text"
            value={editName}
            onChange={e => onEditName(e.target.value)}
            className="w-full px-3 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
          />
        </div>

        {/* Duration */}
        <div className="mb-3">
          <label className="block text-xs text-theme-text-muted mb-1">Durata</label>
          <input
            type="text"
            value={editDuration}
            onChange={e => onEditDuration(e.target.value)}
            className="w-full px-3 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
            placeholder="45 min"
          />
        </div>

        {/* Price */}
        {service.price_options && service.price_options.length > 0 ? (
          <div className="mb-3">
            <label className="block text-xs text-theme-text-muted mb-1">Opzioni Prezzo</label>
            <div className="space-y-2">
              {editPriceOptions.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-sm text-theme-text-muted min-w-[40px]">{opt.label}</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.01"
                      value={opt.price}
                      onChange={e => {
                        const updated = [...editPriceOptions]
                        updated[i] = { ...updated[i], price: parseFloat(e.target.value) || 0 }
                        onEditPriceOptions(updated)
                      }}
                      className="w-24 px-2 py-1 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm text-right focus:outline-none focus:border-dr7-gold"
                    />
                    <span className="text-xs text-theme-text-muted">&euro;</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-3">
            <label className="block text-xs text-theme-text-muted mb-1">Prezzo (&euro;)</label>
            <input
              type="number"
              step="0.01"
              value={editPrice}
              onChange={e => onEditPrice(e.target.value)}
              className="w-full px-3 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
            />
          </div>
        )}

        {/* Description */}
        <div className="mb-3">
          <label className="block text-xs text-theme-text-muted mb-1">Descrizione</label>
          <textarea
            value={editDescription}
            onChange={e => onEditDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
          />
        </div>

        {/* Features */}
        <div className="mb-3">
          <label className="block text-xs text-theme-text-muted mb-1">Caratteristiche (una per riga)</label>
          <textarea
            value={editFeatures}
            onChange={e => onEditFeatures(e.target.value)}
            rows={4}
            className="w-full px-3 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm font-mono focus:outline-none focus:border-dr7-gold"
          />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={onSave}
            disabled={saving}
            className="px-4 py-1.5 bg-dr7-gold text-white text-sm font-semibold rounded-full hover:bg-[#247a6f] transition-colors disabled:opacity-50"
          >
            {saving ? 'Salvataggio...' : 'Salva'}
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-1.5 bg-theme-bg-tertiary text-theme-text-secondary text-sm rounded-full hover:bg-theme-bg-hover transition-colors"
          >
            Annulla
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`rounded-2xl border p-5 transition-colors group relative ${
        inactive
          ? 'border-theme-border/30 bg-theme-bg-secondary/40 opacity-50'
          : 'border-theme-border bg-theme-bg-secondary'
      }`}
    >
      {/* Edit button */}
      <button
        onClick={onStartEdit}
        className="absolute top-3 right-3 p-1.5 rounded-full bg-theme-bg-tertiary/80 text-theme-text-muted hover:text-dr7-gold hover:bg-theme-bg-tertiary transition-colors opacity-0 group-hover:opacity-100"
        title="Modifica"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      </button>

      <div className="flex items-start justify-between gap-2 mb-2 pr-8">
        <div>
          <h4 className="font-semibold text-theme-text-primary">{service.name}</h4>
          {service.name_en && service.name_en !== service.name && (
            <p className="text-xs text-theme-text-muted">{service.name_en}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {service.duration && service.duration !== '-' && (
            <span className="text-xs bg-theme-bg-tertiary text-theme-text-secondary px-2 py-1 rounded-full whitespace-nowrap">
              {service.duration}
            </span>
          )}
          {inactive && (
            <span className="text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded-full font-medium">
              Disattivato
            </span>
          )}
        </div>
      </div>

      {/* Price — stored in EUR, display directly */}
      {service.price_options && service.price_options.length > 0 ? (
        <div className="mb-3 space-y-1">
          {service.price_options.map((opt, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-theme-text-muted">{opt.label}</span>
              <span className="font-semibold text-dr7-gold">{opt.price.toFixed(2)} &euro;</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-3">
          <span className="text-lg font-bold text-dr7-gold">
            {service.price.toFixed(2)} &euro;
          </span>
          {service.price_unit && (
            <span className="text-xs text-theme-text-muted ml-1">{service.price_unit}</span>
          )}
        </div>
      )}

      {/* Description */}
      {service.description && (
        <p className="text-sm text-theme-text-muted mb-3">{service.description}</p>
      )}

      {/* Features */}
      {service.features && service.features.length > 0 && (
        <ul className="space-y-1">
          {service.features.map((feat, i) => (
            <li key={i} className="text-sm text-theme-text-secondary flex items-start gap-2">
              <span className="text-dr7-gold mt-0.5">&#x2022;</span>
              <span>{feat}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
