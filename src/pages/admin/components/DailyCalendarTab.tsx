import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import { getRomeDateComponents } from '../../../utils/timezoneUtils'

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
            console.log('🔍 Daily Calendar loading for:', selectedDate.toLocaleDateString('it-IT'))

            // Fetch ALL bookings via Netlify function (bypasses RLS)
            let bookingsToProcess: any[] = []
            try {
                const res = await fetch('/.netlify/functions/list-bookings')
                const result = await res.json()
                if (res.ok && result.bookings) {
                    bookingsToProcess = result.bookings.filter((b: any) => b.status !== 'cancelled')
                }
            } catch {
                // Netlify function unavailable, fallback
            }

            if (bookingsToProcess.length === 0) {
                const { data, error } = await supabase
                    .from('bookings')
                    .select('*')
                    .neq('status', 'cancelled')
                    .order('created_at', { ascending: false })
                if (error) throw error
                bookingsToProcess = data || []
            }
            console.log('📋 Daily Calendar loaded:', bookingsToProcess.length, 'bookings')

            const categorized: Booking[] = []

            // Helper to check if a date string falls on the selected local date in Europe/Rome timezone
            const isSameDay = (dateStr?: string) => {
                if (!dateStr) return false

                // Extract components in Europe/Rome timezone from the UTC timestamp
                const romeComponents = getRomeDateComponents(dateStr)

                // Extract components from selectedDate in Europe/Rome timezone
                const selectedComponents = getRomeDateComponents(selectedDate.toISOString())

                return romeComponents.day === selectedComponents.day &&
                    romeComponents.month === selectedComponents.month &&
                    romeComponents.year === selectedComponents.year
            }

            bookingsToProcess.forEach((booking: any) => {
                // Check-In (Pickup)
                if (isSameDay(booking.pickup_date)) {
                    const isRental = !booking.service_type ||
                        booking.service_type === 'rental' ||
                        booking.service_type === 'car_rental'
                    if (isRental) {
                        categorized.push({ ...booking, type: 'check-in' })
                    }
                }

                // Check-Out (Return)
                if (isSameDay(booking.dropoff_date)) {
                    const isRental = !booking.service_type ||
                        booking.service_type === 'rental' ||
                        booking.service_type === 'car_rental'
                    if (isRental) {
                        categorized.push({ ...booking, type: 'check-out' })
                    }
                }

                // Car Wash
                if (booking.service_type === 'car_wash' &&
                    isSameDay(booking.appointment_date)) {
                    categorized.push({ ...booking, type: 'lavaggio' })
                }

                // Mechanical
                if ((booking.service_type === 'mechanical_service' || booking.service_type === 'mechanical') &&
                    isSameDay(booking.appointment_date)) {
                    categorized.push({ ...booking, type: 'meccanica' })
                }

                // Varie (miscellaneous)
                if (booking.service_type === 'varie' &&
                    (isSameDay(booking.pickup_date) || isSameDay(booking.appointment_date))) {
                    categorized.push({ ...booking, type: 'varie' })
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
            // Try multiple sources for pickup time
            const time = booking.booking_details?.pickupTime ||
                booking.booking_details?.pickup_time ||
                (booking.pickup_date ? new Date(booking.pickup_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : null)

            if (!time) {
                console.warn('⚠️ Missing pickup time for booking:', booking.id, booking)
                return '09:00' // Default fallback
            }
            return time
        }
        if (booking.type === 'check-out') {
            // Try multiple sources for return time
            const time = booking.booking_details?.returnTime ||
                booking.booking_details?.return_time ||
                (booking.dropoff_date ? new Date(booking.dropoff_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : null)

            if (!time) {
                console.warn('⚠️ Missing return time for booking:', booking.id, booking)
                return '18:00' // Default fallback
            }
            return time
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

    // Parse customer name with fallback to booking_details
    const parseCustomerName = (booking: Booking) => {
        const fullName = booking.customer_name
            || booking.booking_details?.customer?.fullName
            || booking.booking_details?.customer?.name
            || booking.booking_details?.guest_name
        if (!fullName || fullName === 'Cliente Sconosciuto') return 'N/A'
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
    const isToday = selectedDate.getDate() === new Date().getDate() &&
        selectedDate.getMonth() === new Date().getMonth() &&
        selectedDate.getFullYear() === new Date().getFullYear()

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
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-text-primary mx-auto mb-4"></div>
                <p className="text-theme-text-primary">Caricamento calendario giornaliero...</p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="bg-theme-bg-secondary rounded-lg p-3 border border-theme-border shadow-lg">
                <div className="flex justify-between items-center">
                    <div>
                        <h2 className="hidden md:block text-xl font-bold text-theme-text-primary">Calendario Giornaliero</h2>
                        <p className="text-theme-text-primary font-semibold text-sm md:text-xs md:text-theme-text-muted md:mt-1">
                            <span className="md:hidden">
                                {selectedDate.toLocaleDateString('it-IT', {
                                    weekday: 'short',
                                    day: 'numeric',
                                    month: 'short'
                                })}
                            </span>
                            <span className="hidden md:inline">
                                {selectedDate.toLocaleDateString('it-IT', {
                                    weekday: 'long',
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                })}
                            </span>
                        </p>
                    </div>
                    <div className="flex gap-1.5 md:gap-2">
                        <button
                            onClick={() => navigateDay('prev')}
                            className="px-3 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded text-xs font-semibold"
                        >
                            ←
                        </button>
                        <button
                            onClick={() => setSelectedDate(new Date())}
                            className="px-3 py-2 bg-dr7-gold hover:bg-[#247a6f] text-white rounded text-xs font-bold"
                        >
                            Oggi
                        </button>
                        <button
                            onClick={() => navigateDay('next')}
                            className="px-3 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded text-xs font-semibold"
                        >
                            →
                        </button>
                    </div>
                </div>
            </div>

            {/* Calendar Grid — Desktop */}
            <div className="hidden md:block bg-theme-bg-secondary rounded-lg border border-theme-border shadow-lg overflow-x-auto">
                {/* Header Row with Categories */}
                <div className="grid grid-cols-[60px_1fr_1fr_1fr_1fr] lg:grid-cols-[80px_1fr_1fr_1fr_1fr] border-b-2 border-theme-border bg-theme-bg-tertiary sticky top-0">
                    <div className="p-1.5 lg:p-2 text-[10px] lg:text-xs font-bold text-theme-text-muted">ORA</div>
                    <div className="p-1.5 lg:p-2 text-[10px] lg:text-xs font-bold text-center border-l border-theme-border">
                        <div className="flex items-center justify-center gap-1">
                            <div className="w-2.5 h-2.5 lg:w-3 lg:h-3 bg-green-600 rounded shrink-0"></div>
                            <span className="text-theme-text-secondary truncate">NOLEGGIO</span>
                        </div>
                    </div>
                    <div className="p-1.5 lg:p-2 text-[10px] lg:text-xs font-bold text-center border-l border-theme-border">
                        <div className="flex items-center justify-center gap-1">
                            <div className="w-2.5 h-2.5 lg:w-3 lg:h-3 bg-blue-600 rounded shrink-0"></div>
                            <span className="text-theme-text-secondary truncate">LAVAGGIO</span>
                        </div>
                    </div>
                    <div className="p-1.5 lg:p-2 text-[10px] lg:text-xs font-bold text-center border-l border-theme-border">
                        <div className="flex items-center justify-center gap-1">
                            <div className="w-2.5 h-2.5 lg:w-3 lg:h-3 bg-orange-600 rounded shrink-0"></div>
                            <span className="text-theme-text-secondary truncate">MECCANICA</span>
                        </div>
                    </div>
                    <div className="p-1.5 lg:p-2 text-[10px] lg:text-xs font-bold text-center border-l border-theme-border">
                        <div className="flex items-center justify-center gap-1">
                            <div className="w-2.5 h-2.5 lg:w-3 lg:h-3 bg-purple-600 rounded shrink-0"></div>
                            <span className="text-theme-text-secondary truncate">VARIE</span>
                        </div>
                    </div>
                </div>

                {/* Time Rows */}
                <div className="divide-y divide-theme-border">
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
                                return <span className="text-theme-text-secondary text-xs">—</span>
                            }
                            return bookings.map((booking) => {
                                const label =
                                    booking.type === 'check-in' ? 'USCITE' :
                                        booking.type === 'check-out' ? 'RIENTRI' :
                                            booking.type === 'lavaggio' ? 'LAVAGGIO' :
                                                booking.type === 'meccanica' ? 'MECCANICA' :
                                                    'VARIE'

                                // Determine label text color based on booking type
                                const labelColor =
                                    booking.type === 'check-in' ? 'text-yellow-400' :
                                        booking.type === 'check-out' ? 'text-yellow-300' :
                                            'text-theme-text-primary'

                                return (
                                    <div
                                        key={booking.id}
                                        className={`${bgColor} text-theme-text-primary rounded px-1.5 lg:px-2 py-1 lg:py-1.5 text-xs mb-1 shadow-md hover:shadow-lg transition-shadow overflow-hidden`}
                                    >
                                        <div
                                            className={`font-bold text-[10px] mb-0.5 ${labelColor}`}
                                            style={booking.type === 'check-out' ? { color: '#fbbf24' } : undefined}
                                        >
                                            {label}
                                        </div>
                                        <div className="font-bold text-xs lg:text-sm leading-tight truncate">{parseCustomerName(booking)}</div>
                                        <div className="text-theme-text-primary/90 text-[10px] lg:text-xs mt-0.5 truncate">{booking.vehicle_name}</div>
                                        {booking.type !== 'lavaggio' && (
                                            <div className="text-theme-text-primary/80 font-mono text-[10px] mt-0.5">🚗 {getTarga(booking)}</div>
                                        )}
                                        {booking.service_name && (
                                            <div className="text-theme-text-primary/70 text-[10px] mt-1 italic">{booking.service_name}</div>
                                        )}
                                    </div>
                                )
                            })
                        }

                        return (
                            <div
                                key={slot}
                                ref={isCurrentSlot ? currentTimeRef : null}
                                className={`grid grid-cols-[60px_1fr_1fr_1fr_1fr] lg:grid-cols-[80px_1fr_1fr_1fr_1fr] ${isCurrentSlot ? 'bg-theme-bg-tertiary/50 border-l-2 border-dr7-gold' : ''
                                    } hover:bg-theme-bg-tertiary/30 transition-colors`}
                            >
                                {/* Time Column */}
                                <div className="p-2 text-theme-text-muted font-mono text-xs font-semibold border-r border-theme-border">
                                    {slot}
                                </div>

                                {/* Noleggio Column */}
                                <div className="p-1.5 border-l border-theme-border">
                                    {renderBookings(noleggioBookings, 'bg-green-600')}
                                </div>

                                {/* Lavaggio Column */}
                                <div className="p-1.5 border-l border-theme-border">
                                    {renderBookings(lavaggioBookings, 'bg-blue-600')}
                                </div>

                                {/* Meccanica Column */}
                                <div className="p-1.5 border-l border-theme-border">
                                    {renderBookings(meccanicaBookings, 'bg-orange-600')}
                                </div>

                                {/* Varie Column */}
                                <div className="p-1.5 border-l border-theme-border">
                                    {renderBookings(varieBookings, 'bg-purple-600')}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Calendar — Mobile Timeline */}
            <div className="md:hidden bg-theme-bg-secondary rounded-lg border border-theme-border shadow-lg overflow-hidden">
                {/* Category legend */}
                <div className="flex flex-wrap gap-2 px-3 py-2.5 border-b border-theme-border bg-theme-bg-tertiary">
                    <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-green-600 rounded-sm shrink-0" /><span className="text-[11px] text-theme-text-muted">Noleggio</span></div>
                    <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-blue-600 rounded-sm shrink-0" /><span className="text-[11px] text-theme-text-muted">Lavaggio</span></div>
                    <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-orange-600 rounded-sm shrink-0" /><span className="text-[11px] text-theme-text-muted">Meccanica</span></div>
                    <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-purple-600 rounded-sm shrink-0" /><span className="text-[11px] text-theme-text-muted">Varie</span></div>
                </div>

                <div className="divide-y divide-white/[0.06]">
                    {TIME_SLOTS.map((slot) => {
                        const slotBookings = getSlotBookings(slot)
                        const isCurrentSlot = isToday && slot === currentSlot
                        const hasBookings = slotBookings.length > 0

                        // Skip empty slots on mobile (unless it's the current time slot)
                        if (!hasBookings && !isCurrentSlot) return null

                        const getCategoryColor = (type: Booking['type']) => {
                            switch (type) {
                                case 'check-in':
                                case 'check-out':
                                    return 'border-green-600'
                                case 'lavaggio':
                                    return 'border-blue-600'
                                case 'meccanica':
                                    return 'border-orange-600'
                                case 'varie':
                                    return 'border-purple-600'
                            }
                        }

                        const getDotColor = (type: Booking['type']) => {
                            switch (type) {
                                case 'check-in':
                                case 'check-out':
                                    return 'bg-green-600'
                                case 'lavaggio':
                                    return 'bg-blue-600'
                                case 'meccanica':
                                    return 'bg-orange-600'
                                case 'varie':
                                    return 'bg-purple-600'
                            }
                        }

                        const getLabel = (type: Booking['type']) => {
                            switch (type) {
                                case 'check-in': return 'USCITE'
                                case 'check-out': return 'RIENTRI'
                                case 'lavaggio': return 'LAVAGGIO'
                                case 'meccanica': return 'MECCANICA'
                                case 'varie': return 'VARIE'
                            }
                        }

                        return (
                            <div
                                key={slot}
                                ref={isCurrentSlot ? currentTimeRef : null}
                                className={isCurrentSlot ? 'bg-theme-bg-tertiary/50' : ''}
                            >
                                {/* Time label */}
                                <div className={`px-3 pt-2.5 pb-1 flex items-center gap-2 ${isCurrentSlot ? 'text-dr7-gold' : 'text-theme-text-muted'}`}>
                                    <span className="font-mono text-xs font-bold">{slot}</span>
                                    {isCurrentSlot && <div className="h-px flex-1 bg-dr7-gold/40" />}
                                </div>

                                {/* Event cards */}
                                <div className="px-3 pb-2.5 space-y-1.5">
                                    {slotBookings.map((booking) => (
                                        <div
                                            key={`${booking.id}-${booking.type}`}
                                            className={`border-l-4 ${getCategoryColor(booking.type)} bg-theme-bg-tertiary rounded-r-lg px-2.5 py-2 overflow-hidden`}
                                        >
                                            <div className="flex items-center gap-1.5 mb-0.5">
                                                <div className={`w-2 h-2 rounded-full shrink-0 ${getDotColor(booking.type)}`} />
                                                <span className="text-[10px] font-bold text-theme-text-muted tracking-wide">{getLabel(booking.type)}</span>
                                            </div>
                                            <div className="font-bold text-sm text-theme-text-primary leading-tight truncate">{parseCustomerName(booking)}</div>
                                            <div className="text-xs text-theme-text-primary/80 mt-0.5 truncate">
                                                {booking.vehicle_name}
                                                {booking.type !== 'lavaggio' && <span className="font-mono ml-1.5">{getTarga(booking)}</span>}
                                            </div>
                                            {booking.service_name && (
                                                <div className="text-[10px] text-theme-text-primary/60 mt-1 italic">{booking.service_name}</div>
                                            )}
                                        </div>
                                    ))}
                                    {!hasBookings && isCurrentSlot && (
                                        <p className="text-xs text-theme-text-muted italic">Nessun evento</p>
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
