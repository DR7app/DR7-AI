import { useState } from 'react'
import ReservationsTab from './ReservationsTab'
import CalendarTab from './CalendarTab'

export default function RentalTabs() {
    const [activeSubTab, setActiveSubTab] = useState<'bookings' | 'calendar'>('bookings')

    return (
        <div className="space-y-4">
            <div className="flex gap-4 border-b border-gray-700 pb-2">
                <button
                    onClick={() => setActiveSubTab('bookings')}
                    className={`px-4 py-2 font-medium transition-colors ${activeSubTab === 'bookings'
                        ? 'text-white border-b-2 border-white'
                        : 'text-gray-400 hover:text-white'
                        }`}
                >
                    Car Rental
                </button>
                <button
                    onClick={() => setActiveSubTab('calendar')}
                    className={`px-4 py-2 font-medium transition-colors ${activeSubTab === 'calendar'
                        ? 'text-white border-b-2 border-white'
                        : 'text-gray-400 hover:text-white'
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
