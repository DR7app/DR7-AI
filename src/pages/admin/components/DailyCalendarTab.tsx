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
    type: 'check-in' | 'check-out' | 'lavaggio' | 'meccanica' | 'varie'
}

// Generate 15-minute time slots for business hours (9 AM - 8 PM)
const generateTimeSlots = () => {
    const slots: string[] = []
    for (let hour = 9; hour <= 20; hour++) {
        for (let minute = 0; minute < 60; minute += 15) {
            const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
            slots.push(time)
            // Stop at 20:00 (don't add 20:15, 20:30, 20:45)
            if (hour === 20 && minute === 0) break
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
                    if (booking.pickup_date?.split('T')[0] === dateStr) {
                        const isRental = !booking.service_type ||
                            booking.service_type === 'rental' ||
                            booking.service_type === 'car_rental'
                        if (isRental) {
                            categorized.push({ ...booking, type: 'check-in' })
                        }
                    }

                    // Check-Out (Return)
                    if (booking.dropoff_date?.split('T')[0] === dateStr) {
                        const isRental = !booking.service_type ||
                            booking.service_type === 'rental' ||
                            booking.service_type === 'car_rental'
                        if (isRental) {
                            categorized.push({ ...booking, type: 'check-out' })
                        }
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

                    // Varie (miscellaneous) - any other service types or manual entries
                    if (booking.service_type === 'varie' &&
                        (booking.pickup_date?.split('T')[0] === dateStr || booking.appointment_date?.split('T')[0] === dateStr)) {
                        categorized.push({ ...booking, type: 'varie' })
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

    // Get targa from booking
    const getTarga = (booking: Booking): string => {
        return booking.vehicle_plate ||
            booking.booking_details?.vehicle?.targa ||
            booking.booking_details?.vehicle?.plate ||
            'N/A'
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
        <div className="space-y-4">
            {/* Header */}
            <div className="bg-gray-900 rounded-lg p-3 border border-gray-700 shadow-lg">
                <div className="flex justify-between items-center mb-3">
                    <h2 className="text-xl font-bold text-white">Calendario Giornaliero</h2>
                    <div className="flex gap-2">
                        <button
                            onClick={() => navigateDay('prev')}
                            className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-white rounded text-xs font-semibold"
                        >
                            ← Prec
                        </button>
                        <button
                            onClick={() => setSelectedDate(new Date())}
                            className="px-3 py-1 bg-dr7-gold hover:bg-yellow-500 text-black rounded text-xs font-bold"
                        >
                            Oggi
                        </button>
                        <button
                            onClick={() => navigateDay('next')}
                            className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-white rounded text-xs font-semibold"
                        >
                            Succ →
                        </button>
                    </div>
                </div>
                <p className="text-gray-400 text-xs mb-2">
                    {selectedDate.toLocaleDateString('it-IT', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    })}
                </p>
            </div>

            {/* Calendar Grid */}
            <div className="bg-gray-900 rounded-lg border border-gray-700 shadow-lg overflow-x-auto">
                {/* Header Row with Categories */}
                <div className="grid grid-cols-[80px_1fr_1fr_1fr_1fr] border-b-2 border-gray-700 bg-gray-800 sticky top-0">
                    <div className="p-2 text-xs font-bold text-gray-400">ORA</div>
                    <div className="p-2 text-xs font-bold text-center border-l border-gray-700">
                        <div className="flex items-center justify-center gap-1.5">
                            <div className="w-3 h-3 bg-green-600 rounded"></div>
                            <span className="text-gray-200">NOLEGGIO</span>
                        </div>
                    </div>
                    <div className="p-2 text-xs font-bold text-center border-l border-gray-700">
                        <div className="flex items-center justify-center gap-1.5">
                            <div className="w-3 h-3 bg-blue-600 rounded"></div>
                            <span className="text-gray-200">LAVAGGIO</span>
                        </div>
                    </div>
                    <div className="p-2 text-xs font-bold text-center border-l border-gray-700">
                        <div className="flex items-center justify-center gap-1.5">
                            <div className="w-3 h-3 bg-orange-600 rounded"></div>
                            <span className="text-gray-200">MECCANICA</span>
                        </div>
                    </div>
                    <div className="p-2 text-xs font-bold text-center border-l border-gray-700">
                        <div className="flex items-center justify-center gap-1.5">
                            <div className="w-3 h-3 bg-purple-600 rounded"></div>
                            <span className="text-gray-200">VARIE</span>
                        </div>
                    </div>
                </div>

                {/* Time Rows */}
                <div className="divide-y divide-gray-800">
                    {TIME_SLOTS.map((slot) => {
                        const slotBookings = getSlotBookings(slot)
                        const isCurrentSlot = isToday && slot === currentSlot

                        // Separate bookings by type
                        const noleggioBookings = slotBookings.filter(b => b.type === 'check-in' || b.type === 'check-out')
                        const lavaggioBookings = slotBookings.filter(b => b.type === 'lavaggio')
                        const meccanicaBookings = slotBookings.filter(b => b.type === 'meccanica')
                        const varieBookings = slotBookings.filter(b => b.type === 'varie')

                        const renderBookings = (bookings: Booking[], bgColor: string) => {
                            if (bookings.length === 0) {
                                return <span className="text-gray-700 text-xs">—</span>
                            }
                            return bookings.map((booking) => {
                                const label =
                                    booking.type === 'check-in' ? 'USCITE' :
                                        booking.type === 'check-out' ? 'RIENTRI' :
                                            booking.type === 'lavaggio' ? 'LAVAGGIO' :
                                                booking.type === 'meccanica' ? 'MECCANICA' :
                                                    'VARIE'

                                return (
                                    <div
                                        key={booking.id}
                                        className={`${bgColor} text-white rounded px-2 py-1.5 text-xs mb-1 shadow-md hover:shadow-lg transition-shadow`}
                                    >
                                        <div className="font-bold text-[10px] mb-0.5 opacity-90">{label}</div>
                                        <div className="font-bold text-sm leading-tight">{parseCustomerName(booking.customer_name)}</div>
                                        <div className="text-white/90 text-xs mt-0.5">{booking.vehicle_name}</div>
                                        {booking.type !== 'lavaggio' && (
                                            <div className="text-white/80 font-mono text-[10px] mt-0.5">🚗 {getTarga(booking)}</div>
                                        )}
                                        {booking.service_name && (
                                            <div className="text-white/70 text-[10px] mt-1 italic">{booking.service_name}</div>
                                        )}
                                    </div>
                                )
                            })
                        }

                        return (
                            <div
                                key={slot}
                                ref={isCurrentSlot ? currentTimeRef : null}
                                className={`grid grid-cols-[80px_1fr_1fr_1fr_1fr] ${isCurrentSlot ? 'bg-gray-800/50 border-l-2 border-dr7-gold' : ''
                                    } hover:bg-gray-800/30 transition-colors`}
                            >
                                {/* Time Column */}
                                <div className="p-2 text-gray-400 font-mono text-xs font-semibold border-r border-gray-800">
                                    {slot}
                                </div>

                                {/* Noleggio Column */}
                                <div className="p-1.5 border-l border-gray-800">
                                    {renderBookings(noleggioBookings, 'bg-green-600')}
                                </div>

                                {/* Lavaggio Column */}
                                <div className="p-1.5 border-l border-gray-800">
                                    {renderBookings(lavaggioBookings, 'bg-blue-600')}
                                </div>

                                {/* Meccanica Column */}
                                <div className="p-1.5 border-l border-gray-800">
                                    {renderBookings(meccanicaBookings, 'bg-orange-600')}
                                </div>

                                {/* Varie Column */}
                                <div className="p-1.5 border-l border-gray-800">
                                    {renderBookings(varieBookings, 'bg-purple-600')}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
