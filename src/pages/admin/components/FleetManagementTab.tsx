import FleetList from './FleetList'

/**
 * Gestione Flotta — dashboard KPI + tabella veicoli con foto/utilizzo/
 * fatturato. Il Magazzino ricambi (olio, pastiglie, sensori) ora vive su
 * una sua sub-tab dedicata 'Magazzino', non piu' dentro un toggle.
 *
 * onOpenDetail nav-igate alla tab Veicoli con l'id del veicolo
 * selezionato (la tab Veicoli ascolta admin:open-vehicle).
 */
export default function FleetManagementTab() {
    const handleOpenDetail = (vehicleId: string) => {
        try {
            window.dispatchEvent(new CustomEvent('admin:navigate-tab', { detail: { tab: 'vehicles' } }))
            window.dispatchEvent(new CustomEvent('admin:open-vehicle', { detail: { vehicleId } }))
        } catch { /* ignore */ }
    }

    return <FleetList onOpenDetail={handleOpenDetail}/>
}
