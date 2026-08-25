import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import { getRomeDateComponents } from '../../../utils/timezoneUtils'
import { logger } from '../../../utils/logger'
import BookingDetailsPanel from './BookingDetailsPanel'
import { authFetch } from '../../../utils/authFetch'
import {
    resolveDailyCategories, categorizeDayBooking, categoryOf, badgeOf,
    dailyBookingTime, dailyTimeSlots, orphanLaneCounts,
    DAILY_PALETTE, DAILY_CATEGORIES_CONFIG_KEY,
    type DailyType, type DailyCategory, type DailyCategoryConfig,
} from '../../../utils/dailyCalendarCategories'

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

// Generate 15-minute time slots for business hours (9 AM - 8 PM)

export default function DailyCalendarTab() {
    const [bookings, setBookings] = useState<Booking[]>([])
    // Etichette/colori/ordine delle corsie, da Centralina Pro. Null = catalogo
    // di fabbrica: la vista funziona anche se la config non e' mai stata salvata.
    const [catConfig, setCatConfig] = useState<DailyCategoryConfig[] | null>(null)
    const [loading, setLoading] = useState(true)
    const [selectedDate, setSelectedDate] = useState(new Date())
    // 25/08/2026: cliccando un evento si apre la scheda della prenotazione,
    // lo stesso pannello del Calendario mensile. Prima le card della giornata
    // erano l'unico posto del gestionale dove una prenotazione a schermo non si
    // poteva aprire: bisognava andarla a cercare in Prenotazioni.
    const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
    const currentTimeRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        void (async () => {
            try {
                const { data } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
                const cfg = (data?.config as Record<string, unknown>) || {}
                const list = cfg[DAILY_CATEGORIES_CONFIG_KEY]
                if (Array.isArray(list)) setCatConfig(list as DailyCategoryConfig[])
            } catch { /* catalogo di fabbrica */ }
        })()
    }, [])

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
    // catConfig fa parte delle dipendenze: le corsie personalizzate arrivano
    // dopo il primo render, e senza questo le prenotazioni dirottate su una
    // corsia nuova non comparirebbero fino al reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDate, catConfig])

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
            logger.log('🔍 Daily Calendar loading for:', selectedDate.toLocaleDateString('it-IT'))

            // Fetch ALL bookings via Netlify function (bypasses RLS)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let bookingsToProcess: any[] = []
            try {
                // 2026-08-23: senza finestra la funzione restituisce TUTTE le
                // prenotazioni e sfonda il tetto di 6 MB di Netlify: il
                // calendario resta vuoto. Si chiede solo il giorno +/- 1.
                const from = new Date(selectedDate); from.setDate(from.getDate() - 1); from.setHours(0, 0, 0, 0)
                const to = new Date(selectedDate); to.setDate(to.getDate() + 1); to.setHours(23, 59, 59, 999)
                const qs = `?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
                const res = await authFetch(`/.netlify/functions/list-bookings${qs}`)
                const result = await res.json()
                if (res.ok && result.bookings) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    bookingsToProcess = result.bookings.filter((b: any) => b.status !== 'cancelled')
                }
            } catch {
                // Netlify function unavailable, fallback
            }

            if (bookingsToProcess.length === 0) {
                const fFrom = new Date(selectedDate); fFrom.setDate(fFrom.getDate() - 1); fFrom.setHours(0, 0, 0, 0)
                const fTo = new Date(selectedDate); fTo.setDate(fTo.getDate() + 1); fTo.setHours(23, 59, 59, 999)
                const a = fFrom.toISOString(), b = fTo.toISOString()
                const { data, error } = await supabase
                    .from('bookings')
                    .select('*')
                    .neq('status', 'cancelled')
                    .or(`and(pickup_date.gte.${a},pickup_date.lt.${b}),`
                      + `and(dropoff_date.gte.${a},dropoff_date.lt.${b}),`
                      + `and(appointment_date.gte.${a},appointment_date.lt.${b})`)
                    .order('created_at', { ascending: false })
                if (error) throw error
                bookingsToProcess = data || []
            }
            logger.log('📋 Daily Calendar loaded:', bookingsToProcess.length, 'bookings')

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

            // Corsie personalizzate attive: instradano i service_type scelti
            // dall'admin prima delle regole di fabbrica.
            const customLanes = resolveDailyCategories(catConfig)
                .filter(c => c.enabled && c.custom)
                .map(c => ({ id: c.id, serviceTypes: c.serviceTypes }))

            // 2026-08-23: la giornata copre TUTTI i business (Terra, Mare, Aria,
            // Soggiorni), i servizi (Lavaggio, Meccanica) e le Uscite
            // Straordinarie. Regole in utils/dailyCalendarCategories.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            bookingsToProcess.forEach((booking: any) => {
                for (const type of categorizeDayBooking(booking, isSameDay, customLanes)) {
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

    // Get booking time
    const getBookingTime = (booking: Booking): string => dailyBookingTime(booking, booking.type)

    // 25/08: griglia oraria che segue la giornata invece della finestra fissa
    // 09:00-20:00. Fuori da quella finestra la card non trovava una riga e la
    // prenotazione spariva senza segnalare niente.
    const TIME_SLOTS = useMemo(
        () => dailyTimeSlots(bookings.map(b => dailyBookingTime(b, b.type))),
        [bookings],
    )

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

    // Corsie del giorno: solo le categorie ATTIVE (Centralina Pro > Calendario
    // Giornaliero) che hanno davvero qualcosa in agenda, nell'ordine
    // configurato. Calcolate una volta sola, altrimenti le colonne non
    // resterebbero allineate tra una fascia oraria e l'altra.
    const allCategories = resolveDailyCategories(catConfig).filter(c => c.enabled)
    const metaOf = (id: string): DailyCategory =>
        allCategories.find(c => c.id === id)
        || { ...DAILY_PALETTE.slate, id: 'varie', label: 'Altro', enabled: true, colorKey: 'slate' } as DailyCategory
    // Niente colonne vuote: una corsia entra nella giornata solo se ha
    // qualcosa in agenda (direzione, 24/08). Una corsia nuova si verifica
    // dalla configurazione, non occupando spazio nella griglia.
    const activeCategories = allCategories.filter(cat =>
        bookings.some(b => categoryOf(b.type) === cat.id))

    // 25/08: vedi DailyCalendarModal — una prenotazione la cui corsia e' spenta
    // o eliminata non ha una colonna dove stare e sparirebbe in silenzio.
    const corsieMancanti = orphanLaneCounts(bookings.map(b => b.type), allCategories.map(c => c.id))
    const gridTemplate = `60px repeat(${Math.max(activeCategories.length, 1)}, minmax(0, 1fr))`

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
                            className="px-3 py-2 bg-dr7-gold hover:bg-[#0A8FA3] text-white rounded text-xs font-bold"
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

            {corsieMancanti.length > 0 && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    {corsieMancanti.map(c => `${c.count} ${c.count === 1 ? 'prenotazione' : 'prenotazioni'} di ${c.label}`).join(', ')}
                    {' '}non {corsieMancanti.length === 1 && corsieMancanti[0].count === 1 ? 'compare' : 'compaiono'} in griglia:
                    {' '}la corsia e' spenta o eliminata. Riaccendila in Centralina Pro &gt; Calendario Giornaliero.
                </div>
            )}

            {/* Calendar Grid — Desktop */}
            <div className="hidden md:block bg-theme-bg-secondary rounded-lg border border-theme-border shadow-lg overflow-x-auto">
                {/* Header Row with Categories — 2026-08-23: una colonna per
                    categoria presente nel giorno, generata dal catalogo. */}
                <div
                    className="grid border-b-2 border-theme-border bg-theme-bg-tertiary sticky top-0"
                    style={{ gridTemplateColumns: gridTemplate }}
                >
                    <div className="p-1.5 lg:p-2 text-[10px] lg:text-xs font-bold text-theme-text-muted">ORA</div>
                    {activeCategories.map(cat => (
                        <div key={cat.id} className="p-1.5 lg:p-2 text-[10px] lg:text-xs font-bold text-center border-l border-theme-border">
                            <div className="flex items-center justify-center gap-1">
                                <div className={`w-2.5 h-2.5 lg:w-3 lg:h-3 ${cat.solid} rounded shrink-0`}></div>
                                <span className="text-theme-text-secondary truncate">{cat.label.toUpperCase()}</span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Time Rows */}
                <div className="divide-y divide-theme-border">
                    {TIME_SLOTS.map((slot) => {
                        const slotBookings = getSlotBookings(slot)
                        const isCurrentSlot = isToday && slot === currentSlot

                        // Separate bookings by type

                        const renderBookings = (bookings: Booking[], bgColor: string, laneLabel: string) => {
                            if (bookings.length === 0) {
                                return <span className="text-theme-text-secondary text-xs">—</span>
                            }
                            return bookings.map((booking) => {
                                // 25/08: il badge porta il nome del business
                                // (Mare, Aria, Soggiorni...) e non solo il momento:
                                // 'RIENTRI' da solo e' identico per tutte le corsie.
                                const label = badgeOf(booking.type, laneLabel)

                                // Determine label text color based on booking type
                                const labelColor =
                                    booking.type === 'check-in' ? 'text-yellow-400' :
                                        booking.type === 'check-out' ? 'text-yellow-300' :
                                            'text-theme-text-primary'

                                const bookingHasNotes = !!(booking.booking_details?.notes && String(booking.booking_details.notes).trim())

                                return (
                                    <div
                                        key={booking.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setSelectedBooking(booking)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedBooking(booking) } }}
                                        title="Apri la scheda della prenotazione"
                                        className={`${bgColor} text-theme-text-primary rounded px-1.5 lg:px-2 py-1 lg:py-1.5 text-xs mb-1 shadow-md hover:shadow-lg transition-shadow overflow-hidden cursor-pointer focus:outline-none focus:ring-2 focus:ring-dr7-gold`}
                                        style={bookingHasNotes ? { boxShadow: 'inset 0 0 0 2.5px #FACC15' } : undefined}
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
                                className={`grid ${isCurrentSlot ? 'bg-theme-bg-tertiary/50 border-l-2 border-dr7-gold' : ''
                                    } hover:bg-theme-bg-tertiary/30 transition-colors`}
                                style={{ gridTemplateColumns: gridTemplate }}
                            >
                                {/* Time Column */}
                                <div className="p-2 text-theme-text-muted font-mono text-xs font-semibold border-r border-theme-border">
                                    {slot}
                                </div>

                                {activeCategories.map(cat => (
                                    <div key={cat.id} className="p-1.5 border-l border-theme-border">
                                        {renderBookings(slotBookings.filter(b => categoryOf(b.type) === cat.id), cat.solid, cat.label)}
                                    </div>
                                ))}
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Calendar — Mobile Timeline */}
            <div className="md:hidden bg-theme-bg-secondary rounded-lg border border-theme-border shadow-lg overflow-hidden">
                {/* Category legend */}
                <div className="flex flex-wrap gap-2 px-3 py-2.5 border-b border-theme-border bg-theme-bg-tertiary">
                    {allCategories.map(cat => (
                        <div key={cat.id} className="flex items-center gap-1.5">
                            <div className={`w-3 h-3 ${cat.solid} rounded-sm shrink-0`} />
                            <span className="text-[11px] text-theme-text-muted">{cat.label}</span>
                        </div>
                    ))}
                </div>

                <div className="divide-y divide-white/[0.06]">
                    {TIME_SLOTS.map((slot) => {
                        const slotBookings = getSlotBookings(slot)
                        const isCurrentSlot = isToday && slot === currentSlot
                        const hasBookings = slotBookings.length > 0

                        // Skip empty slots on mobile (unless it's the current time slot)
                        if (!hasBookings && !isCurrentSlot) return null

                        const getCategoryColor = (type: Booking['type']) => metaOf(categoryOf(type)).solidBorder
                        const getDotColor = (type: Booking['type']) => metaOf(categoryOf(type)).solid
                        const getLabel = (type: Booking['type']) => badgeOf(type, metaOf(categoryOf(type)).label)

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
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setSelectedBooking(booking)}
                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedBooking(booking) } }}
                                            className={`border-l-4 ${getCategoryColor(booking.type)} bg-theme-bg-tertiary rounded-r-lg px-2.5 py-2 overflow-hidden cursor-pointer active:bg-theme-bg-hover focus:outline-none focus:ring-2 focus:ring-dr7-gold`}
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

            {/* Scheda prenotazione: stesso pannello del Calendario mensile, cosi'
                le due viste non divergono. "Modifica" riapre la prenotazione in
                Prenotazioni, come fa CalendarTab. */}
            {selectedBooking && (
                <BookingDetailsPanel
                    booking={selectedBooking}
                    onClose={() => setSelectedBooking(null)}
                    onEdit={(bookingId) => {
                        window.dispatchEvent(new CustomEvent('openBookingForm', {
                            detail: {
                                bookingId,
                                vehicleId: (selectedBooking as { vehicle_id?: string }).vehicle_id,
                                date: selectedBooking.pickup_date ? new Date(selectedBooking.pickup_date) : selectedDate,
                            },
                        }))
                        setSelectedBooking(null)
                    }}
                />
            )}
        </div>
    )
}
