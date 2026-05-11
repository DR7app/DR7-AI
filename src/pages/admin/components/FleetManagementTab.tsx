import { useState } from 'react'
import FleetInventory from './FleetInventory'
import FleetList from './FleetList'

/**
 * Gestione Flotta — vista a due modalita' commutabile:
 *  - 'dashboard' (default): KPI + tabella veicoli con foto/utilizzo/fatturato
 *  - 'magazzino': inventario ricambi (olio, pastiglie, sensori) per veicolo
 *
 * Il toggle e' un bottone "Vai al Magazzino" / "Torna al Dashboard" in alto.
 * onOpenDetail nav-igate alla tab Veicoli con l'id del veicolo selezionato
 * (la tab Veicoli ascolta admin:open-vehicle).
 */
export default function FleetManagementTab() {
    const [view, setView] = useState<'dashboard' | 'magazzino'>('dashboard')

    const handleOpenDetail = (vehicleId: string) => {
        try {
            window.dispatchEvent(new CustomEvent('admin:navigate-tab', { detail: { tab: 'vehicles' } }))
            window.dispatchEvent(new CustomEvent('admin:open-vehicle', { detail: { vehicleId } }))
        } catch { /* ignore */ }
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={() => setView(v => v === 'dashboard' ? 'magazzino' : 'dashboard')}
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-black hover:text-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:hover:bg-white dark:hover:text-black transition-colors"
                >
                    {view === 'dashboard' ? (
                        <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                            </svg>
                            Vai al Magazzino
                        </>
                    ) : (
                        <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
                            </svg>
                            Torna al Dashboard
                        </>
                    )}
                </button>
            </div>
            {view === 'dashboard' ? <FleetList onOpenDetail={handleOpenDetail}/> : <FleetInventory/>}
        </div>
    )
}
