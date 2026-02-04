import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

interface Vehicle {
    id: string
    display_name: string
    plate: string | null
    category: string | null
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
    updated_at: string
}

interface VehicleWithInventory extends Vehicle {
    inventory?: VehicleInventory
}

export default function FleetInventory() {
    const [vehicles, setVehicles] = useState<VehicleWithInventory[]>([])
    const [loading, setLoading] = useState(true)
    const [editingVehicle, setEditingVehicle] = useState<string | null>(null)
    const [editForm, setEditForm] = useState<Partial<VehicleInventory>>({})
    const [plateSearch, setPlateSearch] = useState('')

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
        try {
            const existingInventory = vehicles.find(v => v.id === vehicleId)?.inventory

            if (existingInventory) {
                // Update existing
                const { error } = await supabase
                    .from('fleet_vehicle_inventory')
                    .update({
                        ...editForm,
                        updated_at: new Date().toISOString()
                    })
                    .eq('vehicle_id', vehicleId)

                if (error) throw error
            } else {
                // Insert new
                const { error } = await supabase
                    .from('fleet_vehicle_inventory')
                    .insert({
                        vehicle_id: vehicleId,
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
                        pastiglie_post_supplier_phone: editForm.pastiglie_post_supplier_phone || null
                    })

                if (error) throw error
            }

            setEditingVehicle(null)
            setEditForm({})
            loadVehiclesWithInventory()
        } catch (error) {
            console.error('Error saving inventory:', error)
            alert('Errore nel salvataggio')
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
            pastiglie_post_supplier_phone: vehicle.inventory?.pastiglie_post_supplier_phone || ''
        })
    }

    function formatPhoneForWhatsApp(phone: string): string {
        // Remove spaces, dashes, and + sign
        let cleaned = phone.replace(/[\s\-\+]/g, '')
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

    function sendWhatsAppOrder(vehicle: VehicleWithInventory, itemType: 'oil' | 'pastiglie_ant' | 'pastiglie_post') {
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
        }

        if (!phone) {
            alert('Nessun numero di telefono fornitore configurato. Modifica il veicolo per aggiungere il numero.')
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

    // Count vehicles needing attention
    const vehiclesNeedingOil = vehicles.filter(v => (v.inventory?.oil_quantity || 0) === 0).length
    const vehiclesNeedingPastiglieAnt = vehicles.filter(v => (v.inventory?.pastiglie_ant_quantity || 0) === 0).length
    const vehiclesNeedingPastigliePost = vehicles.filter(v => (v.inventory?.pastiglie_post_quantity || 0) === 0).length

    if (loading) return <div className="text-theme-text-muted">Caricamento magazzino...</div>

    return (
        <div>
            <div className="mb-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <h2 className="text-2xl font-bold text-theme-text-primary">Magazzino Veicoli</h2>
                    <div className="relative w-full sm:w-64">
                        <input
                            type="text"
                            placeholder="Ricerca auto per targa..."
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
                    Gestione scorte olio e pastiglie per ogni veicolo
                </p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className={`rounded-lg p-4 border ${vehiclesNeedingOil > 0 ? 'bg-red-900/20 border-red-500/50' : 'bg-green-900/20 border-green-500/50'}`}>
                    <div className="text-3xl font-bold mb-1 ${vehiclesNeedingOil > 0 ? 'text-red-400' : 'text-green-400'}">
                        {vehiclesNeedingOil}
                    </div>
                    <div className="text-sm text-theme-text-muted">Veicoli senza olio</div>
                </div>
                <div className={`rounded-lg p-4 border ${vehiclesNeedingPastiglieAnt > 0 ? 'bg-red-900/20 border-red-500/50' : 'bg-green-900/20 border-green-500/50'}`}>
                    <div className="text-3xl font-bold mb-1">
                        {vehiclesNeedingPastiglieAnt}
                    </div>
                    <div className="text-sm text-theme-text-muted">Veicoli senza pastiglie ant.</div>
                </div>
                <div className={`rounded-lg p-4 border ${vehiclesNeedingPastigliePost > 0 ? 'bg-red-900/20 border-red-500/50' : 'bg-green-900/20 border-green-500/50'}`}>
                    <div className="text-3xl font-bold mb-1">
                        {vehiclesNeedingPastigliePost}
                    </div>
                    <div className="text-sm text-theme-text-muted">Veicoli senza pastiglie post.</div>
                </div>
            </div>

            {/* Vehicle Inventory List */}
            <div className="space-y-4">
                {vehicles.filter(v => {
                    if (!plateSearch.trim()) return true
                    const q = plateSearch.trim().toLowerCase().replace(/\s/g, '')
                    const plate = (v.plate || '').toLowerCase().replace(/\s/g, '')
                    const name = v.display_name.toLowerCase()
                    return plate.includes(q) || name.includes(q)
                }).map(vehicle => {
                    const inv = vehicle.inventory
                    const oilQty = inv?.oil_quantity || 0
                    const pastiglieAntQty = inv?.pastiglie_ant_quantity || 0
                    const pastigliePostQty = inv?.pastiglie_post_quantity || 0
                    const needsAttention = oilQty === 0 || pastiglieAntQty === 0 || pastigliePostQty === 0

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
                                                    onChange={(e) => setEditForm({ ...editForm, oil_type: e.target.value })}
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
                                                    onChange={(e) => setEditForm({ ...editForm, oil_quantity: parseInt(e.target.value) || 0 })}
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Tel. Fornitore (WhatsApp)</label>
                                                <input
                                                    type="tel"
                                                    value={editForm.oil_supplier_phone || ''}
                                                    onChange={(e) => setEditForm({ ...editForm, oil_supplier_phone: e.target.value })}
                                                    placeholder="es. 3331234567"
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Link Fornitore (opz.)</label>
                                                <input
                                                    type="url"
                                                    value={editForm.oil_supplier_url || ''}
                                                    onChange={(e) => setEditForm({ ...editForm, oil_supplier_url: e.target.value })}
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
                                                    onChange={(e) => setEditForm({ ...editForm, pastiglie_ant_model: e.target.value })}
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
                                                    onChange={(e) => setEditForm({ ...editForm, pastiglie_ant_quantity: parseInt(e.target.value) || 0 })}
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Tel. Fornitore (WhatsApp)</label>
                                                <input
                                                    type="tel"
                                                    value={editForm.pastiglie_ant_supplier_phone || ''}
                                                    onChange={(e) => setEditForm({ ...editForm, pastiglie_ant_supplier_phone: e.target.value })}
                                                    placeholder="es. 3331234567"
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Link Fornitore (opz.)</label>
                                                <input
                                                    type="url"
                                                    value={editForm.pastiglie_ant_supplier_url || ''}
                                                    onChange={(e) => setEditForm({ ...editForm, pastiglie_ant_supplier_url: e.target.value })}
                                                    placeholder="https://..."
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Rear Brake Pads Section */}
                                    <div className="pb-2">
                                        <h4 className="font-semibold text-theme-text-primary mb-3">Pastiglie Freno Posteriori</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Modello</label>
                                                <input
                                                    type="text"
                                                    value={editForm.pastiglie_post_model || ''}
                                                    onChange={(e) => setEditForm({ ...editForm, pastiglie_post_model: e.target.value })}
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
                                                    onChange={(e) => setEditForm({ ...editForm, pastiglie_post_quantity: parseInt(e.target.value) || 0 })}
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Tel. Fornitore (WhatsApp)</label>
                                                <input
                                                    type="tel"
                                                    value={editForm.pastiglie_post_supplier_phone || ''}
                                                    onChange={(e) => setEditForm({ ...editForm, pastiglie_post_supplier_phone: e.target.value })}
                                                    placeholder="es. 3331234567"
                                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-theme-text-muted mb-1">Link Fornitore (opz.)</label>
                                                <input
                                                    type="url"
                                                    value={editForm.pastiglie_post_supplier_url || ''}
                                                    onChange={(e) => setEditForm({ ...editForm, pastiglie_post_supplier_url: e.target.value })}
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
                                            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg"
                                        >
                                            Salva
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                /* Display Mode */
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
