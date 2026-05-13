import { useState, useEffect, useRef, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { supabase } from '../../../supabaseClient'
import CustomerAutocomplete from './CustomerAutocomplete'
import NewClientModal from './NewClientModal'
import { usePaymentMethods } from '../../../hooks/usePaymentMethods'
import LimitationOverrideModal from '../../../components/LimitationOverrideModal'
import ClientStatusBadge from '../../../components/ClientStatusBadge'
import { useLimitationOverride } from '../../../hooks/useLimitationOverride'
import toast from 'react-hot-toast'
import { logAdminAction } from '../../../utils/logAdminAction'
import { buildCarWashContext } from '../../../utils/adminLogHelpers'
// Conflict utilities are now handled inline
import { validateScheduling } from '../../../utils/schedulingRules'
import { classifyVehicle, classifyVehicleLocally, type VehicleCategory } from '../../../utils/vehicleClassification'
import { logger } from '../../../utils/logger'
import { authFetch } from '../../../utils/authFetch'
// Orari lavaggio dinamici da Centralina Pro > Orari Lavaggio
import { generateLavaggioSlotsForDate, getAllowedTimeRangesForDate } from '../../../utils/lavaggioHours'
import { isVehicleAvailable, type Vehicle as AvailabilityVehicle, type Booking as AvailabilityBooking } from '../../../utils/vehicleAvailability'
import { paymentMethodAutoInvoice } from '../../../utils/paymentMethodAutoInvoice'
import { isCartaPunti, isNexiPayByLink } from '../../../utils/paymentMethodMatchers'
import { isTestBooking, isTestVehicle } from '../../../utils/isTestBooking'

interface Customer {
  id: string
  full_name: string
  email: string | null
  phone: string | null
}

interface CarWashBooking {
  id: string
  customer_id: string
  customer_name: string
  customer_email: string
  customer_phone: string
  user_id?: string
  customer_codice_fiscale?: string
  customer_indirizzo?: string
  customer_numero_civico?: string
  customer_citta?: string
  customer_cap?: string
  customer_provincia?: string
  service_name: string
  vehicle_name?: string
  vehicle_plate?: string
  appointment_date: string
  appointment_time: string
  price_total: number
  status: string
  payment_status: string
  payment_method?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking_details: any
  created_at: string
}

interface CarWashService {
  id: string
  name: string
  name_en: string
  price: number
  duration: string
  description: string
  description_en: string
  features: string[]
  features_en: string[]
  display_order: number
  is_active: boolean
  category: string
  main_tab: string
  price_unit?: string
  price_options?: { label: string; price: number }[]
  durationMinutes?: number
  allowedTimeRanges?: { start: string; end: string }[]
}

// Helper to parse duration string to minutes
function parseDurationToMinutes(duration: string): number {
  if (!duration || duration === '-') return 30 // Default 30 min for services without duration
  const match = duration.match(/(\d+)\s*min/i)
  if (match) return parseInt(match[1])
  // Handle "X ore" format
  const hoursMatch = duration.match(/(\d+)\s*or/i)
  if (hoursMatch) return parseInt(hoursMatch[1]) * 60
  return 30 // Default
}


interface CarWashBookingsTabProps {
  initialData?: { appointmentDate?: string, appointmentTime?: string } | null
  onDataConsumed?: () => void
}

export default function CarWashBookingsTab({ initialData, onDataConsumed }: CarWashBookingsTabProps = {}) {
  const paymentMethods = usePaymentMethods()
  const [bookings, setBookings] = useState<CarWashBooking[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [carWashServices, setCarWashServices] = useState<CarWashService[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  // Synchronous re-entry guard: React state updates are async, so a rapid
  // double-click lands in handleSubmit before submitting flips. The ref is
  // synchronous, so the second call bails immediately and we don't fire
  // duplicate WhatsApp confirmations / duplicate inserts.
  const submitLockRef = useRef(false)
  // Lock dedicato per la chiamata createBooking (insert + WhatsApp).
  // Distinto da submitLockRef cosi' protegge anche i replay OTP / force.
  const createBookingLockRef = useRef(false)
  // Session lock: una volta che l'utente fa partire un Salva con successo
  // (la booking e' stata salvata in DB), questo flag NON viene piu' rilasciato
  // finche' l'utente non apre/riapre la form. Cosi' anche se l'utente clicca
  // dopo molti secondi, il secondo click su Salva non parte. Reset solo
  // quando setShowForm(true) (apertura nuova form pulita).
  const formSubmittedRef = useRef(false)
  const [showForm, setShowForm] = useState(false)
  const [editingBooking, setEditingBooking] = useState<CarWashBooking | null>(null)
  const [editService, setEditService] = useState<CarWashService | null>(null)
  const [editExtras, setEditExtras] = useState<CarWashService[]>([])
  const [editExtraPriceOptions, setEditExtraPriceOptions] = useState<Record<string, { label: string; price: number }>>({})
  const [editExtraQuantities, setEditExtraQuantities] = useState<Record<string, number>>({})
  const [selectedMainTab, setSelectedMainTab] = useState<'lavaggio' | 'meccanica'>('lavaggio')

  // Wizard state
  const [currentStep, setCurrentStep] = useState<0 | 1 | 2 | 3>(0)
  const [selectedService, setSelectedService] = useState<CarWashService | null>(null)
  const [selectedPriceOption, setSelectedPriceOption] = useState<{ label: string; price: number } | null>(null)
  const [selectedExtras, setSelectedExtras] = useState<CarWashService[]>([])
  const [extraPriceOptions, setExtraPriceOptions] = useState<Record<string, { label: string; price: number }>>({})
  const [extraQuantities, setExtraQuantities] = useState<Record<string, number>>({})
  const [customPrice, setCustomPrice] = useState('')
  const [showNewClientModal, setShowNewClientModal] = useState(false)
  // Conferma Prenotazione: same UX as ReservationsTab — when payment_status
  // is "Da Saldare", admin can tick this to force-send the WhatsApp confirma
  // template (carwash_new_customer / mechanical_new_customer) anyway. The
  // template's {payment_status} placeholder shows "Da saldare" in that case.
  // Untickato + pending => nessun messaggio (silenzioso finché non si segna pagato).
  const [confirmBooking, setConfirmBooking] = useState(false)

  // Vehicle classification state (Step 0)
  const [vehiclePlate, setVehiclePlate] = useState('')
  const [vehicleMakeModel, setVehicleMakeModel] = useState('')
  const [vehicleCategory, setVehicleCategory] = useState<VehicleCategory | null>(null)
  const [classificationSource, setClassificationSource] = useState<'local' | 'api' | 'manual' | null>(null)
  const [lookingUpTarga, setLookingUpTarga] = useState(false)
  const [showExistingPlatesList, setShowExistingPlatesList] = useState(false)
  const [existingPlatesSearch, setExistingPlatesSearch] = useState('')
  const [targaVehicleInfo, setTargaVehicleInfo] = useState<{ brand?: string; model?: string; year?: string; fuel?: string; powerCV?: string } | null>(null)
  const [targaNotFound, setTargaNotFound] = useState(false)
  // OTP override for manual category selection
  const override = useLimitationOverride()
  // Foreign plate flow (Targa Estera) — requires OTP per category
  const [showForeignPlateModal, setShowForeignPlateModal] = useState(false)
  const [pendingForeignCategory, setPendingForeignCategory] = useState<'urban' | 'maxi' | null>(null)

  // ─── Supercar Experience: vehicle picker ───────────────────────────
  // When the operator picks the "Supercar Experience" or "Icon Experience"
  // extra (with a price option that encodes a duration like 1h/2h), we
  // show a picker of supercar fleet vehicles filtered by availability for
  // appointment_date + appointment_time + duration. The chosen vehicle is
  // persisted on the carwash booking AND a shadow rental row is inserted
  // in `bookings` so the calendar / availability checks block the supercar.
  interface SupercarFleetVehicle {
    id: string
    display_name: string
    plate: string | null
    daily_rate: number
    category: string | null
    status: string | null
    metadata: Record<string, unknown> | null
  }
  const [supercarFleet, setSupercarFleet] = useState<SupercarFleetVehicle[]>([])
  const [supercarFleetBookings, setSupercarFleetBookings] = useState<AvailabilityBooking[]>([])
  const [experienceVehicle, setExperienceVehicle] = useState<SupercarFleetVehicle | null>(null)

  // Buffer for an edit-click blocked by the paid_wash_modify OTP gate.
  // Resumed by the useEffect below once the override is approved.
  const pendingEditBookingRef = useRef<CarWashBooking | null>(null)
  // Set quando il gate OTP per prenotazione_lavaggio_conferma viene aperto a
  // Salva. Quando l'OTP è approvato il useEffect ripete createBooking(force)
  // così l'operatore non deve premere di nuovo Salva.
  const pendingCreateBookingRef = useRef<{ force: boolean } | null>(null)

  // Centralized "Modifica" handler — gates paid/confirmed bookings behind OTP
  // (Valerio + Ilenia bypass server-side automatically).
  // Test bookings (vehicle plate starts with TEST / vehicle_name='test')
  // ALWAYS bypass — operatori QA non devono ricevere OTP per i test interni.
  function openEditBooking(booking: CarWashBooking, opts?: { skipOtpGate?: boolean }) {
    if (!opts?.skipOtpGate && !isTestBooking(booking)) {
      const PAID = ['paid', 'completed', 'succeeded']
      const CONFIRMED = ['confirmed', 'confermata', 'active', 'in_corso']
      const isPaid = PAID.includes((booking.payment_status || '').toLowerCase())
      const isConfirmed = CONFIRMED.includes((booking.status || '').toLowerCase())
      if ((isPaid || isConfirmed) && !override.hasOverride('paid_wash_modify')) {
        pendingEditBookingRef.current = booking
        override.requestOverride(
          'paid_wash_modify',
          'Modifica o spostamento di un lavaggio/meccanica pagato o confermato: serve OTP della direzione.',
          `wash_edit_${booking.id}`,
        )
        return
      }
    }
    setEditingBooking(booking)
  }

  // Resume edit once OTP has been approved.
  useEffect(() => {
    const pending = pendingEditBookingRef.current
    if (pending && override.overrideCodes.has('paid_wash_modify')) {
      pendingEditBookingRef.current = null
      openEditBooking(pending, { skipOtpGate: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [override.overrideCodes])

  // Resume create booking once any OTP override is approved.
  // We retry createBooking as soon as the booking-confirmation override
  // (prenotazione_lavaggio_conferma) lands, even if Carta Punti is also
  // required. createBooking re-evaluates the carta_punti_lavaggio gate
  // itself and re-fires requestOverride — opening the SECOND modal so
  // the operator can chain through both OTPs.
  //
  // Previously we required BOTH confirmOk AND cartaPuntiOk in this gate,
  // which deadlocked the flow: after approving conferma, the effect did
  // nothing (cartaPuntiOk=false), the carta_punti gate never ran, and
  // the Salva button stayed stuck on "In attesa OTP…" forever.
  useEffect(() => {
    const pending = pendingCreateBookingRef.current
    if (!pending) return
    const confirmOk = override.overrideCodes.has('prenotazione_lavaggio_conferma')
    if (confirmOk) {
      pendingCreateBookingRef.current = null
      createBooking(pending.force)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [override.overrideCodes])

  useEffect(() => {
    if (pendingForeignCategory && override.hasOverride('foreign_plate_carwash')) {
      setVehicleCategory(pendingForeignCategory)
      setClassificationSource('manual')
      setTargaVehicleInfo({
        brand: 'Targa Estera',
        model: pendingForeignCategory === 'urban' ? 'Urban' : 'Maxi',
      })
      setTargaNotFound(false)
      setShowForeignPlateModal(false)
      setPendingForeignCategory(null)
    }
  }, [override.overrideCodes, pendingForeignCategory, override])

  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const [primeFlex, setPrimeFlex] = useState(false)
  const PRIME_FLEX_PRICE = 4.90

  const [formData, setFormData] = useState({
    customer_id: '',
    service_name: '',
    appointment_date: todayStr,
    appointment_time: '',
    price_total: 0,
    payment_status: 'pending',
    payment_method: '' as string,
    amount_paid: '0',
    notes: ''
  })

  const [bookingSearchQuery, setBookingSearchQuery] = useState('')

  // Manual price override
  const [manualPrice, setManualPrice] = useState<string | null>(null)

  // Quick Edit Customer Modal State
  const [editModalOpen, setEditModalOpen] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [customerToEdit, setCustomerToEdit] = useState<any>(null)




  // Wizard computed values
  const getTotal = () => {
    let total = 0
    if (selectedService) {
      if (selectedService.price_unit === 'custom') {
        total += parseFloat(customPrice) || 0
      } else {
        total += selectedPriceOption?.price ?? selectedService.price
      }
    }
    for (const extra of selectedExtras) {
      const ep = extraPriceOptions[extra.id]
      const qty = extraQuantities[extra.id] || 1
      total += (ep?.price ?? extra.price) * qty
    }
    if (primeFlex) total += PRIME_FLEX_PRICE
    return total
  }

  const getFinalPrice = () => {
    if (manualPrice !== null && manualPrice !== '') {
      const parsed = parseFloat(manualPrice)
      return isNaN(parsed) ? getTotal() : parsed
    }
    return getTotal()
  }

  const getTotalDuration = () => {
    let duration = 0
    if (selectedService) {
      duration += selectedService.durationMinutes || parseDurationToMinutes(selectedService.duration)
    }
    for (const extra of selectedExtras) {
      const qty = extraQuantities[extra.id] || 1
      duration += (extra.durationMinutes || parseDurationToMinutes(extra.duration)) * qty
    }
    return duration
  }

  const buildServiceNames = () => {
    const parts: string[] = []
    if (selectedService) {
      let name = selectedService.name
      if (selectedPriceOption) name += ` (${selectedPriceOption.label})`
      parts.push(name)
    }
    for (const extra of selectedExtras) {
      let name = extra.name
      const ep = extraPriceOptions[extra.id]
      if (ep) name += ` (${ep.label})`
      const qty = extraQuantities[extra.id] || 1
      if (qty > 1) name += ` x${qty}`
      parts.push(name)
    }
    if (primeFlex) parts.push('Prime Flex')
    return parts.join(' + ')
  }

  // Edit modal computed values
  const getEditTotalDuration = () => {
    let d = 0
    if (editService) d += editService.durationMinutes || parseDurationToMinutes(editService.duration)
    for (const e of editExtras) {
      const qty = editExtraQuantities[e.id] || 1
      d += (e.durationMinutes || parseDurationToMinutes(e.duration)) * qty
    }
    return d
  }

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

  const resetWizard = () => {
    setCurrentStep(0)
    setSelectedService(null)
    setSelectedPriceOption(null)
    setSelectedExtras([])
    setExtraPriceOptions({})
    setExtraQuantities({})
    setManualPrice(null)
    setCustomPrice('')
    setPrimeFlex(false)
    setVehiclePlate('')
    setVehicleMakeModel('')
    setVehicleCategory(null)
    setExperienceVehicle(null)
    setClassificationSource(null)
    setLookingUpTarga(false)
    setTargaVehicleInfo(null)
    setConfirmBooking(false)
    setFormData({
      customer_id: '',
      service_name: '',
      appointment_date: todayStr,
      appointment_time: '',
      price_total: 0,
      payment_status: 'pending',
      payment_method: '',
      amount_paid: '0',
      notes: ''
    })
  }

  // Service filtering
  const categoryLabels: Record<string, string> = {
    urban: 'PRIME URBAN CLASS',
    maxi: 'PRIME MAXI CLASS',
    extra: 'PRIME EXTRA CARE',
    moto: 'PRIME MOTO',
    experience: 'PRIME EXPERIENCE',
    tech: 'PRIME TECH SERVICE'
  }

  // Fixed service numbers matching the flyer/marketing material
  const SERVICE_NUMBER: Record<string, number> = {
    'interior clean': 1, 'exterior clean': 2, 'full clean': 3, 'full clean n2': 4,
    'top shine': 5, 'vip experience': 6, 'luxury detail': 7, 'absolute detail': 8,
    'child care': 9, 'engine clean': 10, 'glass care': 11, 'odor control': 12,
    'pet clean': 13, 'plastic refresh': 14, 'quick shine': 15, 'rim care': 16,
    'seat clean': 17, 'seat protect': 18, 'moto essential': 19, 'courtesy drive': 20,
    'supercar experience': 21, 'icon experience': 22, 'brake service': 23,
    'battery swap': 24, 'wiper service': 25, 'headlight restore': 26,
  }
  const getServiceNum = (name: string) => {
    const lower = name.toLowerCase()
    // Try exact match first, then strip "prime " prefix
    return SERVICE_NUMBER[lower] || SERVICE_NUMBER[lower.replace('prime ', '')] || ''
  }

  // Test vehicles that skip API targa lookup (no credits needed)
  const TEST_VEHICLES: Record<string, { brand: string; model: string; year: string; fuel: string; powerCV: string; makeModel: string; category: VehicleCategory }> = {
    'TEST000': { brand: 'Fiat', model: 'Panda', year: '2023', fuel: 'Benzina', powerCV: '70', makeModel: 'Fiat Panda', category: 'urban' as VehicleCategory },
    'TEST002': { brand: 'BMW', model: 'X5', year: '2024', fuel: 'Diesel', powerCV: '286', makeModel: 'BMW X5', category: 'maxi' as VehicleCategory },
  }

  // Targa lookup handler
  async function handleTargaLookup() {
    if (vehiclePlate.length < 5 || lookingUpTarga) return
    setLookingUpTarga(true)
    setTargaVehicleInfo(null)

    // Check test vehicles first (no API call)
    const upperPlate = vehiclePlate.toUpperCase().trim()
    const testVehicle = TEST_VEHICLES[upperPlate]
    if (testVehicle) {
      setTargaVehicleInfo({ brand: testVehicle.brand, model: testVehicle.model, year: testVehicle.year, fuel: testVehicle.fuel, powerCV: testVehicle.powerCV })
      setVehicleMakeModel(testVehicle.makeModel)
      setVehicleCategory(testVehicle.category)
      setClassificationSource('local')
      setLookingUpTarga(false)
      return
    }

    try {
      const response = await fetch('/.netlify/functions/lookup-targa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targa: vehiclePlate }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        toast.error((err.error || 'Targa non trovata') + ' — richiedi autorizzazione per procedere')
        setTargaNotFound(true)
        setLookingUpTarga(false)
        return
      }
      setTargaNotFound(false)
      const data = await response.json()
      setTargaVehicleInfo({
        brand: data.brand,
        model: data.model,
        year: data.year,
        fuel: data.fuel,
        powerCV: data.powerCV,
      })
      // Auto-fill make/model and classify
      if (data.makeModel) {
        setVehicleMakeModel(data.makeModel)
        // Auto-classify
        const localResult = classifyVehicleLocally(data.makeModel)
        if (localResult) {
          setVehicleCategory(localResult.category)
          setClassificationSource('local')
        } else {
          // Fallback to API classification
          classifyVehicle(data.makeModel).then(result => {
            setVehicleCategory(result.category)
            setClassificationSource(result.source === 'local' ? 'local' : 'api')
          })
        }
      }
    } catch (err) {
      console.error('Targa lookup error:', err)
      toast.error('Errore nella ricerca targa')
    } finally {
      setLookingUpTarga(false)
    }
  }

  const filteredByTab = carWashServices.filter(s => s.main_tab === selectedMainTab)
  // Filter main services by vehicle category if classified
  const mainServices = filteredByTab.filter(s => {
    if (s.category === 'extra' || s.category === 'experience') return false
    // Moto mode: only show moto services
    if (vehicleCategory === 'moto') return s.category === 'moto'
    // If vehicle is classified (urban/maxi), only show matching services
    if (vehicleCategory && (s.category === 'urban' || s.category === 'maxi')) {
      return s.category === vehicleCategory
    }
    // Hide moto from general view (must be explicitly selected)
    if (s.category === 'moto') return false
    return true
  })
  const extraServices = filteredByTab.filter(s => s.category === 'extra' || s.category === 'experience')

  const servicesByCategory = mainServices.reduce<Record<string, CarWashService[]>>((acc, s) => {
    if (!acc[s.category]) acc[s.category] = []
    acc[s.category].push(s)
    return acc
  }, {})

  // ─── Supercar Experience helpers ───────────────────────────────────
  // True when the selected EXTRA includes a "Supercar Experience" or
  // "Icon Experience" entry. Both experiences book a real supercar from
  // the fleet for the chosen duration (price_options: 1h/2h/.../7h).
  const SUPERCAR_EXPERIENCE_RE = /supercar\s*experience|icon\s*experience/i
  const supercarExperienceExtra = selectedExtras.find(e => SUPERCAR_EXPERIENCE_RE.test(e.name))
  const supercarExperienceOption = supercarExperienceExtra
    ? extraPriceOptions[supercarExperienceExtra.id] || null
    : null
  // Two experience tiers, each with its own fleet:
  //   - SUPERCAR EXPERIENCE  → vehicles.category = exotic / supercar / supercars
  //   - ICON EXPERIENCE      → hypercars (top-tier; vehicles.category contains
  //                            "hyper" or equals icon/icons)
  // We detect by the extra's name so the picker can load the right pool.
  const experienceTier: 'supercar' | 'hypercar' | null = supercarExperienceExtra
    ? (/icon\s*experience/i.test(supercarExperienceExtra.name) ? 'hypercar' : 'supercar')
    : null
  const experienceTierLabel = experienceTier === 'hypercar' ? 'hypercar' : 'supercar'
  // Parse duration from option label "1h" / "2h" / "30min" → minutes.
  const supercarExperienceDurationMin = (() => {
    if (!supercarExperienceOption) return 0
    const lbl = supercarExperienceOption.label.toLowerCase().trim()
    const hMatch = lbl.match(/(\d+(?:[.,]\d+)?)\s*h/)
    if (hMatch) return Math.round(parseFloat(hMatch[1].replace(',', '.')) * 60)
    const mMatch = lbl.match(/(\d+)\s*min/)
    if (mMatch) return parseInt(mMatch[1])
    return 60 // safe default 1h
  })()
  // Window the supercar will be blocked for: appointment time + duration.
  const supercarExperienceWindow = (() => {
    if (!supercarExperienceExtra || !supercarExperienceOption) return null
    if (!formData.appointment_date || !formData.appointment_time) return null
    const [y, mo, d] = formData.appointment_date.split('-').map(Number)
    const [h, m] = formData.appointment_time.split(':').map(Number)
    const start = new Date(y, mo - 1, d, h, m, 0)
    if (isNaN(start.getTime())) return null
    const end = new Date(start.getTime() + supercarExperienceDurationMin * 60_000)
    const fmtTime = (dt: Date) => `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
    const fmtDate = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    return {
      pickupDate: fmtDate(start),
      pickupTime: fmtTime(start),
      returnDate: fmtDate(end),
      returnTime: fmtTime(end),
      durationMin: supercarExperienceDurationMin,
    }
  })()

  // Load fleet for the active experience tier (supercar OR hypercar).
  // Re-runs whenever the tier changes so toggling between Supercar and
  // Icon Experience swaps the underlying fleet correctly. Empty array on
  // tier change so the previous tier's cars don't leak into the picker.
  //
  // Category matching:
  //   - supercar tier  → category ILIKE %supercar% OR equals exotic (any case)
  //   - hypercar tier  → category ILIKE %hyper% OR equals icon/icons (any case)
  //   Both queries are case-insensitive so renamed categories
  //   ("Supercars", "Hypercar", "ICON") still match.
  useEffect(() => {
    if (!experienceTier) {
      if (supercarFleet.length > 0) setSupercarFleet([])
      return
    }
    let cancelled = false
    ;(async () => {
      const filter = experienceTier === 'hypercar'
        ? 'category.ilike.%hyper%,category.eq.icon,category.eq.Icon,category.eq.ICON,category.eq.icons,category.eq.Icons'
        : 'category.ilike.%supercar%,category.eq.exotic,category.eq.Exotic,category.eq.EXOTIC'
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, display_name, plate, daily_rate, category, status, metadata')
        .or(filter)
        .neq('status', 'retired')
        .order('display_name', { ascending: true })
      if (cancelled) return
      if (error) {
        console.error(`[CarWashBookingsTab] failed to load ${experienceTier} fleet:`, error)
        return
      }
      console.log(`[${experienceTier === 'hypercar' ? 'Icon' : 'Supercar'} Experience] loaded ${data?.length || 0} ${experienceTier}s from fleet`)
      setSupercarFleet((data || []) as SupercarFleetVehicle[])
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experienceTier])

  // Load existing bookings overlapping the experience window so we can
  // mark each supercar card as "Disponibile" / "Occupato".
  useEffect(() => {
    if (!supercarExperienceWindow || supercarFleet.length === 0) return
    let cancelled = false
    ;(async () => {
      // Pull a generous window around the experience day so any same-car
      // adjacent booking is included.
      const start = new Date(`${supercarExperienceWindow.pickupDate}T00:00:00+02:00`)
      const end = new Date(`${supercarExperienceWindow.returnDate}T23:59:59+02:00`)
      start.setDate(start.getDate() - 1)
      end.setDate(end.getDate() + 1)
      const { data, error } = await supabase
        .from('bookings')
        .select('id,vehicle_id,vehicle_plate,vehicle_name,customer_name,pickup_date,dropoff_date,status,service_type,payment_method,payment_status')
        .lt('pickup_date', end.toISOString())
        .gt('dropoff_date', start.toISOString())
      if (cancelled) return
      if (error) {
        console.error('[CarWashBookingsTab] failed to load bookings for supercar window:', error)
        return
      }
      setSupercarFleetBookings((data || []) as AvailabilityBooking[])
    })()
    return () => { cancelled = true }
  }, [
    supercarExperienceWindow?.pickupDate,
    supercarExperienceWindow?.pickupTime,
    supercarExperienceWindow?.returnDate,
    supercarExperienceWindow?.returnTime,
    supercarFleet.length,
  ])

  // Reset chosen vehicle when the experience extra is removed or the
  // duration option changes (the previously-picked car may now be busy).
  useEffect(() => {
    if (!supercarExperienceExtra || !supercarExperienceOption) {
      if (experienceVehicle) setExperienceVehicle(null)
    }
  }, [supercarExperienceExtra, supercarExperienceOption, experienceVehicle])



  async function openEditCustomer(customerId: string) {
    if (!customerId) return
    try {
      const { data, error } = await supabase
        .from('customers_extended')
        .select('*')
        .eq('id', customerId)
        .single()

      if (error) throw error
      if (data) {
        setCustomerToEdit(data)
        setEditModalOpen(true)
      }
    } catch (error) {
      console.error('Error fetching customer for edit:', error)
      toast.error("Impossibile caricare i dati del cliente per la modifica.")
    }
  }

  useEffect(() => {
    loadData()

    // Real-time subscription for new bookings, catalog price changes, AND new customers
    const subscription = supabase
      .channel('carwash-bookings-updates')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        (payload) => {
          logger.log('🔄 CarWashBookingsTab: Real-time update received', payload)
          loadData()
        }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'car_wash_services' },
        (payload) => {
          logger.log('🔄 CarWashBookingsTab: Catalog price update received', payload)
          loadData()
        }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'customers_extended' },
        () => loadData()
      )
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // Handle initial data from calendar
  useEffect(() => {
    if (initialData && initialData.appointmentDate && initialData.appointmentTime) {
      setFormData(prev => ({
        ...prev,
        appointment_date: initialData.appointmentDate!,
        appointment_time: initialData.appointmentTime!
      }))
      formSubmittedRef.current = false
      setShowForm(true)
      if (onDataConsumed) {
        onDataConsumed()
      }
    }
  }, [initialData, onDataConsumed])

  // Populate edit service/extras when editing a booking.
  //
  // BUG-FIX: gate the populate logic on the booking's ID changing — not on
  // the editingBooking object itself. The form fields call
  // `setEditingBooking({...editingBooking, customer_name: e.target.value})`
  // which creates a NEW object reference on every keystroke. Without the ID
  // gate this effect re-ran on every keystroke and re-hydrated
  // editService/editExtras/editExtraPriceOptions/editExtraQuantities from
  // the original cartItems — so any selection change the operator made
  // (added/removed extra, changed quantity, etc.) was overwritten the next
  // time they typed into ANY field. The visible symptom was "modify booking
  // resets everything I just changed".
  //
  // Solution: track the last initialized booking ID in a ref. We only
  // re-run the populate logic when the ID changes (operator opens a
  // different booking) or when the catalog finishes loading for the first
  // time. Subsequent re-renders triggered by typing leave the edit state
  // alone.
  const lastInitializedBookingIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!editingBooking) {
      lastInitializedBookingIdRef.current = null
      setEditService(null)
      setEditExtras([])
      setEditExtraPriceOptions({})
      setEditExtraQuantities({})
      return
    }
    if (carWashServices.length === 0) return
    if (lastInitializedBookingIdRef.current === editingBooking.id) return
    lastInitializedBookingIdRef.current = editingBooking.id

    const cartItems = editingBooking.booking_details?.cartItems || []
    if (cartItems.length === 0) {
      setEditService(null)
      setEditExtras([])
      setEditExtraPriceOptions({})
      setEditExtraQuantities({})
      return
    }
    const mainItem = cartItems[0]
    const found = carWashServices.find((s: CarWashService) => s.id === mainItem.serviceId) || null
    setEditService(found)
    const extras: CarWashService[] = []
    const priceOpts: Record<string, { label: string; price: number }> = {}
    const qtys: Record<string, number> = {}
    for (let i = 1; i < cartItems.length; i++) {
      const item = cartItems[i]
      const foundExtra = carWashServices.find((s: CarWashService) => s.id === item.serviceId)
      if (foundExtra) {
        extras.push(foundExtra)
        if (item.option && item.price !== foundExtra.price) {
          priceOpts[foundExtra.id] = { label: item.option, price: item.price }
        }
        if (item.quantity && item.quantity > 1) {
          qtys[foundExtra.id] = item.quantity
        }
      }
    }
    setEditExtras(extras)
    setEditExtraPriceOptions(priceOpts)
    setEditExtraQuantities(qtys)
  }, [editingBooking, carWashServices])

  async function loadData() {
    setLoading(true)
    try {
      // Load bookings (exclude cancelled) - sorted by creation time (newest first)
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .eq('service_type', 'car_wash')
        .neq('customer_name', 'Lavaggio Rientro')
        .order('created_at', { ascending: false })

      if (bookingsError) throw bookingsError

      // Load customers via Netlify function (bypasses RLS, paginates beyond 1000 limit)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let customersData: any[] = []
      try {
        const custResponse = await fetch('/.netlify/functions/list-customers')
        const custResult = await custResponse.json()
        if (custResponse.ok && custResult.customers) {
          customersData = custResult.customers
        }
      } catch (custErr) {
        console.error('Failed to load customers via function:', custErr)
      }

      // Load car wash services from database
      const { data: servicesData, error: servicesError } = await supabase
        .from('car_wash_services')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true })

      if (servicesError) throw servicesError

      // Map services with computed fields
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappedServices: CarWashService[] = (servicesData || []).map((s: any) => ({
        ...s,
        durationMinutes: parseDurationToMinutes(s.duration),
        // Pre-compute weekday-typical ranges for display only (today's date used as a sample;
        // actual booking validation uses getAllowedTimeRangesForDate(appointmentDate, duration))
        allowedTimeRanges: getAllowedTimeRangesForDate(new Date(), parseDurationToMinutes(s.duration))
      }))

      // Map customers_extended to Customer interface
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappedCustomers: Customer[] = (customersData || []).map((c: any) => {
        let fullName = 'N/A'
        if (c.tipo_cliente === 'azienda') {
          fullName = c.denominazione || c.ragione_sociale || 'N/A'
        } else if (c.tipo_cliente === 'pubblica_amministrazione') {
          fullName = c.ente_ufficio || 'N/A'
        } else {
          fullName = `${c.nome || ''} ${c.cognome || ''}`.trim() || c.ragione_sociale || 'N/A'
        }
        return {
          id: c.id,
          full_name: fullName,
          email: c.email,
          phone: c.telefono
        }
      })

      // Deduplicate customers: keep the most recently updated record per email (or name if no email)
      const seen = new Map<string, Customer>()
      for (const c of mappedCustomers) {
        const key = (c.email || c.full_name || c.id).toLowerCase().trim()
        if (!seen.has(key)) {
          seen.set(key, c)
        }
      }
      const dedupedCustomers = Array.from(seen.values())

      setBookings(bookingsData || [])
      setCustomers(dedupedCustomers)
      setCarWashServices(mappedServices)
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Lightweight refresh that only reloads customers (no loading spinner, no form reset)
  async function refreshCustomers() {
    try {
      const { data: customersData } = await supabase
        .from('customers_extended')
        .select('id, nome, cognome, ragione_sociale, denominazione, ente_ufficio, tipo_cliente, email, telefono')
        .order('cognome')

      const customerMap = new Map<string, Customer>();
      (customersData || []).forEach((c: any) => {
        let fullName = 'N/A'
        if (c.tipo_cliente === 'azienda') {
          fullName = c.denominazione || c.ragione_sociale || 'N/A'
        } else if (c.tipo_cliente === 'pubblica_amministrazione') {
          fullName = c.ente_ufficio || 'N/A'
        } else {
          fullName = `${c.nome || ''} ${c.cognome || ''}`.trim() || c.ragione_sociale || 'N/A'
        }
        customerMap.set(c.id, {
          id: c.id,
          full_name: fullName,
          email: c.email || null,
          phone: c.telefono || null
        })
      })

      const { data: legacyCustomers } = await supabase
        .from('customers')
        .select('id, full_name, email, phone')

      if (legacyCustomers) {
        legacyCustomers.forEach((c: any) => {
          if (!customerMap.has(c.id)) {
            customerMap.set(c.id, c)
          }
        })
      }

      setCustomers(Array.from(customerMap.values()))
    } catch (error) {
      console.error('Failed to refresh customers:', error)
    }
  }

  // Find the shadow rental row for a carwash booking that bundles a
  // Supercar Experience. Looks first at booking_details.supercar_experience.
  // shadow_booking_id, then falls back to a query by parent id (so older
  // bookings created before the back-ref was persisted are still cleaned).
  async function findSupercarShadowBookingId(carwashBookingId: string, parentDetails: Record<string, unknown> | null | undefined): Promise<string | null> {
    const exp = parentDetails && typeof parentDetails === 'object'
      ? (parentDetails as { supercar_experience?: { shadow_booking_id?: string | null } }).supercar_experience
      : undefined
    if (exp?.shadow_booking_id) return exp.shadow_booking_id
    // Fallback: search bookings where booking_details.parent_carwash_booking_id === carwashBookingId
    try {
      const { data } = await supabase
        .from('bookings')
        .select('id')
        .contains('booking_details', { parent_carwash_booking_id: carwashBookingId })
        .limit(1)
      return data && data.length > 0 ? data[0].id : null
    } catch {
      return null
    }
  }

  async function handleDeleteBooking(bookingId: string, customerName: string) {
    // OTP gate (configurabile da Gestione OTP > 'wash.delete'). Se la
    // regola e' disattivata, isOtpRequired ritorna false e
    // requestOverride auto-approva senza popup.
    // Test bookings bypassano sempre l'OTP (vehicle TEST*).
    const bookingToDelete = bookings.find(b => b.id === bookingId)
    if (!isTestBooking(bookingToDelete) && !override.hasOverride('wash.delete')) {
      override.requestOverride('wash.delete', `Eliminare il lavaggio di ${customerName}: azione irreversibile.`)
      if (!override.hasOverride('wash.delete')) return
    }
    try {
      // Try to delete from Google Calendar
      try {
        await fetch('/.netlify/functions/delete-calendar-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: bookingId,
            customerName: customerName,
            vehicleName: 'Car Wash'
          }),
        })
        logger.log('Google Calendar event deletion requested for booking:', bookingId)
      } catch (calError) {
        logger.warn('Failed to delete from Google Calendar:', calError)
      }

      // Cascade: drop the shadow rental row that blocks the supercar so
      // the car frees up the moment the carwash booking is deleted.
      try {
        const parent = bookings.find(b => b.id === bookingId)
        const shadowId = await findSupercarShadowBookingId(bookingId, parent?.booking_details)
        if (shadowId) {
          await supabase.from('bookings').delete().eq('id', shadowId)
          logger.log('[Supercar Experience] Cascaded delete of shadow rental', shadowId)
        }
      } catch (cascadeErr) {
        console.error('[Supercar Experience] cascade-delete failed:', cascadeErr)
      }

      // Delete dependent records first (FK constraints)
      await supabase.from('contracts').delete().eq('booking_id', bookingId)
      await supabase.from('fatture').delete().eq('booking_id', bookingId)
      await supabase.from('cauzioni').delete().eq('riferimento_contratto_id', bookingId)

      // Delete from database
      const { error } = await supabase
        .from('bookings')
        .delete()
        .eq('id', bookingId)

      if (error) throw error

      toast.success('Prenotazione eliminata')
      {
        const bk = bookings.find(b => b.id === bookingId)
        logAdminAction('delete_carwash', 'carwash_booking', bookingId, {
          ...buildCarWashContext(bk),
          customer: bk?.customer_name || customerName,
        })
      }
      loadData()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('Failed to delete booking:', error)
      toast.error(`Errore durante l'eliminazione: ${_errMsg}`)
    }
  }

  async function handleResendPaymentLink(booking: CarWashBooking) {
    const custPhone = booking.customer_phone || booking.booking_details?.customer?.phone
    const custName = booking.customer_name || 'Cliente'
    const custEmail = booking.customer_email || booking.booking_details?.customer?.email || ''
    const totalEur = ((booking.price_total || 0) / 100).toFixed(2)
    const serviceNames = booking.service_name || 'Lavaggio'

    const toastId = toast.loading('Generazione nuovo link di pagamento...')

    try {
      // Generate a NEW Nexi payment link (old one may be expired)
      const linkRes = await fetch('/.netlify/functions/nexi-pay-by-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          amount: (booking.price_total || 0) / 100,
          customerEmail: custEmail,
          customerName: custName,
          description: `Lavaggio DR7 - ${serviceNames}`,
          expirationHours: 1
        })
      })
      const linkData = await linkRes.json()

      if (!linkRes.ok || !linkData.paymentUrl) {
        toast.error('Errore generazione link: ' + (linkData.error || 'Errore'), { id: toastId })
        return
      }

      // Send via WhatsApp if phone available
      if (custPhone) {
        const waResp = await fetch('/.netlify/functions/send-whatsapp-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customPhone: custPhone,
            // BUG FIX 2026-05-13: era hardcoded 'pro_richiesta_pagamento' →
            // bypassava il routing handled_events e i template Prime Wash
            // custom (es. "Link pagamento lavaggi") venivano ignorati. Adesso
            // usiamo la legacy event key e passiamo il booking così il
            // resolver sceglie via service_type ranking.
            templateKey: 'payment_link_customer',
            booking: { service_type: (booking as unknown as { service_type?: string })?.service_type || 'car_wash' },
            templateVars: (() => {
              const amtStr = String(totalEur)
              const firstName = (custName || '').split(' ')[0] || 'Cliente'
              const bookingRef = (booking.id || '').substring(0, 8).toUpperCase() || 'N/A'
              // Pass firstName as both customer_name AND nome so the alias loop
              // in send-whatsapp-notification doesn't overwrite {nome} with
              // the full name (incident 2026-05-13). Include booking_id so
              // the template's "DR7-{booking_id}" placeholder resolves.
              return {
                '{customer_name}': firstName,
                '{nome}': firstName,
                '{booking_id}': bookingRef,
                '{booking_ref}': bookingRef,
                '{amount}': amtStr,
                '{total}': amtStr,
                '{importo}': amtStr,
                '{link}': linkData.paymentUrl,
                '{payment_link}': linkData.paymentUrl,
                '{expiry}': '1 ora',
              }
            })(),
            skipHeader: true,
          })
        })
        const waResult = await waResp.json().catch(() => ({}))
        if (!waResp.ok || waResult?.skipped) {
          toast.error('Nessun template configurato in Messaggi di Sistema Pro per "Invio link pagamento" (Prime Wash). Apri il tuo template "Link pagamento lavaggi", verifica che sia ATTIVO, abbia un testo, abbia "Quando si invia il link di pagamento al cliente" tra gli eventi gestiti, e Tipo servizio = Prime Wash.', { id: toastId, duration: 12000 })
        } else {
          toast.success('Nuovo link generato e inviato via WhatsApp!', { id: toastId })
        }
      } else {
        // Best-effort clipboard copy; Safari/iOS may deny after the preceding
        // await. Always show the URL in the toast so admin can copy manually.
        try { await navigator.clipboard.writeText(linkData.paymentUrl) } catch { /* clipboard blocked */ }
        toast.success(`Nuovo link generato: ${linkData.paymentUrl}`, { id: toastId, duration: 10000 })
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      toast.error('Errore: ' + errMsg, { id: toastId })
    }
  }

  const [generatingInvoice, setGeneratingInvoice] = useState(false)

  async function handleGenerateInvoice(booking: CarWashBooking) {
    if (!booking.id) {
      toast.error('ID prenotazione mancante')
      return
    }

    // Never generate fattura for unpaid bookings
    const ps = booking.payment_status
    if (ps !== 'paid' && ps !== 'completed' && ps !== 'succeeded') {
      toast.error(`Impossibile generare fattura: il lavaggio non è stato pagato (stato: ${ps || 'N/A'})`)
      return
    }

    // Don't generate fattura if the chosen payment method has
    // auto_invoice=false in Centralina Pro > Fiscale. Source of truth =
    // centralina_pro_config.fiscale.payment_methods (admin-managed).
    const pm = booking.payment_method || ''
    if (!(await paymentMethodAutoInvoice(pm))) {
      toast.error(`Fattura non prevista per pagamenti con "${pm}" (impostazione Centralina > Fiscale).`)
      return
    }

    if (generatingInvoice) {
      toast.error('Generazione fattura già in corso...')
      return
    }

    // Include IVA (22%) in invoice breakdown
    const includeIVA = true

    setGeneratingInvoice(true)
    toast.loading('Generazione fattura in corso...', { id: 'gen-invoice' })
    try {
      const response = await authFetch('/.netlify/functions/generate-invoice-from-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, includeIVA })
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any
      try {
        data = await response.json()
      } catch {
        toast.dismiss('gen-invoice')
        throw new Error(`Server ha risposto con status ${response.status} (risposta non valida)`)
      }

      if (!response.ok) {
        toast.dismiss('gen-invoice')
        if (data.invoiceNumber) {
          toast.error(`Fattura già esistente: ${data.invoiceNumber}. Vai alla tab "Fatture" per visualizzarla.`)
        } else {
          const errorMsg = data.message || data.error || 'Impossibile generare la fattura'
          const errorDetails = data.details ? `\n\nDettagli: ${data.details}` : ''
          const errorHint = data.hint ? `\n\nSuggerimento: ${data.hint}` : ''
          throw new Error(errorMsg + errorDetails + errorHint)
        }
        return
      }

      toast.dismiss('gen-invoice')
      // Generate and open the invoice PDF
      const invoiceId = data.invoice.id
      const pdfResponse = await authFetch('/.netlify/functions/generate-invoice-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId })
      })

      if (pdfResponse.ok) {
        const html = await pdfResponse.text()
        const blob = new Blob([html], { type: 'text/html' })
        const url = URL.createObjectURL(blob)
        const printWindow = window.open(url, '_blank')

        if (printWindow) {
          setTimeout(() => URL.revokeObjectURL(url), 3000)
          toast.success(`Fattura generata con successo! Numero: ${data.invoice.numero_fattura}`)
        } else {
          toast.success(`Fattura generata con successo! Numero: ${data.invoice.numero_fattura}. Vai alla tab "Fatture" per visualizzarla.`)
        }
      } else {
        toast.success(`Fattura generata con successo! Numero: ${data.invoice.numero_fattura}. Vai alla tab "Fatture" per visualizzarla.`)
      }

      logAdminAction('generate_carwash_fattura', 'carwash_booking', booking.id, {
        ...buildCarWashContext(booking),
        fattura_number: data?.invoice?.numero_fattura,
      })
      loadData()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      toast.dismiss('gen-invoice')
      console.error('Error generating invoice:', error)
      const errorMessage = _errMsg || ''

      // Check for validation errors (missing address/tax code)
      if (errorMessage.includes('obbligatorio') || errorMessage.includes('incomplete') || errorMessage.includes('required') || errorMessage.includes('missing')) {
        toast.error(`Dati cliente incompleti per la fattura: ${errorMessage}`, { duration: 8000 })
        let custId = booking.customer_id || booking.booking_details?.customer?.customerId || booking.user_id
        // Fallback: find customer by name/email
        if (!custId && booking.customer_name) {
          const match = customers.find(c =>
            (c.email && booking.customer_email && c.email === booking.customer_email) ||
            ((c.full_name || '').toLowerCase() === booking.customer_name.toLowerCase())
          )
          if (match) custId = match.id
        }
        if (custId) {
          openEditCustomer(custId)
        } else {
          toast.error('Cliente non trovato. Completa i dati manualmente dalla tab Clienti.', { duration: 8000 })
        }
        return
      }
      toast.error('Errore nella generazione della fattura: ' + errorMessage)
    } finally {
      setGeneratingInvoice(false)
    }
  }

  async function createBooking(forceBooking: boolean = false) {
    // Re-entry guard dedicato per l'INSERT: handleSubmit ha gia' il suo
    // lock per il flusso form, ma createBooking viene invocata anche dal
    // replay OTP (useEffect) e dal force=true. Senza questo guard, un
    // secondo click su 'Salva' durante l'OTP-pending puo' causare due
    // INSERT + due WhatsApp.
    if (createBookingLockRef.current) {
      logger.log('[createBooking] re-entry blocked: insert gia in corso')
      return
    }
    createBookingLockRef.current = true

    // Get customer details from selected customer. Fallback to a direct
    // Supabase lookup if the local customers[] array is stale (e.g., the
    // customer was just created via NewClientModal and the refresh
    // hasn't propagated yet).
    let customer = customers.find(c => c.id === formData.customer_id)
    if (!customer && formData.customer_id) {
      try {
        const { data: directCust } = await supabase
          .from('customers_extended')
          .select('id, nome, cognome, ragione_sociale, denominazione, tipo_cliente, email, telefono, telefono_secondario')
          .eq('id', formData.customer_id)
          .maybeSingle()
        if (directCust) {
          const fullName = directCust.tipo_cliente === 'azienda'
            ? (directCust.ragione_sociale || directCust.denominazione || 'Cliente')
            : `${directCust.nome || ''} ${directCust.cognome || ''}`.trim() || 'Cliente'
          customer = {
            id: directCust.id,
            full_name: fullName,
            email: directCust.email,
            phone: directCust.telefono || directCust.telefono_secondario,
          } as Customer
        }
      } catch (e) {
        logger.warn('[createBooking] direct customer fetch failed:', e)
      }
    }
    if (!customer) {
      createBookingLockRef.current = false
      toast.error('Cliente non trovato. Ricarica la pagina e riprova.')
      throw new Error('Cliente non trovato')
    }

    // Supercar Experience guard: block save until the operator picks the
    // car. The shadow rental row inserted at the end of this function
    // needs a vehicle_id, so this check has to happen before any side
    // effect (booking insert, fattura, payment link).
    if (supercarExperienceExtra && supercarExperienceOption && !experienceVehicle) {
      toast.error('Seleziona la supercar per il Supercar Experience prima di salvare.')
      createBookingLockRef.current = false
      return
    }

    // Test bookings (vehicle TEST*) bypassano TUTTI gli OTP: l'operatore QA
    // non deve ricevere conferme direzionali per i test interni.
    const currentVehicleIsTest = isTestVehicle(vehicleMakeModel, vehiclePlate)

    // ===== OTP GATE: Conferma Prenotazione Lavaggio (toggle Gestione OTP) =====
    // La prenotazione carwash entra di default in stato 'confirmed'. Se l'OTP
    // per quest'azione e' attivo (system_otp_overrides.is_required=true)
    // chiediamo OTP. useLimitationOverride bypassa server-side se il toggle e'
    // OFF, quindi quando off questa chiamata non blocca nulla.
    if (!currentVehicleIsTest && !override.hasOverride('prenotazione_lavaggio_conferma')) {
      pendingCreateBookingRef.current = { force: forceBooking }
      createBookingLockRef.current = false
      override.requestOverride('prenotazione_lavaggio_conferma', 'Conferma prenotazione lavaggio richiede autorizzazione direzionale')
      return
    }

    // ===== OTP GATE: Pagamento Carta Punti — convalida SEMPRE =====
    // Quando l'operatore segna 'Carta Punti' come metodo di pagamento, ogni
    // singola prenotazione richiede una conferma direzionale tramite OTP.
    // Differenza con `prenotazione_lavaggio_conferma`: qui consumiamo
    // l'override DOPO il salvataggio (più in basso), così la prossima
    // prenotazione Carta Punti chiede di nuovo l'OTP — niente caching
    // di sessione. Test bookings bypassano comunque.
    if (
      !currentVehicleIsTest
      && isCartaPunti(formData.payment_method)
      && !override.hasOverride('carta_punti_lavaggio')
    ) {
      pendingCreateBookingRef.current = { force: forceBooking }
      createBookingLockRef.current = false
      override.requestOverride(
        'carta_punti_lavaggio',
        'Pagamento Carta Punti richiede autorizzazione direzionale per ogni prenotazione'
      )
      return
    }

    // Validate customer has all required fields for fattura
    try {
      const custResp = await authFetch(`/.netlify/functions/get-customer?id=${formData.customer_id}`)
      if (custResp.ok) {
        const { customer: custData } = await custResp.json()
        if (custData) {
          const missing: string[] = []
          const isAzienda = custData.tipo_cliente === 'azienda'

          if (!custData.indirizzo) missing.push('Indirizzo')
          if (!custData.citta_residenza && !custData.citta) missing.push('Città')
          if (!custData.codice_postale) missing.push('CAP')

          if (isAzienda) {
            if (!custData.partita_iva && !custData.codice_fiscale) missing.push('Partita IVA')
          } else {
            if (!custData.nome) missing.push('Nome')
            if (!custData.cognome) missing.push('Cognome')
            if (!custData.codice_fiscale) missing.push('Codice Fiscale')
          }

          if (missing.length > 0) {
            toast.error(`Dati cliente incompleti per la fatturazione:\n${missing.join(', ')}\n\nCompletare il profilo cliente prima di prenotare.`)
            return
          }
        }
      }
    } catch (e) {
      logger.warn('Customer validation failed:', e)
    }

    const customerName = customer.full_name
    const customerEmail = customer.email || ''
    const customerPhone = customer.phone || ''

    // Create appointment datetime in Europe/Rome timezone
    const [year, month, day] = formData.appointment_date.split('-').map(Number)
    const [hours, minutes] = formData.appointment_time.split(':').map(Number)
    const appointmentDate = new Date(year, month - 1, day, hours, minutes, 0)

    // Validate appointment is not in the past
    if (appointmentDate < new Date()) {
      toast.error('La data e ora dell\'appuntamento non può essere nel passato.')
      return
    }
    const appointmentDateTime = appointmentDate.toISOString()

    // Total price: manual override or wizard selections
    const totalPrice = getFinalPrice()
    const serviceNames = buildServiceNames()

    // Build cart items for booking details (backward compatible format)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cartItems: any[] = []
    if (selectedService) {
      const servicePrice = selectedService.price_unit === 'custom'
        ? parseFloat(customPrice)
        : (selectedPriceOption?.price ?? selectedService.price)
      cartItems.push({
        serviceId: selectedService.id,
        serviceName: selectedService.name,
        quantity: 1,
        price: servicePrice,
        option: selectedPriceOption?.label || null,
        subtotal: servicePrice
      })
    }
    for (const extra of selectedExtras) {
      const ep = extraPriceOptions[extra.id]
      const qty = extraQuantities[extra.id] || 1
      const unitPrice = ep?.price ?? extra.price
      cartItems.push({
        serviceId: extra.id,
        serviceName: extra.name,
        quantity: qty,
        price: unitPrice,
        option: ep?.label || null,
        subtotal: unitPrice * qty
      })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bookingDetails: any = {
      notes: formData.notes,
      forceBooked: forceBooking,
      amountPaid: Math.round(parseFloat(formData.amount_paid) * 100),
      adminOverride: forceBooking,
      createdBy: 'admin_panel',
      cartItems: cartItems,
      totalDuration: getTotalDuration(),
      customer: { customerId: formData.customer_id },
      prime_flex: primeFlex,
      prime_flex_price: primeFlex ? PRIME_FLEX_PRICE : 0,
      // "Conferma Prenotazione" anche se Da Saldare — il calendario / lista
      // lo usano per non mostrare la riga in stato "in attesa pagamento".
      manual_confirmation: confirmBooking,
      ...(vehicleCategory && { vehicleCategory }),
      ...(vehicleMakeModel && { vehicleMakeModel }),
      ...(classificationSource && { classificationSource }),
      // Supercar Experience: chosen vehicle + window stored on the
      // carwash booking; the shadow rental row created below references
      // the carwash booking id back via parent_carwash_booking_id.
      ...(experienceVehicle && supercarExperienceWindow && supercarExperienceExtra && supercarExperienceOption ? {
        supercar_experience: {
          vehicle_id: experienceVehicle.id,
          vehicle_name: experienceVehicle.display_name,
          vehicle_plate: experienceVehicle.plate || null,
          duration_label: supercarExperienceOption.label,
          duration_minutes: supercarExperienceWindow.durationMin,
          window_start: `${supercarExperienceWindow.pickupDate}T${supercarExperienceWindow.pickupTime}:00`,
          window_end: `${supercarExperienceWindow.returnDate}T${supercarExperienceWindow.returnTime}:00`,
          service_id: supercarExperienceExtra.id,
          service_name: supercarExperienceExtra.name,
        },
      } : {}),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bookingPayload: any = {
      service_type: 'car_wash',
      service_name: serviceNames,
      vehicle_name: vehicleMakeModel || 'Car Wash Service',
      vehicle_plate: vehiclePlate || null,
      customer_name: customerName,
      customer_email: customerEmail || null,
      customer_phone: customerPhone || null,
      guest_name: customerName,
      guest_email: customerEmail || null,
      guest_phone: customerPhone || null,
      appointment_date: appointmentDateTime,
      appointment_time: formData.appointment_time,
      pickup_date: appointmentDateTime,
      dropoff_date: appointmentDateTime,
      pickup_location: 'DR7 Empire - Car Wash',
      dropoff_location: 'DR7 Empire - Car Wash',
      price_total: Math.round(totalPrice * 100),
      currency: 'EUR',
      // Pay by Link: pending status + Nexi method so cron auto-cancels after 1h
      status: (formData.payment_status === 'pending' && isNexiPayByLink(formData.payment_method)) ? 'pending' : (formData.payment_status === 'paid' ? 'confirmed' : 'confirmed'),
      payment_status: (formData.payment_status === 'pending' && isNexiPayByLink(formData.payment_method)) ? 'pending' : formData.payment_status,
      payment_method: formData.payment_method || null,
      booking_details: bookingDetails
    }

    logger.log('📤 Attempting to insert car wash booking:', JSON.stringify(bookingPayload, null, 2))

    const { data, error } = await supabase
      .from('bookings')
      .insert([bookingPayload])
      .select()
      .single()

    if (error) {
      console.error('❌ Supabase insert error:', error)
      throw error
    }
    // INSERT confermato dal DB: nessun altro Salva su questa form
    // puo' partire fino alla riapertura. Protegge anche da delay di
    // WhatsApp/Calendar che fanno scadere il cooldown 3s.
    formSubmittedRef.current = true

    logger.log('✅ Booking created successfully:', data)
    logAdminAction('create_carwash', 'carwash_booking', data.id, {
      ...buildCarWashContext(data),
      customer: data?.customer_name || customerName,
      service: serviceNames,
      payment_method: formData.payment_method,
      payment_status: formData.payment_status,
      amount: totalPrice,
    })

    // ─── Supercar Experience: shadow rental row ─────────────────────
    // Insert a row in `bookings` for the chosen supercar with
    // service_type='rental' so existing isVehicleAvailable checks (admin
    // calendar + website availability) treat the car as taken during the
    // experience window. The row links back to the parent carwash
    // booking via booking_details.parent_carwash_booking_id so cascade
    // edits / deletes can find it.
    if (experienceVehicle && supercarExperienceWindow && supercarExperienceExtra && supercarExperienceOption) {
      try {
        const startIso = `${supercarExperienceWindow.pickupDate}T${supercarExperienceWindow.pickupTime}:00+02:00`
        const endIso = `${supercarExperienceWindow.returnDate}T${supercarExperienceWindow.returnTime}:00+02:00`
        const shadowPayload = {
          service_type: 'rental',
          service_name: `${supercarExperienceExtra.name} (${supercarExperienceOption.label})`,
          vehicle_id: experienceVehicle.id,
          vehicle_name: experienceVehicle.display_name,
          vehicle_plate: experienceVehicle.plate || null,
          customer_name: customerName,
          customer_email: customerEmail || null,
          customer_phone: customerPhone || null,
          guest_name: customerName,
          guest_email: customerEmail || null,
          guest_phone: customerPhone || null,
          pickup_date: startIso,
          dropoff_date: endIso,
          pickup_location: 'DR7 Empire - Supercar Experience',
          dropoff_location: 'DR7 Empire - Supercar Experience',
          // Price 0: cost lives on the parent carwash booking; the shadow
          // row is purely for blocking. Status 'confirmed' so isVehicleAvailable
          // counts it (filter excludes cancelled/completed).
          price_total: 0,
          currency: 'EUR',
          status: 'confirmed',
          payment_status: 'paid',
          payment_method: 'Supercar Experience (Prime Wash)',
          booking_details: {
            is_supercar_experience_block: true,
            parent_carwash_booking_id: data.id,
            experience_label: supercarExperienceOption.label,
            experience_service_id: supercarExperienceExtra.id,
            experience_service_name: supercarExperienceExtra.name,
            duration_minutes: supercarExperienceWindow.durationMin,
            customer: { customerId: formData.customer_id },
            createdBy: 'admin_panel_supercar_experience',
          },
        }
        const { data: shadowRow, error: shadowErr } = await supabase
          .from('bookings')
          .insert([shadowPayload])
          .select('id')
          .single()
        if (shadowErr) {
          console.error('[CarWashBookingsTab] failed to insert supercar shadow rental:', shadowErr)
          toast.error(`Lavaggio creato ma blocco supercar fallito: ${shadowErr.message}`)
        } else {
          // Persist the shadow id on the parent so cascade edits can find it.
          await supabase.from('bookings').update({
            booking_details: {
              ...(data.booking_details || {}),
              ...((data.booking_details as Record<string, unknown> | null)?.supercar_experience as Record<string, unknown> | undefined ? {
                supercar_experience: {
                  ...((data.booking_details as { supercar_experience?: Record<string, unknown> }).supercar_experience as Record<string, unknown>),
                  shadow_booking_id: shadowRow.id,
                },
              } : {}),
            },
          }).eq('id', data.id)
          toast.success(`Supercar ${experienceVehicle.display_name} bloccata per ${supercarExperienceOption.label}`)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[CarWashBookingsTab] supercar shadow insert exception:', err)
        toast.error(`Errore blocco supercar: ${msg}`)
      }
    }

    // Generate fattura ONLY if paid AND if the payment method has
    // auto_invoice=true in Centralina Pro > Fiscale (admin-managed —
    // niente piu' liste hardcoded di metodi).
    const isPaid = formData.payment_status === 'paid' || formData.payment_status === 'completed' || formData.payment_status === 'succeeded'
    const skipFattura = !(await paymentMethodAutoInvoice(formData.payment_method))

    if (isPaid && !skipFattura) {
      try {
        const invoiceResponse = await authFetch('/.netlify/functions/generate-invoice-from-booking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: data.id, includeIVA: true })
        })
        if (invoiceResponse.ok) {
          const invoiceData = await invoiceResponse.json()
          logger.log('✅ Fattura created:', invoiceData.invoice?.numero_fattura)
        } else {
          const errData = await invoiceResponse.json().catch(() => ({}))
          const errMsg = errData.message || errData.error || invoiceResponse.statusText
          logger.warn('⚠️ Fattura generation failed:', errMsg)
          // Open customer edit modal if missing data (address/codice fiscale)
          if (errMsg.includes('obbligatorio') || errMsg.includes('incomplete') || errMsg.includes('missing')) {
            toast.error(`Dati cliente incompleti per la fattura. Completa i dati.`, { duration: 8000 })
            openEditCustomer(formData.customer_id)
          } else {
            toast.error(`Fattura non generata: ${errMsg}`, { duration: 8000 })
          }
        }
      } catch (invoiceError) {
        console.error('⚠️ Failed to generate fattura:', invoiceError)
      }
    }

    // Handle Nexi Pay by Link
    const isNexiPending = formData.payment_status === 'pending' && isNexiPayByLink(formData.payment_method)
    if (isNexiPending && data) {
      try {
        const linkRes = await authFetch('/.netlify/functions/nexi-pay-by-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: data.id,
            amount: totalPrice,
            customerEmail: customerEmail || '',
            customerName: customerName || 'Cliente',
            description: `Lavaggio DR7 - ${serviceNames}`,
            expirationHours: 1
          })
        })
        const linkData = await linkRes.json()
        if (linkRes.ok && linkData.paymentUrl) {
          // Save payment link to booking_details so calendar shows orange
          await supabase.from('bookings').update({
            booking_details: {
              ...data.booking_details,
              nexi_payment_link: linkData.paymentUrl,
              nexi_order_id: linkData.orderId || null,
              payment_link_created_at: new Date().toISOString(),
              payment_link_expires_at: linkData.expiresAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            }
          }).eq('id', data.id)

          if (customerPhone) {
            const amountStr = totalPrice.toFixed(2)
            const bookingRef = (data?.id || '').substring(0, 8).toUpperCase() || 'N/A'
            const firstName = customerName?.split(' ')[0] || 'Cliente'
            // Cerca il service_type del booking appena creato così il
            // resolver può scegliere il template Prime Wash giusto.
            const newBookingSvc = (data as { service_type?: string } | null)?.service_type || 'car_wash'
            const waResp = await fetch('/.netlify/functions/send-whatsapp-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                customPhone: customerPhone,
                // BUG FIX 2026-05-13: era hardcoded 'pro_richiesta_pagamento' →
                // bypassava handled_events. Adesso legacy key + booking
                // service_type così il resolver sceglie il custom Prime
                // Wash via service-type ranking.
                templateKey: 'payment_link_customer',
                booking: { service_type: newBookingSvc },
                // Alias every placeholder the Pro template might use so
                // nothing leaks as raw "{...}" text to the customer.
                templateVars: {
                  // Both customer_name and nome get firstName so the alias
                  // propagation in send-whatsapp doesn't overwrite {nome}
                  // with the full name (incident 2026-05-13).
                  customer_name: firstName,
                  nome: firstName,
                  amount: amountStr,
                  total: amountStr,
                  importo: amountStr,
                  totale: amountStr,
                  link: linkData.paymentUrl,
                  payment_link: linkData.paymentUrl,
                  booking_id: bookingRef,
                  booking_ref: bookingRef,
                  expiry: '1 ora',
                },
                skipHeader: true,
              })
            })
            const waResult = await waResp.json().catch(() => ({}))
            if (!waResp.ok || waResult?.skipped) {
              toast.error('Nessun template configurato in Messaggi di Sistema Pro per "Invio link pagamento" (Prime Wash). Verifica il template "Link pagamento lavaggi": ATTIVO, body non vuoto, evento "Quando si invia il link di pagamento al cliente" spuntato, Tipo servizio = Prime Wash.', { duration: 12000 })
            }
          }
          toast.success('Pay by Link generato e inviato al cliente!')
        } else {
          toast.error('Errore generazione Pay by Link: ' + (linkData.error || 'Errore'))
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (linkErr: any) {
        toast.error('Errore Pay by Link: ' + linkErr.message)
      }
    }

    // Send WhatsApp notification
    try {
      const paymentStatus = isNexiPending ? 'unpaid' : (formData.payment_status || 'unpaid')
      const amountPaid = paymentStatus === 'paid' ? totalPrice * 100 : 0

      // Send admin notification (detailed internal format)
      await fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Opt-in: resolves to centralina_pro_config admin_whatsapp_phone
          // server-side. Without this flag the sender skips (no recipient).
          notifyAdmin: true,
          booking: {
            id: data.id || '',
            service_type: 'car_wash',
            service_name: serviceNames,
            customer_name: customerName,
            customer_email: customerEmail,
            customer_phone: customerPhone,
            vehicle_plate: vehiclePlate || null,
            appointment_date: appointmentDateTime,
            price_total: totalPrice * 100,
            payment_status: paymentStatus,
            booking_details: {
              serviceName: serviceNames,
              amountPaid: amountPaid,
              notes: formData.notes || ''
            }
          }
        })
      })

      // Send customer confirmation message (skip for Nexi — link message sent
      // separately). Stesso pattern di ReservationsTab: se la prenotazione e'
      // "Da Saldare" e l'admin NON ha spuntato "Conferma Prenotazione",
      // salta il messaggio (lo manderemo quando segnera' pagato). Se invece
      // la spunta e' attiva, manda comunque il template — il body usa
      // {payment_status} per mostrare "Da saldare" al cliente.
      const isPendingNotConfirmed =
        !confirmBooking
        && formData.payment_status !== 'paid'
        && formData.payment_status !== 'completed'
        && formData.payment_status !== 'succeeded'
      if (customerPhone && !isNexiPending && !isPendingNotConfirmed) {
        const custFirstName = customerName?.split(' ')[0] || 'Cliente'
        const apptDt = new Date(appointmentDateTime)
        // Short date — the Pro "Conferma Lavaggio" body uses "24/04/2026"
        // style, not the long "sabato 24 aprile 2026" form.
        const fmtDateShort = apptDt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' })
        const fmtDateLong = apptDt.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' })
        const fmtTime = apptDt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' })
        const totalEur = totalPrice.toFixed(2)
        const paymentInfoLabel = paymentStatus === 'paid' || paymentStatus === 'succeeded' || paymentStatus === 'completed'
          ? 'Pagato'
          : paymentStatus === 'pending'
            ? 'Da saldare'
            : (paymentStatus || '—')

        // service_type del booking corrente (può essere car_wash o mechanical).
        // Serve al resolver per scegliere il template Prime Wash custom giusto.
        const confSvc = (data as unknown as { service_type?: string })?.service_type || 'car_wash'
        // Conferma Prenotazione spuntata + payment_status ancora pending =>
        // evento dedicato "booking_confirmed_da_saldare" (instrada al
        // template "Prenotazione Da Saldare Confermata", separato dalla
        // conferma lavaggio standard).
        const isPendingPayment = paymentStatus !== 'paid' && paymentStatus !== 'completed' && paymentStatus !== 'succeeded'
        const eventKey = (confirmBooking && isPendingPayment)
          ? 'booking_confirmed_da_saldare'
          : (confSvc === 'mechanical' || confSvc === 'mechanical_service'
              ? 'mechanical_new_customer'
              : 'carwash_new_customer')
        const waResp = await fetch('/.netlify/functions/send-whatsapp-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customPhone: customerPhone,
            // BUG FIX 2026-05-13: era hardcoded 'pro_conferma_lavaggio' →
            // bypassava handled_events. Adesso legacy event key derivata
            // dal service_type, così il resolver instrada via
            // handled_events + service-type ranking. Custom Prime Wash
            // templates vincono sul canonical.
            templateKey: eventKey,
            booking: { service_type: confSvc },
            // Alias every placeholder name the Pro template might use —
            // English (service_name, appointment_date, ...), Italian
            // (servizio, data, ora, targa, pagamento), and short aliases
            // (date, time). Any of these the body references will resolve;
            // the ones it doesn't reference are simply ignored by the renderer.
            templateVars: {
              // Customer
              customer_name: custFirstName,
              nome: custFirstName,
              // Service
              service_name: serviceNames,
              servizio: serviceNames,
              // Date/time (short + long + aliases)
              appointment_date: fmtDateShort,
              appointment_time: fmtTime,
              date: fmtDateShort,
              time: fmtTime,
              data: fmtDateShort,
              ora: fmtTime,
              data_lunga: fmtDateLong,
              // Totals
              total: totalEur,
              totale: totalEur,
              amount: totalEur,
              importo: totalEur,
              // Vehicle
              vehicle_plate: vehiclePlate || '',
              targa: vehiclePlate || '',
              plate: vehiclePlate || '',
              // Payment status label
              payment_info: paymentInfoLabel,
              payment_status: paymentInfoLabel,
              pagamento: paymentInfoLabel,
              // Booking id
              booking_id: (data?.id || '').substring(0, 8).toUpperCase(),
              booking_ref: (data?.id || '').substring(0, 8).toUpperCase(),
              // Notes
              notes: formData.notes || '',
              note: formData.notes || '',
            },
            skipHeader: true,
          })
        })
        const waResult = await waResp.json().catch(() => ({}))
        if (!waResp.ok || waResult?.skipped) {
          toast.error('Template mancante in Messaggi di Sistema Pro: pro_conferma_lavaggio')
        } else {
          logger.log('✅ WhatsApp customer confirmation sent to', customerPhone)
        }
      }
    } catch (whatsappError) {
      console.error('⚠️ WhatsApp notification failed:', whatsappError)
    }

    // DR7 Privilege — fire-and-forget AFTER the conferma lavaggio so the
    // privilege code lands on WhatsApp after the booking confirmation, not
    // before. Backend is idempotent (dr7_privilege_sent_at).
    if (isPaid && data?.id) {
      authFetch('/.netlify/functions/trigger-dr7-privilege', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: data.id, kind: 'lavaggio' }),
      }).catch(() => { /* non-blocking */ })
    }

    // Add to Google Calendar
    try {
      const durationMinutes = getTotalDuration()
      const endDate = new Date(year, month - 1, day, hours, minutes + durationMinutes, 0)
      const endDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const endTimeStr = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`

      await fetch('/.netlify/functions/create-calendar-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleName: `🧼 ${serviceNames}${vehicleMakeModel ? ` - ${vehicleMakeModel}` : ''}${vehiclePlate ? ` [${vehiclePlate}]` : ''}`,
          customerName,
          customerEmail,
          customerPhone,
          pickupDate: formData.appointment_date,
          pickupTime: formData.appointment_time,
          returnDate: endDateStr,
          returnTime: endTimeStr,
          pickupLocation: 'DR7 Empire - Car Wash',
          returnLocation: 'DR7 Empire - Car Wash',
          totalPrice: totalPrice,
          bookingId: data.id
        })
      })
    } catch (calendarError) {
      console.error('⚠️ Failed to create Google Calendar event:', calendarError)
    }

    // Success — UI updates automatically
    setShowForm(false)
    resetWizard()
    loadData()

    // Carta Punti: consuma l'override così la PROSSIMA prenotazione con
    // questo metodo di pagamento richiede un nuovo OTP. Per gli altri
    // metodi non c'è nulla da consumare.
    if (isCartaPunti(formData.payment_method)) {
      try { await override.consumeOverride('carta_punti_lavaggio') } catch (e) {
        logger.warn('[carta_punti] consumeOverride failed:', e)
      }
    }

    // Mantieni il lock attivo per 3 secondi DOPO il successo: copre la
    // finestra tra setShowForm(false) (state async) e il re-render del
    // DOM senza la form. Senza questo delay un click rapido sul pulsante
    // ancora visibile creava una seconda prenotazione.
    setTimeout(() => { createBookingLockRef.current = false }, 3000)
  }

  // Helper function to check if two time ranges overlap
  function checkTimeOverlap(
    start1: string, duration1Minutes: number,
    start2: string, duration2Minutes: number
  ): boolean {
    // Parse time strings (HH:MM format)
    const [h1, m1] = start1.split(':').map(Number)
    const [h2, m2] = start2.split(':').map(Number)

    const start1Minutes = h1 * 60 + m1
    const end1Minutes = start1Minutes + duration1Minutes
    const start2Minutes = h2 * 60 + m2
    const end2Minutes = start2Minutes + duration2Minutes

    // Check if ranges overlap
    return start1Minutes < end2Minutes && end1Minutes > start2Minutes
  }

  async function handleSubmit() {
    // Sync ref guard prima del setSubmitting (state e' async).
    if (submitLockRef.current || submitting || formSubmittedRef.current) return
    submitLockRef.current = true
    // flushSync forza React a renderizzare il pulsante come disabled
    // IMMEDIATAMENTE (sync). Senza, React 18 batcha lo state update e
    // lascia il pulsante cliccabile per qualche ms — abbastanza per
    // intercettare un secondo click rapido.
    flushSync(() => setSubmitting(true))

    try {
      if (!selectedService) {
        toast.error('Seleziona almeno un servizio')
        setSubmitting(false)
        return
      }

      if (!formData.customer_id) {
        toast.error('Seleziona un cliente')
        setSubmitting(false)
        return
      }

      if (!formData.appointment_time) {
        toast.error('Seleziona un orario')
        setSubmitting(false)
        return
      }

      const totalDuration = getTotalDuration()
      const serviceNames = buildServiceNames()

      // ===== SCHEDULING RULES VALIDATION =====
      // Enforce non-negotiable scheduling rules for WASH events
      logger.log('🔍 Validating scheduling rules for wash booking...')
      logger.log(`  Services: ${serviceNames}`)
      logger.log(`  Date: ${formData.appointment_date}`)
      logger.log(`  Time: ${formData.appointment_time}`)
      logger.log(`  Total Duration: ${totalDuration} min`)

      // Create wash event datetime
      const [year, month, day] = formData.appointment_date.split('-').map(Number)
      const [hours, minutes] = formData.appointment_time.split(':').map(Number)
      const washDateTime = new Date(year, month - 1, day, hours, minutes, 0)

      const washEvent = {
        type: 'WASH' as const,
        dateTime: washDateTime,
        vehicleName: serviceNames,
        durationMinutes: totalDuration
      }

      const schedulingValidation = await validateScheduling(washEvent)

      if (!schedulingValidation.isValid) {
        console.error('❌ Scheduling validation failed:', schedulingValidation.errors)

        // Build error message
        let errorMessage = '🚫 CONFLITTO DI PROGRAMMAZIONE\n\n'
        errorMessage += 'La prenotazione lavaggio viola le regole di programmazione obbligatorie:\n\n'

        schedulingValidation.errors.forEach((error, index) => {
          errorMessage += `${index + 1}. ${error.message}\n\n`
        })

        errorMessage += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'
        errorMessage += '📋 REGOLE DI PROGRAMMAZIONE:\n\n'
        errorMessage += '• LAVAGGIO + RICONSEGNA → Gap minimo 30 minuti\n'
        errorMessage += '• LAVAGGIO + RITIRO → Gap minimo 15 minuti\n'
        errorMessage += '• LAVAGGIO + LAVAGGIO → Nessun evento simultaneo\n\n'

        // Add suggested slots if available
        if (schedulingValidation.suggestedSlots && schedulingValidation.suggestedSlots.length > 0) {
          errorMessage += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'
          errorMessage += '✅ ORARI DISPONIBILI SUGGERITI:\n\n'
          schedulingValidation.suggestedSlots.slice(0, 3).forEach((slot, index) => {
            const slotDate = new Date(slot)
            errorMessage += `${index + 1}. ${slotDate.toLocaleDateString('it-IT')} alle ${slotDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}\n`
          })
          errorMessage += '\n'
        }

        errorMessage += 'Modifica l\'orario per rispettare le regole di programmazione.'

        toast.error(errorMessage, { duration: 8000 })
        setSubmitting(false)
        return
      }

      logger.log('✅ Scheduling validation passed')

      // ADMIN PANEL: Always allow bookings, just show warning if there's a conflict
      logger.log('🔧 ADMIN PANEL: Checking for conflicts (informational only)')

      const newBookingDuration = totalDuration

      // Check if there's already a booking that overlaps with this time slot (informational only)
      const { data: existingBookings, error: checkError } = await supabase
        .from('bookings')
        .select('id, customer_name, appointment_date, appointment_time, service_name, booking_details')
        .eq('service_type', 'car_wash')
        .not('status', 'in', '(cancelled,annullata,expired)')
        .gte('appointment_date', formData.appointment_date)
        .lte('appointment_date', `${formData.appointment_date}T23:59:59`)

      if (checkError) {
        console.error('Error checking existing bookings:', checkError)
      }

      // Check if there's a time conflict considering service durations
      let hasConflict = false
      let conflictingBooking = null
      let conflictDetails = ''

      // Filter out "Lavaggio Rientro" — internal return washes don't count as conflicts
      const realBookings = (existingBookings || []).filter(b => b.customer_name !== 'Lavaggio Rientro')
      if (realBookings.length > 0) {
        for (const booking of realBookings) {
          const bookingTime = booking.appointment_time || new Date(booking.appointment_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false })

          // Get the service duration of the existing booking
          const existingService = carWashServices.find(s => s.name === booking.service_name)
          const existingDuration = existingService?.durationMinutes || 60 // Default to 1 hour if not found

          // Check if time ranges overlap
          if (checkTimeOverlap(formData.appointment_time, newBookingDuration, bookingTime, existingDuration as number)) {
            hasConflict = true
            conflictingBooking = booking
            const endTime = bookingTime.split(':').map(Number)
            const endMinutes = endTime[0] * 60 + endTime[1] + existingDuration
            const endHour = Math.floor(endMinutes / 60)
            const endMin = endMinutes % 60
            conflictDetails = `${bookingTime} - ${endHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}`
            break
          }
        }
      }

      // Regola di business: NON si possono avere due lavaggi nello
      // stesso slot. Se il check ha trovato un conflitto, blocchiamo
      // con un messaggio chiaro all'operatore. L'admin doveva non poter
      // ignorare il conflitto: prima il codice loggava e proseguiva,
      // creando appuntamenti sovrapposti (caso reale verificato).
      if (hasConflict && conflictingBooking) {
        logger.warn('Conflitto orario lavaggio:', conflictingBooking.customer_name, conflictDetails)
        toast.error(
          `Slot occupato — ${conflictingBooking.customer_name || 'altro cliente'} ha gia' un appuntamento ${conflictDetails}. ` +
          `Scegli un orario diverso o sposta l'altra prenotazione.`,
          { duration: 7000 }
        )
        return
      }

      // Nessun conflitto: procediamo con la creazione (force=true per
      // bypassare i check backend visto che li abbiamo gia' validati qui).
      logger.log('ADMIN PANEL: Creating booking with admin override (no conflict)')
      await createBooking(true)
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('Failed to create booking:', error)

      // Handle any remaining errors in Italian
      const errorMessage = _errMsg || ''

      // If it's a conflict error even after admin override, show more details
      if (errorMessage.includes('Car wash slot already booked') ||
        errorMessage.includes('already booked') ||
        errorMessage.includes('Slot già occupato') ||
        errorMessage.includes('duplicate') ||
        errorMessage.includes('constraint')) {
        toast.error(
          `Impossibile creare la prenotazione. Dettaglio tecnico: ${errorMessage}. Possibile causa: Database constraint o trigger che blocca le doppie prenotazioni.`,
          { duration: 6000 }
        )
      } else {
        toast.error(`Errore nella creazione della prenotazione: ${errorMessage}`)
      }
    } finally {
      // Cooldown 3s: copre la finestra tra setShowForm(false) (state
      // async, non immediato) e il re-render senza la form. Un secondo
      // click su un pulsante ancora visibile creava un'altra prenotazione.
      setTimeout(() => {
        setSubmitting(false)
        submitLockRef.current = false
        createBookingLockRef.current = false
      }, 3000)
    }
  }

  // Snapshot inviato alla direzione con la richiesta OTP: la modal mostra
  // direttamente cliente/servizio/veicolo/data/totale così l'operatore vede
  // ESATTAMENTE cosa sta autorizzando senza dover aprire l'email.
  // Returns either a flat legacy dict OR the new structured shape
  // ({ customer, operation, diff, meta }). The modal + email both accept both.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const otpDetails = useMemo<any>(() => {
    const code = override.limitationState.limitationCode
    const fmtDateIt = (d: string) => {
      if (!d) return null
      const [y, mo, da] = d.split('-')
      return y && mo && da ? `${da}/${mo}/${y}` : d
    }
    const fmtEur = (n: number) => `€ ${n.toFixed(2)}`

    // Modifica di una prenotazione gia' esistente (paid/confirmed).
    // Fallback chain: pendingEditBookingRef (set right before requestOverride)
    // → editingBooking (modal open) → null. Senza questo fallback, se il
    // gate ri-fa fire dopo che il ref e' stato pulito (line ~201), la modal
    // OTP mostrava solo "Modifica prenotazione lavaggio" + "Data appuntamento"
    // perche' cadeva sul default formData/cust path con campi vuoti.
    if (code === 'paid_wash_modify') {
      const b = pendingEditBookingRef.current || editingBooking
      if (b) {
        const operatorEmail = typeof window !== 'undefined'
          ? (sessionStorage.getItem('admin-email') || null)
          : null
        const bookingRef = (b.id || '').substring(0, 8).toUpperCase() || null
        const apptDateStr = b.appointment_date
          ? fmtDateIt(String(b.appointment_date).split('T')[0])
          : null
        const totalEur = typeof b.price_total === 'number' ? fmtEur(b.price_total / 100) : null
        const amountPaid = typeof b.booking_details?.amountPaid === 'number'
          ? fmtEur(b.booking_details.amountPaid / 100)
          : null
        return {
          // Structured payload — il template email rende sezioni colorate
          customer: {
            Nome: b.customer_name || null,
            Email: b.customer_email || null,
            Telefono: b.customer_phone || null,
          },
          operation: {
            'Tipo operazione': 'Modifica prenotazione lavaggio (gia\' pagata o confermata)',
            'Riferimento': bookingRef ? `DR7-${bookingRef}` : null,
            Servizio: b.service_name || null,
            Veicolo: b.vehicle_name || null,
            Targa: b.vehicle_plate || null,
            'Data appuntamento': apptDateStr,
            Ora: b.appointment_time || null,
            'Importo totale': totalEur,
            'Acconto incassato': amountPaid,
            'Metodo pagamento': b.payment_method || null,
            'Stato pagamento': b.payment_status || null,
            'Stato prenotazione': b.status || null,
          },
          meta: {
            Operatore: operatorEmail,
            'Data richiesta': new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
          },
        } as unknown as Record<string, string | null | undefined>
      }
    }

    // Nuova prenotazione — gate `prenotazione_lavaggio_conferma`. Usiamo lo
    // stato corrente del wizard (cliente selezionato + servizio + veicolo +
    // data/ora + totale).
    const cust = customers.find(c => c.id === formData.customer_id)
    const serviceLabel = buildServiceNames()

    // Carta Punti — riusa la stessa snapshot del wizard ma flagga il
    // metodo di pagamento così la direzione capisce subito perché serve
    // l'OTP, e include ogni dettaglio operativo utile per autorizzare.
    if (code === 'carta_punti_lavaggio') {
      const categoryLabel = vehicleCategory === 'moto'
        ? 'Moto'
        : vehicleCategory === 'urban'
          ? 'Auto urban'
          : vehicleCategory === 'maxi'
            ? 'Auto maxi / SUV'
            : vehicleCategory === 'aziendali'
              ? 'Aziendale'
              : vehicleCategory || null
      const operatorEmail = typeof window !== 'undefined'
        ? (sessionStorage.getItem('admin-email') || null)
        : null
      const duration = getTotalDuration()
      return {
        Operazione: 'Pagamento Carta Punti (lavaggio)',
        'Metodo pagamento': 'Carta Punti',
        Cliente: cust?.full_name || null,
        Email: cust?.email || null,
        Telefono: cust?.phone || null,
        Servizio: serviceLabel || null,
        'Durata stimata': duration > 0 ? `${duration} min` : null,
        Veicolo: vehicleMakeModel || null,
        Targa: vehiclePlate || null,
        'Tipo veicolo': categoryLabel,
        'Data appuntamento': fmtDateIt(formData.appointment_date),
        'Ora appuntamento': formData.appointment_time || null,
        'Importo totale': getFinalPrice() > 0 ? fmtEur(getFinalPrice()) : null,
        'Stato pagamento': formData.payment_status || null,
        Note: formData.notes || null,
        Operatore: operatorEmail,
        'Data richiesta': new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      }
    }

    return {
      Operazione: editingBooking ? 'Modifica prenotazione lavaggio' : 'Nuova prenotazione lavaggio',
      Cliente: cust?.full_name || null,
      Email: cust?.email || null,
      Telefono: cust?.phone || null,
      Servizio: serviceLabel || null,
      Veicolo: vehicleMakeModel || null,
      'Data appuntamento': fmtDateIt(formData.appointment_date),
      Ora: formData.appointment_time || null,
      'Importo totale': getFinalPrice() > 0 ? fmtEur(getFinalPrice()) : null,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    override.limitationState.limitationCode,
    customers,
    formData.customer_id,
    formData.appointment_date,
    formData.appointment_time,
    selectedService,
    selectedPriceOption,
    selectedExtras,
    extraPriceOptions,
    extraQuantities,
    primeFlex,
    manualPrice,
    vehicleMakeModel,
    editingBooking,
  ])

  if (loading) {
    return <div className="text-center py-8 text-theme-text-muted">Loading...</div>
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Hero header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-theme-bg-secondary via-theme-bg-secondary to-theme-bg-tertiary rounded-2xl border border-theme-border p-5 lg:p-6">
        <div className="absolute -top-12 -right-12 w-56 h-56 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"/>
        <div className="absolute -bottom-12 -left-12 w-56 h-56 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"/>
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-cyan-500/10 border border-cyan-500/30 grid place-items-center flex-shrink-0">
              <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16l4-4m0 0l4 4m-4-4v9m11-9V8.5M6.5 8.5h11M3 8.5L4.07 6.36a2 2 0 011.79-1.11h12.28a2 2 0 011.79 1.11L21 8.5"/>
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-xl lg:text-2xl font-bold text-theme-text-primary leading-tight">Prenotazioni Prime Wash</h2>
              <p className="text-xs lg:text-sm text-theme-text-muted mt-0.5">Lavaggio · Meccanica · Detailing · Storico e calendario</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs px-2.5 py-1 rounded-full bg-theme-bg-tertiary border border-theme-border text-theme-text-muted whitespace-nowrap">
              {bookings.length} prenotazion{bookings.length !== 1 ? 'i' : 'e'}
            </span>
            <button
              onClick={() => {
                if (!showForm) {
                  resetWizard()
                  // Apertura fresh: il session lock dev'essere disarmato
                  // altrimenti il nuovo Salva non parte (residuo della
                  // sessione precedente).
                  formSubmittedRef.current = false
                }
                setShowForm(!showForm)
              }}
              className="px-4 py-2 bg-dr7-gold hover:bg-[#0A8FA3] text-white font-semibold rounded-full transition-colors text-sm shadow-lg shadow-dr7-gold/20"
            >
              {showForm ? 'Chiudi' : '+ Nuova Prenotazione'}
            </button>
          </div>
        </div>
      </div>

      {/* Sezione "Nuova Prenotazione Lavaggio" — visibile quando il wizard è attivo */}
      {showForm && (
        <div className="bg-theme-bg-secondary/50 rounded-2xl border border-theme-border p-4 lg:p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base lg:text-lg font-bold text-theme-text-primary">Nuova Prenotazione Lavaggio</h3>
              <p className="text-xs lg:text-sm text-theme-text-muted mt-0.5">Crea una nuova prenotazione in pochi semplici passaggi</p>
            </div>
          </div>
        </div>
      )}

      {/* Search Bar — nascosta durante la creazione di una nuova prenotazione
          (serve solo per cercare nello storico delle prenotazioni esistenti). */}
      {!showForm && (
        <div className="mb-4">
          <input
            type="text"
            placeholder="Cerca per codice, nome, email, telefono, targa o veicolo..."
            value={bookingSearchQuery}
            onChange={(e) => setBookingSearchQuery(e.target.value)}
            className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold"
          />
        </div>
      )}

      {/* Quick Edit Customer Modal */}
      <NewClientModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        initialData={customerToEdit}
        onClientCreated={() => {
          refreshCustomers()
        }}
      />

      {/* New Client Modal for Wizard Step 3 */}
      <NewClientModal
        isOpen={showNewClientModal}
        onClose={() => setShowNewClientModal(false)}
        onClientCreated={async (clientId) => {
          setFormData(prev => ({ ...prev, customer_id: clientId }))
          setShowNewClientModal(false)
          // Await the refresh — without await, clicking "Conferma" right
          // after creating the customer made createBooking throw
          // "Cliente non trovato" because the local customers[] hadn't
          // re-populated yet.
          await refreshCustomers()
        }}
      />

      {showForm && (
        <div className="bg-theme-bg-secondary rounded-2xl p-6 sm:p-8 border border-theme-border shadow-2xl mb-6">
          {/* Hero header — only visible on step 0 (matches the new design) */}
          {currentStep === 0 && (
            <div className="mb-6 pb-5 border-b border-theme-border">
              <h3 className="text-xl sm:text-2xl font-bold text-theme-text-primary">Nuova Prenotazione Lavaggio</h3>
              <p className="text-sm text-theme-text-muted mt-1">Crea una nuova prenotazione in pochi semplici passaggi.</p>
            </div>
          )}

          {/* Step Indicator — labels under sphere, green = current/done, ring on active */}
          <div className="flex items-center justify-center mb-8">
            {[
              { step: 0 as const, label: 'Veicolo', sub: 'Dati del veicolo' },
              { step: 1 as const, label: 'Servizio', sub: 'Scegli il lavaggio' },
              { step: 2 as const, label: 'Extra', sub: 'Servizi aggiuntivi' },
              { step: 3 as const, label: 'Conferma', sub: 'Riepilogo e prenota' }
            ].map(({ step, label, sub }, idx) => (
              <div key={step} className="flex items-center">
                <button
                  type="button"
                  onClick={() => { if (step < currentStep) setCurrentStep(step) }}
                  disabled={step > currentStep}
                  className={`flex flex-col items-center ${step <= currentStep ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <div className={`relative w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                    step === currentStep
                      ? 'bg-emerald-500 text-white ring-4 ring-emerald-500/25 shadow-lg shadow-emerald-500/30'
                      : step < currentStep
                        ? 'bg-emerald-500/80 text-white'
                        : 'bg-theme-bg-tertiary text-theme-text-muted border border-theme-border'
                  }`}>
                    {step < currentStep ? '✓' : step + 1}
                  </div>
                  <span className={`text-[11px] font-semibold mt-2 uppercase tracking-wide ${step <= currentStep ? 'text-theme-text-primary' : 'text-theme-text-muted'}`}>
                    {label}
                  </span>
                  <span className={`text-[10px] mt-0.5 hidden sm:block ${step <= currentStep ? 'text-theme-text-muted' : 'text-theme-text-muted/60'}`}>
                    {sub}
                  </span>
                </button>
                {idx < 3 && (
                  <div className={`w-12 sm:w-20 h-0.5 mx-2 mb-7 ${step < currentStep ? 'bg-emerald-500/60' : 'bg-theme-border'}`} />
                )}
              </div>
            ))}
          </div>

          {/* ===== STEP 0: Vehicle Identification ===== */}
          {currentStep === 0 && (
            <div className="space-y-5">
              {/* Card identificazione veicolo */}
              <div className="bg-theme-bg-tertiary/40 border border-theme-border rounded-2xl p-5 sm:p-6 space-y-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-lg font-bold text-theme-text-primary">Identificazione Veicolo</h3>
                    <p className="text-xs text-theme-text-muted mt-0.5">Inserisci la targa per identificare il veicolo.</p>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                    Riconoscimento automatico attivo
                  </span>
                </div>

                {/* Tipo Targa tabs — Italiana | Estera | Moto */}
                <div>
                  <label className="block text-[11px] uppercase tracking-wider font-semibold text-theme-text-muted mb-2">Tipo Targa</label>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { key: 'italiana', label: 'Italiana' },
                      { key: 'estera', label: 'Estera' },
                      { key: 'moto', label: 'Moto' },
                    ] as const).map(t => {
                      const active =
                        (t.key === 'moto' && vehicleCategory === 'moto') ||
                        (t.key === 'estera' && targaVehicleInfo?.brand === 'Targa Estera') ||
                        (t.key === 'italiana' && vehicleCategory !== 'moto' && targaVehicleInfo?.brand !== 'Targa Estera')
                      return (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => {
                            if (t.key === 'moto') {
                              setVehicleCategory(vehicleCategory === 'moto' ? null : 'moto')
                              setTargaVehicleInfo(vehicleCategory === 'moto' ? null : { brand: 'Moto', model: '' })
                            } else if (t.key === 'estera') {
                              setShowForeignPlateModal(true)
                            } else {
                              setVehicleCategory(null)
                              setTargaVehicleInfo(null)
                            }
                          }}
                          className={`px-4 py-3 rounded-xl font-semibold text-sm border transition-all ${
                            active
                              ? 'bg-emerald-500 text-white border-emerald-500 shadow-lg shadow-emerald-500/25'
                              : 'bg-theme-bg-primary text-theme-text-secondary border-theme-border hover:border-emerald-400/60 hover:text-theme-text-primary'
                          }`}
                        >
                          {t.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Targa input + Riconosci Veicolo */}
                <div>
                  <label className="block text-[11px] uppercase tracking-wider font-semibold text-theme-text-muted mb-2">Targa</label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="flex-1 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 13l1-3a4 4 0 014-3h8a4 4 0 014 3l1 3v5a1 1 0 01-1 1h-2a1 1 0 01-1-1v-1H7v1a1 1 0 01-1 1H4a1 1 0 01-1-1v-5z" /><circle cx="7" cy="15" r="1" fill="currentColor" /><circle cx="17" cy="15" r="1" fill="currentColor" /></svg>
                      </span>
                      <input
                        type="text"
                        value={vehiclePlate}
                        onChange={(e) => setVehiclePlate(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                        placeholder="Es. AB123CD"
                        className="w-full pl-11 pr-4 py-3.5 bg-theme-bg-primary border border-theme-border rounded-xl text-theme-text-primary font-mono text-base tracking-widest uppercase placeholder:text-theme-text-muted/60 placeholder:tracking-normal focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/20 transition-colors"
                        maxLength={10}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && vehiclePlate.length >= 5 && !lookingUpTarga) {
                            e.preventDefault()
                            handleTargaLookup()
                          }
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      data-targa-lookup
                      disabled={vehiclePlate.length < 5 || lookingUpTarga}
                      onClick={handleTargaLookup}
                      className={`px-6 py-3.5 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${
                        vehiclePlate.length < 5 || lookingUpTarga
                          ? 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed'
                          : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/25 active:scale-[0.98]'
                      }`}
                    >
                      {lookingUpTarga ? 'Ricerca...' : '⊛ Riconosci Veicolo'}
                    </button>
                  </div>
                </div>

                {/* "oppure" divider */}
                <div className="flex items-center gap-3 text-xs text-theme-text-muted">
                  <div className="flex-1 h-px bg-theme-border" />
                  <span className="uppercase tracking-wider">oppure</span>
                  <div className="flex-1 h-px bg-theme-border" />
                </div>

                {/* Seleziona dalla lista — mostra dropdown delle targhe gia\'
                    presenti nei bookings di Prime Wash. Auto-fill al click. */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowExistingPlatesList(v => !v)}
                    className="w-full px-4 py-3 rounded-xl border border-theme-border bg-theme-bg-primary text-theme-text-secondary font-medium text-sm hover:border-theme-text-secondary hover:text-theme-text-primary transition-colors flex items-center justify-between gap-2"
                  >
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>
                      Seleziona veicolo dalla lista
                    </span>
                    <svg className={`w-4 h-4 transition-transform ${showExistingPlatesList ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>

                  {showExistingPlatesList && (() => {
                    // Costruisco la lista unica di targhe dai bookings esistenti.
                    // I plates sono salvati in 4+ posti diversi: top-level
                    // vehicle_plate + booking_details.{vehicle_plate, targa,
                    // plate, vehicle.plate}. Controllo tutti per evitare buchi.
                    const seen = new Set<string>()
                    const uniqueByPlate = bookings
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      .map((b: any) => {
                        const bd = b.booking_details || {}
                        const rawPlate = b.vehicle_plate
                            || bd.vehicle_plate
                            || bd.targa
                            || bd.plate
                            || bd.vehicle?.plate
                            || bd.vehicle?.targa
                            || ''
                        const plate = String(rawPlate).toUpperCase().replace(/\s+/g, '').trim()
                        if (!plate || seen.has(plate)) return null
                        seen.add(plate)
                        return {
                            plate,
                            customerName: b.customer_name || bd.customer?.fullName || '',
                            makeModel: bd.vehicleMakeModel || bd.vehicle?.makeModel || bd.vehicle?.brand || b.vehicle_name || '',
                            lastDate: b.created_at || b.appointment_date || '',
                        }
                      })
                      .filter(Boolean) as { plate: string; customerName: string; makeModel: string; lastDate: string }[]

                    const q = existingPlatesSearch.toLowerCase().trim()
                    const filtered = q
                      ? uniqueByPlate.filter(v =>
                          v.plate.toLowerCase().includes(q) ||
                          v.customerName.toLowerCase().includes(q) ||
                          v.makeModel.toLowerCase().includes(q)
                        )
                      : uniqueByPlate

                    return (
                      <div className="absolute left-0 right-0 mt-1 z-20 bg-theme-bg-secondary border border-theme-border rounded-xl shadow-lg max-h-72 overflow-hidden flex flex-col">
                        <div className="p-2 border-b border-theme-border">
                          <input
                            type="text"
                            placeholder="Cerca per targa, cliente, modello..."
                            value={existingPlatesSearch}
                            onChange={(e) => setExistingPlatesSearch(e.target.value)}
                            autoFocus
                            className="w-full px-3 py-2 text-sm bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:border-dr7-gold"
                          />
                        </div>
                        <div className="flex-1 overflow-y-auto">
                          {filtered.length === 0 ? (
                            <div className="px-4 py-6 text-center text-xs text-theme-text-muted">
                              {q ? 'Nessuna corrispondenza.' : 'Nessuna targa nello storico Prime Wash.'}
                            </div>
                          ) : (
                            filtered.slice(0, 100).map((v, i) => (
                              <button
                                key={`${v.plate}-${i}`}
                                type="button"
                                onClick={() => {
                                  setVehiclePlate(v.plate)
                                  if (v.makeModel && !vehicleMakeModel) setVehicleMakeModel(v.makeModel)
                                  setShowExistingPlatesList(false)
                                  setExistingPlatesSearch('')
                                  // Riconoscimento automatico subito dopo selezione
                                  setTimeout(() => {
                                    const btn = document.querySelector<HTMLButtonElement>('button[data-targa-lookup]')
                                    if (btn) btn.click()
                                  }, 50)
                                }}
                                className="w-full px-3 py-2 text-left hover:bg-theme-bg-tertiary border-b border-theme-border/30 last:border-b-0 flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-dr7-gold text-sm">{v.plate}</span>
                                    {v.makeModel && (
                                      <span className="text-xs text-theme-text-secondary truncate">{v.makeModel}</span>
                                    )}
                                  </div>
                                  {v.customerName && (
                                    <div className="text-[11px] text-theme-text-muted truncate">{v.customerName}</div>
                                  )}
                                </div>
                                <svg className="w-3.5 h-3.5 text-theme-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                              </button>
                            ))
                          )}
                        </div>
                        <div className="px-3 py-1.5 text-[10px] text-theme-text-muted border-t border-theme-border flex justify-between">
                          <span>{filtered.length} targh{filtered.length === 1 ? 'a' : 'e'} {q ? 'filtrate' : 'totali'}</span>
                          <button type="button" onClick={() => setShowExistingPlatesList(false)} className="hover:text-theme-text-primary">Chiudi</button>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </div>

              {/* Targa lookup result card */}
              {targaVehicleInfo && (
                <div className="p-3 bg-dr7-gold/10 border border-dr7-gold/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-dr7-gold text-sm font-bold">Veicolo trovato</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
                    {targaVehicleInfo.brand && (
                      <div><span className="text-theme-text-muted">Marca:</span> <span className="text-theme-text-primary font-medium">{targaVehicleInfo.brand}</span></div>
                    )}
                    {targaVehicleInfo.model && (
                      <div><span className="text-theme-text-muted">Modello:</span> <span className="text-theme-text-primary font-medium">{targaVehicleInfo.model}</span></div>
                    )}
                    {targaVehicleInfo.year && (
                      <div><span className="text-theme-text-muted">Anno:</span> <span className="text-theme-text-primary">{targaVehicleInfo.year}</span></div>
                    )}
                    {targaVehicleInfo.fuel && (
                      <div><span className="text-theme-text-muted">Carburante:</span> <span className="text-theme-text-primary">{targaVehicleInfo.fuel}</span></div>
                    )}
                    {targaVehicleInfo.powerCV && (
                      <div><span className="text-theme-text-muted">Potenza:</span> <span className="text-theme-text-primary">{targaVehicleInfo.powerCV} CV</span></div>
                    )}
                  </div>
                </div>
              )}

              {/* Manual category selection when targa not found — requires OTP */}
              {!vehicleCategory && targaNotFound && !lookingUpTarga && (
                <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/10">
                  <p className="text-sm text-amber-300 mb-2 font-medium">Targa non trovata — richiedi autorizzazione per selezionare manualmente:</p>
                  {override.hasOverride('manual_category_carwash') ? (
                    <div>
                      <p className="text-sm text-green-400 mb-2">Autorizzazione concessa. Seleziona la categoria:</p>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => { setVehicleCategory('urban'); setClassificationSource('manual') }}
                          className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors">Urban</button>
                        <button type="button" onClick={() => { setVehicleCategory('maxi'); setClassificationSource('manual') }}
                          className="px-4 py-2 rounded-lg text-sm font-semibold bg-orange-600/20 text-orange-400 hover:bg-orange-600/30 transition-colors">Maxi</button>
                        <button type="button" onClick={() => { setVehicleCategory('moto'); setClassificationSource('manual') }}
                          className="px-4 py-2 rounded-lg text-sm font-semibold bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 transition-colors">Moto</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button"
                      onClick={() => override.requestOverride('manual_category_carwash', `Targa ${vehiclePlate} non trovata nel database. Autorizzazione necessaria per selezionare la categoria manualmente.`)}
                      className="px-4 py-2 rounded-lg text-sm font-semibold bg-dr7-gold text-white hover:bg-[#0A8FA3] transition-colors">
                      Richiedi autorizzazione
                    </button>
                  )}
                </div>
              )}

              {/* Classification Result (auto from targa) */}
              {vehicleCategory && (
                <div className={`p-4 rounded-lg border-2 ${
                  vehicleCategory === 'moto'
                    ? 'bg-purple-500/10 border-purple-500/30'
                    : vehicleCategory === 'urban'
                    ? 'bg-blue-500/10 border-blue-500/30'
                    : 'bg-orange-500/10 border-orange-500/30'
                }`}>
                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1.5 rounded-full text-sm font-bold ${
                      vehicleCategory === 'moto'
                        ? 'bg-purple-600 text-white'
                        : vehicleCategory === 'urban'
                        ? 'bg-blue-600 text-white'
                        : 'bg-orange-600 text-white'
                    }`}>
                      {vehicleCategory === 'moto' ? 'MOTO' : vehicleCategory === 'urban' ? 'URBAN' : 'MAXI'}
                    </span>
                    <span className="text-theme-text-primary font-medium">{vehicleCategory === 'moto' ? 'Moto / Scooter' : vehicleMakeModel}</span>
                  </div>
                </div>
              )}

              {/* Navigation */}
              <div className="flex justify-between items-center pt-5 border-t border-theme-border">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-theme-text-muted hover:text-theme-text-primary transition-colors text-sm"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  disabled={!targaVehicleInfo}
                  onClick={() => {
                    setSelectedService(null)
                    setSelectedPriceOption(null)
                    setSelectedExtras([])
                    setExtraPriceOptions({})
                    setExtraQuantities({})
                    setCustomPrice('')
                    setCurrentStep(1)
                  }}
                  className={`px-7 py-3 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${
                    targaVehicleInfo
                      ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/25 active:scale-[0.98]'
                      : 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed'
                  }`}
                >
                  Avanti →
                </button>
              </div>

              {/* Feature trust cards (visibili sullo step 0) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
                <div className="rounded-xl border border-theme-border bg-theme-bg-tertiary/30 p-4">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </div>
                  <h4 className="text-sm font-bold text-theme-text-primary">Riconoscimento Automatico</h4>
                  <p className="text-xs text-theme-text-muted mt-1">Inserisci la targa e recupereremo tutti i dati del veicolo in automatico.</p>
                </div>
                <div className="rounded-xl border border-theme-border bg-theme-bg-tertiary/30 p-4">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                  </div>
                  <h4 className="text-sm font-bold text-theme-text-primary">Sicuro e Veloce</h4>
                  <p className="text-xs text-theme-text-muted mt-1">I tuoi dati e quelli del cliente sono protetti. La prenotazione richiede pochi secondi.</p>
                </div>
                <div className="rounded-xl border border-theme-border bg-theme-bg-tertiary/30 p-4">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                  <h4 className="text-sm font-bold text-theme-text-primary">Storico Prenotazioni</h4>
                  <p className="text-xs text-theme-text-muted mt-1">Tutte le tue prenotazioni saranno salvate nello storico per consultazioni future.</p>
                </div>
              </div>
            </div>
          )}

          {/* ===== STEP 1: Service Selection ===== */}
          {currentStep === 1 && (
            <div className="space-y-4">
              {/* LAVAGGIO / MECCANICA toggle */}
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMainTab('lavaggio')
                    setSelectedService(null)
                    setSelectedPriceOption(null)
                    setSelectedExtras([])
                    setExtraPriceOptions({})
    setExtraQuantities({})
                    setCustomPrice('')
                  }}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
                    selectedMainTab === 'lavaggio'
                      ? 'bg-dr7-gold text-white border-dr7-gold'
                      : 'bg-theme-bg-tertiary text-theme-text-secondary border-theme-border hover:border-dr7-gold hover:text-dr7-gold'
                  }`}
                >
                  LAVAGGIO
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMainTab('meccanica')
                    setSelectedService(null)
                    setSelectedPriceOption(null)
                    setSelectedExtras([])
                    setExtraPriceOptions({})
    setExtraQuantities({})
                    setCustomPrice('')
                  }}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
                    selectedMainTab === 'meccanica'
                      ? 'bg-dr7-gold text-white border-dr7-gold'
                      : 'bg-theme-bg-tertiary text-theme-text-secondary border-theme-border hover:border-dr7-gold hover:text-dr7-gold'
                  }`}
                >
                  MECCANICA
                </button>
              </div>

              {/* Service Dropdown Selector */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Servizio</label>
                <select
                  value={selectedService?.id || ''}
                  onChange={(e) => {
                    const allServices = Object.values(servicesByCategory).flat()
                    const service = allServices.find(s => s.id === e.target.value) || null
                    setSelectedService(service)
                    setSelectedPriceOption(null)
                    setCustomPrice('')
                  }}
                  className="w-full appearance-none bg-theme-bg-tertiary text-theme-text-primary rounded-lg px-4 py-3 pr-10 border border-theme-border focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
                >
                  <option value="">Seleziona servizio...</option>
                  {Object.entries(servicesByCategory).map(([category, services]) => (
                    <optgroup key={category} label={categoryLabels[category] || category.toUpperCase()}>
                      {services.map(service => {
                        const sn = getServiceNum(service.name)
                        return (
                          <option key={service.id} value={service.id}>
                            {sn ? `${sn}. ` : ''}{service.name} - {service.price_unit === 'custom' ? `Da EUR ${service.price.toFixed(2)}` : `EUR ${service.price.toFixed(2)}`} ({service.duration})
                          </option>
                        )
                      })}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Price options (if service has variants) */}
              {selectedService?.price_options && selectedService.price_options.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Opzione prezzo</label>
                  <select
                    value={selectedPriceOption?.label || ''}
                    onChange={(e) => {
                      const opt = selectedService.price_options!.find(o => o.label === e.target.value) || null
                      setSelectedPriceOption(opt)
                    }}
                    className="w-full appearance-none bg-theme-bg-tertiary text-theme-text-primary rounded-lg px-4 py-3 pr-10 border border-theme-border focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
                  >
                    <option value="">Seleziona opzione...</option>
                    {selectedService.price_options.map(opt => (
                      <option key={opt.label} value={opt.label}>
                        {opt.label} - EUR {opt.price.toFixed(2)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Custom price input for services with price_unit === 'custom' */}
              {selectedService?.price_unit === 'custom' && (
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Prezzo (EUR) — Minimo €{selectedService.price.toFixed(2)}
                  </label>
                  <input
                    type="number"
                    min={selectedService.price}
                    step="0.01"
                    value={customPrice}
                    onChange={(e) => setCustomPrice(e.target.value)}
                    placeholder={`Minimo ${selectedService.price.toFixed(2)}`}
                    className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:border-dr7-gold focus:outline-none"
                  />
                  {customPrice && parseFloat(customPrice) < selectedService.price && (
                    <p className="text-red-400 text-sm mt-1">
                      Il prezzo deve essere almeno €{selectedService.price.toFixed(2)}
                    </p>
                  )}
                </div>
              )}

              {/* Category badge reminder */}
              {vehicleCategory && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-theme-text-muted">Categoria:</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                    vehicleCategory === 'moto' ? 'bg-purple-500/20 text-purple-400'
                      : vehicleCategory === 'urban' ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-orange-500/20 text-orange-400'
                  }`}>
                    {vehicleCategory === 'moto' ? 'MOTO' : vehicleCategory === 'urban' ? 'URBAN' : 'MAXI'}
                  </span>
                  {vehicleMakeModel && vehicleCategory !== 'moto' && (
                    <span className="text-theme-text-muted text-xs">({vehicleMakeModel})</span>
                  )}
                </div>
              )}

              {/* Avanti button */}
              <div className="flex justify-between items-center pt-4 border-t border-theme-border">
                <button
                  type="button"
                  onClick={() => setCurrentStep(0)}
                  className="px-4 py-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
                >
                  Indietro
                </button>
                <button
                  type="button"
                  disabled={
                    !selectedService ||
                    (selectedService.price_options && selectedService.price_options.length > 0 && !selectedPriceOption) ||
                    (selectedService?.price_unit === 'custom' && (!customPrice || parseFloat(customPrice) < selectedService.price))
                  }
                  onClick={() => setCurrentStep(2)}
                  className={`px-6 py-2 rounded-full font-semibold transition-colors ${
                    selectedService &&
                    (!selectedService.price_options?.length || selectedPriceOption) &&
                    !(selectedService.price_unit === 'custom' && (!customPrice || parseFloat(customPrice) < selectedService.price))
                      ? 'bg-dr7-gold hover:bg-[#0A8FA3] text-white'
                      : 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed'
                  }`}
                >
                  Avanti
                </button>
              </div>
            </div>
          )}

          {/* ===== STEP 2: Extras ===== */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-theme-text-primary">Servizi Extra (opzionale)</h3>

              {extraServices.length === 0 ? (
                <div className="p-4 bg-theme-bg-tertiary/50 rounded-lg text-center">
                  <p className="text-theme-text-muted text-sm mb-3">Nessun extra disponibile per {selectedMainTab === 'lavaggio' ? 'Lavaggio' : 'Meccanica'}</p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {extraServices.filter(e => e.id !== selectedService?.id).map(extra => {
                    const isToggled = selectedExtras.some(e => e.id === extra.id)
                    const hasPriceOptions = extra.price_options && extra.price_options.length > 0
                    const currentExtraOption = extraPriceOptions[extra.id]

                    return (
                      <div key={extra.id} className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (isToggled) {
                              setSelectedExtras(prev => prev.filter(e => e.id !== extra.id))
                              setExtraPriceOptions(prev => {
                                const next = { ...prev }
                                delete next[extra.id]
                                return next
                              })
                            } else if (!hasPriceOptions) {
                              setSelectedExtras(prev => [...prev, extra])
                            } else {
                              // For extras with price options, toggle on (user picks variant below)
                              setSelectedExtras(prev => [...prev, extra])
                            }
                          }}
                          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border flex items-center gap-2 ${
                            isToggled
                              ? 'bg-dr7-gold/20 border-dr7-gold text-dr7-gold'
                              : 'bg-theme-bg-tertiary border-theme-border text-theme-text-primary hover:border-dr7-gold'
                          }`}
                        >
                          <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
                            isToggled ? 'bg-dr7-gold border-dr7-gold text-white' : 'border-theme-text-muted'
                          }`}>
                            {isToggled && '✓'}
                          </span>
                          {extra.name}
                          {!hasPriceOptions && <span className="text-xs opacity-70">EUR {extra.price.toFixed(2)}</span>}
                        </button>
                        {/* Price option variants for this extra */}
                        {isToggled && hasPriceOptions && (
                          <div className="flex flex-wrap gap-1 ml-2">
                            {extra.price_options!.map(opt => (
                              <button
                                key={opt.label}
                                type="button"
                                onClick={() => {
                                  setExtraPriceOptions(prev => ({ ...prev, [extra.id]: opt }))
                                }}
                                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                                  currentExtraOption?.label === opt.label
                                    ? 'bg-dr7-gold text-white border-dr7-gold font-bold'
                                    : 'border-theme-border text-theme-text-secondary hover:border-dr7-gold'
                                }`}
                              >
                                {opt.label} EUR {opt.price}
                              </button>
                            ))}
                          </div>
                        )}
                        {/* Quantity selector for per-unit extras */}
                        {isToggled && extra.price_unit && (
                          <div className="flex items-center gap-2 ml-2">
                            <span className="text-xs text-theme-text-muted">{extra.price_unit}:</span>
                            <button
                              type="button"
                              onClick={() => setExtraQuantities(prev => ({ ...prev, [extra.id]: Math.max(1, (prev[extra.id] || 1) - 1) }))}
                              className="w-7 h-7 rounded-full border border-theme-border text-theme-text-primary hover:border-dr7-gold flex items-center justify-center text-sm"
                            >-</button>
                            <span className="text-sm font-bold text-theme-text-primary w-6 text-center">{extraQuantities[extra.id] || 1}</span>
                            <button
                              type="button"
                              onClick={() => setExtraQuantities(prev => ({ ...prev, [extra.id]: Math.min(10, (prev[extra.id] || 1) + 1) }))}
                              className="w-7 h-7 rounded-full border border-theme-border text-theme-text-primary hover:border-dr7-gold flex items-center justify-center text-sm"
                            >+</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Prime Flex */}
              <div className="border border-theme-border rounded-lg p-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={primeFlex}
                    onChange={(e) => setPrimeFlex(e.target.checked)}
                    className="w-5 h-5 rounded border-theme-border accent-dr7-gold"
                  />
                  <div>
                    <span className="text-sm font-semibold text-theme-text-primary">PRIME FLEX</span>
                    <span className="text-xs text-dr7-gold ml-2">+EUR {PRIME_FLEX_PRICE.toFixed(2)}</span>
                    <p className="text-xs text-theme-text-muted">Cancellazione gratuita — rimborso del 90% come credito DR7 Wallet</p>
                  </div>
                </label>
              </div>

              {/* ─── Supercar Experience picker (also rendered in step 3) ───
                  Visible the moment a Supercar/Icon Experience extra has a
                  duration option selected. If date+time aren't picked yet,
                  the operator can still pre-select the car; availability is
                  re-checked in step 3 against the actual appointment time. */}
              {supercarExperienceExtra && supercarExperienceOption && (
                <div className="rounded-xl border border-dr7-gold/40 bg-dr7-gold/5 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <h4 className="text-sm font-semibold text-dr7-gold">
                        Scegli la {experienceTier === 'hypercar' ? 'hypercar' : 'supercar'} per {supercarExperienceExtra.name}
                      </h4>
                      <p className="text-xs text-theme-text-muted mt-0.5">
                        Durata {supercarExperienceOption.label}
                        {supercarExperienceWindow
                          ? ` · finestra ${supercarExperienceWindow.pickupTime}–${supercarExperienceWindow.returnTime}`
                          : ' · imposta data e ora in step 3 per verificare la disponibilità'}
                      </p>
                    </div>
                    {experienceVehicle && (
                      <button
                        type="button"
                        onClick={() => setExperienceVehicle(null)}
                        className="text-xs text-theme-text-muted hover:text-theme-text-primary border border-theme-border rounded-full px-3 py-1"
                      >
                        Cambia veicolo
                      </button>
                    )}
                  </div>

                  {supercarFleet.length === 0 ? (
                    <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded p-3">
                      Nessun veicolo della flotta {experienceTierLabel} trovato. Apri <strong>Veicoli</strong>: ogni auto da mostrare qui deve avere
                      <code className="bg-theme-bg-tertiary px-1 mx-1 rounded">category</code>
                      = <code className="bg-theme-bg-tertiary px-1 rounded">{experienceTier === 'hypercar' ? 'hypercar' : 'exotic'}</code>
                      {' '}(o un nome che contiene "{experienceTier === 'hypercar' ? 'hyper' : 'supercar'}")
                      e stato diverso da <code className="bg-theme-bg-tertiary px-1 mx-1 rounded">retired</code>.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {supercarFleet.map(vehicle => {
                        const availabilityVehicle: AvailabilityVehicle = {
                          id: vehicle.id,
                          display_name: vehicle.display_name,
                          plate: vehicle.plate,
                          status: (vehicle.status === 'available' || vehicle.status === 'rented' || vehicle.status === 'maintenance' || vehicle.status === 'retired') ? vehicle.status : 'available',
                          daily_rate: vehicle.daily_rate,
                          category: (vehicle.category as AvailabilityVehicle['category']) || undefined,
                          metadata: vehicle.metadata as AvailabilityVehicle['metadata'],
                          created_at: '',
                          updated_at: '',
                        }
                        // If the appointment window isn't set yet, treat as
                        // available (provisional). Final availability is
                        // re-checked in step 3 once date+time are confirmed.
                        const result = supercarExperienceWindow
                          ? isVehicleAvailable(
                              availabilityVehicle,
                              supercarExperienceWindow.pickupDate,
                              supercarExperienceWindow.returnDate,
                              supercarExperienceWindow.pickupTime,
                              supercarExperienceWindow.returnTime,
                              supercarFleetBookings,
                            )
                          : { available: true }
                        const isAvailable = result.available
                        const isSelected = experienceVehicle?.id === vehicle.id
                        return (
                          <button
                            key={vehicle.id}
                            type="button"
                            disabled={!isAvailable && !isSelected}
                            onClick={() => setExperienceVehicle(vehicle)}
                            className={`text-left rounded-lg border p-3 transition-colors ${
                              isSelected
                                ? 'border-dr7-gold bg-dr7-gold/15'
                                : isAvailable
                                ? 'border-theme-border bg-theme-bg-tertiary hover:border-dr7-gold hover:bg-dr7-gold/5'
                                : 'border-rose-500/30 bg-rose-500/5 opacity-60 cursor-not-allowed'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-theme-text-primary truncate">{vehicle.display_name}</p>
                                {vehicle.plate && <p className="text-[11px] font-mono text-theme-text-muted">{vehicle.plate}</p>}
                              </div>
                              <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                isSelected
                                  ? 'bg-dr7-gold text-black border-dr7-gold'
                                  : isAvailable
                                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                  : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                              }`}>
                                {isSelected ? 'Selezionata' : isAvailable ? (supercarExperienceWindow ? 'Disponibile' : 'Provvisoria') : 'Occupata'}
                              </span>
                            </div>
                            {!isAvailable && !isSelected && 'reason' in result && result.reason && (
                              <p className="text-[10px] text-rose-400 mt-1 line-clamp-2">{result.reason}</p>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {!experienceVehicle && (
                    <p className="text-xs text-amber-400">Seleziona la supercar per completare la prenotazione.</p>
                  )}
                </div>
              )}

              {/* Running total */}
              <div className="p-3 bg-theme-bg-tertiary/50 rounded-lg flex justify-between items-center">
                <span className="text-sm text-theme-text-muted">Durata: ~{getTotalDuration()} min</span>
                <span className="text-lg font-bold text-dr7-gold">Totale: EUR {getTotal().toFixed(2)}</span>
              </div>

              {/* Navigation */}
              <div className="flex justify-between items-center pt-4 border-t border-theme-border">
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className="px-4 py-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
                >
                  Indietro
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedExtras([])
                      setExtraPriceOptions({})
    setExtraQuantities({})
                      setCurrentStep(3)
                    }}
                    className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors"
                  >
                    Salta Extra
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(3)}
                    className="px-6 py-2 rounded-full font-semibold bg-dr7-gold hover:bg-[#0A8FA3] text-white transition-colors"
                  >
                    Avanti
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ===== STEP 3: Confirm & Book ===== */}
          {currentStep === 3 && (
            <div className="space-y-4">
              {/* Summary Card */}
              <div className="p-4 bg-theme-bg-tertiary/50 rounded-lg border border-dr7-gold/30">
                <h4 className="text-sm font-semibold text-dr7-gold mb-2">Riepilogo</h4>
                {/* Vehicle info */}
                {(vehicleMakeModel || vehiclePlate) && (
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b border-theme-border text-sm">
                    {vehiclePlate && <span className="font-mono text-dr7-gold font-bold">{vehiclePlate}</span>}
                    {vehicleMakeModel && <span className="text-theme-text-primary">{vehicleMakeModel}</span>}
                    {vehicleCategory && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        vehicleCategory === 'moto' ? 'bg-purple-500/20 text-purple-400'
                          : vehicleCategory === 'urban' ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-orange-500/20 text-orange-400'
                      }`}>
                        {vehicleCategory === 'moto' ? 'MOTO' : vehicleCategory === 'urban' ? 'URBAN' : 'MAXI'}
                      </span>
                    )}
                  </div>
                )}
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-theme-text-primary">
                      {selectedService?.name}
                      {selectedPriceOption && <span className="text-theme-text-muted ml-1">({selectedPriceOption.label})</span>}
                    </span>
                    <span className="text-theme-text-primary font-medium">
                      EUR {selectedService?.price_unit === 'custom'
                        ? (parseFloat(customPrice) || 0).toFixed(2)
                        : (selectedPriceOption?.price ?? selectedService?.price ?? 0).toFixed(2)}
                    </span>
                  </div>
                  {selectedExtras.map(extra => {
                    const ep = extraPriceOptions[extra.id]
                    return (
                      <div key={extra.id} className="flex justify-between text-theme-text-muted">
                        <span>+ {extra.name}{ep ? ` (${ep.label})` : ''}</span>
                        <span>EUR {(ep?.price ?? extra.price).toFixed(2)}</span>
                      </div>
                    )
                  })}
                  {primeFlex && (
                    <div className="flex justify-between text-theme-text-muted">
                      <span>+ Prime Flex</span>
                      <span>EUR {PRIME_FLEX_PRICE.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="pt-2 mt-2 border-t border-theme-border flex justify-between items-center">
                    <span className="text-theme-text-muted">Durata: ~{getTotalDuration()} min</span>
                    <span className="text-dr7-gold font-bold text-base">EUR {getTotal().toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Manual Price Override */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Prezzo manuale (opzionale)</label>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted text-sm">EUR</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={manualPrice ?? ''}
                      onChange={(e) => setManualPrice(e.target.value === '' ? null : e.target.value)}
                      placeholder={getTotal().toFixed(2)}
                      className="w-full pl-12 pr-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary placeholder-theme-text-muted"
                    />
                  </div>
                  {manualPrice !== null && (
                    <button
                      type="button"
                      onClick={() => setManualPrice(null)}
                      className="px-3 py-2 text-xs text-theme-text-muted hover:text-theme-text-primary border border-theme-border rounded transition-colors"
                    >
                      Reset
                    </button>
                  )}
                </div>
                {manualPrice !== null && manualPrice !== '' && (
                  <p className="text-xs text-dr7-gold mt-1">
                    Prezzo manuale: EUR {parseFloat(manualPrice).toFixed(2)} (invece di EUR {getTotal().toFixed(2)})
                  </p>
                )}
              </div>

              {/* Customer */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Cliente *</label>
                <CustomerAutocomplete
                  customers={customers}
                  selectedCustomerId={formData.customer_id}
                  onSelectCustomer={(customerId) => setFormData(prev => ({ ...prev, customer_id: customerId }))}
                  placeholder="Inizia a scrivere nome, email o telefono..."
                  required={true}
                  showCardInfoOnSelect={true}
                />
                <button
                  type="button"
                  onClick={() => setShowNewClientModal(true)}
                  className="mt-2 text-sm text-dr7-gold hover:underline"
                >
                  + Nuovo Cliente
                </button>
                {formData.customer_id && (() => {
                  const sel = customers.find(c => c.id === formData.customer_id)
                  if (!sel) return null
                  return (
                    <div className="mt-2 p-2 bg-dr7-gold/10 border border-dr7-gold/30 rounded-lg text-sm">
                      <span className="text-dr7-gold font-medium">{sel.full_name}</span>
                      {sel.phone && <span className="text-theme-text-muted ml-2">{sel.phone}</span>}
                    </div>
                  )
                })()}
              </div>

              {/* Date + Time side by side */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Data *</label>
                  <input
                    type="date"
                    min={todayStr}
                    value={formData.appointment_date}
                    onChange={(e) => setFormData({ ...formData, appointment_date: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Ora *</label>
                  <select
                    value={formData.appointment_time}
                    onChange={(e) => setFormData({ ...formData, appointment_time: e.target.value })}
                    className="w-full appearance-none px-4 py-3 pr-10 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
                  >
                    <option value="">Seleziona orario</option>
                    {(() => {
                      const selectedDay = formData.appointment_date ? new Date(formData.appointment_date + 'T12:00:00').getDay() : -1
                      const isSat = selectedDay === 6
                      // Slot dinamici da Centralina Pro > Orari Lavaggio
                      const dateForSlots = formData.appointment_date ? new Date(formData.appointment_date + 'T12:00:00') : new Date()
                      const allSlots = generateLavaggioSlotsForDate(dateForSlots)

                      // Filter out past times if today
                      const now = new Date()
                      const todayStr = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })
                      const isToday = formData.appointment_date === todayStr
                      const currentMinutes = isToday ? now.getHours() * 60 + now.getMinutes() : 0
                      const slots = isToday
                        ? allSlots.filter(t => { const [h, m] = t.split(':').map(Number); return h * 60 + m > currentMinutes; })
                        : allSlots

                      const morningSlots = slots.filter(t => t.startsWith('09') || t.startsWith('10') || t.startsWith('11') || t.startsWith('12'))
                      const afternoonSlots = isSat
                        ? slots.filter(t => t.startsWith('13') || t.startsWith('14') || t.startsWith('15') || t.startsWith('16') || t.startsWith('17'))
                        : slots.filter(t => t.startsWith('15') || t.startsWith('16') || t.startsWith('17') || t.startsWith('18'))

                      return (
                        <>
                          {morningSlots.length > 0 && (
                            <optgroup label="Mattina">
                              {morningSlots.map(time => (
                                <option key={time} value={time}>{time}</option>
                              ))}
                            </optgroup>
                          )}
                          {afternoonSlots.length > 0 && (
                            <optgroup label="Pomeriggio">
                              {afternoonSlots.map(time => (
                                <option key={time} value={time}>{time}</option>
                              ))}
                            </optgroup>
                          )}
                        </>
                      )
                    })()}
                  </select>
                </div>
              </div>

              {/* ─── Supercar Experience: vehicle picker ───────────────────
                  Visible only when a Supercar/Icon Experience extra is
                  selected with a duration option AND date+time are set.
                  Marks each fleet car as Disponibile / Occupato based on
                  conflicting bookings in the experience window. */}
              {supercarExperienceExtra && supercarExperienceOption && supercarExperienceWindow && (
                <div className="rounded-xl border border-dr7-gold/40 bg-dr7-gold/5 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <h4 className="text-sm font-semibold text-dr7-gold flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} strokeLinecap="round" d="M5 12l4-7h6l4 7v6a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1H8v1a1 1 0 01-1 1H6a1 1 0 01-1-1v-6z"/><circle cx="9" cy="14" r="1.5"/><circle cx="15" cy="14" r="1.5"/></svg>
                        {supercarExperienceExtra.name} <span className="text-xs text-theme-text-muted font-normal">— flotta {experienceTier === 'hypercar' ? 'hypercar' : 'supercar'}</span>
                      </h4>
                      <p className="text-xs text-theme-text-muted mt-0.5">
                        Durata {supercarExperienceOption.label} · finestra {supercarExperienceWindow.pickupTime}–{supercarExperienceWindow.returnTime}
                        {supercarExperienceWindow.pickupDate !== supercarExperienceWindow.returnDate && ` (${supercarExperienceWindow.returnDate})`}
                      </p>
                    </div>
                    {experienceVehicle && (
                      <button
                        type="button"
                        onClick={() => setExperienceVehicle(null)}
                        className="text-xs text-theme-text-muted hover:text-theme-text-primary border border-theme-border rounded-full px-3 py-1"
                      >
                        Cambia veicolo
                      </button>
                    )}
                  </div>

                  {supercarFleet.length === 0 ? (
                    <p className="text-xs text-theme-text-muted italic">Nessun veicolo nella flotta supercar.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {supercarFleet.map(vehicle => {
                        const availabilityVehicle: AvailabilityVehicle = {
                          id: vehicle.id,
                          display_name: vehicle.display_name,
                          plate: vehicle.plate,
                          status: (vehicle.status === 'available' || vehicle.status === 'rented' || vehicle.status === 'maintenance' || vehicle.status === 'retired') ? vehicle.status : 'available',
                          daily_rate: vehicle.daily_rate,
                          category: (vehicle.category as AvailabilityVehicle['category']) || undefined,
                          metadata: vehicle.metadata as AvailabilityVehicle['metadata'],
                          created_at: '',
                          updated_at: '',
                        }
                        const result = isVehicleAvailable(
                          availabilityVehicle,
                          supercarExperienceWindow.pickupDate,
                          supercarExperienceWindow.returnDate,
                          supercarExperienceWindow.pickupTime,
                          supercarExperienceWindow.returnTime,
                          supercarFleetBookings,
                        )
                        const isAvailable = result.available
                        const isSelected = experienceVehicle?.id === vehicle.id
                        return (
                          <button
                            key={vehicle.id}
                            type="button"
                            disabled={!isAvailable && !isSelected}
                            onClick={() => setExperienceVehicle(vehicle)}
                            className={`text-left rounded-lg border p-3 transition-colors ${
                              isSelected
                                ? 'border-dr7-gold bg-dr7-gold/15'
                                : isAvailable
                                ? 'border-theme-border bg-theme-bg-tertiary hover:border-dr7-gold hover:bg-dr7-gold/5'
                                : 'border-rose-500/30 bg-rose-500/5 opacity-60 cursor-not-allowed'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-theme-text-primary truncate">{vehicle.display_name}</p>
                                {vehicle.plate && <p className="text-[11px] font-mono text-theme-text-muted">{vehicle.plate}</p>}
                              </div>
                              <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                isSelected
                                  ? 'bg-dr7-gold text-black border-dr7-gold'
                                  : isAvailable
                                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                  : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                              }`}>
                                {isSelected ? 'Selezionata' : isAvailable ? 'Disponibile' : 'Occupata'}
                              </span>
                            </div>
                            {!isAvailable && !isSelected && result.reason && (
                              <p className="text-[10px] text-rose-400 mt-1 line-clamp-2">{result.reason}</p>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {!experienceVehicle && (
                    <p className="text-xs text-amber-400">Seleziona un veicolo per completare la prenotazione del Supercar Experience.</p>
                  )}
                </div>
              )}

              {/* Payment + Notes */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Stato Pagamento</label>
                  <select
                    value={formData.payment_status}
                    onChange={(e) => {
                      const newStatus = e.target.value
                      const total = getFinalPrice()
                      const newAmountPaid = newStatus === 'paid' ? total.toString() : '0'
                      setFormData({
                        ...formData,
                        payment_status: newStatus,
                        amount_paid: newAmountPaid,
                        payment_method: newStatus === 'unpaid' ? '' : formData.payment_method
                      })
                    }}
                    className="w-full appearance-none px-4 py-3 pr-10 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
                  >
                    <option value="pending">Da Saldare</option>
                    <option value="paid">Pagato</option>
                    <option value="unpaid">Non Pagato</option>
                  </select>
                </div>
                <div>
                  {formData.payment_status !== 'unpaid' && (
                    <>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-2">Metodo di Pagamento</label>
                      <select
                        value={formData.payment_method}
                        onChange={(e) => {
                          const method = e.target.value
                          const updates: Record<string, string> = { payment_method: method }
                          if (isNexiPayByLink(method)) {
                            updates.payment_status = 'pending'
                            updates.amount_paid = '0'
                          }
                          setFormData(prev => ({ ...prev, ...updates }))
                        }}
                        className="w-full appearance-none px-4 py-3 pr-10 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
                      >
                        <option value="">-- Seleziona metodo --</option>
                        {paymentMethods.map(pm => (
                          <option key={pm.key} value={pm.label}>{pm.label}</option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Note</label>
                  <input
                    type="text"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                    placeholder="Opzionale..."
                  />
                </div>
              </div>

              {/* Conferma Prenotazione — quando lo stato e' "Da Saldare",
                  ticca per inviare comunque il template di conferma al cliente
                  (carwash_new_customer / mechanical_new_customer) con
                  {payment_status} = "Da saldare". Untickato + da-saldare =>
                  nessun messaggio finche' non si segna pagato. Stesso UX
                  di ReservationsTab > Conferma Prenotazione. */}
              {formData.payment_status !== 'paid' && formData.payment_status !== 'completed' && formData.payment_status !== 'succeeded' && (
                <div className={`flex items-start gap-2 p-3 rounded-lg border ${confirmBooking ? 'border-red-500 bg-red-900/10' : 'border-theme-border'}`}>
                  <input
                    type="checkbox"
                    id="carwash_confirm_booking"
                    checked={confirmBooking}
                    onChange={(e) => setConfirmBooking(e.target.checked)}
                    className="w-4 h-4 mt-0.5 text-red-600 bg-theme-bg-tertiary border-theme-border-light rounded focus:ring-red-500"
                  />
                  <label htmlFor="carwash_confirm_booking" className="text-sm text-theme-text-secondary cursor-pointer">
                    <span className="font-semibold text-red-400">Conferma Prenotazione</span>
                    <span className="block text-xs text-theme-text-muted mt-0.5">La prenotazione NON scadr&agrave; dopo 1h. In calendario apparir&agrave; in rosso con il nome del cliente invece di &quot;Da Saldare&quot;.</span>
                  </label>
                </div>
              )}

              {/* Navigation + Confirm */}
              <div className="flex justify-between items-center pt-4 border-t border-theme-border">
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="px-4 py-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
                >
                  Indietro
                </button>
                <button
                  type="button"
                  disabled={
                    submitting
                    || submitLockRef.current
                    || formSubmittedRef.current
                    || !formData.customer_id
                    || !formData.appointment_time
                    // OTP modal currently asking for a code → block Conferma.
                    // Without this, the 3s submit-lock cooldown would
                    // re-enable the button while the OTP modal is still
                    // open, letting a 2nd click fire a parallel handleSubmit.
                    || override.limitationState.isOpen
                    // Carta Punti gate waiting for OTP approval → also block.
                    || pendingCreateBookingRef.current !== null
                  }
                  onClick={(e) => {
                    // Click guard SINCRONO al livello del DOM: anche se
                    // React non ha ancora propagato disabled=true, i ref
                    // bloccano il click prima di chiamare handleSubmit.
                    // Include formSubmittedRef, l'OTP modal aperto, e
                    // un'eventuale createBooking parcheggiata in attesa
                    // di OTP — tutti e tre indicano "già partito un
                    // salvataggio, non rilanciare un secondo flusso".
                    if (
                      submitLockRef.current
                      || submitting
                      || formSubmittedRef.current
                      || override.limitationState.isOpen
                      || pendingCreateBookingRef.current !== null
                    ) {
                      e.preventDefault()
                      e.stopPropagation()
                      return
                    }
                    handleSubmit()
                  }}
                  className={`px-8 py-3 rounded-full font-bold text-base transition-colors ${
                    submitting
                    || override.limitationState.isOpen
                    || pendingCreateBookingRef.current !== null
                    || !formData.customer_id
                    || !formData.appointment_time
                      ? 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed'
                      : 'bg-dr7-gold hover:bg-[#0A8FA3] text-white'
                  }`}
                >
                  {submitting
                    ? 'Creazione...'
                    : override.limitationState.isOpen
                      ? 'In attesa OTP…'
                      : pendingCreateBookingRef.current !== null
                        ? 'In attesa OTP…'
                        : `Conferma - EUR ${getFinalPrice().toFixed(2)}`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {
        bookings.length === 0 ? (
          <div className=" rounded-lg border border-theme-border p-8 text-center text-theme-text-muted">
            Nessuna prenotazione lavaggio trovata
          </div>
        ) : (
          <div className="rounded-lg overflow-hidden">
            {/* Desktop table */}
            <div className="block overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Cliente</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Servizio</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Data & Ora</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Prezzo</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Pagamento</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.filter(booking => {
                    if (!bookingSearchQuery) return true
                    const norm = (s: string) => s.replace(/[\s\-\+\(\)]/g, '')
                    const words = bookingSearchQuery.toLowerCase().split(/\s+/).filter(Boolean).map(norm)
                    const customerName = (booking.customer_name || booking.booking_details?.customer?.fullName || '').toLowerCase()
                    const customerEmail = (booking.customer_email || booking.booking_details?.customer?.email || '').toLowerCase()
                    const customerPhone = (booking.customer_phone || booking.booking_details?.customer?.phone || '').toLowerCase()
                    const vehicleName = (booking.vehicle_name || '').toLowerCase()
                    const vehiclePlate = (booking.vehicle_plate || '').toLowerCase()
                    const bookingId = String(booking.id || '').toLowerCase()
                    const bookingCode = bookingId.substring(0, 8)
                    // Normalise the SAME way the query is normalised — strip
                    // spaces, hyphens, plus, parentheses from every field so
                    // "DR7-2A37CACB" matches "dr72a37cacb" in the haystack.
                    const searchText = norm(`${customerName} ${customerEmail} ${customerPhone} ${vehicleName} ${vehiclePlate} ${bookingId} ${bookingCode} dr7${bookingCode}`)
                    return words.every(word => searchText.includes(word))
                  }).map((booking) => (
                    <tr key={booking.id} className="border-t border-theme-border hover:bg-theme-bg-hover/50">
                      <td className="px-4 py-3 text-sm text-theme-text-primary">
                        {booking.customer_name === 'Lavaggio Rientro' ? (
                          <>
                            <div className="font-medium">Lavaggio Rientro</div>
                            {booking.vehicle_name && (
                              <div className="text-xs text-theme-text-primary mt-1">{booking.vehicle_name}</div>
                            )}
                            {booking.vehicle_plate && (
                              <div className="text-xs text-dr7-gold font-mono">{booking.vehicle_plate}</div>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="font-medium flex items-center gap-1.5 flex-wrap">
                              <span>{booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A'}</span>
                              <ClientStatusBadge
                                customerId={booking.customer_id}
                                userId={booking.user_id}
                                email={booking.customer_email || booking.booking_details?.customer?.email}
                              />
                            </div>
                            <div className="text-xs text-dr7-gold font-mono">DR7-{String(booking.id || '').substring(0, 8).toUpperCase()}</div>
                            <div className="text-xs text-theme-text-muted">{booking.customer_email || booking.booking_details?.customer?.email || '-'}</div>
                            <div className="text-xs text-theme-text-muted">{booking.customer_phone || booking.booking_details?.customer?.phone || '-'}</div>
                            {(booking.booking_details?.vehicleMakeModel || (booking.vehicle_name && booking.vehicle_name !== 'Car Wash Service')) && (
                              <div className="flex items-center gap-1.5 mt-1">
                                <span className="text-xs text-theme-text-primary">{booking.booking_details?.vehicleMakeModel || booking.vehicle_name}</span>
                                {booking.booking_details?.vehicleCategory && (
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    booking.booking_details.vehicleCategory === 'moto' ? 'bg-purple-500/15 text-purple-400'
                                      : booking.booking_details.vehicleCategory === 'urban' ? 'bg-blue-500/15 text-blue-400'
                                      : 'bg-orange-500/15 text-orange-400'
                                  }`}>
                                    {booking.booking_details.vehicleCategory === 'moto' ? 'MO' : booking.booking_details.vehicleCategory === 'urban' ? 'U' : 'M'}
                                  </span>
                                )}
                              </div>
                            )}
                            {booking.vehicle_plate && (
                              <div className="text-xs text-dr7-gold font-mono">{booking.vehicle_plate}</div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-theme-text-primary max-w-[180px]">
                        <div className="font-medium truncate">{booking.service_name}</div>
                        {booking.booking_details?.additionalService && (
                          <div className="text-xs text-theme-text-muted truncate">+ {booking.booking_details.additionalService}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-theme-text-primary">
                        <div>
                          {booking.appointment_date
                            ? new Date(booking.appointment_date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' })
                            : '-'}
                        </div>
                        <div className="text-xs text-theme-text-muted">{booking.appointment_time || '-'}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-theme-text-primary font-bold">
                        EUR {(booking.price_total / 100).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          booking.payment_status === 'completed' || booking.payment_status === 'paid' || booking.payment_status === 'succeeded'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : booking.payment_status === 'pending'
                              ? 'bg-orange-500/15 text-orange-500'
                              : 'bg-red-500/15 text-red-500'
                        }`}>
                          {booking.payment_status === 'completed' || booking.payment_status === 'paid' || booking.payment_status === 'succeeded'
                            ? 'Pagato'
                            : booking.payment_status === 'pending'
                              ? 'In Attesa'
                              : 'Non Pagato'}
                        </span>
                        {booking.payment_method && (
                          <div className="text-[10px] text-theme-text-muted mt-1">
                            {booking.payment_method === 'credit_wallet' ? 'Credit Wallet'
                              : isNexiPayByLink(booking.payment_method) ? 'Nexi'
                              : booking.payment_method === 'online' ? 'Online'
                              : booking.payment_method}
                            {(booking as any).booking_source === 'website' || !(booking as any).booking_source ? '' : ` · ${(booking as any).booking_source}`}
                          </div>
                        )}
                        {!booking.payment_method && booking.booking_details?.payment_method && (
                          <div className="text-[10px] text-theme-text-muted mt-1">{booking.booking_details.payment_method}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex gap-2">
                          <button onClick={() => openEditBooking(booking)} className="px-3 py-1.5 bg-dr7-gold/20 hover:bg-dr7-gold/40 text-dr7-gold rounded-full text-xs font-medium transition-colors min-h-[44px]">Modifica</button>
                          <button onClick={() => handleGenerateInvoice(booking)} disabled={generatingInvoice} className={`px-3 py-1.5 ${generatingInvoice ? 'bg-theme-bg-hover text-theme-text-secondary' : 'bg-dr7-gold/20 hover:bg-dr7-gold/40 text-dr7-gold'} rounded-full text-xs font-medium transition-colors min-h-[44px]`}>
                            {generatingInvoice ? '...' : 'Fattura'}
                          </button>
                          {booking.payment_status !== 'paid' && booking.payment_status !== 'completed' && booking.payment_status !== 'succeeded' && (
                            <button onClick={() => handleResendPaymentLink(booking)} className="px-3 py-1.5 bg-dr7-gold/20 hover:bg-dr7-gold/40 text-dr7-gold rounded-full text-xs font-medium transition-colors min-h-[44px]">Rinvia Link</button>
                          )}
                          <button onClick={() => handleDeleteBooking(booking.id, booking.customer_name)} className="px-3 py-1.5 bg-red-500/15 hover:bg-red-500/25 text-red-400 rounded-full text-xs font-medium transition-colors min-h-[44px]">×</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards — Apple style */}
            <div className="lg:hidden space-y-3">
              {bookings.filter(booking => {
                if (!bookingSearchQuery) return true
                const norm = (s: string) => s.replace(/[\s\-\+\(\)]/g, '')
                const words = bookingSearchQuery.toLowerCase().split(/\s+/).filter(Boolean).map(norm)
                const customerName = (booking.customer_name || booking.booking_details?.customer?.fullName || '').toLowerCase()
                const customerEmail = (booking.customer_email || booking.booking_details?.customer?.email || '').toLowerCase()
                const customerPhone = (booking.customer_phone || booking.booking_details?.customer?.phone || '').toLowerCase()
                const vehicleName = (booking.vehicle_name || '').toLowerCase()
                const vehiclePlate = (booking.vehicle_plate || '').toLowerCase()
                const bookingId = String(booking.id || '').toLowerCase()
                const bookingCode = bookingId.substring(0, 8)
                const searchText = norm(`${customerName} ${customerEmail} ${customerPhone} ${vehicleName} ${vehiclePlate} ${bookingId} ${bookingCode} dr7${bookingCode}`)
                return words.every(word => searchText.includes(word))
              }).map((booking) => {
                const bPaid = booking.payment_status === 'completed' || booking.payment_status === 'paid' || booking.payment_status === 'succeeded'
                const bPending = booking.payment_status === 'pending'
                const isRientro = booking.customer_name === 'Lavaggio Rientro'
                return (
                  <div key={booking.id} className="rounded-2xl bg-theme-bg-secondary border border-theme-border/30 shadow-sm overflow-hidden">
                    {/* Card header */}
                    <div className="px-4 pt-4 pb-3 flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-theme-text-primary text-[15px] truncate flex items-center gap-1.5 flex-wrap">
                          <span className="truncate">{isRientro ? 'Lavaggio Rientro' : (booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A')}</span>
                          {!isRientro && (
                            <ClientStatusBadge
                              customerId={booking.customer_id}
                              userId={booking.user_id}
                              email={booking.customer_email || booking.booking_details?.customer?.email}
                            />
                          )}
                        </div>
                        {!isRientro && (
                          <>
                            <div className="text-[11px] text-dr7-gold font-mono mt-0.5">
                              DR7-{String(booking.id || '').substring(0, 8).toUpperCase()}
                            </div>
                            <div className="text-xs text-theme-text-muted mt-0.5">
                              {booking.customer_phone || booking.booking_details?.customer?.phone || '-'}
                            </div>
                          </>
                        )}
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ml-2 ${
                        bPaid ? 'bg-emerald-500/15 text-emerald-500' : bPending ? 'bg-orange-500/15 text-orange-500' : 'bg-red-500/15 text-red-500'
                      }`}>
                        {bPaid ? 'Pagato' : bPending ? 'In Attesa' : 'Non Pagato'}
                      </span>
                    </div>

                    {/* Card body — grouped rows */}
                    <div className="mx-4 rounded-xl bg-theme-bg-tertiary/60 overflow-hidden mb-3">
                      <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-theme-border/20">
                        <span className="text-theme-text-muted text-xs">Servizio</span>
                        <span className="text-theme-text-primary text-xs font-medium text-right max-w-[60%] truncate">{booking.service_name}</span>
                      </div>
                      <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-theme-border/20">
                        <span className="text-theme-text-muted text-xs">Data</span>
                        <span className="text-theme-text-primary text-xs font-medium">
                          {booking.appointment_date
                            ? new Date(booking.appointment_date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' })
                            : '-'} · {booking.appointment_time || '-'}
                        </span>
                      </div>
                      {(booking.vehicle_plate || booking.booking_details?.vehicleMakeModel) && (
                        <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-theme-border/20">
                          <span className="text-theme-text-muted text-xs">Veicolo</span>
                          <div className="flex items-center gap-1.5">
                            {booking.vehicle_plate && (
                              <span className="font-mono font-bold text-dr7-gold text-xs">{booking.vehicle_plate}</span>
                            )}
                            {booking.booking_details?.vehicleCategory && (
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                booking.booking_details.vehicleCategory === 'moto' ? 'bg-purple-500/15 text-purple-500'
                                  : booking.booking_details.vehicleCategory === 'urban' ? 'bg-blue-500/15 text-blue-500'
                                  : 'bg-orange-500/15 text-orange-500'
                              }`}>
                                {booking.booking_details.vehicleCategory === 'moto' ? 'MOTO' : booking.booking_details.vehicleCategory === 'urban' ? 'URBAN' : 'MAXI'}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="px-3.5 py-2.5 flex items-center justify-between">
                        <span className="text-theme-text-primary text-sm font-semibold">Totale</span>
                        <span className="text-dr7-gold font-bold text-base">€{(booking.price_total / 100).toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Notes */}
                    {booking.booking_details?.notes && (
                      <div className="mx-4 mb-3 rounded-xl bg-theme-bg-tertiary/60 border border-theme-border/20 px-3.5 py-2.5">
                        <div className="text-theme-text-muted text-[10px] font-semibold uppercase tracking-wider mb-1">Note</div>
                        <p className="text-theme-text-primary text-xs leading-relaxed">{booking.booking_details.notes}</p>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="px-4 pb-4 flex gap-2">
                      <button
                        onClick={() => openEditBooking(booking)}
                        className="flex-1 py-2.5 rounded-xl bg-dr7-gold/10 hover:bg-dr7-gold/20 text-dr7-gold text-xs font-semibold transition-all active:scale-[0.98]"
                      >
                        Modifica
                      </button>
                      <button
                        onClick={() => handleGenerateInvoice(booking)}
                        disabled={generatingInvoice}
                        className="flex-1 py-2.5 rounded-xl bg-dr7-gold/10 hover:bg-dr7-gold/20 text-dr7-gold text-xs font-semibold transition-all active:scale-[0.98]"
                      >
                        {generatingInvoice ? '...' : 'Fattura'}
                      </button>
                      {booking.payment_status !== 'paid' && booking.payment_status !== 'completed' && booking.payment_status !== 'succeeded' && (
                        <button
                          onClick={() => handleResendPaymentLink(booking)}
                          className="flex-1 py-2.5 rounded-xl bg-dr7-gold/10 hover:bg-dr7-gold/20 text-dr7-gold text-xs font-semibold transition-all active:scale-[0.98]"
                        >
                          Rinvia Link
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteBooking(booking.id, booking.customer_name)}
                        className="py-2.5 px-4 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold transition-all active:scale-[0.98]"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      }

      {/* Edit Booking Modal */}
      {
        editingBooking && (
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
                    onChange={(e) => {
                      const service = carWashServices.find(s => s.id === e.target.value) || null
                      setEditService(service)
                    }}
                    className="w-full appearance-none bg-theme-bg-tertiary text-theme-text-primary rounded-lg px-4 py-3 pr-10 border border-theme-border focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
                  >
                    <option value="">Seleziona servizio...</option>
                    {Object.entries(
                      carWashServices
                        .filter(s => s.category !== 'extra' && s.category !== 'experience')
                        .reduce<Record<string, CarWashService[]>>((acc, s) => {
                          if (!acc[s.category]) acc[s.category] = []
                          acc[s.category].push(s)
                          return acc
                        }, {})
                    ).map(([category, services]) => (
                      <optgroup key={category} label={categoryLabels[category] || category.toUpperCase()}>
                        {services.map(service => {
                          const sn = getServiceNum(service.name)
                          return (
                            <option key={service.id} value={service.id}>
                              {sn ? `${sn}. ` : ''}{service.name} - EUR {service.price.toFixed(2)} ({service.duration})
                            </option>
                          )
                        })}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* Extras with price options & quantities */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Extra</label>
                  <div className="flex flex-wrap gap-3">
                    {carWashServices
                      .filter(s => (s.category === 'extra' || s.category === 'experience') && s.id !== editService?.id)
                      .map(extra => {
                        const isSelected = editExtras.some(e => e.id === extra.id)
                        const hasPriceOptions = extra.price_options && extra.price_options.length > 0
                        const currentOption = editExtraPriceOptions[extra.id]
                        return (
                          <div key={extra.id} className="flex flex-col gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                if (isSelected) {
                                  setEditExtras(prev => prev.filter(e => e.id !== extra.id))
                                  setEditExtraPriceOptions(prev => { const next = { ...prev }; delete next[extra.id]; return next })
                                  setEditExtraQuantities(prev => { const next = { ...prev }; delete next[extra.id]; return next })
                                } else {
                                  setEditExtras(prev => [...prev, extra])
                                }
                              }}
                              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border flex items-center gap-1.5 ${
                                isSelected
                                  ? 'bg-dr7-gold/20 border-dr7-gold text-dr7-gold'
                                  : 'bg-theme-bg-tertiary border-theme-border text-theme-text-primary hover:border-dr7-gold'
                              }`}
                            >
                              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[10px] ${
                                isSelected ? 'bg-dr7-gold border-dr7-gold text-white' : 'border-theme-text-muted'
                              }`}>
                                {isSelected && '✓'}
                              </span>
                              {extra.name}
                              {!hasPriceOptions && <span className="opacity-70">EUR {extra.price.toFixed(2)}</span>}
                            </button>
                            {/* Price option variants */}
                            {isSelected && hasPriceOptions && (
                              <div className="flex flex-wrap gap-1 ml-2">
                                {extra.price_options!.map((opt: { label: string; price: number }) => (
                                  <button
                                    key={opt.label}
                                    type="button"
                                    onClick={() => setEditExtraPriceOptions(prev => ({ ...prev, [extra.id]: opt }))}
                                    className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                                      currentOption?.label === opt.label
                                        ? 'bg-dr7-gold text-white border-dr7-gold font-bold'
                                        : 'border-theme-border text-theme-text-secondary hover:border-dr7-gold'
                                    }`}
                                  >
                                    {opt.label} EUR {opt.price}
                                  </button>
                                ))}
                              </div>
                            )}
                            {/* Quantity selector */}
                            {isSelected && extra.price_unit && (
                              <div className="flex items-center gap-2 ml-2">
                                <span className="text-[10px] text-theme-text-muted">{extra.price_unit}:</span>
                                <button type="button" onClick={() => setEditExtraQuantities(prev => ({ ...prev, [extra.id]: Math.max(1, (prev[extra.id] || 1) - 1) }))} className="w-6 h-6 rounded-full border border-theme-border text-theme-text-primary hover:border-dr7-gold flex items-center justify-center text-xs">-</button>
                                <span className="text-xs font-bold text-theme-text-primary w-5 text-center">{editExtraQuantities[extra.id] || 1}</span>
                                <button type="button" onClick={() => setEditExtraQuantities(prev => ({ ...prev, [extra.id]: Math.min(10, (prev[extra.id] || 1) + 1) }))} className="w-6 h-6 rounded-full border border-theme-border text-theme-text-primary hover:border-dr7-gold flex items-center justify-center text-xs">+</button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                  </div>
                </div>

                {/* Duration + Price summary */}
                <div className="p-3 bg-theme-bg-tertiary/50 rounded-lg flex justify-between items-center">
                  <span className="text-sm text-theme-text-muted">Durata: ~{getEditTotalDuration()} min</span>
                  <span className="text-lg font-bold text-dr7-gold">Totale: EUR {getEditTotal().toFixed(2)}</span>
                </div>

                {/* Manual price override */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Prezzo manuale (€) — lascia vuoto per usare il totale calcolato</label>
                  <input
                    type="number" step="0.01" min="0"
                    placeholder={getEditTotal().toFixed(2)}
                    value={editingBooking.price_total !== Math.round(getEditTotal() * 100) ? (editingBooking.price_total / 100).toFixed(2) : ''}
                    onChange={(e) => setEditingBooking({ ...editingBooking, price_total: e.target.value ? Math.round(parseFloat(e.target.value) * 100) : Math.round(getEditTotal() * 100) })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-2">Data</label>
                    <input
                      type="date"
                      value={(() => {
                        // Normalizza a YYYY-MM-DD in Rome TZ, così la data visibile
                        // coincide con quella nel messaggio al cliente (UTC midnight
                        // stantio non deve "scivolare" al giorno prima).
                        const raw = editingBooking.appointment_date || ''
                        if (!raw) return ''
                        // Se è già solo YYYY-MM-DD, usa così.
                        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
                        try {
                          const d = new Date(raw)
                          if (!isNaN(d.getTime())) {
                            return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
                          }
                        } catch { /* blank */ }
                        return raw.slice(0, 10)
                      })()}
                      onChange={(e) => setEditingBooking({ ...editingBooking, appointment_date: e.target.value })}
                      className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-2">Ora</label>
                    <input
                      type="time"
                      value={(() => {
                        // Prefer appointment_time (TIME col "HH:MM:SS") sliced to HH:MM.
                        // Fallback: estrai HH:MM dall'appointment_date ISO (formattato in
                        // Europe/Rome, non UTC), così l'ora visibile coincide con quella
                        // che il cliente riceverà nel messaggio.
                        const raw = editingBooking.appointment_time || ''
                        if (raw) return raw.slice(0, 5)
                        if (editingBooking.appointment_date) {
                          try {
                            const d = new Date(editingBooking.appointment_date)
                            if (!isNaN(d.getTime())) {
                              return d.toLocaleTimeString('it-IT', {
                                hour: '2-digit', minute: '2-digit', hour12: false,
                                timeZone: 'Europe/Rome',
                              })
                            }
                          } catch { /* blank */ }
                        }
                        return ''
                      })()}
                      onChange={(e) => setEditingBooking({ ...editingBooking, appointment_time: e.target.value })}
                      className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-2">Stato</label>
                    <select
                      value={editingBooking.status}
                      onChange={(e) => setEditingBooking({ ...editingBooking, status: e.target.value })}
                      className="w-full appearance-none px-4 py-3 pr-10 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
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
                      className="w-full appearance-none px-4 py-3 pr-10 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
                    >
                      <option value="pending">Da Saldare</option>
                      <option value="partial">Parziale (Da Saldare Resto)</option>
                      <option value="paid">Pagato</option>
                      <option value="completed">Completato</option>
                    </select>
                    {/* Partial payment: amount already paid + method for remainder */}
                    {editingBooking.payment_status === 'partial' && (
                      <div className="mt-2 space-y-2 p-3 bg-theme-bg-tertiary/50 rounded-lg border border-theme-border/30">
                        <div>
                          <label className="block text-xs font-medium text-theme-text-secondary mb-1">Importo già pagato (€)</label>
                          <input
                            type="number" step="0.01" min="0"
                            value={(editingBooking.booking_details?.amountPaid || 0) / 100}
                            onChange={(e) => setEditingBooking({
                              ...editingBooking,
                              booking_details: { ...(editingBooking.booking_details || {}), amountPaid: Math.round(parseFloat(e.target.value || '0') * 100) }
                            })}
                            placeholder="0.00"
                            className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm"
                          />
                          <p className="text-xs text-dr7-gold mt-1 font-semibold">
                            Rimanente: EUR {(((editingBooking.price_total || 0) - (editingBooking.booking_details?.amountPaid || 0)) / 100).toFixed(2)}
                          </p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-theme-text-secondary mb-1">Metodo già pagato</label>
                          <select
                            value={editingBooking.booking_details?.paidMethod || ''}
                            onChange={(e) => setEditingBooking({ ...editingBooking, booking_details: { ...(editingBooking.booking_details || {}), paidMethod: e.target.value } })}
                            className="w-full appearance-none px-3 py-2 pr-8 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary text-sm focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
                          >
                            <option value="">-- Seleziona --</option>
                            {paymentMethods.map(pm => (
                              <option key={pm.key} value={pm.label}>{pm.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-theme-text-secondary mb-1">Metodo per il resto</label>
                          <select
                            value={editingBooking.booking_details?.remainderMethod || ''}
                            onChange={(e) => setEditingBooking({ ...editingBooking, booking_details: { ...(editingBooking.booking_details || {}), remainderMethod: e.target.value }, payment_method: e.target.value })}
                            className="w-full appearance-none px-3 py-2 pr-8 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary text-sm focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
                          >
                            <option value="">-- Seleziona --</option>
                            {paymentMethods.map(pm => (
                              <option key={pm.key} value={pm.label}>{pm.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                    {/* Payment method selector — always visible */}
                    <div className="mt-2">
                      <label className="block text-xs font-medium text-theme-text-secondary mb-1">Metodo di pagamento</label>
                      <select
                        value={editingBooking.payment_method || ''}
                        onChange={(e) => setEditingBooking({ ...editingBooking, payment_method: e.target.value })}
                        className="w-full appearance-none px-3 py-2 pr-8 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary text-sm focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
                      >
                        <option value="">-- Seleziona metodo --</option>
                        {paymentMethods.map(pm => (
                          <option key={pm.key} value={pm.label}>{pm.label}</option>
                        ))}
                        {editingBooking.payment_method && !paymentMethods.some(pm => pm.label === editingBooking.payment_method) && (
                          <option value={editingBooking.payment_method}>{editingBooking.payment_method}</option>
                        )}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Note</label>
                  <textarea
                    value={editingBooking.booking_details?.notes || ''}
                    onChange={(e) => setEditingBooking({
                      ...editingBooking,
                      booking_details: { ...(editingBooking.booking_details || {}), notes: e.target.value }
                    })}
                    rows={3}
                    placeholder="Note aggiuntive (es. TRATTAMENTO AZOTO IN OMAGGIO)"
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm resize-y"
                  />
                </div>
              </div>

              <div className="p-6 border-t border-theme-border flex gap-3">
                <button
                  onClick={async () => {
                    // OTP gate — modificare un lavaggio/meccanica già paid o
                    // confirmed richiede OTP della direzione (Valerio + Ilenia
                    // bypassano server-side). Se è già stato approvato per la
                    // sessione, hasOverride passa subito.
                    {
                      const PAID = ['paid', 'completed', 'succeeded']
                      const CONFIRMED = ['confirmed', 'confermata', 'active', 'in_corso']
                      const isPaid = PAID.includes((editingBooking?.payment_status || '').toLowerCase())
                      const isConfirmed = CONFIRMED.includes((editingBooking?.status || '').toLowerCase())
                      // Bypass per i veicoli TEST: l'operatore QA non deve
                      // ricevere OTP per modifiche di prenotazioni di test.
                      const isTest = isTestBooking(editingBooking)
                      if (!isTest && (isPaid || isConfirmed) && !override.hasOverride('paid_wash_modify')) {
                        override.requestOverride(
                          'paid_wash_modify',
                          'Modifica o spostamento di un lavaggio/meccanica pagato o confermato: serve OTP della direzione.',
                          `wash_edit_${editingBooking?.id}`,
                        )
                        return
                      }
                    }
                    try {
                      // Rebuild cart items from edit selections (with price options + quantities)
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const editCartItems: any[] = []
                      if (editService) {
                        editCartItems.push({
                          serviceId: editService.id,
                          serviceName: editService.name,
                          quantity: 1,
                          price: editService.price,
                          option: null,
                          subtotal: editService.price
                        })
                      }
                      for (const extra of editExtras) {
                        const ep = editExtraPriceOptions[extra.id]
                        const qty = editExtraQuantities[extra.id] || 1
                        const unitPrice = ep?.price ?? extra.price
                        editCartItems.push({
                          serviceId: extra.id,
                          serviceName: extra.name,
                          quantity: qty,
                          price: unitPrice,
                          option: ep?.label || null,
                          subtotal: unitPrice * qty
                        })
                      }

                      const updatedServiceName = editService ? buildEditServiceNames() : editingBooking.service_name
                      const updatedPrice = editService ? Math.round(getEditTotal() * 100) : editingBooking.price_total
                      const updatedDuration = editService ? getEditTotalDuration() : (editingBooking.booking_details?.totalDuration || 0)

                      const updatedDetails = {
                        ...(editingBooking.booking_details || {}),
                        cartItems: editService ? editCartItems : (editingBooking.booking_details?.cartItems || []),
                        totalDuration: updatedDuration,
                      }

                      // If payment method changed away from Nexi Pay by Link, confirm the booking
                      // so the auto-cancel cron doesn't cancel it
                      const finalStatus = !isNexiPayByLink(editingBooking.payment_method) && editingBooking.status === 'pending'
                        ? 'confirmed'
                        : editingBooking.status

                      // Rebuild appointment_date as a FULL ISO timestamp from the edited
                      // date + time (Rome local → UTC). Prima: il date input settava solo
                      // "YYYY-MM-DD" → Supabase lo parsava come mezzanotte UTC → in Rome
                      // mostrava 02:00 (DST). Ora combiniamo date+time correttamente.
                      //
                      // Se l'admin apre il modale e salva senza toccare i campi, la data
                      // può essere YYYY-MM-DD o un ISO completo, e l'ora può essere:
                      //   - "HH:MM" (dal form)
                      //   - "HH:MM:SS" (dalla colonna TIME di PG)
                      //   - vuota/null → fallback: estrai ora dall'ISO appointment_date in Rome
                      let _dateStr = (editingBooking.appointment_date || '').trim()
                      if (/^\d{4}-\d{2}-\d{2}T/.test(_dateStr)) {
                        // Se l'ISO ha un timestamp, normalizza la data a Rome TZ per non
                        // "scivolare" al giorno prima/dopo per via del fuso orario.
                        try {
                          const _tmp = new Date(_dateStr)
                          if (!isNaN(_tmp.getTime())) {
                            _dateStr = _tmp.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
                          } else {
                            _dateStr = _dateStr.slice(0, 10)
                          }
                        } catch { _dateStr = _dateStr.slice(0, 10) }
                      } else {
                        _dateStr = _dateStr.slice(0, 10)
                      }

                      let _timeStr = (editingBooking.appointment_time || '').trim()
                      if (!_timeStr && editingBooking.appointment_date) {
                        try {
                          const _t = new Date(editingBooking.appointment_date)
                          if (!isNaN(_t.getTime())) {
                            _timeStr = _t.toLocaleTimeString('it-IT', {
                              hour: '2-digit', minute: '2-digit', hour12: false,
                              timeZone: 'Europe/Rome',
                            })
                          }
                        } catch { /* leave empty */ }
                      }
                      if (!_timeStr) _timeStr = '00:00'

                      let _apptIso: string | null = null
                      if (_dateStr) {
                        const [_y, _m, _d] = _dateStr.split('-').map(Number)
                        const [_hh, _mm] = _timeStr.split(':').map(Number)
                        const _combined = new Date(_y, (_m || 1) - 1, _d || 1, _hh || 0, _mm || 0, 0)
                        if (!isNaN(_combined.getTime())) _apptIso = _combined.toISOString()
                      }

                      const { error } = await supabase
                        .from('bookings')
                        .update({
                          customer_name: editingBooking.customer_name,
                          customer_email: editingBooking.customer_email,
                          customer_phone: editingBooking.customer_phone,
                          service_name: updatedServiceName,
                          appointment_date: _apptIso || editingBooking.appointment_date,
                          appointment_time: editingBooking.appointment_time,
                          pickup_date: _apptIso || editingBooking.appointment_date,
                          dropoff_date: _apptIso || editingBooking.appointment_date,
                          price_total: updatedPrice,
                          status: finalStatus,
                          payment_status: editingBooking.payment_status,
                          payment_method: editingBooking.payment_method || null,
                          booking_details: updatedDetails,
                        })
                        .eq('id', editingBooking.id)

                      if (error) throw error

                      // ─── Supercar Experience cascade on edit ──────────
                      // If this carwash booking has an associated supercar
                      // shadow rental, sync its window to the new
                      // appointment date/time. Duration stays the one chosen
                      // at create-time (stored in supercar_experience.duration_minutes).
                      try {
                        const exp = (editingBooking.booking_details as { supercar_experience?: { shadow_booking_id?: string | null; duration_minutes?: number; vehicle_id?: string } } | undefined)?.supercar_experience
                        const shadowId = exp?.shadow_booking_id
                          || await findSupercarShadowBookingId(editingBooking.id, editingBooking.booking_details)
                        if (shadowId && _apptIso && exp?.duration_minutes) {
                          const start = new Date(_apptIso)
                          const end = new Date(start.getTime() + exp.duration_minutes * 60_000)
                          await supabase.from('bookings').update({
                            pickup_date: start.toISOString(),
                            dropoff_date: end.toISOString(),
                            customer_name: editingBooking.customer_name,
                            customer_email: editingBooking.customer_email,
                            customer_phone: editingBooking.customer_phone,
                            // Mirror cancelled state from parent so the
                            // supercar frees up if the carwash is annulled.
                            status: editingBooking.status === 'cancelled' || editingBooking.status === 'annullata'
                              ? 'cancelled'
                              : 'confirmed',
                          }).eq('id', shadowId)
                          logger.log('[Supercar Experience] Cascaded edit to shadow', shadowId, start.toISOString(), '→', end.toISOString())
                        }
                      } catch (cascadeErr) {
                        console.error('[Supercar Experience] cascade-edit failed:', cascadeErr)
                      }

                      // Auto-generate fattura if payment changed to paid.
                      // Skip = method ha auto_invoice=false in Centralina
                      // Pro > Fiscale (admin-managed, niente liste hardcoded).
                      const editPaymentMethod = editingBooking.payment_method || ''
                      const editSkipFattura = !(await paymentMethodAutoInvoice(editPaymentMethod))
                      if (!editSkipFattura && (editingBooking.payment_status === 'paid' || editingBooking.payment_status === 'completed' || editingBooking.payment_status === 'succeeded')) {
                        try {
                          // Check if fattura already exists for this booking
                          const { data: existingFattura } = await supabase
                            .from('fatture')
                            .select('id')
                            .eq('booking_id', editingBooking.id)
                            .maybeSingle()

                          if (!existingFattura) {
                            logger.log('[Auto-Gen] Generating fattura for paid car wash:', editingBooking.id)
                            const invoiceRes = await authFetch('/.netlify/functions/generate-invoice-from-booking', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ bookingId: editingBooking.id, includeIVA: true })
                            })
                            if (invoiceRes.ok) {
                              logger.log('[Auto-Gen] ✅ Fattura generated')
                            } else {
                              const errData = await invoiceRes.json()
                              const errMsg = errData.message || errData.error || 'Errore sconosciuto'
                              logger.warn('[Auto-Gen] ⚠️ Fattura failed:', errMsg)
                              // Open customer edit modal if missing data
                              if (errMsg.includes('obbligatorio') || errMsg.includes('incomplete') || errMsg.includes('missing')) {
                                toast.error(`Dati cliente incompleti per la fattura: ${errMsg}`, { duration: 8000 })
                                let custId = editingBooking.customer_id || editingBooking.booking_details?.customer?.customerId || editingBooking.user_id
                                if (!custId && editingBooking.customer_name) {
                                  const match = customers.find(c =>
                                    (c.email && editingBooking.customer_email && c.email === editingBooking.customer_email) ||
                                    ((c.full_name || '').toLowerCase() === editingBooking.customer_name.toLowerCase())
                                  )
                                  if (match) custId = match.id
                                }
                                if (custId) openEditCustomer(custId)
                              } else {
                                toast.error(`Fattura non generata: ${errMsg}`, { duration: 8000 })
                              }
                            }
                          }
                        } catch (invoiceError) {
                          console.error('[Auto-Gen] ⚠️ Failed to generate fattura:', invoiceError)
                        }
                      }

                      // DR7 Privilege — fire on paid (edit-modal path). Gated
                      // STRICTLY on payment_status in paid/completed/succeeded;
                      // a booking that's only "confirmed" but not paid must NOT
                      // receive the discount code. Idempotente via
                      // dr7_privilege_sent_at, niente doppio invio.
                      const editIsPaid = editingBooking.payment_status === 'paid'
                        || editingBooking.payment_status === 'completed'
                        || editingBooking.payment_status === 'succeeded'
                      if (editIsPaid && editingBooking.id) {
                        authFetch('/.netlify/functions/trigger-dr7-privilege', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ bookingId: editingBooking.id, kind: 'lavaggio' }),
                        }).catch(() => { /* non-blocking */ })
                      }

                      // Send WhatsApp modification notification AL CLIENTE (non all'admin).
                      // Senza customPhone il sender cadeva su NOTIFICATION_PHONE env (admin).
                      // Skip se il cliente non ha un telefono registrato.
                      const _customerPhoneForNotify = editingBooking.customer_phone
                        || editingBooking.booking_details?.customer?.phone
                        || ''
                      if (_customerPhoneForNotify) {
                        try {
                          await fetch('/.netlify/functions/send-whatsapp-notification', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              customPhone: _customerPhoneForNotify,
                              isCustomerMessage: true,
                              booking: {
                                id: editingBooking.id,
                                service_type: 'car_wash',
                                isEdit: true,
                                service_name: updatedServiceName,
                                customer_name: editingBooking.customer_name,
                                customer_email: editingBooking.customer_email,
                                customer_phone: _customerPhoneForNotify,
                                appointment_date: _apptIso || editingBooking.appointment_date,
                                pickup_date: _apptIso || editingBooking.appointment_date,
                                dropoff_date: _apptIso || editingBooking.appointment_date,
                                vehicle_plate: editingBooking.vehicle_plate || editingBooking.booking_details?.vehicle?.plate || '',
                                price_total: updatedPrice,
                                payment_status: editingBooking.payment_status,
                                booking_details: {
                                  ...(editingBooking.booking_details || {}),
                                  serviceName: updatedServiceName,
                                  amountPaid: updatedDetails.amountPaid || 0,
                                  notes: updatedDetails.notes || ''
                                }
                              }
                            })
                          })
                        } catch (whatsappError) {
                          console.error('WhatsApp notification failed:', whatsappError)
                        }
                      } else {
                        console.warn('[CarWash Edit] Skip invio modifica: cliente senza telefono')
                      }

                      toast.success('Prenotazione aggiornata')
                      setEditingBooking(null)
                      loadData()
                    } catch (error) {
                      console.error('Failed to update booking:', error)
                      toast.error('Errore durante l\'aggiornamento')
                    }
                  }}
                  className="flex-1 bg-dr7-gold hover:bg-dr7-gold/90 text-white px-6 py-3 rounded-full font-medium transition-colors"
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
        )
      }



      {/* Foreign plate (Targa Estera) — URBAN/MAXI choice with OTP */}
      {showForeignPlateModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-semibold text-theme-text-primary mb-1">
              Targa Estera
            </h3>
            <p className="text-sm text-theme-text-secondary mb-4">
              Seleziona la categoria del veicolo. Per procedere e' richiesta autorizzazione tramite OTP.
            </p>
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => {
                  setPendingForeignCategory('urban')
                  override.requestOverride(
                    'foreign_plate_carwash',
                    `Targa estera ${vehiclePlate || '(non inserita)'} - categoria URBAN selezionata manualmente. Autorizzazione necessaria per procedere.`,
                  )
                }}
                className="flex-1 px-4 py-3 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                URBAN
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingForeignCategory('maxi')
                  override.requestOverride(
                    'foreign_plate_carwash',
                    `Targa estera ${vehiclePlate || '(non inserita)'} - categoria MAXI selezionata manualmente. Autorizzazione necessaria per procedere.`,
                  )
                }}
                className="flex-1 px-4 py-3 rounded-lg text-sm font-bold bg-orange-600 text-white hover:bg-orange-700 transition-colors"
              >
                MAXI
              </button>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowForeignPlateModal(false)
                  setPendingForeignCategory(null)
                }}
                className="px-4 py-2 text-theme-text-muted hover:text-theme-text-primary transition-colors text-sm"
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OTP Modal for manual category */}
      <LimitationOverrideModal
        isOpen={override.limitationState.isOpen}
        limitationCode={override.limitationState.limitationCode}
        limitationMessage={override.limitationState.limitationMessage}
        actionContext={override.limitationState.actionContext}
        details={otpDetails}
        draftSessionId={override.draftSessionId}
        flowType={override.flowType}
        onClose={override.closeLimitation}
        onCancel={() => {
          // X = chiudi popup senza salvare. Pulisci tutti i pending ref
          // così l'operatore può ri-cliccare Salva (o Modifica) e il gate
          // si ri-arma da zero, senza riprodurre azioni dalla sessione
          // cancellata.
          pendingCreateBookingRef.current = null
          pendingEditBookingRef.current = null
          setPendingForeignCategory(null)
          override.cancelLimitation()
        }}
        onOverrideApproved={override.handleOverrideApproved}
      />
    </div >
  )
}
