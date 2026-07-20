import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import type { Vehicle } from '../../../types'
import Button from './Button'
import toast from 'react-hot-toast'
import FleetVehiclePanoramica from './FleetVehiclePanoramica'

interface FleetVehicleDetailProps {
    vehicleId: string
    onBack: () => void
}

type SubTab = 'panoramica' | 'dashboard' | 'maintenance' | 'details' | 'history'

interface MaintenanceAlert {
    type: 'service' | 'tires' | 'brakes' | 'insurance' | 'tax' | 'inspection'
    label: string
    current: number | string
    due: number | string
    remaining: number
    urgent: boolean
}

// 2026-07-20: storico interventi manutenzione (task 8). Ogni intervento resta
// salvato e consultabile come cronologia/calendario degli interventi effettuati.
interface MaintenanceLog {
    id: string
    vehicle_id: string
    intervento_date: string
    tipo: string
    km: number | null
    descrizione: string | null
    costo: number | null
    created_at: string
}
const MAINT_TIPI = ['Tagliando', 'Cambio gomme', 'Cambio pastiglie/freni', 'Cambio olio', 'Revisione', 'Riparazione', 'Carrozzeria', 'Altro']

export default function FleetVehicleDetail({ vehicleId, onBack }: FleetVehicleDetailProps) {
    const [vehicle, setVehicle] = useState<Vehicle | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [activeTab, setActiveTab] = useState<SubTab>('panoramica')
    const [editedVehicle, setEditedVehicle] = useState<Partial<Vehicle>>({})
    // Storico interventi manutenzione (task 8).
    const [logs, setLogs] = useState<MaintenanceLog[]>([])
    const [logForm, setLogForm] = useState({ intervento_date: '', tipo: 'Tagliando', km: '', descrizione: '', costo: '' })
    const [logSaving, setLogSaving] = useState(false)

    useEffect(() => {
        loadVehicle()
        loadLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vehicleId])

    async function loadLogs() {
        const { data } = await supabase
            .from('vehicle_maintenance_log')
            .select('*')
            .eq('vehicle_id', vehicleId)
            .order('intervento_date', { ascending: false })
            .order('created_at', { ascending: false })
        setLogs((data || []) as MaintenanceLog[])
    }

    async function handleAddIntervento() {
        if (!logForm.tipo) { toast.error('Seleziona il tipo di intervento'); return }
        setLogSaving(true)
        try {
            const { error } = await supabase.from('vehicle_maintenance_log').insert({
                vehicle_id: vehicleId,
                intervento_date: logForm.intervento_date || new Date().toISOString().slice(0, 10),
                tipo: logForm.tipo,
                km: logForm.km ? parseInt(logForm.km, 10) : null,
                descrizione: logForm.descrizione.trim() || null,
                costo: logForm.costo ? parseFloat(logForm.costo) : null,
            })
            if (error) throw error
            toast.success('Intervento registrato nello storico')
            setLogForm({ intervento_date: '', tipo: 'Tagliando', km: '', descrizione: '', costo: '' })
            await loadLogs()
        } catch (e) {
            toast.error('Errore: ' + (e instanceof Error ? e.message : String(e)))
        } finally {
            setLogSaving(false)
        }
    }

    async function handleDeleteIntervento(id: string) {
        if (!confirm('Eliminare questo intervento dallo storico?')) return
        const { error } = await supabase.from('vehicle_maintenance_log').delete().eq('id', id)
        if (error) { toast.error('Errore: ' + error.message); return }
        await loadLogs()
    }

    // Le QuickAction nella Panoramica (Modifica / Manutenzione / Storico)
    // chiedono di switchare sub-tab via CustomEvent invece di prop-drilling.
    useEffect(() => {
        const handler = (e: Event) => {
            const ce = e as CustomEvent<{ tab?: SubTab }>
            const tab = ce.detail?.tab
            if (tab === 'details' || tab === 'maintenance' || tab === 'history' || tab === 'panoramica' || tab === 'dashboard') {
                setActiveTab(tab)
            }
        }
        window.addEventListener('fleet:open-subtab', handler as EventListener)
        return () => window.removeEventListener('fleet:open-subtab', handler as EventListener)
    }, [])

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

            toast.success('Modifiche salvate')
            // Close the detail view after save
            onBack()
        } catch (error) {
            console.error('Error saving vehicle:', error)
            toast.error('Errore nel salvataggio')
        } finally {
            setSaving(false)
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // Check front tires
        if (editedVehicle.maintenance_tires_front_interval_km) {
            const lastTiresFront = editedVehicle.last_tire_change_front_km || editedVehicle.last_tire_change_km || 0
            const nextTiresFront = lastTiresFront + editedVehicle.maintenance_tires_front_interval_km
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
        }

        // Check rear tires
        if (editedVehicle.maintenance_tires_rear_interval_km) {
            const lastTiresRear = editedVehicle.last_tire_change_rear_km || editedVehicle.last_tire_change_km || 0
            const nextTiresRear = lastTiresRear + editedVehicle.maintenance_tires_rear_interval_km
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
        // Check front brakes
        if (editedVehicle.maintenance_brake_front_interval_km) {
            const lastBrakesFront = editedVehicle.last_brake_change_front_km || editedVehicle.last_brake_change_km || 0
            const nextBrakesFront = lastBrakesFront + editedVehicle.maintenance_brake_front_interval_km
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
        }

        // Check rear brakes
        if (editedVehicle.maintenance_brake_rear_interval_km) {
            const lastBrakesRear = editedVehicle.last_brake_change_rear_km || editedVehicle.last_brake_change_km || 0
            const nextBrakesRear = lastBrakesRear + editedVehicle.maintenance_brake_rear_interval_km
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
                    onClick={() => setActiveTab('panoramica')}
                    className={`px-4 py-2 rounded-md transition-colors ${activeTab === 'panoramica' ? 'bg-dr7-gold text-white font-bold' : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-tertiary'}`}
                >
                    Panoramica
                </button>
                <button
                    onClick={() => setActiveTab('dashboard')}
                    className={`px-4 py-2 rounded-md transition-colors ${activeTab === 'dashboard' ? 'bg-dr7-gold text-white font-bold' : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-tertiary'}`}
                >
                    Cruscotto
                    {alerts.length > 0 && (
                        <span className="ml-2 bg-red-500 text-theme-text-primary text-xs px-2 py-1 rounded-full">{alerts.length}</span>
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('maintenance')}
                    className={`px-4 py-2 rounded-md transition-colors ${activeTab === 'maintenance' ? 'bg-dr7-gold text-white font-bold' : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-tertiary'}`}
                >
                    Manutenzione (KM)
                </button>
                <button
                    onClick={() => setActiveTab('details')}
                    className={`px-4 py-2 rounded-md transition-colors ${activeTab === 'details' ? 'bg-dr7-gold text-white font-bold' : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-tertiary'}`}
                >
                    Scadenze (Date)
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`px-4 py-2 rounded-md transition-colors ${activeTab === 'history' ? 'bg-dr7-gold text-white font-bold' : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-tertiary'}`}
                >
                    Storico
                </button>
            </div>

            {/* Content Area */}
            <div className={activeTab === 'panoramica' ? 'min-h-[400px]' : 'bg-theme-bg-secondary rounded-lg p-6 border border-theme-border min-h-[400px]'}>
                {activeTab === 'panoramica' && vehicle && (
                    <FleetVehiclePanoramica vehicle={{ ...vehicle, ...editedVehicle } as Vehicle} alerts={alerts} />
                )}
                {activeTab === 'dashboard' && (
                    <div>
                        <h3 className="text-xl text-theme-text-primary mb-4">Cruscotto</h3>

                        {/* Vehicle Info Card */}
                        <div className="bg-theme-bg-tertiary border border-theme-border rounded-lg p-4 mb-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="text-theme-text-muted text-sm block mb-1">Targa</label>
                                    <input
                                        type="text"
                                        value={editedVehicle.plate || ''}
                                        onChange={(e) => updateField('plate', e.target.value.toUpperCase())}
                                        className="w-full bg-theme-bg-tertiary text-theme-text-primary font-bold rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        placeholder="Inserisci targa"
                                    />
                                </div>
                                <div>
                                    <label className="text-theme-text-muted text-sm block mb-1">Numero di Telaio</label>
                                    <input
                                        type="text"
                                        value={editedVehicle.chassis_number || ''}
                                        onChange={(e) => updateField('chassis_number', e.target.value.toUpperCase())}
                                        className="w-full bg-theme-bg-tertiary text-theme-text-primary font-bold font-mono rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        placeholder="es. WVWZZZ3CZWE123456"
                                    />
                                </div>
                                <div>
                                    <label className="text-theme-text-muted text-sm block mb-1">Chilometraggio</label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            value={editedVehicle.current_km || 0}
                                            onChange={(e) => updateField('current_km', parseInt(e.target.value) || 0)}
                                            onFocus={(e) => e.target.select()}
                                            className="w-full bg-theme-bg-tertiary text-theme-text-primary font-bold rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                        <span className="text-theme-text-muted">km</span>
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                                <div>
                                    <label className="text-theme-text-muted text-sm block mb-1">Cavalli (CV)</label>
                                    <input
                                        type="number"
                                        value={editedVehicle.metadata?.cv || ''}
                                        onChange={(e) => updateField('metadata', { ...editedVehicle.metadata, cv: e.target.value ? parseInt(e.target.value) : null })}
                                        onFocus={(e) => e.target.select()}
                                        className="w-full bg-theme-bg-tertiary text-theme-text-primary font-bold rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        placeholder="es. 400"
                                    />
                                </div>
                                <div>
                                    <label className="text-theme-text-muted text-sm block mb-1">Anno</label>
                                    <input
                                        type="number"
                                        value={editedVehicle.metadata?.model_year || ''}
                                        onChange={(e) => updateField('metadata', { ...editedVehicle.metadata, model_year: e.target.value ? parseInt(e.target.value) : null })}
                                        onFocus={(e) => e.target.select()}
                                        className="w-full bg-theme-bg-tertiary text-theme-text-primary font-bold rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        placeholder="es. 2025"
                                    />
                                </div>
                                <div>
                                    <label className="text-theme-text-muted text-sm block mb-1">0-100 km/h (sec)</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={editedVehicle.metadata?.acceleration_0_100 || ''}
                                        onChange={(e) => updateField('metadata', { ...editedVehicle.metadata, acceleration_0_100: e.target.value ? parseFloat(e.target.value) : null })}
                                        onFocus={(e) => e.target.select()}
                                        className="w-full bg-theme-bg-tertiary text-theme-text-primary font-bold rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        placeholder="es. 3.8"
                                    />
                                </div>
                            </div>
                        </div>

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

                        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-theme-bg-tertiary rounded-lg p-4">
                                <p className="text-theme-text-muted text-sm">KM Attuali</p>
                                <p className="text-2xl font-bold text-theme-text-primary">{editedVehicle.current_km?.toLocaleString() || 0}</p>
                            </div>
                            <div className="bg-theme-bg-tertiary rounded-lg p-4">
                                <p className="text-theme-text-muted text-sm">Stato</p>
                                <p className="text-2xl font-bold text-theme-text-primary capitalize">{editedVehicle.status}</p>
                            </div>
                            <div className="bg-theme-bg-tertiary rounded-lg p-4">
                                <p className="text-theme-text-muted text-sm">Cavalli</p>
                                <p className="text-2xl font-bold text-theme-text-primary">{editedVehicle.metadata?.cv ? `${editedVehicle.metadata.cv} CV` : '-'}</p>
                            </div>
                            <div className="bg-theme-bg-tertiary rounded-lg p-4">
                                <p className="text-theme-text-muted text-sm">Anno</p>
                                <p className="text-2xl font-bold text-theme-text-primary">{editedVehicle.metadata?.model_year || '-'}</p>
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
                                    className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                />
                            </div>

                            {/* Service (Tagliando) */}
                            <div className="bg-theme-bg-tertiary rounded-lg p-4">
                                <div className="flex justify-between items-center mb-3">
                                    <h4 className="text-lg font-bold text-theme-text-primary">Tagliando</h4>
                                    <button
                                        onClick={() => {
                                            const subject = encodeURIComponent(`Prenotazione Tagliando - ${editedVehicle.display_name} (${editedVehicle.plate})`)
                                            const body = encodeURIComponent(
                                                `Buongiorno,\n\n` +
                                                `Vorrei prenotare un tagliando per:\n\n` +
                                                `Veicolo: ${editedVehicle.display_name}\n` +
                                                `Targa: ${editedVehicle.plate}\n` +
                                                `Telaio: ${editedVehicle.chassis_number || 'N/A'}\n` +
                                                `KM Attuali: ${editedVehicle.current_km?.toLocaleString() || 0}\n` +
                                                `Ultimo Tagliando: ${editedVehicle.last_service_km?.toLocaleString() || 0} km\n\n` +
                                                `Cordiali saluti,\nDR7`
                                            )
                                            window.open(`mailto:?subject=${subject}&body=${body}`, '_blank')
                                        }}
                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                                    >
                                        Prenota Tagliando
                                    </button>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Ultimo Tagliando (km)</label>
                                        <input
                                            type="number"
                                            value={editedVehicle.last_service_km || 0}
                                            onChange={(e) => updateField('last_service_km', parseInt(e.target.value) || 0)}
                                            onFocus={(e) => e.target.select()}
                                            className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Intervallo (km)</label>
                                        <input
                                            type="number"
                                            value={editedVehicle.maintenance_service_interval_km || 30000}
                                            onChange={(e) => updateField('maintenance_service_interval_km', parseInt(e.target.value) || 30000)}
                                            onFocus={(e) => e.target.select()}
                                            className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
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
                                {/* 2026-07-18: rimosso "Ordina Gomme" dalla scheda auto.
                                    Gli ordini ai fornitori partono ESCLUSIVAMENTE dal
                                    Magazzino (FleetInventory > Ordini). Qui restano solo
                                    le specifiche gomme (dato del veicolo). */}
                                <div className="flex justify-between items-center mb-3">
                                    <h4 className="text-lg font-bold text-theme-text-primary">Gomme</h4>
                                </div>

                                {/* Tire Specifications */}
                                <div className="bg-theme-bg-secondary rounded-lg p-3 mb-4 border border-theme-border">
                                    <h5 className="text-sm font-semibold text-theme-text-primary mb-3">Specifiche Gomme</h5>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-theme-text-secondary text-xs mb-1">Misura Anteriori</label>
                                            <input
                                                type="text"
                                                value={editedVehicle.metadata?.tire_specs?.front_size || ''}
                                                onChange={(e) => updateField('metadata', {
                                                    ...editedVehicle.metadata,
                                                    tire_specs: { ...editedVehicle.metadata?.tire_specs, front_size: e.target.value }
                                                })}
                                                placeholder="es. 205/55 R16"
                                                className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-theme-text-secondary text-xs mb-1">Modello Anteriori</label>
                                            <input
                                                type="text"
                                                value={editedVehicle.metadata?.tire_specs?.front_model || ''}
                                                onChange={(e) => updateField('metadata', {
                                                    ...editedVehicle.metadata,
                                                    tire_specs: { ...editedVehicle.metadata?.tire_specs, front_model: e.target.value }
                                                })}
                                                placeholder="es. Michelin Pilot Sport 4"
                                                className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-theme-text-secondary text-xs mb-1">Misura Posteriori</label>
                                            <input
                                                type="text"
                                                value={editedVehicle.metadata?.tire_specs?.rear_size || ''}
                                                onChange={(e) => updateField('metadata', {
                                                    ...editedVehicle.metadata,
                                                    tire_specs: { ...editedVehicle.metadata?.tire_specs, rear_size: e.target.value }
                                                })}
                                                placeholder="es. 225/45 R17"
                                                className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-theme-text-secondary text-xs mb-1">Modello Posteriori</label>
                                            <input
                                                type="text"
                                                value={editedVehicle.metadata?.tire_specs?.rear_model || ''}
                                                onChange={(e) => updateField('metadata', {
                                                    ...editedVehicle.metadata,
                                                    tire_specs: { ...editedVehicle.metadata?.tire_specs, rear_model: e.target.value }
                                                })}
                                                placeholder="es. Michelin Pilot Sport 4"
                                                className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Tire Change Tracking */}
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
                                                className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-theme-text-secondary text-sm mb-2">Intervallo (km)</label>
                                            <input
                                                type="number"
                                                value={editedVehicle.maintenance_tires_front_interval_km || 30000}
                                                onChange={(e) => updateField('maintenance_tires_front_interval_km', parseInt(e.target.value) || 30000)}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            />
                                        </div>
                                        {editedVehicle.maintenance_tires_front_interval_km && (
                                            <p className="text-theme-text-muted text-sm">
                                                Prossimo cambio: {((editedVehicle.last_tire_change_front_km || 0) + editedVehicle.maintenance_tires_front_interval_km).toLocaleString()} km
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
                                                className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-theme-text-secondary text-sm mb-2">Intervallo (km)</label>
                                            <input
                                                type="number"
                                                value={editedVehicle.maintenance_tires_rear_interval_km || 30000}
                                                onChange={(e) => updateField('maintenance_tires_rear_interval_km', parseInt(e.target.value) || 30000)}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            />
                                        </div>
                                        {editedVehicle.maintenance_tires_rear_interval_km && (
                                            <p className="text-theme-text-muted text-sm">
                                                Prossimo cambio: {((editedVehicle.last_tire_change_rear_km || 0) + editedVehicle.maintenance_tires_rear_interval_km).toLocaleString()} km
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
                                                className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-theme-text-secondary text-sm mb-2">Intervallo (km)</label>
                                            <input
                                                type="number"
                                                value={editedVehicle.maintenance_brake_front_interval_km || 0}
                                                onChange={(e) => updateField('maintenance_brake_front_interval_km', parseInt(e.target.value) || 0)}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                                placeholder="0 = non monitorato"
                                            />
                                        </div>
                                        {editedVehicle.maintenance_brake_front_interval_km && editedVehicle.maintenance_brake_front_interval_km > 0 && (
                                            <p className="text-theme-text-muted text-sm">
                                                Prossimo cambio: {((editedVehicle.last_brake_change_front_km || 0) + editedVehicle.maintenance_brake_front_interval_km).toLocaleString()} km
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
                                                className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-theme-text-secondary text-sm mb-2">Intervallo (km)</label>
                                            <input
                                                type="number"
                                                value={editedVehicle.maintenance_brake_rear_interval_km || 0}
                                                onChange={(e) => updateField('maintenance_brake_rear_interval_km', parseInt(e.target.value) || 0)}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                                placeholder="0 = non monitorato"
                                            />
                                        </div>
                                        {editedVehicle.maintenance_brake_rear_interval_km && editedVehicle.maintenance_brake_rear_interval_km > 0 && (
                                            <p className="text-theme-text-muted text-sm">
                                                Prossimo cambio: {((editedVehicle.last_brake_change_rear_km || 0) + editedVehicle.maintenance_brake_rear_interval_km).toLocaleString()} km
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
                                            className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Targa</label>
                                        <input
                                            type="text"
                                            value={editedVehicle.plate || ''}
                                            onChange={(e) => updateField('plate', e.target.value)}
                                            className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Numero di Telaio (VIN)</label>
                                        <input
                                            type="text"
                                            value={editedVehicle.chassis_number || ''}
                                            onChange={(e) => updateField('chassis_number', e.target.value.toUpperCase())}
                                            className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none font-mono"
                                            placeholder="es. WVWZZZ3CZWE123456"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Stato</label>
                                        <select
                                            value={editedVehicle.status || 'available'}
                                            onChange={(e) => updateField('status', e.target.value)}
                                            className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
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
                                            className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Prezzo Residenti (€/giorno)</label>
                                        <input
                                            type="number"
                                            value={editedVehicle.price_resident_daily ?? ''}
                                            onChange={(e) => updateField('price_resident_daily', e.target.value ? parseFloat(e.target.value) : null)}
                                            className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            placeholder="Es. 349"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Prezzo Non Residenti (€/giorno)</label>
                                        <input
                                            type="number"
                                            value={editedVehicle.price_nonresident_daily ?? ''}
                                            onChange={(e) => updateField('price_nonresident_daily', e.target.value ? parseFloat(e.target.value) : null)}
                                            className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                            placeholder="Es. 449"
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
                                            className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Bollo</label>
                                        <input
                                            type="date"
                                            value={editedVehicle.tax_expiry || ''}
                                            onChange={(e) => updateField('tax_expiry', e.target.value)}
                                            className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Revisione</label>
                                        <input
                                            type="date"
                                            value={editedVehicle.inspection_expiry || ''}
                                            onChange={(e) => updateField('inspection_expiry', e.target.value)}
                                            className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-theme-text-secondary text-sm mb-2">Leasing</label>
                                        <input
                                            type="date"
                                            value={editedVehicle.leasing_expiry || ''}
                                            onChange={(e) => updateField('leasing_expiry', e.target.value)}
                                            className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border-light focus:border-dr7-gold focus:outline-none"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'history' && (
                    <div className="space-y-6">
                        <h3 className="text-xl text-theme-text-primary">Storico Interventi</h3>

                        {/* Registra un nuovo intervento — resta salvato nello storico. */}
                        <div className="bg-theme-bg-tertiary rounded-lg p-4 border border-theme-border">
                            <h4 className="text-sm font-semibold text-theme-text-primary mb-3">Registra intervento</h4>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                <div>
                                    <label className="block text-xs text-theme-text-secondary mb-1">Data</label>
                                    <input type="date" value={logForm.intervento_date} onChange={(e) => setLogForm({ ...logForm, intervento_date: e.target.value })} className="w-full bg-theme-bg-secondary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border" />
                                </div>
                                <div>
                                    <label className="block text-xs text-theme-text-secondary mb-1">Tipo</label>
                                    <select value={logForm.tipo} onChange={(e) => setLogForm({ ...logForm, tipo: e.target.value })} className="w-full bg-theme-bg-secondary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border">
                                        {MAINT_TIPI.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-theme-text-secondary mb-1">KM</label>
                                    <input type="number" value={logForm.km} onChange={(e) => setLogForm({ ...logForm, km: e.target.value })} placeholder="es. 45000" className="w-full bg-theme-bg-secondary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border" />
                                </div>
                                <div>
                                    <label className="block text-xs text-theme-text-secondary mb-1">Costo (€)</label>
                                    <input type="number" step="0.01" value={logForm.costo} onChange={(e) => setLogForm({ ...logForm, costo: e.target.value })} placeholder="opzionale" className="w-full bg-theme-bg-secondary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border" />
                                </div>
                                <div className="md:col-span-4">
                                    <label className="block text-xs text-theme-text-secondary mb-1">Descrizione / lavori effettuati</label>
                                    <input type="text" value={logForm.descrizione} onChange={(e) => setLogForm({ ...logForm, descrizione: e.target.value })} placeholder="es. sostituzione filtri + olio, controllo freni" className="w-full bg-theme-bg-secondary text-theme-text-primary rounded px-3 py-2 text-sm border border-theme-border" />
                                </div>
                            </div>
                            <div className="mt-3 flex justify-end">
                                <Button onClick={handleAddIntervento} disabled={logSaving}>{logSaving ? 'Salvataggio...' : 'Registra intervento'}</Button>
                            </div>
                        </div>

                        {/* Cronologia (calendario) degli interventi effettuati, per mese. */}
                        {logs.length === 0 ? (
                            <p className="text-theme-text-muted text-center py-8">Nessun intervento registrato. Aggiungi il primo qui sopra.</p>
                        ) : (
                            <div className="space-y-5">
                                {(() => {
                                    const groups = new Map<string, MaintenanceLog[]>()
                                    for (const l of logs) {
                                        const d = new Date(l.intervento_date)
                                        const key = d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
                                        if (!groups.has(key)) groups.set(key, [])
                                        groups.get(key)!.push(l)
                                    }
                                    return Array.from(groups.entries()).map(([month, items]) => (
                                        <div key={month}>
                                            <div className="text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-2 capitalize">{month}</div>
                                            <div className="space-y-2">
                                                {items.map(l => (
                                                    <div key={l.id} className="flex items-start gap-3 bg-theme-bg-tertiary rounded-lg p-3 border border-theme-border">
                                                        <div className="shrink-0 w-14 text-center">
                                                            <div className="text-lg font-bold text-theme-text-primary leading-none">{new Date(l.intervento_date).getDate()}</div>
                                                            <div className="text-[10px] uppercase text-theme-text-muted">{new Date(l.intervento_date).toLocaleDateString('it-IT', { weekday: 'short' })}</div>
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-dr7-gold/20 text-dr7-gold">{l.tipo}</span>
                                                                {l.km != null && <span className="text-xs text-theme-text-muted tabular-nums">{l.km.toLocaleString('it-IT')} km</span>}
                                                                {l.costo != null && <span className="text-xs font-semibold text-theme-text-primary">€{Number(l.costo).toFixed(2)}</span>}
                                                            </div>
                                                            {l.descrizione && <div className="text-sm text-theme-text-secondary mt-1">{l.descrizione}</div>}
                                                        </div>
                                                        <button onClick={() => handleDeleteIntervento(l.id)} title="Elimina" className="shrink-0 text-theme-text-muted hover:text-red-500 text-sm">✕</button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))
                                })()}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
