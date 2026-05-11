import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

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
  const [editImageUrl, setEditImageUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newService, setNewService] = useState({
    name: '', price: '', duration: '', description: '', features: '', image_url: '',
    category: 'urban', main_tab: 'lavaggio' as 'lavaggio' | 'meccanica',
  })

  const newImageRef = useRef<HTMLInputElement>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const primeFlexLockRef = useRef(false)
  const saveEditingLockRef = useRef(false)

  // Prime Flex (protezione cancellazione lavaggio): prezzo unico modificabile
  // dall'admin, letto dal sito (CarWashBookingPage) tramite centralina_pro_config.
  // Default 4.90 — combacia col fallback hardcoded sul sito per backwards-compat.
  const PRIME_FLEX_DEFAULT = 4.90
  const [primeFlexPrice, setPrimeFlexPrice] = useState<string>(PRIME_FLEX_DEFAULT.toFixed(2))
  const [primeFlexSavedPrice, setPrimeFlexSavedPrice] = useState<number>(PRIME_FLEX_DEFAULT)
  const [primeFlexSaving, setPrimeFlexSaving] = useState(false)

  async function uploadImage(file: File, target: 'new' | 'edit') {
    if (!file.type.startsWith('image/')) { toast.error('Solo file immagine (PNG, JPG)'); return }
    setUploadingImage(true)
    try {
      const ext = file.name.split('.').pop() || 'png'
      const fileName = `wash-service-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('catalog-images')
        .upload(`wash-catalog/${fileName}`, file, { cacheControl: '31536000', upsert: true })
      if (upErr) throw upErr
      const { data: urlData } = supabase.storage.from('catalog-images').getPublicUrl(`wash-catalog/${fileName}`)
      const url = urlData?.publicUrl || ''
      if (target === 'new') {
        setNewService(prev => ({ ...prev, image_url: url }))
      } else {
        setEditImageUrl(url)
      }
      toast.success('Immagine caricata')
    } catch (err: unknown) {
      toast.error('Errore upload: ' + (err as Error).message)
    } finally {
      setUploadingImage(false)
    }
  }

  useEffect(() => {
    loadServices()
    loadPrimeFlex()
  }, [])

  // Legge il prezzo Prime Flex corrente da centralina_pro_config. Il sito
  // fa la stessa lettura: cosi' admin e website restano sempre allineati.
  // Path: centralina_pro_config.config.servizi.prime_flex.price (number).
  async function loadPrimeFlex() {
    try {
      const { data } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      const cfg = (data?.config || {}) as Record<string, unknown>
      const servizi = (cfg.servizi || {}) as Record<string, unknown>
      const pf = (servizi.prime_flex || {}) as Record<string, unknown>
      const price = typeof pf.price === 'number' ? pf.price : Number(pf.price)
      const finalPrice = Number.isFinite(price) && price >= 0 ? price : PRIME_FLEX_DEFAULT
      setPrimeFlexPrice(finalPrice.toFixed(2))
      setPrimeFlexSavedPrice(finalPrice)
    } catch (e) {
      console.warn('[CarWashCatalog] loadPrimeFlex fallback to default:', e)
    }
  }

  // Salva solo il prezzo Prime Flex. Patch chirurgica su servizi.prime_flex
  // (preserva il resto della config esistente). Niente upsert nuovo: facciamo
  // SELECT, merge, UPDATE per non sovrascrivere campi che non gestiamo qui.
  async function savePrimeFlex() {
    if (primeFlexLockRef.current) return
    const parsed = parseFloat(primeFlexPrice)
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error('Prezzo non valido')
      return
    }
    primeFlexLockRef.current = true
    setPrimeFlexSaving(true)
    try {
      const { data } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      const cfg = (data?.config || {}) as Record<string, unknown>
      const servizi = { ...((cfg.servizi as Record<string, unknown>) || {}) }
      const prevFlex = (servizi.prime_flex as Record<string, unknown>) || {}
      servizi.prime_flex = { ...prevFlex, price: parsed, enabled: true }
      const nextCfg = { ...cfg, servizi }
      const { error } = await supabase
        .from('centralina_pro_config')
        .upsert({ id: 'main', config: nextCfg }, { onConflict: 'id' })
      if (error) throw error
      setPrimeFlexSavedPrice(parsed)
      setPrimeFlexPrice(parsed.toFixed(2))
      toast.success('Prime Flex salvato')
    } catch (err: unknown) {
      toast.error('Errore salvataggio Prime Flex: ' + (err as Error).message)
    } finally {
      setPrimeFlexSaving(false)
      primeFlexLockRef.current = false
    }
  }

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
    setEditImageUrl((service as any).image_url || '')
  }

  function cancelEditing() {
    setEditingId(null)
    setEditPrice('')
    setEditPriceOptions([])
    setEditName('')
    setEditDuration('')
    setEditDescription('')
    setEditFeatures('')
    setEditImageUrl('')
  }

  async function saveEditing(service: CarWashService) {
    if (saveEditingLockRef.current) return
    saveEditingLockRef.current = true
    setSaving(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: Record<string, any> = {
        price: parseFloat(editPrice) || service.price,
        name: editName.trim() || service.name,
        duration: editDuration.trim() || service.duration,
        description: editDescription.trim() || service.description,
        features: editFeatures.split('\n').filter(f => f.trim()),
        image_url: editImageUrl.trim() || null,
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
      saveEditingLockRef.current = false
    }
  }

  async function toggleActive(service: CarWashService) {
    const newVal = !service.is_active
    await supabase.from('car_wash_services').update({ is_active: newVal }).eq('id', service.id)
    setServices(prev => prev.map(s => s.id === service.id ? { ...s, is_active: newVal } : s))
  }

  async function addNewService() {
    if (!newService.name.trim()) return
    setSaving(true)
    try {
      const id = newService.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
      const maxOrder = services.filter(s => s.main_tab === newService.main_tab && s.category === newService.category)
        .reduce((max, s) => Math.max(max, s.display_order || 0), 0)

      const { error } = await supabase.from('car_wash_services').insert({
        id,
        name: newService.name.trim(),
        name_en: newService.name.trim(),
        price: parseFloat(newService.price) || 0,
        duration: newService.duration.trim() || '-',
        description: newService.description.trim() || '',
        description_en: '',
        features: newService.features.split('\n').filter(f => f.trim()),
        features_en: [],
        category: newService.category,
        main_tab: newService.main_tab,
        image_url: newService.image_url.trim() || null,
        display_order: maxOrder + 10,
        is_active: true,
      })
      if (error) throw error
      setShowNewForm(false)
      setNewService({ name: '', price: '', duration: '', description: '', features: '', image_url: '', category: 'urban', main_tab: 'lavaggio' })
      await loadServices()
    } catch (err: unknown) {
      alert('Errore: ' + (err as Error).message)
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
            onClick={() => { setShowNewForm(true); setNewService(prev => ({ ...prev, main_tab: selectedTab })) }}
            className="px-4 py-2 rounded-full text-sm font-medium bg-dr7-gold text-white hover:bg-[#0A8FA3] transition-colors"
          >
            + Nuovo Servizio
          </button>
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

      {/* Prime Flex — protezione cancellazione (add-on, non un servizio
          della tabella car_wash_services). Unico prezzo modificabile,
          letto dal sito CarWashBookingPage. Storage:
          centralina_pro_config.config.servizi.prime_flex.price */}
      {(() => {
        const parsed = parseFloat(primeFlexPrice)
        const dirty = Number.isFinite(parsed) && parsed !== primeFlexSavedPrice
        return (
          <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-theme-text-primary">
                  Prime Flex — Protezione Cancellazione
                </h3>
                <p className="text-sm text-theme-text-muted mt-1">
                  Add-on opzionale sul checkout lavaggio: il cliente puo' annullare fino al giorno
                  dell'appuntamento e ricevere il 90% come credito DR7 Wallet. Il prezzo qui sotto
                  e' quello mostrato sul sito.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-theme-text-muted pointer-events-none">€</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={primeFlexPrice}
                    onChange={(e) => setPrimeFlexPrice(e.target.value)}
                    className="w-32 bg-theme-bg-primary border border-theme-border rounded-lg pl-7 pr-3 py-2 text-sm text-right tabular-nums text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                    placeholder="0.00"
                  />
                </div>
                <button
                  type="button"
                  onClick={savePrimeFlex}
                  disabled={primeFlexSaving || !dirty}
                  className="px-4 py-2 rounded-full text-sm font-medium bg-dr7-gold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {primeFlexSaving ? 'Salvo...' : 'Salva'}
                </button>
              </div>
            </div>
          </section>
        )
      })()}

      {/* New Service Form */}
      {showNewForm && (
        <div className="rounded-2xl border-2 border-dr7-gold p-5 bg-theme-bg-secondary space-y-3">
          <h3 className="font-bold text-theme-text-primary">Nuovo Servizio</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Nome *</label>
              <input type="text" value={newService.name} onChange={e => setNewService(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold" placeholder="Es. Interior Premium" />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Prezzo (€)</label>
              <input type="number" step="0.01" value={newService.price} onChange={e => setNewService(prev => ({ ...prev, price: e.target.value }))}
                className="w-full px-3 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold" placeholder="29.90" />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Durata</label>
              <input type="text" value={newService.duration} onChange={e => setNewService(prev => ({ ...prev, duration: e.target.value }))}
                className="w-full px-3 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold" placeholder="45 min" />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Categoria</label>
              <select value={newService.category} onChange={e => setNewService(prev => ({ ...prev, category: e.target.value }))}
                className="w-full px-3 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold">
                {(selectedTab === 'lavaggio' ? LAVAGGIO_ORDER : MECCANICA_ORDER).map(c => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-theme-text-muted mb-1">Descrizione</label>
            <textarea value={newService.description} onChange={e => setNewService(prev => ({ ...prev, description: e.target.value }))} rows={2}
              className="w-full px-3 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold" />
          </div>
          <div>
            <label className="block text-xs text-theme-text-muted mb-1">Immagine</label>
            <div className="flex items-center gap-2">
              <input ref={newImageRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={e => { if (e.target.files?.[0]) uploadImage(e.target.files[0], 'new') }} />
              <button type="button" onClick={() => newImageRef.current?.click()} disabled={uploadingImage}
                className="px-4 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm hover:border-dr7-gold transition-colors disabled:opacity-50">
                {uploadingImage ? 'Caricamento...' : 'Carica PNG'}
              </button>
              {newService.image_url && (
                <div className="flex items-center gap-2">
                  <img src={newService.image_url} alt="" className="w-10 h-10 object-cover rounded" />
                  <button type="button" onClick={() => setNewService(prev => ({ ...prev, image_url: '' }))} className="text-red-400 text-xs">X</button>
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs text-theme-text-muted mb-1">Caratteristiche (una per riga)</label>
            <textarea value={newService.features} onChange={e => setNewService(prev => ({ ...prev, features: e.target.value }))} rows={3}
              className="w-full px-3 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm font-mono focus:outline-none focus:border-dr7-gold" />
          </div>
          <div className="flex gap-2">
            <button onClick={addNewService} disabled={saving || !newService.name.trim()}
              className="px-4 py-1.5 bg-dr7-gold text-white text-sm font-semibold rounded-full hover:bg-[#0A8FA3] transition-colors disabled:opacity-50">
              {saving ? 'Salvataggio...' : 'Crea Servizio'}
            </button>
            <button onClick={() => setShowNewForm(false)}
              className="px-4 py-1.5 bg-theme-bg-tertiary text-theme-text-secondary text-sm rounded-full hover:bg-theme-bg-hover transition-colors">
              Annulla
            </button>
          </div>
        </div>
      )}

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
                  editImageUrl={editImageUrl}
                  onEditImageUrl={setEditImageUrl}
                  onToggleActive={() => toggleActive(service)}
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
  editImageUrl: string
  onEditImageUrl: (v: string) => void
  onToggleActive: () => void
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
  editImageUrl,
  onEditImageUrl,
  onToggleActive,
}: ServiceCardProps) {
  const editImgRef = useRef<HTMLInputElement>(null)
  const [imgUploading, setImgUploading] = useState(false)

  async function handleEditImageUpload(file: File) {
    if (!file.type.startsWith('image/')) { toast.error('Solo file immagine'); return }
    setImgUploading(true)
    try {
      const ext = file.name.split('.').pop() || 'png'
      const fileName = `wash-service-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('catalog-images')
        .upload(`wash-catalog/${fileName}`, file, { cacheControl: '31536000', upsert: true })
      if (upErr) throw upErr
      const { data: urlData } = supabase.storage.from('catalog-images').getPublicUrl(`wash-catalog/${fileName}`)
      onEditImageUrl(urlData?.publicUrl || '')
      toast.success('Immagine caricata')
    } catch (err: unknown) {
      toast.error('Errore upload: ' + (err as Error).message)
    } finally {
      setImgUploading(false)
    }
  }

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

        {/* Image Upload */}
        <div className="mb-3">
          <label className="block text-xs text-theme-text-muted mb-1">Immagine</label>
          <div className="flex items-center gap-2">
            <input ref={editImgRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={e => { if (e.target.files?.[0]) handleEditImageUpload(e.target.files[0]) }} />
            <button type="button" onClick={() => editImgRef.current?.click()} disabled={imgUploading}
              className="px-4 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm hover:border-dr7-gold transition-colors disabled:opacity-50">
              {imgUploading ? 'Caricamento...' : 'Carica PNG'}
            </button>
            {editImageUrl && (
              <div className="flex items-center gap-2">
                <img src={editImageUrl} alt="" className="w-10 h-10 object-cover rounded" />
                <button type="button" onClick={() => onEditImageUrl('')} className="text-red-400 text-xs">X</button>
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={onSave}
            disabled={saving}
            className="px-4 py-1.5 bg-dr7-gold text-white text-sm font-semibold rounded-full hover:bg-[#0A8FA3] transition-colors disabled:opacity-50"
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
      {/* Action buttons */}
      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onToggleActive}
          className={`p-1.5 rounded-full bg-theme-bg-tertiary/80 transition-colors ${inactive ? 'text-green-400 hover:bg-green-500/20' : 'text-red-400 hover:bg-red-500/20'}`}
          title={inactive ? 'Attiva' : 'Disattiva'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {inactive
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            }
          </svg>
        </button>
        <button
          onClick={onStartEdit}
          className="p-1.5 rounded-full bg-theme-bg-tertiary/80 text-theme-text-muted hover:text-dr7-gold hover:bg-theme-bg-tertiary transition-colors"
          title="Modifica"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
      </div>

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
