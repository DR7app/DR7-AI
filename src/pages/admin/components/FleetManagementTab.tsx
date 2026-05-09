import FleetInventory from './FleetInventory'

/**
 * Gestione Flotta — mostra direttamente il Magazzino. Il sub-tab "Veicoli"
 * interno e' stato rimosso perche' duplicava la tab "Veicoli" presente al
 * livello padre (top-level). FleetList resta accessibile dalla tab Veicoli
 * top-level e dal dettaglio veicolo.
 */
export default function FleetManagementTab() {
    return <FleetInventory />
}
