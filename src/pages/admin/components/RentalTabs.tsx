import { useState } from 'react'
import ReservationsTab from './ReservationsTab'
import CalendarTab from './CalendarTab'

export default function RentalTabs() {
    const [activeSubTab, setActiveSubTab] = useState<'bookings' | 'calendar'>('bookings')

    return (
        <div className="space-y-4">
            <div className="flex gap-4 border-b border-theme-border pb-2">
                <button
                    onClick={() => setActiveSubTab('bookings')}
                    className={`px-4 py-2 font-medium transition-colors ${activeSubTab === 'bookings'
                        ? 'text-theme-text-primary border-b-2 border-white'
                        : 'text-theme-text-muted hover:text-theme-text-primary'
                        }`}
                >
                    Noleggio
                </button>
                <button
                    onClick={() => setActiveSubTab('calendar')}
                    className={`px-4 py-2 font-medium transition-colors ${activeSubTab === 'calendar'
                        ? 'text-theme-text-primary border-b-2 border-white'
                        : 'text-theme-text-muted hover:text-theme-text-primary'
                        }`}
                >
                    Calendario
                </button>
            </div>

            <div>
                {activeSubTab === 'bookings' && <ReservationsTab />}
                {activeSubTab === 'calendar' && <CalendarTab />}
            </div>
        </div>
    )
}
