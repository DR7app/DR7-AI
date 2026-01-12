import { useState, useEffect, useMemo, useRef } from 'react'
// import { getSpecialPricing, calculateSpecialPrice } from '../../../utils/specialPricing' // Commented out - not used since auto-calc disabled
import { supabase } from '../../../supabaseClient'
import { useAdminRole } from '../../../hooks/useAdminRole'
import {
  fetchRentalEvents,
  filterRentalTimeSlots
} from '../../../utils/bookingConflictUtils'
import { validateRentalBooking } from '../../../utils/schedulingRules'
import { createRomeDate } from '../../../utils/timezoneUtils'
import {
  getAvailableVehicles,
  isVehicleAvailable,
  generateValidTimeSlots
} from '../../../utils/vehicleAvailability'
import Input from './Input'
import Select from './Select'
import Button from './Button'
import CustomerAutocomplete from './CustomerAutocomplete'
import NewClientModal from './NewClientModal'
import MissingFieldsModal from '../../../components/MissingFieldsModal'
import PenaltyModal from './PenaltyModal'

// --- Kasko Constants & Types ---
type KaskoTier = 'RCA' | 'KASKO_BASE' | 'KASKO_BLACK' | 'KASKO_SIGNATURE' | 'DR7';

// SUPERCARS (Exotic) - RCA + existing KASKO options + DR7
export const INSURANCE_OPTIONS = [
  { id: 'RCA', label: 'RCA', pricePerDay: 0 },
  { id: 'KASKO_BASE', label: 'KASKO BASE', pricePerDay: 100 },
  { id: 'KASKO_BLACK', label: 'KASKO BLACK', pricePerDay: 150 },
  { id: 'KASKO_SIGNATURE', label: 'KASKO SIGNATURE', pricePerDay: 200 },
  { id: 'DR7', label: 'DR7', pricePerDay: 300 },
];

// URBAN - RCA + Kasko Base + Kasko DR7
export const URBAN_INSURANCE_OPTIONS = [
  { id: 'RCA', label: 'RCA', pricePerDay: 0 },
  { id: 'KASKO_BASE', label: 'Kasko Base', pricePerDay: 15 },
  { id: 'DR7', label: 'Kasko DR7', pricePerDay: 45 },
];

// UTILITAIRE - RCA + Kasko Base + Kasko DR7 (same as Ducato/Vito)
export const UTILITAIRE_INSURANCE_OPTIONS = [
  { id: 'RCA', label: 'RCA', pricePerDay: 0 },
  { id: 'KASKO_BASE', label: 'Kasko Base', pricePerDay: 45 },
  { id: 'DR7', label: 'Kasko DR7', pricePerDay: 90 },
];

// FURGONE (Ducato/Vito/Tourer) - RCA + Kasko Base + Kasko DR7
export const FURGONE_INSURANCE_OPTIONS = [
  { id: 'RCA', label: 'RCA', pricePerDay: 0 },
  { id: 'KASKO_BASE', label: 'Kasko Base', pricePerDay: 45 },
  { id: 'DR7', label: 'Kasko DR7', pricePerDay: 90 },
];

// Deposit amounts by vehicle type
export const DEPOSIT_AMOUNTS = {
  UTILITAIRE: 1000,
  FURGONE: 2500, // Ducato, Vito
  SUPERCAR: 10000,
};

export const INSURANCE_ELIGIBILITY = {
  RCA: { minAge: 18, minLicenseYears: 1 },
  KASKO_BASE: { minAge: 20, minLicenseYears: 2 },
  KASKO_BLACK: { minAge: 25, minLicenseYears: 5 },
  KASKO_SIGNATURE: { minAge: 30, minLicenseYears: 10 },
  DR7: { minAge: 25, minLicenseYears: 3 },
};

export const URBAN_INSURANCE_ELIGIBILITY = {
  RCA: { minAge: 18, minLicenseYears: 1 },
  KASKO_BASE: { minAge: 18, minLicenseYears: 3 },
  KASKO_BLACK: { minAge: 25, minLicenseYears: 5 },
  KASKO_SIGNATURE: { minAge: 30, minLicenseYears: 10 },
  DR7: { minAge: 21, minLicenseYears: 2 },
};

// Generate time options for 15-minute intervals
export const TIME_OPTIONS = Array.from({ length: 96 }).map((_, i) => {
  const hour = Math.floor(i / 4).toString().padStart(2, '0')
  const minute = ((i % 4) * 15).toString().padStart(2, '0')
  const time = `${hour}:${minute}`
  return { value: time, label: time }
})

// Helper function to check if vehicle is a furgone (Ducato/Vito)
function isFurgone(vehicle?: Vehicle): boolean {
  if (!vehicle) return false;
  const name = vehicle.display_name.toLowerCase();
  return name.includes('ducato') || name.includes('vito') || name.includes('furgone');
}

// Helper function to get insurance options for vehicle
function getInsuranceOptions(vehicle?: Vehicle) {
  if (!vehicle) return INSURANCE_OPTIONS;

  // Check if it's a furgone (Ducato/Vito)
  if (isFurgone(vehicle)) {
    return FURGONE_INSURANCE_OPTIONS;
  }

  // Check vehicle category first (if set)
  if (vehicle.category === 'aziendali') {
    return UTILITAIRE_INSURANCE_OPTIONS;
  }

  if (vehicle.category === 'urban') {
    return URBAN_INSURANCE_OPTIONS;
  }

  if (vehicle.category === 'exotic') {
    return INSURANCE_OPTIONS; // SUPERCAR
  }

  // Fallback for vehicles without category (legacy)
  const name = vehicle.display_name.toLowerCase();
  if (name.includes('panda') || name.includes('captur') || name.includes('clio') ||
    name.includes('citroen') || name.includes('208') || name.includes('urban')) {
    return URBAN_INSURANCE_OPTIONS;
  }
  if (name.includes('van') || name.includes('utilitaire') || name.includes('ducato') || name.includes('vito')) {
    return UTILITAIRE_INSURANCE_OPTIONS;
  }

  return INSURANCE_OPTIONS; // SUPERCAR
}
interface Customer {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  driver_license_number: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

interface Vehicle {
  id: string
  display_name: string
  plate: string | null
  targa?: string | null
  status: 'available' | 'rented' | 'maintenance' | 'retired'
  daily_rate: number
  category?: 'exotic' | 'urban' | 'aziendali'
  metadata: Record<string, any> | null
  created_at: string
  updated_at: string
}

interface Reservation {
  id: string
  customer_id: string
  vehicle_id: string
  start_at: string
  end_at: string
  status: 'pending' | 'confirmed' | 'active' | 'completed' | 'cancelled'
  source: string | null
  total_amount: number
  currency: string
  addons: Record<string, any> | null
  created_by: string | null
  created_at: string
  updated_at: string
  customers?: Customer
  vehicles?: Vehicle
}

interface Booking {
  id: string
  user_id: string | null
  vehicle_id?: string | null // Vehicle ID for availability filtering
  vehicle_name: string
  vehicle_plate?: string | null
  vehicle_image_url: string | null
  pickup_date: string
  dropoff_date: string
  pickup_location: string
  dropoff_location: string
  price_total: number
  currency: string
  status: string
  payment_status: string
  payment_method: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  booking_details: Record<string, any> | null
  booked_at: string
  created_at: string
  updated_at: string
  // Car wash specific fields
  service_type?: string
  service_name?: string
  appointment_date?: string
  appointment_time?: string
  contract_url?: string
  km_overage_fee?: number
  contracts?: {
    yousign_status: string | null
    signed_pdf_url: string | null
    yousign_signature_request_id: string | null
  } | any
}

// Helper function to calculate car wash end time based on actual service durations
function calculateCarWashEndTime(appointmentDate: string, appointmentTime: string, priceTotal: number): string {
  // Map prices to actual durations (in hours) from the main website
  const priceToDuration: Record<number, number> = {
    2500: 1,  // 25€ 
    4900: 2,  // 49€ 
    7500: 3,     // 75€ VIP = 3 hours
    9900: 4      // 99€ DR7 LUXURY = 4 hours
  };

  const durationHours = priceToDuration[priceTotal] || 1;

  // Parse the time
  const [hours, minutes] = appointmentTime.split(':').map(Number);
  const endDate = new Date(appointmentDate);

  // Add the duration
  const totalMinutes = (durationHours * 60);
  endDate.setHours(hours);
  endDate.setMinutes(minutes + totalMinutes);

  return endDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const API_BASE = '/.netlify/functions/admin'
const API_TOKEN = import.meta.env.VITE_ADMIN_UI_TOKEN

// Helper to get next 15 minute interval
function getNext15MinuteTime(): string {
  const now = new Date()
  const minutes = now.getMinutes()
  const nextInterval = Math.ceil(minutes / 15) * 15
  now.setMinutes(nextInterval)
  now.setSeconds(0)

  const h = now.getHours().toString().padStart(2, '0')
  const m = now.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

// Helper to normalize plate strings (remove spaces, uppercase)
const normalizePlate = (s: string) => s ? s.replace(/\s+/g, '').toUpperCase() : ''

// Helper to check if a booking belongs to a vehicle
// CRITICAL: Only matches by vehicle_id or plate - NEVER by name
const isBookingForVehicle = (booking: any, vehicle: Vehicle) => {
  const bookingVehicleId = booking.vehicle_id || booking.booking_details?.vehicle_id
  if (bookingVehicleId === vehicle.id) return true

  // Try matching by plate
  if (!bookingVehicleId && booking.vehicle_plate) {
    const vPlate = vehicle.plate || vehicle.targa
    if (vPlate) {
      if (normalizePlate(booking.vehicle_plate) === normalizePlate(vPlate)) return true
    }
  }

  // NO FALLBACK TO NAME MATCHING - this is forbidden
  // Log warning if we can't match
  if (!bookingVehicleId && !booking.vehicle_plate) {
    console.warn('[Vehicle Matching] Cannot match booking - no vehicle_id or plate:', booking.id)
  }

  return false
}

export default function ReservationsTab({ initialData, onDataConsumed }: { initialData?: { vehicleName?: string; pickupDate?: Date; bookingId?: string } | null; onDataConsumed?: () => void }) {
  const { canViewFinancials } = useAdminRole()
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [carWashBookings, setCarWashBookings] = useState<Booking[]>([]) // Car wash & mechanical bookings for availability checking

  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Missing Data Modal State
  // Missing Data Modal State
  const [showMissingDataModal, setShowMissingDataModal] = useState(false)
  const [missingFields, setMissingFields] = useState<string[]>([])
  const [tempCustomerData, setTempCustomerData] = useState<any>(null)
  const [currentValidationBooking, setCurrentValidationBooking] = useState<Booking | null>(null)
  const [validationContext, setValidationContext] = useState<'contract' | 'invoice' | 'booking'>('contract')

  // Cancel Confirmation Modal State
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null)
  const [pendingCancelType, setPendingCancelType] = useState<'booking' | 'reservation'>('booking')

  // Delete Confirmation Modal State
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [pendingDeleteType, setPendingDeleteType] = useState<'booking' | 'reservation'>('booking')

  // Conflict Detection State
  const [rentalEventsPickupDate, setRentalEventsPickupDate] = useState<any[]>([])
  const [rentalEventsReturnDate, setRentalEventsReturnDate] = useState<any[]>([])

  // Valid Time Slots State (for dynamic availability-based time picker)
  const [validPickupTimes, setValidPickupTimes] = useState<string[]>([])



  // Filter time options based on selected date
  const getFilteredTimeOptions = (_dateStr: string) => {
    // Admin users can select any time, including past times
    // This allows backdating bookings for administrative purposes
    return TIME_OPTIONS
  }

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [generatingContract, setGeneratingContract] = useState(false)

  const isInitialEditLoad = useRef(false)
  const [generatingInvoice, setGeneratingInvoice] = useState(false)
  const [newSecondDriverMode, setNewSecondDriverMode] = useState(false)

  // Add custom scrollbar styles
  const scrollbarStyle = `
    .custom-scrollbar::-webkit-scrollbar {
      height: 8px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
      background: var(--color-theme-bg-secondary);
      border-radius: 10px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background: var(--color-theme-border);
      border-radius: 10px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background: var(--color-theme-text-muted);
    }
  `

  const [formData, setFormData] = useState({
    customer_id: '',
    vehicle_id: '',
    start_at: '',
    end_at: '',
    pickup_date: '',
    pickup_time: getNext15MinuteTime(),
    return_date: '',
    return_time: '10:00',
    pickup_location: 'dr7_office',
    dropoff_location: 'dr7_office',
    status: 'confirmed',
    source: 'admin',
    total_amount: '0',
    amount_paid: '0',
    payment_status: 'paid',
    payment_method: 'Contanti',
    currency: 'EUR',
    // 2nd Driver - Required fields for contract generation validation
    has_second_driver: false,
    second_driver_id: '',
    second_driver_name: '',
    second_driver_surname: '',
    second_driver_codice_fiscale: '',
    second_driver_sesso: '',
    second_driver_indirizzo: '',
    second_driver_cap: '',
    second_driver_citta: '',
    second_driver_provincia: '',
    second_driver_birth_date: '',
    second_driver_birth_place: '',
    second_driver_birth_provincia: '',
    second_driver_phone: '',
    second_driver_email: '',
    second_driver_license_type: '',
    second_driver_license_number: '',
    second_driver_license_issued_by: '',
    second_driver_license_issue_date: '',
    second_driver_license_expiry: '',
    // Kasko & Deposit
    insurance_option: 'KASKO_BASE' as KaskoTier,
    deposit: '0',
    // KM Overage Fee
    km_overage_fee: '0',
    unlimited_km: false,
    km_limit: '0', // Default KM limit when not unlimited
  })

  // Conflict Detection Effects
  useEffect(() => {
    if (formData.pickup_date) {
      fetchRentalEvents(formData.pickup_date, editingId || undefined).then(setRentalEventsPickupDate)
    } else {
      setRentalEventsPickupDate([])
    }
  }, [formData.pickup_date, editingId])

  useEffect(() => {
    if (formData.return_date) {
      fetchRentalEvents(formData.return_date, editingId || undefined).then(setRentalEventsReturnDate)
    } else {
      setRentalEventsReturnDate([])
    }
  }, [formData.return_date, editingId])

  // Auto-populate second driver fields when customer is selected
  useEffect(() => {
    if (formData.second_driver_id && !newSecondDriverMode) {
      const selectedCustomer = customers.find(c => c.id === formData.second_driver_id)
      if (selectedCustomer) {
        // Fetch full customer data from customers_extended to get all fields
        const fetchFullCustomerData = async () => {
          const { data: fullCustomer, error } = await supabase
            .from('customers_extended')
            .select('*')
            .eq('id', formData.second_driver_id)
            .single()

          if (error || !fullCustomer) {
            console.error('Error fetching full customer data for second driver:', error)
            // Fallback to basic data from customers table
            const nameParts = selectedCustomer.full_name.trim().split(' ')
            const surname = nameParts.length > 1 ? nameParts[nameParts.length - 1] : ''
            const name = nameParts.slice(0, -1).join(' ') || nameParts[0] || ''

            setFormData(prev => ({
              ...prev,
              second_driver_name: name,
              second_driver_surname: surname,
              second_driver_phone: selectedCustomer.phone || '',
              second_driver_license_number: selectedCustomer.driver_license_number || ''
            }))
            return
          }

          // Full auto-population with all fields from customers_extended
          setFormData(prev => ({
            ...prev,
            second_driver_name: fullCustomer.nome || '',
            second_driver_surname: fullCustomer.cognome || '',
            second_driver_codice_fiscale: fullCustomer.codice_fiscale || '',
            second_driver_sesso: fullCustomer.sesso || '',
            second_driver_indirizzo: fullCustomer.indirizzo || '',
            second_driver_cap: fullCustomer.codice_postale || fullCustomer.cap || '',
            second_driver_citta: fullCustomer.citta_residenza || fullCustomer.citta || '',
            second_driver_provincia: fullCustomer.provincia_residenza || fullCustomer.provincia || '',
            second_driver_birth_date: fullCustomer.data_nascita || '',
            second_driver_birth_place: fullCustomer.luogo_nascita || '',
            second_driver_birth_provincia: fullCustomer.provincia_nascita || '',
            second_driver_phone: fullCustomer.telefono || selectedCustomer.phone || '',
            second_driver_email: fullCustomer.email || selectedCustomer.email || '',
            second_driver_license_type: fullCustomer.categoria_patente || '',
            second_driver_license_number: fullCustomer.numero_patente || selectedCustomer.driver_license_number || '',
            second_driver_license_issued_by: fullCustomer.ente_rilascio || '',
            second_driver_license_issue_date: fullCustomer.data_rilascio || '',
            second_driver_license_expiry: fullCustomer.data_scadenza || ''
          }))
        }

        fetchFullCustomerData()
      }
    }
  }, [formData.second_driver_id, newSecondDriverMode, customers])

  // Handle initial data from Calendar click
  useEffect(() => {
    if (initialData && vehicles.length > 0) {
      const { vehicleName, pickupDate, bookingId } = initialData

      // If bookingId is provided, load that booking in edit mode
      if (bookingId) {
        const booking = bookings.find(b => b.id === bookingId)
        if (booking) {
          console.log('📝 Opening booking in edit mode:', bookingId)
          handleEditBooking(booking)
          // Notify parent to clear data
          if (onDataConsumed) onDataConsumed()
          return
        }
      }

      // Otherwise, create new booking with prefilled data
      // Find vehicle by name (rough match)
      const vehicle = vehicles.find(v => v.display_name === vehicleName)

      if (vehicle) {
        // Format date as YYYY-MM-DD
        const dateStr = pickupDate ? pickupDate.toISOString().split('T')[0] : ''
        const smartTime = getNext15MinuteTime()

        console.log('📅 Prefilling booking form:', { vehicle: vehicle.display_name, date: dateStr })

        setFormData(prev => ({
          ...prev,
          vehicle_id: vehicle.id,
          pickup_date: dateStr,
          pickup_time: smartTime,
          return_date: dateStr, // Default same day return? Or +1? Let's say +1 day default
          return_time: smartTime,
          // Recalculate based on logic if needed, but simple is better for now
          category: vehicle.category,
        }));

        setShowForm(true)

        // Notify parent to clear data
        if (onDataConsumed) onDataConsumed()
      }
    }
  }, [initialData, vehicles, bookings])

  const [newCustomerMode, setNewCustomerMode] = useState(false)
  const [newCustomerData, setNewCustomerData] = useState({
    tipo_cliente: 'persona_fisica' as 'persona_fisica' | 'azienda' | 'pubblica_amministrazione',
    // Persona Fisica fields
    nome: '',
    cognome: '',
    codice_fiscale: '',
    data_nascita: '',
    luogo_nascita: '',
    numero_civico: '',
    codice_postale: '',
    citta_residenza: '',
    provincia_residenza: '',
    pec: '',
    // Azienda fields
    denominazione: '',
    partita_iva: '',
    codice_destinatario: '',
    // Pubblica Amministrazione fields
    codice_univoco_pa: '',
    codice_fiscale_pa: '',
    ente_o_ufficio: '',
    citta: '',
    // Common fields (mandatory for all)
    nazione: 'Italia',
    telefono: '',
    email: '',
    indirizzo: '',
    driver_license_number: '',
    patente: ''
  })

  const [bookingSearchQuery, setBookingSearchQuery] = useState('')

  // Quick Edit Customer Modal State
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [customerToEdit, setCustomerToEdit] = useState<any>(null)

  // Penalty Modal State
  const [penaltyModalOpen, setPenaltyModalOpen] = useState(false)
  const [selectedBookingForPenalty, setSelectedBookingForPenalty] = useState<Booking | null>(null)

  // Confirmation Modal State (commented out - unused, causing build errors)
  // const [confirmationModalOpen, setConfirmationModalOpen] = useState(false)
  // const [confirmationModalConfig, setConfirmationModalConfig] = useState<{
  //   title: string
  //   message: string
  //   isDangerous?: boolean
  //   onConfirm: () => void | Promise<void>
  // } | null>(null)

  async function openEditCustomer(customerId: string) {
    if (!customerId || customerId === 'undefined') {
      alert("ID cliente non valido. Impossibile aprire la scheda cliente.")
      return
    }

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
      } else {
        throw new Error('Customer not found')
      }
    } catch (error: any) {
      console.error('Error fetching customer for edit:', error)

      // More helpful error message
      if (error.code === 'PGRST116' || error.message?.includes('not found')) {
        alert("Cliente non trovato nel database.\n\nIl cliente potrebbe essere stato creato sul sito web ma non ha ancora un profilo completo nell'admin panel.\n\nContatta il supporto tecnico per risolvere questo problema.")
      } else {
        alert("Impossibile caricare i dati del cliente per la modifica.\n\nErrore: " + (error.message || 'Errore sconosciuto'))
      }
    }
  }

  // Auto-calculate return time (pickup time - 1h30 like main website)
  const calculateReturnTime = (pickupTime: string): string => {
    if (!pickupTime) return ''
    const [hours, minutes] = pickupTime.split(':').map(Number)
    const tempDate = new Date()
    tempDate.setHours(hours, minutes, 0)
    tempDate.setMinutes(tempDate.getMinutes() - 90) // Subtract 1h30
    const returnHours = String(tempDate.getHours()).padStart(2, '0')
    const returnMinutes = String(tempDate.getMinutes()).padStart(2, '0')
    return `${returnHours}:${returnMinutes}`
  }

  // Get available vehicles based on selected dates and times
  const availableVehicles = useMemo((): Vehicle[] => {
    // If no dates selected, show all vehicles
    if (!formData.pickup_date || !formData.return_date) {
      console.log('[Vehicle Availability] No dates selected - showing all vehicles:', vehicles.length)
      return vehicles
    }

    // Use the new availability engine to filter vehicles
    const pickupTime = formData.pickup_time || '09:00'
    const returnTime = formData.return_time || '18:00'

    // Combine all bookings for availability checking
    const allBookingsForCheck = [...bookings, ...carWashBookings]

    const filteredVehicles = getAvailableVehicles(
      vehicles,
      formData.pickup_date,
      formData.return_date,
      pickupTime,
      returnTime,
      allBookingsForCheck,
      editingId || undefined
    )

    console.log('[Vehicle Availability] Filtered vehicles:', {
      total: vehicles.length,
      available: filteredVehicles.length,
      dates: `${formData.pickup_date} ${pickupTime} → ${formData.return_date} ${returnTime}`
    })

    return filteredVehicles
  }, [vehicles, formData.pickup_date, formData.return_date, formData.pickup_time, formData.return_time, bookings, carWashBookings, editingId])

  // Base vehicles for dropdown (before adding same-day availability)
  // This will be enhanced later after vehicleEarliestTimes is calculated
  const baseVehiclesForDropdown = useMemo((): Vehicle[] => {
    // Start with available vehicles
    let result = [...availableVehicles]

    // If editing, ensure selected vehicle is included
    if (editingId && formData.vehicle_id) {
      const isSelectedInResult = result.some(v => v.id === formData.vehicle_id)
      if (!isSelectedInResult) {
        const selectedVehicle = vehicles.find(v => v.id === formData.vehicle_id)
        if (selectedVehicle) {
          console.log('[Vehicle Dropdown] Adding currently selected vehicle to dropdown:', selectedVehicle.display_name)
          result = [selectedVehicle, ...result]
        }
      }
    }

    return result
  }, [availableVehicles, editingId, formData.vehicle_id, vehicles])


  // Calculate earliest available time for each vehicle based on existing bookings and automatic wash
  const vehicleEarliestTimes = useMemo(() => {
    // If no dates selected, return empty map
    if (!formData.pickup_date || !formData.return_date) return new Map<string, Date>()

    const pickupDateTime = new Date(`${formData.pickup_date}T${formData.pickup_time || '00:00'}:00`)
    const returnDateTime = new Date(`${formData.return_date}T${formData.return_time || '23:59'}:00`)

    const times = new Map<string, Date>()

    vehicles.forEach(vehicle => {
      // Find all bookings (rental AND service) for this vehicle
      const allBookings = [...bookings, ...carWashBookings].filter(booking => {
        if (editingId && booking.id === editingId) return false // Skip current booking if editing
        if (!isBookingForVehicle(booking, vehicle)) return false
        if (booking.status === 'cancelled') return false
        return true
      })

      // Find the latest end time that conflicts with our requested pickup
      let latestConflictEnd: Date | null = null

      for (const booking of allBookings) {
        const bookingStart = new Date(booking.pickup_date)
        const bookingEnd = new Date(booking.dropoff_date)

        // Check if this booking conflicts with our requested period
        // This correctly handles:
        // 1. Same-day returns (bookingEnd on pickup date)
        // 2. Multi-day bookings that span the pickup date
        // 3. Bookings that end before pickup date (no overlap = no conflict)
        const hasOverlap = (pickupDateTime < bookingEnd && returnDateTime > bookingStart)

        if (hasOverlap) {
          if (!latestConflictEnd || bookingEnd > latestConflictEnd) {
            latestConflictEnd = bookingEnd
          }
        }
      }

      // If there's a conflict, calculate earliest available time
      if (latestConflictEnd) {
        // For rental bookings, add 30min gap + 45min wash = 75 minutes total
        // This is the true earliest available time after return + automatic wash
        const earliestAvailable = new Date(latestConflictEnd.getTime() + 75 * 60 * 1000)
        times.set(vehicle.id, earliestAvailable)

        console.log(`[Earliest Time] ${vehicle.display_name}: Conflict ends at ${latestConflictEnd.toLocaleTimeString('it-IT')}, available at ${earliestAvailable.toLocaleTimeString('it-IT')} (after wash)`)
      }
    })

    return times
  }, [vehicles, bookings, carWashBookings, formData.pickup_date, formData.return_date, formData.pickup_time, formData.return_time, editingId])

  // FINAL vehicles for dropdown - includes base vehicles + same-day available vehicles
  const vehiclesForDropdown = useMemo((): Vehicle[] => {
    let result = [...baseVehiclesForDropdown]

    // Add vehicles with same-day availability
    if (formData.pickup_date && vehicleEarliestTimes.size > 0) {
      const pickupDateStr = formData.pickup_date
      const sameDayVehicles = Array.from(vehicleEarliestTimes.entries())
        .filter(([_, earliestTime]) => {
          const earliestDateStr = earliestTime.toISOString().split('T')[0]
          return earliestDateStr === pickupDateStr
        })
        .map(([vehicleId]) => vehicles.find(v => v.id === vehicleId))
        .filter((v): v is Vehicle => v !== undefined)

      // Combine and remove duplicates
      const combined = new Set([...result, ...sameDayVehicles])
      result = Array.from(combined)

      console.log('[Vehicle Dropdown] Added same-day vehicles:', sameDayVehicles.length)
    }

    return result
  }, [baseVehiclesForDropdown, formData.pickup_date, vehicles, vehicleEarliestTimes])

  // Generate valid time slots and auto-fill earliest pickup time when vehicle/dates change
  useEffect(() => {
    // Skip on initial load of edit form
    if (isInitialEditLoad.current) {
      console.log('[Vehicle Availability] Skipping initial edit load check')
      isInitialEditLoad.current = false
      return
    }

    // Only generate time slots if we have vehicle and dates selected
    if (!formData.vehicle_id || !formData.pickup_date || !formData.return_date) {
      setValidPickupTimes([])
      return
    }

    const selectedVehicle = vehicles.find(v => v.id === formData.vehicle_id)
    if (!selectedVehicle) {
      setValidPickupTimes([])
      return
    }

    // Combine all bookings for availability checking
    const allBookingsForCheck = [...bookings, ...carWashBookings]

    // Generate valid time slots for this vehicle
    const validSlots = generateValidTimeSlots(
      selectedVehicle,
      formData.pickup_date,
      formData.return_date,
      allBookingsForCheck,
      editingId || undefined
    )

    setValidPickupTimes(validSlots)

    // Auto-fill earliest valid time if not in edit mode
    if (!editingId && validSlots.length > 0) {
      const earliestValidTime = validSlots[0]

      // Only auto-adjust if current time is not in the valid slots
      if (!validSlots.includes(formData.pickup_time)) {
        console.log(`[Vehicle Availability] Auto-filling earliest valid time: ${earliestValidTime}`)

        setFormData(prev => ({ ...prev, pickup_time: earliestValidTime }))

        // Show notification if there's a significant change
        const currentTime = formData.pickup_time
        if (currentTime && currentTime !== earliestValidTime) {
          alert(
            `ℹ️ DISPONIBILITÀ AUTO\n\n` +
            `${selectedVehicle.display_name} è disponibile a partire dalle ${earliestValidTime}.\n\n` +
            `L'orario di ritiro è stato aggiornato automaticamente per rispettare:\n` +
            `• Prenotazioni esistenti\n` +
            `• 30 minuti di gap obbligatorio\n` +
            `• 45 minuti di lavaggio automatico`
          )
        }
      }
    } else if (validSlots.length === 0) {
      console.warn('[Vehicle Availability] No valid time slots available for selected vehicle and dates')
    }
  }, [formData.vehicle_id, formData.pickup_date, formData.return_date, vehicles, bookings, carWashBookings, editingId])


  const LOCATIONS = [
    { value: 'dr7_office', label: 'Viale Marconi, 229, 09131 Cagliari CA' },
    { value: 'cagliari_airport', label: 'Aeroporto di Cagliari Elmas (+€50)' }
  ]

  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    loadData()
    // Fetch current user email
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserEmail(data.user.email || null)
      }
    })
  }, [])

  // DISABLED: Auto-calculation of total amount
  // Admins will manually enter the total price
  /*
  useEffect(() => {
    // Only calculate if we have all required fields
    if (!formData.vehicle_id || !formData.pickup_date || !formData.return_date) {
      return
    }
   
    const selectedVehicle = vehicles.find(v => v.id === formData.vehicle_id)
    if (!selectedVehicle) return
   
    // Calculate number of rental days
    const pickupDate = new Date(formData.pickup_date)
    const returnDate = new Date(formData.return_date)
    const diffTime = Math.abs(returnDate.getTime() - pickupDate.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
   
    if (diffDays <= 0) return
   
    // Check for special pricing rule (e.g. Massimo Runchina)
    const customerName = customers.find(c => c.id === formData.customer_id)?.full_name
    const specialRule = getSpecialPricing(customerName)
   
    if (specialRule) {
      console.log('[ReservationsTab] Applying special pricing for:', customerName)
   
      // Calculate special total
      const specialTotal = calculateSpecialPrice(specialRule, diffDays)
   
      setFormData(prev => ({
        ...prev,
        total_amount: specialTotal.toFixed(2),
        // Force options if specified in rule
        insurance_option: specialRule.includesKasko === 'base' ? 'KASKO_BASE' : prev.insurance_option,
        // We can't easily set "unlimited KM" here as it might be a UI text, but we can store it in metadata if needed
        // For now, the price includes it.
      }))
   
      // Optional: Visual feedback could be added here or in the render
      return
    }
   
    // Standard Calculation
    // Get vehicle daily rate (convert from cents to euros)
    const vehicleDailyRate = selectedVehicle.daily_rate / 100
   
    // Get Kasko daily cost
    const kaskoOptions = getInsuranceOptions(selectedVehicle)
    const selectedKasko = kaskoOptions.find(k => k.id === formData.insurance_option)
    const kaskoDailyCost = selectedKasko?.pricePerDay || 0
   
    // Calculate total: (vehicle rate + kasko) * days
    const totalAmount = (vehicleDailyRate + kaskoDailyCost) * diffDays
   
    // Update form data with calculated total
    setFormData(prev => ({
      ...prev,
      total_amount: totalAmount.toFixed(2)
    }))
  }, [formData.vehicle_id, formData.pickup_date, formData.return_date, formData.insurance_option, vehicles, formData.customer_id, customers])
  */

  // Reset insurance option to KASKO_BASE when vehicle changes
  useEffect(() => {
    if (formData.vehicle_id) {
      const selectedVehicle = vehicles.find(v => v.id === formData.vehicle_id)
      if (!selectedVehicle) return; // Ensure a vehicle is found

      const availableOptions = getInsuranceOptions(selectedVehicle)

      // Check if current insurance option is valid for this vehicle
      const isCurrentOptionValid = availableOptions.some(opt => opt.id === formData.insurance_option)

      // If current option is not available for this vehicle, reset to KASKO_BASE
      if (!isCurrentOptionValid) {
        setFormData(prev => ({ ...prev, insurance_option: 'KASKO_BASE' }))
      }
    }
  }, [formData.vehicle_id, vehicles, formData.insurance_option])


  async function loadData() {
    setLoading(true)
    try {
      // Fetch ALL bookings to ensure we don't filter out NULLs or unexpected values via SQL
      // We will filter client-side to be 100% sure we get what we want
      const { data: allBookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .order('created_at', { ascending: false })

      // Fetch contracts separately to avoid join issues
      const { data: contractsData, error: contractsError } = await supabase
        .from('contracts')
        .select('booking_id, yousign_status, signed_pdf_url, yousign_signature_request_id')

      const contractsMap = new Map()
      if (contractsData) {
        contractsData.forEach(c => {
          contractsMap.set(c.booking_id, c)
        })
      }

      if (contractsError) {
        console.error('Failed to load contracts:', contractsError)
      }

      if (bookingsError) {
        console.error('Failed to load bookings:', bookingsError)
      }

      // Client-side filter: 
      // Keep if service_type is NOT 'car_wash' AND NOT 'mechanical_service'
      // We removed the !b.service_name check because some rental bookings might have it populated now

      // First, extract car wash and mechanical bookings for availability checking
      const carWashAndMechanicalBookings = (allBookings || []).filter(b =>
        b.service_type === 'car_wash' ||
        b.service_type === 'mechanical_service' ||
        b.service_type === 'mechanical'
      )

      console.log('[ReservationsTab] Car wash/mechanical bookings:', carWashAndMechanicalBookings.length)
      setCarWashBookings(carWashAndMechanicalBookings)

      // Then filter out service bookings from main bookings display
      const filteredBookings = (allBookings || []).filter(b =>
        b.service_type !== 'car_wash' &&
        b.service_type !== 'mechanical_service' &&
        b.service_type !== 'mechanical_service' &&
        b.service_type !== 'mechanical'
      ).map(b => ({
        ...b,
        contracts: contractsMap.get(b.id) || null
      }))

      console.log('[ReservationsTab] Bookings fetched (raw):', allBookings?.length)
      console.log('[ReservationsTab] Bookings after filter:', filteredBookings.length)

      if (filteredBookings.length > 0) {
        console.log('[ReservationsTab] First booking sample:', filteredBookings[0])
      }

      setBookings(filteredBookings)

      // Fetch customers from bookings table (same as CustomersTab)
      const { data: bookingsForCustomers, error: bookingsCustomerError } = await supabase
        .from('bookings')
        .select('customer_name, customer_email, customer_phone, user_id, booked_at, booking_details')
        .order('booked_at', { ascending: false })
        .range(0, 9999)

      if (bookingsCustomerError) {
        console.error('Failed to load customers from bookings:', bookingsCustomerError)
      }

      // CRITICAL FIX: Use customer ID as the canonical Map key
      // This ensures no duplicates and all customers from customers_extended are loaded
      const customerMap = new Map<string, Customer>()

      if (bookingsForCustomers) {
        bookingsForCustomers.forEach((booking: any) => {
          const details = booking.booking_details?.customer || {}
          const customerName = booking.customer_name || details.fullName || 'Cliente'
          const customerEmail = booking.customer_email || details.email || null
          const customerPhone = booking.customer_phone || details.phone || null

          // Only create customer entry if we have a valid UUID for user_id
          // Otherwise, skip it - the customer will be loaded from customers_extended table
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
          const hasValidUserId = booking.user_id && uuidRegex.test(booking.user_id)

          if (!hasValidUserId) {
            // Skip customers without valid UUID - they'll come from customers_extended
            return
          }

          // ✅ FIX: Always use user_id (UUID) as the Map key
          const existing = customerMap.get(booking.user_id)
          if (existing) {
            // Update existing entry with additional data
            if (!existing.phone && customerPhone) existing.phone = customerPhone
            if (!existing.email && customerEmail) existing.email = customerEmail
            if (existing.full_name === 'Cliente' && customerName) existing.full_name = customerName
          } else {
            // Create new entry with user_id as key
            customerMap.set(booking.user_id, {
              id: booking.user_id, // Always a valid UUID at this point
              full_name: customerName,
              email: customerEmail,
              phone: customerPhone,
              driver_license_number: null,
              notes: null,
              created_at: booking.booked_at,
              updated_at: booking.booked_at
            })
          }
        })
      }

      console.log('[ReservationsTab] Customers from bookings:', customerMap.size)

      // Also fetch from customers_extended (the main source of truth)
      const { data: customersExtendedData, error: customersExtendedError } = await supabase
        .from('customers_extended')
        .select('*')
        .order('created_at', { ascending: false })
        .range(0, 9999)

      if (customersExtendedError) {
        console.error('Failed to load customers_extended:', customersExtendedError)
      } else if (customersExtendedData) {
        console.log('[ReservationsTab] Customers from customers_extended:', customersExtendedData.length)

        customersExtendedData.forEach((c: any) => {
          // Map to local Customer interface
          let fullName = 'N/A'
          if (c.tipo_cliente === 'azienda') {
            fullName = c.denominazione || c.ragione_sociale || 'N/A'
          } else if (c.tipo_cliente === 'persona_fisica') {
            fullName = `${c.nome || ''} ${c.cognome || ''}`.trim() || 'N/A'
          } else if (c.tipo_cliente === 'pubblica_amministrazione') {
            fullName = c.ente_ufficio || 'N/A'
          }

          const mappedCustomer: Customer = {
            id: c.id,
            full_name: fullName,
            email: c.email || null,
            phone: c.telefono || null,
            driver_license_number: c.numero_patente || null,
            notes: c.note || null,
            created_at: c.created_at,
            updated_at: c.updated_at || c.created_at
          }

          // ✅ FIX: ALWAYS use customer ID as the Map key
          // This is the authoritative source - it will overwrite any booking-derived data
          customerMap.set(c.id, mappedCustomer)
        })
      }

      console.log('[ReservationsTab] Total unique customers after customers_extended:', customerMap.size)

      // Also check legacy customers table if it exists (for backward compatibility)
      const { data: customersTableData, error: customersTableError } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false })
        .range(0, 9999)

      if (!customersTableError && customersTableData) {
        customersTableData.forEach(c => {
          // Only add if not already in map (customers_extended takes precedence)
          if (!customerMap.has(c.id)) {
            customerMap.set(c.id, c)
          }
        })
      }


      const customersArray = Array.from(customerMap.values())
      console.log('✅ CUSTOMERS LOADED:', customersArray.length, customersArray)
      console.log('📊 Customer sources breakdown:', {
        fromBookings: customerMap.size - (customersExtendedData?.length || 0),
        fromCustomersExtended: customersExtendedData?.length || 0,
        fromLegacyCustomers: customersTableData?.length || 0,
        totalUnique: customersArray.length
      })

      // Debug: Check if Riccardo Pilia is in the list
      const riccardoPilia = customersArray.find(c =>
        c.full_name?.toLowerCase().includes('riccardo') &&
        c.full_name?.toLowerCase().includes('pilia')
      )
      console.log('[DEBUG] Riccardo Pilia in customers array:', riccardoPilia)

      // Debug: Show first 10 customer names
      console.log('[DEBUG] First 10 customers:', customersArray.slice(0, 10).map(c => ({
        id: c.id,
        name: c.full_name,
        email: c.email,
        phone: c.phone
      })))

      setCustomers(customersArray)

      const { data: vehiclesData, error: vehiclesError } = await supabase
        .from('vehicles')
        .select('*')
        .neq('status', 'retired')
        .order('display_name')

      if (vehiclesError) {
        console.error('Failed to load vehicles:', vehiclesError)
      } else {
        console.log('[Vehicle Loading] Total vehicles loaded:', vehiclesData?.length || 0)
        console.log('[Vehicle Loading] Vehicle details:', vehiclesData?.map(v => ({
          name: v.display_name,
          plate: v.plate || v.targa,
          status: v.status,
          category: v.category,
          id: v.id
        })))
        setVehicles(vehiclesData || [])
      }

      // Fetch reservations from API (if available)
      try {
        const resData = await fetch(`${API_BASE}/reservations`, {
          headers: { 'Authorization': `Bearer ${API_TOKEN}` }
        }).then(async r => {
          if (!r.ok) {
            console.error('Reservations API error:', r.status, await r.text())
            return { data: [] }
          }
          return r.json()
        })

        setReservations(resData.data || [])

        console.log('Loaded data:', {
          reservations: resData.data?.length || 0,
          customers: customersArray.length,
          vehicles: vehiclesData?.length || 0
        })
      } catch (apiError) {
        console.error('API fetch error:', apiError)
        setReservations([])
      }
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  function handleCancelBooking(bookingId: string, bookingType: 'booking' | 'reservation') {
    // Show custom confirmation modal instead of browser confirm
    setPendingCancelId(bookingId)
    setPendingCancelType(bookingType)
    setShowCancelConfirm(true)
  }

  async function confirmCancelBooking() {
    if (!pendingCancelId) return

    const bookingId = pendingCancelId
    const bookingType = pendingCancelType

    // Close modal and reset state
    setShowCancelConfirm(false)
    setPendingCancelId(null)

    try {
      // Get booking details before cancelling
      let customerName = ''
      let vehicleName = ''
      let vehiclePlate = ''

      if (bookingType === 'booking') {
        const booking = bookings.find(b => b.id === bookingId)
        customerName = booking?.customer_name || ''
        vehicleName = booking?.vehicle_name || ''
        vehiclePlate = booking?.vehicle_plate || ''

        // Cancel booking in bookings table
        const { error } = await supabase
          .from('bookings')
          .update({ status: 'cancelled' })
          .eq('id', bookingId)

        if (error) {
          console.error('Failed to cancel booking:', error)
          throw new Error('Failed to cancel booking')
        }
      } else {
        const reservation = reservations.find(r => r.id === bookingId)
        customerName = reservation?.customers?.full_name || ''
        vehicleName = reservation?.vehicles?.display_name || ''
        vehiclePlate = reservation?.vehicles?.plate || reservation?.vehicles?.targa || ''

        // Cancel reservation via API
        const res = await fetch(`${API_BASE}/reservations`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ id: bookingId, status: 'cancelled' })
        })

        if (!res.ok) throw new Error('Failed to cancel reservation')
      }

      // Delete Google Calendar event
      try {
        await fetch('/.netlify/functions/delete-calendar-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId,
            customerName,
            vehicleName
          })
        })
        console.log('✅ Calendar event deleted successfully')
      } catch (calendarError) {
        console.error('⚠️ Failed to delete calendar event:', calendarError)
        // Don't fail the whole cancellation if calendar delete fails
      }

      // Show success message that stays visible for 3 seconds
      const successMessage = `✅ Prenotazione cancellata con successo!\n\nCliente: ${customerName}\nVeicolo: ${vehicleName}\nTarga: ${vehiclePlate}\n\nLa prenotazione è stata annullata e rimossa dal calendario.`

      // Use a combination of alert and setTimeout to ensure visibility
      setTimeout(() => {
        alert(successMessage)
      }, 100) // Small delay to ensure the cancellation completes first

      loadData()
    } catch (error) {
      console.error('Failed to cancel booking:', error)
      alert('❌ Errore durante la cancellazione:\n\n' + (error as Error).message)
    }
  }

  // Validate customer data before contract generation
  async function validateCustomerData(booking: Booking): Promise<string[]> {
    // Check multiple possible locations for customer ID
    const customerId = booking.user_id ||
      booking.booking_details?.customer?.id ||
      booking.booking_details?.customer_id

    let customer = null

    // Try to fetch customer by ID first
    if (customerId) {
      const { data: cData, error } = await supabase
        .from('customers_extended')
        .select('*')
        .eq('id', customerId)
        .single()

      if (cData) {
        console.log('[validateCustomerData] ✅ Found customer by ID:', customerId)
        customer = cData
      } else if (error) {
        console.error('[validateCustomerData] Error fetching customer by ID:', error)
      }
    }

    // Fallback: Try by email if no customer found yet
    if (!customer && booking.customer_email) {
      console.log('[validateCustomerData] Fallback: Fetching by email from customers_extended...')
      const { data: cData, error } = await supabase
        .from('customers_extended')
        .select('*')
        .eq('email', booking.customer_email)
        .maybeSingle()

      if (cData) {
        console.log('[validateCustomerData] ✅ Found customer by email:', booking.customer_email)
        customer = cData
      } else if (error) {
        console.error('[validateCustomerData] Error fetching by email:', error)
      }
    }

    // Fallback: Try by phone if still no customer found
    if (!customer && booking.customer_phone) {
      console.log('[validateCustomerData] Fallback: Fetching by phone from customers_extended...')
      const { data: cData, error } = await supabase
        .from('customers_extended')
        .select('*')
        .eq('telefono', booking.customer_phone)
        .maybeSingle()

      if (cData) {
        console.log('[validateCustomerData] ✅ Found customer by phone:', booking.customer_phone)
        customer = cData
      } else if (error) {
        console.error('[validateCustomerData] Error fetching by phone:', error)
      }
    }

    // If still no customer found, check if we have basic booking info to proceed
    if (!customer) {
      const missing: string[] = []

      // Only add fields that are truly missing from booking data
      if (!booking.customer_name && !booking.booking_details?.customer?.fullName) {
        missing.push('nome', 'cognome')
      }
      if (!booking.customer_email) missing.push('email')
      if (!booking.customer_phone) missing.push('telefono')

      // If we have basic contact info, let the backend handle it (it has the same fallback logic)
      if (booking.customer_email || booking.customer_phone) {
        console.log('[validateCustomerData] No customer record found, but booking has contact info. Backend will handle fallback.')
        return []
      }

      // If we are here, we truly have no way to identify the customer
      console.error('[validateCustomerData] ❌ No customer found by any method and no contact info in booking')
      throw new Error('Impossibile recuperare i dati del cliente dal database. Verifica che il cliente esista nella tab Clienti.')
    }

    // Validate customer data completeness
    const missing: string[] = []

    // Common fields
    if (!customer.codice_fiscale) missing.push('codice_fiscale')
    if (!customer.indirizzo) missing.push('indirizzo')
    if (!customer.citta_residenza && !customer.citta) missing.push('citta_residenza') // Handle different naming

    // Persona Fisica specific
    if (customer.tipo_cliente === 'persona_fisica') {
      if (!customer.data_nascita) missing.push('data_nascita')
      if (!customer.luogo_nascita) missing.push('luogo_nascita')
      if (!customer.patente) missing.push('patente')
    }

    // Azienda specific
    if (customer.tipo_cliente === 'azienda' && !customer.partita_iva) {
      missing.push('partita_iva')
    }

    return missing
  }

  async function handleGenerateContract(booking: Booking, showSuccessAlert = true) {
    console.log('[ReservationsTab] 🖱️ Generating contract for booking:', booking.id)
    if (!booking.id) {
      console.error('[ReservationsTab] ❌ No booking ID found')
      return
    }

    // 1. Validate Data
    let missing: string[]
    try {
      missing = await validateCustomerData(booking)
    } catch (error: any) {
      console.error('[handleGenerateContract] Validation error:', error)
      alert('❌ ' + error.message)
      return
    }

    if (missing.length > 0) {
      console.warn('⚠️ Missing fields for contract:', missing)

      // Fetch full customer data to populate modal
      const customerId = booking.user_id || booking.booking_details?.customer?.id || booking.booking_details?.customer_id
      let customerData = {}

      if (customerId) {
        const { data: customer } = await supabase.from('customers_extended').select('*').eq('id', customerId).single()
        console.log('[handleGenerateContract] Fetched customer for ID:', customerId, customer)
        customerData = customer || { id: customerId } // CRITICAL: Always include the ID even if fetch fails
      } else {
        // No customer ID, but we might have data from booking
        const nameParts = (booking.customer_name || booking.booking_details?.customer?.fullName || '').split(' ')
        customerData = {
          nome: nameParts[0] || '',
          cognome: nameParts.slice(1).join(' ') || '',
          email: booking.customer_email || '',
          telefono: booking.customer_phone || ''
        }
      }

      setMissingFields(missing)
      setTempCustomerData(customerData)
      setCurrentValidationBooking(booking)
      setValidationContext('contract')
      setShowMissingDataModal(true)
      return
    }

    setGeneratingContract(true)
    try {
      // Use the new generic contract generation function
      const response = await fetch('/.netlify/functions/generate-contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate contract')
      }

      if (data.url) {
        // Try to open the PDF in a new tab
        const pdfWindow = window.open(data.url, '_blank')

        // Reload data to show the contract link and Yousign button in the UI
        await loadData()

        if (showSuccessAlert) {
          // Check if popup was blocked
          if (!pdfWindow || pdfWindow.closed || typeof pdfWindow.closed === 'undefined') {
            // Popup was blocked - show alert with manual link
            if (confirm('✅ Contratto generato con successo!\n\n⚠️ Il browser ha bloccato l\'apertura automatica del PDF.\n\nClicca OK per aprire il contratto in una nuova scheda.')) {
              window.location.href = data.url
            }
          } else {
            // Popup opened successfully
            alert('✅ Contratto generato con successo!\n\n📄 Il PDF si è aperto in una nuova scheda per la revisione.\n\n✍️ Dopo aver verificato il contratto, clicca "Invia a Yousign" per inviarlo al cliente.')
          }
        }
      } else {
        if (showSuccessAlert) {
          alert('Contratto generato, ma URL non disponibile.')
        }
      }
    } catch (error: any) {
      console.error('Error generating contract:', error)
      alert('Errore nella generazione del contratto: ' + error.message + '\n\nAssicurati di aver caricato "master_contract.pdf" in Supabase Storage > contracts > templates.')
    } finally {
      setGeneratingContract(false)
    }
  }

  async function handleGenerateInvoice(booking: Booking) {
    if (!booking.id) return

    // 1. Validate Data for Invoice
    let missing: string[]
    try {
      missing = await validateCustomerData(booking)
    } catch (error: any) {
      console.error('[handleGenerateInvoice] Validation error:', error)
      alert('❌ ' + error.message)
      return
    }

    if (missing.length > 0) {
      console.warn('⚠️ Missing fields for invoice:', missing)

      const customerId = booking.user_id || booking.booking_details?.customer?.id || booking.booking_details?.customer_id
      let customerData = {}

      if (customerId) {
        const { data: customer } = await supabase.from('customers_extended').select('*').eq('id', customerId).single()
        customerData = customer || {}
      } else {
        // No customer ID, but we might have data from booking
        const nameParts = (booking.customer_name || booking.booking_details?.customer?.fullName || '').split(' ')
        customerData = {
          nome: nameParts[0] || '',
          cognome: nameParts.slice(1).join(' ') || '',
          email: booking.customer_email || '',
          telefono: booking.customer_phone || ''
        }
      }

      setMissingFields(missing)
      setTempCustomerData(customerData)
      setCurrentValidationBooking(booking)
      setValidationContext('invoice')
      setShowMissingDataModal(true)
      return
    }

    // Include IVA (22%) in invoice breakdown
    const includeIVA = true

    setGeneratingInvoice(true)
    try {
      const response = await fetch('/.netlify/functions/generate-invoice-from-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, includeIVA })
      })

      const data = await response.json()
      if (!response.ok) {
        if (data.invoiceNumber) {
          alert(`⚠️ Fattura già esistente per questa prenotazione:\n\nNumero: ${data.invoiceNumber}\n\nVai alla tab "Fatture" per visualizzarla.`)
        } else {
          // Show detailed error from backend
          const errorMsg = data.message || data.error || 'Impossibile generare la fattura'
          const errorDetails = data.details ? `\n\nDettagli: ${data.details}` : ''
          const errorHint = data.hint ? `\n\nSuggerimento: ${data.hint}` : ''
          throw new Error(errorMsg + errorDetails + errorHint)
        }
        return
      }

      // Generate and open the invoice PDF
      const invoiceId = data.invoice.id
      const pdfResponse = await fetch('/.netlify/functions/generate-invoice-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId })
      })

      if (pdfResponse.ok) {
        const html = await pdfResponse.text()
        // Create a blob URL and open it
        const blob = new Blob([html], { type: 'text/html' })
        const url = URL.createObjectURL(blob)
        const printWindow = window.open(url, '_blank')

        if (printWindow) {
          // Clean up the blob        if (printWindow) {
          setTimeout(() => URL.revokeObjectURL(url), 3000)
          alert(`✅ Fattura generata con successo!\n\nNumero: ${data.invoice.numero_fattura}\n\nLa fattura è stata aperta in una nuova finestra.`)
        } else {
          alert(`✅ Fattura generata con successo!\n\nNumero: ${data.invoice.numero_fattura}\n\nVai alla tab "Fatture" per visualizzarla.`)
        }
      } else {
        alert(`✅ Fattura generata con successo!\n\nNumero: ${data.invoice.numero_fattura}\n\nVai alla tab "Fatture" per visualizzarla.`)
      }

      loadData()
    } catch (error: any) {
      console.error('Error generating invoice:', error)
      const errorMessage = error.message || ''

      // Check for validation errors (missing address/tax code)
      if (errorMessage.includes('obbligatorio') || errorMessage.includes('incomplete') || errorMessage.includes('required') || errorMessage.includes('missing')) {
        if (booking.user_id && confirm(`${errorMessage}\n\nVuoi aprire la scheda cliente per aggiungere i dati mancanti ora?`)) {
          openEditCustomer(booking.user_id)
          return
        }
      }

      alert('Errore nella generazione della fattura:\n\n' + errorMessage)
    } finally {
      setGeneratingInvoice(false)
    }
  }

  function handleDeleteBooking(bookingId: string, bookingType: 'booking' | 'reservation') {
    // Show custom confirmation modal instead of browser confirm
    setPendingDeleteId(bookingId)
    setPendingDeleteType(bookingType)
    setShowDeleteConfirm(true)
  }

  async function confirmDeleteBooking() {
    if (!pendingDeleteId) return

    const bookingId = pendingDeleteId
    const bookingType = pendingDeleteType

    // Close modal and reset state
    setShowDeleteConfirm(false)
    setPendingDeleteId(null)

    try {
      // Get booking details before deleting
      let customerName = ''
      let vehicleName = ''

      if (bookingType === 'booking') {
        const booking = bookings.find(b => b.id === bookingId)
        customerName = booking?.customer_name || ''
        vehicleName = booking?.vehicle_name || ''

        // First, delete any related contracts to avoid foreign key constraint
        const { error: contractDeleteError } = await supabase
          .from('contracts')
          .delete()
          .eq('booking_id', bookingId)

        if (contractDeleteError) {
          console.warn('Failed to delete related contracts:', contractDeleteError)
          // Don't fail the whole operation, just log it
        }

        // Try server-side deletion first (bypasses RLS)
        try {
          const response = await fetch('/.netlify/functions/delete-booking', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId })
          })

          const data = await response.json()

          if (!response.ok) {
            console.warn('Server-side deletion failed, attempting client-side fallback...', data.error)
            throw new Error(data.error || 'Failed to delete booking')
          }
        } catch (serverError) {
          // Fallback to client-side deletion (requires RLS fix)
          console.log('Attempting client-side deletion fallback...')

          // Try to cancel first to bypass constraints
          await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)

          // Manually delete related records if server-side failed (Cascade emulation)
          console.log('Client-side cascade: Deleting related records...')
          await supabase.from('fatture').delete().eq('booking_id', bookingId)
          await supabase.from('contracts').delete().eq('booking_id', bookingId)

          const { error: clientError } = await supabase
            .from('bookings')
            .delete()
            .eq('id', bookingId)

          if (clientError) {
            console.error('Client-side deletion also failed:', clientError)
            // Throw the original server error if client error is about permissions, 
            // otherwise throw client error
            throw new Error(
              clientError.code === '42501'
                ? 'Permission denied. Please run the fix_bookings_rls.sql script in Supabase.'
                : clientError.message
            )
          }
        }
      } else {
        const reservation = reservations.find(r => r.id === bookingId)
        customerName = reservation?.customers?.full_name || ''
        vehicleName = reservation?.vehicles?.display_name || ''

        // Delete reservation via API
        const res = await fetch(`${API_BASE}/reservations`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ id: bookingId })
        })

        if (!res.ok) throw new Error('Failed to delete reservation')
      }

      // Delete Google Calendar event
      try {
        await fetch('/.netlify/functions/delete-calendar-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId,
            customerName,
            vehicleName
          })
        })
        console.log('✅ Calendar event deleted successfully')
      } catch (calendarError) {
        console.error('⚠️ Failed to delete calendar event:', calendarError)
        // Don't fail the whole deletion if calendar delete fails
      }

      alert('✅ Prenotazione eliminata definitivamente')
      loadData()
    } catch (error) {
      console.error('Failed to delete booking:', error)
      alert('Errore durante l\'eliminazione: ' + (error as Error).message)
    }
  }



  function handleEditBooking(booking: Booking) {
    // Only handle car rental bookings - car wash bookings are in CarWashBookingsTab
    if (booking.service_type === 'car_wash') {
      alert('Le prenotazioni lavaggio devono essere modificate nella tab "Prenotazioni Lavaggio"')
      return
    }

    // Set flag to suppress initial availability check
    isInitialEditLoad.current = true

    // Set customer data - Match the field path used in validateCustomerData
    const customerId = booking.user_id ||
      booking.booking_details?.customer?.id ||
      booking.booking_details?.customer?.customerId ||
      booking.booking_details?.customer_id ||
      ''

    // Populate rental data
    const pickupDate = booking.pickup_date ? new Date(typeof booking.pickup_date === 'number' ? booking.pickup_date * 1000 : booking.pickup_date) : null
    const dropoffDate = booking.dropoff_date ? new Date(typeof booking.dropoff_date === 'number' ? booking.dropoff_date * 1000 : booking.dropoff_date) : null

    // COMPREHENSIVE VEHICLE MATCHING LOGIC
    console.log('[handleEditBooking] 🔍 VEHICLE SEARCH INITIATED')
    console.log('[handleEditBooking] Booking data:', {
      id: booking.id,
      vehicle_id: booking.vehicle_id,
      vehicle_plate: booking.vehicle_plate,
      vehicle_name: booking.vehicle_name,
      booking_details_vehicle_id: booking.booking_details?.vehicle_id,
      booking_details_vehicle_name: booking.booking_details?.vehicle_name,
      booking_details_vehicle_plate: booking.booking_details?.vehicle_plate
    })
    console.log('[handleEditBooking] Available vehicles:', vehicles.length)
    console.log('[handleEditBooking] Vehicles list:', vehicles.map(v => ({
      id: v.id,
      name: v.display_name,
      plate: v.plate || v.targa
    })))

    let vehicle: Vehicle | undefined = undefined
    let matchMethod = 'NONE'

    // Method 1: Match by vehicle_id (top-level)
    if (!vehicle && booking.vehicle_id) {
      vehicle = vehicles.find(v => v.id === booking.vehicle_id)
      if (vehicle) {
        matchMethod = 'vehicle_id (top-level)'
        console.log('[handleEditBooking] ✅ Found by vehicle_id:', vehicle.display_name)
      }
    }

    // Method 2: Match by booking_details.vehicle_id
    if (!vehicle && booking.booking_details?.vehicle_id) {
      vehicle = vehicles.find(v => v.id === (booking.booking_details?.vehicle_id || ''))
      if (vehicle) {
        matchMethod = 'booking_details.vehicle_id'
        console.log('[handleEditBooking] ✅ Found by booking_details.vehicle_id:', vehicle.display_name)
      }
    }

    // Method 3: Match by plate (top-level)
    if (!vehicle && booking.vehicle_plate) {
      const bPlate = normalizePlate(booking.vehicle_plate)
      vehicle = vehicles.find(v => {
        const vPlate = normalizePlate(v.plate || v.targa || '')
        return vPlate && bPlate && vPlate === bPlate
      })
      if (vehicle) {
        matchMethod = 'vehicle_plate (top-level)'
        console.log('[handleEditBooking] ✅ Found by plate:', vehicle.display_name)
      }
    }

    // Method 4: Match by booking_details.vehicle_plate
    if (!vehicle && booking.booking_details?.vehicle_plate) {
      const bPlate = normalizePlate(booking.booking_details.vehicle_plate)
      vehicle = vehicles.find(v => {
        const vPlate = normalizePlate(v.plate || v.targa || '')
        return vPlate && bPlate && vPlate === bPlate
      })
      if (vehicle) {
        matchMethod = 'booking_details.vehicle_plate'
        console.log('[handleEditBooking] ✅ Found by booking_details.vehicle_plate:', vehicle.display_name)
      }
    }

    // Method 5: Exact name match (top-level)
    if (!vehicle && booking.vehicle_name) {
      vehicle = vehicles.find(v => v.display_name === booking.vehicle_name)
      if (vehicle) {
        matchMethod = 'vehicle_name (exact)'
        console.log('[handleEditBooking] ✅ Found by exact name:', vehicle.display_name)
      }
    }

    // Method 6: Exact name match (booking_details)
    if (!vehicle && booking.booking_details?.vehicle_name) {
      vehicle = vehicles.find(v => v.display_name === (booking.booking_details?.vehicle_name || ''))
      if (vehicle) {
        matchMethod = 'booking_details.vehicle_name (exact)'
        console.log('[handleEditBooking] ✅ Found by booking_details.vehicle_name:', vehicle.display_name)
      }
    }

    // Method 7: Partial name match (top-level)
    if (!vehicle && booking.vehicle_name) {
      const bookingNameLower = booking.vehicle_name.toLowerCase().trim()
      vehicle = vehicles.find(v => {
        const vNameLower = v.display_name.toLowerCase().trim()
        return vNameLower.includes(bookingNameLower) || bookingNameLower.includes(vNameLower)
      })
      if (vehicle) {
        matchMethod = 'vehicle_name (partial)'
        console.log('[handleEditBooking] ✅ Found by partial name match:', vehicle.display_name)
      }
    }

    // Method 8: Partial name match (booking_details)
    if (!vehicle && booking.booking_details?.vehicle_name) {
      const bookingNameLower = (booking.booking_details?.vehicle_name || '').toLowerCase().trim()
      vehicle = vehicles.find(v => {
        const vNameLower = v.display_name.toLowerCase().trim()
        return vNameLower.includes(bookingNameLower) || bookingNameLower.includes(vNameLower)
      })
      if (vehicle) {
        matchMethod = 'booking_details.vehicle_name (partial)'
        console.log('[handleEditBooking] ✅ Found by booking_details partial name:', vehicle.display_name)
      }
    }

    // FINAL RESULT
    if (!vehicle) {
      console.error('[handleEditBooking] ❌ WARNING: VEHICLE NOT FOUND AFTER ALL METHODS!')
      console.error('[handleEditBooking] Booking will open with vehicle_id preserved, but vehicle may not be in dropdown.')
      console.warn('[handleEditBooking] Vehicle data from booking:', {
        vehicle_id: booking.vehicle_id,
        vehicle_plate: booking.vehicle_plate,
        vehicle_name: booking.vehicle_name,
        booking_details_vehicle_id: booking.booking_details?.vehicle_id
      })

      // Show warning but allow editing
      alert(
        '⚠️ ATTENZIONE\n\n' +
        'Il veicolo associato a questa prenotazione non è stato trovato nella lista veicoli corrente.\n\n' +
        'Possibili cause:\n' +
        '• Il veicolo è stato ritirato o rimosso\n' +
        '• Problema di sincronizzazione dati\n\n' +
        'Dati veicolo nella prenotazione:\n' +
        `• ID: ${booking.vehicle_id || 'N/A'}\n` +
        `• Targa: ${booking.vehicle_plate || 'N/A'}\n` +
        `• Nome: ${booking.vehicle_name || 'N/A'}\n\n` +
        'Puoi comunque modificare la prenotazione selezionando un nuovo veicolo.'
      )
    } else {
      console.log(`[handleEditBooking] ✅ VEHICLE MATCHED: ${vehicle.display_name} (via ${matchMethod})`)
    }


    // Extract location codes from booking_details
    const pickupLoc = booking.booking_details?.pickupLocation || 'dr7_office'
    const dropoffLoc = booking.booking_details?.dropoffLocation || 'dr7_office'

    setFormData({
      ...formData,
      customer_id: customerId,
      // CRITICAL FIX: Preserve original vehicle_id even if vehicle not found in current vehicles array
      // This handles cases where vehicle might be retired or temporarily unavailable
      vehicle_id: vehicle?.id || booking.vehicle_id || booking.booking_details?.vehicle_id || '',
      // CRITICAL: Convert UTC times from database to Europe/Rome timezone
      // Database stores in UTC, we need to add the Rome timezone offset to get local time
      // Create a date in Rome timezone to get the correct offset
      pickup_date: pickupDate ? (() => {
        const romeDate = new Date(pickupDate.toLocaleString('en-US', { timeZone: 'Europe/Rome' }))
        return romeDate.toISOString().split('T')[0]
      })() : '',
      pickup_time: pickupDate ? (() => {
        const romeDate = new Date(pickupDate.toLocaleString('en-US', { timeZone: 'Europe/Rome' }))
        return romeDate.toTimeString().substring(0, 5)
      })() : '',
      return_date: dropoffDate ? (() => {
        const romeDate = new Date(dropoffDate.toLocaleString('en-US', { timeZone: 'Europe/Rome' }))
        return romeDate.toISOString().split('T')[0]
      })() : '',
      return_time: dropoffDate ? (() => {
        const romeDate = new Date(dropoffDate.toLocaleString('en-US', { timeZone: 'Europe/Rome' }))
        return romeDate.toTimeString().substring(0, 5)
      })() : '',
      pickup_location: pickupLoc,
      dropoff_location: dropoffLoc,
      status: booking.status,
      total_amount: (booking.price_total / 100).toString(),
      currency: booking.currency.toUpperCase(),
      source: 'admin',
      // 2nd Driver
      has_second_driver: !!booking.booking_details?.second_driver,
      second_driver_id: booking.booking_details?.second_driver?.customer_id || '',
      second_driver_name: booking.booking_details?.second_driver?.name || '',
      second_driver_surname: booking.booking_details?.second_driver?.surname || '',
      second_driver_codice_fiscale: booking.booking_details?.second_driver?.codice_fiscale || '',
      second_driver_sesso: booking.booking_details?.second_driver?.sesso || '',
      second_driver_indirizzo: booking.booking_details?.second_driver?.indirizzo || '',
      second_driver_cap: booking.booking_details?.second_driver?.cap || '',
      second_driver_citta: booking.booking_details?.second_driver?.citta || '',
      second_driver_provincia: booking.booking_details?.second_driver?.provincia || '',
      second_driver_birth_date: booking.booking_details?.second_driver?.birth_date || '',
      second_driver_birth_place: booking.booking_details?.second_driver?.birth_place || '',
      second_driver_birth_provincia: booking.booking_details?.second_driver?.birth_provincia || '',
      second_driver_phone: booking.booking_details?.second_driver?.phone || '',
      second_driver_email: booking.booking_details?.second_driver?.email || '',
      second_driver_license_type: booking.booking_details?.second_driver?.license_type || '',
      second_driver_license_number: booking.booking_details?.second_driver?.license_number || '',
      second_driver_license_issued_by: booking.booking_details?.second_driver?.license_issued_by || '',
      second_driver_license_issue_date: booking.booking_details?.second_driver?.license_issue_date || '',
      second_driver_license_expiry: booking.booking_details?.second_driver?.license_expiry || '',
      insurance_option: booking.booking_details?.insuranceOption || 'KASKO_BASE',
      deposit: booking.booking_details?.deposit || '0',
      km_overage_fee: booking.km_overage_fee ? (booking.km_overage_fee).toFixed(2) : '0'
    })

    setEditingId(booking.id)
    setShowForm(true)
  }

  const [isSubmitting, setIsSubmitting] = useState(false)

  async function processBookingSubmission(skipValidation = false, overrideCustomerId?: string) {
    console.log('[processBookingSubmission] 🚀 STARTING SUBMISSION PROCESS', { skipValidation, overrideCustomerId })

    if (isSubmitting) return

    // VALIDATION LOGIC
    if (!skipValidation) {
      let missing: string[] = []
      let tempCustData: any = {}
      let targetCustomerId = ''

      if (newCustomerMode) {
        // Validate newCustomerData
        if (!newCustomerData.tipo_cliente) missing.push('tipo_cliente')

        if (newCustomerData.tipo_cliente === 'persona_fisica') {
          if (!newCustomerData.nome) missing.push('nome')
          if (!newCustomerData.cognome) missing.push('cognome')
          if (!newCustomerData.codice_fiscale) missing.push('codice_fiscale')
          if (!newCustomerData.data_nascita) missing.push('data_nascita')
          if (!newCustomerData.luogo_nascita) missing.push('luogo_nascita')
          if (!newCustomerData.indirizzo) missing.push('indirizzo')
          if (!newCustomerData.citta_residenza) missing.push('citta_residenza')
          if (!newCustomerData.patente) missing.push('patente')
        } else if (newCustomerData.tipo_cliente === 'azienda') {
          if (!newCustomerData.denominazione) missing.push('denominazione')
          if (!newCustomerData.partita_iva) missing.push('partita_iva')
          if (!newCustomerData.indirizzo) missing.push('indirizzo')
          if (!newCustomerData.citta) missing.push('citta')
        }

        // Common
        if (!newCustomerData.email) missing.push('email')
        if (!newCustomerData.telefono) missing.push('telefono')

        // CRITICAL FIX: Generate UUID for new customer to ensure modal has valid ID
        // This prevents "ID cliente mancante" error in MissingFieldsModal
        const newCustomerId = crypto.randomUUID()
        console.log('[processBookingSubmission] Generated new customer ID:', newCustomerId)

        tempCustData = {
          ...newCustomerData,
          id: newCustomerId // Ensure ID is always present
        }
      } else {
        // Existing customer
        // If we have an override ID (from modal), use it. Otherwise verify formData.
        const targetId = overrideCustomerId || formData.customer_id

        if (!targetId) {
          alert('Seleziona un cliente')
          return
        }

        targetCustomerId = targetId

        // Fetch fresh customer data to be sure
        console.log('[processBookingSubmission] Looking up customer:', targetCustomerId)
        const { data: customerData, error: customerError } = await supabase
          .from('customers_extended')
          .select('*')
          .eq('id', targetCustomerId)
          .limit(1)

        if (customerError) {
          // Distinguish between "not found" (PGRST116) vs other errors
          if (customerError.code === 'PGRST116' || customerError.message?.includes('no rows')) {
            // Client truly doesn't exist in customers_extended
            // Don't alert yet - let it fall through to the autocomplete/local check below
            console.log('[processBookingSubmission] Customer not found in DB (PGRST116), attempting fallback to autocomplete list...')
          } else {
            console.error('[processBookingSubmission] Customer lookup error:', customerError)
            // Other errors (network, permissions, etc.)
            const errorMsg = customerError.message || JSON.stringify(customerError, null, 2)
            alert(
              `Errore nel caricamento del cliente:\n\n${errorMsg}\n\n` +
              `ID Cliente: ${targetCustomerId}\n\n` +
              'Riprova o contatta il supporto tecnico.'
            )
            return
          }
        }

        const customer = customerData?.[0]

        if (customer) {
          console.log('[processBookingSubmission] Customer found:', customer)
          console.log('[processBookingSubmission] Customer ID:', customer.id)
          console.log('[processBookingSubmission] Customer tipo_cliente:', customer.tipo_cliente)
          console.log('[processBookingSubmission] Customer nome:', customer.nome)
          console.log('[processBookingSubmission] Customer cognome:', customer.cognome)
          console.log('[processBookingSubmission] Customer codice_fiscale:', customer.codice_fiscale)
          console.log('[processBookingSubmission] Customer data_nascita:', customer.data_nascita)
          console.log('[processBookingSubmission] Customer luogo_nascita:', customer.luogo_nascita)
          console.log('[processBookingSubmission] Customer indirizzo:', customer.indirizzo)
          console.log('[processBookingSubmission] Customer citta_residenza:', customer.citta_residenza)
          console.log('[processBookingSubmission] Customer citta:', customer.citta)
          console.log('[processBookingSubmission] Customer patente:', customer.patente)
          console.log('[processBookingSubmission] Customer numero_patente:', customer.numero_patente)
          console.log('[processBookingSubmission] Customer email:', customer.email)
          console.log('[processBookingSubmission] Customer telefono:', customer.telefono)

          // CRITICAL FIX: Ensure customer ID is always present in tempCustData
          // Even if the database result doesn't include it, we have it from targetCustomerId
          tempCustData = {
            ...customer,
            id: customer.id || targetCustomerId // Fallback to targetCustomerId if customer.id is missing
          }


          // Validate fields - STRICT validation for ALL required fields
          console.log('[processBookingSubmission] Validating customer data:', customer)
          console.log('[processBookingSubmission] Customer Type:', customer.tipo_cliente)

          if (customer.tipo_cliente === 'persona_fisica' || !customer.tipo_cliente) { // Default to persona_fisica if undefined
            // Log individual fields checks
            if (!customer.nome) console.log('❌ Missing name')
            if (!customer.cognome) console.log('❌ Missing surname')

            if (!customer.nome) missing.push('nome')
            if (!customer.cognome) missing.push('cognome')
            if (!customer.codice_fiscale) missing.push('codice_fiscale')
            if (!customer.data_nascita) missing.push('data_nascita')
            if (!customer.luogo_nascita) missing.push('luogo_nascita')
            if (!customer.indirizzo) missing.push('indirizzo')
            if (!customer.citta_residenza && !customer.citta) missing.push('citta_residenza')
            // Check both patente and numero_patente fields
            if (!customer.patente && !customer.numero_patente) missing.push('patente')
          } else if (customer.tipo_cliente === 'azienda') {
            if (!customer.denominazione && !customer.ragione_sociale) missing.push('denominazione')
            if (!customer.partita_iva) missing.push('partita_iva')
            if (!customer.indirizzo) missing.push('indirizzo')
            if (!customer.citta && !customer.citta_residenza) missing.push('citta')
          } else if (customer.tipo_cliente === 'pubblica_amministrazione') {
            if (!customer.denominazione && !customer.ragione_sociale) missing.push('denominazione')
            if (!customer.codice_univoco) missing.push('codice_univoco')
            if (!customer.indirizzo) missing.push('indirizzo')
            if (!customer.citta && !customer.citta_residenza) missing.push('citta')
          } else {
            // Fallback for unknown types (e.g. 'privato' or mixed case) - Treat as strict Persona Fisica
            console.warn('[processBookingSubmission] Unknown customer type:', customer.tipo_cliente, '- Defaulting to strict validation')
            if (!customer.nome) missing.push('nome')
            if (!customer.cognome) missing.push('cognome')
            if (!customer.codice_fiscale) missing.push('codice_fiscale')
            if (!customer.data_nascita) missing.push('data_nascita')
            if (!customer.luogo_nascita) missing.push('luogo_nascita')
            if (!customer.indirizzo) missing.push('indirizzo')
            if (!customer.citta_residenza && !customer.citta) missing.push('citta_residenza')
            if (!customer.patente && !customer.numero_patente) missing.push('patente')
          }

          // Common
          if (!customer.email) missing.push('email')
          if (!customer.telefono) missing.push('telefono')

          console.log('[processBookingSubmission] Missing fields found:', missing)
        } else {
          // Customer not found in customers_extended, but exists in autocomplete (from bookings)
          // This means the customer was created via the website but never got a full profile
          console.error('[processBookingSubmission] Customer not found in customers_extended. ID:', targetCustomerId)

          // Try to get customer info from the autocomplete list
          const customerFromList = customers.find(c => c.id === targetCustomerId)

          if (customerFromList) {
            // Create a minimal customer record to trigger the missing data modal

            // ENSURE ID IS A VALID UUID
            // If the booking has a "temp" ID or non-UUID, we must generate a real UUID 
            // so the database accepts the insert into customers_extended (which requires UUID type)
            let safeId = targetCustomerId
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            if (!uuidRegex.test(safeId)) {
              console.warn('[processBookingSubmission] Detected non-UUID ID:', safeId, 'Generating new valid UUID.')
              safeId = crypto.randomUUID()
            }

            tempCustData = {
              id: safeId,
              tipo_cliente: 'persona_fisica',
              nome: customerFromList.full_name.split(' ')[0] || '',
              cognome: customerFromList.full_name.split(' ').slice(1).join(' ') || '',
              email: customerFromList.email || '',
              telefono: customerFromList.phone || '',
              // CRITICAL FIX: Only treat as "New" if the ID was NOT a valid UUID.
              // If it IS a valid UUID, we assume the record exists (or should exist) and we want to UPDATE it, not create a duplicate.
              _isNew: !uuidRegex.test(targetCustomerId)
            }

            // Mark ALL required fields as missing since this is a new customer
            missing = ['nome', 'cognome', 'codice_fiscale', 'data_nascita', 'luogo_nascita', 'indirizzo', 'citta_residenza', 'patente']
            if (!tempCustData.email) missing.push('email')
            if (!tempCustData.telefono) missing.push('telefono')

            console.log('[processBookingSubmission] Customer exists in bookings but not in customers_extended. Will create new profile with missing fields:', missing)
          } else {
            alert(
              'Cliente non trovato nel database.\n\n' +
              'Il cliente selezionato non esiste nel sistema.\n\n' +
              'Per favore, crea prima il profilo del cliente nella tab "Clienti".'
            )
            return
          }
        }
      }

      if (missing.length > 0) {
        console.log('[processBookingSubmission] 🚨 Missing data detected! Opening NewClientModal for fields:', missing)

        // CRITICAL VALIDATION: Ensure tempCustData has a valid ID before opening modal
        if (!tempCustData || !tempCustData.id) {
          console.error('[processBookingSubmission] CRITICAL ERROR: tempCustData missing ID!', {
            tempCustData,
            targetCustomerId,
            newCustomerMode,
            formData_customer_id: formData.customer_id
          })

          alert(
            '⚠️ ERRORE INTERNO: ID Cliente Mancante\n\n' +
            'Si è verificato un errore nel recupero dei dati del cliente.\n\n' +
            'Dettagli tecnici:\n' +
            `- Modalità nuovo cliente: ${newCustomerMode ? 'Sì' : 'No'}\n` +
            `- ID cliente selezionato: ${formData.customer_id || 'N/A'}\n` +
            `- ID target: ${targetCustomerId || 'N/A'}\n\n` +
            'Azioni suggerite:\n' +
            '1. Riprova a selezionare il cliente\n' +
            '2. Se il problema persiste, crea un nuovo cliente\n' +
            '3. Contatta il supporto tecnico se necessario'
          )
          setIsSubmitting(false)
          return
        }

        console.log('[processBookingSubmission] ✅ Customer ID validated:', tempCustData.id)
        console.log('[processBookingSubmission] 🛑 BLOCKING booking creation - opening NewClientModal for completion')

        // NEW LOGIC: Use NewClientModal
        // Pass the partial/missing data as initialData so the user can fill it
        setCustomerToEdit(tempCustData)
        setValidationContext('booking')
        setCurrentValidationBooking(null)
        setEditModalOpen(true) // Open NewClientModal

        setIsSubmitting(false) // CRITICAL: Reset submitting state to allow retry after modal
        return // STOP HERE - do not create booking until missing data is provided
      }
    }

    // DEFENSIVE CHECK: Ensure we don't proceed if validation triggered the modal
    // This prevents race conditions where state updates haven't propagated yet
    if (showMissingDataModal) {
      console.log('[processBookingSubmission] ⚠️ Modal is open, aborting booking creation')
      setIsSubmitting(false)
      return
    }

    // ===== VALIDATION PASSED - PROCEEDING WITH BOOKING CREATION =====
    console.log('[processBookingSubmission] ✅ All validation passed, proceeding with booking creation')
    console.log('[processBookingSubmission] Customer ID:', formData.customer_id || 'new customer')

    // Call the original submit logic (embedded here or separate)

    if (isSubmitting) return

    setIsSubmitting(true)
    try {
      // ===== VALIDATION: Check all required date/time fields are populated =====
      if (!formData.pickup_date || !formData.pickup_time || !formData.return_date || !formData.return_time) {
        const missingFields: string[] = []
        if (!formData.pickup_date) missingFields.push('Data Ritiro')
        if (!formData.pickup_time) missingFields.push('Ora Ritiro')
        if (!formData.return_date) missingFields.push('Data Riconsegna')
        if (!formData.return_time) missingFields.push('Ora Riconsegna')

        setTimeout(() => {
          alert(
            '⚠️ CAMPI MANCANTI\n\n' +
            'I seguenti campi sono obbligatori:\n\n' +
            missingFields.map(f => `• ${f}`).join('\n') +
            '\n\nCompila tutti i campi richiesti prima di salvare la prenotazione.'
          )
        }, 100)
        setIsSubmitting(false)
        return
      }

      // ===== VALIDATION: Check dates are valid before parsing =====
      // Test parse the dates first to ensure they're valid
      const testPickupDate = new Date(`${formData.pickup_date}T${formData.pickup_time}:00`)
      const testReturnDate = new Date(`${formData.return_date}T${formData.return_time}:00`)

      if (isNaN(testPickupDate.getTime()) || isNaN(testReturnDate.getTime())) {
        setTimeout(() => {
          alert(
            '⚠️ DATE NON VALIDE\n\n' +
            'Le date inserite non sono valide.\n\n' +
            `Data Ritiro: ${formData.pickup_date} ${formData.pickup_time}\n` +
            `Data Riconsegna: ${formData.return_date} ${formData.return_time}\n\n` +
            'Verifica che le date siano nel formato corretto (YYYY-MM-DD) e che gli orari siano validi.'
          )
        }, 100)
        setIsSubmitting(false)
        return
      }

      // ===== VALIDATION: Check return date is after pickup date =====
      if (testReturnDate <= testPickupDate) {
        setTimeout(() => {
          alert(
            '⚠️ DATE NON VALIDE\n\n' +
            'La data di riconsegna deve essere successiva alla data di ritiro.\n\n' +
            `Ritiro: ${testPickupDate.toLocaleDateString('it-IT')} ${testPickupDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}\n` +
            `Riconsegna: ${testReturnDate.toLocaleDateString('it-IT')} ${testReturnDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}\n\n` +
            'Modifica le date e riprova.'
          )
        }, 100)
        setIsSubmitting(false)
        return
      }

      // ===== AVAILABILITY ENGINE VALIDATION =====
      // Check if the selected vehicle is actually available for the selected dates/times
      if (formData.vehicle_id) {
        const selectedVehicle = vehicles.find(v => v.id === formData.vehicle_id)

        if (selectedVehicle) {
          const allBookingsForCheck = [...bookings, ...carWashBookings]

          console.log('[EXTEND DEBUG] editingId:', editingId, 'vehicle:', selectedVehicle.display_name)

          const availabilityResult = isVehicleAvailable(
            selectedVehicle,
            formData.pickup_date,
            formData.return_date,
            formData.pickup_time,
            formData.return_time,
            allBookingsForCheck,
            editingId || undefined
          )

          if (!availabilityResult.available) {
            console.error('❌ Vehicle availability check failed:', availabilityResult.reason)

            let errorMessage = '🚫 VEICOLO NON DISPONIBILE\\n\\n'
            errorMessage += `${selectedVehicle.display_name} non è disponibile per le date e gli orari selezionati.\\n\\n`
            errorMessage += `Motivo: ${availabilityResult.reason}\\n\\n`

            if (availabilityResult.earliestTime) {
              const earliestTimeStr = availabilityResult.earliestTime.toLocaleTimeString('it-IT', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Europe/Rome'
              })
              errorMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n\\n`
              errorMessage += `✅ PRIMO ORARIO DISPONIBILE:\\n\\n`
              errorMessage += `${earliestTimeStr}\\n\\n`
            }

            errorMessage += 'Seleziona un altro veicolo o modifica le date/orari.'

            setTimeout(() => alert(errorMessage), 100)
            setIsSubmitting(false)
            return
          }

          console.log('✅ Vehicle availability check passed')
        }
      }

      // ===== SCHEDULING RULES VALIDATION =====
      // Enforce non-negotiable scheduling rules for DEPARTURE (pickup) and RETURN (dropoff)
      const vehicle = vehicles.find(v => v.id === formData.vehicle_id)

      if (vehicle) {
        console.log('🔍 Validating scheduling rules for rental booking...')
        console.log(`  Vehicle: ${vehicle.display_name}`)
        console.log(`  Pickup (DEPARTURE): ${testPickupDate.toISOString()}`)
        console.log(`  Dropoff (RETURN): ${testReturnDate.toISOString()}`)

        const schedulingValidation = await validateRentalBooking(
          testPickupDate,
          testReturnDate,
          vehicle.id,
          vehicle.display_name,
          editingId || undefined
        )

        if (!schedulingValidation.isValid) {
          console.error('❌ Scheduling validation failed:', schedulingValidation.errors)

          // Build error message
          let errorMessage = '🚫 CONFLITTO DI PROGRAMMAZIONE\n\n'
          errorMessage += 'La prenotazione viola le regole di programmazione obbligatorie:\n\n'

          schedulingValidation.errors.forEach((error, index) => {
            errorMessage += `${index + 1}. ${error.message}\n\n`
          })

          errorMessage += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'
          errorMessage += '📋 REGOLE DI PROGRAMMAZIONE:\n\n'
          errorMessage += '• RITIRO + RITIRO → Gap minimo 15 minuti\n'
          errorMessage += '• RICONSEGNA + RICONSEGNA → Gap minimo 15 minuti\n'
          errorMessage += '• RITIRO + RICONSEGNA → Gap minimo 15 minuti\n'
          errorMessage += '• RICONSEGNA + LAVAGGIO → Gap minimo 30 minuti\n'
          errorMessage += '• RITIRO + LAVAGGIO → Gap minimo 15 minuti\n'
          errorMessage += '• Eventi simultanei → VIETATI\n\n'

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

          errorMessage += 'Modifica gli orari per rispettare le regole di programmazione.'

          alert(errorMessage)
          setIsSubmitting(false)
          return
        }

        console.log('✅ Scheduling validation passed')
      }

      // Check for existing bookings on the same vehicle and dates (only for new bookings, not edits)
      if (!editingId) {
        const pickupDateTime = new Date(`${formData.pickup_date}T${formData.pickup_time}:00`)
        const returnDateTime = new Date(`${formData.return_date}T${formData.return_time}:00`)

        // Calculate buffer time (1h30 = 90 minutes)
        const BUFFER_MINUTES = 90
        const pickupWithBuffer = new Date(pickupDateTime.getTime() - BUFFER_MINUTES * 60 * 1000)

        // First, check if the vehicle is currently in the car wash
        const { data: carWashBookings, error: carWashError } = await supabase
          .from('bookings')
          .select('id, service_type, service_name, vehicle_name, appointment_date, appointment_time, pickup_date, dropoff_date')
          .eq('service_type', 'car_wash')
          .neq('status', 'cancelled')
          .or(`vehicle_name.ilike.%${vehicle?.display_name}%`)
          .or(`and(pickup_date.lte.${pickupDateTime.toISOString()},dropoff_date.gte.${pickupDateTime.toISOString()})`)

        if (!carWashError && carWashBookings && carWashBookings.length > 0) {
          // Check if any car wash booking overlaps with the pickup time
          for (const carWash of carWashBookings) {
            const carWashStart = new Date(carWash.pickup_date || carWash.appointment_date)
            const carWashEnd = new Date(carWash.dropoff_date || carWash.appointment_date)

            // If car wash hasn't ended yet, calculate end time (45 minutes from start)
            if (carWashEnd.getTime() === carWashStart.getTime()) {
              carWashEnd.setMinutes(carWashEnd.getMinutes() + 45)
            }

            // Check if pickup time conflicts with car wash
            if (pickupDateTime >= carWashStart && pickupDateTime < carWashEnd) {
              const availableTime = carWashEnd.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false })
              const availableDate = carWashEnd.toLocaleDateString('it-IT')

              alert(
                `VEICOLO IN LAVAGGIO\\n\\n` +
                `Il veicolo ${vehicle?.display_name} è attualmente in lavaggio.\\n\\n` +
                `Sarà disponibile alle ${availableTime} del ${availableDate}\\n\\n` +
                `Tempo rimanente: circa ${Math.ceil((carWashEnd.getTime() - new Date().getTime()) / (1000 * 60))} minuti\\n\\n` +
                `Si prega di selezionare un orario di ritiro dopo le ${availableTime}.`
              )

              setIsSubmitting(false)
              return // Block the booking
            }
          }
        }

        // Check for overlapping bookings AND bookings that violate the 1h30 buffer
        let query = supabase
          .from('bookings')
          .select('id, customer_name, vehicle_name, vehicle_plate, pickup_date, dropoff_date, status, service_type')
          .neq('status', 'cancelled')
          .neq('service_type', 'car_wash') // Exclude car wash bookings from rental conflicts
          .or(`and(pickup_date.lte.${returnDateTime.toISOString()},dropoff_date.gte.${pickupWithBuffer.toISOString()})`)

        if (vehicle?.plate || vehicle?.targa) {
          // If vehicle has a plate, check availability specifically for that plate
          query = query.eq('vehicle_plate', vehicle.plate || vehicle.targa)
        } else {
          // Fallback to name if no plate is available (legacy behavior)
          query = query.eq('vehicle_name', vehicle?.display_name)
        }

        const { data: existingBookings, error: checkError } = await query

        if (checkError) {
          console.error('Error checking existing bookings:', checkError)
        }

        if (existingBookings && existingBookings.length > 0) {
          // Sort by dropoff_date to find the most relevant conflict
          const sortedBookings = existingBookings.sort((a, b) =>
            new Date(b.dropoff_date).getTime() - new Date(a.dropoff_date).getTime()
          )

          for (const conflictingBooking of sortedBookings) {
            const bookingId = conflictingBooking.id.substring(0, 8).toUpperCase()
            const conflictPickup = new Date(conflictingBooking.pickup_date)
            const conflictReturn = new Date(conflictingBooking.dropoff_date)

            // Check if this is a complete overlap (double booking)
            // True overlap: new booking starts BEFORE existing ends AND new booking ends AFTER existing starts
            const isOverlap = pickupDateTime < conflictReturn && returnDateTime > conflictPickup

            // Check if this violates the 1h30 buffer (car returns less than 90 min before new pickup)
            const timeDiff = pickupDateTime.getTime() - conflictReturn.getTime()
            const minutesDiff = timeDiff / (1000 * 60)
            const isBufferViolation = timeDiff > 0 && minutesDiff < BUFFER_MINUTES

            if (isOverlap) {
              // Complete overlap - show double booking warning
              const vehicleTarga = vehicle?.plate || conflictingBooking.vehicle_name
              const confirmed = confirm(
                `⚠️ ATTENZIONE: VEICOLO GIÀ PRENOTATO!\n\n` +
                `Veicolo: ${conflictingBooking.vehicle_name}\n` +
                `Targa: ${vehicleTarga}\n\n` +
                `PRENOTAZIONE ESISTENTE:\n` +
                `Cliente: ${conflictingBooking.customer_name}\n` +
                `Periodo: ${conflictPickup.toLocaleDateString('it-IT')} ${conflictPickup.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false })} - ${conflictReturn.toLocaleDateString('it-IT')} ${conflictReturn.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false })}\n` +
                `ID: DR7-${bookingId}\n\n` +
                `⚠️ SEI SICURO DI VOLER CREARE UNA DOPPIA PRENOTAZIONE?\n\n` +
                `✅ Clicca OK per PROCEDERE COMUNQUE\n` +
                `❌ Clicca ANNULLA per scegliere altre date/veicolo`
              )

              if (!confirmed) {
                setIsSubmitting(false)
                return // User cancelled
              }
            } else if (isBufferViolation) {
              // Buffer violation - show specific 1h30 warning
              const returnTimeStr = conflictReturn.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false })
              const returnDateStr = conflictReturn.toLocaleDateString('it-IT')
              const bufferMinutesLeft = Math.round(BUFFER_MINUTES - minutesDiff)

              const confirmed = confirm(
                `⚠️ ATTENZIONE: BUFFER 1H30 NON RISPETTATO!\n\n` +
                `Are you sure you want to book this vehicle?\n` +
                `The car is scheduled to return at ${returnTimeStr} (${returnDateStr}).\n\n` +
                `Il veicolo tornerà alle ${returnTimeStr} del ${returnDateStr}.\n` +
                `Tempo mancante al buffer di 1h30: ${bufferMinutesLeft} minuti\n\n` +
                `Cliente precedente: ${conflictingBooking.customer_name}\n` +
                `ID: DR7-${bookingId}\n\n` +
                `⚠️ Si consiglia di attendere fino alle ${new Date(conflictReturn.getTime() + BUFFER_MINUTES * 60 * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false })} per il prossimo ritiro.\n\n` +
                `✅ Clicca OK per PROCEDERE COMUNQUE\n` +
                `❌ Clicca ANNULLA per scegliere un orario diverso`
              )

              if (!confirmed) {
                setIsSubmitting(false)
                return // User cancelled
              }
            }
          }
        }
      }

      let customerId = formData.customer_id || null
      let secondDriverId = formData.second_driver_id || null

      // If creating new second driver, create them in customers_extended table first
      if (formData.has_second_driver && newSecondDriverMode) {
        console.log('[processBookingSubmission] Creating new customer for second driver...')
        try {
          const secondDriverData = {
            tipo_cliente: 'persona_fisica',
            nome: formData.second_driver_name,
            cognome: formData.second_driver_surname,
            codice_fiscale: formData.second_driver_codice_fiscale,
            sesso: formData.second_driver_sesso,
            indirizzo: formData.second_driver_indirizzo,
            codice_postale: formData.second_driver_cap,
            citta_residenza: formData.second_driver_citta,
            provincia_residenza: formData.second_driver_provincia,
            data_nascita: formData.second_driver_birth_date || null,
            luogo_nascita: formData.second_driver_birth_place || null,
            telefono: formData.second_driver_phone,
            email: formData.second_driver_email,
            patente: formData.second_driver_license_number,
            scadenza_patente: formData.second_driver_license_expiry || null,
            source: 'admin_second_driver',
            created_at: new Date().toISOString()
          }

          const { data: newSecondDriver, error: secondDriverError } = await supabase
            .from('customers_extended')
            .insert([secondDriverData])
            .select()
            .single()

          if (secondDriverError) {
            console.error('Failed to create second driver customer:', secondDriverError)
            throw new Error(`Failed to create second driver: ${secondDriverError.message}`)
          }

          secondDriverId = newSecondDriver.id
          console.log('✅ New second driver created:', newSecondDriver)
        } catch (error) {
          console.error('Error creating second driver:', error)
          throw new Error('Failed to create second driver: ' + (error as Error).message)
        }
      }

      // If creating new customer, create them in customers_extended table
      if (newCustomerMode) {
        try {
          const customerData: any = {
            tipo_cliente: newCustomerData.tipo_cliente,
            nazione: newCustomerData.nazione,
            email: newCustomerData.email || null,
            telefono: newCustomerData.telefono || null,
            indirizzo: newCustomerData.indirizzo || null,
            source: 'admin',
            created_at: new Date().toISOString()
          }

          // Add type-specific fields
          if (newCustomerData.tipo_cliente === 'persona_fisica') {
            customerData.nome = newCustomerData.nome
            customerData.cognome = newCustomerData.cognome
            customerData.codice_fiscale = newCustomerData.codice_fiscale
            customerData.data_nascita = newCustomerData.data_nascita || null
            customerData.luogo_nascita = newCustomerData.luogo_nascita || null
            customerData.numero_civico = newCustomerData.numero_civico || null
            customerData.codice_postale = newCustomerData.codice_postale
            customerData.citta_residenza = newCustomerData.citta_residenza
            customerData.provincia_residenza = newCustomerData.provincia_residenza
            customerData.pec = newCustomerData.pec || null
            customerData.patente = newCustomerData.driver_license_number || null
          } else if (newCustomerData.tipo_cliente === 'azienda') {
            customerData.denominazione = newCustomerData.denominazione
            customerData.partita_iva = newCustomerData.partita_iva
            customerData.codice_destinatario = newCustomerData.codice_destinatario || null
            customerData.codice_fiscale = newCustomerData.codice_fiscale || null
            customerData.pec = newCustomerData.pec || null
          } else if (newCustomerData.tipo_cliente === 'pubblica_amministrazione') {
            customerData.codice_univoco = newCustomerData.codice_univoco_pa
            customerData.codice_fiscale = newCustomerData.codice_fiscale_pa
            customerData.ente_o_ufficio = newCustomerData.ente_o_ufficio
            customerData.citta = newCustomerData.citta
            customerData.pec = newCustomerData.pec || null
          }

          const { data: newCustomer, error: customerError } = await supabase
            .from('customers_extended')
            .insert([customerData])
            .select()
            .single()

          if (customerError) {
            console.error('Failed to create customer:', customerError)
            throw new Error(`Failed to create customer: ${customerError.message}`)
          }

          customerId = newCustomer.id
          console.log('✅ New customer created in customers_extended table:', newCustomer)
        } catch (error) {
          console.error('Error creating customer:', error)
          throw new Error('Failed to create customer: ' + (error as Error).message)
        }
      }

      let customerInfo: any = newCustomerMode && !overrideCustomerId ? {
        ...newCustomerData,
        id: customerId,
        full_name: newCustomerData.tipo_cliente === 'persona_fisica'
          ? `${newCustomerData.nome} ${newCustomerData.cognome}`
          : newCustomerData.tipo_cliente === 'azienda'
            ? newCustomerData.denominazione
            : newCustomerData.ente_o_ufficio,
        phone: newCustomerData.telefono
      } : null

      // If we didn't just create it in memory (or even if we did, but we want to be safe),
      // let's fetch the definitive record from DB if we have an ID
      if (!customerInfo && customerId) {
        const { data: dbCustomer } = await supabase
          .from('customers_extended')
          .select('*')
          .eq('id', customerId)
          .single()

        if (dbCustomer) {
          // Map DB fields to customerInfo shape expected below
          const fullName = dbCustomer.tipo_cliente === 'azienda'
            ? dbCustomer.denominazione
            : dbCustomer.tipo_cliente === 'pubblica_amministrazione'
              ? dbCustomer.ente_o_ufficio
              : `${dbCustomer.nome} ${dbCustomer.cognome}`

          customerInfo = {
            ...dbCustomer,
            full_name: fullName,
            phone: dbCustomer.telefono,
            email: dbCustomer.email
          }
        } else {
          // Fallback to local state if DB fetch fails (unlikely)
          const local = customers.find(c => c.id === customerId)
          if (local) customerInfo = local
        }
      }

      // Final Check
      if (!customerInfo) {
        customerInfo = customers.find(c => c.id === customerId)
      }

      // ===== VEHICLE CONSISTENCY VALIDATION =====
      // Ensure vehicle linkage is consistent and warn about any changes
      if (editingId) {
        // When editing, check if the vehicle has changed
        const { data: existingBooking } = await supabase
          .from('bookings')
          .select('vehicle_id, vehicle_plate, vehicle_name')
          .eq('id', editingId)
          .single()

        if (existingBooking && vehicle) {
          const vehicleChanged = existingBooking.vehicle_id !== vehicle.id
          const plateChanged = existingBooking.vehicle_plate !== vehicle.plate

          if (vehicleChanged) {
            const confirmed = confirm(
              `⚠️ ATTENZIONE: CAMBIO VEICOLO\n\n` +
              `Stai cambiando il veicolo di questa prenotazione:\n\n` +
              `VECCHIO: ${existingBooking.vehicle_name} (${existingBooking.vehicle_plate || 'N/A'})\n` +
              `NUOVO: ${vehicle.display_name} (${vehicle.plate || 'N/A'})\n\n` +
              `Questo aggiornerà:\n` +
              `• vehicle_id: ${existingBooking.vehicle_id} → ${vehicle.id}\n` +
              `• vehicle_plate: ${existingBooking.vehicle_plate || 'N/A'} → ${vehicle.plate || 'N/A'}\n` +
              `• vehicle_name: ${existingBooking.vehicle_name} → ${vehicle.display_name}\n\n` +
              `Il calendario verrà aggiornato automaticamente.\n\n` +
              `Confermi il cambio di veicolo?`
            )
            if (!confirmed) {
              setIsSubmitting(false)
              return
            }
            console.log('✅ Vehicle change confirmed by user')
          } else if (plateChanged && existingBooking.vehicle_plate) {
            // Same vehicle but plate has changed - this might indicate the vehicle's plate was updated
            const confirmed = confirm(
              `⚠️ ATTENZIONE: TARGA MODIFICATA\n\n` +
              `La targa del veicolo "${vehicle.display_name}" è cambiata:\n\n` +
              `VECCHIA: ${existingBooking.vehicle_plate}\n` +
              `NUOVA: ${vehicle.plate || 'N/A'}\n\n` +
              `Questo potrebbe significare che:\n` +
              `1. La targa del veicolo è stata aggiornata nel sistema\n` +
              `2. Stai selezionando un veicolo diverso con lo stesso nome\n\n` +
              `La prenotazione verrà aggiornata con la nuova targa.\n\n` +
              `Confermi l'aggiornamento?`
            )
            if (!confirmed) {
              setIsSubmitting(false)
              return
            }
            console.log('✅ Plate change confirmed by user')
          }
        }
      }

      // Validate that vehicle still exists and has consistent data
      if (vehicle) {
        console.log('🔍 Vehicle consistency check:', {
          vehicle_id: vehicle.id,
          vehicle_plate: vehicle.plate,
          vehicle_name: vehicle.display_name,
          booking_mode: editingId ? 'edit' : 'create'
        })
      } else {
        console.error('❌ Vehicle not found for vehicle_id:', formData.vehicle_id)
        alert('Errore: Veicolo non trovato. Seleziona un veicolo valido.')
        setIsSubmitting(false)
        return
      }

      // Create or update vehicle rental booking in bookings table (for website availability blocking)
      // Note: vehicle is already declared above in scheduling validation block

      // Get location labels
      const pickupLocationLabel = LOCATIONS.find(l => l.value === formData.pickup_location)?.label || formData.pickup_location
      const dropoffLocationLabel = LOCATIONS.find(l => l.value === formData.dropoff_location)?.label || formData.dropoff_location

      // Combine date and time - CRITICAL: Interpret form inputs as Europe/Rome timezone
      // Parse the date and time components
      const [pickupYear, pickupMonth, pickupDay] = formData.pickup_date.split('-').map(Number)
      const [pickupHour, pickupMinute] = formData.pickup_time.split(':').map(Number)
      const [returnYear, returnMonth, returnDay] = formData.return_date.split('-').map(Number)
      const [returnHour, returnMinute] = formData.return_time.split(':').map(Number)

      // Create Date objects as Europe/Rome timezone, then convert to UTC for storage
      // This ensures "Jan 5, 11:00" entered in the form is stored as "Jan 5, 10:00 UTC" (UTC+1 in winter)
      const pickupDate = createRomeDate(pickupYear, pickupMonth, pickupDay, pickupHour, pickupMinute, 0)
      const returnDate = createRomeDate(returnYear, returnMonth, returnDay, returnHour, returnMinute, 0)

      const bookingData = {
        user_id: customerId, // Store customer ID to link booking to customer for contract generation
        guest_name: customerInfo?.full_name || 'N/A', // Required for guest bookings
        guest_email: customerInfo?.email || null,
        guest_phone: customerInfo?.phone || null,
        vehicle_type: 'car',
        vehicle_id: formData.vehicle_id, // CRITICAL: Store vehicle_id for availability filtering
        vehicle_name: vehicle?.display_name || 'N/A',
        vehicle_plate: vehicle?.plate || null,
        vehicle_image_url: null,
        pickup_date: pickupDate.toISOString(),
        dropoff_date: returnDate.toISOString(),
        pickup_location: pickupLocationLabel,
        dropoff_location: dropoffLocationLabel,
        price_total: Math.round(parseFloat(formData.total_amount) * 100), // Convert to cents
        km_overage_fee: parseFloat(formData.km_overage_fee) || 0,
        currency: formData.currency.toUpperCase(),
        status: formData.status,
        payment_status: formData.payment_status,
        payment_method: formData.payment_method,
        customer_name: customerInfo?.full_name || 'N/A',
        customer_email: customerInfo?.email || null,
        customer_phone: customerInfo?.phone || null,
        booked_at: editingId ? undefined : new Date().toISOString(), // Don't update booked_at on edit
        booking_source: 'admin', // Mark as admin booking
        booking_details: {
          customer: {
            fullName: customerInfo?.full_name || '',
            email: customerInfo?.email || '',
            phone: customerInfo?.phone || '',
            id: customerId, // Primary field for customer resolution
            customerId: customerId // Backward compatibility
          },
          vehicle_id: formData.vehicle_id, // Also store in booking_details for backward compatibility
          pickupLocation: formData.pickup_location,
          dropoffLocation: formData.dropoff_location,
          amountPaid: Math.round(parseFloat(formData.amount_paid) * 100), // Store amount paid in cents
          source: 'admin_manual',
          // Kasko & Deposit
          insuranceOption: formData.insurance_option,
          deposit: formData.deposit,
          // KM Limit
          km_limit: formData.unlimited_km ? 'Illimitati' : formData.km_limit,
          unlimited_km: formData.unlimited_km,
          second_driver: formData.has_second_driver ? {
            customer_id: secondDriverId || null,
            name: formData.second_driver_name,
            surname: formData.second_driver_surname,
            codice_fiscale: formData.second_driver_codice_fiscale,
            sesso: formData.second_driver_sesso,
            indirizzo: formData.second_driver_indirizzo,
            cap: formData.second_driver_cap,
            citta: formData.second_driver_citta,
            provincia: formData.second_driver_provincia,
            birth_date: formData.second_driver_birth_date,
            birth_place: formData.second_driver_birth_place,
            birth_provincia: formData.second_driver_birth_provincia,
            phone: formData.second_driver_phone,
            email: formData.second_driver_email,
            license_type: formData.second_driver_license_type,
            license_number: formData.second_driver_license_number,
            license_issued_by: formData.second_driver_license_issued_by,
            license_issue_date: formData.second_driver_license_issue_date,
            license_expiry: formData.second_driver_license_expiry
          } : null
        }
      }

      console.log(editingId ? 'Updating rental booking' : 'Creating rental booking', 'with data:', bookingData)

      let insertedBooking
      if (editingId) {
        // Update existing booking - trigger will properly exclude current booking from conflict check
        const { data, error: bookingError } = await supabase
          .from('bookings')
          .update(bookingData)
          .eq('id', editingId)
          .select()
          .single()

        if (bookingError) {
          console.error('Failed to update booking:', bookingError)
          console.error('Booking data that failed:', bookingData)
          throw new Error(`Failed to update booking entry: ${bookingError.message || JSON.stringify(bookingError)}`)
        }
        insertedBooking = data
        console.log('Booking updated successfully:', insertedBooking)
      } else {
        // Create new booking
        const { data, error: bookingError } = await supabase
          .from('bookings')
          .insert([bookingData])
          .select()
          .single()

        if (bookingError) {
          console.error('Failed to create booking:', bookingError)
          console.error('Booking data that failed:', bookingData)
          throw new Error(`Failed to create booking entry: ${bookingError.message || JSON.stringify(bookingError)}`)
        }
        insertedBooking = data
        console.log('Booking created successfully:', insertedBooking)
      }

      // Create Google Calendar event
      try {
        await fetch('/.netlify/functions/create-calendar-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vehicleName: vehicle?.display_name || '',
            customerName: customerInfo?.full_name || '',
            customerEmail: customerInfo?.email || '',
            customerPhone: customerInfo?.phone || '',
            pickupDate: formData.pickup_date,
            pickupTime: formData.pickup_time,
            returnDate: formData.return_date,
            returnTime: formData.return_time,
            pickupLocation: pickupLocationLabel,
            returnLocation: dropoffLocationLabel,
            totalPrice: parseFloat(formData.total_amount),
            bookingId: insertedBooking?.id?.substring(0, 8)
          })
        })
        console.log('✅ Calendar event created successfully')
      } catch (calendarError) {
        console.error('⚠️ Failed to create calendar event:', calendarError)
        // Don't fail the whole booking if calendar fails
      }

      // Generate PDF invoice for car rental
      if (!editingId) { // Only for new bookings
        try {
          await fetch('/.netlify/functions/generate-invoice-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bookingId: insertedBooking?.id || '',
              bookingType: 'car_rental',
              customerName: customerInfo?.full_name || '',
              customerEmail: customerInfo?.email || '',
              customerPhone: customerInfo?.phone || '',
              items: [{
                description: `Noleggio ${vehicle?.display_name || 'Veicolo'}`,
                quantity: 1,
                unitPrice: Math.round(parseFloat(formData.total_amount) * 100),
                total: Math.round(parseFloat(formData.total_amount) * 100)
              }],
              subtotal: Math.round(parseFloat(formData.total_amount) * 100),
              tax: 0,
              total: Math.round(parseFloat(formData.total_amount) * 100),
              paymentStatus: formData.payment_status || 'pending',
              bookingDate: new Date().toISOString(),
              serviceDate: `${formData.pickup_date}T${formData.pickup_time}:00`,
              notes: `Ritiro: ${pickupLocationLabel}\nRiconsegna: ${dropoffLocationLabel}`
            })
          })
          console.log('✅ Invoice generated successfully')
        } catch (invoiceError) {
          console.error('⚠️ Failed to generate invoice:', invoiceError)
          // Don't fail the whole booking if invoice generation fails
        }
      }

      // Send WhatsApp notification for car rental
      if (!editingId) { // Only for new bookings
        try {
          await fetch('/.netlify/functions/send-whatsapp-notification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              booking: {
                id: insertedBooking?.id || '',
                service_type: 'car_rental',
                customer_name: customerInfo?.full_name || '',
                customer_email: customerInfo?.email || '',
                customer_phone: customerInfo?.phone || '',
                vehicle_name: vehicle?.display_name || '',
                pickup_date: `${formData.pickup_date}T${formData.pickup_time}:00`,
                dropoff_date: `${formData.return_date}T${formData.return_time}:00`,
                pickup_location: pickupLocationLabel,
                price_total: parseFloat(formData.total_amount) * 100, // Convert to cents
                payment_status: formData.payment_status || 'pending'
              }
            })
          })
          console.log('✅ WhatsApp notification sent')
        } catch (whatsappError) {
          console.error('⚠️ Failed to send WhatsApp notification:', whatsappError)
          // Don't fail the whole booking if WhatsApp fails
        }

        // Generate Contract PDF automatically
        try {
          console.log('[Auto-Gen] Generating contract for booking:', insertedBooking.id, new Date().toISOString())
          await handleGenerateContract(insertedBooking, false)
          console.log('[Auto-Gen] ✅ Contract generated successfully')
        } catch (contractError) {
          console.error('[Auto-Gen] ⚠️ Failed to generate contract:', contractError)
          // Don't alert here to avoid confusion, just log it
        }
      }

      // Note: Removed duplicate reservation creation - bookings table is the single source of truth


      setShowForm(false)
      setEditingId(null)
      setNewCustomerMode(false)
      resetForm()
      await loadData()

      // Show success message AFTER reload to ensure it's visible
      const successMessage = editingId
        ? '✅ Prenotazione aggiornata con successo!\n\nLa prenotazione è stata modificata e salvata nel database.\n\nPuoi visualizzarla nella lista delle prenotazioni.'
        : '✅ Prenotazione creata con successo!\n\nLa nuova prenotazione è stata salvata nel database.\n\n📧 Il cliente riceverà una conferma via email.\n\nPuoi visualizzarla nella lista delle prenotazioni.'

      alert(successMessage)
    } catch (error) {
      console.error('Failed to save reservation:', error)
      alert('Failed to save reservation: ' + (error as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    processBookingSubmission(false)
  }

  function resetForm() {
    setFormData({
      customer_id: '',
      vehicle_id: '',
      start_at: '',
      end_at: '',
      pickup_date: '',
      pickup_time: '',
      return_date: '',
      return_time: '',
      pickup_location: 'dr7_office',
      dropoff_location: 'dr7_office',
      status: 'pending',
      source: 'admin',
      total_amount: '0',
      amount_paid: '0',
      km_overage_fee: '0',
      payment_status: 'pending',
      payment_method: 'Contanti',
      currency: 'EUR',
      has_second_driver: false,
      second_driver_id: '',
      second_driver_name: '',
      second_driver_surname: '',
      second_driver_codice_fiscale: '',
      second_driver_sesso: '',
      second_driver_indirizzo: '',
      second_driver_cap: '',
      second_driver_citta: '',
      second_driver_provincia: '',
      second_driver_birth_date: '',
      second_driver_birth_place: '',
      second_driver_birth_provincia: '',
      second_driver_phone: '',
      second_driver_email: '',
      second_driver_license_type: '',
      second_driver_license_number: '',
      second_driver_license_issued_by: '',
      second_driver_license_issue_date: '',
      second_driver_license_expiry: '',
      // Kasko & Deposit
      insurance_option: 'KASKO_BASE',
      deposit: '0',
      unlimited_km: false,
      km_limit: '0'
    })
    setNewCustomerData({
      tipo_cliente: 'persona_fisica',
      nome: '',
      cognome: '',
      codice_fiscale: '',
      data_nascita: '',
      luogo_nascita: '',
      numero_civico: '',
      codice_postale: '',
      citta_residenza: '',
      provincia_residenza: '',
      pec: '',
      denominazione: '',
      partita_iva: '',
      codice_destinatario: '',
      codice_univoco_pa: '',
      codice_fiscale_pa: '',
      ente_o_ufficio: '',
      citta: '',
      nazione: 'Italia',
      telefono: '',
      email: '',
      indirizzo: '',
      driver_license_number: '',
      patente: ''
    })
  }

  if (loading) {
    return <div className="text-center py-8 text-theme-text-muted">Loading...</div>
  }

  return (
    <>
      <style>{scrollbarStyle}</style>
      <div className="space-y-4">
        {/* Mobile-optimized header */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
          {/* Main Title - Italian Translation verified */}
          <h2 className="text-xl sm:text-2xl font-light text-dr7-gold tracking-[0.3em] uppercase">Noleggio</h2>
          <div className="flex gap-2 sm:gap-3">
            <Button onClick={() => { resetForm(); setEditingId(null); setShowForm(true) }} className="flex-1 sm:flex-none text-sm sm:text-base">
              <span className="hidden sm:inline">+ Nuova Prenotazione</span>
              <span className="sm:hidden">+ Nuova</span>
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-4">
          <Input
            label="Cerca per nome"
            placeholder="Cerca prenotazione per nome cliente..."
            value={bookingSearchQuery}
            onChange={(e) => setBookingSearchQuery(e.target.value)}
          />
        </div>

        {/* Quick Edit Customer Modal */}
        <NewClientModal
          isOpen={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          initialData={customerToEdit}
          onClientCreated={async (newClientId) => {
            await loadData()

            // NEW: Resume booking creation flow if context is 'booking'
            if (validationContext === 'booking' && newClientId) {
              console.log('[ReservationsTab] NewClientModal finished. Resuming booking with:', newClientId)
              setFormData(prev => ({ ...prev, customer_id: newClientId }))
              // Small delay to ensure state updates
              setTimeout(() => {
                processBookingSubmission(true, newClientId)
              }, 100)
              return
            }

            // If we were validating a booking for contract/invoice (existing booking)
            if (currentValidationBooking && newClientId) {
              try {
                const { error } = await supabase
                  .from('bookings')
                  .update({
                    user_id: newClientId,
                    // Update denormalized fields too
                    customer_name: customerToEdit?.full_name || customerToEdit?.nome + ' ' + customerToEdit?.cognome,
                  })
                  .eq('id', currentValidationBooking.id)

                if (!error) {
                  // Fetch fresh and retry
                  const { data: fresh } = await supabase.from('bookings').select('*').eq('id', currentValidationBooking.id).single()
                  if (fresh) {
                    if (validationContext === 'invoice') handleGenerateInvoice(fresh)
                    else handleGenerateContract(fresh, true)
                  }
                }
              } catch (e) {
                console.error('Error auto-linking new client:', e)
              }
            }
          }}
        />

        {/* Penalty Modal */}
        {selectedBookingForPenalty && (
          <PenaltyModal
            isOpen={penaltyModalOpen}
            booking={{
              id: selectedBookingForPenalty.id,
              customer_name: selectedBookingForPenalty.customer_name || 'Cliente',
              customer_id: selectedBookingForPenalty.booking_details?.customer?.customerId || undefined,
              user_id: selectedBookingForPenalty.user_id || undefined
            }}
            onClose={() => {
              setPenaltyModalOpen(false)
              setSelectedBookingForPenalty(null)
            }}
            onSuccess={() => {
              loadData()
            }}
            onEditCustomer={(customerId) => {
              openEditCustomer(customerId)
              setPenaltyModalOpen(false)
            }}
          />
        )}

        {showForm && (
          <form onSubmit={handleSubmit} className="p-4 sm:p-6 rounded-lg mb-6 border border-gray-700/30">
            <h3 className="text-lg sm:text-xl font-semibold text-dr7-gold mb-4">
              {editingId ? 'Modifica Prenotazione' : 'Nuova Prenotazione'}
            </h3>

            {/* Booking Type Selection - Mobile Optimized */}
            {/* Customer Selection - Mobile Optimized */}
            <div className="mb-4 sm:mb-6 p-3 sm:p-4  rounded-lg border border-theme-border">
              <div className="border-b border-theme-border pb-4">
                <div className="flex items-center gap-4 mb-4">
                  <button
                    type="button"
                    onClick={() => setNewCustomerMode(false)}
                    className={`px-4 py-2 rounded-full ${!newCustomerMode ? 'bg-white text-black font-semibold' : 'bg-gray-700 text-theme-text-secondary hover:bg-gray-600'}`}
                  >
                    Seleziona Cliente
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewCustomerMode(true)}
                    className={`px-4 py-2 rounded-full ${newCustomerMode ? 'bg-white text-black font-semibold' : 'bg-gray-700 text-theme-text-secondary hover:bg-gray-600'}`}
                  >
                    Nuovo Cliente
                  </button>
                </div>

                {newCustomerMode ? (
                  <div className="space-y-4">
                    <Select
                      label="Tipo Cliente"
                      required
                      value={newCustomerData.tipo_cliente}
                      onChange={(e) => setNewCustomerData({ ...newCustomerData, tipo_cliente: e.target.value as any })}
                      options={[
                        { value: 'persona_fisica', label: 'Persona Fisica' },
                        { value: 'azienda', label: 'Azienda' },
                        { value: 'pubblica_amministrazione', label: 'Pubblica Amministrazione' }
                      ]}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Common fields for ALL types */}
                      <Select
                        label="Nazione"
                        required
                        value={newCustomerData.nazione}
                        onChange={(e) => setNewCustomerData({ ...newCustomerData, nazione: e.target.value })}
                        options={[
                          { value: 'Italia', label: 'Italia' },
                          { value: 'Francia', label: 'Francia' },
                          { value: 'Germania', label: 'Germania' },
                          { value: 'Spagna', label: 'Spagna' },
                          { value: 'Regno Unito', label: 'Regno Unito' },
                          { value: 'Altro', label: 'Altro' }
                        ]}
                      />

                      {/* Type-specific fields */}
                      {newCustomerData.tipo_cliente === 'persona_fisica' && (
                        <>
                          <Input label="Nome *" required value={newCustomerData.nome} onChange={(e) => setNewCustomerData({ ...newCustomerData, nome: e.target.value })} />
                          <Input label="Cognome *" required value={newCustomerData.cognome} onChange={(e) => setNewCustomerData({ ...newCustomerData, cognome: e.target.value })} />
                          <Input label="Codice Fiscale *" required value={newCustomerData.codice_fiscale} onChange={(e) => setNewCustomerData({ ...newCustomerData, codice_fiscale: e.target.value.toUpperCase() })} />
                          <Input label="Data di Nascita" type="date" value={newCustomerData.data_nascita} onChange={(e) => setNewCustomerData({ ...newCustomerData, data_nascita: e.target.value })} />
                          <Input label="Luogo di Nascita" value={newCustomerData.luogo_nascita} onChange={(e) => setNewCustomerData({ ...newCustomerData, luogo_nascita: e.target.value })} />
                          <Input label="Numero Civico" value={newCustomerData.numero_civico} onChange={(e) => setNewCustomerData({ ...newCustomerData, numero_civico: e.target.value })} />
                          <Input label="Città di Residenza *" required value={newCustomerData.citta_residenza} onChange={(e) => setNewCustomerData({ ...newCustomerData, citta_residenza: e.target.value })} />
                          <Input label="CAP *" required value={newCustomerData.codice_postale} onChange={(e) => setNewCustomerData({ ...newCustomerData, codice_postale: e.target.value })} />
                          <Input label="Provincia *" required value={newCustomerData.provincia_residenza} onChange={(e) => setNewCustomerData({ ...newCustomerData, provincia_residenza: e.target.value.toUpperCase() })} />
                          <Input label="PEC" type="email" value={newCustomerData.pec} onChange={(e) => setNewCustomerData({ ...newCustomerData, pec: e.target.value })} />
                          <Input label="Patente" value={newCustomerData.driver_license_number} onChange={(e) => setNewCustomerData({ ...newCustomerData, driver_license_number: e.target.value })} />
                        </>
                      )}

                      {newCustomerData.tipo_cliente === 'azienda' && (
                        <>
                          <Input label="Denominazione *" required value={newCustomerData.denominazione} onChange={(e) => setNewCustomerData({ ...newCustomerData, denominazione: e.target.value })} />
                          <Input label="Partita IVA *" required value={newCustomerData.partita_iva} onChange={(e) => setNewCustomerData({ ...newCustomerData, partita_iva: e.target.value })} />
                          <Input label="Codice Fiscale" value={newCustomerData.codice_fiscale} onChange={(e) => setNewCustomerData({ ...newCustomerData, codice_fiscale: e.target.value })} />
                          <Input label="Codice Destinatario" value={newCustomerData.codice_destinatario} onChange={(e) => setNewCustomerData({ ...newCustomerData, codice_destinatario: e.target.value })} />
                          <Input label="PEC" type="email" value={newCustomerData.pec} onChange={(e) => setNewCustomerData({ ...newCustomerData, pec: e.target.value })} />
                        </>
                      )}

                      {newCustomerData.tipo_cliente === 'pubblica_amministrazione' && (
                        <>
                          <Input label="Codice Univoco *" required value={newCustomerData.codice_univoco_pa} onChange={(e) => setNewCustomerData({ ...newCustomerData, codice_univoco_pa: e.target.value })} />
                          <Input label="Codice Fiscale *" required value={newCustomerData.codice_fiscale_pa} onChange={(e) => setNewCustomerData({ ...newCustomerData, codice_fiscale_pa: e.target.value })} />
                          <Input label="Ente o Ufficio *" required value={newCustomerData.ente_o_ufficio} onChange={(e) => setNewCustomerData({ ...newCustomerData, ente_o_ufficio: e.target.value })} />
                          <Input label="Città *" required value={newCustomerData.citta} onChange={(e) => setNewCustomerData({ ...newCustomerData, citta: e.target.value })} />
                          <Input label="PEC" type="email" value={newCustomerData.pec} onChange={(e) => setNewCustomerData({ ...newCustomerData, pec: e.target.value })} />
                        </>
                      )}

                      {/* Common mandatory fields */}
                      <Input label="Telefono *" type="tel" required value={newCustomerData.telefono} onChange={(e) => setNewCustomerData({ ...newCustomerData, telefono: e.target.value })} />
                      <Input label="Email *" type="email" required value={newCustomerData.email} onChange={(e) => setNewCustomerData({ ...newCustomerData, email: e.target.value })} />
                      <div className="md:col-span-2">
                        <Input label="Indirizzo *" required value={newCustomerData.indirizzo} onChange={(e) => setNewCustomerData({ ...newCustomerData, indirizzo: e.target.value })} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-2">Cerca Cliente</label>
                    <CustomerAutocomplete
                      customers={customers}
                      selectedCustomerId={formData.customer_id}
                      onSelectCustomer={(customerId) => setFormData({ ...formData, customer_id: customerId })}
                      placeholder="Inizia a scrivere nome, email o telefono..."
                      required={true}
                    />

                    {customers.length === 0 && (
                      <p className="text-sm text-yellow-400 mt-2">
                        Nessun cliente trovato. Verifica che l'API sia attiva o crea un nuovo cliente.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Service Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* DATE SELECTION FIRST - Moved before vehicle selection */}
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 p-4  rounded-lg border border-theme-border">
                <div className="space-y-3">
                  <Input
                    label="Data Ritiro"
                    type="date"
                    required
                    value={formData.pickup_date}
                    onChange={(e) => {
                      setFormData({ ...formData, pickup_date: e.target.value })
                    }}
                  />
                  <Select
                    label="Ora Ritiro"
                    required
                    value={formData.pickup_time}
                    onChange={(e) => {
                      const pickupTime = e.target.value
                      const returnTime = calculateReturnTime(pickupTime)
                      setFormData({ ...formData, pickup_time: pickupTime, return_time: returnTime })
                    }}
                    options={(() => {
                      // If we have valid pickup times from the availability engine, use those
                      if (validPickupTimes.length > 0) {
                        return validPickupTimes.map(time => ({ value: time, label: time }))
                      }

                      // Otherwise, fall back to filtered time options (for when no vehicle/dates selected)
                      const base = getFilteredTimeOptions(formData.pickup_date)
                      const available = filterRentalTimeSlots(base.map(o => o.value), rentalEventsPickupDate)
                      return base.filter(o => available.includes(o.value) || o.value === formData.pickup_time)
                    })()}
                  />
                  {/* Warning if no slots available */}
                  {(() => {
                    if (formData.vehicle_id && formData.pickup_date && formData.return_date && validPickupTimes.length === 0) {
                      return <p className="text-xs text-red-400 mt-1">⚠️ Nessun orario disponibile per questo veicolo nelle date selezionate!</p>
                    }

                    const base = getFilteredTimeOptions(formData.pickup_date)
                    const available = filterRentalTimeSlots(base.map(o => o.value), rentalEventsPickupDate)
                    if (available.length === 0 && formData.pickup_date && !formData.vehicle_id) {
                      return <p className="text-xs text-red-400 mt-1">⚠️ Nessun orario disponibile!</p>
                    }
                    return null
                  })()}
                  <p className="text-xs text-green-400 mt-1">Admin: Qualsiasi orario disponibile</p>
                </div>
                <Select
                  label="Luogo Ritiro"
                  required
                  value={formData.pickup_location}
                  onChange={(e) => setFormData({ ...formData, pickup_location: e.target.value })}
                  options={LOCATIONS}
                />
                <div className="space-y-3">
                  <Input
                    label="Data Riconsegna"
                    type="date"
                    required
                    min={formData.pickup_date}
                    value={formData.return_date}
                    onChange={(e) => setFormData({ ...formData, return_date: e.target.value })}
                  />
                  <Select
                    label="Ora Riconsegna"
                    required
                    value={formData.return_time}
                    onChange={(e) => setFormData({ ...formData, return_time: e.target.value })}
                    options={(() => {
                      const base = getFilteredTimeOptions(formData.return_date)
                      const available = filterRentalTimeSlots(base.map(o => o.value), rentalEventsReturnDate)
                      return base.filter(o => available.includes(o.value) || o.value === formData.return_time)
                    })()}
                  />
                  {(() => {
                    const base = getFilteredTimeOptions(formData.return_date)
                    const available = filterRentalTimeSlots(base.map(o => o.value), rentalEventsReturnDate)
                    if (available.length === 0 && formData.return_date) {
                      return <p className="text-xs text-red-400 mt-1">⚠️ Nessun orario disponibile!</p>
                    }
                    return null
                  })()}
                  <p className="text-xs text-blue-400 mt-1">Suggerito: Ritiro - 1h30</p>
                  <p className="text-xs text-green-400">Admin: Qualsiasi orario disponibile</p>
                </div>
                <Select
                  label="Luogo Riconsegna"
                  required
                  value={formData.dropoff_location}
                  onChange={(e) => setFormData({ ...formData, dropoff_location: e.target.value })}
                  options={LOCATIONS}
                />
              </div>

              {/* VEHICLE SELECTION - Now appears after dates */}
              <div className="md:col-span-2">
                {!formData.pickup_date || !formData.return_date ? (
                  <div className="p-4 bg-yellow-900/20 border border-yellow-600/50 rounded-lg">
                    <p className="text-yellow-400 text-sm">
                      ⚠️ Seleziona le date per vedere i veicoli disponibili
                    </p>
                  </div>
                ) : (
                  <Select
                    label={`Veicolo (${availableVehicles.length} disponibili)`}
                    required
                    value={formData.vehicle_id}
                    onChange={(e) => setFormData({ ...formData, vehicle_id: e.target.value })}
                    options={[
                      { value: '', label: 'Seleziona veicolo...' },
                      ...vehiclesForDropdown.map((v: Vehicle) => {
                        let label = v.plate || v.targa ? `${v.display_name} (Targa: ${v.plate || v.targa})` : v.display_name
                        const earliestTime = vehicleEarliestTimes.get(v.id)
                        if (earliestTime) {
                          const hours = earliestTime.getHours().toString().padStart(2, '0')
                          const minutes = earliestTime.getMinutes().toString().padStart(2, '0')
                          label += ` (disponibile dalle ${hours}:${minutes})`
                        }
                        return { value: v.id, label }
                      })
                    ]}
                  />
                )}
                {formData.pickup_date && formData.return_date && availableVehicles.length === 0 && (
                  <p className="text-red-400 text-sm mt-2">
                    ❌ Nessun veicolo disponibile per le date selezionate
                  </p>
                )}
              </div>
            </div>

            {/* Second Driver Section */}
            <div className="md:col-span-2  p-4 rounded-lg border border-theme-border">
              <div className="flex items-center mb-4">
                <input
                  type="checkbox"
                  id="has_second_driver"
                  checked={formData.has_second_driver}
                  onChange={(e) => setFormData({ ...formData, has_second_driver: e.target.checked })}
                  className="w-4 h-4 text-dr7-gold bg-gray-700 border-theme-border-light rounded focus:ring-dr7-gold focus:ring-offset-gray-800"
                />
                <label htmlFor="has_second_driver" className="ml-2 text-sm font-medium text-theme-text-secondary">
                  Aggiungi Secondo Guidatore
                </label>
              </div>

              {formData.has_second_driver && (
                <div className="space-y-4 animate-fadeIn">
                  {/* Toggle between Select Customer and New Driver */}
                  <div className="flex items-center gap-4 mb-4">
                    <button
                      type="button"
                      onClick={() => setNewSecondDriverMode(false)}
                      className={`px-4 py-2 rounded-full ${!newSecondDriverMode ? 'bg-white text-black font-semibold' : 'bg-gray-700 text-theme-text-secondary hover:bg-gray-600'}`}
                    >
                      Seleziona Cliente
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewSecondDriverMode(true)}
                      className={`px-4 py-2 rounded-full ${newSecondDriverMode ? 'bg-white text-black font-semibold' : 'bg-gray-700 text-theme-text-secondary hover:bg-gray-600'}`}
                    >
                      Nuovo Guidatore
                    </button>
                  </div>

                  {newSecondDriverMode ? (
                    // New Driver Mode - Manual Entry
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Input
                        label="Nome *"
                        required
                        value={formData.second_driver_name}
                        onChange={(e) => setFormData({ ...formData, second_driver_name: e.target.value })}
                      />
                      <Input
                        label="Cognome *"
                        required
                        value={formData.second_driver_surname}
                        onChange={(e) => setFormData({ ...formData, second_driver_surname: e.target.value })}
                      />
                      <Input
                        label="Codice Fiscale *"
                        required
                        value={formData.second_driver_codice_fiscale}
                        onChange={(e) => setFormData({ ...formData, second_driver_codice_fiscale: e.target.value.toUpperCase() })}
                      />
                      <Select
                        label="Sesso *"
                        required
                        value={formData.second_driver_sesso}
                        onChange={(e) => setFormData({ ...formData, second_driver_sesso: e.target.value })}
                        options={[
                          { value: '', label: 'Seleziona...' },
                          { value: 'M', label: 'Maschio' },
                          { value: 'F', label: 'Femmina' }
                        ]}
                      />
                      <Input
                        label="Indirizzo *"
                        required
                        value={formData.second_driver_indirizzo}
                        onChange={(e) => setFormData({ ...formData, second_driver_indirizzo: e.target.value })}
                      />
                      <Input
                        label="CAP *"
                        required
                        value={formData.second_driver_cap}
                        onChange={(e) => setFormData({ ...formData, second_driver_cap: e.target.value })}
                      />
                      <Input
                        label="Città *"
                        required
                        value={formData.second_driver_citta}
                        onChange={(e) => setFormData({ ...formData, second_driver_citta: e.target.value })}
                      />
                      <Input
                        label="Provincia *"
                        required
                        value={formData.second_driver_provincia}
                        onChange={(e) => setFormData({ ...formData, second_driver_provincia: e.target.value.toUpperCase() })}
                        maxLength={2}
                      />
                      <Input
                        label="Data di Nascita *"
                        type="date"
                        required
                        value={formData.second_driver_birth_date}
                        onChange={(e) => setFormData({ ...formData, second_driver_birth_date: e.target.value })}
                      />
                      <Input
                        label="Città di Nascita *"
                        required
                        value={formData.second_driver_birth_place}
                        onChange={(e) => setFormData({ ...formData, second_driver_birth_place: e.target.value })}
                      />
                      <Input
                        label="Provincia di Nascita *"
                        required
                        value={formData.second_driver_birth_provincia}
                        onChange={(e) => setFormData({ ...formData, second_driver_birth_provincia: e.target.value.toUpperCase() })}
                        maxLength={2}
                      />
                      <Input
                        label="Telefono *"
                        type="tel"
                        required
                        value={formData.second_driver_phone}
                        onChange={(e) => setFormData({ ...formData, second_driver_phone: e.target.value })}
                      />
                      <Input
                        label="E-mail *"
                        type="email"
                        required
                        value={formData.second_driver_email}
                        onChange={(e) => setFormData({ ...formData, second_driver_email: e.target.value })}
                      />

                      {/* License Details */}
                      <div className="md:col-span-2 border-t border-theme-border-light pt-4 mt-2">
                        <h4 className="text-theme-text-primary font-semibold mb-3">Dettagli Patente</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <Input
                            label="Tipo di Patente *"
                            required
                            value={formData.second_driver_license_type}
                            onChange={(e) => setFormData({ ...formData, second_driver_license_type: e.target.value })}
                            placeholder="es. B"
                          />
                          <Input
                            label="Numero Patente *"
                            required
                            value={formData.second_driver_license_number}
                            onChange={(e) => setFormData({ ...formData, second_driver_license_number: e.target.value })}
                          />
                          <Input
                            label="Emessa da *"
                            required
                            value={formData.second_driver_license_issued_by}
                            onChange={(e) => setFormData({ ...formData, second_driver_license_issued_by: e.target.value })}
                            placeholder="es. Motorizzazione Civile"
                          />
                          <Input
                            label="Data di Rilascio *"
                            type="date"
                            required
                            value={formData.second_driver_license_issue_date}
                            onChange={(e) => setFormData({ ...formData, second_driver_license_issue_date: e.target.value })}
                          />
                          <Input
                            label="Scadenza Patente *"
                            type="date"
                            required
                            value={formData.second_driver_license_expiry}
                            onChange={(e) => setFormData({ ...formData, second_driver_license_expiry: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    // Select Existing Customer Mode
                    <div>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-2">Cerca Cliente per Secondo Guidatore</label>
                      <CustomerAutocomplete
                        customers={customers}
                        selectedCustomerId={formData.second_driver_id}
                        onSelectCustomer={(customerId) => setFormData({ ...formData, second_driver_id: customerId })}
                        placeholder="Inizia a scrivere nome, email o telefono..."
                        required={false}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Kasko Selection & Deposit */}
            <div className="md:col-span-2  p-4 rounded-lg border border-theme-border">
              <h4 className="text-theme-text-primary font-semibold mb-3">Opzioni Noleggio & Cauzione</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Select
                  label="Opzione Kasko"
                  value={formData.insurance_option}
                  onChange={(e) => setFormData({ ...formData, insurance_option: e.target.value as KaskoTier })}
                  options={
                    getInsuranceOptions(vehicles.find(v => v.id === formData.vehicle_id))
                      .map(o => ({ value: o.id, label: `${o.label} (+€${o.pricePerDay}/gg)` }))
                  }
                />
                <Input
                  label="Cauzione (€)"
                  type="number"
                  value={formData.deposit}
                  onChange={(e) => setFormData({ ...formData, deposit: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label="Stato Pagamento"
                required
                value={formData.payment_status}
                onChange={(e) => {
                  const newStatus = e.target.value
                  let newAmountPaid = formData.amount_paid

                  // Auto-update amount_paid based on status
                  if (newStatus === 'paid') {
                    newAmountPaid = formData.total_amount // Full payment
                  } else if (newStatus === 'unpaid') {
                    newAmountPaid = '0' // No payment
                  }
                  // If 'pending' (Da Saldare), leave amount_paid as is (allows partial)

                  setFormData({
                    ...formData,
                    payment_status: newStatus,
                    amount_paid: newAmountPaid,
                    status: newStatus === 'paid' ? 'confirmed' : 'pending',
                    payment_method: newStatus === 'unpaid' ? '' : formData.payment_method
                  })
                }}
                options={[
                  { value: 'pending', label: 'Da Saldare' },
                  { value: 'paid', label: 'Pagato' },
                  { value: 'unpaid', label: 'Non Pagato' },
                  { value: 'returned', label: 'Returned' }
                ]}
              />
              {formData.payment_status !== 'unpaid' && (
                <Select
                  label="Metodo di Pagamento"
                  required
                  value={formData.payment_method}
                  onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                  options={[
                    { value: 'Bonifico', label: 'Bonifico' },
                    { value: 'Contanti', label: 'Contanti' },
                    { value: 'Credit Wallet', label: 'Credit Wallet' },
                    { value: 'Carta di Credito / bancomat', label: 'Carta di Credito / bancomat' },
                    { value: 'Paypal', label: 'Paypal' },
                    { value: 'RIBA', label: 'RIBA' },
                    { value: 'RID', label: 'RID' },
                    { value: 'Bollettino postale', label: 'Bollettino postale' },
                    { value: 'Assegno', label: 'Assegno' },
                    { value: 'Assegno circolare', label: 'Assegno circolare' },
                    { value: 'PagoPA', label: 'PagoPA' },
                    { value: 'RID utenze', label: 'RID utenze' },
                    { value: 'RIB veloce', label: 'RIB veloce' },
                    { value: 'SEPA Direct Debit', label: 'SEPA Direct Debit' },
                    { value: 'SEPA Direct Debit CORE', label: 'SEPA Direct Debit CORE' },
                    { value: 'SEPA Direct Debit B2B', label: 'SEPA Direct Debit B2B' },
                    { value: 'Domiciliazione bancaria', label: 'Domiciliazione bancaria' },
                    { value: 'Domiciliazione postale', label: 'Domiciliazione postale' },
                    { value: 'Trattenuta su somme già riscosse', label: 'Trattenuta su somme già riscosse' },
                    { value: 'Bollettino bancario', label: 'Bollettino bancario' },
                    { value: 'Contanti presso tesoreria', label: 'Contanti presso tesoreria' },
                    { value: 'Vaglia cambiario', label: 'Vaglia cambiario' },
                    { value: 'Quietanza erario', label: 'Quietanza erario' },
                    { value: 'Giroconto su conti di contabilità', label: 'Giroconto su conti di contabilità' }
                  ]}
                />
              )}
              <Input
                label="Importo Totale (€)"
                type="number"
                step="0.01"
                required
                value={formData.total_amount}
                onChange={(e) => {
                  const newTotal = e.target.value
                  // If currently paid, update paid amount to match new total
                  const newPaid = formData.payment_status === 'paid' ? newTotal : formData.amount_paid
                  setFormData({ ...formData, total_amount: newTotal, amount_paid: newPaid })
                }}
              />
              <Input
                label="Sforo per KM (€)"
                type="number"
                step="0.01"
                value={formData.km_overage_fee}
                onChange={(e) => setFormData({ ...formData, km_overage_fee: e.target.value })}
                placeholder="es. 0.50"
                disabled={formData.unlimited_km}
              />
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-theme-text-secondary mb-2">LIMITE KM (Da inserire):</h4>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                  {[100, 180, 240, 280, 300].map((kmLimit) => (
                    <div
                      key={kmLimit}
                      className={`p-2 rounded-md border cursor-pointer transition-all flex flex-col items-center justify-center text-center ${parseInt(formData.km_limit) === kmLimit && !formData.unlimited_km
                        ? 'border-white bg-white/5'
                        : 'border-theme-border hover:border-gray-500'
                        } ${formData.unlimited_km ? 'opacity-50 cursor-not-allowed' : ''}`}
                      onClick={() => !formData.unlimited_km && setFormData(p => ({ ...p, km_limit: kmLimit.toString() }))}
                    >
                      <span className="text-theme-text-primary font-bold text-xs">{kmLimit} km</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Manual KM Input - Fallback if not using presets */}
              <Input
                label="Limite KM Personale"
                type="number"
                value={formData.km_limit}
                onChange={(e) => setFormData({ ...formData, km_limit: e.target.value })}
                placeholder="es. 150 (Lascia vuoto se Illimitati)"
                disabled={formData.unlimited_km}
              />
              <div className="flex items-center gap-2 p-3  rounded-lg border border-theme-border">
                <input
                  type="checkbox"
                  id="unlimited_km"
                  checked={formData.unlimited_km}
                  onChange={(e) => setFormData({ ...formData, unlimited_km: e.target.checked, km_overage_fee: e.target.checked ? '0' : formData.km_overage_fee })}
                  className="w-4 h-4 text-blue-600 bg-gray-700 border-theme-border-light rounded focus:ring-blue-500"
                />
                <label htmlFor="unlimited_km" className="text-sm text-theme-text-secondary cursor-pointer">
                  ✅ KM Illimitati
                </label>
              </div>
              <Input
                label="Importo Pagato (€)"
                type="number"
                step="0.01"
                required
                value={formData.amount_paid}
                onChange={(e) => {
                  const newPaid = parseFloat(e.target.value) || 0
                  const total = parseFloat(formData.total_amount) || 0
                  let newStatus = formData.payment_status

                  // Auto-detect status based on amount entered
                  if (newPaid >= total && total > 0) {
                    newStatus = 'paid'
                  } else if (newPaid > 0 && newPaid < total) {
                    newStatus = 'pending' // Da Saldare (Partial)
                  } else if (newPaid === 0) {
                    // Only set to unpaid if it was pending/paid, but maybe user wants pending?
                    // Let's default to 'pending' (Da Saldare) if 0, unless explicitly unpaid.
                    // Actually, if they type 0 manually, it's likely they mean 0 paid.
                    // But 'unpaid' status hides the payment method.
                    // Let's keep current status unless it strictly becomes paid.
                    if (newStatus === 'paid') newStatus = 'pending'
                  }

                  setFormData({
                    ...formData,
                    amount_paid: e.target.value,
                    payment_status: newStatus,
                    status: newStatus === 'paid' ? 'confirmed' : formData.status // Don't unconfirm if partial
                  })
                }}
              />
              <Input
                label="Valuta"
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
              />
            </div>

            <div className="flex gap-3 mt-4">
              <Button type="submit">
                Salva
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setShowForm(false); setEditingId(null); setNewCustomerMode(false); resetForm() }}>
                Annulla
              </Button>
            </div>
          </form>
        )}

        {/* Mobile Card View */}
        <div className="lg:hidden space-y-3">
          {bookings.filter(booking => {
            // Search filter
            if (!bookingSearchQuery) return true
            const query = bookingSearchQuery.toLowerCase()
            const customerName = (booking.booking_details?.customer?.fullName || booking.customer_name || '').toLowerCase()
            return customerName.includes(query)
          }).length === 0 && (
              <div className="rounded-lg border border-gray-700/30 p-8 text-center text-gray-500">
                {bookingSearchQuery ? `Nessuna prenotazione trovata per "${bookingSearchQuery}"` : 'Nessuna prenotazione trovata'}
              </div>
            )}

          {/* Display bookings as cards on mobile */}
          {bookings.filter(booking => {
            // Search filter
            if (!bookingSearchQuery) return true
            const query = bookingSearchQuery.toLowerCase()
            const customerName = (booking.booking_details?.customer?.fullName || booking.customer_name || '').toLowerCase()
            return customerName.includes(query)
          }).map((booking) => {
            const isCarWash = booking.service_type === 'car_wash'
            return (
              <div
                key={`booking-card-${booking.id}`}
                className="rounded-full p-4 cursor-pointer hover:bg-white/5 transition-colors border border-gray-700/30"
                onClick={() => setSelectedBooking(booking)}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <div className="font-semibold text-theme-text-primary mb-1">
                      {booking.booking_details?.customer?.fullName || booking.customer_name || 'N/A'}
                    </div>
                    <div className="text-sm text-theme-text-muted">{booking.customer_phone || '-'}</div>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${booking.payment_status === 'completed' ||
                    booking.payment_status === 'paid' ||
                    (booking.booking_details?.amountPaid && booking.booking_details.amountPaid >= booking.price_total)
                    ? 'bg-green-900 text-green-300'
                    : 'bg-red-900 text-red-300'
                    }`}>
                    {booking.payment_status === 'completed' ||
                      booking.payment_status === 'paid' ||
                      (booking.booking_details?.amountPaid && booking.booking_details.amountPaid >= booking.price_total)
                      ? 'Pagato'
                      : 'Non Pagato'}
                  </span>
                </div>

                <div className="mb-2">
                  <div className="flex items-center gap-2 text-theme-text-primary">
                    {isCarWash ? (
                      <>
                        <span className="text-sm">{booking.service_name || 'Autolavaggio'}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-sm">{booking.vehicle_name}</span>
                      </>
                    )}
                  </div>
                  {!isCarWash && booking.vehicle_plate && (
                    <div className="text-xs text-theme-text-muted mt-1">Targa: {booking.vehicle_plate}</div>
                  )}
                </div>

                <div className="text-xs text-theme-text-muted mb-2">
                  {isCarWash
                    ? `${booking.appointment_date ? new Date(booking.appointment_date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' }) : '-'}${booking.appointment_time ? ` alle ${booking.appointment_time}` : ''}`
                    : `${booking.pickup_date ? new Date(typeof booking.pickup_date === 'number' ? booking.pickup_date * 1000 : booking.pickup_date).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome', hour12: false }) : '-'} → ${booking.dropoff_date ? new Date(typeof booking.dropoff_date === 'number' ? booking.dropoff_date * 1000 : booking.dropoff_date).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome', hour12: false }) : '-'}`
                  }
                </div>

                <div className="flex justify-between items-start mt-3 gap-2">
                  <div className="text-lg font-bold text-theme-text-primary">
                    {canViewFinancials || userEmail === 'dubai.rent7.0srl@gmail.com' ? `€${(booking.price_total / 100).toFixed(2)}` : '***'}
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEditBooking(booking) }}
                      className="px-3 py-1 bg-blue-600/30 hover:bg-blue-600/50 rounded-full text-theme-text-primary text-sm transition-colors whitespace-nowrap"
                    >
                      Modifica
                    </button>

                    {/* Contract Actions */}
                    {booking.booking_details?.contract_generated_at || booking.contract_url ? (
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); window.open(booking.contract_url, '_blank') }}
                          className="px-3 py-1 bg-green-600/30 hover:bg-green-600/50 rounded-full text-theme-text-primary text-sm transition-colors whitespace-nowrap flex items-center gap-1"
                          title="Visualizza Contratto"
                        >
                          📄 Contratto
                        </button>
                        {/* Fattura Button (Mobile) */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleGenerateInvoice(booking) }}
                          disabled={generatingInvoice}
                          className={`px-3 py-1 ${generatingInvoice ? 'bg-gray-600 text-theme-text-secondary' : 'bg-blue-600/30 hover:bg-blue-600/50 text-theme-text-primary'} text-sm rounded-full transition-colors whitespace-nowrap flex items-center gap-1`}
                          title="Fattura"
                        >
                          {generatingInvoice ? 'Generazione...' : 'Fattura'}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleGenerateContract(booking) }}
                        disabled={generatingContract}
                        className={`px-3 py-1 ${generatingContract ? 'bg-gray-600 text-theme-text-secondary' : 'bg-dr7-gold hover:bg-yellow-600 text-theme-text-primary'} text-sm rounded-full transition-colors whitespace-nowrap flex items-center gap-1`}
                      >
                        {generatingContract ? 'Generazione...' : '📄 Contratto'}
                      </button>
                    )}

                    {booking.status !== 'cancelled' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCancelBooking(booking.id, 'booking') }}
                        className="px-3 py-1 bg-orange-600 hover:bg-orange-700 rounded-full text-theme-text-primary text-sm transition-colors whitespace-nowrap"
                      >
                        Cancella
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteBooking(booking.id, 'booking') }}
                      className="px-3 py-1 bg-red-600/30 hover:bg-red-600/50 rounded-full text-theme-text-primary text-sm transition-colors whitespace-nowrap w-full"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Desktop Table View */}
        <div className="hidden lg:block  rounded-lg overflow-hidden">
          <div className="overflow-x-auto overflow-y-visible custom-scrollbar">
            <table className="w-full min-w-max">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-theme-text-secondary whitespace-nowrap">Nome</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-theme-text-secondary whitespace-nowrap">Telefono</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-theme-text-secondary whitespace-nowrap">Car</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-theme-text-secondary whitespace-nowrap">Data Inizio</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-theme-text-secondary whitespace-nowrap">Data Fine</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-theme-text-secondary whitespace-nowrap">Pagamento</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-theme-text-secondary whitespace-nowrap">Totale</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-theme-text-secondary whitespace-nowrap">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {/* Display bookings from bookings table (single source of truth) */}
                {bookings.filter(booking => {
                  // Search filter
                  if (!bookingSearchQuery) return true
                  const query = bookingSearchQuery.toLowerCase()
                  const customerName = (booking.booking_details?.customer?.fullName || booking.customer_name || '').toLowerCase()
                  return customerName.includes(query)
                }).map((booking) => {
                  const isCarWash = booking.service_type === 'car_wash'
                  return (
                    <tr key={`booking-${booking.id}`} className="border-t border-theme-border hover:/50 cursor-pointer" onClick={() => setSelectedBooking(booking)}>
                      <td className="px-3 py-3 text-sm text-theme-text-primary whitespace-nowrap">
                        {booking.booking_details?.customer?.fullName || booking.customer_name || 'N/A'}
                      </td>
                      <td className="px-3 py-3 text-sm text-theme-text-primary whitespace-nowrap">
                        {booking.customer_phone || '-'}
                      </td>
                      <td className="px-3 py-3 text-sm text-theme-text-primary whitespace-nowrap">
                        {isCarWash ? (
                          <span className="flex items-center gap-2">
                            <span>{booking.service_name || 'Autolavaggio'}</span>
                          </span>
                        ) : (
                          <div className="flex flex-col">
                            <span className="flex items-center gap-2">
                              <span>{booking.vehicle_name}</span>
                            </span>
                            {booking.vehicle_plate && (
                              <span className="text-xs text-theme-text-muted">Targa: {booking.vehicle_plate}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm text-theme-text-primary whitespace-nowrap">
                        {isCarWash
                          ? (booking.appointment_date ? `${new Date(booking.appointment_date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' })} ${booking.appointment_time || ''}` : '-')
                          : (booking.pickup_date ? new Date(typeof booking.pickup_date === 'number' ? booking.pickup_date * 1000 : booking.pickup_date).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome', hour12: false }) : '-')
                        }
                      </td>
                      <td className="px-3 py-3 text-sm text-theme-text-primary whitespace-nowrap">
                        {isCarWash
                          ? (booking.appointment_date && booking.appointment_time
                            ? `${new Date(booking.appointment_date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' })} ${calculateCarWashEndTime(booking.appointment_date, booking.appointment_time, booking.price_total)}`
                            : '-')
                          : (booking.dropoff_date ? new Date(typeof booking.dropoff_date === 'number' ? booking.dropoff_date * 1000 : booking.dropoff_date).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome', hour12: false }) : '-')
                        }
                      </td>
                      <td className="px-3 py-3 text-sm whitespace-nowrap">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${booking.payment_status === 'completed' ||
                          booking.payment_status === 'paid' ||
                          (booking.booking_details?.amountPaid && booking.booking_details.amountPaid >= booking.price_total)
                          ? 'bg-green-900 text-green-300'
                          : 'bg-red-900 text-red-300'
                          }`}>
                          {booking.payment_status === 'completed' ||
                            booking.payment_status === 'paid' ||
                            (booking.booking_details?.amountPaid && booking.booking_details.amountPaid >= booking.price_total)
                            ? 'Pagato'
                            : 'Non Pagato'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm text-theme-text-primary whitespace-nowrap">
                        {canViewFinancials || userEmail === 'dubai.rent7.0srl@gmail.com' ? `€${(booking.price_total / 100).toFixed(2)}` : '***'}
                      </td>
                      <td className="px-3 py-3 text-sm whitespace-nowrap">
                        <div className="flex gap-2 items-center">
                          {booking.status !== 'cancelled' && (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleGenerateContract(booking) }}
                                disabled={generatingContract}
                                className="px-3 py-1 bg-green-600/30 hover:bg-green-600/50 rounded-full text-theme-text-primary text-xs rounded-full transition-colors whitespace-nowrap disabled:opacity-50"
                              >
                                {generatingContract ? '...' : 'Contratto'}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleGenerateInvoice(booking) }}
                                disabled={generatingInvoice}
                                className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-theme-text-primary text-xs rounded-full transition-colors whitespace-nowrap disabled:opacity-50"
                              >
                                {generatingInvoice ? '...' : 'Fattura'}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleEditBooking(booking) }}
                                className="px-3 py-1 bg-blue-600/30 hover:bg-blue-600/50 rounded-full text-theme-text-primary text-xs rounded-full transition-colors whitespace-nowrap"
                              >
                                Modifica
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCancelBooking(booking.id, 'booking') }}
                                className="px-3 py-1 bg-orange-600 hover:bg-orange-700 rounded-full text-theme-text-primary text-xs rounded-full transition-colors whitespace-nowrap"
                              >
                                Cancella
                              </button>
                            </>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedBookingForPenalty(booking); setPenaltyModalOpen(true) }}
                            className="px-3 py-1 bg-yellow-600/30 hover:bg-yellow-600/50 rounded-full text-theme-text-primary text-xs rounded-full transition-colors whitespace-nowrap"
                          >
                            Penali
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteBooking(booking.id, 'booking') }}
                            className="px-3 py-1 bg-red-600/30 hover:bg-red-600/50 rounded-full text-theme-text-primary text-xs rounded-full transition-colors whitespace-nowrap"
                          >
                            ×
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}

                {bookings.filter(booking => {
                  // Search filter
                  if (!bookingSearchQuery) return true
                  const query = bookingSearchQuery.toLowerCase()
                  const customerName = (booking.booking_details?.customer?.fullName || booking.customer_name || '').toLowerCase()
                  return customerName.includes(query)
                }).length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                        {bookingSearchQuery ? `Nessuna prenotazione trovata per "${bookingSearchQuery}"` : 'Nessuna prenotazione trovata'}
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail Modal - Mobile Optimized */}
        {selectedBooking && (
          <div className="fixed inset-0 bg-black backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
            <div className="w-full sm:max-w-2xl bg-[#1a1a1a] sm:rounded-lg max-h-[90vh] flex flex-col overflow-hidden border border-gray-700/30">
              {/* Modal Header */}
              <div className="flex-shrink-0  p-4 border-b border-theme-border flex justify-between items-center">
                <h3 className="text-lg sm:text-xl font-bold text-dr7-gold">Dettagli Prenotazione</h3>
                <button
                  onClick={() => setSelectedBooking(null)}
                  className="text-theme-text-muted hover:text-theme-text-primary text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              {/* Modal Content */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                {/* Customer Info */}
                <div className=" p-4 rounded-lg">
                  <h4 className="font-semibold text-theme-text-primary mb-3 flex items-center gap-2">
                    Cliente
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div><span className="text-theme-text-muted">Nome:</span> <span className="text-theme-text-primary">{selectedBooking.booking_details?.customer?.fullName || selectedBooking.customer_name || 'N/A'}</span></div>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-theme-text-muted">Telefono:</span> <span className="text-theme-text-primary">{selectedBooking.customer_phone || '-'}</span>
                      </div>
                      {selectedBooking.customer_phone && (
                        <a
                          href={`tel:${selectedBooking.customer_phone}`}
                          className="px-3 py-1 bg-green-600/30 hover:bg-green-600/50 rounded-full text-theme-text-primary rounded-full text-xs font-medium transition-colors"
                        >
                          Chiama
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Service Info */}
                <div className=" p-4 rounded-lg">
                  <h4 className="font-semibold text-theme-text-primary mb-3 flex items-center gap-2">
                    Car
                  </h4>
                  <div className="space-y-2 text-sm">
                    {selectedBooking.service_type === 'car_wash' ? (
                      <>
                        <div><span className="text-theme-text-muted">Tipo:</span> <span className="text-theme-text-primary">{selectedBooking.service_name || 'Autolavaggio'}</span></div>
                        <div><span className="text-theme-text-muted">Data:</span> <span className="text-theme-text-primary">{selectedBooking.appointment_date ? new Date(selectedBooking.appointment_date).toLocaleDateString('it-IT', { dateStyle: 'full' }) : '-'}</span></div>
                        <div><span className="text-theme-text-muted">Ora:</span> <span className="text-theme-text-primary">{selectedBooking.appointment_time || '-'}</span></div>
                        {selectedBooking.booking_details?.additionalService && (
                          <div><span className="text-theme-text-muted">Servizio Aggiuntivo:</span> <span className="text-theme-text-primary">{selectedBooking.booking_details.additionalService}</span></div>
                        )}
                      </>
                    ) : (
                      <>
                        <div><span className="text-theme-text-muted">Veicolo:</span> <span className="text-theme-text-primary">{selectedBooking.vehicle_name || '-'}</span></div>
                        {selectedBooking.vehicle_plate && (
                          <div><span className="text-theme-text-muted">Targa:</span> <span className="text-theme-text-primary">{selectedBooking.vehicle_plate}</span></div>
                        )}
                        <div><span className="text-theme-text-muted">Ritiro:</span> <span className="text-theme-text-primary">{selectedBooking.pickup_date ? new Date(typeof selectedBooking.pickup_date === 'number' ? selectedBooking.pickup_date * 1000 : selectedBooking.pickup_date).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '-'}</span></div>
                        <div><span className="text-theme-text-muted">Luogo Ritiro:</span> <span className="text-theme-text-primary">{selectedBooking.pickup_location || '-'}</span></div>
                        <div><span className="text-theme-text-muted">Riconsegna:</span> <span className="text-theme-text-primary">{selectedBooking.dropoff_date ? new Date(typeof selectedBooking.dropoff_date === 'number' ? selectedBooking.dropoff_date * 1000 : selectedBooking.dropoff_date).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '-'}</span></div>
                        <div><span className="text-theme-text-muted">Luogo Riconsegna:</span> <span className="text-theme-text-primary">{selectedBooking.dropoff_location || '-'}</span></div>
                        <div><span className="text-theme-text-muted">Assicurazione:</span> <span className="text-dr7-gold">{selectedBooking.booking_details?.insuranceOption || 'N/A'}</span></div>
                        <div><span className="text-theme-text-muted">Cauzione:</span> <span className="text-theme-text-primary">{selectedBooking.booking_details?.deposit ? `€${selectedBooking.booking_details.deposit}` : 'N/A'}</span></div>
                      </>
                    )}
                  </div>
                </div>

                {/* Payment Info */}
                <div className=" p-4 rounded-lg">
                  <h4 className="font-semibold text-theme-text-primary mb-3 flex items-center gap-2">
                    Pagamento
                  </h4>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-theme-text-muted">Importo:</span>
                      <span className="text-theme-text-primary font-bold text-xl">
                        {canViewFinancials || userEmail === 'dubai.rent7.0srl@gmail.com' ? `€${(selectedBooking.price_total / 100).toFixed(2)}` : '***'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-theme-text-muted">Stato:</span>
                      <span className={`px-3 py-1.5 rounded text-sm font-medium ${selectedBooking.payment_status === 'completed' ||
                        selectedBooking.payment_status === 'paid' ||
                        (selectedBooking.booking_details?.amountPaid && selectedBooking.booking_details.amountPaid >= selectedBooking.price_total)
                        ? 'bg-green-900 text-green-300'
                        : selectedBooking.payment_status === 'pending'
                          ? 'bg-yellow-900 text-yellow-300'
                          : 'bg-red-900 text-red-300'
                        }`}>
                        {selectedBooking.payment_status === 'completed' ||
                          selectedBooking.payment_status === 'paid' ||
                          (selectedBooking.booking_details?.amountPaid && selectedBooking.booking_details.amountPaid >= selectedBooking.price_total)
                          ? 'Pagato'
                          : selectedBooking.payment_status === 'pending'
                            ? 'Da Saldare'
                            : 'Non Pagato'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                {selectedBooking.booking_details?.notes && (
                  <div className=" p-4 rounded-lg">
                    <h4 className="font-semibold text-theme-text-primary mb-3 flex items-center gap-2">
                      Note
                    </h4>
                    <p className="text-sm text-theme-text-secondary">{selectedBooking.booking_details.notes}</p>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-3 pt-4">
                  {selectedBooking.status !== 'cancelled' && (
                    <button
                      onClick={() => handleGenerateContract(selectedBooking)}
                      disabled={generatingContract}
                      className="flex-1 px-4 py-3 bg-green-600/30 hover:bg-green-600/50 rounded-full text-theme-text-primary rounded-full transition-colors font-medium disabled:opacity-50"
                    >
                      {generatingContract ? 'Generazione in corso...' : 'Scarica Contratto'}
                    </button>
                  )}
                  {selectedBooking.status !== 'cancelled' && (
                    <button
                      onClick={() => {
                        handleCancelBooking(selectedBooking.id, 'booking')
                        setSelectedBooking(null)
                      }}
                      className="flex-1 px-4 py-3 bg-red-600/30 hover:bg-red-600/50 rounded-full text-theme-text-primary rounded-full transition-colors font-medium"
                    >
                      Cancella Prenotazione
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedBooking(null)}
                    className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 text-theme-text-primary rounded-full transition-colors font-medium"
                  >
                    Chiudi
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Missing Fields Modal - Shows only the missing fields */}
        {showMissingDataModal && tempCustomerData && tempCustomerData.id && (
          <MissingFieldsModal
            isOpen={showMissingDataModal}
            customerId={tempCustomerData.id}
            customerData={tempCustomerData}
            missingFields={missingFields}
            onClose={() => setShowMissingDataModal(false)}
            onSave={async (updatedData: any) => {
              try {
                console.log('[ReservationsTab] Missing fields saved:', updatedData)

                const resolvedCustomerId = updatedData.id

                // If in booking context, update form to use this customer
                if (validationContext === 'booking') {
                  console.log('[ReservationsTab] Resuming booking with customer:', resolvedCustomerId)
                  setFormData(prev => ({ ...prev, customer_id: resolvedCustomerId }))
                  setNewCustomerMode(false)
                }

                // Reload data to refresh customer list
                await loadData()
                setShowMissingDataModal(false)

                // If in booking context, automatically continue with booking submission
                if (validationContext === 'booking') {
                  console.log('[ReservationsTab] Auto-resuming booking submission...')
                  // Use setTimeout to ensure state updates have propagated
                  setTimeout(() => {
                    processBookingSubmission(true, resolvedCustomerId)
                  }, 100)
                }
                // If in contract/invoice context, retry generation
                else if (validationContext === 'contract' && currentValidationBooking) {
                  console.log('[ReservationsTab] Retrying contract generation...')
                  setTimeout(() => {
                    handleGenerateContract(currentValidationBooking, true)
                  }, 100)
                } else if (validationContext === 'invoice' && currentValidationBooking) {
                  console.log('[ReservationsTab] Retrying invoice generation...')
                  setTimeout(() => {
                    handleGenerateInvoice(currentValidationBooking)
                  }, 100)
                }
              } catch (error: any) {
                console.error('[ReservationsTab] Error after saving missing fields:', error)
                alert(`Errore: ${error.message}`)
              }
            }}
          />
        )}

        {/* Cancel Confirmation Modal */}
        {showCancelConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowCancelConfirm(false)}>
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-xl font-bold mb-4 text-gray-900">⚠️ Conferma Cancellazione</h3>
              <p className="text-gray-700 mb-6">
                Sei sicuro di voler cancellare questa prenotazione?
                <br /><br />
                <strong>Questa azione:</strong>
                <br />• Cancellerà la prenotazione
                <br />• Cancellerà il lavaggio auto collegato
                <br />• Rimuoverà l'evento dal calendario
              </p>
              <div className="flex gap-3 justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setShowCancelConfirm(false)
                    setPendingCancelId(null)
                  }}
                >
                  Annulla
                </Button>
                <Button
                  type="button"
                  onClick={confirmCancelBooking}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  Sì, Cancella
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowDeleteConfirm(false)}>
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-xl font-bold mb-4 text-red-600">🗑️ Elimina Definitivamente</h3>
              <p className="text-gray-700 mb-6">
                <strong className="text-red-600">⚠️ ATTENZIONE:</strong> Vuoi eliminare definitivamente questa prenotazione dal database?
                <br /><br />
                <strong>Questa azione NON può essere annullata!</strong>
                <br /><br />
                Se vuoi solo annullare la prenotazione, usa il pulsante "Cancella" invece.
              </p>
              <div className="flex gap-3 justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setShowDeleteConfirm(false)
                    setPendingDeleteId(null)
                  }}
                >
                  Annulla
                </Button>
                <Button
                  type="button"
                  onClick={confirmDeleteBooking}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  Sì, Elimina Definitivamente
                </Button>
              </div>
            </div>
          </div>
        )}

      </div >
    </>
  )
}


