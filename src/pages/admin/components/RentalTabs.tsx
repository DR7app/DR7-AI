import { useState } from 'react'
import ReservationsTab from './ReservationsTab'
import PreventiviTab from './PreventiviTab'

interface RentalTabsProps {
    initialData?: { vehicleId?: string; pickupDate?: Date; bookingId?: string } | null
    onDataConsumed?: () => void
}

export default function RentalTabs({ initialData, onDataConsumed }: RentalTabsProps) {
    const [activeSubTab, setActiveSubTab] = useState<'bookings' | 'preventivi'>('bookings')

    return (
        <div className="space-y-4">
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

            <div>
                {activeSubTab === 'bookings' && (
                    <ReservationsTab
                        initialData={initialData}
                        onDataConsumed={onDataConsumed}
                    />
                )}
                {activeSubTab === 'preventivi' && <PreventiviTab />}
            </div>
        </div>
    )
}
