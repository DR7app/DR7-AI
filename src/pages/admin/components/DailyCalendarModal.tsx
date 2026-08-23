import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import {
    DAILY_CATEGORIES, categorizeDayBooking, categoryOf, categoryMeta, labelOf,
    dailyBookingTime, type DailyType,
} from '../../../utils/dailyCalendarCategories'
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    booking_details: any
    status: string
    type: DailyType
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

    const getLabel = () => labelOf(booking.type)

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

            // 2026-08-23: il filtro era un OR di estremi SCIOLLTI
            // (pickup >= inizio OR pickup < fine OR ...): vero per quasi ogni
            // riga, quindi la query scaricava l'intera tabella e PostgREST la
            // tagliava a 1000 righe — con la tabella cresciuta, giornate intere
            // sparivano. Ora ogni campo e' un intervallo chiuso dentro un and().
            const qs = queryStart.toISOString()
            const qe = queryEnd.toISOString()
            const { data, error } = await supabase
                .from('bookings')
                .select('*')
                .neq('status', 'cancelled')
                .or(`and(pickup_date.gte.${qs},pickup_date.lt.${qe}),`
                  + `and(dropoff_date.gte.${qs},dropoff_date.lt.${qe}),`
                  + `and(appointment_date.gte.${qs},appointment_date.lt.${qe})`)

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

            // 2026-08-23: la giornata copre TUTTI i business (Terra, Mare, Aria,
            // Soggiorni), i servizi (Lavaggio, Meccanica) e le Uscite
            // Straordinarie. Regole in utils/dailyCalendarCategories.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data?.forEach((booking: any) => {
                for (const type of categorizeDayBooking(booking, isSameDay)) {
                    categorized.push({ ...booking, type })
                }
            })

            setBookings(categorized)
        } catch (error) {
            console.error('Failed to load day bookings:', error)
        } finally {
            setLoading(false)
        }
    }

    const getBookingTime = (booking: Booking): string => dailyBookingTime(booking, booking.type)

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

    // Corsie del giorno: solo le categorie che hanno davvero qualcosa in agenda,
    // nell'ordine del catalogo. Con la sola Terra la vista resta identica a prima;
    // in una giornata piena si divide fino a otto corsie.
    const activeCategories = DAILY_CATEGORIES.filter(cat =>
        bookings.some(b => categoryOf(b.type) === cat.id))

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

                    {/* Category Legend — 2026-08-23: generata dal catalogo, cosi'
                        non puo' piu' restare indietro rispetto alle corsie. */}
                    <div className="flex flex-wrap justify-center gap-3 sm:gap-5 py-1 sm:py-2">
                        {DAILY_CATEGORIES.map(cat => (
                            <div key={cat.id} className="flex items-center gap-1.5">
                                <div className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-gradient-to-br ${cat.dot} shadow-lg`} />
                                <span className="text-xs sm:text-sm text-theme-text-secondary font-light">{cat.label}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Content */}
                {loading ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-dr7-gold" />
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                        {/* 2026-08-23: le corsie sono quelle DEL GIORNO, non piu' 4 fisse.
                            Calcolate una volta sola sull'intera giornata: se cambiassero
                            riga per riga le colonne non resterebbero allineate. */}
                        {TIME_SLOTS.map((slot) => {
                            const slotBookings = getSlotBookings(slot)
                            const isCurrentSlot = isToday && slot === currentSlot
                            const hasBookings = slotBookings.length > 0


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

                                    {/* Desktop: una colonna per categoria presente oggi */}
                                    <div
                                        className="hidden sm:grid flex-1 gap-3"
                                        style={{ gridTemplateColumns: `repeat(${Math.max(activeCategories.length, 1)}, minmax(0, 1fr))` }}
                                    >
                                        {activeCategories.map(cat => (
                                            <div key={cat.id} className="space-y-2">
                                                {slotBookings.filter(b => categoryOf(b.type) === cat.id).map(booking => (
                                                    <ActivityCard
                                                        key={`${booking.id}-${booking.type}`}
                                                        booking={booking}
                                                        colorClass={cat.color}
                                                        gradientClass={cat.gradient}
                                                        glowClass={cat.glow}
                                                    />
                                                ))}
                                            </div>
                                        ))}
                                    </div>

                                    {/* Mobile: single column stacked */}
                                    <div className="sm:hidden flex-1 space-y-1.5">
                                        {slotBookings.map(booking => {
                                            const colors = categoryMeta(categoryOf(booking.type))
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
