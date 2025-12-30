import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import type { Vehicle } from '../../../types'
import Button from './Button'

interface FleetVehicleDetailProps {
    vehicleId: string
    onBack: () => void
}

type SubTab = 'dashboard' | 'maintenance' | 'details' | 'history'

export default function FleetVehicleDetail({ vehicleId, onBack }: FleetVehicleDetailProps) {
    const [vehicle, setVehicle] = useState<Vehicle | null>(null)
    const [loading, setLoading] = useState(true)
    const [activeTab, setActiveTab] = useState<SubTab>('dashboard')

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
        } catch (error) {
            console.error('Error loading vehicle:', error)
        } finally {
            setLoading(false)
        }
    }

    if (loading) return <div className="text-gray-400">Caricamento scheda...</div>
    if (!vehicle) return <div className="text-red-400">Veicolo non trovato</div>

    return (
        <div>
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <Button onClick={onBack} variant="secondary">← Indietro</Button>
                <div>
                    <h2 className="text-2xl font-bold text-white">{vehicle.display_name}</h2>
                    <p className="text-gray-400">{vehicle.plate || 'No Targa'} • {vehicle.current_km?.toLocaleString() || 0} km</p>
                </div>
            </div>

            {/* Internal Navigation */}
            <div className="flex gap-2 mb-6 border-b border-gray-700 pb-2 overflow-x-auto">
                <button
                    onClick={() => setActiveTab('dashboard')}
                    className={`px-4 py-2 rounded-md transition-colors ${activeTab === 'dashboard' ? 'bg-dr7-gold text-black font-bold' : 'text-gray-300 hover:text-white hover:bg-gray-800'}`}
                >
                    Cruscotto
                </button>
                <button
                    onClick={() => setActiveTab('maintenance')}
                    className={`px-4 py-2 rounded-md transition-colors ${activeTab === 'maintenance' ? 'bg-dr7-gold text-black font-bold' : 'text-gray-300 hover:text-white hover:bg-gray-800'}`}
                >
                    Manutenzione (KM)
                </button>
                <button
                    onClick={() => setActiveTab('details')}
                    className={`px-4 py-2 rounded-md transition-colors ${activeTab === 'details' ? 'bg-dr7-gold text-black font-bold' : 'text-gray-300 hover:text-white hover:bg-gray-800'}`}
                >
                    Scadenze (Date)
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`px-4 py-2 rounded-md transition-colors ${activeTab === 'history' ? 'bg-dr7-gold text-black font-bold' : 'text-gray-300 hover:text-white hover:bg-gray-800'}`}
                >
                    Storico
                </button>
            </div>

            {/* Content Area */}
            <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 min-h-[400px]">
                {activeTab === 'dashboard' && (
                    <div>
                        <h3 className="text-xl text-white mb-4">Cruscotto</h3>
                        {/* TODO: Implement Dashboard */}
                        <p className="text-gray-400">Riepilogo stato veicolo e prossimi eventi...</p>
                    </div>
                )}

                {activeTab === 'maintenance' && (
                    <div>
                        <h3 className="text-xl text-white mb-4">Manutenzione (Tagliandi, Gomme, Freni)</h3>
                        {/* TODO: Implement Maintenance Form */}
                        <p className="text-gray-400">Gestione intervalli km...</p>
                    </div>
                )}

                {activeTab === 'details' && (
                    <div>
                        <h3 className="text-xl text-white mb-4">Scadenze Amministrative</h3>
                        {/* TODO: Implement Dates Form */}
                        <p className="text-gray-400">Assicurazione, Bollo, Revisione...</p>
                    </div>
                )}

                {activeTab === 'history' && (
                    <div>
                        <h3 className="text-xl text-white mb-4">Storico Interventi</h3>
                        {/* TODO: Implement Event List */}
                        <p className="text-gray-400">Cronologia completa...</p>
                    </div>
                )}
            </div>
        </div>
    )
}
