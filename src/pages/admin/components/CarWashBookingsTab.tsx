import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import CustomerAutocomplete from './CustomerAutocomplete'
import NewClientModal from './NewClientModal'
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

// Helper to get allowed time ranges based on duration
// Saturday: continuous 9:00-17:00, Weekdays: 9:00-13:00 + 15:00-19:00
function getAllowedTimeRanges(durationMinutes: number, isSaturday: boolean = false): { start: string; end: string }[] {
  if (isSaturday) {
    const satEnd = 17 * 60 - durationMinutes // Must finish by 17:00
    const satEndHour = Math.floor(satEnd / 60)
    const satEndMin = satEnd % 60
    return [
      { start: '09:00', end: `${satEndHour.toString().padStart(2, '0')}:${satEndMin.toString().padStart(2, '0')}` }
    ]
  }

  // Weekdays: split schedule
  const morningEnd = 13 * 60 - durationMinutes // Must finish by 13:00
  const afternoonEnd = 19 * 60 - durationMinutes // Must finish by 19:00

  const morningEndHour = Math.floor(morningEnd / 60)
  const morningEndMin = morningEnd % 60
  const afternoonEndHour = Math.floor(afternoonEnd / 60)
  const afternoonEndMin = afternoonEnd % 60

  return [
    { start: '09:00', end: `${morningEndHour.toString().padStart(2, '0')}:${morningEndMin.toString().padStart(2, '0')}` },
    { start: '15:00', end: `${afternoonEndHour.toString().padStart(2, '0')}:${afternoonEndMin.toString().padStart(2, '0')}` }
  ]
}


// Generate time slots for car wash, every 5 minutes
// Weekdays: 9h-13h and 15h-18h | Saturday: 9h-17h continuous
const generateTimeSlots = (isSaturday: boolean = false) => {
  const slots: string[] = []

  if (isSaturday) {
    // Saturday: continuous 9:00-17:00
    for (let hour = 9; hour <= 17; hour++) {
      for (let minute = 0; minute < 60; minute += 5) {
        if (hour === 17 && minute > 0) break // Stop at 17:00
        const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
        slots.push(time)
      }
    }
  } else {
    // Weekdays: Morning 9h-13h
    for (let hour = 9; hour < 13; hour++) {
      for (let minute = 0; minute < 60; minute += 5) {
        const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
        slots.push(time)
      }
    }

    // Weekdays: Afternoon 15h-18h (18:00 is the maximum/last slot)
    for (let hour = 15; hour < 19; hour++) {
      for (let minute = 0; minute < 60; minute += 5) {
        const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
        if (hour === 18 && minute > 0) break
        slots.push(time)
      }
    }
  }

  return slots
}

const CAR_WASH_TIME_SLOTS = generateTimeSlots(false)
const CAR_WASH_TIME_SLOTS_SATURDAY = generateTimeSlots(true)

interface CarWashBookingsTabProps {
  initialData?: { appointmentDate?: string, appointmentTime?: string } | null
  onDataConsumed?: () => void
}

export default function CarWashBookingsTab({ initialData, onDataConsumed }: CarWashBookingsTabProps = {}) {
  const [bookings, setBookings] = useState<CarWashBooking[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [carWashServices, setCarWashServices] = useState<CarWashService[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
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

  // Vehicle classification state (Step 0)
  const [vehiclePlate, setVehiclePlate] = useState('')
  const [vehicleMakeModel, setVehicleMakeModel] = useState('')
  const [vehicleCategory, setVehicleCategory] = useState<VehicleCategory | null>(null)
  const [classificationSource, setClassificationSource] = useState<'local' | 'api' | 'manual' | null>(null)
  const [lookingUpTarga, setLookingUpTarga] = useState(false)
  const [targaVehicleInfo, setTargaVehicleInfo] = useState<{ brand?: string; model?: string; year?: string; fuel?: string; powerCV?: string } | null>(null)
  const [targaNotFound, setTargaNotFound] = useState(false)
  // OTP override for manual category selection
  const override = useLimitationOverride()
  // Foreign plate flow (Targa Estera) — requires OTP per category
  const [showForeignPlateModal, setShowForeignPlateModal] = useState(false)
  const [pendingForeignCategory, setPendingForeignCategory] = useState<'urban' | 'maxi' | null>(null)

  // Buffer for an edit-click blocked by the paid_wash_modify OTP gate.
  // Resumed by the useEffect below once the override is approved.
  const pendingEditBookingRef = useRef<CarWashBooking | null>(null)
  // Set quando il gate OTP per prenotazione_lavaggio_conferma viene aperto a
  // Salva. Quando l'OTP è approvato il useEffect ripete createBooking(force)
  // così l'operatore non deve premere di nuovo Salva.
  const pendingCreateBookingRef = useRef<{ force: boolean } | null>(null)

  // Centralized "Modifica" handler — gates paid/confirmed bookings behind OTP
  // (Valerio + Ilenia bypass server-side automatically).
  function openEditBooking(booking: CarWashBooking, opts?: { skipOtpGate?: boolean }) {
    if (!opts?.skipOtpGate) {
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

  // Resume create booking once OTP `prenotazione_lavaggio_conferma` is
  // approved — replay createBooking with the stored `force` flag so the
  // operator doesn't have to press Salva a second time.
  useEffect(() => {
    const pending = pendingCreateBookingRef.current
    if (pending && override.overrideCodes.has('prenotazione_lavaggio_conferma')) {
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
    setClassificationSource(null)
    setLookingUpTarga(false)
    setTargaVehicleInfo(null)
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
      setShowForm(true)
      if (onDataConsumed) {
        onDataConsumed()
      }
    }
  }, [initialData, onDataConsumed])

  // Populate edit service/extras when editing a booking
  useEffect(() => {
    if (editingBooking && carWashServices.length > 0) {
      const cartItems = editingBooking.booking_details?.cartItems || []
      if (cartItems.length > 0) {
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
            // Restore price option if it was a variant
            if (item.option && item.price !== foundExtra.price) {
              priceOpts[foundExtra.id] = { label: item.option, price: item.price }
            }
            // Restore quantity
            if (item.quantity && item.quantity > 1) {
              qtys[foundExtra.id] = item.quantity
            }
          }
        }
        setEditExtras(extras)
        setEditExtraPriceOptions(priceOpts)
        setEditExtraQuantities(qtys)
      } else {
        setEditService(null)
        setEditExtras([])
        setEditExtraPriceOptions({})
        setEditExtraQuantities({})
      }
    } else if (!editingBooking) {
      setEditService(null)
      setEditExtras([])
      setEditExtraPriceOptions({})
      setEditExtraQuantities({})
    }
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
        allowedTimeRanges: getAllowedTimeRanges(parseDurationToMinutes(s.duration))
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

  async function handleDeleteBooking(bookingId: string, customerName: string) {
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
            templateKey: 'pro_richiesta_pagamento',
            templateVars: (() => {
              // Keys WITH braces + tutti gli alias — come pro_richiesta_pagamento
              // può usare {amount}|{total}|{importo} e {link}|{payment_link}
              // nel corpo, passiamo ogni variante. totalEur is already the
              // pre-formatted "€X.XX" string (see declaration above).
              const amtStr = String(totalEur)
              return {
                '{customer_name}': custName,
                '{nome}': (custName || '').split(' ')[0] || 'Cliente',
                '{amount}': amtStr,
                '{total}': amtStr,
                '{importo}': amtStr,
                '{link}': linkData.paymentUrl,
                '{payment_link}': linkData.paymentUrl,
              }
            })(),
            skipHeader: true,
          })
        })
        const waResult = await waResp.json().catch(() => ({}))
        if (!waResp.ok || waResult?.skipped) {
          toast.error('Template mancante in Messaggi di Sistema Pro: pro_richiesta_pagamento', { id: toastId })
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

    // Never generate fattura for Wallet or Gift Card payments
    const pm = booking.payment_method || ''
    if (pm === 'Wallet' || pm === 'Gift Card' || pm === 'wallet' || pm === 'gift_card' || pm === 'credit') {
      toast.error('Fattura non prevista per pagamenti con Wallet o Gift Card')
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
    // Get customer details from selected customer
    const customer = customers.find(c => c.id === formData.customer_id)
    if (!customer) throw new Error('Cliente non trovato')

    // ===== OTP GATE: Conferma Prenotazione Lavaggio (toggle Gestione OTP) =====
    // La prenotazione carwash entra di default in stato 'confirmed'. Se l'OTP
    // per quest'azione e' attivo (system_otp_overrides.is_required=true)
    // chiediamo OTP. useLimitationOverride bypassa server-side se il toggle e'
    // OFF, quindi quando off questa chiamata non blocca nulla.
    if (!override.hasOverride('prenotazione_lavaggio_conferma')) {
      pendingCreateBookingRef.current = { force: forceBooking }
      override.requestOverride('prenotazione_lavaggio_conferma', 'Conferma prenotazione lavaggio richiede autorizzazione direzionale')
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
      ...(vehicleCategory && { vehicleCategory }),
      ...(vehicleMakeModel && { vehicleMakeModel }),
      ...(classificationSource && { classificationSource }),
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
      status: (formData.payment_status === 'pending' && formData.payment_method === 'Nexi Pay by Link') ? 'pending' : (formData.payment_status === 'paid' ? 'confirmed' : 'confirmed'),
      payment_status: (formData.payment_status === 'pending' && formData.payment_method === 'Nexi Pay by Link') ? 'pending' : formData.payment_status,
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

    logger.log('✅ Booking created successfully:', data)
    logAdminAction('create_carwash', 'carwash_booking', data.id, {
      ...buildCarWashContext(data),
      customer: data?.customer_name || customerName,
      service: serviceNames,
      payment_method: formData.payment_method,
      payment_status: formData.payment_status,
      amount: totalPrice,
    })

    // Generate fattura ONLY if paid — never for unpaid bookings, Wallet, or Gift Card
    const isPaid = formData.payment_status === 'paid' || formData.payment_status === 'completed' || formData.payment_status === 'succeeded'
    const skipFattura = formData.payment_method === 'Wallet' || formData.payment_method === 'Gift Card'

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
    const isNexiPayByLink = formData.payment_status === 'pending' && formData.payment_method === 'Nexi Pay by Link'
    if (isNexiPayByLink && data) {
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
            const waResp = await fetch('/.netlify/functions/send-whatsapp-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                customPhone: customerPhone,
                templateKey: 'pro_richiesta_pagamento',
                // Alias every placeholder the Pro template might use so
                // nothing leaks as raw "{...}" text to the customer.
                templateVars: {
                  customer_name: customerName || firstName,
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
              toast.error('Template mancante in Messaggi di Sistema Pro: pro_richiesta_pagamento')
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
      const paymentStatus = isNexiPayByLink ? 'unpaid' : (formData.payment_status || 'unpaid')
      const amountPaid = paymentStatus === 'paid' ? totalPrice * 100 : 0

      // Send admin notification (detailed internal format)
      await fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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

      // Send customer confirmation message (skip for Nexi — link message sent separately)
      if (customerPhone && !isNexiPayByLink) {
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

        const waResp = await fetch('/.netlify/functions/send-whatsapp-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customPhone: customerPhone,
            templateKey: 'pro_conferma_lavaggio',
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
    if (submitting) return
    setSubmitting(true)

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

      // Log overlap info but don't block the admin
      if (hasConflict && conflictingBooking) {
        logger.log('ℹ️ Overlap with existing booking:', conflictingBooking.customer_name, conflictDetails)
      }

      // Admin panel: ALWAYS create as forced booking (bypass all backend checks)
      logger.log('🔧 ADMIN PANEL: Creating booking with admin override')
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
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="text-center py-8 text-theme-text-muted">Loading...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl sm:text-2xl font-light text-dr7-gold tracking-[0.3em] uppercase">Prime Wash</h2>
        <div className="flex items-center gap-4">
          <div className="text-sm text-theme-text-muted">
            {bookings.length} prenotazion{bookings.length !== 1 ? 'i' : 'e'}
          </div>
          <button
            onClick={() => {
              if (!showForm) resetWizard()
              setShowForm(!showForm)
            }}
            className="px-4 py-2 bg-dr7-gold hover:bg-[#0A8FA3] text-white font-semibold rounded-full transition-colors"
          >
            {showForm ? 'Chiudi' : '+ Nuova Prenotazione'}
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Cerca per codice, nome, email, telefono, targa o veicolo..."
          value={bookingSearchQuery}
          onChange={(e) => setBookingSearchQuery(e.target.value)}
          className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold"
        />
      </div>

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
        onClientCreated={(clientId) => {
          setFormData(prev => ({ ...prev, customer_id: clientId }))
          setShowNewClientModal(false)
          refreshCustomers()
        }}
      />

      {showForm && (
        <div className="bg-transparent rounded-lg p-6 border border-theme-border mb-6">
          {/* Step Indicator */}
          <div className="flex items-center justify-center mb-6">
            {[
              { step: 0 as const, label: 'Veicolo' },
              { step: 1 as const, label: 'Servizio' },
              { step: 2 as const, label: 'Extra' },
              { step: 3 as const, label: 'Conferma' }
            ].map(({ step, label }, idx) => (
              <div key={step} className="flex items-center">
                <button
                  type="button"
                  onClick={() => { if (step < currentStep) setCurrentStep(step) }}
                  disabled={step > currentStep}
                  className={`flex flex-col items-center ${step <= currentStep ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                    step === currentStep
                      ? 'bg-dr7-gold text-white'
                      : step < currentStep
                        ? 'bg-dr7-gold/60 text-white'
                        : 'bg-theme-bg-tertiary text-theme-text-muted'
                  }`}>
                    {step < currentStep ? '✓' : step}
                  </div>
                  <span className={`text-xs mt-1 ${step <= currentStep ? 'text-dr7-gold' : 'text-theme-text-muted'}`}>
                    {label}
                  </span>
                </button>
                {idx < 3 && (
                  <div className={`w-12 h-0.5 mx-1.5 mb-4 ${step < currentStep ? 'bg-dr7-gold/60' : 'bg-theme-bg-tertiary'}`} />
                )}
              </div>
            ))}
          </div>

          {/* ===== STEP 0: Vehicle Identification ===== */}
          {currentStep === 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-theme-text-primary">Identificazione Veicolo</h3>

              {/* Targa + Cerca */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Targa</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setVehicleCategory(vehicleCategory === 'moto' ? null : 'moto')
                      setTargaVehicleInfo(vehicleCategory === 'moto' ? null : { brand: 'Moto', model: '' })
                    }}
                    className={`px-5 py-3 rounded-lg font-semibold text-sm transition-colors whitespace-nowrap ${
                      vehicleCategory === 'moto'
                        ? 'bg-purple-600 text-white'
                        : 'bg-purple-600/20 text-purple-400 hover:bg-purple-600/30'
                    }`}
                  >
                    Moto
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowForeignPlateModal(true)}
                    className={`px-4 py-3 rounded-lg font-semibold text-sm transition-colors whitespace-nowrap ${
                      (vehicleCategory === 'urban' || vehicleCategory === 'maxi') && targaVehicleInfo?.brand === 'Targa Estera'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30'
                    }`}
                  >
                    Targa Estera
                  </button>
                  <input
                    type="text"
                    value={vehiclePlate}
                    onChange={(e) => setVehiclePlate(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    placeholder="ES. AB123CD"
                    className="flex-1 px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary font-mono tracking-widest uppercase focus:border-dr7-gold focus:outline-none"
                    maxLength={10}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && vehiclePlate.length >= 5 && !lookingUpTarga) {
                        e.preventDefault()
                        handleTargaLookup()
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={vehiclePlate.length < 5 || lookingUpTarga}
                    onClick={handleTargaLookup}
                    className={`px-5 py-3 rounded-lg font-semibold text-sm transition-colors whitespace-nowrap ${
                      vehiclePlate.length < 5 || lookingUpTarga
                        ? 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed'
                        : 'bg-dr7-gold hover:bg-[#0A8FA3] text-white'
                    }`}
                  >
                    {lookingUpTarga ? 'Ricerca...' : 'Cerca'}
                  </button>
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
              <div className="flex justify-between items-center pt-4 border-t border-theme-border">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
                >
                  Annulla
                </button>
                <div className="flex gap-2 items-center">
                  <button
                    type="button"
                    disabled={!targaVehicleInfo}
                    onClick={() => {
                      // Clear service selection when changing step from 0 to 1 (category may have changed)
                      setSelectedService(null)
                      setSelectedPriceOption(null)
                      setSelectedExtras([])
                      setExtraPriceOptions({})
    setExtraQuantities({})
                      setCustomPrice('')
                      setCurrentStep(1)
                    }}
                    className={`px-6 py-2 rounded-full font-semibold transition-colors ${
                      targaVehicleInfo
                        ? 'bg-dr7-gold hover:bg-[#0A8FA3] text-white'
                        : 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed'
                    }`}
                  >
                    Avanti
                  </button>
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
                    vehicleCategory === 'urban' ? 'bg-blue-500/20 text-blue-400' : 'bg-orange-500/20 text-orange-400'
                  }`}>
                    {vehicleCategory === 'urban' ? 'URBAN' : 'MAXI'}
                  </span>
                  {vehicleMakeModel && <span className="text-theme-text-muted text-xs">({vehicleMakeModel})</span>}
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
                        vehicleCategory === 'urban' ? 'bg-blue-500/20 text-blue-400' : 'bg-orange-500/20 text-orange-400'
                      }`}>
                        {vehicleCategory === 'urban' ? 'URBAN' : 'MAXI'}
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
                      const allSlots = isSat ? CAR_WASH_TIME_SLOTS_SATURDAY : CAR_WASH_TIME_SLOTS

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
                          if (method === 'Nexi Pay by Link') {
                            updates.payment_status = 'pending'
                            updates.amount_paid = '0'
                          }
                          setFormData(prev => ({ ...prev, ...updates }))
                        }}
                        className="w-full appearance-none px-4 py-3 pr-10 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
                      >
                        <option value="">-- Seleziona metodo --</option>
                        <option value="Nexi Pay by Link">Nexi - Pay by Link</option>
                        <option value="Contanti">Contanti</option>
                        <option value="Carta di Credito / bancomat">Carta di Credito / bancomat</option>
                        <option value="Bonifico">Bonifico</option>
                        <option value="Credit Wallet">Credit Wallet</option>
                        <option value="Paypal">Paypal</option>
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
                  disabled={submitting || !formData.customer_id || !formData.appointment_time}
                  onClick={() => handleSubmit()}
                  className={`px-8 py-3 rounded-full font-bold text-base transition-colors ${
                    submitting || !formData.customer_id || !formData.appointment_time
                      ? 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed'
                      : 'bg-dr7-gold hover:bg-[#0A8FA3] text-white'
                  }`}
                >
                  {submitting ? 'Creazione...' : `Conferma - EUR ${getFinalPrice().toFixed(2)}`}
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
                                    booking.booking_details.vehicleCategory === 'urban' ? 'bg-blue-500/15 text-blue-400' : 'bg-orange-500/15 text-orange-400'
                                  }`}>
                                    {booking.booking_details.vehicleCategory === 'urban' ? 'U' : 'M'}
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
                              : booking.payment_method === 'Nexi Pay by Link' ? 'Nexi'
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
                                booking.booking_details.vehicleCategory === 'urban' ? 'bg-blue-500/15 text-blue-500' : 'bg-orange-500/15 text-orange-500'
                              }`}>
                                {booking.booking_details.vehicleCategory === 'urban' ? 'URBAN' : 'MAXI'}
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
                            <option value="Contanti">Contanti</option>
                            <option value="POS">POS</option>
                            <option value="Carta di credito">Carta di credito</option>
                            <option value="Carta di debito">Carta di debito</option>
                            <option value="Bonifico">Bonifico</option>
                            <option value="Wallet">Wallet</option>
                            <option value="Gift Card">Gift Card</option>
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
                      if ((isPaid || isConfirmed) && !override.hasOverride('paid_wash_modify')) {
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
                      const finalStatus = editingBooking.payment_method !== 'Nexi Pay by Link' && editingBooking.status === 'pending'
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

                      // Auto-generate fattura if payment changed to paid (skip Wallet & Gift Card)
                      const editPaymentMethod = editingBooking.payment_method || ''
                      const editSkipFattura = editPaymentMethod === 'Wallet' || editPaymentMethod === 'Gift Card'
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
