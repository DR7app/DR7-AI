import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import Input from './Input'
import Button from './Button'

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
  created_at: string
  updated_at: string
}

export default function CarWashTab() {
  const [services, setServices] = useState<CarWashService[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filterTab, setFilterTab] = useState<'all' | 'lavaggio' | 'meccanica'>('all')
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    name_en: '',
    price: '',
    duration: '',
    description: '',
    description_en: '',
    features: '',
    features_en: '',
    display_order: '0',
    is_active: true,
    category: 'urban',
    main_tab: 'lavaggio',
    price_unit: '',
    price_options: ''
  })

  useEffect(() => {
    loadServices()
  }, [])

  async function loadServices() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('car_wash_services')
        .select('*')
        .order('display_order', { ascending: true })

      if (error) throw error
      setServices(data || [])
    } catch (error) {
      console.error('Failed to load car wash services:', error)
      alert('Errore nel caricamento dei servizi')
    } finally {
      setLoading(false)
    }
  }

  function handleEdit(service: CarWashService) {
    setEditingId(service.id)
    setFormData({
      id: service.id,
      name: service.name,
      name_en: service.name_en,
      price: service.price.toString(),
      duration: service.duration,
      description: service.description,
      description_en: service.description_en,
      features: service.features.join('\n'),
      features_en: service.features_en.join('\n'),
      display_order: service.display_order.toString(),
      is_active: service.is_active,
      category: service.category || 'urban',
      main_tab: service.main_tab || 'lavaggio',
      price_unit: service.price_unit || '',
      price_options: service.price_options ? JSON.stringify(service.price_options) : ''
    })
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      // Parse price_options if provided
      let priceOptions = null
      if (formData.price_options.trim()) {
        try {
          priceOptions = JSON.parse(formData.price_options)
        } catch {
          alert('Formato price_options non valido. Usa JSON: [{"label":"1h","price":9.90}]')
          return
        }
      }

      const serviceData: any = {
        name: formData.name,
        name_en: formData.name_en,
        price: parseFloat(formData.price),
        duration: formData.duration,
        description: formData.description,
        description_en: formData.description_en,
        features: formData.features.split('\n').filter(f => f.trim()),
        features_en: formData.features_en.split('\n').filter(f => f.trim()),
        display_order: parseInt(formData.display_order),
        is_active: formData.is_active,
        category: formData.category,
        main_tab: formData.main_tab,
        price_unit: formData.price_unit || null,
        price_options: priceOptions
      }

      if (editingId) {
        // Update existing service — only send form fields, preserving metadata/image
        const { error } = await supabase
          .from('car_wash_services')
          .update(serviceData)
          .eq('id', editingId)

        if (error) throw error
        alert('Servizio aggiornato con successo!')
      } else {
        // Create new service
        const { error } = await supabase
          .from('car_wash_services')
          .insert([serviceData])

        if (error) throw error
        alert('Servizio creato con successo!')
      }

      setShowForm(false)
      setEditingId(null)
      resetForm()
      loadServices()
    } catch (error) {
      console.error('Failed to save service:', error)
      alert('Errore nel salvataggio del servizio: ' + (error as Error).message)
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase
        .from('car_wash_services')
        .delete()
        .eq('id', id)

      if (error) throw error
      alert('Servizio eliminato con successo!')
      loadServices()
    } catch (error) {
      console.error('Failed to delete service:', error)
      alert('Errore nell\'eliminazione del servizio')
    }
  }

  async function handleToggleActive(id: string, currentStatus: boolean) {
    try {
      const { error } = await supabase
        .from('car_wash_services')
        .update({ is_active: !currentStatus })
        .eq('id', id)

      if (error) throw error
      loadServices()
    } catch (error) {
      console.error('Failed to toggle service status:', error)
      alert('Errore nel cambio di stato')
    }
  }

  function resetForm() {
    setFormData({
      id: '',
      name: '',
      name_en: '',
      price: '',
      duration: '',
      description: '',
      description_en: '',
      features: '',
      features_en: '',
      display_order: '0',
      is_active: true,
      category: 'urban',
      main_tab: 'lavaggio',
      price_unit: '',
      price_options: ''
    })
  }

  if (loading) {
    return <div className="text-center py-8 text-theme-text-muted">Caricamento...</div>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
        <h2 className="text-xl sm:text-2xl font-bold text-dr7-gold">🚿 Prime Wash Services</h2>
        <Button
          onClick={() => {
            resetForm()
            setEditingId(null)
            setShowForm(true)
          }}
          className="text-sm sm:text-base"
        >
          + Nuovo Servizio
        </Button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setFilterTab('all')}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            filterTab === 'all'
              ? 'bg-dr7-gold text-theme-bg-primary'
              : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'
          }`}
        >
          TUTTI ({services.length})
        </button>
        <button
          onClick={() => setFilterTab('lavaggio')}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            filterTab === 'lavaggio'
              ? 'bg-blue-600 text-white'
              : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'
          }`}
        >
          LAVAGGIO ({services.filter(s => s.main_tab === 'lavaggio').length})
        </button>
        <button
          onClick={() => setFilterTab('meccanica')}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            filterTab === 'meccanica'
              ? 'bg-orange-600 text-white'
              : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'
          }`}
        >
          MECCANICA ({services.filter(s => s.main_tab === 'meccanica').length})
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className=" p-4 sm:p-6 rounded-lg mb-6 border border-theme-border">
          <h3 className="text-lg sm:text-xl font-semibold text-dr7-gold mb-4">
            {editingId ? 'Modifica Servizio' : 'Nuovo Servizio'}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="ID Servizio (es: urban-full)"
              required
              value={formData.id}
              onChange={(e) => setFormData({ ...formData, id: e.target.value })}
              disabled={!!editingId}
              placeholder="urban-full"
            />
            <Input
              label="Prezzo (€)"
              type="number"
              step="0.01"
              required
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              placeholder="24.90"
            />
            <Input
              label="Nome (Italiano)"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="PRIME FULL CLEAN"
            />
            <Input
              label="Nome (Inglese)"
              required
              value={formData.name_en}
              onChange={(e) => setFormData({ ...formData, name_en: e.target.value })}
              placeholder="PRIME FULL CLEAN"
            />
            <Input
              label="Durata"
              required
              value={formData.duration}
              onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
              placeholder="45 min"
            />
            <Input
              label="Ordine di visualizzazione"
              type="number"
              required
              value={formData.display_order}
              onChange={(e) => setFormData({ ...formData, display_order: e.target.value })}
              placeholder="1"
            />
            <div>
              <label className="block text-sm font-medium text-theme-text-primary mb-2">
                Categoria *
              </label>
              <select
                required
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
              >
                <option value="urban">PRIME URBAN CLASS</option>
                <option value="maxi">PRIME MAXI CLASS</option>
                <option value="extra">PRIME EXTRA CARE</option>
                <option value="moto">PRIME MOTO</option>
                <option value="experience">PRIME EXPERIENCE</option>
                <option value="tech">PRIME TECH SERVICE</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-primary mb-2">
                Tab Principale *
              </label>
              <select
                required
                value={formData.main_tab}
                onChange={(e) => setFormData({ ...formData, main_tab: e.target.value })}
                className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
              >
                <option value="lavaggio">LAVAGGIO</option>
                <option value="meccanica">MECCANICA</option>
              </select>
            </div>
            <Input
              label="Unità Prezzo (opzionale)"
              value={formData.price_unit}
              onChange={(e) => setFormData({ ...formData, price_unit: e.target.value })}
              placeholder="a sedile, per 4 cerchi, ant/post"
            />
            <Input
              label="Opzioni Prezzo (JSON, opzionale)"
              value={formData.price_options}
              onChange={(e) => setFormData({ ...formData, price_options: e.target.value })}
              placeholder='[{"label":"1h","price":9.90},{"label":"2h","price":14.90}]'
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-theme-text-primary mb-2">
                Descrizione (Italiano)
              </label>
              <textarea
                required
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-2  border border-theme-border-light rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                rows={2}
                placeholder="Rapido e completo..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-primary mb-2">
                Descrizione (Inglese)
              </label>
              <textarea
                required
                value={formData.description_en}
                onChange={(e) => setFormData({ ...formData, description_en: e.target.value })}
                className="w-full px-4 py-2  border border-theme-border-light rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                rows={2}
                placeholder="Quick and complete..."
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-theme-text-primary mb-2">
                Caratteristiche (Italiano) - Una per riga
              </label>
              <textarea
                required
                value={formData.features}
                onChange={(e) => setFormData({ ...formData, features: e.target.value })}
                className="w-full px-4 py-2  border border-theme-border-light rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors font-mono text-sm"
                rows={6}
                placeholder="Esterni + interni completi&#10;Schiuma colorata profumata&#10;Pulizia cerchi, passaruota, vetri"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-primary mb-2">
                Caratteristiche (Inglese) - Una per riga
              </label>
              <textarea
                required
                value={formData.features_en}
                onChange={(e) => setFormData({ ...formData, features_en: e.target.value })}
                className="w-full px-4 py-2  border border-theme-border-light rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors font-mono text-sm"
                rows={6}
                placeholder="Complete exterior + interior&#10;Scented colored foam&#10;Wheel, wheel arch, glass cleaning"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="flex items-center gap-2 text-theme-text-primary">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="w-4 h-4"
              />
              <span>Servizio Attivo</span>
            </label>
          </div>

          <div className="flex gap-3 mt-6">
            <Button type="submit">Salva</Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowForm(false)
                setEditingId(null)
                resetForm()
              }}
            >
              Annulla
            </Button>
          </div>
        </form>
      )}

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {services
          .filter(s => filterTab === 'all' || s.main_tab === filterTab)
          .map((service) => (
          <div
            key={service.id}
            className={` rounded-lg border p-6 ${
              service.is_active ? 'border-theme-border' : 'border-red-800 opacity-60'
            }`}
          >
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="flex gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    service.main_tab === 'lavaggio' ? 'bg-blue-600' : 'bg-orange-600'
                  }`}>
                    {service.main_tab?.toUpperCase() || 'LAVAGGIO'}
                  </span>
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-theme-bg-hover">
                    {service.category?.toUpperCase() || 'URBAN'}
                  </span>
                </div>
                <h3 className="text-xl font-bold text-theme-text-primary">{service.name}</h3>
                <p className="text-sm text-theme-text-muted">{service.name_en}</p>
                <p className="text-xs text-theme-text-muted mt-1">ID: {service.id}</p>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-theme-text-primary">€{service.price.toFixed(2)}</div>
                <div className="text-sm text-theme-text-muted">{service.duration}</div>
                {service.price_unit && (
                  <div className="text-xs text-dr7-gold">{service.price_unit}</div>
                )}
              </div>
            </div>

            <p className="text-sm text-theme-text-secondary mb-4 italic">{service.description}</p>

            <div className="space-y-2 mb-4">
              <p className="text-xs font-semibold text-theme-text-muted uppercase">Caratteristiche:</p>
              {service.features.slice(0, 3).map((feature, idx) => (
                <div key={idx} className="text-xs text-theme-text-secondary flex items-start">
                  <span className="mr-2">•</span>
                  <span>{feature}</span>
                </div>
              ))}
              {service.features.length > 3 && (
                <div className="text-xs text-theme-text-muted">
                  +{service.features.length - 3} altre caratteristiche...
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-4 border-t border-theme-border">
              <button
                onClick={() => handleEdit(service)}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-theme-text-primary text-sm rounded-full transition-colors"
              >
                Modifica
              </button>
              <button
                onClick={() => handleToggleActive(service.id, service.is_active)}
                className={`px-3 py-1 text-theme-text-primary text-sm rounded transition-colors ${
                  service.is_active
                    ? 'bg-dr7-gold hover:bg-[#247a6f]'
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {service.is_active ? 'Disattiva' : 'Attiva'}
              </button>
              <button
                onClick={() => handleDelete(service.id)}
                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-theme-text-primary text-sm rounded-full transition-colors"
              >
                ×
              </button>
            </div>

            {!service.is_active && (
              <div className="mt-3 px-3 py-2 bg-red-900/20 border border-red-800 rounded text-xs text-red-400">
                ⚠️ Servizio disattivato - Non visibile sul sito
              </div>
            )}
          </div>
        ))}
      </div>

      {services.length === 0 && (
        <div className=" rounded-lg border border-theme-border p-8 text-center text-theme-text-muted">
          Nessun servizio trovato. Crea il primo servizio!
        </div>
      )}

      {/* Info Box */}
      <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4 mt-6">
        <h4 className="text-theme-text-primary font-semibold mb-2">ℹ️ Informazioni</h4>
        <ul className="text-sm text-theme-text-secondary space-y-1">
          <li>• Le modifiche ai prezzi si riflettono immediatamente sul sito principale</li>
          <li>• Puoi disattivare temporaneamente un servizio senza eliminarlo</li>
          <li>• L'ordine di visualizzazione determina come appaiono i servizi sul sito</li>
          <li>• Le caratteristiche vanno inserite una per riga</li>
        </ul>
      </div>
    </div>
  )
}
