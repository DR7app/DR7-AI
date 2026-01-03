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

    const getAlarmStyle = () => {
        switch (alarmState.activeAlarm?.type) {
            case 'deposit':
                return {
                    bg: 'bg-yellow-900',
                    border: 'border-yellow-500',
                    iconBg: 'bg-yellow-100',
                    iconColor: 'text-yellow-600',
                    title: 'DEPOSIT REQUIRED',
                    label: 'Pickup at:'
                }
            case 'unpaid_pickup':
                return {
                    bg: 'bg-red-900',
                    border: 'border-red-600',
                    iconBg: 'bg-red-100',
                    iconColor: 'text-red-600',
                    title: 'DA SALDARE / TO PAY',
                    label: 'Pickup at:'
                }
            case 'car_wash':
                return {
                    bg: 'bg-blue-900',
                    border: 'border-blue-500',
                    iconBg: 'bg-blue-100',
                    iconColor: 'text-blue-600',
                    title: 'LAVAGGIO / CAR WASH',
                    label: 'Time:'
                }
            default: // return
                return {
                    bg: 'bg-red-900',
                    border: 'border-red-600',
                    iconBg: 'bg-red-100',
                    iconColor: 'text-red-600',
                    title: 'VEHICLE RETURN DUE',
                    label: 'Due:'
                }
        }
    }

    const style = getAlarmStyle()

    return (
        <div className={`fixed inset-0 z-[9999] flex items-center justify-center ${style.bg} animate-pulse`}>
            <div className={`bg-white rounded-xl shadow-2xl p-8 max-w-2xl w-full mx-4 border-4 ${style.border}`}>
                <div className="flex flex-col items-center text-center gap-6">
                    {/* Icon */}
                    <div className={`${style.iconBg} p-6 rounded-full`}>
                        <svg
                            className={`w-20 h-20 ${style.iconColor} animate-bounce`}
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

                    {/* Content */}
                    <div>
                        <h2 className={`text-4xl font-black ${style.iconColor} mb-2 uppercase tracking-wide`}>
                            {style.title}
                        </h2>
                        <div className="text-gray-800 text-xl space-y-2 font-medium">
                            <p>Booking <span className="font-bold">#{bookingId.slice(0, 8)}</span></p>
                            <p className="text-2xl font-bold">{vehicleName}</p>
                            <p>{customerName}</p>
                            <div className="flex flex-col items-center">
                                <p className={`${style.iconColor} font-bold`}>
                                    {style.label} {returnTime}
                                </p>

                                {/* Show amount for Deposit or Unpaid */}
                                {((alarmState.activeAlarm.type === 'deposit' && alarmState.activeAlarm.deposit) ||
                                    (alarmState.activeAlarm.type === 'unpaid_pickup' && alarmState.activeAlarm.deposit)) && (
                                        <p className={`text-3xl font-black text-gray-900 mt-2 p-2 ${style.iconBg} rounded-lg border-2 ${style.border}`}>
                                            € {Number(alarmState.activeAlarm.deposit).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
                                        </p>
                                    )}
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-4 w-full justify-center mt-4">
                        <button
                            onClick={handleOpenBooking}
                            className={`px-8 py-4 ${style.iconColor.replace('text', 'bg')} text-white text-xl font-bold rounded-lg hover:opacity-90 transition-opacity shadow-lg flex-1 max-w-xs`}
                        >
                            Open Booking
                        </button>
                        <button
                            onClick={handleStopAlarm}
                            className="px-8 py-4 bg-gray-200 text-gray-800 text-xl font-bold rounded-lg hover:bg-gray-300 transition-colors shadow-lg flex-1 max-w-xs"
                        >
                            Stop Alarm
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
