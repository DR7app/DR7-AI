import { useState, useEffect } from 'react'
import { getSpecialPricing, calculateSpecialPrice } from '../../../utils/specialPricing'
import { supabase } from '../../../supabaseClient'
import { useAdminRole } from '../../../hooks/useAdminRole'
import Input from './Input'
import Select from './Select'
import Button from './Button'
import CustomerAutocomplete from './CustomerAutocomplete'

// --- Kasko Constants & Types ---
type KaskoTier = 'KASKO_BASE' | 'KASKO_BLACK' | 'KASKO_SIGNATURE';

export const INSURANCE_OPTIONS = [
  { id: 'KASKO_BASE', label: 'KASKO BASE', pricePerDay: 100 },
  { id: 'KASKO_BLACK', label: 'KASKO BLACK', pricePerDay: 150 },
  { id: 'KASKO_SIGNATURE', label: 'KASKO SIGNATURE', pricePerDay: 200 },
];

export const URBAN_INSURANCE_OPTIONS = [
  { id: 'KASKO_BASE', label: 'KASKO BASE', pricePerDay: 0 },
  { id: 'KASKO_BLACK', label: 'KASKO BLACK', pricePerDay: 5 },
  { id: 'KASKO_SIGNATURE', label: 'KASKO SIGNATURE', pricePerDay: 25 },
];

// UTILITAIRE has only KASKO BASE
export const UTILITAIRE_INSURANCE_OPTIONS = [
  { id: 'KASKO_BASE', label: 'KASKO BASE', pricePerDay: 15 },
];

// Special pricing for Ducato/Vito (furgone)
export const FURGONE_INSURANCE_OPTIONS = [
  { id: 'KASKO_BASE', label: 'KASKO BASE', pricePerDay: 30 },
];

// Deposit amounts by vehicle type
export const DEPOSIT_AMOUNTS = {
  UTILITAIRE: 1000,
  FURGONE: 2500, // Ducato, Vito
  SUPERCAR: 10000,
};

export const INSURANCE_ELIGIBILITY = {
  KASKO_BASE: { minAge: 20, minLicenseYears: 2 },
  KASKO_BLACK: { minAge: 25, minLicenseYears: 5 },
  KASKO_SIGNATURE: { minAge: 30, minLicenseYears: 10 },
};

export const URBAN_INSURANCE_ELIGIBILITY = {
  KASKO_BASE: { minAge: 18, minLicenseYears: 3 },
  KASKO_BLACK: { minAge: 25, minLicenseYears: 5 },
  KASKO_SIGNATURE: { minAge: 30, minLicenseYears: 10 },
};

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

export default function ReservationsTab() {
  const { canViewFinancials } = useAdminRole()
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [generatingContract, setGeneratingContract] = useState(false)

  // Add custom scrollbar styles
  const scrollbarStyle = `
    .custom-scrollbar::-webkit-scrollbar {
      height: 8px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
      background: #1a1a1a;
      border-radius: 10px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background: #4a4a4a;
      border-radius: 10px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background: #6a6a6a;
    }
  `

  const [formData, setFormData] = useState({
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
    status: 'confirmed',
    source: 'admin',
    total_amount: '0',
    amount_paid: '0',
    payment_status: 'paid',
    payment_method: 'Contanti',
    currency: 'EUR',
    // 2nd Driver
    has_second_driver: false,
    second_driver_name: '',
    second_driver_surname: '',
    second_driver_license_number: '',
    second_driver_license_expiry: '',
    second_driver_phone: '',
    second_driver_birth_date: '',
    second_driver_birth_place: '',
    // Kasko & Deposit
    insurance_option: 'KASKO_BASE' as KaskoTier,
    deposit: '0',
    // KM Overage Fee
    km_overage_fee: '0'
  })

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
    driver_license_number: ''
  })

  const [bookingSearchQuery, setBookingSearchQuery] = useState('')

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

      if (bookingsCustomerError) {
        console.error('Failed to load customers from bookings:', bookingsCustomerError)
      }

      // Merge customers by email or phone (same logic as CustomersTab)
      const customerMap = new Map<string, Customer>()

      if (bookingsForCustomers) {
        bookingsForCustomers.forEach((booking: any) => {
          const details = booking.booking_details?.customer || {}
          const customerName = booking.customer_name || details.fullName || 'Cliente'
          const customerEmail = booking.customer_email || details.email || null
          const customerPhone = booking.customer_phone || details.phone || null

          const key = customerEmail || customerPhone || booking.user_id

          if (key) {
            const existing = customerMap.get(key)
            if (existing) {
              if (!existing.phone && customerPhone) existing.phone = customerPhone
              if (!existing.email && customerEmail) existing.email = customerEmail
              if (existing.full_name === 'Cliente' && customerName) existing.full_name = customerName
            } else {
              customerMap.set(key, {
                id: booking.user_id || key,
                full_name: customerName,
                email: customerEmail,
                phone: customerPhone,
                driver_license_number: null,
                notes: null,
                created_at: booking.booked_at,
                updated_at: booking.booked_at
              })
            }
          }
        })
      }

      // Also check customers table if it exists
      // Also fetch from customers_extended (the main source of truth)
      const { data: customersExtendedData, error: customersExtendedError } = await supabase
        .from('customers_extended')
        .select('*')
        .order('created_at', { ascending: false })

      if (customersExtendedError) {
        console.error('Failed to load customers_extended:', customersExtendedError)
      } else if (customersExtendedData) {
        customersExtendedData.forEach((c: any) => {
          // Map to local Customer interface
          let fullName = 'N/A'
          if (c.tipo_cliente === 'azienda') {
            fullName = c.denominazione || 'N/A'
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
            driver_license_number: null,
            notes: null,
            created_at: c.created_at,
            updated_at: c.created_at
          }

          // Use ID, email, or phone as key to merge with existing inferred customers
          const key = c.email || c.telefono || c.id
          if (key && !customerMap.has(key)) {
            customerMap.set(key, mappedCustomer)
          } else if (key && customerMap.has(key)) {
            // Optional: Upgrade existing inferred customer with real data if needed
            // But let's keep it simple for now and just fill gaps
          }
        })
      }

      // Also check legacy customers table if it exists (for backward compatibility)
      const { data: customersTableData, error: customersTableError } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false })

      if (!customersTableError && customersTableData) {
        customersTableData.forEach(c => {
          const key = c.email || c.phone || c.id
          if (key && !customerMap.has(key)) {
            customerMap.set(key, c)
          }
        })
      }

      const customersArray = Array.from(customerMap.values())
      console.log('CUSTOMERS LOADED:', customersArray.length, customersArray)
      setCustomers(customersArray)

      const { data: vehiclesData, error: vehiclesError } = await supabase
        .from('vehicles')
        .select('*')
        .neq('status', 'retired')
        .order('display_name')

      if (vehiclesError) {
        console.error('Failed to load vehicles:', vehiclesError)
      } else {
        console.log('VEHICLES LOADED:', vehiclesData?.length || 0, vehiclesData)
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

  async function handleCancelBooking(bookingId: string, bookingType: 'booking' | 'reservation') {
    if (!confirm('Sei sicuro di voler cancellare questa prenotazione?')) {
      return
    }

    try {
      // Get booking details before cancelling
      let customerName = ''
      let vehicleName = ''

      if (bookingType === 'booking') {
        const booking = bookings.find(b => b.id === bookingId)
        customerName = booking?.customer_name || ''
        vehicleName = booking?.vehicle_name || ''

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

      alert('Prenotazione cancellata con successo')
      loadData()
    } catch (error) {
      console.error('Failed to cancel booking:', error)
      alert('Errore durante la cancellazione: ' + (error as Error).message)
    }
  }

  async function handleGenerateContract(booking: Booking, showSuccessAlert = true) {
    if (!booking.id) return

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
        // Reload data to show the contract link in the UI
        loadData()
        if (showSuccessAlert) {
          alert('✅ Contratto generato con successo! 📄')
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

  async function handleSendToYousign(bookingId: string) {
    console.log('[handleSendToYousign] Clicked for booking:', bookingId)
    // if (!confirm('Vuoi inviare il contratto a Yousign per la firma digitale?')) return // Commented out for debugging speed

    try {
      console.log('[handleSendToYousign] Sending fetch request...')
      const res = await fetch('/.netlify/functions/yousign-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId })
      })
      console.log('[handleSendToYousign] Response status:', res.status)

      const text = await res.text()
      console.log('[handleSendToYousign] Response body:', text)

      let data
      try {
        data = JSON.parse(text)
      } catch (e) {
        throw new Error('Risposta non valida dal server: ' + text.substring(0, 100))
      }

      if (res.ok) {
        alert('Richiesta di firma inviata con successo! 📩')
        loadData()
      } else {
        throw new Error(data.error || 'Errore sconosciuto')
      }
    } catch (error: any) {
      console.error('Yousign error:', error)
      alert('Errore Yousign: ' + error.message)
    }
  }

  async function handleDeleteBooking(bookingId: string, bookingType: 'booking' | 'reservation') {
    if (!confirm('⚠️ ATTENZIONE: Vuoi eliminare definitivamente questa prenotazione dal database?\n\nQuesta azione NON può essere annullata!\n\nSe vuoi solo annullare la prenotazione, usa il pulsante "Cancella" invece.')) {
      return
    }

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

    // Set customer data
    const customerId = booking.booking_details?.customer?.customerId || booking.user_id || ''

    // Populate rental data
    const pickupDate = booking.pickup_date ? new Date(typeof booking.pickup_date === 'number' ? booking.pickup_date * 1000 : booking.pickup_date) : null
    const dropoffDate = booking.dropoff_date ? new Date(typeof booking.dropoff_date === 'number' ? booking.dropoff_date * 1000 : booking.dropoff_date) : null

    // Find vehicle by name
    const vehicle = vehicles.find(v => v.display_name === booking.vehicle_name)

    // Extract location codes from booking_details
    const pickupLoc = booking.booking_details?.pickupLocation || 'dr7_office'
    const dropoffLoc = booking.booking_details?.dropoffLocation || 'dr7_office'

    setFormData({
      ...formData,
      customer_id: customerId,
      vehicle_id: vehicle?.id || '',
      pickup_date: pickupDate ? pickupDate.toISOString().split('T')[0] : '',
      pickup_time: pickupDate ? pickupDate.toTimeString().substring(0, 5) : '',
      return_date: dropoffDate ? dropoffDate.toISOString().split('T')[0] : '',
      return_time: dropoffDate ? dropoffDate.toTimeString().substring(0, 5) : '',
      pickup_location: pickupLoc,
      dropoff_location: dropoffLoc,
      status: booking.status,
      total_amount: (booking.price_total / 100).toString(),
      currency: booking.currency.toUpperCase(),
      source: 'admin',
      // 2nd Driver
      has_second_driver: !!booking.booking_details?.second_driver,
      second_driver_name: booking.booking_details?.second_driver?.name || '',
      second_driver_surname: booking.booking_details?.second_driver?.surname || '',
      second_driver_license_number: booking.booking_details?.second_driver?.license_number || '',
      second_driver_license_expiry: booking.booking_details?.second_driver?.license_expiry || '',
      second_driver_phone: booking.booking_details?.second_driver?.phone || '',
      second_driver_birth_date: booking.booking_details?.second_driver?.birth_date || '',
      second_driver_birth_place: booking.booking_details?.second_driver?.birth_place || '',
      insurance_option: booking.booking_details?.insuranceOption || 'KASKO_BASE',
      deposit: booking.booking_details?.deposit || '0',
      km_overage_fee: booking.km_overage_fee ? (booking.km_overage_fee).toFixed(2) : '0'
    })

    setEditingId(booking.id)
    setShowForm(true)
  }

  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isSubmitting) return

    setIsSubmitting(true)
    try {
      // Check for existing bookings on the same vehicle and dates (only for new bookings, not edits)
      if (!editingId) {
        const vehicle = vehicles.find(v => v.id === formData.vehicle_id)
        const pickupDateTime = new Date(`${formData.pickup_date}T${formData.pickup_time}:00`)
        const returnDateTime = new Date(`${formData.return_date}T${formData.return_time}:00`)

        // Calculate buffer time (1h30 = 90 minutes)
        const BUFFER_MINUTES = 90
        const pickupWithBuffer = new Date(pickupDateTime.getTime() - BUFFER_MINUTES * 60 * 1000)

        // Check for overlapping bookings AND bookings that violate the 1h30 buffer
        let query = supabase
          .from('bookings')
          .select('id, customer_name, vehicle_name, vehicle_plate, pickup_date, dropoff_date, status')
          .neq('status', 'cancelled')
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

      let customerId = formData.customer_id

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

      const customerInfo = newCustomerMode ? {
        ...newCustomerData,
        id: customerId,
        full_name: newCustomerData.tipo_cliente === 'persona_fisica'
          ? `${newCustomerData.nome} ${newCustomerData.cognome}`
          : newCustomerData.tipo_cliente === 'azienda'
            ? newCustomerData.denominazione
            : newCustomerData.ente_o_ufficio,
        phone: newCustomerData.telefono
      } : customers.find(c => c.id === customerId)

      // Create or update vehicle rental booking in bookings table (for website availability blocking)
      const vehicle = vehicles.find(v => v.id === formData.vehicle_id)

      // Get location labels
      const pickupLocationLabel = LOCATIONS.find(l => l.value === formData.pickup_location)?.label || formData.pickup_location
      const dropoffLocationLabel = LOCATIONS.find(l => l.value === formData.dropoff_location)?.label || formData.dropoff_location

      // Combine date and time
      const pickupDateTime = `${formData.pickup_date}T${formData.pickup_time}:00`
      const returnDateTime = `${formData.return_date}T${formData.return_time}:00`

      const bookingData = {
        user_id: null, // Set to null for admin-created bookings
        guest_name: customerInfo?.full_name || 'N/A', // Required for guest bookings
        guest_email: customerInfo?.email || null,
        guest_phone: customerInfo?.phone || null,
        vehicle_type: 'car',
        vehicle_name: vehicle?.display_name || 'N/A',
        vehicle_plate: vehicle?.plate || null,
        vehicle_image_url: null,
        pickup_date: new Date(pickupDateTime).toISOString(),
        dropoff_date: new Date(returnDateTime).toISOString(),
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
            customerId: customerId
          },
          pickupLocation: formData.pickup_location,
          dropoffLocation: formData.dropoff_location,
          amountPaid: Math.round(parseFloat(formData.amount_paid) * 100), // Store amount paid in cents
          source: 'admin_manual',
          // Kasko & Deposit
          insuranceOption: formData.insurance_option,
          deposit: formData.deposit,
          second_driver: formData.has_second_driver ? {
            name: formData.second_driver_name,
            surname: formData.second_driver_surname,
            license_number: formData.second_driver_license_number,
            license_expiry: formData.second_driver_license_expiry,
            phone: formData.second_driver_phone,
            birth_date: formData.second_driver_birth_date,
            birth_place: formData.second_driver_birth_place
          } : null
        }
      }

      console.log(editingId ? 'Updating rental booking' : 'Creating rental booking', 'with data:', bookingData)

      let insertedBooking
      if (editingId) {
        // Update existing booking
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
      loadData()
      alert(editingId ? '✅ Prenotazione aggiornata con successo!' : '✅ Prenotazione creata con successo!')
    } catch (error) {
      console.error('Failed to save reservation:', error)
      alert('Failed to save reservation: ' + (error as Error).message)
    } finally {
      setIsSubmitting(false)
    }
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
      second_driver_name: '',
      second_driver_surname: '',
      second_driver_license_number: '',
      second_driver_license_expiry: '',
      second_driver_phone: '',
      second_driver_birth_date: '',
      second_driver_birth_place: '',
      // Kasko & Deposit
      insurance_option: 'KASKO_BASE',
      deposit: '0'
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
      driver_license_number: ''
    })
  }

  if (loading) {
    return <div className="text-center py-8 text-gray-400">Loading...</div>
  }

  return (
    <>
      <style>{scrollbarStyle}</style>
      <div className="space-y-4">
        {/* Mobile-optimized header */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
          {/* Main Title - Italian Translation verified */}
          <h2 className="text-xl sm:text-2xl font-bold text-dr7-gold">Noleggio</h2>
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

        {showForm && (
          <form onSubmit={handleSubmit} className="bg-dr7-dark p-4 sm:p-6 rounded-lg mb-6 border border-gray-800">
            <h3 className="text-lg sm:text-xl font-semibold text-dr7-gold mb-4">
              {editingId ? 'Modifica Prenotazione' : 'Nuova Prenotazione'}
            </h3>

            {/* Booking Type Selection - Mobile Optimized */}
            {/* Customer Selection - Mobile Optimized */}
            <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-dr7-darker rounded-lg border border-gray-700">
              <div className="border-b border-gray-700 pb-4">
                <div className="flex items-center gap-4 mb-4">
                  <button
                    type="button"
                    onClick={() => setNewCustomerMode(false)}
                    className={`px-4 py-2 rounded ${!newCustomerMode ? 'bg-white text-black font-semibold' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                  >
                    Seleziona Cliente
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewCustomerMode(true)}
                    className={`px-4 py-2 rounded ${newCustomerMode ? 'bg-white text-black font-semibold' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
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
                    <label className="block text-sm font-medium text-gray-300 mb-2">Cerca Cliente</label>
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
              <Select
                label="Veicolo"
                required
                value={formData.vehicle_id}
                onChange={(e) => setFormData({ ...formData, vehicle_id: e.target.value })}
                options={[
                  { value: '', label: 'Seleziona veicolo...' },
                  ...vehicles.map(v => ({
                    value: v.id,
                    label: v.plate || v.targa ? `${v.display_name} (Targa: ${v.plate || v.targa})` : v.display_name
                  }))
                ]}
              />
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-dr7-darker rounded-lg border border-gray-700">
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
                  <Input
                    label="Ora Ritiro"
                    type="time"
                    required
                    value={formData.pickup_time}
                    onChange={(e) => {
                      const pickupTime = e.target.value
                      const returnTime = calculateReturnTime(pickupTime)
                      setFormData({ ...formData, pickup_time: pickupTime, return_time: returnTime })
                    }}
                  />
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
                    value={formData.return_date}
                    onChange={(e) => setFormData({ ...formData, return_date: e.target.value })}
                  />
                  <Input
                    label="Ora Riconsegna"
                    type="time"
                    required
                    value={formData.return_time}
                    onChange={(e) => setFormData({ ...formData, return_time: e.target.value })}
                  />
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
            </div>

            {/* Second Driver Section */}
            <div className="md:col-span-2 bg-dr7-darker p-4 rounded-lg border border-gray-700">
              <div className="flex items-center mb-4">
                <input
                  type="checkbox"
                  id="has_second_driver"
                  checked={formData.has_second_driver}
                  onChange={(e) => setFormData({ ...formData, has_second_driver: e.target.checked })}
                  className="w-4 h-4 text-dr7-gold bg-gray-700 border-gray-600 rounded focus:ring-dr7-gold focus:ring-offset-gray-800"
                />
                <label htmlFor="has_second_driver" className="ml-2 text-sm font-medium text-gray-300">
                  Aggiungi Secondo Guidatore
                </label>
              </div>

              {formData.has_second_driver && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn">
                  <Input
                    label="Nome"
                    value={formData.second_driver_name}
                    onChange={(e) => setFormData({ ...formData, second_driver_name: e.target.value })}
                  />
                  <Input
                    label="Cognome"
                    value={formData.second_driver_surname}
                    onChange={(e) => setFormData({ ...formData, second_driver_surname: e.target.value })}
                  />
                  <Input
                    label="Data di Nascita"
                    type="date"
                    value={formData.second_driver_birth_date}
                    onChange={(e) => setFormData({ ...formData, second_driver_birth_date: e.target.value })}
                  />
                  <Input
                    label="Luogo di Nascita"
                    value={formData.second_driver_birth_place}
                    onChange={(e) => setFormData({ ...formData, second_driver_birth_place: e.target.value })}
                  />
                  <Input
                    label="Telefono"
                    value={formData.second_driver_phone}
                    onChange={(e) => setFormData({ ...formData, second_driver_phone: e.target.value })}
                  />
                  <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Numero Patente"
                      value={formData.second_driver_license_number}
                      onChange={(e) => setFormData({ ...formData, second_driver_license_number: e.target.value })}
                    />
                    <Input
                      label="Scadenza Patente"
                      type="date"
                      value={formData.second_driver_license_expiry}
                      onChange={(e) => setFormData({ ...formData, second_driver_license_expiry: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Kasko Selection & Deposit */}
            <div className="md:col-span-2 bg-dr7-darker p-4 rounded-lg border border-gray-700">
              <h4 className="text-white font-semibold mb-3">Opzioni Noleggio & Cauzione</h4>
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
                  { value: 'paid', label: 'Pagato' },
                  { value: 'pending', label: 'Da Saldare' },
                  { value: 'unpaid', label: 'Non Pagato' }
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
              />
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
              <div className="bg-dr7-dark rounded-lg border border-gray-800 p-8 text-center text-gray-500">
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
                className="bg-dr7-dark rounded-lg p-4 cursor-pointer hover:bg-dr7-darker transition-colors"
                onClick={() => setSelectedBooking(booking)}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <div className="font-semibold text-white mb-1">
                      {booking.booking_details?.customer?.fullName || booking.customer_name || 'N/A'}
                    </div>
                    <div className="text-sm text-gray-400">{booking.customer_phone || '-'}</div>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${booking.payment_status === 'completed' || booking.payment_status === 'paid' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                    }`}>
                    {booking.payment_status === 'completed' || booking.payment_status === 'paid' ? 'Pagato' : 'Non Pagato'}
                  </span>
                </div>

                <div className="mb-2">
                  <div className="flex items-center gap-2 text-white">
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
                    <div className="text-xs text-gray-400 mt-1">Targa: {booking.vehicle_plate}</div>
                  )}
                </div>

                <div className="text-xs text-gray-400 mb-2">
                  {isCarWash
                    ? `${booking.appointment_date ? new Date(booking.appointment_date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' }) : '-'}${booking.appointment_time ? ` alle ${booking.appointment_time}` : ''}`
                    : `${booking.pickup_date ? new Date(typeof booking.pickup_date === 'number' ? booking.pickup_date * 1000 : booking.pickup_date).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome', hour12: false }) : '-'} → ${booking.dropoff_date ? new Date(typeof booking.dropoff_date === 'number' ? booking.dropoff_date * 1000 : booking.dropoff_date).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome', hour12: false }) : '-'}`
                  }
                </div>

                <div className="flex justify-between items-start mt-3 gap-2">
                  <div className="text-lg font-bold text-white">
                    {canViewFinancials || userEmail === 'dubai.rent7.0srl@gmail.com' ? `€${(booking.price_total / 100).toFixed(2)}` : '***'}
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEditBooking(booking) }}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors whitespace-nowrap"
                    >
                      Modifica
                    </button>

                    {/* Contract Actions */}
                    {booking.booking_details?.contract_generated_at || booking.contract_url ? (
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); window.open(booking.contract_url, '_blank') }}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors whitespace-nowrap flex items-center gap-1"
                          title="Visualizza Contratto"
                        >
                          <span>📄</span> PDF
                        </button>
                        <a
                          href={`mailto:${booking.customer_email || ''}?subject=${encodeURIComponent(`Contratto Noleggio DR7 - ${booking.vehicle_name}`)}&body=${encodeURIComponent(`Gentile Cliente,\n\nEcco il link al tuo contratto di noleggio:\n${booking.contract_url}\n\nGrazie per aver scelto DR7 Empire.`)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded transition-colors whitespace-nowrap flex items-center gap-1"
                          title="Invia Email"
                        >
                          <span>✉️</span> Email
                        </a>

                        {/* Yousign Button (Mobile) */}
                        {(() => {
                          const contract = Array.isArray(booking.contracts) ? booking.contracts[0] : booking.contracts
                          const status = contract?.yousign_status
                          const signedUrl = contract?.signed_pdf_url

                          if (status === 'signed' && signedUrl) {
                            return (
                              <button
                                onClick={(e) => { e.stopPropagation(); window.open(signedUrl, '_blank') }}
                                className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded transition-colors whitespace-nowrap flex items-center gap-1"
                                title="Scarica Contratto Firmato"
                              >
                                <span>🖊️</span> Firmato
                              </button>
                            )
                          } else if (status === 'ongoing') {
                            return (
                              <span className="px-3 py-1 bg-yellow-600 text-white text-sm rounded flex items-center gap-1 opacity-70 cursor-not-allowed">
                                <span>⏳</span> In Firma
                              </span>
                            )
                          } else {
                            return (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSendToYousign(booking.id) }}
                                className="px-3 py-1 bg-pink-600 hover:bg-pink-700 text-white text-sm rounded transition-colors whitespace-nowrap flex items-center gap-1"
                                title="Invia a Yousign"
                              >
                                <span>✍️</span> Yousign
                              </button>
                            )
                          }
                        })()}
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleGenerateContract(booking) }}
                        disabled={generatingContract}
                        className={`px-3 py-1 ${generatingContract ? 'bg-gray-600 text-gray-300' : 'bg-dr7-gold hover:bg-yellow-600 text-white'} text-sm rounded transition-colors whitespace-nowrap flex items-center gap-1`}
                      >
                        {generatingContract ? 'Generazione...' : '📄 Genera Contratto'}
                      </button>
                    )}

                    {booking.status !== 'cancelled' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCancelBooking(booking.id, 'booking') }}
                        className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded transition-colors whitespace-nowrap"
                      >
                        Cancella
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteBooking(booking.id, 'booking') }}
                      className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors whitespace-nowrap w-full"
                    >
                      Elimina
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Desktop Table View */}
        <div className="hidden lg:block bg-dr7-dark rounded-lg overflow-hidden">
          <div className="overflow-x-auto overflow-y-visible custom-scrollbar">
            <table className="w-full min-w-max">
              <thead className="bg-dr7-darker sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-gray-300 whitespace-nowrap">Nome</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-gray-300 whitespace-nowrap">Telefono</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-gray-300 whitespace-nowrap">Car</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-gray-300 whitespace-nowrap">Data Inizio</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-gray-300 whitespace-nowrap">Data Fine</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-gray-300 whitespace-nowrap">Pagamento</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-gray-300 whitespace-nowrap">Totale</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-gray-300 whitespace-nowrap">Azioni</th>
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
                    <tr key={`booking-${booking.id}`} className="border-t border-gray-800 hover:bg-dr7-darker/50 cursor-pointer" onClick={() => setSelectedBooking(booking)}>
                      <td className="px-3 py-3 text-sm text-white whitespace-nowrap">
                        {booking.booking_details?.customer?.fullName || booking.customer_name || 'N/A'}
                      </td>
                      <td className="px-3 py-3 text-sm text-white whitespace-nowrap">
                        {booking.customer_phone || '-'}
                      </td>
                      <td className="px-3 py-3 text-sm text-white whitespace-nowrap">
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
                              <span className="text-xs text-gray-400">Targa: {booking.vehicle_plate}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm text-white whitespace-nowrap">
                        {isCarWash
                          ? (booking.appointment_date ? `${new Date(booking.appointment_date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' })} ${booking.appointment_time || ''}` : '-')
                          : (booking.pickup_date ? new Date(typeof booking.pickup_date === 'number' ? booking.pickup_date * 1000 : booking.pickup_date).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome', hour12: false }) : '-')
                        }
                      </td>
                      <td className="px-3 py-3 text-sm text-white whitespace-nowrap">
                        {isCarWash
                          ? (booking.appointment_date && booking.appointment_time
                            ? `${new Date(booking.appointment_date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' })} ${calculateCarWashEndTime(booking.appointment_date, booking.appointment_time, booking.price_total)}`
                            : '-')
                          : (booking.dropoff_date ? new Date(typeof booking.dropoff_date === 'number' ? booking.dropoff_date * 1000 : booking.dropoff_date).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome', hour12: false }) : '-')
                        }
                      </td>
                      <td className="px-3 py-3 text-sm whitespace-nowrap">
                        <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${booking.payment_status === 'completed' || booking.payment_status === 'paid' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                          }`}>
                          {booking.payment_status === 'completed' || booking.payment_status === 'paid' ? 'Pagato' : 'Non Pagato'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm text-white whitespace-nowrap">
                        {canViewFinancials || userEmail === 'dubai.rent7.0srl@gmail.com' ? `€${(booking.price_total / 100).toFixed(2)}` : '***'}
                      </td>
                      <td className="px-3 py-3 text-sm whitespace-nowrap">
                        <div className="flex gap-2 items-center">
                          {booking.status !== 'cancelled' && (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleGenerateContract(booking) }}
                                disabled={generatingContract}
                                className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded transition-colors whitespace-nowrap disabled:opacity-50"
                              >
                                {generatingContract ? '...' : 'Genera Contratto'}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleEditBooking(booking) }}
                                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors whitespace-nowrap"
                              >
                                Modifica
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCancelBooking(booking.id, 'booking') }}
                                className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white text-xs rounded transition-colors whitespace-nowrap"
                              >
                                Cancella
                              </button>
                            </>
                          )}

                          {/* Yousign Button (Desktop) */}
                          {booking.contract_url && booking.status !== 'cancelled' && (() => {
                            const contract = Array.isArray(booking.contracts) ? booking.contracts[0] : booking.contracts
                            const status = contract?.yousign_status
                            const signedUrl = contract?.signed_pdf_url

                            if (status === 'signed' && signedUrl) {
                              return (
                                <button
                                  onClick={(e) => { e.stopPropagation(); window.open(signedUrl, '_blank') }}
                                  className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs rounded transition-colors whitespace-nowrap"
                                  title="Scarica Firmato"
                                >
                                  🖊️ Firmato
                                </button>
                              )
                            } else if (status === 'ongoing') {
                              return (
                                <span className="px-3 py-1 bg-yellow-600 text-white text-xs rounded opacity-70 cursor-not-allowed whitespace-nowrap">
                                  ⏳ In Firma
                                </span>
                              )
                            } else {
                              return (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSendToYousign(booking.id) }}
                                  className="px-3 py-1 bg-pink-600 hover:bg-pink-700 text-white text-xs rounded transition-colors whitespace-nowrap"
                                  title="Invia a Yousign"
                                >
                                  ✍️ Yousign
                                </button>
                              )
                            }
                          })()}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteBooking(booking.id, 'booking') }}
                            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors whitespace-nowrap"
                          >
                            Elimina
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
          <div className="fixed inset-0 bg-black bg-opacity-75 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
            <div className="bg-dr7-dark w-full sm:max-w-2xl sm:rounded-lg max-h-[90vh] overflow-y-auto">
              {/* Modal Header */}
              <div className="sticky top-0 bg-dr7-darker p-4 border-b border-gray-700 flex justify-between items-center">
                <h3 className="text-lg sm:text-xl font-bold text-dr7-gold">Dettagli Prenotazione</h3>
                <button
                  onClick={() => setSelectedBooking(null)}
                  className="text-gray-400 hover:text-white text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-4 sm:p-6 space-y-4">
                {/* Customer Info */}
                <div className="bg-dr7-darker p-4 rounded-lg">
                  <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                    Cliente
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div><span className="text-gray-400">Nome:</span> <span className="text-white">{selectedBooking.booking_details?.customer?.fullName || selectedBooking.customer_name || 'N/A'}</span></div>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-gray-400">Telefono:</span> <span className="text-white">{selectedBooking.customer_phone || '-'}</span>
                      </div>
                      {selectedBooking.customer_phone && (
                        <a
                          href={`tel:${selectedBooking.customer_phone}`}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium transition-colors"
                        >
                          Chiama
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Service Info */}
                <div className="bg-dr7-darker p-4 rounded-lg">
                  <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                    Car
                  </h4>
                  <div className="space-y-2 text-sm">
                    {selectedBooking.service_type === 'car_wash' ? (
                      <>
                        <div><span className="text-gray-400">Tipo:</span> <span className="text-white">{selectedBooking.service_name || 'Autolavaggio'}</span></div>
                        <div><span className="text-gray-400">Data:</span> <span className="text-white">{selectedBooking.appointment_date ? new Date(selectedBooking.appointment_date).toLocaleDateString('it-IT', { dateStyle: 'full' }) : '-'}</span></div>
                        <div><span className="text-gray-400">Ora:</span> <span className="text-white">{selectedBooking.appointment_time || '-'}</span></div>
                        {selectedBooking.booking_details?.additionalService && (
                          <div><span className="text-gray-400">Servizio Aggiuntivo:</span> <span className="text-white">{selectedBooking.booking_details.additionalService}</span></div>
                        )}
                      </>
                    ) : (
                      <>
                        <div><span className="text-gray-400">Veicolo:</span> <span className="text-white">{selectedBooking.vehicle_name || '-'}</span></div>
                        {selectedBooking.vehicle_plate && (
                          <div><span className="text-gray-400">Targa:</span> <span className="text-white">{selectedBooking.vehicle_plate}</span></div>
                        )}
                        <div><span className="text-gray-400">Ritiro:</span> <span className="text-white">{selectedBooking.pickup_date ? new Date(typeof selectedBooking.pickup_date === 'number' ? selectedBooking.pickup_date * 1000 : selectedBooking.pickup_date).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '-'}</span></div>
                        <div><span className="text-gray-400">Luogo Ritiro:</span> <span className="text-white">{selectedBooking.pickup_location || '-'}</span></div>
                        <div><span className="text-gray-400">Riconsegna:</span> <span className="text-white">{selectedBooking.dropoff_date ? new Date(typeof selectedBooking.dropoff_date === 'number' ? selectedBooking.dropoff_date * 1000 : selectedBooking.dropoff_date).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '-'}</span></div>
                        <div><span className="text-gray-400">Luogo Riconsegna:</span> <span className="text-white">{selectedBooking.dropoff_location || '-'}</span></div>
                        <div><span className="text-gray-400">Assicurazione:</span> <span className="text-dr7-gold">{selectedBooking.booking_details?.insuranceOption || 'N/A'}</span></div>
                        <div><span className="text-gray-400">Cauzione:</span> <span className="text-white">{selectedBooking.booking_details?.deposit ? `€${selectedBooking.booking_details.deposit}` : 'N/A'}</span></div>
                      </>
                    )}
                  </div>
                </div>

                {/* Payment Info */}
                <div className="bg-dr7-darker p-4 rounded-lg">
                  <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                    Pagamento
                  </h4>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Importo:</span>
                      <span className="text-white font-bold text-xl">
                        {canViewFinancials || userEmail === 'dubai.rent7.0srl@gmail.com' ? `€${(selectedBooking.price_total / 100).toFixed(2)}` : '***'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Stato:</span>
                      <span className={`px-3 py-1.5 rounded text-sm font-medium ${selectedBooking.payment_status === 'completed' || selectedBooking.payment_status === 'paid'
                        ? 'bg-green-900 text-green-300'
                        : selectedBooking.payment_status === 'pending'
                          ? 'bg-yellow-900 text-yellow-300'
                          : 'bg-red-900 text-red-300'
                        }`}>
                        {selectedBooking.payment_status === 'completed' || selectedBooking.payment_status === 'paid'
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
                  <div className="bg-dr7-darker p-4 rounded-lg">
                    <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                      Note
                    </h4>
                    <p className="text-sm text-gray-300">{selectedBooking.booking_details.notes}</p>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-3 pt-4">
                  {selectedBooking.status !== 'cancelled' && (
                    <button
                      onClick={() => handleGenerateContract(selectedBooking)}
                      disabled={generatingContract}
                      className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium disabled:opacity-50"
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
                      className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium"
                    >
                      Cancella Prenotazione
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedBooking(null)}
                    className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium"
                  >
                    Chiudi
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div >
    </>
  )
}
