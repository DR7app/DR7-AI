import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import type { Vehicle } from '../../../types'
import Button from './Button'

interface FleetVehicleDetailProps {
    vehicleId: string
    onBack: () => void
}

type SubTab = 'dashboard' | 'maintenance' | 'details' | 'history'

interface MaintenanceAlert {
    type: 'service' | 'tires' | 'brakes' | 'insurance' | 'tax' | 'inspection'
    label: string
    current: number | string
    due: number | string
    remaining: number
    urgent: boolean
}

export default function FleetVehicleDetail({ vehicleId, onBack }: FleetVehicleDetailProps) {
    const [vehicle, setVehicle] = useState<Vehicle | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [activeTab, setActiveTab] = useState<SubTab>('dashboard')
    const [editedVehicle, setEditedVehicle] = useState<Partial<Vehicle>>({})

    useEffect(() => {
        loadVehicle()
    }, [vehicleId])

    async function loadVehicle() {
        try {
            setLoading(true)
            const { data, error } = await supabase
                .from('vehicles')
                .select('*')
                .eq('id', vehicleId)
                .single()

            if (error) throw error
            setVehicle(data)
            setEditedVehicle(data)
        } catch (error) {
            console.error('Error loading vehicle:', error)
        } finally {
            setLoading(false)
        }
    }

    async function handleSave() {
        if (!vehicle) return

        try {
            setSaving(true)
            const { error } = await supabase
                .from('vehicles')
                .update(editedVehicle)
                .eq('id', vehicleId)

            if (error) throw error

            // Show success message for 3 seconds
            alert('Modifiche salvate con successo!')

            // Wait a moment then close the detail view
            setTimeout(() => {
                onBack()
            }, 1500)
        } catch (error) {
            console.error('Error saving vehicle:', error)
            alert('Errore nel salvataggio')
            setSaving(false)
        }
    }

    function updateField(field: keyof Vehicle, value: any) {
        setEditedVehicle(prev => ({ ...prev, [field]: value }))
    }

    function calculateAlerts(): MaintenanceAlert[] {
        if (!editedVehicle) return []

        const alerts: MaintenanceAlert[] = []
        const currentKm = editedVehicle.current_km || 0
        const ALERT_THRESHOLD = 1000

        // Service (Tagliando)
        if (editedVehicle.maintenance_service_interval_km) {
            const lastService = editedVehicle.last_service_km || 0
            const nextService = lastService + editedVehicle.maintenance_service_interval_km
            const remaining = nextService - currentKm

            if (remaining <= ALERT_THRESHOLD) {
                alerts.push({
                    type: 'service',
                    label: 'Tagliando',
                    current: currentKm,
                    due: nextService,
                    remaining,
                    urgent: remaining <= 0
                })
            }
        }

        // Tires (Gomme) - Check both front and rear
        if (editedVehicle.maintenance_tires_interval_km) {
            // Check front tires
            const lastTiresFront = editedVehicle.last_tire_change_front_km || editedVehicle.last_tire_change_km || 0
            const nextTiresFront = lastTiresFront + editedVehicle.maintenance_tires_interval_km
            const remainingFront = nextTiresFront - currentKm

            if (remainingFront <= ALERT_THRESHOLD) {
                alerts.push({
                    type: 'tires',
                    label: 'Gomme Anteriori',
                    current: currentKm,
                    due: nextTiresFront,
                    remaining: remainingFront,
                    urgent: remainingFront <= 0
                })
            }

            // Check rear tires
            const lastTiresRear = editedVehicle.last_tire_change_rear_km || editedVehicle.last_tire_change_km || 0
            const nextTiresRear = lastTiresRear + editedVehicle.maintenance_tires_interval_km
            const remainingRear = nextTiresRear - currentKm

            if (remainingRear <= ALERT_THRESHOLD) {
                alerts.push({
                    type: 'tires',
                    label: 'Gomme Posteriori',
                    current: currentKm,
                    due: nextTiresRear,
                    remaining: remainingRear,
                    urgent: remainingRear <= 0
                })
            }
        }

        // Brakes (Freni) - Check both front and rear
        if (editedVehicle.maintenance_brake_interval_km) {
            // Check front brakes
            const lastBrakesFront = editedVehicle.last_brake_change_front_km || editedVehicle.last_brake_change_km || 0
            const nextBrakesFront = lastBrakesFront + editedVehicle.maintenance_brake_interval_km
            const remainingFront = nextBrakesFront - currentKm

            if (remainingFront <= ALERT_THRESHOLD) {
                alerts.push({
                    type: 'brakes',
                    label: 'Pastiglie Freni Anteriori',
                    current: currentKm,
                    due: nextBrakesFront,
                    remaining: remainingFront,
                    urgent: remainingFront <= 0
                })
            }

            // Check rear brakes
            const lastBrakesRear = editedVehicle.last_brake_change_rear_km || editedVehicle.last_brake_change_km || 0
            const nextBrakesRear = lastBrakesRear + editedVehicle.maintenance_brake_interval_km
            const remainingRear = nextBrakesRear - currentKm

            if (remainingRear <= ALERT_THRESHOLD) {
                alerts.push({
                    type: 'brakes',
                    label: 'Pastiglie Freni Posteriori',
                    current: currentKm,
                    due: nextBrakesRear,
                    remaining: remainingRear,
                    urgent: remainingRear <= 0
                })
            }
        }

        // Insurance
        if (editedVehicle.insurance_expiry) {
            const expiryDate = new Date(editedVehicle.insurance_expiry)
            const today = new Date()
            const daysRemaining = Math.floor((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

            if (daysRemaining <= 30) {
                alerts.push({
                    type: 'insurance',
                    label: 'Assicurazione',
                    current: today.toLocaleDateString('it-IT'),
                    due: expiryDate.toLocaleDateString('it-IT'),
                    remaining: daysRemaining,
                    urgent: daysRemaining <= 0
                })
            }
        }

        // Tax (Bollo)
        if (editedVehicle.tax_expiry) {
            const expiryDate = new Date(editedVehicle.tax_expiry)
            const today = new Date()
            const daysRemaining = Math.floor((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

            if (daysRemaining <= 30) {
                alerts.push({
                    type: 'tax',
                    label: 'Bollo',
                    current: today.toLocaleDateString('it-IT'),
                    due: expiryDate.toLocaleDateString('it-IT'),
                    remaining: daysRemaining,
                    urgent: daysRemaining <= 0
                })
            }
        }

        // Inspection (Revisione)
        if (editedVehicle.inspection_expiry) {
            const expiryDate = new Date(editedVehicle.inspection_expiry)
            const today = new Date()
            const daysRemaining = Math.floor((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

            if (daysRemaining <= 30) {
                alerts.push({
                    type: 'inspection',
                    label: 'Revisione',
                    current: today.toLocaleDateString('it-IT'),
                    due: expiryDate.toLocaleDateString('it-IT'),
                    remaining: daysRemaining,
                    urgent: daysRemaining <= 0
                })
            }
        }

        return alerts
    }

    if (loading) return <div className="text-theme-text-muted">Caricamento scheda...</div>
    if (!vehicle) return <div className="text-red-400">Veicolo non trovato</div>

    const alerts = calculateAlerts()

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <Button onClick={onBack} variant="secondary">← Indietro</Button>
                    <div>
                        <h2 className="text-2xl font-bold text-theme-text-primary">{editedVehicle.display_name}</h2>
                        <p className="text-theme-text-muted">{editedVehicle.plate || 'No Targa'} • {editedVehicle.current_km?.toLocaleString() || 0} km</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? 'Salvataggio...' : 'Salva Modifiche'}
                    </Button>
                    <button
                        onClick={onBack}
                        className="text-theme-text-muted hover:text-theme-text-primary transition-colors p-2"
                        title="Chiudi"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Internal Navigation */}
            <div className="flex gap-2 mb-6 border-b border-theme-border pb-2 overflow-x-auto">
                <button
                    onClick={() => setActiveTab('dashboard')}
                    className={`px-4 py-2 rounded-md transition-colors ${activeTab === 'dashboard' ? 'bg-dr7-gold text-black font-bold' : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-tertiary'}`}
                >
                    Cruscotto
                    {alerts.length > 0 && (
                        <span className="ml-2 bg-red-500 text-theme-text-primary text-xs px-2 py-1 rounded-full">{alerts.length}</span>
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('maintenance')}
                    className={`px-4 py-2 rounded-md transition-colors ${activeTab === 'maintenance' ? 'bg-dr7-gold text-black font-bold' : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-tertiary'}`}
                >
                    Manutenzione (KM)
                </button>
                <button
                    onClick={() => setActiveTab('details')}
                    className={`px-4 py-2 rounded-md transition-colors ${activeTab === 'details' ? 'bg-dr7-gold text-black font-bold' : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-tertiary'}`}
                >
                    Scadenze (Date)
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`px-4 py-2 rounded-md transition-colors ${activeTab === 'history' ? 'bg-dr7-gold text-black font-bold' : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-tertiary'}`}
                >
                    Storico
                </button>
            </div>

            {/* Content Area */}
            <div className="bg-theme-bg-secondary rounded-lg p-6 border border-theme-border min-h-[400px]">
                {activeTab === 'dashboard' && (
                    <div>
                        <h3 className="text-xl text-theme-text-primary mb-4">Cruscotto</h3>

                        {alerts.length === 0 ? (
                            <div className="bg-green-900/20 border border-green-700 rounded-full p-4">
                                <p className="text-green-400">Nessun avviso. Tutto in regola!</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {alerts.map((alert, idx) => (
                                    <div
                                        key={idx}
                                        className={`border rounded-lg p-4 ${alert.urgent
                                            ? 'bg-red-900/20 border-red-700'
                                            : 'bg-yellow-900/20 border-yellow-700'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h4 className={`font-bold ${alert.urgent ? 'text-red-400' : 'text-yellow-400'}`}>
                                                    {alert.urgent ? 'URGENTE' : 'ATTENZIONE'} - {alert.label}
                                                </h4>
                                                <p className="text-theme-text-secondary text-sm mt-1">
                                                    {typeof alert.remaining === 'number' && alert.type !== 'insurance' && alert.type !== 'tax' && alert.type !== 'inspection' ? (
                                                        <>
                                                            Scadenza: {alert.due.toLocaleString()} km •
                                                            Mancano: {alert.remaining > 0 ? `${alert.remaining.toLocaleString()} km` : 'SCADUTO'}
                                                        </>
                                                    ) : (
                                                        <>
                                                            Scadenza: {alert.due} •
                                                            Mancano: {alert.remaining > 0 ? `${alert.remaining} giorni` : 'SCADUTO'}
                                                        </>
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="mt-6 grid grid-cols-2 gap-4">
                            <div className="bg-theme-bg-tertiary rounded-lg p-4">
                                <p className="text-theme-text-muted text-sm">KM Attuali</p>
                                <p className="text-2xl font-bold text-theme-text-primary">{editedVehicle.current_km?.toLocaleString() || 0}</p>
                            </div>
                            <div className="bg-theme-bg-tertiary rounded-lg p-4">
                                <p className="text-theme-text-muted text-sm">Stato</p>
                                <p className="text-2xl font-bold text-theme-text-primary capitalize">{editedVehicle.status}</p>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'maintenance' && (
                    <div>
                        <h3 className="text-xl text-theme-text-primary mb-4">Manutenzione (KM)</h3>

                        <div className="space-y-6">
                            {/* Current KM */}
                            <div className="bg-theme-bg-tertiary rounded-lg p-4">
                                <label className="block text-theme-text-secondary font-medium mb-2">KM Attuali</label>
                                <input
                                    type="number"
                                    value={editedVehicle.current_km || 0}
                                    onChange={(e) => updateField('current_km', parseInt(e.target.value) || 0)}
                                    onFocus={(e) => e.target.select()}
                                    className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                />
                            </div>

                            {/* Service (Tagliando) */}
                            <div className="bg-theme-bg-tertiary rounded-lg p-4">
                                <h4 className="text-lg font-bold text-theme-text-primary mb-3">Tagliando</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Ultimo Tagliando (km)</label>
                                        <input
                                            type="number"
                                            value={editedVehicle.last_service_km || 0}
                                            onChange={(e) => updateField('last_service_km', parseInt(e.target.value) || 0)}
                                            onFocus={(e) => e.target.select()}
                                            className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Intervallo (km)</label>
                                        <input
                                            type="number"
                                            value={editedVehicle.maintenance_service_interval_km || 30000}
                                            onChange={(e) => updateField('maintenance_service_interval_km', parseInt(e.target.value) || 30000)}
                                            onFocus={(e) => e.target.select()}
                                            className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                    </div>
                                </div>
                                {editedVehicle.maintenance_service_interval_km && (
                                    <p className="text-theme-text-muted text-sm mt-2">
                                        Prossimo tagliando: {((editedVehicle.last_service_km || 0) + editedVehicle.maintenance_service_interval_km).toLocaleString()} km
                                    </p>
                                )}
                            </div>

                            {/* Tires (Gomme) */}
                            <div className="bg-theme-bg-tertiary rounded-lg p-4">
                                <h4 className="text-lg font-bold text-theme-text-primary mb-3">Gomme</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    {/* Front Tires */}
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-theme-text-secondary text-sm mb-2">Anteriori - Ultimo Cambio (km)</label>
                                            <input
                                                type="number"
                                                value={editedVehicle.last_tire_change_front_km || 0}
                                                onChange={(e) => updateField('last_tire_change_front_km', parseInt(e.target.value) || 0)}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-theme-text-secondary text-sm mb-2">Intervallo (km)</label>
                                            <input
                                                type="number"
                                                value={editedVehicle.maintenance_tires_interval_km || 30000}
                                                onChange={(e) => updateField('maintenance_tires_interval_km', parseInt(e.target.value) || 30000)}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            />
                                        </div>
                                        {editedVehicle.maintenance_tires_interval_km && (
                                            <p className="text-theme-text-muted text-sm">
                                                Prossimo cambio: {((editedVehicle.last_tire_change_front_km || 0) + editedVehicle.maintenance_tires_interval_km).toLocaleString()} km
                                            </p>
                                        )}
                                    </div>

                                    {/* Rear Tires */}
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-theme-text-secondary text-sm mb-2">Posteriori - Ultimo Cambio (km)</label>
                                            <input
                                                type="number"
                                                value={editedVehicle.last_tire_change_rear_km || 0}
                                                onChange={(e) => updateField('last_tire_change_rear_km', parseInt(e.target.value) || 0)}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-theme-text-secondary text-sm mb-2">Intervallo (km)</label>
                                            <input
                                                type="number"
                                                value={editedVehicle.maintenance_tires_interval_km || 30000}
                                                onChange={(e) => updateField('maintenance_tires_interval_km', parseInt(e.target.value) || 30000)}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            />
                                        </div>
                                        {editedVehicle.maintenance_tires_interval_km && (
                                            <p className="text-theme-text-muted text-sm">
                                                Prossimo cambio: {((editedVehicle.last_tire_change_rear_km || 0) + editedVehicle.maintenance_tires_interval_km).toLocaleString()} km
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Brakes (Pastiglie) */}
                            <div className="bg-theme-bg-tertiary rounded-lg p-4">
                                <h4 className="text-lg font-bold text-theme-text-primary mb-3">Pastiglie Freni</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    {/* Front Brakes */}
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-theme-text-secondary text-sm mb-2">Anteriori - Ultimo Cambio (km)</label>
                                            <input
                                                type="number"
                                                value={editedVehicle.last_brake_change_front_km || 0}
                                                onChange={(e) => updateField('last_brake_change_front_km', parseInt(e.target.value) || 0)}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-theme-text-secondary text-sm mb-2">Intervallo (km)</label>
                                            <input
                                                type="number"
                                                value={editedVehicle.maintenance_brake_interval_km || 0}
                                                onChange={(e) => updateField('maintenance_brake_interval_km', parseInt(e.target.value) || 0)}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                                placeholder="0 = non monitorato"
                                            />
                                        </div>
                                        {editedVehicle.maintenance_brake_interval_km && editedVehicle.maintenance_brake_interval_km > 0 && (
                                            <p className="text-theme-text-muted text-sm">
                                                Prossimo cambio: {((editedVehicle.last_brake_change_front_km || 0) + editedVehicle.maintenance_brake_interval_km).toLocaleString()} km
                                            </p>
                                        )}
                                    </div>

                                    {/* Rear Brakes */}
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-theme-text-secondary text-sm mb-2">Posteriori - Ultimo Cambio (km)</label>
                                            <input
                                                type="number"
                                                value={editedVehicle.last_brake_change_rear_km || 0}
                                                onChange={(e) => updateField('last_brake_change_rear_km', parseInt(e.target.value) || 0)}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-theme-text-secondary text-sm mb-2">Intervallo (km)</label>
                                            <input
                                                type="number"
                                                value={editedVehicle.maintenance_brake_interval_km || 0}
                                                onChange={(e) => updateField('maintenance_brake_interval_km', parseInt(e.target.value) || 0)}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                                placeholder="0 = non monitorato"
                                            />
                                        </div>
                                        {editedVehicle.maintenance_brake_interval_km && editedVehicle.maintenance_brake_interval_km > 0 && (
                                            <p className="text-theme-text-muted text-sm">
                                                Prossimo cambio: {((editedVehicle.last_brake_change_rear_km || 0) + editedVehicle.maintenance_brake_interval_km).toLocaleString()} km
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'details' && (
                    <div>
                        <h3 className="text-xl text-theme-text-primary mb-4">Dettagli Veicolo e Scadenze</h3>

                        <div className="space-y-6">
                            {/* Basic Info */}
                            <div className="bg-theme-bg-tertiary rounded-lg p-4">
                                <h4 className="text-lg font-bold text-theme-text-primary mb-3">Informazioni Base</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Nome Veicolo</label>
                                        <input
                                            type="text"
                                            value={editedVehicle.display_name || ''}
                                            onChange={(e) => updateField('display_name', e.target.value)}
                                            className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Targa</label>
                                        <input
                                            type="text"
                                            value={editedVehicle.plate || ''}
                                            onChange={(e) => updateField('plate', e.target.value)}
                                            className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Stato</label>
                                        <select
                                            value={editedVehicle.status || 'available'}
                                            onChange={(e) => updateField('status', e.target.value)}
                                            className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        >
                                            <option value="available">Disponibile</option>
                                            <option value="rented">Noleggiato</option>
                                            <option value="maintenance">Manutenzione</option>
                                            <option value="retired">Ritirato</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Tariffa Giornaliera (€)</label>
                                        <input
                                            type="number"
                                            value={editedVehicle.daily_rate || 0}
                                            onChange={(e) => updateField('daily_rate', parseFloat(e.target.value) || 0)}
                                            className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Administrative Dates */}
                            <div className="bg-theme-bg-tertiary rounded-lg p-4">
                                <h4 className="text-lg font-bold text-theme-text-primary mb-3">Scadenze Amministrative</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Assicurazione</label>
                                        <input
                                            type="date"
                                            value={editedVehicle.insurance_expiry || ''}
                                            onChange={(e) => updateField('insurance_expiry', e.target.value)}
                                            className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Bollo</label>
                                        <input
                                            type="date"
                                            value={editedVehicle.tax_expiry || ''}
                                            onChange={(e) => updateField('tax_expiry', e.target.value)}
                                            className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Revisione</label>
                                        <input
                                            type="date"
                                            value={editedVehicle.inspection_expiry || ''}
                                            onChange={(e) => updateField('inspection_expiry', e.target.value)}
                                            className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Leasing</label>
                                        <input
                                            type="date"
                                            value={editedVehicle.leasing_expiry || ''}
                                            onChange={(e) => updateField('leasing_expiry', e.target.value)}
                                            className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'history' && (
                    <div>
                        <h3 className="text-xl text-theme-text-primary mb-4">Storico Interventi</h3>
                        <p className="text-theme-text-muted">Cronologia completa degli interventi di manutenzione...</p>
                        <p className="text-gray-500 text-sm mt-2">(Da implementare: lista eventi da tabella vehicle_events)</p>
                    </div>
                )}
            </div>
        </div>
    )
}
