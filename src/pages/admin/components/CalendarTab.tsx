import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import { getHolidayForDate, isSunday } from '../../../data/italianHolidays'
import { formatRomeDate } from '../../../utils/timezoneUtils'
import { normalizeBooking, computeLanes, type CalendarEvent } from '../../../utils/calendarLogic'
import { TEST_PLATE_FILTER } from '../../../utils/testPlates'
import { isReportableRentalBooking, prorateRevenueForMonth, getOccupiedDaysInMonth } from '../../../utils/monthlyBookingMath'
import BookingDetailsPanel from './BookingDetailsPanel'
import { FinancialData } from '../../../components/FinancialData'
import DateRangeFilter from '../../../components/DateRangeFilter'
import { useAdminRole } from '../../../hooks/useAdminRole'
import { authFetch } from '../../../utils/authFetch'
import { getPaletteForCategory } from '../../../utils/categoryPalettes'

// --- Configuration ---
const CELL_WIDTH = 45 // Fixed width for day cells
const MIN_ROW_HEIGHT = 60
const BAR_HEIGHT = 30

interface ProCategory { id: string; label: string }

interface Vehicle {
  id: string
  display_name: string
  plate?: string | null
  status: string
  // Whatever the operator typed in Centralina Pro > Categorie & Fascia
  // (legacy seeds 'exotic'/'urban'/'aziendali' still appear in DB rows
  // that haven't been re-saved since the rename to 'supercars').
  category: string | null
  metadata?: {
    unavailable_from?: string
    unavailable_until?: string
    display_group?: string
    image?: string | null
  }
}

interface Booking {
  id: string
  vehicle_id?: string
  vehicle_name: string
  vehicle_plate?: string
  pickup_date: string
  dropoff_date: string
  status: string
  customer_name: string
  customer_email: string
  price_total: number
  service_type?: string
  payment_method?: string | null
  payment_status?: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking_details?: any
  type?: 'check-in' | 'check-out' | 'lavaggio' | 'meccanica' | 'varie'
}

// Importato in linea: evita di toccare la firma del file per allinearsi
// al pattern delle altre tab. useAdminRole / hasPermission usate per
// detect collaboratori (nessun accesso a `reservations`).
import { useAdminRole as useAdminRoleInternal } from '../../../hooks/useAdminRole'

export default function CalendarTab({ onNewBooking }: { onNewBooking?: (vehicleId: string, date: Date) => void }) {
  const { hasPermission: _calHasPerm, permissions: _calPerms } = useAdminRoleInternal()
  // Collaboratore = vede solo "Riservato" sulle barre, niente click per
  // aprire i dettagli, niente tooltip con nome/dettagli cliente.
  const isCollaboratoreCal = _calHasPerm('reservations-preventivi') && !_calHasPerm('reservations')
  const { canViewFinancials } = useAdminRole()
  const [hideFinancials, setHideFinancials] = useState(false)

  // 2026-05-20: per-operator vehicle hiding. Nasconde righe veicoli dal
  // calendario quando l'admin assegna `hide:vehicle-plate:XXX` nelle
  // permissions dell'operatore. Es. Nicola Frongia non vede TEST000/TEST002.
  const hiddenPlates = useMemo(() => {
    const set = new Set<string>()
    if (Array.isArray(_calPerms)) {
      for (const p of _calPerms) {
        if (typeof p === 'string' && p.startsWith('hide:vehicle-plate:')) {
          set.add(p.slice('hide:vehicle-plate:'.length).toUpperCase().replace(/\s+/g, ''))
        }
      }
    }
    return set
  }, [_calPerms])

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [searchQuery, setSearchQuery] = useState('')
  // 2026-06-01: filtro periodo Da/A — nasconde i veicoli che non hanno
  // alcun booking che si sovrappone alla finestra selezionata.
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: '', to: '' })
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  // Canonical monthly fatturato + bookings count — same numbers Report Noleggio
  // + Dashboard show (source: /.netlify/functions/monthly-report). Client-side
  // counting from the loaded bookings list can miss rows when the list is
  // paginated / partially loaded, so we prefer the server-side count.
  const [canonicalFatturato, setCanonicalFatturato] = useState<number | null>(null)
  const [canonicalBookings, setCanonicalBookings] = useState<number | null>(null)
  // Centralina Pro categories — used to colour the small "AZIENDALE / SUPERCARS"
  // pill next to each row's vehicle name. Same source the Veicoli tab uses, so
  // the palette stays in sync between the two screens.
  const [proCategories, setProCategories] = useState<ProCategory[]>([])

  // Scroll Sync Refs
  const gridRef = useRef<HTMLDivElement>(null)

  // --- Data Loading ---
  useEffect(() => {
    loadData()
    // Realtime: ascolta sia bookings (creazioni/modifiche/cancellazioni)
    // sia vehicles (cambi status, categoria, foto, prezzo). Cosi' qualunque
    // azione fatta in admin da un altro operatore — o sul sito da un cliente
    // — si riflette nel calendario senza bisogno di ricaricare la pagina.
    const subscription = supabase
      .channel('calendar-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => loadData())
      .subscribe()
    return () => { subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadProCategories() {
      const { data } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      if (cancelled) return
      const cfg = (data?.config as { categories?: ProCategory[] } | null) || null
      const list = Array.isArray(cfg?.categories) ? cfg.categories : []
      setProCategories(list)
    }
    loadProCategories()
    const sub = supabase
      .channel('calendar-categories-sync')
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'centralina_pro_config', filter: 'id=eq.main' },
        (payload) => {
          const cfg = (payload.new as { config?: { categories?: ProCategory[] } } | undefined)?.config
          const list = Array.isArray(cfg?.categories) ? cfg.categories : []
          setProCategories(list)
        })
      .subscribe()
    return () => { cancelled = true; sub.unsubscribe() }
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const { data: vehiclesData } = await supabase
        .from('vehicles')
        .select('id, display_name, plate, status, category, metadata')
        .or('status.neq.retired,display_name.eq.Test')

      // Fetch ALL bookings via Netlify function (bypasses RLS)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let allBookings: any[] | null = null
      try {
        const bookingsResponse = await authFetch('/.netlify/functions/list-bookings')
        const bookingsResult = await bookingsResponse.json()
        if (bookingsResponse.ok && bookingsResult.bookings) {
          allBookings = bookingsResult.bookings
        }
      } catch {
        // Netlify function unavailable
      }

      // Fallback: direct Supabase query
      if (!allBookings) {
        const { data } = await supabase
          .from('bookings')
          .select('*')
          .neq('status', 'cancelled')
          .neq('status', 'annullata')
          .not('vehicle_plate', 'in', TEST_PLATE_FILTER)
          .order('pickup_date', { ascending: true })
        allBookings = data
      }

      if (vehiclesData) {
        // Store as-is — final ordering is computed in a useMemo against
        // proCategories so the calendar follows whatever order the admin
        // sets in Centralina Pro > Categorie & Fascia (first category =
        // top of the calendar).
        setVehicles(vehiclesData)
      }

      if (allBookings) {
        // Filter out irrelevant service types
        const validBookings = allBookings.filter(b =>
          !['car_wash', 'mechanical_service', 'mechanical'].includes(b.service_type || '')
        )

        // Enrich bookings missing customer_name from customers_extended
        const needsEnrichment = validBookings.filter(b =>
          !b.customer_name || b.customer_name === 'Cliente Sconosciuto'
        )
        if (needsEnrichment.length > 0) {
          const emails = needsEnrichment
            .map(b => b.customer_email || b.booking_details?.customer?.email)
            .filter((e): e is string => !!e)
          const userIds = needsEnrichment
            .map(b => b.user_id)
            .filter((id): id is string => !!id)

          // Lookup by email and id separately
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const customersByEmail = new Map<string, any>()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const customersById = new Map<string, any>()

          if (emails.length > 0) {
            const { data } = await supabase.from('customers_extended')
              .select('id, nome, cognome, telefono, email, denominazione, ragione_sociale, tipo_cliente')
              .in('email', emails)
            if (data) for (const c of data) { if (c.email) customersByEmail.set(c.email, c) }
          }
          if (userIds.length > 0) {
            const { data } = await supabase.from('customers_extended')
              .select('id, nome, cognome, telefono, email, denominazione, ragione_sociale, tipo_cliente')
              .in('id', userIds)
            if (data) for (const c of data) { customersById.set(c.id, c) }
          }

          for (const b of needsEnrichment) {
            const email = b.customer_email || b.booking_details?.customer?.email
            const cust = (email && customersByEmail.get(email)) || (b.user_id && customersById.get(b.user_id))
            if (cust) {
              const fullName = cust.tipo_cliente === 'azienda'
                ? (cust.ragione_sociale || cust.denominazione)
                : `${cust.nome || ''} ${cust.cognome || ''}`.trim()
              if (fullName) b.customer_name = fullName
              if (!b.customer_phone && cust.telefono) b.customer_phone = cust.telefono
              if (!b.customer_email && cust.email) b.customer_email = cust.email
            }
          }
        }

        setBookings(validBookings)
      }
    } catch (e) {
      console.error("Data load failed", e)
    } finally {
      setLoading(false)
    }
  }

  // --- Date Logic ---
  const currentRomeComponents = useMemo(() => {
    // Current view context (Rome Time)
    // We treat 'currentDate' as the state container.
    // To match the utils logic, we extract the year/month we want to display.
    // If currentDate is local browser time, we just take getFullYear/getMonth.
    return {
      year: currentDate.getFullYear(),
      month: currentDate.getMonth() // 0-indexed
    }
  }, [currentDate])

  // Fetch canonical Fatturato from monthly-report endpoint so Calendar shows
  // the SAME number as Report Noleggio and Dashboard (rental + penali + danni).
  // Re-fetched whenever the month changes.
  useEffect(() => {
    let cancelled = false
    async function loadCanonical() {
      try {
        const yyyymm = `${currentRomeComponents.year}-${String(currentRomeComponents.month + 1).padStart(2, '0')}`
        const res = await authFetch(`/.netlify/functions/monthly-report?type=vehicles&month=${yyyymm}`)
        if (!res.ok) {
          if (!cancelled) { setCanonicalFatturato(null); setCanonicalBookings(null) }
          return
        }
        const json = await res.json()
        if (!cancelled) {
          setCanonicalFatturato(typeof json.totalRevenue === 'number' ? json.totalRevenue : null)
          setCanonicalBookings(typeof json.totalBookingsFound === 'number' ? json.totalBookingsFound : null)
        }
      } catch {
        if (!cancelled) { setCanonicalFatturato(null); setCanonicalBookings(null) }
      }
    }
    loadCanonical()
    return () => { cancelled = true }
  }, [currentRomeComponents.year, currentRomeComponents.month])

  const daysInMonth = useMemo(() => {
    // 0-indexed month for Date constructor is correct
    return new Date(currentRomeComponents.year, currentRomeComponents.month + 1, 0).getDate()
  }, [currentRomeComponents])

  const daysArray = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth])

  const navigateMonth = (dir: 'prev' | 'next') => {
    setCurrentDate(p => {
      const n = new Date(p)
      n.setMonth(p.getMonth() + (dir === 'prev' ? -1 : 1))
      return n
    })
  }

  // --- Processing ---

  // 1. Group Bookings by Vehicle
  // 2. Normalize to CalendarEvents
  // 3. Compute Lanes
  const processedRows = useMemo(() => {
    const rows: { vehicle: Vehicle, events: CalendarEvent[], laneCount: number }[] = []

    // PRE-ASSIGN: Each booking belongs to exactly ONE vehicle (no duplicates)
    // Priority: 1) plate match (targa), 2) vehicle_id match (fallback)
    const bookingToVehicleId = new Map<string, string>()
    bookings.forEach(b => {
      // Hide cancelled, expired, and annullata bookings
      if (b.status === 'cancelled' || b.status === 'annullata' || b.status === 'expired') return
      if (b.status === 'pending_payment' && b.payment_status === 'expired') return
      // Hide unpaid Nexi Pay by Link bookings older than 1 hour (link expired, cron will cancel)
      if (b.payment_status === 'pending' && b.payment_method === 'Nexi Pay by Link') {
        const expiresAt = b.booking_details?.payment_link_expires_at || b.booking_details?.payment_link_created_at
        if (expiresAt && new Date() > new Date(expiresAt)) return
      }
      const bPlate = (b.vehicle_plate || b.booking_details?.vehicle?.plate)?.replace(/\s/g, '').toUpperCase()
      const bVehicleId = b.vehicle_id || b.booking_details?.vehicle_id

      // BUG FIX 2026-05-16: vehicle_id PRIMA del plate. UUID e' unico,
      // plate puo' essere condivisa tra piu' veicoli (es. flotta con
      // targa "000000" placeholder per veicoli non ancora immatricolati).
      // Prima il plate match metteva la prenotazione sul PRIMO veicolo
      // trovato con quella targa, anche se la prenotazione era per un
      // altro veicolo con stessa targa (es. booking Cayenne finiva su
      // BMW M8 perche' entrambi avevano "000000").
      if (bVehicleId) {
        const idMatch = vehicles.find(v => v.id === bVehicleId)
        if (idMatch) {
          bookingToVehicleId.set(b.id, idMatch.id)
          return
        }
      }
      // Fallback: plate match (per booking legacy senza vehicle_id)
      if (bPlate) {
        const plateMatch = vehicles.find(v => v.plate?.replace(/\s/g, '').toUpperCase() === bPlate)
        if (plateMatch) {
          bookingToVehicleId.set(b.id, plateMatch.id)
          return
        }
      }
    })

    // Order rows by Centralina Pro category position (first = top of
    // calendar). Vehicles whose category isn't in the Pro list fall to
    // the bottom; ties broken alphabetically.
    // 2026-05-20: filtra anche per `hide:vehicle-plate:XXX` nei
    // permessi dell'operatore corrente. Es. Nicola Frongia con
    // hide:vehicle-plate:TEST000 + hide:vehicle-plate:TEST002 non vede
    // quelle due righe nel calendario.
    const orderedVehicles = [...vehicles]
      .filter(v => {
        if (hiddenPlates.size === 0) return true
        const plate = String(v.plate || '').toUpperCase().replace(/\s+/g, '')
        return !hiddenPlates.has(plate)
      })
      .sort((a, b) => {
        const ia = proCategories.findIndex(c => c.id === a.category)
        const ib = proCategories.findIndex(c => c.id === b.category)
        const ja = ia < 0 ? Number.POSITIVE_INFINITY : ia
        const jb = ib < 0 ? Number.POSITIVE_INFINITY : ib
        return ja - jb || a.display_name.localeCompare(b.display_name)
      })

    orderedVehicles.forEach(vehicle => {
      const vehicleBookings = bookings.filter(b => bookingToVehicleId.get(b.id) === vehicle.id)

      // Normalize
      const events: CalendarEvent[] = []
      vehicleBookings.forEach(b => {
        const evt = normalizeBooking(b, currentRomeComponents.year, currentRomeComponents.month, {
          cellWidth: CELL_WIDTH,
          daysInMonth
        })
        if (evt) events.push(evt)
      })

      // Compute Lanes
      const laningResults = computeLanes(events)
      const maxLane = laningResults.reduce((max, e) => Math.max(max, e.laneIndex), -1)

      // Filter by search query if needed
      const displayEvents = laningResults
      if (searchQuery) {
        // If filtering, we still might want to show the row,
        // but maybe dim non-matching? Or just filter the VEHICLES list?
        // Let's rely on the vehicle filter below ideally, but here we process all.
      }

      rows.push({
        vehicle,
        events: displayEvents,
        laneCount: Math.max(1, maxLane + 1) // At least 1 lane height
      })
    })

    // CRITICAL: Duplicate booking detection (always enabled)
    // Ensure no booking appears on multiple vehicle rows
    {
      const bookingToVehicles = new Map<string, string[]>()
      rows.forEach(row => {
        row.events.forEach(evt => {
          const bookingId = evt.booking.id
          if (!bookingToVehicles.has(bookingId)) {
            bookingToVehicles.set(bookingId, [])
          }
          bookingToVehicles.get(bookingId)!.push(row.vehicle.display_name)
        })
      })

      // Check for duplicates
      bookingToVehicles.forEach((vehicleNames, bookingId) => {
        if (vehicleNames.length > 1) {
          console.error(`🚨 CRITICAL: Booking ${bookingId} appears on ${vehicleNames.length} vehicles: ${vehicleNames.join(', ')}`)
        }
      })
    }

    return rows
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles, bookings, currentRomeComponents, daysInMonth, proCategories])

  // Filter Rows for Display
  const visibleRows = useMemo(() => {
    let rows = processedRows
    // 2026-06-01: filtro periodo Da/A — mostra solo veicoli con almeno
    // un booking che si sovrappone alla finestra (pickup<=to AND dropoff>=from).
    if (dateRange.from || dateRange.to) {
      rows = rows.filter(row => {
        return row.events.some(e => {
          const pk = String(e.booking.pickup_date || '').slice(0, 10)
          const dr = String(e.booking.dropoff_date || '').slice(0, 10)
          if (!pk && !dr) return false
          // Overlap test: booking [pk, dr] vs range [from, to].
          if (dateRange.from && dr && dr < dateRange.from) return false
          if (dateRange.to && pk && pk > dateRange.to) return false
          return true
        })
      })
    }
    if (!searchQuery) return rows
    const q = searchQuery.toLowerCase()
    return rows.filter(row => {
      const vehicleMatch = row.vehicle.display_name.toLowerCase().includes(q) ||
        (row.vehicle.plate || '').toLowerCase().includes(q)
      const bookingMatch = row.events.some(e =>
        e.booking.customer_name.toLowerCase().includes(q)
      )
      return vehicleMatch || bookingMatch
    })
  }, [processedRows, searchQuery, dateRange])

  // 2026-06-03: il filtro "Da/A" prima filtrava solo le RIGHE (veicoli senza
  // booking nel periodo) ma NON spostava la timeline, che restava sul mese
  // corrente → cambiando le date "non succedeva niente" a schermo. Ora, quando
  // si imposta una data "Da", il calendario NAVIGA al mese di quella data, così
  // la ricerca per date muove davvero la vista (oltre a filtrare i veicoli).
  useEffect(() => {
    if (!dateRange.from) return
    const [y, m, d] = dateRange.from.split('-').map(Number)
    if (!y || !m) return
    setCurrentDate(prev => {
      // Evita loop / reset inutili: cambia solo se mese o anno differiscono.
      if (prev.getFullYear() === y && prev.getMonth() === m - 1) return prev
      return new Date(y, m - 1, d || 1)
    })
  }, [dateRange.from])


  // --- Render Helpers ---


  if (loading) return <div className="p-8 text-center animate-pulse">Caricamento Calendario...</div>

  return (
    <div className="flex flex-col h-[calc(100vh-200px)] bg-transparent rounded-xl border border-theme-border/30 shadow-2xl overflow-hidden">

      {/* 1. Control Bar */}
      <div className="flex justify-between items-center p-4 bg-theme-bg-primary/20 backdrop-blur-md border-b border-theme-border/30 z-10 shadow-sm">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-light text-theme-text-primary capitalize w-48">
            {currentDate.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}
          </h2>
          <div className="flex gap-2">
            <button onClick={() => navigateMonth('prev')} className="px-3 py-1 bg-theme-text-primary/5 hover:bg-theme-text-primary/10 rounded border border-theme-border/50 text-sm text-theme-text-primary/90 hover:text-theme-text-primary">Prec</button>
            <button onClick={() => navigateMonth('next')} className="px-3 py-1 bg-theme-text-primary/5 hover:bg-theme-text-primary/10 rounded border border-theme-border/50 text-sm text-theme-text-primary/90 hover:text-theme-text-primary">Succ</button>
          </div>
        </div>


        <div className="flex items-center gap-4">
          {(() => {
            const monthYear = currentRomeComponents.year
            const monthNum = currentRomeComponents.month + 1
            const activeInMonth = bookings.filter(b =>
              isReportableRentalBooking(b) &&
              getOccupiedDaysInMonth(b.pickup_date, b.dropoff_date, monthYear, monthNum, daysInMonth) > 0
            )
            // Use canonical totalRevenue from monthly-report endpoint (rental +
            // penali + danni). Falls back to local proration of price_total
            // (rental only, no penali/danni) if the endpoint hasn't returned yet.
            const localFallback = activeInMonth.reduce(
              (sum, b) => sum + prorateRevenueForMonth(b, monthYear, monthNum, daysInMonth),
              0,
            )
            const fatturatoMese = canonicalFatturato !== null ? canonicalFatturato : localFallback
            return (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-theme-text-muted">Questo Mese:</span>
                  <span className="text-dr7-gold font-bold text-sm">{canonicalBookings !== null ? canonicalBookings : activeInMonth.length} noleggi</span>
                </div>
                {canViewFinancials && !hideFinancials && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-theme-text-muted">Fatturato:</span>
                    <span className="text-green-400 font-bold text-sm">
                      <FinancialData type="total">
                        €{fatturatoMese.toFixed(2)}
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
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${hideFinancials
                ? 'bg-green-600 text-theme-text-primary hover:bg-green-700'
                : 'bg-dr7-gold text-white hover:bg-[#0A8FA3]'
                }`}
            >
              {hideFinancials ? 'MOSTRA' : 'NASCONDI'}
            </button>
          )}
          <input
            type="text"
            placeholder="Cerca veicolo o cliente..."
            className="bg-theme-bg-primary/20 border border-theme-border/50 rounded-full px-4 py-1.5 text-sm w-64 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-dr7-gold/50"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>
      {/* 2026-06-01: filtro periodo Da/A — overlap con i booking del veicolo */}
      <div className="px-4 py-2 bg-theme-bg-primary/20 backdrop-blur-md border-b border-theme-border/30">
        <DateRangeFilter value={dateRange} onChange={setDateRange} compact />
      </div>

      {/* 2. Scrollable Calendar Area */}
      <div className="flex-1 overflow-auto relative flex flex-col w-full" ref={gridRef}>

        {/* A. Sticky Header Row */}
        <div className="flex sticky top-0 z-[40] bg-theme-bg-primary shadow-md min-w-max h-[42px] border-b border-theme-border/30">
          {/* Header Spacer for Left Column */}
          <div className="sticky left-0 w-[300px] z-[41] bg-theme-bg-primary border-r border-theme-border/30 flex items-center px-4 font-bold text-xs text-theme-text-muted uppercase tracking-wider backdrop-blur-sm shadow-[4px_0_10px_-2px_var(--color-theme-shadow)]">
            Veicolo / Targa
          </div>

          {/* Day Columns Header */}
          <div className="flex">
            {daysArray.map((day) => {
              const d = new Date(currentRomeComponents.year, currentRomeComponents.month, day)
              const isHol = getHolidayForDate(d)
              const isSun = isSunday(d)

              // Check if this is today
              const today = new Date()
              const isToday = d.getDate() === today.getDate() &&
                d.getMonth() === today.getMonth() &&
                d.getFullYear() === today.getFullYear()

              return (
                <div
                  key={day}
                  className={`
                    flex flex-col items-center justify-center border-r border-theme-border/40 relative
                    ${(isHol || isSun) ? 'bg-theme-text-primary/[0.02]' : ''}
                    ${isToday ? 'bg-dr7-gold/40' : ''}
                  `}
                  style={{
                    width: CELL_WIDTH,
                    boxShadow: isToday ? 'inset 2px 0 0 0 rgba(45, 138, 126, 0.7), inset -2px 0 0 0 rgba(45, 138, 126, 0.7)' : undefined
                  }}
                >
                  {/* Red dot for Sundays and holidays */}
                  {(isHol || isSun) && (
                    <div
                      className="absolute top-1 right-1 w-1 h-1 rounded-full bg-red-500/70"
                      title={isHol ? isHol.name : 'Domenica'}
                    />
                  )}

                  <span className="text-[10px] text-theme-text-primary/75">
                    {day}
                  </span>
                  <span className="text-[8px] uppercase text-theme-text-muted/70">
                    {d.toLocaleDateString('it-IT', { weekday: 'short' })}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* B. Vehicle Rows */}
        <div className="min-w-max pb-32"> {/* Extra padding bottom for tooltips */}
          {visibleRows.map((row) => {
            // Calculate dynamic height based on lanes
            const extraPadding = 12 // Top/Bottom padding
            const rowHeight = Math.max(MIN_ROW_HEIGHT, (row.laneCount * (BAR_HEIGHT + 4)) + extraPadding)

            return (
              <div
                key={row.vehicle.id}
                className="flex border-b border-theme-border hover:bg-theme-bg-tertiary/30 transition-colors group relative min-w-max"
                style={{ height: rowHeight }}
              >
                {/* Left Sticky Column */}
                <div className="sticky left-0 w-[300px] z-[30] bg-theme-bg-primary/95 group-hover:bg-theme-bg-secondary/95 border-r border-theme-border/30 flex items-center gap-3 px-4 backdrop-blur-sm shrink-0 shadow-[4px_0_10px_-2px_var(--color-theme-shadow)]">
                  {/* Vehicle image (from vehicles.metadata.image set in VehiclesTab).
                      Fallback to a generic SVG car silhouette so the row layout stays
                      consistent for vehicles that don't have an image uploaded yet. */}
                  <div className="w-12 h-9 shrink-0 rounded-md bg-theme-bg-tertiary border border-theme-border/40 overflow-hidden flex items-center justify-center">
                    {row.vehicle.metadata?.image ? (
                      <img
                        src={row.vehicle.metadata.image}
                        alt={row.vehicle.display_name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : (
                      <svg className="w-6 h-6 text-theme-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 17h14M5 17a2 2 0 1 1-4 0M5 17a2 2 0 1 0 4 0m10 0a2 2 0 1 1-4 0m4 0a2 2 0 1 0 4 0M3 13l2-6h14l2 6M3 13v4h18v-4M3 13h18"/>
                      </svg>
                    )}
                  </div>
                  <div className="flex flex-col overflow-hidden min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-theme-text-primary truncate" title={row.vehicle.display_name}>{row.vehicle.display_name}</span>
                      {row.vehicle.category && (() => {
                        const palette = getPaletteForCategory(row.vehicle.category, proCategories)
                        const proLabel = proCategories.find(c => c.id === row.vehicle.category)?.label
                        const tagText = (proLabel || (row.vehicle.category === 'aziendali' ? 'AZIENDALE' : row.vehicle.category)).toUpperCase()
                        return (
                          <span className={`text-[9px] px-2 py-0.5 rounded uppercase font-bold tracking-wider ${palette.pillBg} ${palette.pillText}`}>
                            {tagText}
                          </span>
                        )
                      })()}
                    </div>
                    <span className="text-xs text-theme-text-muted font-mono">{row.vehicle.plate || '-'}</span>
                  </div>
                </div>

                {/* The Day Grid & Events Container.
                    2026-06-03: larghezza FISSA = giorni × CELL_WIDTH (come
                    l'header), NON flex-1. Con flex-1 le celle si comprimevano
                    al restringere la finestra mentre header/eventi restavano a
                    45px/giorno → la riga "oggi" (blu) finiva sulla colonna
                    sbagliata. Ora header, celle, riga oggi ed eventi usano la
                    stessa griglia fissa e scorrono insieme. */}
                <div className="relative shrink-0" style={{ width: daysArray.length * CELL_WIDTH }}>

                  {/* 1. Background Grid Cells */}
                  <div className="flex h-full absolute inset-0 z-0 pointer-events-none">
                    {daysArray.map((day) => {

                      const d = new Date(currentRomeComponents.year, currentRomeComponents.month, day)
                      const isRedDay = getHolidayForDate(d) || isSunday(d)

                      // Check if this is today
                      const today = new Date()
                      const isToday = d.getDate() === today.getDate() &&
                        d.getMonth() === today.getMonth() &&
                        d.getFullYear() === today.getFullYear()

                      return (
                        <div
                          key={day}
                          className={`
                                border-r border-theme-border/40 h-full shrink-0
                                ${isToday ? 'bg-dr7-gold/20' : ''}
                                ${isRedDay && !isToday ? 'bg-theme-text-primary/[0.03]' : ''}
                              `}
                          style={{
                            width: CELL_WIDTH,
                            boxShadow: isToday ? 'inset 2px 0 0 0 rgba(45, 138, 126, 0.7), inset -2px 0 0 0 rgba(45, 138, 126, 0.7)' : undefined
                          }}
                        />
                      )
                    })}
                  </div>

                  {/* 2. Interactive Click Layer (Create Booking) */}
                  <div className="flex h-full absolute inset-0 z-10">
                    {daysArray.map((day) => (
                      <div
                        key={day}
                        className="h-full shrink-0 hover:bg-theme-text-primary/5 cursor-pointer transition-colors"
                        style={{ width: CELL_WIDTH }}
                        onClick={() => {
                          const date = new Date(currentRomeComponents.year, currentRomeComponents.month, day, 10, 0, 0)
                          if (onNewBooking) onNewBooking(row.vehicle.id, date)
                        }}
                        title={`Nuova prenotazione: ${day}/${currentRomeComponents.month + 1}`}
                      />
                    ))}
                  </div>

                  {/* 3. Rendered Events Layer */}
                  <div className="absolute inset-0 z-20 pointer-events-none">
                    {row.events.map(evt => {
                      // STRICT COLOR CONTRACT (Premium Dark Theme)
                      // DR7 BRAND = Customer booking (logo blue/teal)
                      // ORANGE = Unavailable (muted orange)

                      let bgClass = "bg-dr7-gold"
                      let borderClass = "border-dr7-gold/30"

                      // Check if this is an unavailability/mechanic booking
                      const isUnavailability = ['car_wash', 'mechanical_service', 'mechanical', 'internal_block'].includes(evt.booking.service_type || '')
                      // Uscita Straordinaria = movimentazione interna → SEMPRE VERDE
                      const isUscita = evt.booking.service_type === 'uscita_straordinaria'
                      // Unpaid booking = orange "IN ATTESA" (any service type: noleggio, car wash, mechanical)
                      const isPendingPayment = evt.booking.payment_status === 'pending'
                        || evt.booking.payment_status === 'unpaid'
                        || evt.booking.status === 'pending_payment'

                      // Da saldare MANUALMENTE CONFERMATA = RED (stays on calendar, no auto-cancel)
                      const isManuallyConfirmed = evt.booking.booking_details?.manually_confirmed === true
                      const isDaSaldareConfirmed = isPendingPayment && isManuallyConfirmed

                      if (isDaSaldareConfirmed) {
                        bgClass = "bg-red-600/80"
                        borderClass = "border-red-500/60 border-dashed"
                      } else if (isPendingPayment) {
                        // Yellow/orange = Da saldare NOT confirmed (expires 1h)
                        bgClass = "bg-yellow-500/80"
                        borderClass = "border-yellow-400/50 border-dashed"
                      } else if (isUnavailability) {
                        bgClass = "bg-orange-500/80"
                        borderClass = "border-orange-400/30"
                      }

                      // Uscita Straordinaria vince su tutto: verde, qualunque
                      // sia lo stato pagamento (è una movimentazione interna).
                      if (isUscita) {
                        bgClass = "bg-emerald-600/85"
                        borderClass = "border-emerald-400/50"
                      }

                      const top = 6 + (evt.laneIndex * (BAR_HEIGHT + 4))

                      // Clamp bar to visible grid area to avoid browser rendering limits
                      // (bars with left=-44955 width=46305 exceed max texture size ~16384px)
                      const gridWidth = daysInMonth * CELL_WIDTH
                      const clampedLeft = Math.max(0, evt.leftPx)
                      const rightEdge = evt.leftPx + evt.widthPx
                      const clampedRight = Math.min(gridWidth, rightEdge)
                      const finalWidth = Math.max(CELL_WIDTH, clampedRight - clampedLeft)

                      const bookingHasNotes = !!(evt.booking.booking_details?.notes && String(evt.booking.booking_details.notes).trim())

                      return (
                        <div
                          key={evt.id}
                          className={`
                                absolute rounded shadow-md border pointer-events-auto group/evt overflow-hidden flex flex-col justify-center text-theme-text-primary
                                ${bgClass} ${borderClass}
                                hover:z-50 hover:shadow-xl hover:brightness-110 transition-all
                              `}
                          style={{
                            left: clampedLeft,
                            width: finalWidth,
                            top: top,
                            height: BAR_HEIGHT,
                            ...(bookingHasNotes ? { boxShadow: 'inset 0 0 0 2.5px #FACC15', borderColor: '#FACC15' } : {}),
                            ...(isCollaboratoreCal ? { cursor: 'default' } : {}),
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            // Collaboratore: niente apertura dettagli prenotazione.
                            if (isCollaboratoreCal) return
                            setSelectedBooking(evt.booking)
                          }}
                        >
                          <div className="px-2 flex flex-col justify-center h-full">
                            {!isCollaboratoreCal && (
                              <span className="font-bold text-[10px] truncate leading-tight">
                                {(isPendingPayment && !isDaSaldareConfirmed && !isUscita) ? '⏳ IN ATTESA — ' : ''}{evt.booking.customer_name || evt.booking.booking_details?.customer?.fullName || evt.booking.guest_name || 'Cliente Sconosciuto'} • {(() => {
                                  // Calculate drop-off day: if end time is exactly 00:00, use previous day
                                  const endHours = evt.endLocal.getHours()
                                  const endMinutes = evt.endLocal.getMinutes()
                                  if (endHours === 0 && endMinutes === 0) {
                                    // Exactly midnight - drop-off is previous day
                                    const prevDay = new Date(evt.endLocal)
                                    prevDay.setDate(prevDay.getDate() - 1)
                                    return prevDay.getDate()
                                  } else {
                                    // Any other time - drop-off is this day
                                    return evt.endLocal.getDate()
                                  }
                                })()}
                              </span>
                            )}
                          </div>

                          {/* Left Edge Marker (Pickup) */}
                          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-theme-text-primary/50"></div>
                          {/* Right Edge Marker (Dropoff) */}
                          <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-theme-text-primary/50"></div>


                          {/* TOOLTIP ON HOVER — nascosto per collaboratori
                              (niente dati cliente, niente targa, niente date). */}
                          {!isCollaboratoreCal && (
                          <div className="hidden group-hover/evt:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-theme-bg-primary border border-theme-border text-theme-text-primary text-xs p-3 rounded shadow-2xl w-max z-[100] pointer-events-none min-w-[200px]">
                            <div className="font-bold mb-1 text-base">{evt.booking.customer_name}</div>
                            <div className="text-theme-text-muted mb-2">{evt.booking.vehicle_name} ({evt.booking.vehicle_plate})</div>

                            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                              <span className="text-theme-text-muted">Ritiro:</span>
                              <span className="font-mono">{formatRomeDate(evt.startLocal, { dateStyle: 'full', timeStyle: 'short' })}</span>

                              <span className="text-theme-text-muted">Rientro:</span>
                              <span className="font-mono">{formatRomeDate(evt.endLocal, { dateStyle: 'full', timeStyle: 'short' })}</span>

                              <span className="text-theme-text-muted">Stato:</span>
                              <span className="uppercase font-bold tracking-wider text-[10px]">{evt.booking.status}</span>
                            </div>

                            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-theme-bg-primary rotate-45 border-r border-b border-theme-border"></div>
                          </div>
                          )}

                        </div>
                      )
                    })}
                  </div>
                </div>

              </div>
            )
          })}

          {visibleRows.length === 0 && !loading && (
            <div className="p-12 text-center text-theme-text-muted">Nessun veicolo trovato.</div>
          )}
        </div>

      </div>

      {/* Booking Details Panel */}
      {selectedBooking && (
        <BookingDetailsPanel
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          onEdit={(bookingId) => {
            // Dispatch event to open booking in edit mode in Prenotazioni tab
            window.dispatchEvent(new CustomEvent('openBookingForm', {
              detail: {
                bookingId,
                vehicleId: selectedBooking.vehicle_id,
                date: new Date(selectedBooking.pickup_date)
              }
            }))
          }}
        />
      )}
    </div>
  )
}
