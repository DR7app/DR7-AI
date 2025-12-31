import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../supabaseClient'

interface Booking {
    id: string
    vehicle_name: string
    vehicle_plate?: string | null
    customer_name: string | null
    pickup_date?: string
    dropoff_date?: string
    appointment_date?: string
    appointment_time?: string
    service_type?: string
    service_name?: string
    booking_details: any
    status: string
    type: 'check-in' | 'check-out' | 'lavaggio' | 'meccanica'
}

// Generate 15-minute time slots for the entire day
const generateTimeSlots = () => {
    const slots: string[] = []
    for (let hour = 0; hour < 24; hour++) {
        for (let minute = 0; minute < 60; minute += 15) {
            const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
            slots.push(time)
        }
    }
    return slots
}

const TIME_SLOTS = generateTimeSlots()

export default function DailyCalendarTab() {
    const [bookings, setBookings] = useState<Booking[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedDate, setSelectedDate] = useState(new Date())
    const currentTimeRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        loadDayBookings()

        // Real-time subscription
        const subscription = supabase
            .channel('daily-calendar-updates')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'bookings' },
                () => loadDayBookings()
            )
            .subscribe()

        return () => {
            subscription.unsubscribe()
        }
    }, [selectedDate])

    // Scroll to current time on mount
    useEffect(() => {
        if (currentTimeRef.current && !loading) {
            setTimeout(() => {
                currentTimeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }, 500)
        }
    }, [loading])

    async function loadDayBookings() {
        setLoading(true)
        try {
            const dateStr = selectedDate.toISOString().split('T')[0]

            // Fetch all bookings for the selected date
            const { data, error } = await supabase
                .from('bookings')
                .select('*')
                .neq('status', 'cancelled')
                .or(`pickup_date.gte.${dateStr},pickup_date.lt.${dateStr}T23:59:59,dropoff_date.gte.${dateStr},dropoff_date.lt.${dateStr}T23:59:59,appointment_date.gte.${dateStr},appointment_date.lt.${dateStr}T23:59:59`)

            if (error) throw error

            // Categorize bookings
            const categorized: Booking[] = []

            data?.forEach((booking: any) => {
                const bookingDateStr = booking.pickup_date?.split('T')[0] ||
                    booking.dropoff_date?.split('T')[0] ||
                    booking.appointment_date?.split('T')[0]

                if (bookingDateStr === dateStr) {
                    // Check-In (Pickup)
                    if (booking.pickup_date?.split('T')[0] === dateStr &&
                        !booking.service_type?.includes('car_wash') &&
                        !booking.service_type?.includes('mechanical')) {
                        categorized.push({ ...booking, type: 'check-in' })
                    }

                    // Check-Out (Return)
                    if (booking.dropoff_date?.split('T')[0] === dateStr &&
                        !booking.service_type?.includes('car_wash') &&
                        !booking.service_type?.includes('mechanical')) {
                        categorized.push({ ...booking, type: 'check-out' })
                    }

                    // Car Wash
                    if (booking.service_type === 'car_wash' &&
                        booking.appointment_date?.split('T')[0] === dateStr) {
                        categorized.push({ ...booking, type: 'lavaggio' })
                    }

                    // Mechanical
                    if ((booking.service_type === 'mechanical_service' || booking.service_type === 'mechanical') &&
                        booking.appointment_date?.split('T')[0] === dateStr) {
                        categorized.push({ ...booking, type: 'meccanica' })
                    }
                }
            })

            setBookings(categorized)
        } catch (error) {
            console.error('Failed to load day bookings:', error)
        } finally {
            setLoading(false)
        }
    }

    // Get booking time
    const getBookingTime = (booking: Booking): string => {
        if (booking.type === 'check-in') {
            return booking.booking_details?.pickupTime ||
                new Date(booking.pickup_date!).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
        }
        if (booking.type === 'check-out') {
            return booking.booking_details?.returnTime ||
                new Date(booking.dropoff_date!).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
        }
        return booking.appointment_time || '00:00'
    }

    // Map booking to time slot
    const getTimeSlot = (time: string): string => {
        const [hours, minutes] = time.split(':').map(Number)
        const roundedMinutes = Math.floor(minutes / 15) * 15
        return `${hours.toString().padStart(2, '0')}:${roundedMinutes.toString().padStart(2, '0')}`
    }

    // Get bookings for a specific time slot
    const getSlotBookings = (slot: string): Booking[] => {
        return bookings.filter(booking => {
            const bookingTime = getBookingTime(booking)
            const bookingSlot = getTimeSlot(bookingTime)
            return bookingSlot === slot
        })
    }

    // Parse customer name
    const parseCustomerName = (fullName: string | null) => {
        if (!fullName) return 'N/A'
        const parts = fullName.trim().split(' ')
        if (parts.length === 1) return parts[0]
        return fullName
    }

    // Get current time slot
    const getCurrentTimeSlot = (): string => {
        const now = new Date()
        const hours = now.getHours()
        const minutes = Math.floor(now.getMinutes() / 15) * 15
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
    }

    const currentSlot = getCurrentTimeSlot()
    const isToday = selectedDate.toISOString().split('T')[0] === new Date().toISOString().split('T')[0]

    // Navigate to previous/next day
    const navigateDay = (direction: 'prev' | 'next') => {
        setSelectedDate(prev => {
            const newDate = new Date(prev)
            newDate.setDate(prev.getDate() + (direction === 'prev' ? -1 : 1))
            return newDate
        })
    }

    if (loading) {
        return (
            <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
                <p className="text-white">Caricamento calendario giornaliero...</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-gray-900 rounded-lg p-4">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-white">Calendario Giornaliero</h2>
                    <div className="flex gap-2">
                        <button
                            onClick={() => navigateDay('prev')}
                            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-md transition-colors text-sm font-semibold"
                        >
                            ← Precedente
                        </button>
                        <button
                            onClick={() => setSelectedDate(new Date())}
                            className="px-3 py-2 bg-dr7-gold hover:bg-yellow-500 text-black rounded-md transition-colors text-sm font-semibold"
                        >
                            Oggi
                        </button>
                        <button
                            onClick={() => navigateDay('next')}
                            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-md transition-colors text-sm font-semibold"
                        >
                            Successivo →
                        </button>
                    </div>
                </div>
                <p className="text-gray-400 text-sm mb-4">
                    {selectedDate.toLocaleDateString('it-IT', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    })}
                </p>

                {/* Legend */}
                <div className="flex flex-wrap gap-4 text-sm">
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-green-600 rounded"></div>
                        <span className="text-gray-300">Car Rental</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-blue-600 rounded"></div>
                        <span className="text-gray-300">Lavaggio</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-orange-600 rounded"></div>
                        <span className="text-gray-300">Meccanica</span>
                    </div>
                </div>
            </div>

            {/* Calendar Grid */}
            <div className="bg-gray-900 rounded-lg p-4 max-h-[70vh] overflow-y-auto">
                <div className="space-y-1">
                    {TIME_SLOTS.map((slot) => {
                        const slotBookings = getSlotBookings(slot)
                        const isCurrentSlot = isToday && slot === currentSlot

                        return (
                            <div
                                key={slot}
                                ref={isCurrentSlot ? currentTimeRef : null}
                                className={`flex border-l-4 ${isCurrentSlot ? 'border-dr7-gold bg-gray-800' : 'border-gray-700'
                                    } hover:bg-gray-800 transition-colors`}
                            >
                                {/* Time Column */}
                                <div className="w-20 flex-shrink-0 p-2 text-gray-400 font-mono text-sm">
                                    {slot}
                                </div>

                                {/* Bookings Column */}
                                <div className="flex-1 p-2 flex flex-wrap gap-2">
                                    {slotBookings.length === 0 ? (
                                        <span className="text-gray-600 text-xs">-</span>
                                    ) : (
                                        slotBookings.map((booking) => {
                                            const bgColor =
                                                booking.type === 'check-in' || booking.type === 'check-out' ? 'bg-green-600' :
                                                    booking.type === 'lavaggio' ? 'bg-blue-600' :
                                                        'bg-orange-600'

                                            const label =
                                                booking.type === 'check-in' ? 'RITIRO' :
                                                    booking.type === 'check-out' ? 'RIENTRO' :
                                                        booking.type === 'lavaggio' ? 'LAVAGGIO' :
                                                            'MECCANICA'

                                            return (
                                                <div
                                                    key={booking.id}
                                                    className={`${bgColor} text-white rounded-md p-2 text-xs flex-1 min-w-[200px]`}
                                                >
                                                    <div className="font-bold text-xs mb-1">{label}</div>
                                                    <div className="font-semibold">{parseCustomerName(booking.customer_name)}</div>
                                                    <div className="text-gray-200">{booking.vehicle_name}</div>
                                                    {booking.service_name && (
                                                        <div className="text-gray-200 text-xs mt-1">{booking.service_name}</div>
                                                    )}
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
