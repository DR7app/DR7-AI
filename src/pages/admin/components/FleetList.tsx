import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import type { Vehicle } from '../../../types'
import { getVehicleStatus } from '../../../utils/fleetUtils'
import Button from './Button'

interface FleetListProps {
    onOpenDetail: (vehicleId: string) => void
}

export default function FleetList({ onOpenDetail }: FleetListProps) {
    const [vehicles, setVehicles] = useState<Vehicle[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadVehicles()
    }, [])

    async function loadVehicles() {
        try {
            setLoading(true)
            const { data, error } = await supabase
                .from('vehicles')
                .select('*')
                .neq('status', 'retired')
                .order('display_name')

            if (error) throw error
            setVehicles(data || [])
        } catch (error) {
            console.error('Error loading vehicles:', error)
            alert('Errore caricamento veicoli')
        } finally {
            setLoading(false)
        }
    }

    if (loading) return <div className="text-theme-text-muted">Caricamento flotta...</div>

    return (
        <div>
            <h2 className="text-2xl font-bold text-theme-text-primary mb-6">Gestione Flotta</h2>

            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
                <table className="w-full">
                    <thead className="bg-theme-bg-primary">
                        <tr>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Veicolo</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Targa</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">KM Attuali</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Stato</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Azioni</th>
                        </tr>
                    </thead>
                    <tbody>
                        {vehicles.map(vehicle => {
                            const { status, nearestDeadline } = getVehicleStatus(vehicle, null) // Pass maintenance data when available

                            return (
                                <tr key={vehicle.id} className="border-t border-theme-border hover:bg-theme-bg-tertiary cursor-pointer" onClick={() => onOpenDetail(vehicle.id)}>
                                    <td className="px-4 py-3 text-theme-text-primary font-medium">
                                        {vehicle.display_name}
                                        {nearestDeadline && (
                                            <div className={`text-xs mt-1 ${nearestDeadline.isUrgent ? 'text-red-400 font-bold' : nearestDeadline.isWarning ? 'text-yellow-400' : 'text-gray-500'}`}>
                                                {nearestDeadline.label}: {nearestDeadline.isDate ? `${nearestDeadline.value} gg` : `${nearestDeadline.value} km`}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-theme-text-secondary">{vehicle.plate || '-'}</td>
                                    <td className="px-4 py-3 text-theme-text-primary font-mono">{vehicle.current_km?.toLocaleString() || 0} km</td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-1 rounded text-xs font-bold ${status === 'URGENTE' ? 'bg-red-900 text-red-200 animate-pulse' :
                                            status === 'ATTENZIONE' ? 'bg-yellow-900 text-yellow-200' :
                                                'bg-green-900 text-green-200'
                                            }`}>
                                            {status}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <Button
                                            onClick={(e) => { e.stopPropagation(); onOpenDetail(vehicle.id) }}
                                            className="text-xs py-1 px-3"
                                        >
                                            Apri Scheda
                                        </Button>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
