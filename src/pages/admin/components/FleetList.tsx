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

    // Separate vehicles by category
    const exoticVehicles = vehicles.filter(v => v.category === 'exotic')
    const urbanVehicles = vehicles.filter(v => v.category === 'urban')
    const aziendaliVehicles = vehicles.filter(v => v.category === 'aziendali')

    const exoticCount = exoticVehicles.length
    const urbanCount = urbanVehicles.length
    const aziendaliCount = aziendaliVehicles.length

    if (loading) return <div className="text-theme-text-muted">Caricamento flotta...</div>

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-theme-text-primary">Gestione Flotta</h2>
                    <p className="text-sm text-theme-text-muted mt-1">
                        Exotic: {exoticCount} | Urban: {urbanCount} | Aziendali: {aziendaliCount} | Totale: {vehicles.length}
                    </p>
                </div>
            </div>

            {/* Three Column Layout: Exotic, Urban, and Aziendali */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Exotic Vehicles Column */}
                <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
                    <div className="bg-purple-900/30 px-4 py-3 border-b border-theme-border">
                        <h3 className="text-lg font-bold text-theme-text-primary flex items-center gap-2">
                            <span className="px-3 py-1 bg-purple-900 text-purple-200 rounded text-sm">Exotic Supercars</span>
                            <span className="text-sm text-theme-text-muted">({exoticCount} veicoli)</span>
                        </h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-theme-bg-primary">
                                <tr>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Veicolo</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Targa</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">KM</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Stato</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Azioni</th>
                                </tr>
                            </thead>
                            <tbody>
                                {exoticVehicles.map(vehicle => {
                                    const { status, nearestDeadline } = getVehicleStatus(vehicle, null)
                                    return (
                                        <tr
                                            key={vehicle.id}
                                            className="border-t border-gray-700/30 transition-all duration-200 cursor-pointer hover:bg-white/5"
                                            onClick={() => onOpenDetail(vehicle.id)}
                                        >
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

                {/* Urban Vehicles Column */}
                <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
                    <div className="bg-cyan-900/30 px-4 py-3 border-b border-theme-border">
                        <h3 className="text-lg font-bold text-theme-text-primary flex items-center gap-2">
                            <span className="px-3 py-1 bg-cyan-900 text-cyan-200 rounded text-sm">Urban</span>
                            <span className="text-sm text-theme-text-muted">({urbanCount} veicoli)</span>
                        </h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-theme-bg-primary">
                                <tr>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Veicolo</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Targa</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">KM</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Stato</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Azioni</th>
                                </tr>
                            </thead>
                            <tbody>
                                {urbanVehicles.map(vehicle => {
                                    const { status, nearestDeadline } = getVehicleStatus(vehicle, null)
                                    return (
                                        <tr
                                            key={vehicle.id}
                                            className="border-t border-gray-700/30 transition-all duration-200 cursor-pointer hover:bg-white/5"
                                            onClick={() => onOpenDetail(vehicle.id)}
                                        >
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

                {/* Aziendali Vehicles Column */}
                <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
                    <div className="bg-green-900/30 px-4 py-3 border-b border-theme-border">
                        <h3 className="text-lg font-bold text-theme-text-primary flex items-center gap-2">
                            <span className="px-3 py-1 bg-green-900 text-green-200 rounded text-sm">Aziendali</span>
                            <span className="text-sm text-theme-text-muted">({aziendaliCount} veicoli)</span>
                        </h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-theme-bg-primary">
                                <tr>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Veicolo</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Targa</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">KM</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Stato</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Azioni</th>
                                </tr>
                            </thead>
                            <tbody>
                                {aziendaliVehicles.map(vehicle => {
                                    const { status, nearestDeadline } = getVehicleStatus(vehicle, null)
                                    return (
                                        <tr
                                            key={vehicle.id}
                                            className="border-t border-gray-700/30 transition-all duration-200 cursor-pointer hover:bg-white/5"
                                            onClick={() => onOpenDetail(vehicle.id)}
                                        >
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
            </div>
        </div>
    )
}
