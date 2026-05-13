import { useState } from 'react'
import FleetList from './FleetList'
import FleetVehicleDetail from './FleetVehicleDetail'

/**
 * Gestione Flotta — KPI dashboard + tabella veicoli con foto/utilizzo/
 * fatturato. Cliccare su una riga apre la Scheda Veicolo (FleetVehicleDetail)
 * direttamente qui, senza saltare alla tab Veicoli. La Scheda mostra tutti
 * i dettagli: gomme, freni, tagliando, assicurazione, performance, ecc.
 *
 * Il Magazzino ricambi vive ora su una sub-tab dedicata 'Magazzino'.
 */
export default function FleetManagementTab() {
    const [openVehicleId, setOpenVehicleId] = useState<string | null>(null)

    if (openVehicleId) {
        return (
            <FleetVehicleDetail
                vehicleId={openVehicleId}
                onBack={() => setOpenVehicleId(null)}
            />
        )
    }

    return <FleetList onOpenDetail={setOpenVehicleId} />
}
