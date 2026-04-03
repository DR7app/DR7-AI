import { useState } from 'react'
import ReservationsTab from './ReservationsTab'
import CalendarTab from './CalendarTab'
import PreventiviTab from './PreventiviTab'

export default function RentalTabs() {
    const [activeSubTab, setActiveSubTab] = useState<'bookings' | 'calendar' | 'preventivi'>('bookings')

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
                    onClick={() => setActiveSubTab('calendar')}
                    className={`px-4 py-2 font-medium transition-colors ${activeSubTab === 'calendar'
                        ? 'text-theme-text-primary border-b-2 border-theme-text-primary'
                        : 'text-theme-text-muted hover:text-theme-text-primary'
                        }`}
                >
                    Calendario
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
                {activeSubTab === 'bookings' && <ReservationsTab />}
                {activeSubTab === 'calendar' && <CalendarTab />}
                {activeSubTab === 'preventivi' && <PreventiviTab />}
            </div>
        </div>
    )
}
