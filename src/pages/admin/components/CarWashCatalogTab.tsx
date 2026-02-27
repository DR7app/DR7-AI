import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

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
  price_options?: { label: string; price: number }[]
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
                <ServiceCard key={service.id} service={service} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ServiceCard({ service }: { service: CarWashService }) {
  const inactive = !service.is_active

  return (
    <div
      className={`rounded-2xl border p-5 transition-colors ${
        inactive
          ? 'border-theme-border/30 bg-theme-bg-secondary/40 opacity-50'
          : 'border-theme-border bg-theme-bg-secondary'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
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

      {/* Price */}
      {service.price_options && service.price_options.length > 0 ? (
        <div className="mb-3 space-y-1">
          {service.price_options.map((opt, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-theme-text-muted">{opt.label}</span>
              <span className="font-semibold text-dr7-gold">{(opt.price / 100).toFixed(2)} &euro;</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-3">
          <span className="text-lg font-bold text-dr7-gold">
            {(service.price / 100).toFixed(2)} &euro;
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
