import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import { getRomeDateComponents, formatRomeDate, parseUTCToRome } from '../../../utils/timezoneUtils'

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    booking_details: any
    status: string
    type: 'check-in' | 'check-out' | 'lavaggio' | 'meccanica' | 'varie'
}

interface ActivityCardProps {
    booking: Booking
    colorClass: string
    gradientClass: string
    glowClass: string
}

// Generate 15-minute time slots for business hours (9 AM - 8 PM)
const generateTimeSlots = () => {
    const slots: string[] = []
    for (let hour = 9; hour <= 20; hour++) {
        for (let minute = 0; minute < 60; minute += 15) {
            const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
            slots.push(time)
            if (hour === 20 && minute === 0) break
        }
    }
    return slots
}

const TIME_SLOTS = generateTimeSlots()

function ActivityCard({ booking, colorClass, gradientClass, glowClass }: ActivityCardProps) {
    const parseCustomerName = (fullName: string | null) => {
        if (!fullName) return 'N/A'
        const parts = fullName.trim().split(' ')
        if (parts.length === 1) return parts[0]
        return fullName
    }

    const getTarga = (booking: Booking): string => {
        return booking.vehicle_plate ||
            booking.booking_details?.vehicle?.targa ||
            booking.booking_details?.vehicle?.plate ||
            'N/A'
    }

    const getLabel = () => {
        switch (booking.type) {
            case 'check-in': return 'USCITE'
            case 'check-out': return 'RIENTRI'
            case 'lavaggio': return 'LAVAGGIO'
            case 'meccanica': return 'MECCANICA'
            default: return 'VARIE'
        }
    }

    return (
        <div className={`
            relative group
            bg-gradient-to-br ${gradientClass}
            backdrop-blur-sm
            rounded-lg
            border-l-2 ${colorClass}
            p-3
            transition-all duration-200
            hover:scale-[1.02]
            hover:shadow-lg ${glowClass}
            cursor-pointer
        `}>
            <div
                className={`
                inline-block px-2 py-0.5 rounded-full
                bg-theme-text-primary/10
                text-xs font-semibold uppercase tracking-wide
                mb-1.5
                ${booking.type === 'check-out' ? 'text-yellow-400' : colorClass.replace('border-', 'text-')}
            `}
                style={booking.type === 'check-out' ? { color: '#fbbf24' } : undefined}
            >
                {getLabel()}
            </div>

            <div className="text-theme-text-primary font-medium text-sm leading-tight mb-1">
                {booking.customer_name === 'Lavaggio Rientro' ? 'Lavaggio Rientro' : parseCustomerName(booking.customer_name)}
            </div>

            <div className="text-theme-text-secondary text-xs">
                {booking.customer_name === 'Lavaggio Rientro' && booking.vehicle_name ? booking.vehicle_name : booking.vehicle_name}
            </div>

            {booking.customer_name === 'Lavaggio Rientro' && booking.vehicle_plate ? (
                <div className="text-dr7-gold font-mono text-[10px] mt-1">
                    {booking.vehicle_plate}
                </div>
            ) : booking.type !== 'lavaggio' && (
                <div className="text-theme-text-muted font-mono text-[10px] mt-1">
                    {getTarga(booking)}
                </div>
            )}

            {booking.service_name && (
                <div className="text-theme-text-muted text-[10px] mt-1 italic">
                    {booking.service_name}
                </div>
            )}
        </div>
    )
}

interface DailyCalendarModalProps {
    isOpen: boolean
    onClose: () => void
}

export default function DailyCalendarModal({ isOpen, onClose }: DailyCalendarModalProps) {
    const [bookings, setBookings] = useState<Booking[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedDate, setSelectedDate] = useState(new Date())
    const currentTimeRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (isOpen) {
            loadDayBookings()
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = 'unset'
        }

        return () => {
            document.body.style.overflow = 'unset'
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, selectedDate])

    useEffect(() => {
        if (!isOpen) return

        const subscription = supabase
            .channel('daily-calendar-modal-updates')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'bookings' },
                () => loadDayBookings()
            )
            .subscribe()

        return () => {
            subscription.unsubscribe()
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, selectedDate])

    useEffect(() => {
        if (currentTimeRef.current && !loading && isOpen) {
            setTimeout(() => {
                currentTimeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }, 300)
        }
    }, [loading, isOpen])

    async function loadDayBookings() {
        setLoading(true)
        try {
            // Create start and end of the selected day in local time
            const startOfDay = new Date(selectedDate)
            startOfDay.setHours(0, 0, 0, 0)

            const endOfDay = new Date(selectedDate)
            endOfDay.setHours(23, 59, 59, 999)

            // Convert to ISO strings for DB query - add buffer for timezone differences
            const queryStart = new Date(startOfDay)
            queryStart.setDate(queryStart.getDate() - 1)

            const queryEnd = new Date(endOfDay)
            queryEnd.setDate(queryEnd.getDate() + 1)

            const { data, error } = await supabase
                .from('bookings')
                .select('*')
                .neq('status', 'cancelled')
                .or(`pickup_date.gte.${queryStart.toISOString()},pickup_date.lt.${queryEnd.toISOString()},dropoff_date.gte.${queryStart.toISOString()},dropoff_date.lt.${queryEnd.toISOString()},appointment_date.gte.${queryStart.toISOString()},appointment_date.lt.${queryEnd.toISOString()}`)

            if (error) throw error

            const categorized: Booking[] = []

            // Helper to check if a date string falls on the selected local date in Europe/Rome timezone
            const isSameDay = (dateStr?: string) => {
                if (!dateStr) return false
                const components = getRomeDateComponents(dateStr)
                return components.day === selectedDate.getDate() &&
                    components.month === (selectedDate.getMonth() + 1) && // components.month is 1-indexed
                    components.year === selectedDate.getFullYear()
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data?.forEach((booking: any) => {
                if (isSameDay(booking.pickup_date)) {
                    const isRental = !booking.service_type ||
                        booking.service_type === 'rental' ||
                        booking.service_type === 'car_rental'
                    if (isRental) {
                        categorized.push({ ...booking, type: 'check-in' })
                    }
                }

                if (isSameDay(booking.dropoff_date)) {
                    const isRental = !booking.service_type ||
                        booking.service_type === 'rental' ||
                        booking.service_type === 'car_rental'
                    if (isRental) {
                        categorized.push({ ...booking, type: 'check-out' })
                    }
                }

                // Only external customer washes — exclude internal return washes
                if (booking.service_type === 'car_wash' &&
                    isSameDay(booking.appointment_date) &&
                    booking.customer_name !== 'Lavaggio Rientro' &&
                    !booking.booking_details?.internal &&
                    !booking.booking_details?.auto_created) {
                    categorized.push({ ...booking, type: 'lavaggio' })
                }

                if ((booking.service_type === 'mechanical_service' || booking.service_type === 'mechanical') &&
                    isSameDay(booking.appointment_date)) {
                    categorized.push({ ...booking, type: 'meccanica' })
                }

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

    const getBookingTime = (booking: Booking): string => {
        if (booking.type === 'check-in') {
            return booking.booking_details?.pickupTime ||
                formatRomeDate(parseUTCToRome(booking.pickup_date!), { hour: '2-digit', minute: '2-digit', hour12: false })
        }
        if (booking.type === 'check-out') {
            return booking.booking_details?.returnTime ||
                formatRomeDate(parseUTCToRome(booking.dropoff_date!), { hour: '2-digit', minute: '2-digit', hour12: false })
        }
        return booking.appointment_time || '00:00'
    }

    const getTimeSlot = (time: string): string => {
        const [hours, minutes] = time.split(':').map(Number)
        const roundedMinutes = Math.floor(minutes / 15) * 15
        return `${hours.toString().padStart(2, '0')}:${roundedMinutes.toString().padStart(2, '0')}`
    }

    const getSlotBookings = (slot: string): Booking[] => {
        return bookings.filter(booking => {
            const bookingTime = getBookingTime(booking)
            const bookingSlot = getTimeSlot(bookingTime)
            return bookingSlot === slot
        })
    }

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

    const navigateDay = (direction: 'prev' | 'next') => {
        setSelectedDate(prev => {
            const newDate = new Date(prev)
            newDate.setDate(prev.getDate() + (direction === 'prev' ? -1 : 1))
            return newDate
        })
    }

    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-theme-bg-primary/60 backdrop-blur-md animate-fadeIn"
            onClick={onClose}
        >
            <div
                className="relative w-[95vw] max-w-6xl h-[90vh] bg-gradient-to-br from-theme-bg-primary/95 to-theme-bg-primary/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-theme-border/50 overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="sticky top-0 z-10 bg-gradient-to-r from-theme-bg-primary/90 to-theme-bg-secondary/90 backdrop-blur-lg border-b border-theme-border/50 px-4 sm:px-6 py-3 sm:py-4">
                    <div className="flex justify-between items-start sm:items-center gap-3 mb-3">
                        <h2 className="text-lg sm:text-2xl font-light text-theme-text-primary leading-tight">
                            {selectedDate.toLocaleDateString('it-IT', {
                                weekday: 'long',
                                day: 'numeric',
                                month: 'long',
                                year: 'numeric'
                            })}
                        </h2>

                        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                            <div className="flex gap-1.5 sm:gap-2">
                                <button
                                    onClick={() => navigateDay('prev')}
                                    className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-theme-text-primary/5 hover:bg-theme-text-primary/10 border border-theme-border/50 text-theme-text-primary text-xs sm:text-sm transition-all duration-200"
                                >
                                    Prec
                                </button>
                                <button
                                    onClick={() => setSelectedDate(new Date())}
                                    className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-dr7-gold/20 hover:bg-dr7-gold/30 border border-dr7-gold/30 text-dr7-gold text-xs sm:text-sm font-semibold transition-all duration-200"
                                >
                                    Oggi
                                </button>
                                <button
                                    onClick={() => navigateDay('next')}
                                    className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-theme-text-primary/5 hover:bg-theme-text-primary/10 border border-theme-border/50 text-theme-text-primary text-xs sm:text-sm transition-all duration-200"
                                >
                                    Succ
                                </button>
                            </div>

                            <button
                                onClick={onClose}
                                className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-theme-text-primary/5 hover:bg-theme-text-primary/10 border border-theme-border/50 flex items-center justify-center transition-all duration-200 hover:rotate-90 text-theme-text-primary text-lg sm:text-xl"
                            >
                                ✕
                            </button>
                        </div>
                    </div>

                    {/* Category Legend */}
                    <div className="flex flex-wrap justify-center gap-3 sm:gap-6 py-1 sm:py-2">
                        <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-gradient-to-br from-green-500 to-green-600 shadow-lg shadow-green-500/50" />
                            <span className="text-xs sm:text-sm text-theme-text-secondary font-light">Noleggio</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/50" />
                            <span className="text-xs sm:text-sm text-theme-text-secondary font-light">Lavaggio</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg shadow-orange-500/50" />
                            <span className="text-xs sm:text-sm text-theme-text-secondary font-light">Meccanica</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 shadow-lg shadow-purple-500/50" />
                            <span className="text-xs sm:text-sm text-theme-text-secondary font-light">Varie</span>
                        </div>
                    </div>
                </div>

                {/* Content */}
                {loading ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-dr7-gold" />
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                        {TIME_SLOTS.map((slot) => {
                            const slotBookings = getSlotBookings(slot)
                            const isCurrentSlot = isToday && slot === currentSlot
                            const hasBookings = slotBookings.length > 0

                            const noleggioBookings = slotBookings.filter(b => b.type === 'check-in' || b.type === 'check-out')
                            const lavaggioBookings = slotBookings.filter(b => b.type === 'lavaggio')
                            const meccanicaBookings = slotBookings.filter(b => b.type === 'meccanica')
                            const varieBookings = slotBookings.filter(b => b.type === 'varie')

                            // On mobile, skip empty slots (unless current time)
                            const mobileHidden = !hasBookings && !isCurrentSlot ? 'hidden sm:flex' : 'flex'

                            return (
                                <div
                                    key={slot}
                                    ref={isCurrentSlot ? currentTimeRef : null}
                                    className={`relative ${mobileHidden} gap-3 sm:gap-4 mb-3 ${isCurrentSlot ? 'py-2' : ''}`}
                                >
                                    {isCurrentSlot && (
                                        <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-dr7-gold to-transparent shadow-lg shadow-dr7-gold/50" />
                                    )}

                                    <div className="w-12 sm:w-16 flex-shrink-0 pt-2">
                                        <span className={`text-xs sm:text-sm font-mono ${isCurrentSlot ? 'text-dr7-gold font-semibold' : 'text-theme-text-muted'}`}>
                                            {slot}
                                        </span>
                                    </div>

                                    {/* Desktop: 4-column grid */}
                                    <div className="hidden sm:grid flex-1 grid-cols-4 gap-3">
                                        <div className="space-y-2">
                                            {noleggioBookings.map(booking => (
                                                <ActivityCard key={booking.id} booking={booking} colorClass="border-green-500" gradientClass="from-green-500/20 to-green-600/10" glowClass="hover:shadow-green-500/30" />
                                            ))}
                                        </div>
                                        <div className="space-y-2">
                                            {lavaggioBookings.map(booking => (
                                                <ActivityCard key={booking.id} booking={booking} colorClass="border-blue-500" gradientClass="from-blue-500/20 to-blue-600/10" glowClass="hover:shadow-blue-500/30" />
                                            ))}
                                        </div>
                                        <div className="space-y-2">
                                            {meccanicaBookings.map(booking => (
                                                <ActivityCard key={booking.id} booking={booking} colorClass="border-orange-500" gradientClass="from-orange-500/20 to-orange-600/10" glowClass="hover:shadow-orange-500/30" />
                                            ))}
                                        </div>
                                        <div className="space-y-2">
                                            {varieBookings.map(booking => (
                                                <ActivityCard key={booking.id} booking={booking} colorClass="border-purple-500" gradientClass="from-purple-500/20 to-purple-600/10" glowClass="hover:shadow-purple-500/30" />
                                            ))}
                                        </div>
                                    </div>

                                    {/* Mobile: single column stacked */}
                                    <div className="sm:hidden flex-1 space-y-1.5">
                                        {slotBookings.map(booking => {
                                            const colorMap: Record<string, { color: string; gradient: string; glow: string }> = {
                                                'check-in': { color: 'border-green-500', gradient: 'from-green-500/20 to-green-600/10', glow: 'hover:shadow-green-500/30' },
                                                'check-out': { color: 'border-green-500', gradient: 'from-green-500/20 to-green-600/10', glow: 'hover:shadow-green-500/30' },
                                                'lavaggio': { color: 'border-blue-500', gradient: 'from-blue-500/20 to-blue-600/10', glow: 'hover:shadow-blue-500/30' },
                                                'meccanica': { color: 'border-orange-500', gradient: 'from-orange-500/20 to-orange-600/10', glow: 'hover:shadow-orange-500/30' },
                                                'varie': { color: 'border-purple-500', gradient: 'from-purple-500/20 to-purple-600/10', glow: 'hover:shadow-purple-500/30' },
                                            }
                                            const colors = colorMap[booking.type] || colorMap['varie']
                                            return (
                                                <ActivityCard key={`${booking.id}-${booking.type}`} booking={booking} colorClass={colors.color} gradientClass={colors.gradient} glowClass={colors.glow} />
                                            )
                                        })}
                                        {!hasBookings && isCurrentSlot && (
                                            <p className="text-xs text-theme-text-muted italic py-1">Nessun evento</p>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
