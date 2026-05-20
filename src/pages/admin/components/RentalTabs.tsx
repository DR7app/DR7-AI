import { useState } from 'react'
import ReservationsTab from './ReservationsTab'
import PreventiviTab from './PreventiviTab'
import { useAdminRole } from '../../../hooks/useAdminRole'

interface RentalTabsProps {
    initialData?: { vehicleId?: string; pickupDate?: Date; bookingId?: string; fromPreventivo?: Record<string, unknown> } | null
    onDataConsumed?: () => void
    // When provided, the parent controls the active sub-view (Noleggio /
    // Preventivi). The internal tab bar is hidden because the parent already
    // shows a unified bar at the section level.
    activeSubView?: 'bookings' | 'preventivi'
    onSubViewChange?: (view: 'bookings' | 'preventivi') => void
}

export default function RentalTabs({ initialData: externalInitialData, onDataConsumed, activeSubView: externalSubView, onSubViewChange }: RentalTabsProps) {
    const { hasPermission } = useAdminRole()
    const [internalSubTab, setInternalSubTab] = useState<'bookings' | 'preventivi'>('bookings')
    const isControlled = externalSubView !== undefined
    const rawSubTab = isControlled ? externalSubView! : internalSubTab
    // Final-line gate: a user with only `reservations-preventivi` (no
    // `reservations`) must never land on the bookings sub-view, even if
    // stale state tried to take them there.
    const canSeeBookings = hasPermission('reservations')
    const activeSubTab: 'bookings' | 'preventivi' = (!canSeeBookings && rawSubTab === 'bookings') ? 'preventivi' : rawSubTab
    const setActiveSubTab = (v: 'bookings' | 'preventivi') => {
        if (isControlled) onSubViewChange?.(v)
        else setInternalSubTab(v)
    }
    const [preventivoData, setPreventivoData] = useState<{ vehicleId: string; pickupDate: Date; fromPreventivo: Record<string, unknown> } | null>(null)

    const handleConvertToBooking = (data: { vehicleId: string; pickupDate: Date; fromPreventivo: Record<string, unknown> }) => {
        setPreventivoData(data)
        setActiveSubTab('bookings')
    }

    const initialData = preventivoData || externalInitialData
    const handleDataConsumed = () => {
        setPreventivoData(null)
        onDataConsumed?.()
    }

    return (
        <div className="space-y-4">
            {/* Internal Noleggio/Preventivi bar — hidden when parent drives
                selection via the controlled prop, since the parent already
                shows a unified section bar that includes these two entries. */}
            {!isControlled && (
                <div className="flex gap-4 border-b border-theme-border pb-2">
                    <button
                        onClick={() => setActiveSubTab('bookings')}
                        className={`px-4 py-2 font-medium transition-colors ${activeSubTab === 'bookings'
                            ? 'text-theme-text-primary border-b-2 border-theme-text-primary'
                            : 'text-theme-text-muted hover:text-theme-text-primary'
                            }`}
                    >
                        Noleggio
                    </button>
                    <button
                        onClick={() => setActiveSubTab('preventivi')}
                        className={`px-4 py-2 font-medium transition-colors ${activeSubTab === 'preventivi'
                            ? 'text-dr7-gold border-b-2 border-dr7-gold'
                            : 'text-theme-text-muted hover:text-theme-text-primary'
                            }`}
                    >
                        Preventivi
                    </button>
                </div>
            )}

            <div>
                {activeSubTab === 'bookings' && (
                    <ReservationsTab
                        initialData={initialData}
                        onDataConsumed={handleDataConsumed}
                    />
                )}
                {activeSubTab === 'preventivi' && (
                    <PreventiviTab onConvertToBooking={handleConvertToBooking} />
                )}
            </div>
        </div>
    )
}
