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

type StatusFilter = 'all' | 'critico' | 'sotto_soglia' | 'ok'

export default function FleetInventory() {
    const [vehicles, setVehicles] = useState<VehicleWithInventory[]>([])
    const [loading, setLoading] = useState(true)
    const [editingVehicle, setEditingVehicle] = useState<string | null>(null)
    const [editForm, setEditForm] = useState<Partial<VehicleInventory>>({})
    const [plateSearch, setPlateSearch] = useState('')
    const [saving, setSaving] = useState(false)
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

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
                </div>
                <p className="text-sm text-theme-text-muted mt-1">
                    Stato componenti e ricambi per ogni veicolo della flotta.
                </p>
            </div>

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

                {/* Left: vehicle list */}
                <div className="lg:col-span-2 space-y-4">
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
                    const needsAttention = oilQty === 0 || pastiglieAntQty === 0 || pastigliePostQty === 0 || sensoriAntQty === 0 || sensoriPostQty === 0

                    return (
                        <div
                            key={vehicle.id}
                            className={`rounded-lg border p-4 ${needsAttention ? 'border-red-500/50 bg-red-900/10' : 'border-theme-border/30 bg-theme-bg-card'}`}
                        >
                            {/* Vehicle Header */}
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${
                                        vehicle.category === 'exotic' ? 'bg-purple-900 text-purple-200' :
                                        vehicle.category === 'urban' ? 'bg-cyan-900 text-cyan-200' :
                                        'bg-green-900 text-green-200'
                                    }`}>
                                        {vehicle.display_name.substring(0, 2).toUpperCase()}
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold text-theme-text-primary">{vehicle.display_name}</h3>
                                        <p className="text-sm text-theme-text-muted">{vehicle.plate || 'No targa'}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => startEditing(vehicle)}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
                                >
                                    Modifica
                                </button>
                            </div>

                            {/* Editing Form */}
                            {editingVehicle === vehicle.id ? (
                                <div className="bg-theme-bg-secondary rounded-lg p-4 space-y-4">
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
                            ) : (
                                /* Display Mode */
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
                            )}
                        </div>
                    )
                })}
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
