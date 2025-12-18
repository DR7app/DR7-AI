import { useVehicleAlarm } from '../contexts/VehicleAlarmContext'
import { useNavigate } from 'react-router-dom'

export default function AlarmNotification() {
    const { alarmState, stopAlarm } = useVehicleAlarm()
    const navigate = useNavigate()

    if (!alarmState.activeAlarm) {
        return null
    }

    const { bookingId, vehicleName, returnTime, customerName } = alarmState.activeAlarm

    const handleOpenBooking = () => {
        // Navigate to reservations tab and highlight the booking
        navigate('/admin?tab=reservations&highlight=' + bookingId)
        stopAlarm(bookingId)
    }

    const handleStopAlarm = () => {
        stopAlarm(bookingId)
    }

    return (
        <div className="fixed top-0 left-0 right-0 z-[9999] animate-pulse">
            <div className="bg-gradient-to-r from-red-600 to-red-700 border-b-4 border-red-800 shadow-2xl">
                <div className="max-w-7xl mx-auto px-4 py-4">
                    <div className="flex items-center justify-between gap-4">
                        {/* Icon and Title */}
                        <div className="flex items-center gap-3">
                            <div className="flex-shrink-0">
                                <svg
                                    className="w-8 h-8 text-white animate-bounce"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                                    />
                                </svg>
                            </div>
                            <div>
                                <h3 className="text-white font-bold text-lg">
                                    🚨 VEHICLE RETURN DUE NOW
                                </h3>
                                <div className="text-red-100 text-sm mt-1">
                                    <span className="font-semibold">Booking #{bookingId.slice(0, 8)}</span>
                                    {' | '}
                                    <span>{vehicleName}</span>
                                    {' | '}
                                    <span>{customerName}</span>
                                    {' | '}
                                    <span className="font-semibold">Due: {returnTime}</span>
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                                onClick={handleOpenBooking}
                                className="px-4 py-2 bg-white text-red-700 font-semibold rounded-lg hover:bg-red-50 transition-colors shadow-lg"
                            >
                                Open Booking
                            </button>
                            <button
                                onClick={handleStopAlarm}
                                className="px-4 py-2 bg-red-800 text-white font-semibold rounded-lg hover:bg-red-900 transition-colors shadow-lg"
                            >
                                Stop Alarm
                            </button>
                            <button
                                onClick={handleStopAlarm}
                                className="text-white hover:text-red-200 transition-colors p-1"
                                aria-label="Close"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
