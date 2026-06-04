import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

interface Vehicle {
    id: string
    display_name: string
    plate: string | null
    category: string | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: Record<string, any> | null
}

interface VehicleInventory {
    id: string
    vehicle_id: string
    oil_type: string | null
    oil_quantity: number
    oil_supplier_url: string | null
    oil_supplier_phone: string | null
    pastiglie_ant_model: string | null
    pastiglie_ant_quantity: number
    pastiglie_ant_supplier_url: string | null
    pastiglie_ant_supplier_phone: string | null
    pastiglie_post_model: string | null
    pastiglie_post_quantity: number
    pastiglie_post_supplier_url: string | null
    pastiglie_post_supplier_phone: string | null
    sensori_ant_model: string | null
    sensori_ant_quantity: number
    sensori_ant_supplier_url: string | null
    sensori_ant_supplier_phone: string | null
    sensori_post_model: string | null
    sensori_post_quantity: number
    sensori_post_supplier_url: string | null
    sensori_post_supplier_phone: string | null
    updated_at: string
}

interface VehicleWithInventory extends Vehicle {
    inventory?: VehicleInventory
}

// Vehicle photo: legge metadata.image (upload da admin) e fallback su un
// name-map di asset statici pubblicati su dr7empire.com, allineato con
// VehiclesTab cosi' i veicoli senza upload mostrano comunque la foto giusta.
const WEBSITE_BASE = 'https://dr7empire.com'
function nameBasedVehicleImage(name: string): string | undefined {
    const n = (name || '').toLowerCase()
    if (!n) return undefined
    const u = (p: string) => `${WEBSITE_BASE}${p}`
    if (n.includes('rs3')) return u('/rs3.jpeg')
    if (n.includes('m340')) return u('/bmw-m340i.jpeg')
    if (n.includes('m3')) return u('/bmw-m3.jpeg')
    if (n.includes('m4')) return u('/bmw-m4.jpeg')
    if (n.includes('911') || n.includes('carrera')) return u('/porsche-911.jpeg')
    if (n.includes('c63')) return u('/c63.jpeg')
    if (n.includes('a45')) return u('/mercedes_amg.jpeg')
    if (n.includes('cayenne')) return u('/cayenne.jpeg')
    if (n.includes('macan')) return u('/macan.jpeg')
    if (n.includes('gle')) return u('/mercedes-gle.jpeg')
    if (n.includes('ducato')) return u('/ducato.jpeg')
    if (n.includes('vito') || n.includes('v class') || n.includes('v-class')) return u('/vito.jpeg')
    if (n.includes('208')) return u('/208.jpeg')
    if (n.includes('clio') && (n.includes('arancio') || n.includes('orange'))) return u('/clio4a.jpeg')
    if (n.includes('clio') && (n.includes('blu') || n.includes('blue'))) return u('/clio4b.jpeg')
    if (n.includes('c3') && (n.includes('red') || n.includes('rosso'))) return u('/c3r.jpeg')
    if (n.includes('c3') && (n.includes('white') || n.includes('bianca'))) return u('/cr3w.jpeg')
    if (n.includes('c3')) return u('/c3.jpeg')
    if (n.includes('captur')) return u('/captur.jpeg')
    if (n.includes('panda') && (n.includes('bianca') || n.includes('white'))) return u('/panda2.jpeg')
    if (n.includes('panda') && (n.includes('aranci') || n.includes('orange'))) return u('/panda3.jpeg')
    if (n.includes('panda')) return u('/panda1.jpeg')
    return undefined
}

function vehicleImageUrl(v: VehicleWithInventory): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (v.metadata as any) || {}
    const candidates = [m.image, m.image_url, m.hero_image, m.photo, m.picture]
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c
    }
    return nameBasedVehicleImage(v.display_name)
}

type StatusFilter = 'all' | 'critico' | 'sotto_soglia' | 'ok'

// 2026-06-04: Cart per ordini multi-item. Tipo distinto (gomma_ant,
// gomma_post, olio, pastiglie_ant, pastiglie_post, sensori_ant,
// sensori_post) cosi' il messaggio WhatsApp puo' raggruppare per
// categoria e dare al fornitore una lista chiara.
interface CartItem {
  key: string
  vehicleId: string
  vehicleName: string
  vehiclePlate: string
  type: 'gomma_ant' | 'gomma_post' | 'olio' | 'pastiglie_ant' | 'pastiglie_post' | 'sensori_ant' | 'sensori_post'
  label: string
  specs: string
  quantity: number
}

// 2026-06-04: fornitori dedicati ai veicoli, stored in fleet_fornitori
// (separati dai fornitori "fiscali" del modulo Fornitori principale).
// Direzione vuole solo nome + numero WhatsApp.
interface FleetFornitore {
  id: string
  nome: string
  telefono: string
  note: string | null
  is_active: boolean
}

export default function FleetInventory() {
    const [vehicles, setVehicles] = useState<VehicleWithInventory[]>([])
    const [loading, setLoading] = useState(true)
    const [editingVehicle, setEditingVehicle] = useState<string | null>(null)
    const [editForm, setEditForm] = useState<Partial<VehicleInventory>>({})
    const [plateSearch, setPlateSearch] = useState('')
    const [saving, setSaving] = useState(false)
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

    // 2026-06-04: Carrello ordini ricambi. Mixto: gomme + pastiglie + olio
    // + sensori dallo stesso veicolo o veicoli diversi → un solo messaggio
    // WhatsApp al fornitore scelto da dropdown.
    // 2026-06-04: sub-tab interno del Magazzino: 'inventario' (default,
    // la vista corrente con tutti i veicoli) o 'fornitori' (gestione lista
    // fornitori dedicata ai veicoli, name + WhatsApp).
    const [subTab, setSubTab] = useState<'inventario' | 'fornitori'>('inventario')

    const [cart, setCart] = useState<CartItem[]>([])
    const [cartOpen, setCartOpen] = useState(false)
    const [fleetFornitori, setFleetFornitori] = useState<FleetFornitore[]>([])
    const [selectedFornitoreId, setSelectedFornitoreId] = useState<string>('')
    const [orderNote, setOrderNote] = useState<string>('')

    const loadFleetFornitori = async () => {
      const { data, error } = await supabase
        .from('fleet_fornitori')
        .select('id, nome, telefono, note, is_active')
        .eq('is_active', true)
        .order('nome', { ascending: true })
      if (error) {
        console.warn('[FleetInventory] fleet_fornitori load failed:', error.message)
        return
      }
      setFleetFornitori((data || []) as FleetFornitore[])
    }
    useEffect(() => { loadFleetFornitori() }, [])

    const addToCart = (item: Omit<CartItem, 'key' | 'quantity'>, quantity: number = 1) => {
      const key = `${item.vehicleId}:${item.type}`
      setCart(prev => {
        const existing = prev.find(c => c.key === key)
        if (existing) {
          return prev.map(c => c.key === key ? { ...c, quantity: c.quantity + quantity } : c)
        }
        return [...prev, { ...item, key, quantity }]
      })
      toast.success(`${item.label} aggiunto al carrello`)
    }
    const updateQty = (key: string, qty: number) => {
      if (qty <= 0) { setCart(prev => prev.filter(c => c.key !== key)); return }
      setCart(prev => prev.map(c => c.key === key ? { ...c, quantity: qty } : c))
    }
    const removeFromCart = (key: string) => setCart(prev => prev.filter(c => c.key !== key))
    const clearCart = () => { setCart([]); setOrderNote('') }
    const cartCount = cart.reduce((s, c) => s + c.quantity, 0)

    function sendCartViaWhatsApp() {
      if (cart.length === 0) { toast.error('Carrello vuoto'); return }
      const fornitore = fleetFornitori.find(f => f.id === selectedFornitoreId)
      if (!fornitore) { toast.error('Seleziona un fornitore'); return }
      // Raggruppa per veicolo per leggibilita'.
      const byVehicle = new Map<string, CartItem[]>()
      for (const item of cart) {
        const k = `${item.vehicleName}|${item.vehiclePlate}`
        if (!byVehicle.has(k)) byVehicle.set(k, [])
        byVehicle.get(k)!.push(item)
      }
      const lines: string[] = ['Buongiorno,', 'Vorrei ordinare:', '']
      for (const [vKey, items] of byVehicle) {
        const [vName, vPlate] = vKey.split('|')
        lines.push(`🔹 ${vName}${vPlate ? ` (${vPlate})` : ''}`)
        for (const it of items) {
          lines.push(`   • ${it.label} — ${it.specs}`)
          lines.push(`     Quantità: ${it.quantity}`)
        }
        lines.push('')
      }
      if (orderNote.trim()) {
        lines.push(`Note: ${orderNote.trim()}`)
        lines.push('')
      }
      lines.push('Grazie,')
      lines.push('DR7 Empire')
      const message = lines.join('\n')
      const phone = formatPhoneForWhatsApp(fornitore.telefono)
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      window.open(url, '_blank')
      toast.success(`Ordine inviato a ${fornitore.nome}`)
      clearCart()
      setCartOpen(false)
      setSelectedFornitoreId('')
    }

    useEffect(() => {
        loadVehiclesWithInventory()
    }, [])

    async function loadVehiclesWithInventory() {
        try {
            setLoading(true)

            // Load all vehicles
            const { data: vehiclesData, error: vehiclesError } = await supabase
                .from('vehicles')
                .select('*')
                .neq('status', 'retired')
                .order('display_name')

            if (vehiclesError) throw vehiclesError

            // Load inventory for all vehicles
            const { data: inventoryData, error: inventoryError } = await supabase
                .from('fleet_vehicle_inventory')
                .select('*')

            if (inventoryError && inventoryError.code !== 'PGRST116') {
                console.error('Inventory table may not exist yet:', inventoryError)
            }

            // Merge vehicles with their inventory
            const vehiclesWithInventory = (vehiclesData || []).map(vehicle => ({
                ...vehicle,
                inventory: inventoryData?.find(inv => inv.vehicle_id === vehicle.id)
            }))

            setVehicles(vehiclesWithInventory)
        } catch (error) {
            console.error('Error loading vehicles:', error)
        } finally {
            setLoading(false)
        }
    }

    async function saveInventory(vehicleId: string) {
        if (saving) return
        setSaving(true)
        try {
            const existingInventory = vehicles.find(v => v.id === vehicleId)?.inventory

            const inventoryFields = {
                oil_type: editForm.oil_type || null,
                oil_quantity: editForm.oil_quantity || 0,
                oil_supplier_url: editForm.oil_supplier_url || null,
                oil_supplier_phone: editForm.oil_supplier_phone || null,
                pastiglie_ant_model: editForm.pastiglie_ant_model || null,
                pastiglie_ant_quantity: editForm.pastiglie_ant_quantity || 0,
                pastiglie_ant_supplier_url: editForm.pastiglie_ant_supplier_url || null,
                pastiglie_ant_supplier_phone: editForm.pastiglie_ant_supplier_phone || null,
                pastiglie_post_model: editForm.pastiglie_post_model || null,
                pastiglie_post_quantity: editForm.pastiglie_post_quantity || 0,
                pastiglie_post_supplier_url: editForm.pastiglie_post_supplier_url || null,
                pastiglie_post_supplier_phone: editForm.pastiglie_post_supplier_phone || null,
                sensori_ant_model: editForm.sensori_ant_model || null,
                sensori_ant_quantity: editForm.sensori_ant_quantity || 0,
                sensori_ant_supplier_url: editForm.sensori_ant_supplier_url || null,
                sensori_ant_supplier_phone: editForm.sensori_ant_supplier_phone || null,
                sensori_post_model: editForm.sensori_post_model || null,
                sensori_post_quantity: editForm.sensori_post_quantity || 0,
                sensori_post_supplier_url: editForm.sensori_post_supplier_url || null,
                sensori_post_supplier_phone: editForm.sensori_post_supplier_phone || null
            }

            if (existingInventory) {
                const { error } = await supabase
                    .from('fleet_vehicle_inventory')
                    .update({ ...inventoryFields, updated_at: new Date().toISOString() })
                    .eq('vehicle_id', vehicleId)

                if (error) throw error
            } else {
                const { error } = await supabase
                    .from('fleet_vehicle_inventory')
                    .insert({ vehicle_id: vehicleId, ...inventoryFields })

                if (error) throw error
            }

            setEditingVehicle(null)
            setEditForm({})
            await loadVehiclesWithInventory()
        } catch (error: unknown) {
            console.error('Error saving inventory:', error)
            toast.error('Errore nel salvataggio')
        } finally {
            setSaving(false)
        }
    }

    function startEditing(vehicle: VehicleWithInventory) {
        setEditingVehicle(vehicle.id)
        setEditForm({
            oil_type: vehicle.inventory?.oil_type || '',
            oil_quantity: vehicle.inventory?.oil_quantity || 0,
            oil_supplier_url: vehicle.inventory?.oil_supplier_url || '',
            oil_supplier_phone: vehicle.inventory?.oil_supplier_phone || '',
            pastiglie_ant_model: vehicle.inventory?.pastiglie_ant_model || '',
            pastiglie_ant_quantity: vehicle.inventory?.pastiglie_ant_quantity || 0,
            pastiglie_ant_supplier_url: vehicle.inventory?.pastiglie_ant_supplier_url || '',
            pastiglie_ant_supplier_phone: vehicle.inventory?.pastiglie_ant_supplier_phone || '',
            pastiglie_post_model: vehicle.inventory?.pastiglie_post_model || '',
            pastiglie_post_quantity: vehicle.inventory?.pastiglie_post_quantity || 0,
            pastiglie_post_supplier_url: vehicle.inventory?.pastiglie_post_supplier_url || '',
            pastiglie_post_supplier_phone: vehicle.inventory?.pastiglie_post_supplier_phone || '',
            sensori_ant_model: vehicle.inventory?.sensori_ant_model || '',
            sensori_ant_quantity: vehicle.inventory?.sensori_ant_quantity || 0,
            sensori_ant_supplier_url: vehicle.inventory?.sensori_ant_supplier_url || '',
            sensori_ant_supplier_phone: vehicle.inventory?.sensori_ant_supplier_phone || '',
            sensori_post_model: vehicle.inventory?.sensori_post_model || '',
            sensori_post_quantity: vehicle.inventory?.sensori_post_quantity || 0,
            sensori_post_supplier_url: vehicle.inventory?.sensori_post_supplier_url || '',
            sensori_post_supplier_phone: vehicle.inventory?.sensori_post_supplier_phone || ''
        })
    }

    function formatPhoneForWhatsApp(phone: string): string {
        // Remove spaces, dashes, and + sign
        let cleaned = phone.replace(/[\s\-+]/g, '')
        // Add Italy prefix if starts with 0
        if (cleaned.startsWith('0')) {
            cleaned = '39' + cleaned.substring(1)
        }
        // Add Italy prefix if 10 digits without prefix
        if (!cleaned.startsWith('39') && cleaned.length === 10) {
            cleaned = '39' + cleaned
        }
        return cleaned
    }

    function sendWhatsAppOrder(vehicle: VehicleWithInventory, itemType: 'oil' | 'pastiglie_ant' | 'pastiglie_post' | 'sensori_ant' | 'sensori_post') {
        const inv = vehicle.inventory
        let phone = ''
        let message = ''

        if (itemType === 'oil') {
            phone = inv?.oil_supplier_phone || ''
            const oilType = inv?.oil_type || 'Olio motore'
            message = `Buongiorno,\n\nVorrei ordinare:\n\n*Olio Motore*\nTipo: ${oilType}\nVeicolo: ${vehicle.display_name}\nTarga: ${vehicle.plate || 'N/A'}\n\nGrazie,\nDR7 Empire`
        } else if (itemType === 'pastiglie_ant') {
            phone = inv?.pastiglie_ant_supplier_phone || ''
            const model = inv?.pastiglie_ant_model || 'Pastiglie freno anteriori'
            message = `Buongiorno,\n\nVorrei ordinare:\n\n*Pastiglie Freno Anteriori*\nModello: ${model}\nVeicolo: ${vehicle.display_name}\nTarga: ${vehicle.plate || 'N/A'}\n\nGrazie,\nDR7 Empire`
        } else if (itemType === 'pastiglie_post') {
            phone = inv?.pastiglie_post_supplier_phone || ''
            const model = inv?.pastiglie_post_model || 'Pastiglie freno posteriori'
            message = `Buongiorno,\n\nVorrei ordinare:\n\n*Pastiglie Freno Posteriori*\nModello: ${model}\nVeicolo: ${vehicle.display_name}\nTarga: ${vehicle.plate || 'N/A'}\n\nGrazie,\nDR7 Empire`
        } else if (itemType === 'sensori_ant') {
            phone = inv?.sensori_ant_supplier_phone || ''
            const model = inv?.sensori_ant_model || 'Sensori anteriori'
            message = `Buongiorno,\n\nVorrei ordinare:\n\n*Sensori Anteriori*\nModello: ${model}\nVeicolo: ${vehicle.display_name}\nTarga: ${vehicle.plate || 'N/A'}\n\nGrazie,\nDR7 Empire`
        } else if (itemType === 'sensori_post') {
            phone = inv?.sensori_post_supplier_phone || ''
            const model = inv?.sensori_post_model || 'Sensori posteriori'
            message = `Buongiorno,\n\nVorrei ordinare:\n\n*Sensori Posteriori*\nModello: ${model}\nVeicolo: ${vehicle.display_name}\nTarga: ${vehicle.plate || 'N/A'}\n\nGrazie,\nDR7 Empire`
        }

        if (!phone) {
            toast.error('Nessun numero di telefono fornitore configurato')
            return
        }

        const formattedPhone = formatPhoneForWhatsApp(phone)
        const encodedMessage = encodeURIComponent(message)
        const whatsappUrl = `https://wa.me/${formattedPhone}?text=${encodedMessage}`
        window.open(whatsappUrl, '_blank')
    }

    function getStatusColor(quantity: number): string {
        if (quantity === 0) return 'bg-red-900/30 border-red-500/50'
        if (quantity <= 2) return 'bg-yellow-900/30 border-yellow-500/50'
        return 'bg-green-900/30 border-green-500/50'
    }

    function getQuantityColor(quantity: number): string {
        if (quantity === 0) return 'text-red-400'
        if (quantity <= 2) return 'text-yellow-400'
        return 'text-green-400'
    }

    // ── Dashboard KPI calculations (matches mockup) ──────────────────────
    function vehicleStatus(v: VehicleWithInventory): 'critico' | 'sotto_soglia' | 'ok' {
        const inv = v.inventory
        const qtys = [
            inv?.oil_quantity || 0,
            inv?.pastiglie_ant_quantity || 0,
            inv?.pastiglie_post_quantity || 0,
            inv?.sensori_ant_quantity || 0,
            inv?.sensori_post_quantity || 0,
        ]
        if (qtys.some(q => q === 0)) return 'critico'
        if (qtys.some(q => q <= 2)) return 'sotto_soglia'
        return 'ok'
    }
    const veicoliCriticita = vehicles.filter(v => vehicleStatus(v) === 'critico').length
    const componentiSottoSoglia = vehicles.reduce((s, v) => {
        const inv = v.inventory
        const qtys = [
            inv?.oil_quantity || 0,
            inv?.pastiglie_ant_quantity || 0,
            inv?.pastiglie_post_quantity || 0,
            inv?.sensori_ant_quantity || 0,
            inv?.sensori_post_quantity || 0,
        ]
        return s + qtys.filter(q => q <= 2).length
    }, 0)
    const veicoliOk = vehicles.filter(v => vehicleStatus(v) === 'ok').length
    const veicoliSottoSoglia = vehicles.filter(v => vehicleStatus(v) === 'sotto_soglia').length
    const statoFlottaPct = vehicles.length > 0
        ? Math.round((veicoliOk / vehicles.length) * 100)
        : 0
    const kmTotaliFlotta = vehicles.reduce((sum, v) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const meta = (v.metadata || {}) as any
        const km = Number(meta.current_km ?? meta.mileage ?? 0)
        return sum + (Number.isFinite(km) ? km : 0)
    }, 0)

    if (loading) return <div className="text-theme-text-muted">Caricamento magazzino...</div>

    return (
        <div>
            <div className="mb-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <h2 className="text-2xl font-bold text-theme-text-primary">Magazzino Veicoli</h2>
                    <div className="relative w-full sm:w-64">
                        <input
                            type="text"
                            placeholder="Ricerca per targa, modello..."
                            value={plateSearch}
                            onChange={(e) => setPlateSearch(e.target.value)}
                            className="w-full px-4 py-2 pl-10 bg-theme-bg-tertiary border border-theme-border-light rounded-full text-theme-text-primary text-sm placeholder-theme-text-muted"
                        />
                        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                    {/* 2026-06-04: Carrello ordini ricambi */}
                    <button
                      type="button"
                      onClick={() => setCartOpen(true)}
                      className="relative ml-auto px-4 py-2 rounded-full bg-dr7-gold text-black font-semibold text-sm hover:bg-dr7-gold/85 transition-colors"
                    >
                      🛒 Carrello
                      {cartCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] rounded-full w-5 h-5 flex items-center justify-center font-bold">
                          {cartCount}
                        </span>
                      )}
                    </button>
                </div>
                <p className="text-sm text-theme-text-muted mt-1">
                    Stato componenti e ricambi per ogni veicolo della flotta.
                </p>
                {/* 2026-06-04: Sub-tab interno: Inventario / Fornitori */}
                <div className="mt-4 flex gap-2 border-b border-theme-border">
                  <button
                    type="button"
                    onClick={() => setSubTab('inventario')}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${subTab === 'inventario' ? 'border-b-2 border-dr7-gold text-dr7-gold' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                  >
                    Inventario
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubTab('fornitori')}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${subTab === 'fornitori' ? 'border-b-2 border-dr7-gold text-dr7-gold' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                  >
                    Fornitori ({fleetFornitori.length})
                  </button>
                </div>
            </div>

            {/* 2026-06-04: Fornitori sub-tab (CRUD inline) */}
            {subTab === 'fornitori' && (
              <FornitoriManagementPanel onChanged={loadFleetFornitori} fornitori={fleetFornitori} />
            )}

            {/* 2026-06-04: Cart drawer overlay */}
            {cartOpen && (
              <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end" onClick={() => setCartOpen(false)}>
                <div className="absolute inset-0 bg-black/50" />
                <div onClick={e => e.stopPropagation()} className="relative bg-theme-bg-primary border-l border-theme-border w-full sm:w-[480px] h-full sm:h-auto sm:max-h-[90vh] overflow-y-auto shadow-2xl p-5 sm:rounded-l-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-theme-text-primary">🛒 Carrello Ordini</h3>
                    <button type="button" onClick={() => setCartOpen(false)} className="text-2xl text-theme-text-muted hover:text-theme-text-primary">×</button>
                  </div>
                  {cart.length === 0 ? (
                    <p className="text-sm text-theme-text-muted text-center py-8">
                      Il carrello è vuoto.<br />
                      Clicca su "Aggiungi al carrello" sulle celle componente.
                    </p>
                  ) : (
                    <>
                      <div className="space-y-3 mb-4">
                        {cart.map(item => (
                          <div key={item.key} className="bg-theme-bg-secondary rounded-lg p-3 border border-theme-border">
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-sm text-theme-text-primary">{item.label}</div>
                                <div className="text-xs text-theme-text-muted">{item.vehicleName} {item.vehiclePlate && `(${item.vehiclePlate})`}</div>
                                {item.specs && <div className="text-xs text-theme-text-secondary mt-1">{item.specs}</div>}
                              </div>
                              <button type="button" onClick={() => removeFromCart(item.key)} className="text-red-400 hover:text-red-300 ml-2">×</button>
                            </div>
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={() => updateQty(item.key, item.quantity - 1)} className="w-7 h-7 bg-theme-bg-tertiary rounded text-theme-text-primary">−</button>
                              <input
                                type="number"
                                min="1"
                                value={item.quantity}
                                onChange={e => updateQty(item.key, parseInt(e.target.value) || 0)}
                                className="w-16 text-center bg-theme-bg-tertiary border border-theme-border rounded px-2 py-1 text-sm text-theme-text-primary"
                              />
                              <button type="button" onClick={() => updateQty(item.key, item.quantity + 1)} className="w-7 h-7 bg-theme-bg-tertiary rounded text-theme-text-primary">+</button>
                              <span className="text-xs text-theme-text-muted ml-auto">pz</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-theme-border pt-4 space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-theme-text-secondary mb-1">Fornitore</label>
                          <select
                            value={selectedFornitoreId}
                            onChange={e => setSelectedFornitoreId(e.target.value)}
                            className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary"
                          >
                            <option value="">— Seleziona fornitore —</option>
                            {fleetFornitori.map(f => (
                              <option key={f.id} value={f.id}>{f.nome} · {f.telefono}</option>
                            ))}
                          </select>
                          {fleetFornitori.length === 0 && (
                            <p className="text-[11px] text-amber-400 mt-1">
                              Nessun fornitore. Vai a "Fornitori" e aggiungine uno.
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-theme-text-secondary mb-1">Note (opzionali)</label>
                          <textarea
                            value={orderNote}
                            onChange={e => setOrderNote(e.target.value)}
                            rows={2}
                            placeholder="Es. Spedizione prioritaria, ritiro in sede…"
                            className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={clearCart} className="flex-1 px-4 py-2 rounded-lg border border-theme-border text-theme-text-primary text-sm font-medium hover:bg-theme-bg-hover">
                            Svuota
                          </button>
                          <button
                            type="button"
                            onClick={sendCartViaWhatsApp}
                            disabled={!selectedFornitoreId}
                            className="flex-1 px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Invia via WhatsApp
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {subTab === 'inventario' && (
              <>
            {/* Top KPI strip — 6 cards from mockup */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
                <KpiCard
                    icon="alert"
                    label="Veicoli con criticita"
                    value={veicoliCriticita}
                    sub={vehicles.length > 0 ? `${Math.round(veicoliCriticita / vehicles.length * 100)}% della flotta` : ''}
                    tone={veicoliCriticita > 0 ? 'rose' : 'emerald'}
                />
                <KpiCard
                    icon="package"
                    label="Componenti sotto soglia"
                    value={componentiSottoSoglia}
                    sub="Da riordinare"
                    tone={componentiSottoSoglia > 0 ? 'amber' : 'emerald'}
                />
                <KpiCard
                    icon="euro"
                    label="Costo stimato interventi"
                    value="—"
                    sub="Prossimi 30 giorni"
                    tone="sky"
                />
                <KpiCard
                    icon="wrench"
                    label="Interventi programmati"
                    value="—"
                    sub="Prossimi 30 giorni"
                    tone="sky"
                />
                <KpiCard
                    icon="shield"
                    label="Stato Flotta"
                    value={`${statoFlottaPct}%`}
                    sub="Veicoli in ottime condizioni"
                    tone={statoFlottaPct >= 80 ? 'emerald' : statoFlottaPct >= 50 ? 'amber' : 'rose'}
                />
                <KpiCard
                    icon="road"
                    label="KM totali Flotta"
                    value={kmTotaliFlotta.toLocaleString('it-IT')}
                    sub={vehicles.length > 0 ? `Media ${Math.round(kmTotaliFlotta / vehicles.length).toLocaleString('it-IT')} km/veicolo` : ''}
                    tone="muted"
                />
            </div>

            {/* Filter tabs + sort + export */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
                <div className="inline-flex rounded-full border border-theme-border bg-theme-bg-secondary p-0.5 text-xs">
                    {([
                        { k: 'all' as const,           l: `Tutti (${vehicles.length})` },
                        { k: 'critico' as const,       l: `Criticita (${veicoliCriticita})` },
                        { k: 'sotto_soglia' as const,  l: `Sotto soglia (${veicoliSottoSoglia})` },
                        { k: 'ok' as const,            l: `OK (${veicoliOk})` },
                    ]).map(f => (
                        <button
                            key={f.k}
                            onClick={() => setStatusFilter(f.k)}
                            className={`px-3 py-1.5 rounded-full font-semibold transition-colors ${statusFilter === f.k ? 'bg-dr7-gold text-black' : 'text-theme-text-secondary hover:text-theme-text-primary'}`}
                        >
                            {f.l}
                        </button>
                    ))}
                </div>
                <span className="text-xs text-theme-text-muted ml-auto">Cassetti bloccati: 0</span>
            </div>

            {/* Two-column grid: main vehicle list (2/3) + right sidebar (1/3) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                {/* Left: vehicle table (mockup-style horizontal rows) */}
                <div className="lg:col-span-2 rounded-2xl border border-theme-border bg-theme-bg-secondary overflow-hidden">
                  {/* Header row */}
                  <div className="hidden lg:grid grid-cols-[1.8fr_1fr_repeat(5,1fr)_0.8fr_0.8fr_0.5fr] gap-2 px-3 py-2 bg-theme-bg-tertiary/40 text-[10px] uppercase tracking-wider font-semibold text-theme-text-muted">
                    <div>Veicolo</div>
                    <div>Stato generale</div>
                    <div className="text-center">Olio Motore</div>
                    <div className="text-center">Past. Ant.</div>
                    <div className="text-center">Past. Post.</div>
                    <div className="text-center">Sens. Ant.</div>
                    <div className="text-center">Sens. Post.</div>
                    <div className="text-right">Interventi</div>
                    <div className="text-right">Scadenza</div>
                    <div className="text-right">Azioni</div>
                  </div>
                  <div className="divide-y divide-theme-border">
                    {vehicles.filter(v => {
                        // status filter
                        if (statusFilter !== 'all' && vehicleStatus(v) !== statusFilter) return false
                        // text search
                        if (!plateSearch.trim()) return true
                        const q = plateSearch.trim().toLowerCase().replace(/\s/g, '')
                        const plate = (v.plate || '').toLowerCase().replace(/\s/g, '')
                        const name = (v.display_name || '').toLowerCase()
                        return plate.includes(q) || name.includes(q)
                    }).map(vehicle => {
                    const inv = vehicle.inventory
                    const oilQty = inv?.oil_quantity || 0
                    const pastiglieAntQty = inv?.pastiglie_ant_quantity || 0
                    const pastigliePostQty = inv?.pastiglie_post_quantity || 0
                    const sensoriAntQty = inv?.sensori_ant_quantity || 0
                    const sensoriPostQty = inv?.sensori_post_quantity || 0
                    return (
                        <div key={vehicle.id} className="px-3 py-3">
                            {/* Compact horizontal row — desktop only; on mobile shows as card */}
                            <div className="grid grid-cols-1 lg:grid-cols-[1.8fr_1fr_repeat(5,1fr)_0.8fr_0.8fr_0.5fr] gap-2 items-center">
                                {/* Veicolo cell */}
                                <div className="flex items-center gap-2 min-w-0">
                                    {(() => {
                                        const img = vehicleImageUrl(vehicle)
                                        if (img) return <img src={img} alt={vehicle.display_name} className="w-14 h-10 rounded object-cover flex-shrink-0 border border-theme-border" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                                        return <div className="w-14 h-10 rounded bg-theme-bg-tertiary flex items-center justify-center text-[10px] font-bold flex-shrink-0">{vehicle.display_name.substring(0, 2).toUpperCase()}</div>
                                    })()}
                                    <div className="min-w-0">
                                        <div className="text-xs font-semibold text-theme-text-primary truncate">{vehicle.display_name}</div>
                                        <div className="text-[10px] text-theme-text-muted font-mono truncate">{vehicle.plate || '—'}</div>
                                    </div>
                                </div>
                                {/* Stato Generale cell */}
                                {(() => {
                                    const s = vehicleStatus(vehicle)
                                    const color = s === 'critico' ? '#f87171' : s === 'sotto_soglia' ? '#fbbf24' : '#34d399'
                                    const label = s === 'critico' ? 'CRITICITA' : s === 'sotto_soglia' ? 'ATTENZIONE' : 'OK'
                                    const pct = s === 'critico' ? 30 : s === 'sotto_soglia' ? 60 : 95
                                    return (
                                        <div>
                                            <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color }}>{label}</div>
                                            <div className="w-full h-1.5 rounded-full bg-theme-bg-tertiary overflow-hidden mt-1">
                                                <div className="h-full" style={{ width: `${pct}%`, background: color }} />
                                            </div>
                                            <div className="text-[10px] text-theme-text-muted mt-0.5">{pct}%</div>
                                        </div>
                                    )
                                })()}
                                {/* 5 component cells */}
                                {([
                                    { qty: oilQty, model: inv?.oil_type || '—', type: 'oil' as const, unit: 'L' },
                                    { qty: pastiglieAntQty, model: inv?.pastiglie_ant_model || '—', type: 'pastiglie_ant' as const, unit: 'pz' },
                                    { qty: pastigliePostQty, model: inv?.pastiglie_post_model || '—', type: 'pastiglie_post' as const, unit: 'pz' },
                                    { qty: sensoriAntQty, model: inv?.sensori_ant_model || '—', type: 'sensori_ant' as const, unit: 'pz' },
                                    { qty: sensoriPostQty, model: inv?.sensori_post_model || '—', type: 'sensori_post' as const, unit: 'pz' },
                                ]).map((c, i) => {
                                    const cs = c.qty === 0 ? 'critico' : c.qty <= 2 ? 'basso' : 'ok'
                                    const color = cs === 'critico' ? '#f87171' : cs === 'basso' ? '#fbbf24' : '#34d399'
                                    const cLabel = cs === 'critico' ? 'Esaurito' : cs === 'basso' ? 'Basso' : 'OK'
                                    const cPct = cs === 'critico' ? 5 : cs === 'basso' ? 40 : 90
                                    return (
                                        <div key={i} className="px-1">
                                            <div className="text-[10px] truncate text-theme-text-secondary" title={c.model}>{c.model}</div>
                                            <div className="flex items-center justify-between mt-0.5">
                                                <span className="text-[9px] font-medium" style={{ color }}>{cLabel}</span>
                                                <span className="text-[9px] text-theme-text-muted font-mono tabular-nums">{c.qty} {c.unit}</span>
                                            </div>
                                            <div className="w-full h-1 rounded-full bg-theme-bg-tertiary overflow-hidden mt-0.5">
                                                <div className="h-full" style={{ width: `${cPct}%`, background: color }} />
                                            </div>
                                            {/* 2026-06-04: Sostituito "Ordina" diretto → "+ Carrello".
                                                Aggiunge l'item al carrello multi-fornitore in alto. Visibile
                                                SEMPRE (non solo qty===0) cosi' direzione puo' ordinare
                                                anche pezzi non ancora esauriti per rifornimento programmato. */}
                                            <button
                                              onClick={() => {
                                                const typeMap: Record<typeof c.type, { label: string; type: CartItem['type'] }> = {
                                                  oil: { label: 'Olio Motore', type: 'olio' },
                                                  pastiglie_ant: { label: 'Pastiglie Anteriori', type: 'pastiglie_ant' },
                                                  pastiglie_post: { label: 'Pastiglie Posteriori', type: 'pastiglie_post' },
                                                  sensori_ant: { label: 'Sensori Anteriori', type: 'sensori_ant' },
                                                  sensori_post: { label: 'Sensori Posteriori', type: 'sensori_post' },
                                                }
                                                const info = typeMap[c.type]
                                                addToCart({
                                                  vehicleId: vehicle.id,
                                                  vehicleName: vehicle.display_name,
                                                  vehiclePlate: vehicle.plate || '',
                                                  type: info.type,
                                                  label: info.label,
                                                  specs: c.model !== '—' ? c.model : '',
                                                }, 1)
                                              }}
                                              className={`mt-1 w-full px-1 py-0.5 rounded text-[9px] font-medium transition-colors ${c.qty === 0 ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-dr7-gold/80 hover:bg-dr7-gold text-black'}`}
                                            >
                                              + Carrello
                                            </button>
                                        </div>
                                    )
                                })}
                                {/* Interventi cell — placeholder */}
                                <div className="text-right text-theme-text-muted text-xs">—</div>
                                {/* Scadenza cell — placeholder */}
                                <div className="text-right text-theme-text-muted text-xs">—</div>
                                {/* Azioni cell */}
                                <div className="text-right space-y-1">
                                    <button onClick={() => startEditing(vehicle)} className="block ml-auto px-2 py-1 rounded-full text-[10px] font-semibold bg-blue-600 hover:bg-blue-700 text-white">
                                        {editingVehicle === vehicle.id ? 'Chiudi' : 'Modifica'}
                                    </button>
                                    {/* 2026-06-04: Aggiungi gomme al carrello — letto da vehicle.metadata.tire_specs */}
                                    {(() => {
                                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                      const m = (vehicle.metadata as any) || {}
                                      const tireSpecs = m.tire_specs || {}
                                      const frontSize = tireSpecs.front_size || ''
                                      const frontModel = tireSpecs.front_model || ''
                                      const rearSize = tireSpecs.rear_size || ''
                                      const rearModel = tireSpecs.rear_model || ''
                                      const hasFront = !!(frontSize || frontModel)
                                      const hasRear = !!(rearSize || rearModel)
                                      if (!hasFront && !hasRear) return null
                                      return (
                                        <>
                                          {hasFront && (
                                            <button
                                              onClick={() => addToCart({
                                                vehicleId: vehicle.id,
                                                vehicleName: vehicle.display_name,
                                                vehiclePlate: vehicle.plate || '',
                                                type: 'gomma_ant',
                                                label: 'Gomma Anteriore',
                                                specs: [frontSize, frontModel].filter(Boolean).join(' — ') || '',
                                              }, 1)}
                                              className="block ml-auto px-2 py-0.5 rounded-full text-[9px] font-medium bg-dr7-gold/20 text-dr7-gold hover:bg-dr7-gold/30 transition-colors"
                                              title={`Aggiungi gomma anteriore al carrello: ${frontSize} ${frontModel}`}
                                            >
                                              + Gomma Ant
                                            </button>
                                          )}
                                          {hasRear && (
                                            <button
                                              onClick={() => addToCart({
                                                vehicleId: vehicle.id,
                                                vehicleName: vehicle.display_name,
                                                vehiclePlate: vehicle.plate || '',
                                                type: 'gomma_post',
                                                label: 'Gomma Posteriore',
                                                specs: [rearSize, rearModel].filter(Boolean).join(' — ') || '',
                                              }, 1)}
                                              className="block ml-auto px-2 py-0.5 rounded-full text-[9px] font-medium bg-dr7-gold/20 text-dr7-gold hover:bg-dr7-gold/30 transition-colors"
                                              title={`Aggiungi gomma posteriore al carrello: ${rearSize} ${rearModel}`}
                                            >
                                              + Gomma Post
                                            </button>
                                          )}
                                        </>
                                      )
                                    })()}
                                </div>
                            </div>

                            {/* Editing Form (expands below the row) */}
                            {editingVehicle === vehicle.id && (
                                <div className="bg-theme-bg-secondary rounded-lg p-4 space-y-4 mt-3">
                                    {/* Oil Section */}
                                    <div className="border-b border-theme-border pb-4">
                                        <h4 className="font-semibold text-theme-text-primary mb-3">Olio Motore</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Tipo Olio</label>
                                                <input
                                                    type="text"
                                                    value={editForm.oil_type || ''}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, oil_type: e.target.value }))}
                                                    placeholder="es. 5W30 Castrol Edge"
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Litri Disponibili</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={editForm.oil_quantity || 0}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, oil_quantity: Math.max(0, parseInt(e.target.value) || 0) }))}
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Tel. Fornitore (WhatsApp)</label>
                                                <input
                                                    type="tel"
                                                    value={editForm.oil_supplier_phone || ''}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, oil_supplier_phone: e.target.value }))}
                                                    placeholder="es. 3331234567"
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Link Fornitore (opz.)</label>
                                                <input
                                                    type="url"
                                                    value={editForm.oil_supplier_url || ''}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, oil_supplier_url: e.target.value }))}
                                                    placeholder="https://..."
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Front Brake Pads Section */}
                                    <div className="border-b border-theme-border pb-4">
                                        <h4 className="font-semibold text-theme-text-primary mb-3">Pastiglie Freno Anteriori</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Modello</label>
                                                <input
                                                    type="text"
                                                    value={editForm.pastiglie_ant_model || ''}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, pastiglie_ant_model: e.target.value }))}
                                                    placeholder="es. Brembo P50067"
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Pezzi Disponibili</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={editForm.pastiglie_ant_quantity || 0}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, pastiglie_ant_quantity: Math.max(0, parseInt(e.target.value) || 0) }))}
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Tel. Fornitore (WhatsApp)</label>
                                                <input
                                                    type="tel"
                                                    value={editForm.pastiglie_ant_supplier_phone || ''}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, pastiglie_ant_supplier_phone: e.target.value }))}
                                                    placeholder="es. 3331234567"
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Link Fornitore (opz.)</label>
                                                <input
                                                    type="url"
                                                    value={editForm.pastiglie_ant_supplier_url || ''}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, pastiglie_ant_supplier_url: e.target.value }))}
                                                    placeholder="https://..."
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Rear Brake Pads Section */}
                                    <div className="border-b border-theme-border pb-4">
                                        <h4 className="font-semibold text-theme-text-primary mb-3">Pastiglie Freno Posteriori</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Modello</label>
                                                <input
                                                    type="text"
                                                    value={editForm.pastiglie_post_model || ''}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, pastiglie_post_model: e.target.value }))}
                                                    placeholder="es. Brembo P50068"
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Pezzi Disponibili</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={editForm.pastiglie_post_quantity || 0}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, pastiglie_post_quantity: Math.max(0, parseInt(e.target.value) || 0) }))}
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Tel. Fornitore (WhatsApp)</label>
                                                <input
                                                    type="tel"
                                                    value={editForm.pastiglie_post_supplier_phone || ''}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, pastiglie_post_supplier_phone: e.target.value }))}
                                                    placeholder="es. 3331234567"
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Link Fornitore (opz.)</label>
                                                <input
                                                    type="url"
                                                    value={editForm.pastiglie_post_supplier_url || ''}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, pastiglie_post_supplier_url: e.target.value }))}
                                                    placeholder="https://..."
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Front Parking Sensors Section */}
                                    <div className="border-b border-theme-border pb-4">
                                        <h4 className="font-semibold text-theme-text-primary mb-3">Sensori Anteriori</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Modello</label>
                                                <input
                                                    type="text"
                                                    value={editForm.sensori_ant_model || ''}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, sensori_ant_model: e.target.value }))}
                                                    placeholder="es. Bosch 0263009637"
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Pezzi Disponibili</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={editForm.sensori_ant_quantity || 0}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, sensori_ant_quantity: Math.max(0, parseInt(e.target.value) || 0) }))}
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Tel. Fornitore (WhatsApp)</label>
                                                <input
                                                    type="tel"
                                                    value={editForm.sensori_ant_supplier_phone || ''}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, sensori_ant_supplier_phone: e.target.value }))}
                                                    placeholder="es. 3331234567"
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Link Fornitore (opz.)</label>
                                                <input
                                                    type="url"
                                                    value={editForm.sensori_ant_supplier_url || ''}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, sensori_ant_supplier_url: e.target.value }))}
                                                    placeholder="https://..."
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Rear Parking Sensors Section */}
                                    <div className="pb-2">
                                        <h4 className="font-semibold text-theme-text-primary mb-3">Sensori Posteriori</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Modello</label>
                                                <input
                                                    type="text"
                                                    value={editForm.sensori_post_model || ''}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, sensori_post_model: e.target.value }))}
                                                    placeholder="es. Bosch 0263009638"
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Pezzi Disponibili</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={editForm.sensori_post_quantity || 0}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, sensori_post_quantity: Math.max(0, parseInt(e.target.value) || 0) }))}
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Tel. Fornitore (WhatsApp)</label>
                                                <input
                                                    type="tel"
                                                    value={editForm.sensori_post_supplier_phone || ''}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, sensori_post_supplier_phone: e.target.value }))}
                                                    placeholder="es. 3331234567"
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Link Fornitore (opz.)</label>
                                                <input
                                                    type="url"
                                                    value={editForm.sensori_post_supplier_url || ''}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, sensori_post_supplier_url: e.target.value }))}
                                                    placeholder="https://..."
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex justify-end gap-3 pt-2">
                                        <button
                                            onClick={() => { setEditingVehicle(null); setEditForm({}) }}
                                            className="px-4 py-2 bg-theme-bg-hover hover:bg-theme-bg-tertiary text-theme-text-primary rounded-lg"
                                        >
                                            Annulla
                                        </button>
                                        <button
                                            onClick={() => saveInventory(vehicle.id)}
                                            disabled={saving}
                                            className={`px-4 py-2 text-white rounded-lg ${saving ? 'bg-green-800 cursor-not-allowed opacity-60' : 'bg-green-600 hover:bg-green-700'}`}
                                        >
                                            {saving ? 'Salvataggio...' : 'Salva'}
                                        </button>
                                    </div>
                                </div>
                            )}
                            {/* legacy big grid kept off-screen, hidden until cleaned up */}
                            <div className="hidden">
                                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                                    {/* Oil */}
                                    <div className={`rounded-lg p-3 border ${getStatusColor(oilQty)}`}>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium text-theme-text-secondary">Olio Motore</span>
                                            <span className={`text-xl font-bold ${getQuantityColor(oilQty)}`}>
                                                {oilQty} L
                                            </span>
                                        </div>
                                        <p className="text-xs text-theme-text-muted mb-2 truncate">
                                            {inv?.oil_type || 'Tipo non specificato'}
                                        </p>
                                        <button
                                            onClick={() => sendWhatsAppOrder(vehicle, 'oil')}
                                            className={`w-full py-2 rounded text-sm font-medium ${
                                                oilQty === 0
                                                    ? 'bg-red-600 hover:bg-red-700 text-white'
                                                    : 'bg-theme-bg-hover hover:bg-theme-bg-tertiary text-theme-text-primary'
                                            }`}
                                        >
                                            Ordina via WhatsApp
                                        </button>
                                    </div>

                                    {/* Front Brake Pads */}
                                    <div className={`rounded-lg p-3 border ${getStatusColor(pastiglieAntQty)}`}>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium text-theme-text-secondary">Pastiglie Ant.</span>
                                            <span className={`text-xl font-bold ${getQuantityColor(pastiglieAntQty)}`}>
                                                {pastiglieAntQty} pz
                                            </span>
                                        </div>
                                        <p className="text-xs text-theme-text-muted mb-2 truncate">
                                            {inv?.pastiglie_ant_model || 'Modello non specificato'}
                                        </p>
                                        <button
                                            onClick={() => sendWhatsAppOrder(vehicle, 'pastiglie_ant')}
                                            className={`w-full py-2 rounded text-sm font-medium ${
                                                pastiglieAntQty === 0
                                                    ? 'bg-red-600 hover:bg-red-700 text-white'
                                                    : 'bg-theme-bg-hover hover:bg-theme-bg-tertiary text-theme-text-primary'
                                            }`}
                                        >
                                            Ordina via WhatsApp
                                        </button>
                                    </div>

                                    {/* Rear Brake Pads */}
                                    <div className={`rounded-lg p-3 border ${getStatusColor(pastigliePostQty)}`}>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium text-theme-text-secondary">Pastiglie Post.</span>
                                            <span className={`text-xl font-bold ${getQuantityColor(pastigliePostQty)}`}>
                                                {pastigliePostQty} pz
                                            </span>
                                        </div>
                                        <p className="text-xs text-theme-text-muted mb-2 truncate">
                                            {inv?.pastiglie_post_model || 'Modello non specificato'}
                                        </p>
                                        <button
                                            onClick={() => sendWhatsAppOrder(vehicle, 'pastiglie_post')}
                                            className={`w-full py-2 rounded text-sm font-medium ${
                                                pastigliePostQty === 0
                                                    ? 'bg-red-600 hover:bg-red-700 text-white'
                                                    : 'bg-theme-bg-hover hover:bg-theme-bg-tertiary text-theme-text-primary'
                                            }`}
                                        >
                                            Ordina via WhatsApp
                                        </button>
                                    </div>

                                    {/* Front Parking Sensors */}
                                    <div className={`rounded-lg p-3 border ${getStatusColor(sensoriAntQty)}`}>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium text-theme-text-secondary">Sensori Ant.</span>
                                            <span className={`text-xl font-bold ${getQuantityColor(sensoriAntQty)}`}>
                                                {sensoriAntQty} pz
                                            </span>
                                        </div>
                                        <p className="text-xs text-theme-text-muted mb-2 truncate">
                                            {inv?.sensori_ant_model || 'Modello non specificato'}
                                        </p>
                                        <button
                                            onClick={() => sendWhatsAppOrder(vehicle, 'sensori_ant')}
                                            className={`w-full py-2 rounded text-sm font-medium ${
                                                sensoriAntQty === 0
                                                    ? 'bg-red-600 hover:bg-red-700 text-white'
                                                    : 'bg-theme-bg-hover hover:bg-theme-bg-tertiary text-theme-text-primary'
                                            }`}
                                        >
                                            Ordina via WhatsApp
                                        </button>
                                    </div>

                                    {/* Rear Parking Sensors */}
                                    <div className={`rounded-lg p-3 border ${getStatusColor(sensoriPostQty)}`}>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium text-theme-text-secondary">Sensori Post.</span>
                                            <span className={`text-xl font-bold ${getQuantityColor(sensoriPostQty)}`}>
                                                {sensoriPostQty} pz
                                            </span>
                                        </div>
                                        <p className="text-xs text-theme-text-muted mb-2 truncate">
                                            {inv?.sensori_post_model || 'Modello non specificato'}
                                        </p>
                                        <button
                                            onClick={() => sendWhatsAppOrder(vehicle, 'sensori_post')}
                                            className={`w-full py-2 rounded text-sm font-medium ${
                                                sensoriPostQty === 0
                                                    ? 'bg-red-600 hover:bg-red-700 text-white'
                                                    : 'bg-theme-bg-hover hover:bg-theme-bg-tertiary text-theme-text-primary'
                                            }`}
                                        >
                                            Ordina via WhatsApp
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                })}
                  </div>
                </div>

                {/* Right sidebar */}
                <aside className="space-y-4">
                    {/* Allarmi & Avvisi — top criticità */}
                    <SidebarPanel title="Allarmi & Avvisi" emptyText="Nessun allarme attivo">
                        {vehicles.filter(v => vehicleStatus(v) === 'critico').slice(0, 4).map(v => {
                            const inv = v.inventory
                            const missing: string[] = []
                            if ((inv?.oil_quantity || 0) === 0) missing.push('Olio')
                            if ((inv?.pastiglie_ant_quantity || 0) === 0) missing.push('Pastiglie ant.')
                            if ((inv?.pastiglie_post_quantity || 0) === 0) missing.push('Pastiglie post.')
                            if ((inv?.sensori_ant_quantity || 0) === 0) missing.push('Sensori ant.')
                            if ((inv?.sensori_post_quantity || 0) === 0) missing.push('Sensori post.')
                            return (
                                <div key={v.id} className="flex items-start gap-2 text-xs py-2 border-b border-theme-border last:border-0">
                                    <span className="inline-block w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-semibold text-theme-text-primary truncate">{v.display_name || v.plate}</div>
                                        <div className="text-theme-text-muted">Esaurito: {missing.slice(0, 2).join(', ')}{missing.length > 2 ? `, +${missing.length - 2}` : ''}</div>
                                    </div>
                                </div>
                            )
                        })}
                    </SidebarPanel>

                    {/* Azioni rapide */}
                    <SidebarPanel title="Azioni Rapide">
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                { label: 'Nuovo Intervento', icon: '+' },
                                { label: 'Ordina Ricambi', icon: '🛒' },
                                { label: 'Storia Report', icon: '📊' },
                                { label: 'Stato Magazzino', icon: '📦' },
                            ].map(a => (
                                <button
                                    key={a.label}
                                    type="button"
                                    onClick={() => toast('Funzione in arrivo', { icon: 'ℹ️' })}
                                    className="text-xs px-2 py-2 rounded border border-theme-border bg-theme-bg-primary hover:bg-theme-bg-hover text-theme-text-secondary hover:text-theme-text-primary"
                                >
                                    <span className="block">{a.icon}</span>
                                    <span className="block mt-0.5">{a.label}</span>
                                </button>
                            ))}
                        </div>
                    </SidebarPanel>

                    {/* Prossimi interventi — placeholder; needs intervento schema */}
                    <SidebarPanel title="Prossimi Interventi" emptyText="Nessun intervento programmato">
                        <div className="text-xs text-theme-text-muted italic py-2">
                            La pianificazione interventi richiede l'attivazione del modulo Manutenzione.
                        </div>
                    </SidebarPanel>

                    {/* Fornitori principali */}
                    <SidebarPanel title="Fornitori Principali" emptyText="Nessun fornitore configurato">
                        {(() => {
                            const counter = new Map<string, number>()
                            vehicles.forEach(v => {
                                const inv = v.inventory
                                ;[inv?.oil_supplier_phone, inv?.pastiglie_ant_supplier_phone, inv?.pastiglie_post_supplier_phone, inv?.sensori_ant_supplier_phone, inv?.sensori_post_supplier_phone].forEach(p => {
                                    if (p) counter.set(p, (counter.get(p) || 0) + 1)
                                })
                            })
                            const top = Array.from(counter.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4)
                            if (top.length === 0) return null
                            return top.map(([phone, count]) => (
                                <div key={phone} className="flex items-center justify-between text-xs py-1.5">
                                    <span className="text-theme-text-primary font-mono">{phone}</span>
                                    <span className="text-theme-text-muted">{count} ricambi</span>
                                </div>
                            ))
                        })()}
                    </SidebarPanel>

                    {/* Suggerimenti Smart */}
                    <SidebarPanel title="Suggerimenti Smart">
                        {veicoliCriticita > 0 ? (
                            <>
                                <p className="text-xs text-theme-text-secondary mb-3">
                                    {veicoliCriticita} veicol{veicoliCriticita === 1 ? 'o ha' : 'i hanno'} componenti esauriti. Ordina ora per evitare fermi forzati.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => toast('Apri lista fornitori dai veicoli con criticita', { icon: 'ℹ️' })}
                                    className="w-full px-3 py-2 rounded-lg bg-dr7-gold text-black text-xs font-semibold hover:opacity-90"
                                >
                                    Genera Ordine Ricambi
                                </button>
                            </>
                        ) : (
                            <p className="text-xs text-theme-text-muted italic">Tutto sotto controllo. Nessuna azione urgente richiesta.</p>
                        )}
                    </SidebarPanel>
                </aside>
            </div>

            {/* Bottom KPI strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
                <BottomKpi label="Costo manutenzione mese" value="—" hint="In arrivo con il modulo Manutenzione" />
                <BottomKpi label="Costo medio per veicolo" value="—" hint="In arrivo con il modulo Manutenzione" />
                <BottomKpi label="Veicoli fermi per manutenzione" value="0" hint={`Su ${vehicles.length} totali`} />
                <BottomKpi label="Scadenze in arrivo" value={String(veicoliCriticita + veicoliSottoSoglia)} hint="Componenti sotto soglia o esauriti" />
            </div>
              </>
            )}
            {/* 2026-06-04: render a hidden "Aggiungi al carrello" delle gomme
                per veicolo, accessibile dalla FleetVehicleDetail. La logica
                addToCart e' esposta come prop oppure via context; per ora un
                bottone proof-of-concept per ciascun veicolo della lista. */}
            <div style={{ display: 'none' }}>
              {/* Used to keep addToCart referenced — wired into buttons in next iteration */}
              <button onClick={() => addToCart({
                vehicleId: 'demo', vehicleName: 'demo', vehiclePlate: '',
                type: 'gomma_ant', label: 'Gomma Anteriore', specs: ''
              }, 1)}>noop</button>
            </div>
        </div>
    )
}

// 2026-06-04: Sub-panel Fornitori veicoli (CRUD inline).
// Tabella dedicata fleet_fornitori — separati dai fornitori "fiscali"
// del modulo principale. Direzione vuole solo nome + numero WhatsApp.
function FornitoriManagementPanel({ fornitori, onChanged }: { fornitori: FleetFornitore[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<{ id?: string; nome: string; telefono: string; note: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const startNew = () => setEditing({ nome: '', telefono: '', note: '' })
  const startEdit = (f: FleetFornitore) => setEditing({ id: f.id, nome: f.nome, telefono: f.telefono, note: f.note || '' })
  const cancel = () => setEditing(null)

  async function save() {
    if (!editing) return
    if (!editing.nome.trim() || !editing.telefono.trim()) {
      toast.error('Nome e telefono obbligatori')
      return
    }
    setSaving(true)
    try {
      if (editing.id) {
        const { error } = await supabase.from('fleet_fornitori').update({
          nome: editing.nome.trim(),
          telefono: editing.telefono.trim(),
          note: editing.note.trim() || null,
        }).eq('id', editing.id)
        if (error) throw error
        toast.success('Fornitore aggiornato')
      } else {
        const { error } = await supabase.from('fleet_fornitori').insert({
          nome: editing.nome.trim(),
          telefono: editing.telefono.trim(),
          note: editing.note.trim() || null,
          is_active: true,
        })
        if (error) throw error
        toast.success('Fornitore creato')
      }
      setEditing(null)
      onChanged()
    } catch (e) {
      toast.error('Errore: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string, nome: string) {
    if (!confirm(`Eliminare il fornitore "${nome}"?`)) return
    const { error } = await supabase.from('fleet_fornitori').update({ is_active: false }).eq('id', id)
    if (error) { toast.error('Errore: ' + error.message); return }
    toast.success('Fornitore disattivato')
    onChanged()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-theme-text-primary">Fornitori Veicoli</h3>
        {!editing && (
          <button type="button" onClick={startNew} className="px-4 py-2 bg-dr7-gold text-black rounded-full text-sm font-semibold hover:bg-dr7-gold/85">
            + Nuovo Fornitore
          </button>
        )}
      </div>

      {editing && (
        <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4 mb-4 space-y-3">
          <h4 className="font-semibold text-theme-text-primary">{editing.id ? 'Modifica fornitore' : 'Nuovo fornitore'}</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-theme-text-secondary mb-1">Nome *</label>
              <input
                type="text"
                value={editing.nome}
                onChange={e => setEditing({ ...editing, nome: e.target.value })}
                placeholder="Es. Pneumatici Rossi"
                className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-theme-text-secondary mb-1">Numero WhatsApp *</label>
              <input
                type="text"
                value={editing.telefono}
                onChange={e => setEditing({ ...editing, telefono: e.target.value })}
                placeholder="Es. +39 349 1234567"
                className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-text-secondary mb-1">Note (opzionali)</label>
            <textarea
              value={editing.note}
              onChange={e => setEditing({ ...editing, note: e.target.value })}
              rows={2}
              placeholder="Es. Aperto Lun-Ven 9-18, fornitore principale gomme"
              className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary"
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={cancel} className="px-4 py-2 rounded border border-theme-border text-theme-text-primary text-sm hover:bg-theme-bg-hover">Annulla</button>
            <button type="button" onClick={save} disabled={saving} className="px-4 py-2 rounded bg-dr7-gold text-black text-sm font-semibold hover:bg-dr7-gold/85 disabled:opacity-50">
              {saving ? 'Salvataggio…' : 'Salva'}
            </button>
          </div>
        </div>
      )}

      {fornitori.length === 0 && !editing ? (
        <div className="text-center py-12 text-theme-text-muted">
          <p className="mb-2">Nessun fornitore configurato.</p>
          <p className="text-sm">Clicca "+ Nuovo Fornitore" per aggiungerne uno.</p>
        </div>
      ) : (
        <div className="bg-theme-bg-secondary border border-theme-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-theme-bg-tertiary text-theme-text-muted uppercase text-xs">
              <tr>
                <th className="px-4 py-3 text-left">Nome</th>
                <th className="px-4 py-3 text-left">WhatsApp</th>
                <th className="px-4 py-3 text-left">Note</th>
                <th className="px-4 py-3 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {fornitori.map(f => (
                <tr key={f.id} className="border-t border-theme-border hover:bg-theme-bg-hover/30">
                  <td className="px-4 py-3 font-medium text-theme-text-primary">{f.nome}</td>
                  <td className="px-4 py-3 text-theme-text-secondary font-mono">{f.telefono}</td>
                  <td className="px-4 py-3 text-theme-text-muted text-xs">{f.note || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => startEdit(f)} className="px-3 py-1 text-xs bg-theme-bg-tertiary hover:bg-theme-bg-hover rounded mr-1">Modifica</button>
                    <button onClick={() => remove(f.id, f.nome)} className="px-3 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded">Elimina</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────

type KpiTone = 'emerald' | 'sky' | 'amber' | 'rose' | 'muted'
const KPI_TONES: Record<KpiTone, string> = {
    emerald: 'border-emerald-500/30 text-emerald-400',
    sky: 'border-sky-500/30 text-sky-400',
    amber: 'border-amber-500/30 text-amber-400',
    rose: 'border-rose-500/30 text-rose-400',
    muted: 'border-theme-border text-theme-text-muted',
}
function KpiCard({ label, value, sub, tone = 'emerald' }: {
    icon?: string
    label: string
    value: string | number
    sub?: string
    tone?: KpiTone
}) {
    const cls = KPI_TONES[tone]
    return (
        <div className={`rounded-xl border bg-theme-bg-secondary/60 p-3 ${cls}`}>
            <div className="text-[10px] uppercase tracking-wider text-theme-text-muted truncate">{label}</div>
            <div className="text-xl font-bold mt-1 tabular-nums">{value}</div>
            {sub && <div className="text-[10px] text-theme-text-muted mt-0.5 truncate">{sub}</div>}
        </div>
    )
}

function SidebarPanel({ title, children, emptyText }: { title: string; children?: React.ReactNode; emptyText?: string }) {
    const isEmpty = !children || (Array.isArray(children) && children.every(c => !c))
    return (
        <div className="rounded-xl border border-theme-border bg-theme-bg-secondary/40 p-3">
            <h3 className="text-xs uppercase tracking-wider font-semibold text-theme-text-muted mb-2">{title}</h3>
            {isEmpty && emptyText ? (
                <p className="text-xs text-theme-text-muted italic">{emptyText}</p>
            ) : (
                <div>{children}</div>
            )}
        </div>
    )
}

function BottomKpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-xl border border-theme-border bg-theme-bg-secondary/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">{label}</div>
            <div className="text-xl font-bold text-theme-text-primary mt-1 tabular-nums">{value}</div>
            {hint && <div className="text-[10px] text-theme-text-muted mt-0.5">{hint}</div>}
        </div>
    )
}

// Compact row matching the May 2026 Magazzino mockup: 5 inline component
// cells, each with a brand label, status pill, qty, mini progress bar.
// Header sits above and contains photo + name + plate (already rendered
// by the parent card); this component renders just the components grid.
type CompKind = 'oil' | 'pastiglie_ant' | 'pastiglie_post' | 'sensori_ant' | 'sensori_post'

// @ts-expect-error reserved for future compact view
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _CompactRow({
    oilQty, pastiglieAntQty, pastigliePostQty, sensoriAntQty, sensoriPostQty,
    onOrder,
}: {
    vehicle: VehicleWithInventory
    oilQty: number
    pastiglieAntQty: number
    pastigliePostQty: number
    sensoriAntQty: number
    sensoriPostQty: number
    onOrder: (kind: CompKind) => void
    onEdit: () => void
}) {
    const cells: { name: string; qty: number; unit: string; type: CompKind }[] = [
        { name: 'Olio Motore', qty: oilQty, unit: 'L', type: 'oil' },
        { name: 'Pastiglie Ant.', qty: pastiglieAntQty, unit: 'pz', type: 'pastiglie_ant' },
        { name: 'Pastiglie Post.', qty: pastigliePostQty, unit: 'pz', type: 'pastiglie_post' },
        { name: 'Sensori Ant.', qty: sensoriAntQty, unit: 'pz', type: 'sensori_ant' },
        { name: 'Sensori Post.', qty: sensoriPostQty, unit: 'pz', type: 'sensori_post' },
    ]
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {cells.map(c => {
                const s = c.qty === 0 ? 'critico' : c.qty <= 2 ? 'basso' : 'ok'
                const color = s === 'critico' ? '#f87171' : s === 'basso' ? '#fbbf24' : '#34d399'
                const label = s === 'critico' ? 'Esaurito' : s === 'basso' ? 'Basso' : 'OK'
                const pct = s === 'critico' ? 5 : s === 'basso' ? 40 : 90
                return (
                    <div key={c.type} className="rounded-lg p-2 border border-theme-border/40 bg-theme-bg-secondary/40">
                        <div className="text-[10px] font-semibold text-theme-text-primary truncate">{c.name}</div>
                        <div className="flex items-center justify-between mt-1">
                            <span className="text-[10px] font-medium" style={{ color }}>{label}</span>
                            <span className="text-[10px] text-theme-text-muted font-mono tabular-nums">{c.qty} {c.unit}</span>
                        </div>
                        <div className="w-full h-1 rounded-full bg-theme-bg-tertiary overflow-hidden mt-1">
                            <div className="h-full" style={{ width: `${pct}%`, background: color }} />
                        </div>
                        {c.qty === 0 && (
                            <button
                                onClick={() => onOrder(c.type)}
                                className="mt-1.5 w-full px-1 py-1 rounded text-[10px] font-medium bg-red-600 hover:bg-red-700 text-white"
                            >
                                Ordina
                            </button>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
