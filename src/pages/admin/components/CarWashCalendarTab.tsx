import { useState, useEffect, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../../../supabaseClient'
import { FinancialData } from '../../../components/FinancialData'
import { useAdminRole } from '../../../hooks/useAdminRole'
import { getHolidayForDate, isSunday } from '../../../data/italianHolidays'
import toast from 'react-hot-toast'
import { authFetch } from '../../../utils/authFetch'

// 2026-05-22: Premium telemetry restyle scoped to this page only.
// The theme tokens (theme-bg-primary, theme-text-primary, ecc.) resolve
// via CSS variables in tailwind.config.js. We override those variables
// on this component's root so the whole calendar adopts the dark
// cinematic look regardless of the user's global light/dark setting,
// without touching any business logic or shared styling.
const TELEMETRY_VARS: React.CSSProperties = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...({
    '--color-theme-bg-primary': '#0a0d14',
    '--color-theme-bg-secondary': '#10141e',
    '--color-theme-bg-tertiary': '#161b28',
    '--color-theme-border': '#1b2333',
    '--color-theme-border-light': '#243049',
    '--color-theme-text-primary': '#e2e8f0',
    '--color-theme-text-secondary': '#cbd5e1',
    '--color-theme-text-muted': '#64748b',
    '--color-theme-shadow': 'rgba(2,6,15,0.6)',
  } as any),
}

// --- Configuration ---
const CELL_WIDTH = 52 // Balanced width: fits full month on screen while maintaining readability
const CELL_HEIGHT = 10 // Height for each 5-minute time slot

interface CarWashBooking {
  id: string
  customer_name: string
  customer_email: string
  customer_phone: string
  service_name: string
  appointment_date: string
  appointment_time: string
  price_total: number
  status: string
  payment_status: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking_details: any
  created_at: string
  vehicle_name?: string
  vehicle_plate?: string
  payment_method?: string
}

// Service durations in minutes by vehicle category
const SERVICE_DURATIONS_URBAN: Record<string, number> = {
  interior: 40,
  exterior: 30,
  full_clean: 80,
  full_clean_n2: 80,
  top_shine: 120,
  vip: 140,
  luxury: 220,
}

const SERVICE_DURATIONS_MAXI: Record<string, number> = {
  interior: 45,
  exterior: 40,
  full_clean: 90,
  full_clean_n2: 90,
  top_shine: 130,
  vip: 150,
  luxury: 280,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getServiceDuration = (serviceName: string, vehicleCategory?: string, bookingDetails?: any): number => {
  // Prefer totalDuration saved at booking time (always in sync with catalog)
  if (bookingDetails?.totalDuration && bookingDetails.totalDuration > 0) {
    return bookingDetails.totalDuration
  }

  const name = serviceName.toLowerCase()
  const isMaxi = vehicleCategory?.toLowerCase() === 'maxi'
  const durations = isMaxi ? SERVICE_DURATIONS_MAXI : SERVICE_DURATIONS_URBAN

  // Scooter/Moto — fixed short duration
  if (name.includes('scooter')) return 15
  if (name.includes('moto')) return 20

  // Match service patterns (check more specific patterns first)
  if (name.includes('absolute')) return isMaxi ? 480 : 480
  if (name.includes('luxury') || name.includes('dr7')) return durations.luxury
  if (name.includes('vip')) return durations.vip
  if (name.includes('top')) return durations.top_shine
  if (name.includes('full clean n2') || name.includes('completo n2')) return durations.full_clean_n2
  if (name.includes('full clean') || name.includes('completo')) return durations.full_clean
  if (name.includes('interior') || name.includes('solo interno') || name.includes('interno')) return durations.interior
  if (name.includes('exterior') || name.includes('solo esterno') || name.includes('esterno')) return durations.exterior

  // Default to 60 minutes if no match
  return 60
}

const isRientroBooking = (booking: CarWashBooking): boolean => {
  return booking.customer_name === 'Lavaggio Rientro'
}

const isPaidBooking = (booking: CarWashBooking): boolean => {
  return booking.payment_status === 'paid' ||
    booking.payment_status === 'completed' ||
    booking.payment_status === 'succeeded' ||
    (booking.booking_details?.amountPaid && booking.booking_details.amountPaid >= booking.price_total)
}

const isPendingPaymentLink = (booking: CarWashBooking): boolean => {
  return booking.payment_method === 'Nexi Pay by Link' &&
    (booking.payment_status === 'unpaid' || booking.payment_status === 'pending') &&
    (booking.status === 'pending' || booking.status === 'pending_payment')
}

const hasNotes = (booking: CarWashBooking): boolean => {
  return !!(booking.booking_details?.notes && booking.booking_details.notes.trim())
}

/** Lavaggio shop open minutes per weekday — Mon-Sat 8h, Sun closed. */
const openMinutesForDate = (d: Date): number => (d.getDay() === 0 ? 0 : 480)

const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins} min`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}min`
}

interface CarWashCalendarTabProps {
  onNewBooking?: (date: string, time: string) => void
}

interface CarWashService {
  id: string; name: string; price: number; duration: string; category: string
  durationMinutes?: number; price_unit?: string
  price_options?: { label: string; price: number }[]
}

export default function CarWashCalendarTab({ onNewBooking }: CarWashCalendarTabProps) {
  const { canViewFinancials } = useAdminRole()
  const [hideFinancials, setHideFinancials] = useState(false)
  const [bookings, setBookings] = useState<CarWashBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBooking, setSelectedBooking] = useState<CarWashBooking | null>(null)
  const [editingBooking, setEditingBooking] = useState<CarWashBooking | null>(null)
  const saveEditLockRef = useRef(false)

  // Edit modal: services catalog + selections
  const [carWashServices, setCarWashServices] = useState<CarWashService[]>([])
  const [editService, setEditService] = useState<CarWashService | null>(null)
  const [editExtras, setEditExtras] = useState<CarWashService[]>([])
  const [editExtraPriceOptions, setEditExtraPriceOptions] = useState<Record<string, { label: string; price: number }>>({})
  const [editExtraQuantities, setEditExtraQuantities] = useState<Record<string, number>>({})
  // View mode: Mese (default = existing month grid), Settimana (7-day window),
  // Giorno (single-day chronological timeline). NO Operatori tab — left out
  // by explicit request.
  const [viewMode, setViewMode] = useState<'mese' | 'settimana' | 'giorno'>('mese')
  // For Giorno/Settimana, anchor date is `currentDate`. "Oggi" button below
  // resets `currentDate` to today.

  // Load car wash services catalog
  useEffect(() => {
    supabase.from('car_wash_services').select('*').eq('active', true).order('sort_order').then(({ data }) => {
      if (data) setCarWashServices(data)
    })
  }, [])

  // Populate edit selections when editingBooking changes
  useEffect(() => {
    if (editingBooking && carWashServices.length > 0) {
      const cartItems = editingBooking.booking_details?.cartItems || []
      if (cartItems.length > 0) {
        const mainItem = cartItems[0]
        setEditService(carWashServices.find(s => s.id === mainItem.serviceId) || null)
        const extras: CarWashService[] = []
        const epOptions: Record<string, { label: string; price: number }> = {}
        const eqMap: Record<string, number> = {}
        for (let i = 1; i < cartItems.length; i++) {
          const ci = cartItems[i]
          const found = carWashServices.find(s => s.id === ci.serviceId)
          if (found) {
            extras.push(found)
            if (ci.option) epOptions[found.id] = { label: ci.option, price: ci.price }
            if (ci.quantity > 1) eqMap[found.id] = ci.quantity
          }
        }
        setEditExtras(extras)
        setEditExtraPriceOptions(epOptions)
        setEditExtraQuantities(eqMap)
      } else {
        setEditService(null); setEditExtras([]); setEditExtraPriceOptions({}); setEditExtraQuantities({})
      }
    } else if (!editingBooking) {
      setEditService(null); setEditExtras([]); setEditExtraPriceOptions({}); setEditExtraQuantities({})
    }
  }, [editingBooking, carWashServices])

  // Edit computed values
  const getEditTotal = () => {
    let total = 0
    if (editService) total += editService.price
    for (const e of editExtras) {
      const ep = editExtraPriceOptions[e.id]
      const qty = editExtraQuantities[e.id] || 1
      total += (ep?.price ?? e.price) * qty
    }
    return total
  }

  const buildEditServiceNames = () => {
    const parts: string[] = []
    if (editService) parts.push(editService.name)
    for (const e of editExtras) {
      const ep = editExtraPriceOptions[e.id]
      const qty = editExtraQuantities[e.id] || 1
      let name = e.name
      if (ep) name += ` (${ep.label})`
      if (qty > 1) name += ` x${qty}`
      parts.push(name)
    }
    return parts.join(' + ')
  }

  useEffect(() => {
    loadData()

    // Realtime: bookings (creazione/modifica/cancellazione lavaggio) +
    // car_wash_services (toggle attivo/inattivo, modifica prezzo/durata)
    // + vehicles (cambio status / categoria del veicolo collegato al
    // booking). Qualunque modifica fatta altrove si riflette qui senza
    // refresh manuale.
    const subscription = supabase
      .channel('carwash-calendar-realtime')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        () => loadData()
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'car_wash_services' },
        () => loadData()
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'vehicles' },
        () => loadData()
      )
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate]) // Reload when month changes

  async function loadData() {
    setLoading(true)
    try {
      const year = currentDate.getFullYear()
      const month = currentDate.getMonth()
      const startDate = new Date(year, month, 1, 0, 0, 0)
      const endDate = new Date(year, month + 1, 0, 23, 59, 59)

      // Fetch ALL bookings via Netlify function (bypasses RLS)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let bookingsData: any[] | null = null
      try {
        const res = await authFetch('/.netlify/functions/list-bookings')
        const result = await res.json()
        if (res.ok && result.bookings) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          bookingsData = result.bookings.filter((b: any) =>
            b.service_type === 'car_wash' &&
            b.status !== 'cancelled' && b.status !== 'annullata' && b.status !== 'expired' &&
            b.customer_name !== 'Lavaggio Rientro'
          )
        }
      } catch {
        // Netlify function unavailable, fallback to direct query
      }

      if (!bookingsData) {
        const { data, error: bookingsError } = await supabase
          .from('bookings')
          .select('*')
          .eq('service_type', 'car_wash')
          .neq('status', 'cancelled')
          .neq('status', 'annullata')
          .neq('status', 'expired')
          .neq('customer_name', 'Lavaggio Rientro')
          .order('appointment_date', { ascending: true })
        if (bookingsError) throw bookingsError
        bookingsData = data
      }

      // Client-side filter: current month + hide expired Nexi Pay by Link
      const now = new Date()
      const filteredBookings = (bookingsData || []).filter(b => {
        const dateToCheck = b.appointment_date || b.pickup_date
        if (!dateToCheck) return false
        const bookingDate = new Date(dateToCheck)
        if (bookingDate < startDate || bookingDate > endDate) return false
        // Hide expired unpaid Nexi Pay by Link bookings
        if (b.payment_status === 'pending' && b.payment_method === 'Nexi Pay by Link') {
          const expiresAt = b.booking_details?.payment_link_expires_at || b.booking_details?.payment_link_created_at
          if (expiresAt && now > new Date(expiresAt)) return false
        }
        return true
      }).map(b => ({
        ...b,
        appointment_date: b.appointment_date || b.pickup_date,
        appointment_time: b.appointment_time || '09:00'
      }))

      setBookings(filteredBookings)
    } catch (error) {
      console.error('Failed to load car wash bookings:', error)
    } finally {
      setLoading(false)
    }
  }

  const currentRomeComponents = useMemo(() => {
    return {
      year: currentDate.getFullYear(),
      month: currentDate.getMonth() // 0-indexed
    }
  }, [currentDate])

  const daysInMonth = useMemo(() => {
    return new Date(currentRomeComponents.year, currentRomeComponents.month + 1, 0).getDate()
  }, [currentRomeComponents])

  // Generate days to render based on viewMode.
  //  - mese: every day of the current month (default)
  //  - settimana: Mon–Sun of the week containing currentDate (only days
  //    that fall inside the current month — cross-month weeks clip to
  //    the visible month to keep the grid in one calendar)
  //  - giorno: just the day pointed at by currentDate
  const daysArray = useMemo(() => {
    if (viewMode === 'giorno') {
      const d = currentDate.getDate()
      const inMonth = currentDate.getMonth() === currentRomeComponents.month
        && currentDate.getFullYear() === currentRomeComponents.year
      return inMonth ? [d] : []
    }
    if (viewMode === 'settimana') {
      const anchor = currentDate.getMonth() === currentRomeComponents.month
        && currentDate.getFullYear() === currentRomeComponents.year
        ? new Date(currentDate)
        : new Date(currentRomeComponents.year, currentRomeComponents.month, 1)
      const dow = (anchor.getDay() + 6) % 7 // Mon=0
      const start = new Date(anchor)
      start.setDate(anchor.getDate() - dow)
      const out: number[] = []
      for (let i = 0; i < 7; i++) {
        const cur = new Date(start)
        cur.setDate(start.getDate() + i)
        if (cur.getMonth() === currentRomeComponents.month && cur.getFullYear() === currentRomeComponents.year) {
          out.push(cur.getDate())
        }
      }
      return out
    }
    // mese — full month
    const days = []
    for (let i = 1; i <= daysInMonth; i++) days.push(i)
    return days
  }, [daysInMonth, viewMode, currentDate, currentRomeComponents])

  // Stretch day cells to fill the row when only a few days are visible
  // (Giorno = 1 column, Settimana = up to 7 columns). For Mese we keep the
  // fixed 52px width so all ~30 days fit without crushing the layout.
  const stretchCols = viewMode !== 'mese'
  const dayCellStyle: React.CSSProperties = stretchCols
    ? { flex: 1, height: CELL_HEIGHT }
    : { width: CELL_WIDTH, height: CELL_HEIGHT }
  const headerCellStyle: React.CSSProperties = stretchCols
    ? { flex: 1, height: 50 }
    : { width: CELL_WIDTH, height: 50 }

  const navigateMonth = (dir: 'prev' | 'next') => {
    // Step size depends on the active view: day in Giorno, 7 days in
    // Settimana, full month in Mese. Keeps the left/right arrows useful
    // regardless of which view is selected.
    setCurrentDate(p => {
      const n = new Date(p)
      const sign = dir === 'prev' ? -1 : 1
      if (viewMode === 'giorno') n.setDate(p.getDate() + sign)
      else if (viewMode === 'settimana') n.setDate(p.getDate() + 7 * sign)
      else n.setMonth(p.getMonth() + sign)
      return n
    })
  }

  // Process bookings into calendar events
  // Bookings are already filtered for current month in loadData()
  const calendarEvents = useMemo(() => {

    return bookings
      .map(booking => {
        // Extract day from appointment_date
        const appointmentDate = new Date(booking.appointment_date)
        const day = appointmentDate.getDate()

        // Parse time - handle both "HH:MM" and full datetime formats
        let hours = 9, minutes = 0
        if (booking.appointment_time) {
          const timeParts = booking.appointment_time.split(':').map(Number)
          hours = timeParts[0] || 9
          minutes = timeParts[1] || 0
        }

        // Rientro washes always occupy only 15 minutes (1 slot)
        const duration = isRientroBooking(booking) ? 15 : getServiceDuration(booking.service_name, booking.booking_details?.vehicleCategory, booking.booking_details)

        // Calculate position
        const dayIndex = day - 1
        const leftPx = dayIndex * CELL_WIDTH


        return {
          booking,
          day,
          leftPx,
          duration,
          hours,
          minutes
        }
      })
      .sort((a, b) => {
        // Sort by day, then by time
        if (a.day !== b.day) return a.day - b.day
        if (a.hours !== b.hours) return a.hours - b.hours
        return a.minutes - b.minutes
      })
  }, [bookings])

  // Filter by search query
  const filteredEvents = useMemo(() => {
    if (!searchQuery.trim()) return calendarEvents
    const q = searchQuery.toLowerCase()
    return calendarEvents.filter(evt => {
      const customerName = evt.booking.customer_name || evt.booking.booking_details?.customer?.fullName || ''
      return customerName.toLowerCase().includes(q) ||
        evt.booking.service_name.toLowerCase().includes(q)
    })
  }, [calendarEvents, searchQuery])

  // Group events by day for lane assignment
  const eventsByDay = useMemo(() => {
    const grouped = new Map<number, typeof filteredEvents>()
    filteredEvents.forEach(evt => {
      if (!grouped.has(evt.day)) {
        grouped.set(evt.day, [])
      }
      grouped.get(evt.day)!.push(evt)
    })
    return grouped
  }, [filteredEvents])

  // Assign lanes to prevent overlaps within each day
  const eventsWithLanes = useMemo(() => {
    return filteredEvents.map(evt => {
      const dayEvents = eventsByDay.get(evt.day) || []
      const evtIndex = dayEvents.indexOf(evt)
      return {
        ...evt,
        laneIndex: evtIndex
      }
    })
  }, [filteredEvents, eventsByDay])





  // Get today
  const today = new Date()
  const isCurrentMonth = today.getMonth() === currentDate.getMonth() &&
    today.getFullYear() === currentDate.getFullYear()
  const todayDay = isCurrentMonth ? today.getDate() : null

  // KPI strip metrics — today vs ieri. Pure aggregate on the existing
  // `bookings` array, no new queries, no operator data.
  const kpis = useMemo(() => {
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
    const todayDate = new Date()
    const yesterdayDate = new Date(todayDate.getTime() - 24 * 60 * 60 * 1000)
    const todayBookings = bookings.filter(b => !isRientroBooking(b) && sameDay(new Date(b.appointment_date), todayDate))
    const yesterdayBookings = bookings.filter(b => !isRientroBooking(b) && sameDay(new Date(b.appointment_date), yesterdayDate))
    const sumMin = (list: CarWashBooking[]) => list.reduce((s, b) => s + getServiceDuration(b.service_name || '', b.booking_details?.vehicle_category, b.booking_details), 0)
    const sumRev = (list: CarWashBooking[]) => list.reduce((s, b) => s + (b.price_total || 0), 0)
    const todayBooked = sumMin(todayBookings)
    const yBooked = sumMin(yesterdayBookings)
    const todayOpen = openMinutesForDate(todayDate)
    const yOpen = openMinutesForDate(yesterdayDate)
    const occ = todayOpen > 0 ? Math.round((todayBooked / todayOpen) * 100) : 0
    const yOcc = yOpen > 0 ? Math.round((yBooked / yOpen) * 100) : 0
    const freeSlots = Math.floor(Math.max(0, todayOpen - todayBooked) / 30)
    const todayRev = sumRev(todayBookings) / 100
    const yRev = sumRev(yesterdayBookings) / 100
    const avg = todayBookings.length > 0 ? Math.round(todayBooked / todayBookings.length) : 0
    const yAvg = yesterdayBookings.length > 0 ? Math.round(yBooked / yesterdayBookings.length) : 0
    const pct = (cur: number, prev: number) => {
      if (prev === 0) return cur > 0 ? '+∞%' : '—'
      const d = ((cur - prev) / prev) * 100
      return `${d >= 0 ? '+' : ''}${Math.round(d)}%`
    }
    return {
      lavaggi: todayBookings.length,
      lavaggiDelta: pct(todayBookings.length, yesterdayBookings.length),
      occ, occDelta: pct(occ, yOcc),
      freeSlots, freeMin: Math.max(0, todayOpen - todayBooked),
      openMin: todayOpen,
      bookedMin: todayBooked,
      rev: todayRev, revDelta: pct(todayRev, yRev),
      avg, avgDelta: pct(avg, yAvg),
    }
  }, [bookings])

  const deltaColor = (s: string) => s.startsWith('+') && s !== '+0%' ? 'text-emerald-400' : s.startsWith('-') ? 'text-red-400' : 'text-theme-text-muted'
  // Richer KPI card: colored icon square on the left + label / value / delta
  // stacked on the right. Matches the mockup style.
  const KpiCard = ({ label, value, delta, sub, icon, accent }: {
    label: string; value: string; delta?: string; sub?: string;
    icon: 'cars' | 'clock' | 'slot' | 'euro' | 'timer' | 'fire';
    accent: 'emerald' | 'blue' | 'cyan' | 'amber' | 'fuchsia' | 'rose';
  }) => {
    // Vibrant filled icon squares (mockup style) — stronger contrast than
    // the previous soft tints.
    const accentBg: Record<typeof accent, string> = {
      emerald: 'bg-emerald-500/25 text-emerald-300 ring-1 ring-inset ring-emerald-400/40',
      blue: 'bg-blue-500/25 text-blue-300 ring-1 ring-inset ring-blue-400/40',
      cyan: 'bg-cyan-500/25 text-cyan-300 ring-1 ring-inset ring-cyan-400/40',
      amber: 'bg-amber-500/25 text-amber-300 ring-1 ring-inset ring-amber-400/40',
      fuchsia: 'bg-fuchsia-500/25 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-400/40',
      rose: 'bg-rose-500/25 text-rose-300 ring-1 ring-inset ring-rose-400/40',
    }
    const iconPath: Record<typeof icon, string> = {
      cars: 'M3 13l2-7h14l2 7M5 17h14M7 17v3M17 17v3M5 13h14M7 10h10',
      clock: 'M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z',
      slot: 'M4 6h16M4 12h16M4 18h7',
      euro: 'M14 8a4 4 0 100 8M8 10h8M8 14h6',
      timer: 'M10 2h4M12 14l4-4M12 22a8 8 0 110-16 8 8 0 010 16z',
      fire: 'M12 2a7 7 0 015 12c1-3-1-6-3-8 0 4-4 5-4 9a4 4 0 008 0c0 5-5 7-7 7s-7-2-7-7c0-7 8-9 8-13z',
    }
    return (
      <motion.div
        whileHover={{ y: -2 }}
        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        className="group relative flex-1 min-w-[160px] flex items-center gap-3 rounded-xl p-3 overflow-hidden bg-[linear-gradient(135deg,rgba(20,28,45,0.85)_0%,rgba(10,15,25,0.85)_100%)] border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_24px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md hover:border-cyan-400/30 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_28px_-10px_rgba(34,211,238,0.25)] transition-all"
      >
        {/* sheen on hover */}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className={`relative w-10 h-10 rounded-lg flex items-center justify-center border ${accentBg[accent]} shrink-0`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d={iconPath[icon]} />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-theme-text-muted font-semibold">{label}</div>
          <div className="text-xl font-bold text-white tabular-nums leading-tight tracking-tight">{value}</div>
          <div className="flex items-center gap-2 text-[10px] mt-0.5 truncate">
            {delta && <span className={deltaColor(delta)}>{delta} vs ieri</span>}
            {sub && <span className="text-theme-text-muted truncate">{sub}</span>}
          </div>
        </div>
      </motion.div>
    )
  }

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-text-primary mx-auto mb-4"></div>
        <p className="text-theme-text-primary">Caricamento calendario lavaggi...</p>
      </div>
    )
  }

  return (
    <div
      style={TELEMETRY_VARS}
      className="relative flex flex-col h-[calc(100vh-240px)] sm:h-[calc(100vh-200px)] rounded-2xl border border-cyan-400/10 shadow-[0_0_60px_-10px_rgba(34,211,238,0.18)] overflow-hidden bg-[radial-gradient(ellipse_at_top,_rgba(34,211,238,0.07)_0%,_transparent_55%),linear-gradient(180deg,#0a0d14_0%,#070a10_100%)]"
    >
      {/* Ambient cyan glow — decorative, sits behind everything */}
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        <div className="absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full bg-cyan-500/[0.06] blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-[420px] h-[420px] rounded-full bg-blue-600/[0.05] blur-3xl" />
      </div>

      {/* 0. KPI Strip — telemetry widgets row */}
      <div className="relative z-10 flex flex-wrap gap-2 sm:gap-3 p-3 sm:p-4 border-b border-white/[0.06] bg-black/20 backdrop-blur-md">
        <KpiCard icon="cars" accent="emerald" label="Lavaggi Oggi" value={String(kpis.lavaggi)} delta={kpis.lavaggiDelta} />
        <KpiCard icon="clock" accent="blue" label="Slot Occupati" value={`${kpis.occ}%`} delta={kpis.occDelta} sub={`${formatDuration(kpis.bookedMin)} / ${formatDuration(kpis.openMin)}`} />
        <KpiCard icon="slot" accent="cyan" label="Slot Liberi" value={String(kpis.freeSlots)} sub={`${formatDuration(kpis.freeMin)} disp.`} />
        {canViewFinancials && !hideFinancials && <KpiCard icon="euro" accent="amber" label="Fatturato Oggi" value={`€${kpis.rev.toFixed(2).replace('.', ',')}`} delta={kpis.revDelta} />}
        <KpiCard icon="timer" accent="fuchsia" label="Tempo Medio" value={kpis.avg > 0 ? formatDuration(kpis.avg) : '—'} delta={kpis.avg > 0 ? kpis.avgDelta : undefined} />
        <KpiCard icon="fire" accent="rose" label="Saturazione" value={`${kpis.occ}%`} sub={kpis.occ >= 85 ? 'Alta' : kpis.occ >= 50 ? 'Media' : 'Bassa'} />
      </div>

      {/* View tabs + date display + Oggi button — dark pill row, cyan accent. */}
      <div className="relative z-10 flex flex-wrap items-center gap-3 px-3 sm:px-4 py-2.5 border-b border-white/[0.06] bg-black/20 backdrop-blur-md">
        <div className="flex items-center gap-2 bg-theme-bg-primary/30 rounded-full p-1 border border-theme-border/40">
          {(['giorno', 'settimana', 'mese'] as const).map(v => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold capitalize transition-all border ${
                viewMode === v
                  ? 'border-cyan-400 text-cyan-400 bg-transparent shadow-[0_0_0_1px_rgba(34,211,238,0.4)]'
                  : 'border-transparent text-theme-text-primary hover:text-theme-text-primary hover:bg-theme-text-primary/5'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex-1 text-center text-sm font-medium text-theme-text-primary capitalize">
          {viewMode === 'giorno' && currentDate.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          {viewMode === 'settimana' && (() => {
            const start = new Date(currentDate)
            const dow = (start.getDay() + 6) % 7
            start.setDate(start.getDate() - dow)
            const end = new Date(start)
            end.setDate(end.getDate() + 6)
            const f = (d: Date) => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
            return `Settimana del ${f(start)} – ${f(end)}`
          })()}
          {viewMode === 'mese' && currentDate.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentDate(new Date())}
            className="px-3 py-1.5 rounded-full text-xs font-semibold bg-theme-bg-primary/40 text-theme-text-primary border border-theme-border/50 hover:bg-theme-bg-primary/60 transition-colors"
          >
            Oggi
          </button>
          <button
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-theme-bg-primary/40 text-theme-text-primary border border-theme-border/50 hover:bg-theme-bg-primary/60 transition-colors"
            title="Filtri (in arrivo)"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M6 12h12M10 20h4" />
            </svg>
            Filtri
          </button>
          {onNewBooking && (
            <button
              onClick={() => {
                const today = new Date()
                const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
                onNewBooking(dateStr, '10:00')
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-cyan-500 text-white shadow-lg shadow-cyan-500/30 hover:bg-cyan-600 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Nuova Prenotazione
            </button>
          )}
        </div>
      </div>

      {/* 1. Control Bar */}
      <div className="relative z-10 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 p-3 sm:p-4 bg-black/25 backdrop-blur-md border-b border-white/[0.06] shadow-sm">
        <div className="flex items-center gap-3 sm:gap-4">
          <h2 className="text-base sm:text-xl font-light text-theme-text-primary capitalize w-32 sm:w-48">
            {currentDate.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}
          </h2>
          <div className="flex gap-1.5 sm:gap-2">
            <button onClick={() => navigateMonth('prev')} className="px-2 sm:px-3 py-2 bg-theme-text-primary/5 hover:bg-theme-text-primary/10 rounded border border-theme-border/50 text-xs sm:text-sm text-theme-text-primary/90 hover:text-theme-text-primary">◄</button>
            <button onClick={() => navigateMonth('next')} className="px-2 sm:px-3 py-2 bg-theme-text-primary/5 hover:bg-theme-text-primary/10 rounded border border-theme-border/50 text-xs sm:text-sm text-theme-text-primary/90 hover:text-theme-text-primary">►</button>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          {(() => {
            // Filter bookings to the active view's range so the count/total
            // shown next to the navigation arrows reflects what the grid
            // actually displays (mese / settimana / giorno).
            const inRange = (b: CarWashBooking): boolean => {
              const bd = new Date(b.appointment_date)
              if (viewMode === 'giorno') {
                return bd.getFullYear() === currentDate.getFullYear()
                  && bd.getMonth() === currentDate.getMonth()
                  && bd.getDate() === currentDate.getDate()
              }
              if (viewMode === 'settimana') {
                const dow = (currentDate.getDay() + 6) % 7
                const start = new Date(currentDate)
                start.setHours(0, 0, 0, 0)
                start.setDate(currentDate.getDate() - dow)
                const end = new Date(start)
                end.setDate(start.getDate() + 7)
                return bd >= start && bd < end
              }
              return bd.getMonth() === currentDate.getMonth()
                && bd.getFullYear() === currentDate.getFullYear()
            }
            const list = bookings.filter(inRange)
            const rangeLabel = viewMode === 'giorno' ? 'Giorno' : viewMode === 'settimana' ? 'Settimana' : 'Mese'
            const total = list.reduce((s, b) => s + (b.price_total || 0), 0)
            return (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-theme-text-muted">{rangeLabel}:</span>
                  <span className="text-cyan-300 font-bold text-xs sm:text-sm">
                    {list.length} lavaggi
                  </span>
                </div>
                {canViewFinancials && !hideFinancials && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-theme-text-muted">Fatturato:</span>
                    <span className="text-green-400 font-bold text-xs sm:text-sm">
                      <FinancialData type="total">
                        €{(total / 100).toFixed(2)}
                      </FinancialData>
                    </span>
                  </div>
                )}
              </>
            )
          })()}
          {canViewFinancials && (
            <button
              onClick={() => setHideFinancials(!hideFinancials)}
              className={`px-3 py-2 rounded text-xs font-semibold transition-colors ${hideFinancials
                ? 'bg-green-600 text-theme-text-primary hover:bg-green-700'
                : 'bg-cyan-500 text-white hover:bg-[#0A8FA3]'
                }`}
            >
              {hideFinancials ? 'MOSTRA' : 'NASCONDI'}
            </button>
          )}
          <input
            type="text"
            placeholder="Cerca..."
            className="bg-theme-bg-primary/20 border border-theme-border/50 rounded-full px-4 py-2 text-sm w-full sm:w-64 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-cyan-400/50"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Compact legend — same colour codes used by the booking cards in the
          grid below. Wraps on small screens, no fixed sidebar. */}
      <div className="relative z-10 hidden md:flex items-center gap-3 px-3 sm:px-4 py-2 bg-black/20 backdrop-blur-md border-b border-white/[0.06] text-[11px] flex-wrap">
        <span className="text-theme-text-muted uppercase tracking-wider font-semibold">Legenda</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /><span className="text-theme-text-primary">Pagato</span></span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /><span className="text-theme-text-primary">Link Nexi inviato</span></span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-700" /><span className="text-theme-text-primary">Da pagare</span></span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-700" /><span className="text-theme-text-primary">Rientro</span></span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm border-2 border-amber-300" /><span className="text-theme-text-primary">Con note</span></span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#22d3ee]" /><span className="text-theme-text-primary">Oggi</span></span>
      </div>

      {/* 2. Main area: calendar grid + (lg only) right sidebar */}
      <div className="flex-1 flex overflow-hidden">

      {/* 2A. Scrollable Calendar Area */}
      <div className="relative z-10 flex-1 overflow-auto flex flex-col w-full bg-[linear-gradient(180deg,#0a0d14_0%,#070a10_100%)]">

        {/* A. Sticky Header Row - Days */}
        <div className={`flex sticky top-0 z-[40] bg-theme-bg-primary shadow-lg border-b border-theme-border/50 ${stretchCols ? 'w-full' : 'min-w-max'}`}>
          {/* Header Spacer for Time Column */}
          <div className="sticky left-0 w-[70px] shrink-0 z-[41] bg-theme-bg-primary border-r border-theme-border/50 flex items-center justify-center font-bold text-xs text-theme-text-muted uppercase tracking-wider backdrop-blur-sm shadow-[4px_0_10px_-2px_var(--color-theme-shadow)]" style={{ height: '50px' }}>
            Orario
          </div>

          {/* Day Columns Header */}
          <div className={`flex ${stretchCols ? 'flex-1' : ''}`}>
            {daysArray.map((day) => {
              const d = new Date(currentRomeComponents.year, currentRomeComponents.month, day)
              const isHol = getHolidayForDate(d)
              const isSun = isSunday(d)
              const isToday = day === todayDay

              return (
                <div
                  key={day}
                  className={`
                    flex flex-col items-center justify-center border-r border-theme-border/30 relative transition-colors
                    ${(isHol || isSun) ? 'bg-red-950/20' : ''}
                    ${isToday ? 'bg-gradient-to-b from-[#22d3ee]/45 to-[#22d3ee]/15 border-l-2 border-r-2 border-[#22d3ee] shadow-[inset_0_-3px_0_0_#22d3ee]' : ''}
                  `}
                  style={headerCellStyle}
                >
                  {/* Red dot for Sundays and holidays */}
                  {(isHol || isSun) && (
                    <div
                      className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-red-500"
                      title={isHol ? isHol.name : 'Domenica'}
                    />
                  )}

                  <span
                    className={`text-sm font-bold ${isToday ? 'text-[#22d3ee]' : 'text-theme-text-primary/90'}`}
                  >
                    {day}
                  </span>
                  <span
                    className={`text-[9px] uppercase tracking-wide ${isToday ? 'text-[#22d3ee]/80' : 'text-theme-text-primary/50'}`}
                  >
                    {d.toLocaleDateString('it-IT', { weekday: 'short' })}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* B. Time Slots Grid */}
        <div className={`${stretchCols ? 'w-full' : 'min-w-max'} relative`}>
          {/* Generate time slots from 09:00 to 18:00 in 5-minute intervals (109 slots) */}
          {Array.from({ length: 109 }, (_, i) => {
            const totalMinutes = 9 * 60 + i * 5 // Start at 09:00
            const hours = Math.floor(totalMinutes / 60)
            const minutes = totalMinutes % 60
            const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
            const isFullHour = minutes === 0
            const is15Min = minutes % 15 === 0

            return (
              <div
                key={timeString}
                className={`flex ${isFullHour ? 'border-t-2 border-theme-border/70' : is15Min ? 'border-t border-theme-border/30' : ''}`}
                style={{ height: CELL_HEIGHT }}
              >
                {/* Time Label Column (Sticky Left) - only show label at 15-min intervals */}
                <div
                  className={`sticky left-0 w-[70px] z-[30] bg-theme-bg-primary/98 border-r border-theme-border/50 flex items-center justify-center backdrop-blur-sm shadow-[4px_0_6px_-2px_var(--color-theme-shadow)] ${isFullHour ? 'font-bold' : 'font-normal'}`}
                >
                  {is15Min ? (
                    <span className={`text-xs ${isFullHour ? 'text-theme-text-primary/95 text-sm' : 'text-theme-text-primary/60'}`}>
                      {timeString}
                    </span>
                  ) : null}
                </div>

                {/* Day Cells */}
                <div className="flex flex-1">
                  {daysArray.map((day) => {
                    const d = new Date(currentRomeComponents.year, currentRomeComponents.month, day)
                    const isRedDay = getHolidayForDate(d) || isSunday(d)
                    const isToday = day === todayDay

                    // Find ALL bookings occupying this slot
                    const slotBookings = eventsWithLanes.filter(evt => {
                      if (evt.day !== day) return false
                      const [bookingHours, bookingMinutes] = evt.booking.appointment_time.split(':').map(Number)
                      const bookingStartMinutes = bookingHours * 60 + bookingMinutes
                      const bookingEndMinutes = bookingStartMinutes + evt.duration
                      return totalMinutes >= bookingStartMinutes && totalMinutes < bookingEndMinutes
                    })

                    const slotBooking = slotBookings.length > 0 ? slotBookings[0] : null

                    // Find all bookings that START at this slot
                    const startingBookings = eventsWithLanes.filter(evt => {
                      if (evt.day !== day) return false
                      const [bookingHours, bookingMinutes] = evt.booking.appointment_time.split(':').map(Number)
                      const bookingStartMinutes = bookingHours * 60 + bookingMinutes
                      return totalMinutes === bookingStartMinutes
                    })

                    const isBookingStart = startingBookings.length > 0

                    return (
                      <div
                        key={`${day}-${timeString}`}
                        className={`
                          relative border-r border-theme-border/20 transition-all
                          ${isToday ? 'bg-[#22d3ee]/12 border-l border-r border-[#22d3ee]/40' : ''}
                          ${!isToday && !slotBooking && !isRedDay ? 'bg-green-600/15 hover:bg-green-600/25 cursor-pointer' : ''}
                          ${!isToday && !slotBooking && isRedDay ? 'bg-red-950/10 hover:bg-red-950/20' : ''}
                          ${slotBooking && !isBookingStart ? 'bg-transparent' : ''}
                        `}
                        style={dayCellStyle}
                        onClick={() => {
                          // Only allow booking on available slots (green cells)
                          if (!slotBooking && !isRedDay && onNewBooking) {
                            const dateStr = `${currentRomeComponents.year}-${String(currentRomeComponents.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                            onNewBooking(dateStr, timeString)
                          }
                        }}
                      >
                        {/* Render booking blocks for all bookings starting at this slot */}
                        {startingBookings.map(startEvt => {
                          const isRientro = isRientroBooking(startEvt.booking)
                          const isPaid = !isRientro && isPaidBooking(startEvt.booking)
                          const bookingHasNotes = !isRientro && hasNotes(startEvt.booking)
                          // If rientro overlaps with a client wash at same time, shift rientro up one slot
                          const hasClientOverlap = isRientro && startingBookings.some(b => !isRientroBooking(b.booking))
                          const topOffset = hasClientOverlap ? -(CELL_HEIGHT - 1) : 1

                          // Color logic: rientro=blue, paid=green, pending pay-by-link=orange, unpaid=red.
                          // Gradient + soft shadow + hover lift for a polished look (mockup style).
                          const isPendingLink = !isRientro && isPendingPaymentLink(startEvt.booking)
                          const bgColor = isRientro
                            ? 'bg-gradient-to-br from-blue-700 to-blue-900 border-blue-500/40 shadow-blue-900/30'
                            : isPaid
                              ? 'bg-gradient-to-br from-emerald-500 to-emerald-700 border-emerald-300/40 shadow-emerald-900/30'
                              : isPendingLink
                                ? 'bg-gradient-to-br from-amber-500 to-amber-700 border-amber-300/40 shadow-amber-900/30'
                                : 'bg-gradient-to-br from-red-700 to-red-900 border-red-500/40 shadow-red-900/30'

                          return (
                          <div
                            key={startEvt.booking.id}
                            className={`absolute inset-x-0 ${bgColor} border border-white/10 rounded-lg shadow-[0_4px_12px_-4px_rgba(0,0,0,0.5)] hover:shadow-[0_8px_24px_-6px_rgba(34,211,238,0.45)] hover:-translate-y-0.5 hover:brightness-110 transition-all duration-200 cursor-pointer ${hasClientOverlap ? 'z-[25]' : 'z-20'} overflow-hidden group/booking ring-0 hover:ring-1 hover:ring-cyan-300/40`}
                            style={{
                              height: `${(startEvt.duration / 5) * CELL_HEIGHT - 2}px`,
                              top: `${topOffset}px`,
                              ...(bookingHasNotes ? { boxShadow: 'inset 0 0 0 2.5px #FACC15', borderColor: '#FACC15' } : {})
                            }}
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedBooking(startEvt.booking)
                            }}
                          >
                            {/* Inner glow effect */}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />

                            {/* Content */}
                            <div className="relative px-2 py-1.5 flex flex-col justify-center h-full items-center gap-0.5 text-center">
                              <span className="font-bold text-[11px] leading-tight truncate max-w-full text-white drop-shadow-md">
                                {(() => {
                                  if (isRientro) {
                                    // Show vehicle plate or "Rientro" for compact display
                                    return startEvt.booking.vehicle_plate || 'Rientro'
                                  }
                                  const name = startEvt.booking.customer_name || 'Cliente'
                                  if (name.length > 10) {
                                    const parts = name.split(' ')
                                    if (parts.length > 1) {
                                      return parts[0].substring(0, 8) + '.'
                                    }
                                    return name.substring(0, 8) + '.'
                                  }
                                  return name
                                })()}
                              </span>
                              <span className="font-bold text-[12px] leading-tight text-white drop-shadow-md">
                                {startEvt.booking.appointment_time}
                              </span>
                              <span className="text-[9px] leading-tight text-white/90 drop-shadow-sm">
                                {(() => {
                                  if (isRientro) return 'Rientro'
                                  const svc = startEvt.booking.service_name.toLowerCase()
                                  if (svc.includes('scooter')) return 'Scooter'
                                  if (svc.includes('solo esterno') || svc.includes('exterior')) return 'Esterno'
                                  if (svc.includes('solo interno') || svc.includes('interior')) return 'Interno'
                                  if (svc.includes('completo')) return 'Completo'
                                  if (svc.includes('top')) return 'Top'
                                  if (svc.includes('vip')) return 'VIP'
                                  if (svc.includes('luxury') || svc.includes('dr7')) return 'Luxury'
                                  return 'Lavaggio'
                                })()}
                              </span>
                            </div>

                            {/* Left accent bar */}
                            <div className={`absolute left-0 top-0 bottom-0 w-1 ${isRientro ? 'bg-blue-400/60' : isPaid ? 'bg-emerald-300/60' : 'bg-white/40'}`} />
                            {/* Right accent bar */}
                            <div className={`absolute right-0 top-0 bottom-0 w-1 ${isRientro ? 'bg-blue-400/60' : isPaid ? 'bg-emerald-300/60' : 'bg-white/40'}`} />

                            {/* Tooltip on hover */}
                            <div className="hidden group-hover/booking:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-theme-bg-primary border border-theme-border text-theme-text-primary text-xs p-3 rounded-lg shadow-2xl w-max z-[100] pointer-events-none min-w-[220px]">
                              <div className="font-bold mb-1 text-base">{isRientro ? 'Lavaggio Rientro' : startEvt.booking.customer_name}</div>
                              <div className="text-theme-text-muted mb-2">{startEvt.booking.service_name}</div>

                              {/* Vehicle info */}
                              {(startEvt.booking.booking_details?.vehicleMakeModel || startEvt.booking.vehicle_plate || startEvt.booking.vehicle_name) && (
                                <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-theme-border/50">
                                  {startEvt.booking.vehicle_plate && (
                                    <span className="font-mono font-bold text-cyan-300 text-[11px]">{startEvt.booking.vehicle_plate}</span>
                                  )}
                                  {(startEvt.booking.booking_details?.vehicleMakeModel || startEvt.booking.vehicle_name) && (
                                    <span className="text-theme-text-primary text-[11px]">{startEvt.booking.booking_details?.vehicleMakeModel || startEvt.booking.vehicle_name}</span>
                                  )}
                                  {startEvt.booking.booking_details?.vehicleCategory && (
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                      startEvt.booking.booking_details.vehicleCategory === 'urban'
                                        ? 'bg-blue-600/30 text-blue-400'
                                        : 'bg-orange-600/30 text-orange-400'
                                    }`}>
                                      {startEvt.booking.booking_details.vehicleCategory === 'urban' ? 'URBAN' : 'MAXI'}
                                    </span>
                                  )}
                                </div>
                              )}

                              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                                <span className="text-theme-text-muted">Orario:</span>
                                <span className="font-mono">{startEvt.booking.appointment_time}</span>

                                <span className="text-theme-text-muted">Durata:</span>
                                <span className="font-mono">{formatDuration(startEvt.duration)}</span>

                                <span className="text-theme-text-muted">Prezzo:</span>
                                <span className="font-mono">€{(startEvt.booking.price_total / 100).toFixed(2)}</span>

                                <span className="text-theme-text-muted">Stato:</span>
                                <span className="uppercase font-bold tracking-wider text-[10px]">{startEvt.booking.status}</span>
                              </div>

                              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-theme-bg-primary rotate-45 border-r border-b border-theme-border" />
                            </div>
                          </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {eventsWithLanes.length === 0 && !loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-theme-text-muted bg-theme-bg-primary/40 backdrop-blur-sm px-8 py-6 rounded-lg border border-theme-border/50">
                <p className="text-lg">Nessun lavaggio prenotato questo mese.</p>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* 2B. Right sidebar — telemetry intelligence panel. */}
      <aside className="relative z-10 hidden lg:flex flex-col w-72 shrink-0 border-l border-white/[0.06] bg-black/30 backdrop-blur-md p-4 gap-4 overflow-auto">
        {/* Mini month calendar — click a day to jump to it */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-theme-text-primary capitalize">
              {currentDate.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}
            </h4>
            <div className="flex gap-1">
              <button onClick={() => navigateMonth('prev')} className="w-6 h-6 rounded text-xs text-theme-text-muted hover:bg-theme-text-primary/10 hover:text-theme-text-primary">◄</button>
              <button onClick={() => navigateMonth('next')} className="w-6 h-6 rounded text-xs text-theme-text-muted hover:bg-theme-text-primary/10 hover:text-theme-text-primary">►</button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-[10px] text-theme-text-muted mb-1 text-center">
            {['L','M','M','G','V','S','D'].map((d, i) => <div key={i} className="font-semibold">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {(() => {
              const firstDay = new Date(currentRomeComponents.year, currentRomeComponents.month, 1)
              const startOffset = (firstDay.getDay() + 6) % 7 // Mon=0
              const cells: React.ReactNode[] = []
              for (let i = 0; i < startOffset; i++) cells.push(<div key={`b${i}`} className="h-7" />)
              for (let d = 1; d <= daysInMonth; d++) {
                const date = new Date(currentRomeComponents.year, currentRomeComponents.month, d)
                const isTodayMini = d === todayDay
                const dayBookingsCount = bookings.filter(b => {
                  if (isRientroBooking(b)) return false
                  const bd = new Date(b.appointment_date)
                  return bd.getFullYear() === date.getFullYear() && bd.getMonth() === date.getMonth() && bd.getDate() === d
                }).length
                const hasBk = dayBookingsCount > 0
                cells.push(
                  <div key={d} className={`h-7 rounded flex flex-col items-center justify-center text-[11px] tabular-nums relative ${
                    isTodayMini ? 'bg-[#22d3ee] text-white font-bold' :
                    hasBk ? 'bg-emerald-500/15 text-theme-text-primary' :
                    'text-theme-text-muted'
                  }`}>
                    {d}
                    {hasBk && !isTodayMini && <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-emerald-400" />}
                  </div>
                )
              }
              return cells
            })()}
          </div>
        </div>

        {/* Vertical legend */}
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-2">Legenda</h4>
          <ul className="space-y-1.5 text-xs">
            <li className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-emerald-500" /><span className="text-theme-text-primary">Pagato</span></li>
            <li className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-amber-500" /><span className="text-theme-text-primary">Link Nexi inviato</span></li>
            <li className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-red-700" /><span className="text-theme-text-primary">Da pagare</span></li>
            <li className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-blue-700" /><span className="text-theme-text-primary">Rientro</span></li>
            <li className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm border-2 border-amber-300" /><span className="text-theme-text-primary">Con note</span></li>
            <li className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-[#22d3ee]" /><span className="text-theme-text-primary">Oggi</span></li>
          </ul>
        </div>

        {/* Smart suggestion — heuristic based on today's saturation */}
        <div className="mt-auto bg-cyan-500/5 border border-cyan-400/20 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-cyan-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-[11px] font-semibold text-cyan-300 uppercase tracking-wider">Suggerimenti Smart</span>
          </div>
          <p className="text-[11px] text-theme-text-secondary leading-relaxed">
            {kpis.occ < 50
              ? `Saturazione bassa oggi (${kpis.occ}%). Hai ${kpis.freeSlots} slot liberi — considera una promo last-minute.`
              : kpis.occ >= 85
                ? `Saturazione alta (${kpis.occ}%). Valuta di aprire slot extra o ridurre i tempi di servizio.`
                : `Carico bilanciato (${kpis.occ}%). Nessun intervento necessario.`}
          </p>
        </div>
      </aside>

      </div>

      {/* Booking Details Modal — Apple style */}
      {selectedBooking && (() => {
        const paid = isPaidBooking(selectedBooking)
        return (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-xl flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedBooking(null)}
        >
          <div
            className="bg-theme-bg-secondary rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-[0_25px_60px_-12px_rgba(0,0,0,0.5)] border border-theme-border/30"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="relative rounded-t-2xl px-6 pt-8 pb-6 bg-theme-bg-tertiary border-b border-theme-border/30">
              <button
                onClick={() => setSelectedBooking(null)}
                className="absolute top-4 right-4 w-8 h-8 rounded-full bg-theme-text-muted/10 hover:bg-theme-text-muted/20 flex items-center justify-center text-theme-text-muted hover:text-theme-text-primary transition-all text-lg"
              >
                ×
              </button>
              <div className="text-theme-text-muted text-xs font-medium uppercase tracking-widest mb-1">Prime Wash</div>
              <h3 className="text-2xl font-bold text-theme-text-primary tracking-tight">
                {selectedBooking.customer_name || selectedBooking.booking_details?.customer?.fullName || 'N/A'}
              </h3>
              <p className="text-theme-text-muted text-sm mt-1">
                {new Date(selectedBooking.appointment_date).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })} · {selectedBooking.appointment_time}
              </p>
              {/* Status pills */}
              <div className="flex items-center gap-2 mt-3">
                <span className={`px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide ${
                  paid
                    ? 'bg-emerald-500/15 text-emerald-500'
                    : selectedBooking.payment_status === 'pending'
                      ? 'bg-orange-500/15 text-orange-500'
                      : 'bg-red-500/15 text-red-500'
                }`}>
                  {paid
                    ? 'Pagato'
                    : selectedBooking.payment_status === 'pending'
                      ? 'In Attesa'
                      : 'Non Pagato'}
                </span>
                <span className="px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide bg-theme-text-muted/10 text-theme-text-muted uppercase">
                  {selectedBooking.status}
                </span>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">

              {/* Contact card */}
              <div className="rounded-xl bg-theme-bg-tertiary/60 overflow-hidden">
                <div className="px-4 py-3 flex items-center justify-between border-b border-theme-border/20">
                  <span className="text-theme-text-muted text-sm">Email</span>
                  <span className="text-theme-text-primary text-sm font-medium">{selectedBooking.customer_email || selectedBooking.booking_details?.customer?.email || '—'}</span>
                </div>
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="text-theme-text-muted text-sm">Telefono</span>
                  <span className="text-theme-text-primary text-sm font-medium">{selectedBooking.customer_phone || selectedBooking.booking_details?.customer?.phone || '—'}</span>
                </div>
              </div>

              {/* Vehicle card */}
              {(selectedBooking.booking_details?.vehicleMakeModel || selectedBooking.vehicle_plate) && (
                <div className="rounded-xl bg-theme-bg-tertiary/60 overflow-hidden">
                  {selectedBooking.vehicle_plate && (
                    <div className={`px-4 py-3 flex items-center justify-between ${selectedBooking.booking_details?.vehicleMakeModel ? 'border-b border-theme-border/20' : ''}`}>
                      <span className="text-theme-text-muted text-sm">Targa</span>
                      <span className="font-mono font-bold text-cyan-300 text-sm tracking-wider">{selectedBooking.vehicle_plate}</span>
                    </div>
                  )}
                  {selectedBooking.booking_details?.vehicleMakeModel && (
                    <div className={`px-4 py-3 flex items-center justify-between ${selectedBooking.booking_details?.vehicleCategory ? 'border-b border-theme-border/20' : ''}`}>
                      <span className="text-theme-text-muted text-sm">Veicolo</span>
                      <span className="text-theme-text-primary text-sm font-medium">{selectedBooking.booking_details.vehicleMakeModel}</span>
                    </div>
                  )}
                  {selectedBooking.booking_details?.vehicleCategory && (
                    <div className="px-4 py-3 flex items-center justify-between">
                      <span className="text-theme-text-muted text-sm">Categoria</span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                        selectedBooking.booking_details.vehicleCategory === 'urban'
                          ? 'bg-blue-500/15 text-blue-500'
                          : 'bg-orange-500/15 text-orange-500'
                      }`}>
                        {selectedBooking.booking_details.vehicleCategory === 'urban' ? 'URBAN' : 'MAXI'}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Service card */}
              <div className="rounded-xl bg-theme-bg-tertiary/60 overflow-hidden">
                <div className="px-4 py-3 flex items-center justify-between border-b border-theme-border/20">
                  <span className="text-theme-text-muted text-sm">Servizio</span>
                  <span className="text-theme-text-primary text-sm font-medium text-right max-w-[60%]">{selectedBooking.service_name}</span>
                </div>
                <div className={`px-4 py-3 flex items-center justify-between ${selectedBooking.booking_details?.additionalService ? 'border-b border-theme-border/20' : ''}`}>
                  <span className="text-theme-text-muted text-sm">Durata</span>
                  <span className="text-theme-text-primary text-sm font-medium">{formatDuration(getServiceDuration(selectedBooking.service_name, selectedBooking.booking_details?.vehicleCategory, selectedBooking.booking_details))}</span>
                </div>
                {selectedBooking.booking_details?.additionalService && (
                  <div className="px-4 py-3 flex items-center justify-between">
                    <span className="text-theme-text-muted text-sm">Extra</span>
                    <span className="text-theme-text-primary text-sm font-medium text-right max-w-[60%]">{selectedBooking.booking_details.additionalService}</span>
                  </div>
                )}
              </div>

              {/* Price card */}
              <div className="rounded-xl bg-theme-bg-tertiary/60 px-4 py-4 flex items-center justify-between">
                <span className="text-theme-text-primary text-base font-semibold">Totale</span>
                <span className="text-cyan-300 font-bold text-2xl tracking-tight">
                  €{(selectedBooking.price_total / 100).toFixed(2)}
                </span>
              </div>

              {/* Notes card */}
              {selectedBooking.booking_details?.notes && (
                <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/20 px-4 py-3">
                  <div className="text-yellow-500 text-xs font-semibold uppercase tracking-wider mb-1.5">Note</div>
                  <p className="text-theme-text-primary text-sm leading-relaxed">{selectedBooking.booking_details.notes}</p>
                </div>
              )}

              {/* Booking ID */}
              <div className="text-center text-xs text-theme-text-muted/50 font-mono pt-1">
                DR7-{selectedBooking.id.toUpperCase().slice(0, 8)}
              </div>

              {/* Action button */}
              <button
                onClick={() => {
                  setEditingBooking(selectedBooking)
                  setSelectedBooking(null)
                }}
                className="w-full py-3 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 font-semibold text-[15px] transition-all active:scale-[0.98]"
              >
                Modifica Prenotazione
              </button>
            </div>
          </div>
        </div>
        )
      })()}

      {/* Edit Booking Modal */}
      {editingBooking && (
        <div className="fixed inset-0 bg-theme-overlay backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-theme-bg-secondary rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-theme-border">
            <div className="p-6 border-b border-theme-border">
              <div className="flex justify-between items-start">
                <h3 className="text-2xl font-bold text-theme-text-primary">Modifica Prenotazione</h3>
                <button
                  onClick={() => setEditingBooking(null)}
                  className="text-theme-text-muted hover:text-theme-text-primary text-2xl"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Cliente</label>
                <input
                  type="text"
                  value={editingBooking.customer_name}
                  onChange={(e) => setEditingBooking({ ...editingBooking, customer_name: e.target.value })}
                  className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Email</label>
                  <input
                    type="email"
                    value={editingBooking.customer_email || ''}
                    onChange={(e) => setEditingBooking({ ...editingBooking, customer_email: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Telefono</label>
                  <input
                    type="tel"
                    value={editingBooking.customer_phone || ''}
                    onChange={(e) => setEditingBooking({ ...editingBooking, customer_phone: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                  />
                </div>
              </div>

              {/* Main Service Dropdown */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Servizio</label>
                <select
                  value={editService?.id || ''}
                  onChange={(e) => setEditService(carWashServices.find(s => s.id === e.target.value) || null)}
                  className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                >
                  <option value="">Seleziona servizio...</option>
                  {Object.entries(
                    carWashServices
                      .filter(s => s.category !== 'extra' && s.category !== 'experience')
                      .reduce<Record<string, CarWashService[]>>((acc, s) => { (acc[s.category] ||= []).push(s); return acc }, {})
                  ).map(([cat, services]) => (
                    <optgroup key={cat} label={cat.toUpperCase()}>
                      {services.map(s => <option key={s.id} value={s.id}>{s.name} - EUR {s.price.toFixed(2)}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Extras with price options & quantities */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Extra</label>
                <div className="flex flex-wrap gap-2">
                  {carWashServices
                    .filter(s => (s.category === 'extra' || s.category === 'experience') && s.id !== editService?.id)
                    .map(extra => {
                      const isSelected = editExtras.some(e => e.id === extra.id)
                      const hasPO = extra.price_options && extra.price_options.length > 0
                      const curOpt = editExtraPriceOptions[extra.id]
                      return (
                        <div key={extra.id} className="flex flex-col gap-1">
                          <button type="button" onClick={() => {
                            if (isSelected) {
                              setEditExtras(p => p.filter(e => e.id !== extra.id))
                              setEditExtraPriceOptions(p => { const n = { ...p }; delete n[extra.id]; return n })
                              setEditExtraQuantities(p => { const n = { ...p }; delete n[extra.id]; return n })
                            } else { setEditExtras(p => [...p, extra]) }
                          }} className={`px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5 ${isSelected ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300' : 'bg-theme-bg-tertiary border-theme-border text-theme-text-primary hover:border-cyan-400'}`}>
                            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[10px] ${isSelected ? 'bg-cyan-500 border-cyan-400 text-white' : 'border-theme-text-muted'}`}>{isSelected && '✓'}</span>
                            {extra.name} {!hasPO && <span className="opacity-70">EUR {extra.price.toFixed(2)}</span>}
                          </button>
                          {isSelected && hasPO && (
                            <div className="flex flex-wrap gap-1 ml-2">
                              {extra.price_options!.map((opt: { label: string; price: number }) => (
                                <button key={opt.label} type="button" onClick={() => setEditExtraPriceOptions(p => ({ ...p, [extra.id]: opt }))}
                                  className={`px-2 py-0.5 text-[10px] rounded-full border ${curOpt?.label === opt.label ? 'bg-cyan-500 text-white border-cyan-400 font-bold' : 'border-theme-border text-theme-text-secondary hover:border-cyan-400'}`}>
                                  {opt.label} EUR {opt.price}
                                </button>
                              ))}
                            </div>
                          )}
                          {isSelected && extra.price_unit && (
                            <div className="flex items-center gap-2 ml-2">
                              <span className="text-[10px] text-theme-text-muted">{extra.price_unit}:</span>
                              <button type="button" onClick={() => setEditExtraQuantities(p => ({ ...p, [extra.id]: Math.max(1, (p[extra.id] || 1) - 1) }))} className="w-6 h-6 rounded-full border border-theme-border text-theme-text-primary hover:border-cyan-400 flex items-center justify-center text-xs">-</button>
                              <span className="text-xs font-bold w-5 text-center">{editExtraQuantities[extra.id] || 1}</span>
                              <button type="button" onClick={() => setEditExtraQuantities(p => ({ ...p, [extra.id]: Math.min(10, (p[extra.id] || 1) + 1) }))} className="w-6 h-6 rounded-full border border-theme-border text-theme-text-primary hover:border-cyan-400 flex items-center justify-center text-xs">+</button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
              </div>

              {/* Totale calcolato + override manuale */}
              <div className="p-3 bg-theme-bg-tertiary/50 rounded-lg flex justify-between items-center">
                <span className="text-sm text-theme-text-muted">Totale servizi</span>
                <span className="text-lg font-bold text-cyan-300">EUR {getEditTotal().toFixed(2)}</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Data</label>
                  <input type="date" value={editingBooking.appointment_date}
                    onChange={(e) => setEditingBooking({ ...editingBooking, appointment_date: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Ora</label>
                  <input type="time" lang="it-IT" value={editingBooking.appointment_time}
                    onChange={(e) => setEditingBooking({ ...editingBooking, appointment_time: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Prezzo manuale (€) — lascia vuoto per usare il totale calcolato</label>
                <input type="number" step="0.01" placeholder={getEditTotal().toFixed(2)}
                  value={editingBooking.price_total !== Math.round(getEditTotal() * 100) ? (editingBooking.price_total / 100).toFixed(2) : ''}
                  onChange={(e) => setEditingBooking({ ...editingBooking, price_total: e.target.value ? parseFloat(e.target.value) * 100 : Math.round(getEditTotal() * 100) })}
                  className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Stato</label>
                  <select
                    value={editingBooking.status}
                    onChange={(e) => setEditingBooking({ ...editingBooking, status: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                  >
                    <option value="pending">In Attesa</option>
                    <option value="confirmed">Confermata</option>
                    <option value="cancelled">Annullata</option>
                    <option value="completed">Completata</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Pagamento</label>
                  <select
                    value={editingBooking.payment_status}
                    onChange={(e) => setEditingBooking({ ...editingBooking, payment_status: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                  >
                    <option value="pending">Da Saldare</option>
                    <option value="partial">Parziale (Da Saldare Resto)</option>
                    <option value="paid">Pagato</option>
                    <option value="completed">Completato</option>
                  </select>
                  {/* Partial payment: amount already paid */}
                  {editingBooking.payment_status === 'partial' && (
                    <div className="mt-2">
                      <label className="block text-xs font-medium text-theme-text-secondary mb-1">Importo già pagato (€)</label>
                      <input type="number" step="0.01" min="0"
                        value={(editingBooking.booking_details?.amountPaid || 0) / 100}
                        onChange={(e) => setEditingBooking({ ...editingBooking, booking_details: { ...(editingBooking.booking_details || {}), amountPaid: Math.round(parseFloat(e.target.value || '0') * 100) } })}
                        placeholder="0.00"
                        className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm" />
                      <p className="text-xs text-cyan-300 mt-1">
                        Rimanente: EUR {(((editingBooking.price_total || 0) - (editingBooking.booking_details?.amountPaid || 0)) / 100).toFixed(2)}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Payment method — always visible */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Metodo di pagamento</label>
                <select
                  value={editingBooking.booking_details?.paymentMethod || editingBooking.payment_method || ''}
                  onChange={(e) => setEditingBooking({ ...editingBooking, payment_method: e.target.value, booking_details: { ...(editingBooking.booking_details || {}), paymentMethod: e.target.value } })}
                  className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                >
                  <option value="">-- Seleziona metodo --</option>
                  <option value="Contanti">Contanti</option>
                  <option value="POS">POS</option>
                  <option value="Carta di credito">Carta di credito</option>
                  <option value="Carta di debito">Carta di debito</option>
                  <option value="Bonifico">Bonifico</option>
                  <option value="Nexi Pay by Link">Nexi Pay by Link</option>
                  <option value="Wallet">Wallet</option>
                  <option value="Gift Card">Gift Card</option>
                </select>
              </div>
            </div>

            <div className="p-6 border-t border-theme-border flex gap-3">
              <button
                onClick={async () => {
                  if (saveEditLockRef.current) return
                  saveEditLockRef.current = true
                  try {
                    // Rebuild cart items from edit selections
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const editCartItems: any[] = []
                    if (editService) {
                      editCartItems.push({ serviceId: editService.id, serviceName: editService.name, quantity: 1, price: editService.price, option: null, subtotal: editService.price })
                    }
                    for (const extra of editExtras) {
                      const ep = editExtraPriceOptions[extra.id]
                      const qty = editExtraQuantities[extra.id] || 1
                      const unitPrice = ep?.price ?? extra.price
                      editCartItems.push({ serviceId: extra.id, serviceName: extra.name, quantity: qty, price: unitPrice, option: ep?.label || null, subtotal: unitPrice * qty })
                    }

                    const updatedServiceName = editService ? buildEditServiceNames() : editingBooking.service_name
                    const updatedPrice = editingBooking.price_total || Math.round(getEditTotal() * 100)

                    const { error } = await supabase
                      .from('bookings')
                      .update({
                        customer_name: editingBooking.customer_name,
                        customer_email: editingBooking.customer_email,
                        customer_phone: editingBooking.customer_phone,
                        service_name: updatedServiceName,
                        appointment_date: editingBooking.appointment_date,
                        appointment_time: editingBooking.appointment_time,
                        price_total: updatedPrice,
                        status: editingBooking.status,
                        payment_status: editingBooking.payment_status,
                        booking_details: {
                          ...(editingBooking.booking_details || {}),
                          cartItems: editService ? editCartItems : (editingBooking.booking_details?.cartItems || []),
                        },
                      })
                      .eq('id', editingBooking.id)

                    if (error) throw error

                    toast.success('Prenotazione aggiornata!')
                    setEditingBooking(null)
                    loadData()
                  } catch (error) {
                    console.error('Failed to update booking:', error)
                    toast.error('Errore durante l\'aggiornamento')
                  } finally {
                    saveEditLockRef.current = false
                  }
                }}
                className="flex-1 bg-cyan-500 hover:bg-cyan-500/90 text-white px-6 py-3 rounded-full font-medium transition-colors"
              >
                Salva Modifiche
              </button>
              <button
                onClick={() => setEditingBooking(null)}
                className="px-6 py-3 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded font-medium transition-colors"
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
