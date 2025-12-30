import { useState } from 'react'
import FleetList from './FleetList'
import FleetVehicleDetail from './FleetVehicleDetail'

export default function FleetManagementTab() {
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
            {currentView === 'list' ? (
                <FleetList onOpenDetail={handleOpenDetail} />
            ) : (
                <FleetVehicleDetail
                    vehicleId={selectedVehicleId!}
                    onBack={handleBackToList}
                />
            )}
        </div>
    )
}
