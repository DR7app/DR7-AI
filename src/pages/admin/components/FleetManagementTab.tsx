import { useState } from 'react'
import FleetList from './FleetList'
import FleetVehicleDetail from './FleetVehicleDetail'
import FleetInventory from './FleetInventory'

type FleetTab = 'veicoli' | 'magazzino'

export default function FleetManagementTab() {
    const [activeTab, setActiveTab] = useState<FleetTab>('veicoli')
    const [currentView, setCurrentView] = useState<'list' | 'detail'>('list')
    const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)

    function handleOpenDetail(vehicleId: string) {
        setSelectedVehicleId(vehicleId)
        setCurrentView('detail')
    }

    function handleBackToList() {
        setSelectedVehicleId(null)
        setCurrentView('list')
    }

    return (
        <div>
            {/* Tab Navigation - only show when not in detail view */}
            {currentView === 'list' && (
                <div className="flex gap-2 mb-6 border-b border-theme-border pb-2">
                    <button
                        onClick={() => setActiveTab('veicoli')}
                        className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
                            activeTab === 'veicoli'
                                ? 'bg-theme-accent text-white'
                                : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-white/5'
                        }`}
                    >
                        Veicoli
                    </button>
                    <button
                        onClick={() => setActiveTab('magazzino')}
                        className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
                            activeTab === 'magazzino'
                                ? 'bg-theme-accent text-white'
                                : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-white/5'
                        }`}
                    >
                        Magazzino
                    </button>
                </div>
            )}

            {/* Tab Content */}
            {activeTab === 'veicoli' ? (
                currentView === 'list' ? (
                    <FleetList onOpenDetail={handleOpenDetail} />
                ) : (
                    <FleetVehicleDetail
                        vehicleId={selectedVehicleId!}
                        onBack={handleBackToList}
                    />
                )
            ) : (
                <FleetInventory />
            )}
        </div>
    )
}
